/**
 * GenericAnimationPlayer
 * Generic animation player, suitable for simple objects like props, backgrounds, etc.
 * 
 * Differences from CharacterSprite:
 * - Does not support Part-level animation (no multi-part assembly)
 * - Directly applied to a single PIXI.Container
 * - More lightweight, reuses core AnimationPlayer logic
 */

import * as PIXI from 'pixi.js'
import { GlowFilter, MotionBlurFilter } from 'pixi-filters'

import type { AnimationDefinition, AnimationOutput, AnimationPlayParams, AnimationTrack, EffectTrackOutput } from '@/types/animation'
import { TARGET_SELF } from '@/types/animation'
import { restoreAnimatedSpriteStillFrame, type StillFrameConfig, type TextureGetter } from '@/utils/animationUtils'

import { createDynamicEffectManager, type DynamicEffectManager } from './animation/DynamicEffectManager'
import {
    composeAnimationOutputs,
    type CompositionContext,
    type EffectNumericDelta,
} from './AnimationComposition'
import { AnimationPlayer } from './AnimationPlayer'
import { CompositeRenderTarget } from './CompositeRenderTarget'
import { createRibbonEffect, type RibbonEffect } from './effects/RibbonEffect'
import { createWaveEffect, type WaveEffect } from './effects/WaveEffect'

/**
 * v18: Cross-object Player resolver (for delegation mode)
 * Retrieves corresponding GenericAnimationPlayer according to object ID
 */
export type PlayerResolver = (objectId: string) => GenericAnimationPlayer | null

export interface GenericAnimationPlayerConfig {
    target: PIXI.Container
    /** ID of the object owning the animation */
    ownerObjectId?: string
    /** v18: Cross-object Player lookup callback (for delegation mode) */
    playerResolver?: PlayerResolver

    /** v11.52: Object type (for automatically retrieving still frame config from Store) */
    objectType?: 'prop' | 'background'
    /** v11.52: Object ID (for automatically retrieving still frame config from Store) */
    objectId?: string
    /** v11.52: Texture getter (for custom still image restoration) */
    textureGetter?: TextureGetter
    /** v11.52: Still frame config (optional, automatically overridden by objectType+objectId) */
    stillFrameConfig?: StillFrameConfig
    frameSequencePlayback?: 'auto' | 'named_only' | 'disabled'
    /** v11.60: Whether offscreen composite mode is enabled (for whole-body transform of multi-part characters) */
    compositeMode?: boolean
    /** v11.60: PIXI renderer reference (required by compositeMode) */
    renderer?: PIXI.Renderer
}

export class GenericAnimationPlayer {
    private target: PIXI.Container
    private players = new Map<string, AnimationPlayer>()
    private effectManager: DynamicEffectManager
    private waveEffect: WaveEffect
    private ribbonEffect: RibbonEffect

    // Base transform (for Base + Delta mode)
    private baseX = 0
    private baseY = 0
    private baseScaleX = 1
    private baseScaleY = 1
    private baseRotation = 0
    private baseAlpha = 1

    // Object bounds dimension and origin (for pivot position compensation)
    private objectWidth = 0
    private objectHeight = 0
    private objectBoundsX = 0
    private objectBoundsY = 0

    // v19: Animation position delta (including pivot compensation), read by propagateUnionAnimations
    private lastDeltaX = 0
    private lastDeltaY = 0

    // Filter cache
    private glowFilter: GlowFilter | null = null
    private motionBlurFilter: MotionBlurFilter | null = null

    // v11.52: Still frame config (used to restore when stopping animation)
    private stillFrameIndex = 0
    private stillFrameConfig: StillFrameConfig | null = null
    private textureGetter: TextureGetter | null = null

    // v11.52: Object identification (used to retrieve config from Store)
    private objectType: 'prop' | 'background' | null = null
    private objectId: string | null = null
    private frameSequencePlayback: 'auto' | 'named_only' | 'disabled' = 'auto'

    // v18: Cross-object delegation mode
    // @ts-expect-error TS6133: Retained for debugging and logging
    private ownerObjectId: string | null = null
    private playerResolver: PlayerResolver | null = null
    /** Track delegated animations: animName → Map<targetPlayerId, delegatedAnimName> */
    private delegatedAnimations = new Map<string, Map<string, string>>()


    // v11.60: Offscreen composite mode support
    private compositeTarget: CompositeRenderTarget | null = null
    private compositeMode = false

