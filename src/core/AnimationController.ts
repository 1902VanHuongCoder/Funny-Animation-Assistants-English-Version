/**
 * AnimationController — Unified animation control module
 *
 * Extracts shared animation control logic from ScenePlayer.vue and FrameCapture.ts,
 * eliminating code duplication between the two rendering engines.
 *
 * Design principles:
 * - Abstracts engine differences via AnimationHost interface (player registries, asset lookup, etc.)
 * - Centralizes all animation command handling logic in this module
 * - Injects engine-specific behavior (e.g. FrameCapture's _shouldPlay) via onAnimationTriggered hook
 * - v16: Unified getAnimationDefinition(objectId, animName) signature, removing hardcoded three-way branching
 *
 * Responsibilities:
 * - processSetAnimActions()        — Object-level set_anim action handling
 * - processAutoStopOnBlockEnd()    — Automatically stop animations on Block end
 * - processInitialAnimationStates() — Apply initial animation states
 */

import type * as PIXI from 'pixi.js'

import type { GenericAnimationPlayer } from '@/core/GenericAnimationPlayer'
import type {
    AnimationDefinition,
    AnimationPlayParams,
    AnimationTimingMode,
} from '@/types/animation'
import type { SceneObject } from '@/types/sceneObject'
import type {
    Action,
    RuntimeSlot,
    SetAnimAction,
} from '@/types/screenplay'
import type { TTSTimingFile } from '@/utils/ttsTiming'

// ============================================================================
// Types
// ============================================================================

/**
 * AnimationHost interface
 *
 * Implemented by rendering engines (ScenePlayer / FrameCapture) to expose
 * their player registry and asset lookup capabilities to AnimationController.
 */
export interface AnimationHost {
    // ─── Player registry access ───
    getAnimationPlayer(objectId: string): GenericAnimationPlayer | null
    getObjectContainer(objectId: string): PIXI.Container | null

    // ─── Scene data access ───
    getSceneObjects(): SceneObject[]

    // ─── Animation definition resolution ───
    // v16: Unified signature to retrieve animation definition by objectId
    // Host is responsible for deciding lookup strategy (object-level animations field, resource-level store, implicit frame animations, etc.)
    getAnimationDefinition(
        objectId: string,
        animName: string,
    ): AnimationDefinition | null

    /**
     * Host-specific post-play hook
     *
     * FrameCapture uses this hook to set _shouldPlay flag and animationSpeed.
     * ScenePlayer does not need this hook (PIXI ticker automatically drives frame animations).
     *
     * @param objectId   Object ID
     * @param animName   Animation name
     * @param cmd        'play' | 'stop'
     */
    onAnimationTriggered?(
        objectId: string,
        animName: string,
        cmd: 'play' | 'stop',
    ): void
}

export interface AnimationControlContext {
    blockId?: string
    ttsTiming?: TTSTimingFile | null | undefined
}

type SetAnimItem = SetAnimAction['params']['animations'][number]

// ============================================================================
// Helper Functions (shared pure logic)
// ============================================================================

/**
 * Get Action start time within Block
 */
export function getActionStartTime(action: Action, slots: RuntimeSlot[]): number {
    if (!slots || slots.length === 0) return 0
    const slot = slots[action.slotIndex]
    return slot ? slot.startTime : 0
}

/**
 * Check if animation definition contains Auto Duration tracks
 */
export function hasAutoDuration(
    definition: { type?: string; tracks?: { trackType: string; duration?: number | 'auto' }[] },
): boolean {
    if (!definition.tracks) return false
    return definition.tracks.some(
        t => (t.trackType === 'transform' || t.trackType === 'visibility') && t.duration === 'auto',
    )
}

/**
 * Calculate runtime duration for Auto Duration
 *
 * Looks up matching stop action time within the same Block; if none, extends to Block end.
 */
export function calculateRuntimeDuration(
    blockActions: Action[],
    slots: RuntimeSlot[],
    blockDuration: number,
    targetId: string,
    animName: string,
    playStartTime: number,
): number {
    for (const action of blockActions) {
        if (action.type !== 'set_anim' || action.target !== targetId) continue
        const setAnimAction: SetAnimAction = action
        const actionTime = getActionStartTime(action, slots)
        if (actionTime <= playStartTime) continue
        const stopItem = setAnimAction.params.animations?.find(
            (item: { animName: string; action?: string }) =>
                item.animName === animName && item.action === 'stop',
        )
        if (stopItem) {
            const duration = actionTime - playStartTime
            return duration > 0 ? duration : 1000
        }
    }
    const duration = blockDuration - playStartTime
    return duration > 0 ? duration : 1000
}