    constructor(config: GenericAnimationPlayerConfig) {
        this.target = config.target
        this.ownerObjectId = config.ownerObjectId ?? null
        this.playerResolver = config.playerResolver ?? null

        this.textureGetter = config.textureGetter ?? null
        this.objectType = config.objectType ?? null
        this.objectId = config.objectId ?? null
        this.frameSequencePlayback = config.frameSequencePlayback ?? 'auto'
        this.compositeMode = config.compositeMode ?? false

        // Prefer passed-in stillFrameConfig, otherwise auto-fetch from Store
        if (config.stillFrameConfig) {
            this.stillFrameConfig = config.stillFrameConfig
            if (config.stillFrameConfig.stillFrameIndex !== undefined) {
                this.stillFrameIndex = config.stillFrameConfig.stillFrameIndex
            }
        } else if (config.objectType && config.objectId) {
            // Auto-fetch from Store
            this.loadStillFrameConfigFromStore()
        }

        this.effectManager = createDynamicEffectManager()
        this.waveEffect = createWaveEffect()
        this.ribbonEffect = createRibbonEffect()
        this.cacheBaseTransform()

        // v11.60: Initialize offscreen composite target
        if (this.compositeMode && config.renderer) {
            this.compositeTarget = new CompositeRenderTarget({
                source: this.target,
                renderer: config.renderer
            })
            // Enable offscreen mode
            this.compositeTarget.enable()
        }
    }

    private syncFrameSequenceSpriteState(): void {
        const animatedSprite = this.findAnimatedSprite()
        if (!animatedSprite) return

        const activePlayback = this.getActiveFrameSequencePlayback()
        const playableSprite = animatedSprite as PIXI.AnimatedSprite & { _shouldPlay?: boolean }

        if (activePlayback && animatedSprite.textures.length > 1) {
            animatedSprite.loop = activePlayback.loop
            animatedSprite.animationSpeed = activePlayback.fps / 60
            playableSprite._shouldPlay = true
            return
        }

        playableSprite._shouldPlay = false
    }

    /**
     * Resolve material source FPS
     * When track.fps is undefined, read from AnimatedSprite's current animationSpeed
     * animationSpeed is set by sprite creation code based on material real-time FPS (e.g. expression.speakingFps)
     */
    private resolveSourceFps(): number {
        const sprite = this.findAnimatedSprite()
        if (sprite && sprite.animationSpeed > 0) {
            return Math.round(sprite.animationSpeed * 60)
        }
        return 25
    }

    private getActiveFrameSequencePlayback(): { fps: number; loop: boolean } | null {
        for (const player of this.players.values()) {
            if (!player.isPlaying) continue
            const definition = player.currentAnimation
            if (definition?.type !== 'track') continue

            const frameTrack = definition.tracks.find(
                (track): track is Extract<AnimationTrack, { trackType: 'frame_sequence' }> =>
                    track.trackType === 'frame_sequence' && (!track.targetObjectId || track.targetObjectId === TARGET_SELF)
            )
            if (!frameTrack) continue

            return {
                fps: frameTrack.fps ?? this.resolveSourceFps(),
                loop: player.loop,
            }
        }

        return null
    }

    private getFrameSequenceFps(definition: AnimationDefinition): number {
        if (definition.type !== 'track') return this.resolveSourceFps()

        const frameTrack = definition.tracks.find(
            (track): track is Extract<AnimationTrack, { trackType: 'frame_sequence' }> =>
                track.trackType === 'frame_sequence' && (!track.targetObjectId || track.targetObjectId === TARGET_SELF)
        )
        return frameTrack?.fps ?? this.resolveSourceFps()
    }

    /**
     * Cache base transform
     */
    cacheBaseTransform(): void {
        const t = this.getBaseTransformTarget()
        if (!this.isContainerUsable(t)) return
        this.baseX = t.x
        this.baseY = t.y
        this.baseScaleX = t.scale.x
        this.baseScaleY = t.scale.y
        this.baseRotation = t.rotation
        this.baseAlpha = t.alpha

        // v21: Consistently use getLocalBounds to measure object bounds
        try {
            const bounds = this.target.getLocalBounds()
            if (bounds.width > 0 && bounds.height > 0) {
                this.objectWidth = bounds.width
                this.objectHeight = bounds.height
                this.objectBoundsX = bounds.x
                this.objectBoundsY = bounds.y
            }
        } catch {
            // getLocalBounds may throw exception if container has no children, ignore
        }
    }

    /**
     * Set object bounds dimensions and start coordinates (used for pivot position compensation calculation)
     * Called by ScenePlayer / FrameCapture after measureObjects()
     *
     * @param boundsX Local coordinate start X of bounds, optional (for cases like composite where PIXI pivot is not at bounds center)
     * @param boundsY Local coordinate start Y of bounds, optional
     */
    setObjectBounds(width: number, height: number, boundsX?: number, boundsY?: number): void {
        this.objectWidth = width
        this.objectHeight = height
        if (boundsX !== undefined) this.objectBoundsX = boundsX
        if (boundsY !== undefined) this.objectBoundsY = boundsY
    }

    /**
     * v19: Get position delta of current animation frame (including pivot compensation)
     * propagateUnionAnimations uses this delta to propagate animation-driven displacement to union children
     */
    getAnimationPositionDelta(): { x: number; y: number } {
        return { x: this.lastDeltaX, y: this.lastDeltaY }
    }

    /**
     * Update per frame
     * @param deltaTime Elapsed time since last frame (ms)
     */
    update(deltaTime: number): void {
        if (!this.isContainerUsable(this.getBaseTransformTarget())) return

        // 1. Update effect manager time
        this.effectManager.update(deltaTime)
        this.waveEffect.update(deltaTime)
        this.ribbonEffect.update(deltaTime)

        // 2. Collect all player outputs
        const outputs: AnimationOutput[] = []
        for (const player of this.players.values()) {
            const output = player.update(deltaTime)
            if (output) {
                outputs.push(output)
            }
        }

        // 3. Merge and apply outputs
        if (outputs.length > 0) {
            this.applyOutputs(outputs)
        }

        // 4. Update Wave effects
        this.syncFrameSequenceSpriteState()
        this.waveEffect.updateAllEffects()
        // v12.0: Update Ribbon effect
        this.ribbonEffect.updateAllEffects()

        // 5. v11.60: Update RenderTexture in offscreen mode
        if (this.compositeTarget) {
            this.compositeTarget.updateRenderTexture()
        }
    }

    private getFilterTarget(): PIXI.Container {
        if (this.compositeTarget) {
            return this.compositeTarget.getOutputContainer()
        }
        return this.target
    }

    /**
     * Play animation
     * v11.52: Frame animation directly uses AnimatedSprite.play()
     * v11.60: Add setOnLoop and setOnStop callbacks, supporting jelly effect loop
     */
    playAnimation(name: string, definition: AnimationDefinition, params?: AnimationPlayParams): void {
        // v21: Deferred bounds measurement (resolves creation timing issue)
        // Child containers might not be ready when creating Player, bounds are 0.
        // When playing, all child containers are ready, re-measure.
        if (this.objectWidth === 0 && this.objectHeight === 0) {
            try {
                const bounds = this.target.getLocalBounds()
                if (bounds.width > 0 && bounds.height > 0) {
                    this.objectWidth = bounds.width
                    this.objectHeight = bounds.height
                    this.objectBoundsX = bounds.x
                    this.objectBoundsY = bounds.y
                }
            } catch {
                // getLocalBounds may throw if container has no children, ignore
            }
        }

        // v18: Delegation mode — delegate cross-object tracks to child object's Player
        if (definition.type === 'track' && this.playerResolver) {
            const { selfTracks, crossGroups } = this.splitTracksByTarget(definition.tracks)

            // Delegate cross-object tracks
            if (crossGroups.size > 0) {
                const delegationMap = new Map<string, string>()
                for (const [targetId, tracks] of crossGroups) {
                    const targetPlayer = this.playerResolver(targetId)
                    if (!targetPlayer) {
                        console.warn(`[GenericAnimationPlayer] Delegation target ${targetId} does not exist, track for this target in animation "${name}" was skipped`)
                        continue
                    }
                    // Construct sub definition: remove targetObjectId, letting child Player take self-transform path
                    const subDef = {
                        ...definition,
                        tracks: tracks.map(t => {
                            const { targetObjectId: _tid, ...rest } = t
                            return rest
                        })
                    } as AnimationDefinition
                    const delegatedName = `__d_${name}`
                    targetPlayer.playAnimation(delegatedName, subDef, params)
                    delegationMap.set(targetId, delegatedName)
                }
                this.delegatedAnimations.set(name, delegationMap)

                // Skip self playback when there are no self tracks
                if (selfTracks.length === 0) return
                // Reconstruct definition with only self tracks
                definition = {
                    ...definition,
                    tracks: selfTracks
                } as AnimationDefinition
            }
        }

        let player = this.players.get(name)
        if (!player) {
            player = new AnimationPlayer()

            player.setOnLoop((def) => {
                void def
            })

            player.setOnStop((def) => {
                if (def.type !== 'track') return
                for (const track of def.tracks) {
                    if (track.trackType === 'effect') {
                        const effectType = track.effectParams?.type
                        if (effectType !== 'jelly' && effectType !== 'squash') {
                            this.effectManager.removeEffect(`dyn_${effectType}`)
                        }
                    }
                }
            })

            this.players.set(name, player)
        }

        const playParams: AnimationPlayParams = {
            loop: params?.loop ?? definition.loop ?? true,
            speed: params?.speed ?? 1.0,
            reset: params?.reset ?? true
        }
        if (params?.runtimeDuration != null) {
            playParams.runtimeDuration = params.runtimeDuration
        }

        player.play(definition, playParams)

        // v11.52: Directly start AnimatedSprite for frame_sequence tracks
        this.startFrameSequenceAnimations(definition, playParams.loop ?? true)
    }