function isTimeInSegments(
    segments: { startMs: number; endMs: number }[] | undefined,
    currentTime: number,
): boolean {
    if (!segments || segments.length === 0) return false
    return segments.some(segment =>
        currentTime >= segment.startMs && currentTime < segment.endMs,
    )
}

function resolveAnimationTimingMode(
    animItem: SetAnimItem,
    definition: AnimationDefinition | null,
): AnimationTimingMode {
    return animItem.timingMode ?? definition?.timingMode ?? 'continuous'
}

function findNextStopTime(
    blockActions: Action[],
    slots: RuntimeSlot[],
    targetId: string,
    animName: string,
    playStartTime: number,
    blockDuration: number,
): number {
    for (const action of blockActions) {
        if (action.type !== 'set_anim' || action.target !== targetId) continue
        const actionTime = getActionStartTime(action, slots)
        if (actionTime <= playStartTime) continue
        const hasStop = action.params.animations?.some(
            item => item.animName === animName && item.action === 'stop',
        )
        if (hasStop) return actionTime
    }
    return blockDuration
}

// ============================================================================
// AnimationController
// ============================================================================

export class AnimationController {
    private host: AnimationHost
    private triggeredAnimations: Set<string>
    private deferredInitialAnimationObjectIds = new Set<string>()
    private ttsGatedAnimationStates = new Map<string, { playing: boolean }>()

    constructor(host: AnimationHost, triggeredAnimations: Set<string>) {
        this.host = host
        this.triggeredAnimations = triggeredAnimations
    }

    /**
     * Update host reference (used by engines when switching scenes to update registries)
     */
    updateHost(host: AnimationHost): void {
        this.host = host
    }

    /**
     * Reset trigger records (used on Block switch or replay)
     */
    resetTriggeredAnimations(): void {
        this.triggeredAnimations.clear()
        this.ttsGatedAnimationStates.clear()
    }

    // ════════════════════════════════════════════════════════════════════════
    // Unified Player Retrieval — Eliminates type-based branching if/else
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Get corresponding GenericAnimationPlayer for object
     *
     * Unifies player retrieval logic for prop/background/symbol etc.
     */
    private getPlayerForObject(objSetup: SceneObject): GenericAnimationPlayer | null {
        return this.host.getAnimationPlayer(objSetup.id)
    }