    /**
     * Stop animation
     * v11.52: Concurrently stop frame animation
     */
    stopAnimation(name: string): void {
        // v18: Stop delegated child animations
        this.stopDelegatedAnimations(name)

        const player = this.players.get(name)
        if (!player) {
            return
        }

        player.stop()

        // v11.52: Stop frame animation
        this.stopFrameSequenceAnimations()

        // v18: Clean up effects (ribbon/wave/glow/motion_blur and other effects not managed by effectManager)
        this.effectManager.clear()
        this.removeAllFilters()

        // Restore base transform
        this.restoreBaseTransform()
    }

    /**
     * Stop all animations
     */
    stopAllAnimations(): void {
        // v18: Stop all delegated child animations
        for (const animName of this.delegatedAnimations.keys()) {
            this.stopDelegatedAnimations(animName)
        }
        this.delegatedAnimations.clear()

        for (const player of this.players.values()) {
            player.stop()
        }
        this.players.clear()

        // Clean up effects
        this.effectManager.clear()
        this.removeAllFilters()

        // Restore base transform
        this.restoreBaseTransform()
    }

    /**
     * v18: Stop all delegations of a specific animation
     */
    private stopDelegatedAnimations(name: string): void {
        const delegations = this.delegatedAnimations.get(name)
        if (!delegations || !this.playerResolver) return
        for (const [targetId, delegatedName] of delegations) {
            const targetPlayer = this.playerResolver(targetId)
            if (targetPlayer) {
                targetPlayer.stopAnimation(delegatedName)
            }
        }
        this.delegatedAnimations.delete(name)
    }

    /**
     * Restore base transform
     */
    private restoreBaseTransform(): void {
        const t = this.getBaseTransformTarget()
        if (!this.isContainerUsable(t)) return
        t.x = this.baseX
        t.y = this.baseY
        t.scale.x = this.baseScaleX
        t.scale.y = this.baseScaleY
        t.rotation = this.baseRotation
        t.alpha = this.baseAlpha
        // v19: Reset animation delta
        this.lastDeltaX = 0
        this.lastDeltaY = 0

        if (this.compositeTarget) {
            const compositeSprite = this.compositeTarget.getCompositeSprite()
            if ((compositeSprite as unknown as { destroyed?: boolean }).destroyed) return
            compositeSprite.rotation = 0
            compositeSprite.scale.set(1, 1)
            compositeSprite.alpha = 1
        }
    }

    private getBaseTransformTarget(): PIXI.Container {
        if (this.compositeTarget) {
            return this.compositeTarget.getOutputContainer()
        }
        return this.target
    }

    /**
     * Merge and apply animation outputs
     * v18: Under delegation mode all outputs are self-target, no cross-object distribution needed
     * v24: Composition logic (transform accumulation / visibility multiplication / effect numerical delta)
     *      extracted to shared module AnimationComposition, reused with animation editor workbench preview.
     */
    private applyOutputs(outputs: AnimationOutput[]): void {
        const compositionCtx: CompositionContext = {
            baseRotation: this.baseRotation,
            baseScaleX: this.baseScaleX,
            baseScaleY: this.baseScaleY,
            objectBoundsX: this.objectBoundsX,
            objectBoundsY: this.objectBoundsY,
            objectWidth: this.objectWidth,
            objectHeight: this.objectHeight,
            pivotX: this.target.pivot.x,
            pivotY: this.target.pivot.y,
        }

        // First apply all effects (install/update filters, launch particles, etc. stateful resources), then get numeric deltas.
        // Consistent with legacy implementation: applyEffect is called prior to evaluateDynamicEffectDeltas.
        for (const output of outputs) {
            for (const e of output.effects) {
                this.applyEffect(e)
            }
        }

        const evaluateEffect = (e: EffectTrackOutput): EffectNumericDelta | null => {
            return this.evaluateDynamicEffectDeltas(e)
        }

        const composed = composeAnimationOutputs(outputs, compositionCtx, evaluateEffect)

        const deltaX = composed.deltaX
        const deltaY = composed.deltaY
        const deltaRotation = composed.deltaRotation
        const scaleMultX = composed.scaleMultX
        const scaleMultY = composed.scaleMultY
        const alphaProduct = composed.alphaProduct

        // ── Apply transforms ──
        // v19: Cache animation position delta (including pivot compensation), used by propagateUnionAnimations
        this.lastDeltaX = deltaX
        this.lastDeltaY = deltaY

        if (this.compositeTarget) {
            const outputContainer = this.compositeTarget.getOutputContainer()
            if (!this.isContainerUsable(outputContainer)) return
            outputContainer.x = this.baseX + deltaX
            outputContainer.y = this.baseY + deltaY
            outputContainer.rotation = this.baseRotation + deltaRotation
            outputContainer.scale.x = this.baseScaleX * scaleMultX
            outputContainer.scale.y = this.baseScaleY * scaleMultY
            outputContainer.alpha = this.baseAlpha * alphaProduct

            const compositeSprite = this.compositeTarget.getCompositeSprite()
            if (!(compositeSprite as unknown as { destroyed?: boolean }).destroyed) {
                compositeSprite.rotation = 0
                compositeSprite.scale.set(1, 1)
                compositeSprite.alpha = 1
            }
        } else {
            if (!this.isContainerUsable(this.target)) return
            this.target.x = this.baseX + deltaX
            this.target.y = this.baseY + deltaY
            this.target.rotation = this.baseRotation + deltaRotation
            this.target.scale.x = this.baseScaleX * scaleMultX
            this.target.scale.y = this.baseScaleY * scaleMultY
            this.target.alpha = this.baseAlpha * alphaProduct
        }
    }

    /**
     * v18: Split tracks by targetObjectId
     */
    private splitTracksByTarget(tracks: AnimationTrack[]) {
        const selfTracks: AnimationTrack[] = []
        const crossGroups = new Map<string, AnimationTrack[]>()
        for (const track of tracks) {
            const tid = track.targetObjectId
            if (!tid || tid === TARGET_SELF) {
                selfTracks.push(track)
            } else {
                let group = crossGroups.get(tid)
                if (!group) { group = []; crossGroups.set(tid, group) }
                group.push(track)
            }
        }
        return { selfTracks, crossGroups }
    }

    // ===== v11.52: Direct playback support for frame animation =====

    /**
     * Find AnimatedSprite in container
     * v18: Accepts container parameter, supporting cross-object search
     */
    private findAnimatedSpriteInContainer(container: PIXI.Container): PIXI.AnimatedSprite | null {
        if (this.frameSequencePlayback === 'disabled') return null

        // 1. Try finding by name
        const names = ['prop_animation', 'bg_animation', 'symbol_animation', 'expression_animation', 'animation']
        for (const name of names) {
            const child = container.getChildByName(name)
            if (child && child instanceof PIXI.AnimatedSprite) {
                return child
            }
        }

        if (this.frameSequencePlayback === 'named_only') return null

        // 2. Fallback: Find first AnimatedSprite
        for (const child of container.children) {
            if (child instanceof PIXI.AnimatedSprite) {
                return child
            }
        }

        return null
    }

    /**
     * Backward compatibility: Find AnimatedSprite in own container
     */
    private findAnimatedSprite(): PIXI.AnimatedSprite | null {
        return this.findAnimatedSpriteInContainer(this.target)
    }

    /**
     * v11.52: Directly start AnimatedSprite frame animation for frame_sequence tracks
     * v18: In delegation mode, cross-object frame animation is handled by child Player; here only self is handled
     */
    private startFrameSequenceAnimations(_definition: AnimationDefinition, loop: boolean): void {
        const animatedSprite = this.findAnimatedSprite()
        if (animatedSprite && animatedSprite.textures.length > 1) {
            const activePlayback = this.getActiveFrameSequencePlayback()
            const fps = activePlayback?.fps ?? this.getFrameSequenceFps(_definition)
            animatedSprite.loop = activePlayback?.loop ?? loop
            animatedSprite.animationSpeed = fps / 60
            animatedSprite.gotoAndPlay(0)
            ; (animatedSprite as PIXI.AnimatedSprite & { _shouldPlay?: boolean })._shouldPlay = true
        }
    }

    /**
     * v11.52: Stop frame animation and restore still frame
     */
    private stopFrameSequenceAnimations(): void {
        const animatedSprite = this.findAnimatedSprite()
        if (animatedSprite) {
            ; (animatedSprite as PIXI.AnimatedSprite & { _shouldPlay?: boolean })._shouldPlay = false
            this.stopAndRestoreAnimatedSprite(animatedSprite)
        }
    }