    // ════════════════════════════════════════════════════════════════════════
    // processSetAnimActions — Unified set_anim action handling
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Process all set_anim actions in Block
     *
     * Corresponds to ScenePlayer.applyAnimationControl + FrameCapture.updateAnimationStates
     */
    processSetAnimActions(
        blockActions: Action[],
        slots: RuntimeSlot[],
        currentTime: number,
        blockDuration: number,
        context: AnimationControlContext = {},
    ): void {
        // Object-level animation processing
        const setupObjects = this.host.getSceneObjects()
        for (const objSetup of setupObjects) {
            const targetId = objSetup.id
            const animActions = blockActions.filter(
                (a): a is SetAnimAction =>
                    a.type === 'set_anim' && a.target === targetId,
            )
            if (animActions.length === 0) continue

            // v16: Unified dispatch without distinguishing character/prop/background
            this.processObjectAnimActions(
                objSetup, animActions, slots, currentTime, blockActions, blockDuration, context,
            )
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // processAutoStopOnBlockEnd — Automatically stop animations on Block end
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Automatically stop animations with autoStopOnBlockEnd !== false when Block ends
     */
    processAutoStopOnBlockEnd(blockActions: Action[]): void {
        const setAnimActions = blockActions.filter(
            (a): a is SetAnimAction => a.type === 'set_anim',
        )

        for (const action of setAnimActions) {
            const targetId = action.target

            for (const anim of action.params.animations || []) {
                const shouldAutoStop = anim.autoStopOnBlockEnd !== false
                if (!shouldAutoStop) continue

                // Only stop animations with play action
                if (anim.action === 'stop') continue

                const animName = anim.animName
                this.stopObjectAnimation(targetId, animName)
                this.clearTTSGatedState(targetId, animName)
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // processInitialAnimationStates — Apply initial animation states
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Apply initial animation states for all objects in the scene
     *
     * Corresponds to ScenePlayer.applyInitialAnimationStates + FrameCapture.applyInitialAnimationStates
     */
    processInitialAnimationStates(): void {
        this.deferredInitialAnimationObjectIds.clear()
        const setupObjects = this.host.getSceneObjects()

        // v16: Unified initial animation handling without branching by type
        for (const objSetup of setupObjects) {
            this.applyObjectInitialAnimations(objSetup)
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Private: Object-level animation handling (v16: unified, removing three-way branch)
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Unified object-level animation action handling
     *
     * v16: Merged processCharacterAnimActions + processGenericAnimActions.
     * Characters still play via CharacterSprite independent API, others via GenericAnimationPlayer.
     * Animation definitions are uniformly retrieved via host.getAnimationDefinition(objectId, animName).
     */
    private processObjectAnimActions(
        objSetup: SceneObject,
        animActions: SetAnimAction[],
        slots: RuntimeSlot[],
        currentTime: number,
        blockActions: Action[],
        blockDuration: number,
        context: AnimationControlContext,
    ): void {
        // Uniformly use GenericAnimationPlayer
        const player = this.getPlayerForObject(objSetup)
        const container = this.host.getObjectContainer(objSetup.id)
        for (const action of animActions) {
            const actionStartTime = getActionStartTime(action, slots)
            if (actionStartTime > currentTime) continue

            for (const animItem of action.params.animations || []) {
                const animName = animItem.animName
                const cmd = animItem.action ?? 'play'
                const triggerKey = `${objSetup.id}:${animName}:${actionStartTime}:${cmd}`

                if (cmd === 'play') {
                    // v21: TTS speech segment gated mode requires continuous switching based on current frame state after action activates,
                    // cannot use the one-off triggeredAnimations mechanism.
                    const definition = this.host.getAnimationDefinition(objSetup.id, animName)
                    const timingMode = resolveAnimationTimingMode(animItem, definition)
                    if (timingMode === 'tts_speech') {
                        if (context.ttsTiming === undefined) {
                            continue
                        }
                        if (context.ttsTiming) {
                            this.processTTSSpeechGatedPlay(
                                objSetup,
                                animItem,
                                action,
                                actionStartTime,
                                currentTime,
                                blockActions,
                                slots,
                                blockDuration,
                                context,
                                definition,
                            )
                            continue
                        }
                        // When timing is confirmed absent, fall back to continuous playback.
                    }

                    if (this.triggeredAnimations.has(triggerKey)) continue

                    this.playObjectAnimation(
                        objSetup,
                        animItem,
                        action,
                        actionStartTime,
                        blockActions,
                        slots,
                        blockDuration,
                        definition,
                        player,
                        container,
                    )
                    this.triggeredAnimations.add(triggerKey)
                    this.host.onAnimationTriggered?.(
                        objSetup.id, animName, 'play',
                    )
                } else if (cmd === 'stop') {
                    if (!this.triggeredAnimations.has(triggerKey)) {
                        this.stopObjectAnimation(objSetup.id, animName)
                        this.clearTTSGatedState(objSetup.id, animName)
                        this.triggeredAnimations.add(triggerKey)
                        this.host.onAnimationTriggered?.(
                            objSetup.id, animName, 'stop',
                        )
                    }
                }
            }
        }
    }

    private processTTSSpeechGatedPlay(
        objSetup: SceneObject,
        animItem: SetAnimItem,
        action: SetAnimAction,
        actionStartTime: number,
        currentTime: number,
        blockActions: Action[],
        slots: RuntimeSlot[],
        blockDuration: number,
        context: AnimationControlContext,
        definition: AnimationDefinition | null,
    ): void {
        const animName = animItem.animName
        const playEndTime = findNextStopTime(
            blockActions,
            slots,
            objSetup.id,
            animName,
            actionStartTime,
            blockDuration,
        )
        const gatedKey = this.getTTSGatedKey(context, objSetup.id, animName, actionStartTime)

        if (currentTime >= playEndTime) {
            return
        }

        const shouldPlay = isTimeInSegments(
            context.ttsTiming?.animationSpeechSegments,
            currentTime,
        )
        if (shouldPlay) {
            this.ensureTTSGatedPlaying(
                gatedKey,
                objSetup,
                animItem,
                action,
                actionStartTime,
                blockActions,
                slots,
                blockDuration,
                definition,
            )
        } else {
            this.ensureTTSGatedStopped(gatedKey, objSetup.id, animName)
        }
    }

    private ensureTTSGatedPlaying(
        gatedKey: string,
        objSetup: SceneObject,
        animItem: SetAnimItem,
        action: SetAnimAction,
        actionStartTime: number,
        blockActions: Action[],
        slots: RuntimeSlot[],
        blockDuration: number,
        definition: AnimationDefinition | null,
    ): void {
        const state = this.ttsGatedAnimationStates.get(gatedKey)
        if (state?.playing) return

        this.playObjectAnimation(
            objSetup,
            animItem,
            action,
            actionStartTime,
            blockActions,
            slots,
            blockDuration,
            definition,
            this.getPlayerForObject(objSetup),
            this.host.getObjectContainer(objSetup.id),
        )
        this.ttsGatedAnimationStates.set(gatedKey, { playing: true })
        this.host.onAnimationTriggered?.(objSetup.id, animItem.animName, 'play')
    }

    private ensureTTSGatedStopped(
        gatedKey: string,
        targetId: string,
        animName: string,
    ): void {
        const state = this.ttsGatedAnimationStates.get(gatedKey)
        if (state?.playing === false) return

        this.stopObjectAnimation(targetId, animName)
        this.ttsGatedAnimationStates.set(gatedKey, { playing: false })
        this.host.onAnimationTriggered?.(targetId, animName, 'stop')
    }

    private playObjectAnimation(
        objSetup: SceneObject,
        animItem: SetAnimItem,
        action: SetAnimAction,
        actionStartTime: number,
        blockActions: Action[],
        slots: RuntimeSlot[],
        blockDuration: number,
        definition: AnimationDefinition | null,
        player: GenericAnimationPlayer | null,
        container: PIXI.Container | null,
    ): void {
        const animName = animItem.animName
        if (definition) {
            // Track animation -> play directly
            const playParams: AnimationPlayParams = {
                loop: animItem.loop ?? definition.loop,
                reset: action.params.reset ?? true,
            }
            if (hasAutoDuration(definition)) {
                playParams.runtimeDuration = calculateRuntimeDuration(
                    blockActions, slots, blockDuration,
                    objSetup.id, animName, actionStartTime,
                )
            }
            if (player) {
                player.playAnimation(animName, definition, playParams)
            }
        } else if (objSetup.type === 'prop' && container) {
            // Fallback: direct AnimatedSprite control (prop specific)
            this.fallbackPlayPropSprite(container, objSetup)
        }
    }

    private getTTSGatedKey(
        context: AnimationControlContext,
        targetId: string,
        animName: string,
        actionStartTime: number,
    ): string {
        return `${context.blockId ?? 'block'}:${targetId}:${animName}:${actionStartTime}`
    }

    private clearTTSGatedState(targetId: string, animName: string): void {
        const prefix = ':'
        for (const key of [...this.ttsGatedAnimationStates.keys()]) {
            if (key.includes(`${prefix}${targetId}:${animName}:`)) {
                this.ttsGatedAnimationStates.delete(key)
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Private: Stop object animation (used by autoStop)
    // ════════════════════════════════════════════════════════════════════════

    private stopObjectAnimation(targetId: string, animName: string): void {
        const setupObjects = this.host.getSceneObjects()
        const objSetup = setupObjects.find((o: SceneObject) => o.id === targetId)
        if (!objSetup) return

        // Unified handling: via Player or Prop fallback
        const player = this.getPlayerForObject(objSetup)
        if (player) {
            player.stopAnimation(animName)
        } else if (objSetup.type === 'prop') {
            const container = this.host.getObjectContainer(objSetup.id)
            if (container) this.fallbackStopPropSprite(container)
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Private: Apply initial animation states
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Unified initial animation application
     *
     * v16: Merged applyCharacterInitialAnimations + applyPropInitialAnimations + applyGenericInitialAnimations.
     * Eliminates as unknown as assertions, directly uses SceneObjectBase.initialAnimations.
     */
    private applyObjectInitialAnimations(objSetup: SceneObject): void {
        // SceneObjectBase already has initialAnimations field, no assertion needed
        const animItems = this.parseInitialAnimationItems(objSetup.initialAnimations)

        if (animItems.length === 0) {
            // No initial animations — notify host to stop (prop needs to restore stillFrame)
            this.deferredInitialAnimationObjectIds.delete(objSetup.id)
            if (objSetup.type === 'prop') {
                this.host.onAnimationTriggered?.(objSetup.id, '_initial', 'stop')
            }
            return
        }

        if (!this.canStartInitialAnimations(objSetup)) {
            this.deferredInitialAnimationObjectIds.add(objSetup.id)
            if (objSetup.type === 'prop') {
                this.host.onAnimationTriggered?.(objSetup.id, '_initial', 'stop')
            }
            return
        }

        this.startInitialAnimationsForObject(objSetup, animItems)
    }

    private processDeferredInitialAnimations(): void {
        if (this.deferredInitialAnimationObjectIds.size === 0) return

        for (const objectId of [...this.deferredInitialAnimationObjectIds]) {
            const objSetup = this.host.getSceneObjects().find((o: SceneObject) => o.id === objectId)
            if (!objSetup) {
                this.deferredInitialAnimationObjectIds.delete(objectId)
                continue
            }

            const animItems = this.parseInitialAnimationItems(objSetup.initialAnimations)
            if (animItems.length === 0) {
                this.deferredInitialAnimationObjectIds.delete(objectId)
                continue
            }

            if (!this.canStartInitialAnimations(objSetup)) continue

            this.startInitialAnimationsForObject(objSetup, animItems)
        }
    }

    /**
     * Synchronize and start initial animations that were previously deferred due to spawned=false / visible=false,
     * immediately after layout/visibility updates.
     */
    syncDeferredInitialAnimations(): void {
        this.processDeferredInitialAnimations()
    }

    private parseInitialAnimationItems(initialAnims: SceneObject['initialAnimations']): { name: string; loop: boolean }[] {
        const animItems: { name: string; loop: boolean }[] = []
        if (!Array.isArray(initialAnims)) return animItems

        if (initialAnims.length > 0 && typeof initialAnims[0] === 'string') {
            for (const name of initialAnims as unknown as string[]) {
                animItems.push({ name, loop: true })
            }
            return animItems
        }

        for (const item of initialAnims) {
            if (item?.name) animItems.push({ name: item.name, loop: item.loop ?? true })
        }

        return animItems
    }

    private canStartInitialAnimations(objSetup: SceneObject): boolean {
        const runtimeState = this.host.getSceneObjects().find((o: SceneObject) => o.id === objSetup.id) ?? objSetup
        const container = this.host.getObjectContainer(objSetup.id)
        // For deferred initial animations, container visibility already reflects the final spawned + visible result.
        // In scene setup objSetup might still have initial spawned=false, which must not block deferred startup.
        if (container) return container.visible

        const spawned = (runtimeState as SceneObject & { spawned?: boolean }).spawned ?? true
        return spawned && runtimeState.visible !== false
    }

    private startInitialAnimationsForObject(
        objSetup: SceneObject,
        animItems: { name: string; loop: boolean }[],
    ): void {
        const player = this.getPlayerForObject(objSetup)

        for (const anim of animItems) {
            const definition = this.host.getAnimationDefinition(objSetup.id, anim.name)
            if (!definition) continue

            if (player) {
                player.playAnimation(anim.name, definition, {
                    loop: anim.loop,
                    speed: 1.0,
                    reset: true,
                })
            }
        }

        this.deferredInitialAnimationObjectIds.delete(objSetup.id)
        this.host.onAnimationTriggered?.(objSetup.id, '_initial', 'play')
    }

    // ════════════════════════════════════════════════════════════════════════
    // Private: AnimatedSprite fallback control (prop specific)
    // ════════════════════════════════════════════════════════════════════════

    private fallbackPlayPropSprite(
        container: PIXI.Container,
        objSetup: SceneObject,
    ): void {
        const animatedSprite = container.getChildByName('prop_animation') as
            | (PIXI.AnimatedSprite & { _shouldPlay?: boolean })
            | undefined
        if (!animatedSprite) return

        // Fallback logic: directly start AnimatedSprite
        // Specific fps/loop/playback behavior is handled by host's onAnimationTriggered
        // But if there is no hook, use default behavior
        if (!this.host.onAnimationTriggered) {
            // ScenePlayer path: directly gotoAndPlay
            if (!animatedSprite.playing) {
                animatedSprite.loop = true
                animatedSprite.gotoAndPlay(0)
            }
        }
        // FrameCapture path is handled by onAnimationTriggered
        void objSetup // Use objSetup to avoid lint warning (fps retrieved via hook)
    }

    private fallbackStopPropSprite(container: PIXI.Container): void {
        const animatedSprite = container.getChildByName('prop_animation') as
            | (PIXI.AnimatedSprite & { _shouldPlay?: boolean })
            | undefined
        if (!animatedSprite) return

        if (!this.host.onAnimationTriggered) {
            // ScenePlayer path
            if (animatedSprite.playing) {
                animatedSprite.gotoAndStop(0)
            }
        }
        // FrameCapture path is handled by onAnimationTriggered
    }
}