    /**
     * Stop AnimatedSprite and restore still frame
     */
    private stopAndRestoreAnimatedSprite(animatedSprite: PIXI.AnimatedSprite): void {
        animatedSprite.stop()
        if (animatedSprite.textures.length === 0) return

        if (this.stillFrameConfig && this.textureGetter) {
            restoreAnimatedSpriteStillFrame(animatedSprite, this.stillFrameConfig, this.textureGetter)
        } else {
            const safeIndex = Math.min(Math.max(0, this.stillFrameIndex), animatedSprite.textures.length - 1)
            animatedSprite.gotoAndStop(safeIndex)
        }
    }

    /**
     * v11.52: Set still frame config
     * Used for props/backgrounds to configure still frame during render
     */
    setStillFrameConfig(config: StillFrameConfig, textureGetter?: TextureGetter): void {
        this.stillFrameConfig = config
        if (textureGetter) {
            this.textureGetter = textureGetter
        }
        if (config.stillFrameIndex !== undefined) {
            this.stillFrameIndex = config.stillFrameIndex
        }
    }

    /**
     * v11.52: Set still frame index (simplified version)
     */
    setStillFrameIndex(index: number): void {
        this.stillFrameIndex = index
    }

    /**
     * v11.52: Load still frame config from Store
     * Automatically retrieves from propStore or backgroundStore according to objectType
     */
    private loadStillFrameConfigFromStore(): void {
        if (!this.objectType || !this.objectId) return

        if (this.objectType === 'prop') {
            // Lazy import to avoid circular dependency
            void import('@/stores/propStore').then(({ usePropStore }) => {
                const propStore = usePropStore()
                const prop = propStore.getProp(this.objectId!)
                if (prop) {
                    this.stillFrameConfig = {
                        stillFrameSource: prop.stillFrameSource,
                        stillFrameIndex: prop.stillFrameIndex,
                        url: prop.stillFrameSource === 'custom' ? prop.stillFrameCustomUrl : undefined,
                    }
                    if (prop.stillFrameIndex !== undefined) {
                        this.stillFrameIndex = prop.stillFrameIndex
                    }
                }
            })
        } else if (this.objectType === 'background') {
            void import('@/stores/backgroundStore').then(({ useBackgroundStore }) => {
                const backgroundStore = useBackgroundStore()
                const bg = backgroundStore.getBackground(this.objectId!)
                if (bg) {
                    this.stillFrameConfig = {
                        stillFrameSource: bg.stillFrameSource,
                        stillFrameIndex: bg.stillFrameIndex,
                        url: bg.stillFrameSource === 'custom' ? bg.stillFrameCustomUrl : undefined,
                    }
                    if (bg.stillFrameIndex !== undefined) {
                        this.stillFrameIndex = bg.stillFrameIndex
                    }
                }
            })
        }
    }

    /**
     * Apply effect
     */
    private applyEffect(effect: EffectTrackOutput): void {
        const effectType = effect.effectType
        if (!effectType) return

        if (effect.active === false) {
            if (effectType === 'glow' && this.glowFilter) {
                this.removeFilter(this.glowFilter)
                this.glowFilter = null
            }
            if (effectType === 'motion_blur' && this.motionBlurFilter) {
                this.removeFilter(this.motionBlurFilter)
                this.motionBlurFilter = null
            }
            if (effectType === 'wave') {
                // v12.1: Add isContainerUsable check to prevent accessing position when container is destroyed
                if (this.isContainerUsable(this.target)) {
                    this.waveEffect.removeEffect('_root', this.target)
                }
                if (this.compositeTarget) {
                    const outputContainer = this.compositeTarget.getOutputContainer()
                    if (this.isContainerUsable(outputContainer)) {
                        this.waveEffect.removeEffect('_composite', outputContainer)
                    }
                }
            }
            if (effectType === 'ribbon') {
                // v12.1: Add isContainerUsable check
                if (this.isContainerUsable(this.target)) {
                    this.ribbonEffect.removeEffect('_root', this.target)
                }
                if (this.compositeTarget) {
                    const outputContainer = this.compositeTarget.getOutputContainer()
                    if (this.isContainerUsable(outputContainer)) {
                        this.ribbonEffect.removeEffect('_composite', outputContainer)
                    }
                }
            }
            return
        }

        const params = effect.effectParams as unknown as Record<string, unknown>

        switch (effectType) {
            case 'glow':
                this.applyGlowEffect(params)
                break
            case 'motion_blur':
                this.applyMotionBlurEffect(params)
                break
            case 'wave':
                // Wave uses WaveEffect service
                this.applyWaveEffect(params)
                break
            case 'ribbon':
                // Ribbon uses RibbonEffect service (fixed head, floating tail)
                this.applyRibbonEffect(params)
                break
            case 'breathe':
            case 'float':
            case 'shake':
            case 'squash':
            case 'jelly':
            case 'petrify':
            case 'shatter':
                // These effects calculate deltas via DynamicEffectManager, merged into Transform in applyOutputs
                break
        }
    }

    private evaluateDynamicEffectDeltas(effect: EffectTrackOutput) {
        const params = effect.effectParams
        const effectType = effect.effectType
        if (!effectType) return null
        if (effect.active === false) {
            this.effectManager.pauseEffect(`dyn_${effectType}`)
            return null
        }

        // v11.70: jelly/squash uses progress-driven mode, directly using precalculated results
        // No longer calculated through effectManager, avoiding absolute time dependency
        if (effectType === 'jelly' || effectType === 'squash') {
            // Use precalculated result in EffectTrackOutput
            if (effect.deltaScaleX !== undefined || effect.deltaScaleY !== undefined) {
                return {
                    deltaScaleX: effect.deltaScaleX,
                    deltaScaleY: effect.deltaScaleY,
                    deltaX: effect.deltaX,
                    deltaY: effect.deltaY,
                    deltaRotation: effect.deltaRotation,
                    deltaAlpha: undefined as number | undefined
                }
            }
            // Fallback: If no precalculated result, use effectManager (backward compatibility)
            const effectId = `dyn_${effectType}`
            this.effectManager.addEffect(effectId, params)
            return this.effectManager.evaluate(effectId)
        }

        if (
            effectType !== 'breathe' &&
            effectType !== 'float' &&
            effectType !== 'shake'
        ) {
            return null
        }

        const effectId = `dyn_${effectType}`
        this.effectManager.addEffect(effectId, params)
        return this.effectManager.evaluate(effectId)
    }

    /**
     * Apply Glow effect
     */
    private applyGlowEffect(params: Record<string, unknown>): void {
        const rawColor = params['color'] as string | number | undefined
        const intensity = params['intensity'] as number | undefined
        const size = params['size'] as number | undefined
        const color = typeof rawColor === 'string'
            ? parseInt(rawColor.replace('#', ''), 16)
            : rawColor

        if (!this.glowFilter) {
            this.glowFilter = new GlowFilter({
                color: color ?? 0xffffff,
                outerStrength: intensity ?? 2,
                distance: size ?? 4,
                quality: 0.5
            })
            this.addFilter(this.glowFilter)
        } else {
            if (color !== undefined) this.glowFilter.color = color
            if (intensity !== undefined) this.glowFilter.outerStrength = intensity
            if (size !== undefined) (this.glowFilter as unknown as { distance: number }).distance = size
        }
    }

    /**
     * Apply MotionBlur effect
     */
    private applyMotionBlurEffect(params: Record<string, unknown>): void {
        const velocityX = params['velocityX'] as number | undefined
        const velocityY = params['velocityY'] as number | undefined
        const velocity = params['velocity'] as number | undefined
        const angleDeg = params['angle'] as number | undefined
        const kernelSize = params['kernelSize'] as number | undefined

        let vx = velocityX ?? 0
        let vy = velocityY ?? 0

        if ((velocityX === undefined || velocityY === undefined) && velocity !== undefined) {
            const rad = ((angleDeg ?? 0) * Math.PI) / 180
            vx = Math.cos(rad) * velocity
            vy = Math.sin(rad) * velocity
        }

        if (!this.motionBlurFilter) {
            this.motionBlurFilter = new MotionBlurFilter([vx, vy], kernelSize ?? 5)
            this.addFilter(this.motionBlurFilter)
        } else if (kernelSize !== undefined) {
            this.motionBlurFilter.kernelSize = kernelSize
        }

        this.motionBlurFilter.velocity.x = vx
        this.motionBlurFilter.velocity.y = vy
    }

    /**
     * Apply Wave effect
     * v11.60: Use compositeSprite directly in offscreen mode
     */
    private applyWaveEffect(params: Record<string, unknown>): void {
        const speed = params['speed'] as number ?? 1.0
        const amplitude = params['amplitude'] as number ?? 10
        const frequency = params['frequency'] as number ?? 1.0

        // v11.60: In offscreen mode, Wave is applied to compositeSprite
        if (this.compositeTarget) {
            this.compositeTarget.updateRenderTexture()
            const compositeSprite = this.compositeTarget.getCompositeSprite()
            const outputContainer = this.compositeTarget.getOutputContainer()
            this.waveEffect.applyEffect('_composite', compositeSprite, outputContainer, { speed, amplitude, frequency })
        } else {
            // Non-offscreen mode: Find first Sprite child
            const sprite = this.findSprite()
            if (!sprite) return
            this.waveEffect.applyEffect('_root', sprite, this.target, { speed, amplitude, frequency })
        }
    }

    /**
     * Apply Ribbon effect (streamer)
     * Head stays nearly still while tail floats significantly
     */
    private applyRibbonEffect(params: Record<string, unknown>): void {
        const speed = params['speed'] as number ?? 1.0
        const amplitude = params['amplitude'] as number ?? 15
        const frequency = params['frequency'] as number ?? 2
        const damping = params['damping'] as number ?? 2.0
        const phaseScale = params['phaseScale'] as number ?? 1.5

        if (this.compositeTarget) {
            this.compositeTarget.updateRenderTexture()
            const compositeSprite = this.compositeTarget.getCompositeSprite()
            const outputContainer = this.compositeTarget.getOutputContainer()
            this.ribbonEffect.applyEffect('_composite', compositeSprite, outputContainer, { speed, amplitude, frequency, damping, phaseScale })
        } else {
            const sprite = this.findSprite()
            if (!sprite) return
            this.ribbonEffect.applyEffect('_root', sprite, this.target, { speed, amplitude, frequency, damping, phaseScale })
        }
    }

    /**
     * Find Sprite in container
     */
    private findSprite(): PIXI.Sprite | null {
        for (const child of this.target.children) {
            if (child instanceof PIXI.Sprite) {
                return child
            }
        }
        return null
    }

    /**
     * Add Filter
     */
    private addFilter(filter: PIXI.Filter): void {
        const target = this.getFilterTarget()
        const filters = target.filters ?? []
        filters.push(filter)
        target.filters = filters
    }

    /**
     * Remove all Filters
     */
    private removeAllFilters(): void {
        if (this.glowFilter) {
            this.removeFilter(this.glowFilter)
            this.glowFilter = null
        }
        if (this.motionBlurFilter) {
            this.removeFilter(this.motionBlurFilter)
            this.motionBlurFilter = null
        }

        // Clean up Wave
        if (this.isContainerUsable(this.target)) {
            this.waveEffect.removeEffect('_root', this.target)
            this.ribbonEffect.removeEffect('_root', this.target)
        }
        if (this.compositeTarget) {
            const outputContainer = this.compositeTarget.getOutputContainer()
            if (this.isContainerUsable(outputContainer)) {
                this.waveEffect.removeEffect('_composite', outputContainer)
                this.ribbonEffect.removeEffect('_composite', outputContainer)
            }
        }
    }

    /**
     * Remove single Filter
     */
    private removeFilter(filter: PIXI.Filter): void {
        const target = this.getFilterTarget()
        if (!this.isContainerUsable(target)) return
        const filters = target.filters
        if (!filters) return

        const index = filters.indexOf(filter)
        if (index >= 0) {
            filters.splice(index, 1)
            target.filters = filters.length > 0 ? filters : null
        }
    }

    /**
     * Check if any animation is playing
     */
    hasPlayingAnimations(): boolean {
        for (const player of this.players.values()) {
            if (player.isPlaying) return true
        }
        return false
    }

    /**
     * Destroy
     */
    destroy(): void {
        this.stopAllAnimations()
        this.players.clear()
        this.effectManager.clear()

        // v11.60: Destroy offscreen composite target
        if (this.compositeTarget) {
            this.compositeTarget.destroy()
            this.compositeTarget = null
        }
    }

    /**
     * v11.60: Get output container
     * In offscreen mode, returns output container of CompositeRenderTarget
     * In non-offscreen mode, returns original target container
     */
    getOutputContainer(): PIXI.Container {
        if (this.compositeTarget) {
            return this.compositeTarget.getOutputContainer()
        }
        return this.target
    }

    private isContainerUsable(container: PIXI.Container | null | undefined): container is PIXI.Container {
        if (!container) return false
        const anyContainer = container as unknown as { destroyed?: boolean; transform?: unknown }
        if (anyContainer.destroyed) return false
        return !!anyContainer.transform
    }

    /**
     * v11.60: Check if offscreen composite mode is enabled
     */
    isCompositeMode(): boolean {
        return this.compositeMode && this.compositeTarget !== null
    }
}

/**
 * Factory function to create GenericAnimationPlayer
 * @param targetOrConfig Container or complete configuration object
 */
export function createGenericAnimationPlayer(
    targetOrConfig: PIXI.Container | GenericAnimationPlayerConfig
): GenericAnimationPlayer {
    if (targetOrConfig instanceof PIXI.Container) {
        // Backward compatibility: Only Container passed in
        return new GenericAnimationPlayer({ target: targetOrConfig })
    }
    return new GenericAnimationPlayer(targetOrConfig)
}

