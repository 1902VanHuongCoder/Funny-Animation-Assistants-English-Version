/**
 * Unified Scene Object Renderer
 *
 * Extracts shared rendering logic across 4 engines (useSceneGraph, ScenePlayer, ActionPreviewDialog, FrameCapture),
 * eliminating duplicated code.
 *
 * Responsibilities:
 * 1. Create PIXI containers from SceneObject (props/backgrounds/characters)
 * 2. Apply runtime state to existing containers (applyObjectState)
 *
 * Non-responsibilities:
 * - GenericAnimationPlayer creation (depends on each engine's renderer instance)
 * - Interaction layer logic (dragging, selection highlighting — editor specific)
 * - Audio objects (no PIXI rendering content)
 */

import * as PIXI from 'pixi.js'

import { CAMERA_BASE_HEIGHT, CAMERA_BASE_WIDTH, CANVAS_HEIGHT, CANVAS_WIDTH } from '@/constants/canvas'
import { Z_INDEX_CAMERA_OVERLAY, Z_INDEX_LIGHT_OVERLAY } from '@/constants/zIndex'
import type { useBackgroundStore } from '@/stores/backgroundStore'
import type { useExpressionStore } from '@/stores/expressionStore'
import type { usePropStore } from '@/stores/propStore'
import type { CameraObject, CompositeObject, LightObject, SceneObject, ScreenEffectObject, ScreenEffectParams, SymbolObject } from '@/types/sceneObject'
import type { RuntimeCameraState } from '@/utils/actionEvaluator'
import { restoreAnimatedSpriteStillFrame } from '@/utils/animationUtils'
import { drawScreenEffectGraphics } from '@/utils/screenEffectRenderer'
import { getAutoTextLeading, normalizeTextContent, resolveTextGradient, resolveTextLineHeight } from '@/utils/textUtils'

import type { TextureProvider } from './TextureProvider'

// ============================================================================
// Types
// ============================================================================

/** Store references collection */
export interface RenderStores {
    propStore: ReturnType<typeof usePropStore>
    backgroundStore: ReturnType<typeof useBackgroundStore>
    expressionStore: ReturnType<typeof useExpressionStore>
}

/** Object dimensions and pivot information */
export interface ObjectDimensions {
    width: number
    height: number
    pivotX?: number
    pivotY?: number
    boundsX?: number
    boundsY?: number
}

/**
 * Object state host interface
 *
 * applyObjectState depends on engine-specific caching (objectDimensions).
 * Engines bridge these caches to the unified renderer by implementing this interface,
 * avoiding SceneObjectRenderer directly holding engine state.
 */
export interface ObjectStateHost {
    /** Get object dimensions cache */
    getObjectDimensions(objectId: string): ObjectDimensions | undefined
    /** Set object dimensions cache */
    setObjectDimensions(objectId: string, dims: ObjectDimensions): void
    /** Check if object is currently being interacted with (drag/scale/rotate); if so, skip writing transforms to avoid race-condition overwrite */
    isInteractionLocked?(objectId: string): boolean
}

const GROUND_SHADOW_NAME = '__ground_shadow_ellipse'

function supportsCastShadow(state: SceneObject): boolean {
    if (state.type === 'prop' || state.type === 'symbol' || state.type === 'expression') return true
    if (state.type === 'composite') {
        return (state as CompositeObject).compositeMode === 'entity'
    }
    return false
}

function getLocalBoundsIgnoringGroundShadow(container: PIXI.Container): PIXI.Rectangle {
    const shadow = container.getChildByName(GROUND_SHADOW_NAME)
    if (!shadow) {
        return container.getLocalBounds()
    }

    const prevVisible = shadow.visible
    const prevRenderable = shadow.renderable
    shadow.visible = false
    shadow.renderable = false
    const bounds = container.getLocalBounds()
    shadow.visible = prevVisible
    shadow.renderable = prevRenderable
    return bounds
}

// ============================================================================
// SceneObjectRenderer
// ============================================================================

export class SceneObjectRenderer {
    private textureProvider: TextureProvider
    private stores: RenderStores

    constructor(textureProvider: TextureProvider, stores: RenderStores) {
        this.textureProvider = textureProvider
        this.stores = stores
    }

    // --------------------------------------------------------------------------
    // Prop Rendering
    // --------------------------------------------------------------------------

    /**
     * Create prop PIXI container
     * Supports static props and frame animation props
     */
    createPropContainer(obj: SceneObject): PIXI.Container {
        const propData = this.stores.propStore.getProp(obj.refId)
        if (!propData) {
            throw new Error(`[SceneObjectRenderer] Prop data not found: refId=${obj.refId}`)
        }

        const container = new PIXI.Container()
        container.name = obj.id
        container.zIndex = obj.zIndex ?? 0

        // 1. Static prop
        if (propData.type === 'static' && propData.url) {
            const imageUrl = this.textureProvider.getImageUrl(propData.url)
            if (imageUrl) {
                const texture = this.textureProvider.getTexture(propData.url)
                const sprite = new PIXI.Sprite(texture)
                sprite.name = 'prop_sprite'
                sprite.anchor.set(0.5)
                container.addChild(sprite)
            }
        }
        // 2. Frame animation prop
        else if (propData.type === 'animation' && propData.frames && propData.frames.length > 0) {
            const textures: PIXI.Texture[] = []
            for (const frame of propData.frames) {
                if (frame.url) {
                    const tex = this.textureProvider.getTexture(frame.url)
                    textures.push(tex)
                }
            }
            if (textures.length > 0) {
                const animatedSprite = new PIXI.AnimatedSprite(textures)
                animatedSprite.name = 'prop_animation'
                animatedSprite.anchor.set(0.5)
                animatedSprite.animationSpeed = (propData.fps ?? 25) / 60
                animatedSprite.autoUpdate = false  // Manually advance to eliminate spawn frame latency
                // Use configured still frame
                restoreAnimatedSpriteStillFrame(animatedSprite, {
                    stillFrameSource: propData.stillFrameSource,
                    stillFrameIndex: propData.stillFrameIndex,
                    url: propData.stillFrameCustomUrl,
                }, (url: string) => this.textureProvider.getTexture(url))

                container.addChild(animatedSprite)
            }
        }

        return container
    }

    // --------------------------------------------------------------------------
    // Symbol Rendering (v16)
    // --------------------------------------------------------------------------

    /**
     * Create symbol PIXI container
     * Loads corresponding material texture according to currentMaterialId
     */
    createSymbolContainer(obj: SceneObject): PIXI.Container {
        const symbolObj = obj as SymbolObject
        const container = new PIXI.Container()
        container.name = obj.id
        container.zIndex = obj.zIndex ?? 0

        const materialId = symbolObj.currentMaterialId
        const material = materialId
            ? symbolObj.materials.find(m => m.id === materialId)
            : symbolObj.materials[0]

        if (!material) {
            // Draw placeholder when there is no material, ensuring visible and interactive on canvas
            const PLACEHOLDER_SIZE = 200
            const halfSize = PLACEHOLDER_SIZE / 2

            const graphics = new PIXI.Graphics()
            graphics.name = 'symbol_placeholder'

            // Translucent rounded rectangle background
            graphics.beginFill(0x3a3a4a, 0.85)
            graphics.drawRoundedRect(-halfSize, -halfSize, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, 16)
            graphics.endFill()

            // Dashed border effect
            graphics.lineStyle(3, 0x7a7a9a, 0.8)
            graphics.drawRoundedRect(-halfSize, -halfSize, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, 16)

            container.addChild(graphics)

            // Gear icon
            const iconText = new PIXI.Text('🔧', {
                fontSize: 48,
                fill: 0xcccccc,
            })
            iconText.anchor.set(0.5)
            iconText.position.set(0, -20)
            container.addChild(iconText)

            // "Symbol" label
            const labelText = new PIXI.Text(symbolObj.alias ?? symbolObj.name ?? 'Symbol', {
                fontFamily: 'Arial, sans-serif',
                fontSize: 18,
                fill: 0xaaaaaa,
                align: 'center',
            })
            labelText.anchor.set(0.5)
            labelText.position.set(0, 35)
            container.addChild(labelText)

            return container
        }

        if (material.type === 'static' && material.url) {
            const resolvedUrl = this.textureProvider.getImageUrl(material.url)
            const texture = this.textureProvider.getTexture(resolvedUrl || material.url)
            const sprite = new PIXI.Sprite(texture)
            sprite.name = 'symbol_sprite'
            sprite.anchor.set(0.5)
            container.addChild(sprite)
        } else if (material.type === 'animation' && material.frames && material.frames.length > 0) {
            const textures: PIXI.Texture[] = []
            for (const frame of material.frames) {
                if (frame.url) {
                    const fUrl = this.textureProvider.getImageUrl(frame.url)
                    textures.push(this.textureProvider.getTexture(fUrl || frame.url))
                }
            }
            if (textures.length > 0) {
                const animatedSprite = new PIXI.AnimatedSprite(textures)
                animatedSprite.name = 'symbol_animation'
                animatedSprite.anchor.set(0.5)
                animatedSprite.animationSpeed = (material.fps ?? 12) / 60
                animatedSprite.loop = material.loop ?? true
                animatedSprite.autoUpdate = false  // Manually advance to eliminate spawn frame latency

                // v16: Use configured still frame (consistent with props/backgrounds), do not auto-play
                restoreAnimatedSpriteStillFrame(animatedSprite, {
                    stillFrameSource: material.stillFrameSource,
                    stillFrameIndex: material.stillFrameIndex,
                    url: material.url,
                }, (url: string) => this.textureProvider.getTexture(url))
                container.addChild(animatedSprite)
            }
        }

        // v16: Record currently rendered material ID for change detection in applySymbolState
        const renderedId = material?.id ?? '__placeholder__'
            ; (container as PIXI.Container & { _renderedMaterialId?: string })._renderedMaterialId = renderedId

        return container
    }

    // --------------------------------------------------------------------------
    // Text Rendering (Text PRD Phase 0)
    // --------------------------------------------------------------------------

    /**
     * Create text PIXI container
     * Builds complete PIXI.TextStyle based on all TextObject properties
     */
    createTextContainer(obj: SceneObject): PIXI.Container {
        const textObj = obj as import('@/types/sceneObject').TextObject
        const container = new PIXI.Container()
        container.name = obj.id
        container.zIndex = obj.zIndex ?? 0

        const styleOpts = this.buildTextStyleOpts(textObj)

        // Phase 1: Vertical text branch
        if (textObj.writingMode === 'vertical') {
            const vertContainer = this.createVerticalTextLayout(textObj, styleOpts)
            vertContainer.name = 'text_vertical_group'
            container.addChild(vertContainer)
            this.syncTextBackground(container, textObj, vertContainer, textObj.textBoxMode ?? 'auto-size')
        } else {
            const style = new PIXI.TextStyle(styleOpts)
            const normalizedContent = normalizeTextContent(textObj.content ?? 'Text')
            const text = new PIXI.Text(normalizedContent, style)
            text.name = 'text_content'
            text.anchor.set(0.5)
            container.addChild(text)
            this.syncTextBackground(container, textObj, text, textObj.textBoxMode ?? 'auto-size')
        }

        return container
    }

    private syncTextBackground(
        container: PIXI.Container,
        textState: import('@/types/sceneObject').TextObject,
        contentNode: PIXI.Container | PIXI.Text | undefined,
        boxMode: 'auto-width' | 'auto-height' | 'auto-size' | 'fixed',
    ): void {
        const enabled = textState.textBackgroundEnabled === true
        const existing = container.getChildByName('text_background_fill') as PIXI.Graphics | undefined
        if (!enabled) {
            if (existing) {
                container.removeChild(existing)
                existing.destroy()
            }
            return
        }

        const bg = existing ?? new PIXI.Graphics()
        if (!existing) bg.name = 'text_background_fill'
        bg.clear()

        const colorHex = (textState.textBackgroundColor ?? '#000000').replace('#', '')
        const colorNum = Number.parseInt(colorHex, 16)
        const alpha = Math.max(0, Math.min(1, textState.textBackgroundAlpha ?? 0.35))
        const padX = Math.max(0, textState.textBackgroundPaddingX ?? 16)
        const padY = Math.max(0, textState.textBackgroundPaddingY ?? 10)
        const radius = Math.max(0, textState.textBackgroundRadius ?? 8)

        let width = 0
        let height = 0
        let cx = 0
        let cy = 0

        if (boxMode === 'fixed' && textState.width > 0 && textState.height > 0) {
            width = textState.width
            height = textState.height
        } else {
            const bounds = (contentNode ?? container).getLocalBounds()
            width = bounds.width + padX * 2
            height = bounds.height + padY * 2
            cx = bounds.x + bounds.width / 2
            cy = bounds.y + bounds.height / 2
        }

        if (width <= 0 || height <= 0) {
            if (existing) {
                container.removeChild(existing)
                existing.destroy()
            }
            return
        }

        bg.beginFill(Number.isNaN(colorNum) ? 0x000000 : colorNum, alpha)
        bg.drawRoundedRect(cx - width / 2, cy - height / 2, width, height, radius)
        bg.endFill()

        if (!existing) container.addChildAt(bg, 0)
    }

    /**
     * Phase 1: Create vertical text layout
     * Splits content into individual characters arranged along the Y axis, wrapping right-to-left when exceeding container height.
     * CJK punctuation marks (。，、！？) rotate automatically.
     */
    private createVerticalTextLayout(
        textObj: import('@/types/sceneObject').TextObject,
        styleOpts: Partial<PIXI.ITextStyle>,
    ): PIXI.Container {
        const group = new PIXI.Container()
        const content = normalizeTextContent(textObj.content ?? 'Text')
        const fontSize = textObj.fontSize ?? 72
        const lineHeight = resolveTextLineHeight(textObj.fontFamily, fontSize, textObj.lineHeight).lineHeight
        const columnGap = fontSize * 1.2
        const maxHeight = textObj.wordWrapWidth ?? 400 // In vertical writing, wordWrapWidth is reused as column height

        // Character set for CJK vertical punctuation that needs rotation
        const ROTATE_PUNCTUATION = new Set('。，、！？；：（）「」『』【】〈〉《》…—')

        let currentX = 0
        let currentY = 0

        for (let i = 0; i < content.length; i++) {
            const char = content[i]!
            if (char === '\n') {
                // Newline = wrap column (move left)
                currentX -= columnGap
                currentY = 0
                continue
            }

            const charText = new PIXI.Text(char, styleOpts)
            charText.anchor.set(0.5)
            charText.x = currentX
            charText.y = currentY

            // Rotate CJK punctuation
            if (ROTATE_PUNCTUATION.has(char)) {
                charText.rotation = Math.PI / 2
            }

            group.addChild(charText)
            currentY += lineHeight

            // Column height overflow, wrap column
            if (currentY >= maxHeight && i < content.length - 1) {
                currentX -= columnGap
                currentY = 0
            }
        }

        return group
    }

    // --------------------------------------------------------------------------
    // Background Rendering
    // --------------------------------------------------------------------------

    /**
     * Create background PIXI container
     * Supports static background and frame animation background, uses obj.width/height to control sprite size
     */
    createBackgroundContainer(obj: SceneObject): PIXI.Container {
        const background = this.stores.backgroundStore.getBackground(obj.refId)
        if (!background) {
            throw new Error(`[SceneObjectRenderer] Background data not found: refId=${obj.refId}`)
        }

        const container = new PIXI.Container()
        container.name = obj.id
        container.position.set(obj.x ?? 0, obj.y ?? 0)
        container.scale.set(obj.scaleX ?? 1, obj.scaleY ?? 1)
        container.zIndex = obj.zIndex ?? 0

        let spriteCreated = false

        // 1. Frame animation background
        if (background.type === 'animation' && background.frames && background.frames.length > 0) {
            const textures: PIXI.Texture[] = []
            for (const frame of background.frames) {
                const f = frame as { url?: string }
                if (f.url) {
                    const tex = this.textureProvider.getTexture(f.url)
                    textures.push(tex)
                }
            }

            if (textures.length > 0) {
                const animatedSprite = new PIXI.AnimatedSprite(textures)
                animatedSprite.name = 'bg_animation'
                animatedSprite.anchor.set(0, 0)
                animatedSprite.animationSpeed = (background.fps ?? 25) / 60
                animatedSprite.autoUpdate = false  // Manually advance to eliminate spawn frame latency

                // Use obj.width/height (precalculated by editor), fallback to texture raw dimensions if no data
                if (obj.width > 0 && obj.height > 0) {
                    animatedSprite.width = obj.width
                    animatedSprite.height = obj.height
                }

                // Use configured still frame
                restoreAnimatedSpriteStillFrame(animatedSprite, {
                    stillFrameSource: background.stillFrameSource,
                    stillFrameIndex: background.stillFrameIndex,
                    url: background.stillFrameCustomUrl,
                }, (url: string) => this.textureProvider.getTexture(url))

                container.addChild(animatedSprite)
                spriteCreated = true
            }
        }

        // 2. Static background (or fallback when frame animation has no frames)
        if (!spriteCreated) {
            const bgUrl = background.url ?? background.backgroundImage
            if (!bgUrl) {
                throw new Error(`[SceneObjectRenderer] Background missing image URL: refId=${obj.refId}`)
            }

            const texture = this.textureProvider.getTexture(bgUrl)
            const sprite = new PIXI.Sprite(texture)
            sprite.name = 'background_sprite'
            sprite.anchor.set(0, 0)

            // Use obj.width/height (precalculated by editor), fallback to texture raw dimensions if no data
            if (obj.width > 0 && obj.height > 0) {
                sprite.width = obj.width
                sprite.height = obj.height
            }

            container.addChild(sprite)
        }

        return container
    }



    // --------------------------------------------------------------------------
    // State Application (P0 Unified)
    // --------------------------------------------------------------------------

    /**
     * Apply runtime state to object container
     *
     * Unifies four-branch logic of ScenePlayer.applyObjectState and FrameCapture.applyObjectState.
     * character branch injects engine-specific cache via CharacterStateHost callback.
     *
     * composite children rendering order is determined by childIds insertion order (PIXI stable sort),
     * micro-offset mechanism not needed. Engines must ensure children are addChild-ed in childIds order.
     *
     * @returns Visual center position of object (for camera_follow calculation), some types may return null
     */
    applyObjectState(
        container: PIXI.Container,
        state: SceneObject,
        objSetup: SceneObject,
        host: ObjectStateHost
    ): { x: number; y: number } | null {
        let result: { x: number; y: number } | null = null
        if (objSetup.type === 'prop') {
            result = this.applySimpleTransform(container, state, host.getObjectDimensions(objSetup.id))
        } else if (objSetup.type === 'background') {
            result = this.applySimpleTransform(container, state, host.getObjectDimensions(objSetup.id))
        } else if (objSetup.type === 'screen_effect') {
            result = this.applyScreenEffectState(container, state, objSetup)
        } else if (objSetup.type === 'composite') {
            result = this.applyCompositeState(container, state, host.getObjectDimensions(objSetup.id))
        } else if (objSetup.type === 'symbol') {
            result = this.applySymbolState(container, state, objSetup, host)
        } else if (objSetup.type === 'expression') {
            result = this.applyExpressionState(container, state, objSetup, host)
        } else if (objSetup.type === 'camera') {
            result = this.applyCameraState(container, state, host)
        } else if (objSetup.type === 'light') {
            result = this.applyLightState(container, state)
        } else if (objSetup.type === 'text') {
            result = this.applyTextState(container, state, host.getObjectDimensions(objSetup.id))
        } else if (objSetup.type === 'mask') {
            // Clip-Mask Phase 1: mask container has no visual content, only carries worldTransform for maskRenderer to compute geometry.
            result = this.applySimpleTransform(container, state, host.getObjectDimensions(objSetup.id))
        }

        return result
    }

    /**
     * P2: Apply composite object state (composite branch)
     *
     * composite container itself only needs base transform (position/scale/rotation/alpha/visibility/zIndex),
     * children states are handled by their own independent applyObjectState calls.
     */
    private applyCompositeState(
        container: PIXI.Container,
        state: SceneObject,
        dims: ObjectDimensions | undefined
    ): { x: number; y: number } {
        const scaleX = state.scaleX * (state.flipX ? -1 : 1)
        const scaleY = state.scaleY
        container.scale.set(scaleX, scaleY)
        container.rotation = state.rotation
        container.alpha = state.alpha
        container.visible = (state.spawned ?? true) && state.visible
        container.zIndex = state.zIndex

        // v21: For composite, pivotBase = (0, 0), pivot directly equals originOffset
        const originX = state.transformOriginX ?? 0
        const originY = state.transformOriginY ?? 0
        container.pivot.set(originX, originY)

        // v21: Position compensation uses simple offset (consistent with non-composite)
        // Legacy formula posComp = originX*sx*cos - originY*sy*sin changed with rotation,
        // causing PIXI world tx=obj.x to always hold -> rotation centered on origin rather than pivot.
        // New formula position does not change with rotation -> pivot remains fixed in world -> rotation centers on pivot
        const cx = state.flipX ? -originX : originX
        const cy = originY
        const posX = state.x + cx
        const posY = state.y + cy
        container.position.set(posX, posY)
        this.syncGroundShadow(container, state, dims)

        return { x: posX, y: posY }
    }



    /**
     * Transform Origin compensation (pixel offset approach)
     *
     * transformOriginX/Y is pixel offset relative to PivotBase, default 0 = no offset.
     * Directly add pixel offset to pivot, no dims multiplication needed.
     *
     * @returns Position compensation { cx, cy }, caller must add to position
     */
    private applyTransformOriginPivot(
        container: PIXI.Container,
        state: SceneObject,
        dims: ObjectDimensions | undefined
    ): { cx: number; cy: number } {
        const originX = state.transformOriginX ?? 0
        const originY = state.transformOriginY ?? 0

        // v18: expression object uses anchor positioning (pivot fixed at (0,0) = sprite.anchor position),
        // does not use bounds center positioning, ensuring anchor alignment when switching expressions
        if (state.type === 'expression') {
            container.pivot.set(0, 0)
            return { cx: 0, cy: 0 }
        }

        // Default case (no offset): reset pivot to geometric center, ensuring no residual offset
        // Do not skip pivot setting! Otherwise container may retain custom pivot set by other rendering paths
        if (originX === 0 && originY === 0) {
            if (dims && dims.width > 0 && dims.height > 0) {
                const defaultPivotX = dims.pivotX ?? (dims.boundsX ?? 0) + dims.width / 2
                const defaultPivotY = dims.pivotY ?? (dims.boundsY ?? 0) + dims.height / 2
                container.pivot.set(defaultPivotX, defaultPivotY)
            }
            return { cx: 0, cy: 0 }
        }

        // Apply pixel offset directly, adding offset onto default pivot
        if (dims && dims.width > 0 && dims.height > 0) {
            const defaultPivotX = dims.pivotX ?? (dims.boundsX ?? 0) + dims.width / 2
            const defaultPivotY = dims.pivotY ?? (dims.boundsY ?? 0) + dims.height / 2
            container.pivot.set(defaultPivotX + originX, defaultPivotY + originY)
        } else {
            // Apply offset even without dims (e.g. composite), pivot directly adds originX/Y
            container.pivot.set(container.pivot.x + originX, container.pivot.y + originY)
        }

        // v20: flipX compensation direction correction
        // PIXI worldMatrix: tx = posX - pivotX * scaleX * cos(rot) + ...
        // When flipX, scaleX < 0, direction of pivot increment effect is opposite to position compensation direction
        // Must flip cx to keep visual position from jumping when pivot changes
        const flipX = state.flipX ?? false
        const cx = flipX ? -originX : originX
        return { cx, cy: originY }
    }

    /**
     * Apply simple transform (shared branch for prop / background / symbol)
     *
     * Uses identical scale -> visible -> pivot position compensation logic.
     */
    private applySimpleTransform(
        container: PIXI.Container,
        state: SceneObject,
        dims: ObjectDimensions | undefined
    ): { x: number; y: number } {
        const scaleX = state.scaleX * (state.flipX ? -1 : 1)
        const scaleY = state.scaleY
        container.scale.set(scaleX, scaleY)
        container.rotation = state.rotation
        container.alpha = state.alpha
        // spawned controls object existence, higher priority than visible
        container.visible = (state.spawned ?? true) && state.visible
        container.zIndex = state.zIndex

        // Transform Origin position compensation
        // dims may be undefined (prop/background/symbol objects don't populate objectDimensionsCache),
        // in which case calculate fallback dims from container.getLocalBounds()
        let effectiveDims = dims
        if (!effectiveDims) {
            const localBounds = container.getLocalBounds()
            if (localBounds.width > 0 && localBounds.height > 0) {
                effectiveDims = {
                    width: localBounds.width,
                    height: localBounds.height,
                    pivotX: localBounds.x + localBounds.width / 2,
                    pivotY: localBounds.y + localBounds.height / 2,
                    boundsX: localBounds.x,
                    boundsY: localBounds.y,
                }
            }
        }
        const { cx, cy } = this.applyTransformOriginPivot(container, state, effectiveDims)

        // v2.0.0: Unified center coordinates — obj.x/y is already center coordinate, add transform origin compensation
        // Do not use Math.round — subpixel rendering avoids integer truncation jitter when rotating around transform origin
        const posX = state.x + cx
        const posY = state.y + cy
        container.position.set(posX, posY)
        this.syncGroundShadow(container, state, effectiveDims)

        return { x: posX, y: posY }
    }

    private syncGroundShadow(
        container: PIXI.Container,
        state: SceneObject,
        dims: ObjectDimensions | undefined
    ): void {
        if (!supportsCastShadow(state) || state.castShadow !== true || !dims) {
            const existing = container.getChildByName(GROUND_SHADOW_NAME)
            if (existing) {
                container.removeChild(existing)
                existing.destroy()
            }
            return
        }

        let shadow = container.getChildByName<PIXI.Graphics>(GROUND_SHADOW_NAME)
        if (!shadow) {
            shadow = new PIXI.Graphics()
            shadow.name = GROUND_SHADOW_NAME
            container.addChildAt(shadow, 0)
        }

        const baseSize = Math.min(dims.width, dims.height)
        const shadowW = Math.max(dims.width * 0.82, 28)
        const shadowH = Math.max(baseSize * 0.14, 10)
        const shadowY = (dims.boundsY ?? 0) + dims.height - shadowH * 0.2

        shadow.clear()
        // Two-layer ellipse overlay to enhance near-ground shadow visibility while preserving edge transitions.
        shadow.beginFill(0x000000, 0.16)
        shadow.drawEllipse(0, shadowY, shadowW * 0.58, shadowH * 0.72)
        shadow.endFill()

        shadow.beginFill(0x000000, 0.28)
        shadow.drawEllipse(0, shadowY, shadowW * 0.42, shadowH * 0.42)
        shadow.endFill()
    }

    /**
     * Apply symbol state (symbol branch)
     *
     * Detects currentMaterialId change, rebuilding internal sprite if material switches.
     * Geometric transforms are delegated to applySimpleTransform.
     */
    private applySymbolState(
        container: PIXI.Container,
        state: SceneObject,
        objSetup: SceneObject,
        host: ObjectStateHost
    ): { x: number; y: number } {
        const symbolState = state as SymbolObject
        const symbolSetup = objSetup as SymbolObject
        const targetMaterialId = symbolState.currentMaterialId ?? symbolSetup.materials?.[0]?.id ?? '__placeholder__'
        const extContainer = container as PIXI.Container & { _renderedMaterialId?: string }
        const currentRenderedId = extContainer._renderedMaterialId ?? '__placeholder__'

        if (targetMaterialId !== currentRenderedId) {
            // Material changed: destroy old children, rebuild new sprite
            while (container.children.length > 0) {
                const child = container.children[0]
                if (child) {
                    container.removeChild(child)
                    child.destroy({ children: true })
                }
            }

            // Find target material (prefer material from state, fallback to material from setup)
            const materials = symbolState.materials?.length > 0 ? symbolState.materials : symbolSetup.materials
            const material = targetMaterialId !== '__placeholder__'
                ? materials?.find(m => m.id === targetMaterialId)
                : materials?.[0]

            if (material) {
                if (material.type === 'static' && material.url) {
                    const resolvedUrl = this.textureProvider.getImageUrl(material.url)
                    const texture = this.textureProvider.getTexture(resolvedUrl || material.url)
                    const sprite = new PIXI.Sprite(texture)
                    sprite.name = 'symbol_sprite'
                    sprite.anchor.set(0.5)
                    container.addChild(sprite)
                } else if (material.type === 'animation' && material.frames && material.frames.length > 0) {
                    const textures: PIXI.Texture[] = []
                    for (const frame of material.frames) {
                        if (frame.url) {
                            const fUrl = this.textureProvider.getImageUrl(frame.url)
                            textures.push(this.textureProvider.getTexture(fUrl || frame.url))
                        }
                    }
                    if (textures.length > 0) {
                        const animatedSprite = new PIXI.AnimatedSprite(textures)
                        animatedSprite.name = 'symbol_animation'
                        animatedSprite.anchor.set(0.5)
                        animatedSprite.animationSpeed = (material.fps ?? 12) / 60
                        animatedSprite.loop = material.loop ?? true
                        animatedSprite.autoUpdate = false  // Manually advance to eliminate spawn frame latency

                        // v16: Use configured still frame, do not auto-play (controlled by initialAnimations/set_anim)
                        restoreAnimatedSpriteStillFrame(animatedSprite, {
                            stillFrameSource: material.stillFrameSource,
                            stillFrameIndex: material.stillFrameIndex,
                            url: material.url,
                        }, (url: string) => this.textureProvider.getTexture(url))

                        container.addChild(animatedSprite)
                    }
                }
            }

            extContainer._renderedMaterialId = targetMaterialId
        }

        return this.applySimpleTransform(container, state, host.getObjectDimensions(objSetup.id))
    }

    // --------------------------------------------------------------------------
    // Expression Rendering (v18)
    // --------------------------------------------------------------------------

    /**
     * Create independent expression PIXI container
     * Fetches expression data from expressionStore, renders as Sprite or AnimatedSprite
     */
    createExpressionContainer(obj: SceneObject): PIXI.Container {
        const container = new PIXI.Container()
        container.name = obj.id
        container.zIndex = obj.zIndex ?? 0

        this.buildExpressionSprite(container, obj.refId)

        return container
    }

    /**
     * Build expression sprite and add to container
     * Reusable for initial creation and rebuild upon refId change
     */
    private getExpressionRenderKey(refId: string): string {
        const expression = this.stores.expressionStore.getExpression(refId)
        if (!expression) return `${refId}:missing`

        return JSON.stringify({
            refId,
            defaultFrameUrl: expression.defaultFrame?.url ?? '',
            speakingFrameUrls: expression.speakingFrames?.map(frame => frame.url ?? '') ?? [],
            anchor: expression.anchor ?? { x: 0.5, y: 0.5 },
            defaultScale: expression.defaultScale ?? 1,
            flipHorizontal: expression.flipHorizontal ?? false,
            blendMode: expression.blendMode ?? 'normal',
            speakingFps: expression.speakingFps ?? 12,
            speakingLoop: expression.speakingLoop ?? true,
        })
    }

    private buildExpressionSprite(container: PIXI.Container, refId: string): void {
        const expression = this.stores.expressionStore.getExpression(refId)
        if (!expression) {
            // refId is empty or expression does not exist: render placeholder (consistent with Symbol placeholder)
            const PLACEHOLDER_SIZE = 200
            const halfSize = PLACEHOLDER_SIZE / 2

            const graphics = new PIXI.Graphics()
            graphics.name = 'expression_placeholder'

            // Translucent rounded rectangle background
            graphics.beginFill(0x3a3a4a, 0.85)
            graphics.drawRoundedRect(-halfSize, -halfSize, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, 16)
            graphics.endFill()

            // Dashed border effect
            graphics.lineStyle(3, 0x7a7a9a, 0.8)
            graphics.drawRoundedRect(-halfSize, -halfSize, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, 16)

            container.addChild(graphics)

            // Expression icon
            const iconText = new PIXI.Text('🎭', {
                fontSize: 48,
                fill: 0xcccccc,
            })
            iconText.anchor.set(0.5)
            iconText.position.set(0, -20)
            container.addChild(iconText)

            // "Expression" label
            const labelText = new PIXI.Text('Expression', {
                fontFamily: 'Arial, sans-serif',
                fontSize: 18,
                fill: 0xaaaaaa,
                align: 'center',
            })
            labelText.anchor.set(0.5)
            labelText.position.set(0, 35)
            container.addChild(labelText)

            ;(container as PIXI.Container & { _renderedRefId?: string; _expressionRenderKey?: string })._renderedRefId = refId
            ;(container as PIXI.Container & { _expressionRenderKey?: string })._expressionRenderKey = this.getExpressionRenderKey(refId)
            return
        }

        const anchor = {
            x: expression.anchor?.x ?? 0.5,
            y: expression.anchor?.y ?? 0.5
        }
        const defaultScale = expression.defaultScale ?? 1
        const flipH = expression.flipHorizontal ?? false

        // Check whether frame animation or static
        const speakingFrames = expression.speakingFrames ?? []
        const hasSpeakingFrames = speakingFrames.length > 0

        if (hasSpeakingFrames) {
            // Frame animation expression: use speakingFrames to create AnimatedSprite
            const textures: PIXI.Texture[] = []
            for (const frame of speakingFrames) {
                if (frame.url) {
                    const tex = this.textureProvider.getTexture(frame.url)
                    textures.push(tex)
                }
            }

            if (textures.length > 0) {
                const animatedSprite = new PIXI.AnimatedSprite(textures)
                animatedSprite.name = 'expression_animation'
                animatedSprite.anchor.set(anchor.x, anchor.y)
                animatedSprite.animationSpeed = (expression.speakingFps ?? 12) / 60
                animatedSprite.loop = expression.speakingLoop ?? true
                animatedSprite.autoUpdate = false  // Manually advance to eliminate spawn frame latency
                animatedSprite.scale.set(
                    defaultScale * (flipH ? -1 : 1),
                    defaultScale
                )

                // Still frame: default display defaultFrame
                const defaultFrameUrl = expression.defaultFrame?.url
                if (defaultFrameUrl) {
                    const stillTexture = this.textureProvider.getTexture(defaultFrameUrl)
                    if (stillTexture && stillTexture !== PIXI.Texture.EMPTY) {
                        animatedSprite.texture = stillTexture
                    }
                } else {
                    animatedSprite.gotoAndStop(0)
                }

                // Blend mode
                if (expression.blendMode === 'multiply') {
                    animatedSprite.blendMode = PIXI.BLEND_MODES.MULTIPLY
                }

                container.addChild(animatedSprite)
            }
        } else {
            // Static expression: use defaultFrame
            const defaultFrameUrl = expression.defaultFrame?.url
            if (defaultFrameUrl) {
                const texture = this.textureProvider.getTexture(defaultFrameUrl)
                const sprite = new PIXI.Sprite(texture)
                sprite.name = 'expression_sprite'
                sprite.anchor.set(anchor.x, anchor.y)
                sprite.scale.set(
                    defaultScale * (flipH ? -1 : 1),
                    defaultScale
                )

                // Blend mode
                if (expression.blendMode === 'multiply') {
                    sprite.blendMode = PIXI.BLEND_MODES.MULTIPLY
                }

                container.addChild(sprite)
            }
        }

        // Record currently rendered refId
        ;(container as PIXI.Container & { _renderedRefId?: string; _expressionRenderKey?: string })._renderedRefId = refId
        ;(container as PIXI.Container & { _expressionRenderKey?: string })._expressionRenderKey = this.getExpressionRenderKey(refId)
    }

    /**
     * Apply expression state (expression branch)
     *
     * Detects refId change, rebuilding internal sprite if expression switches.
     * Geometric transforms are delegated to applySimpleTransform.
     */
    private applyExpressionState(
        container: PIXI.Container,
        state: SceneObject,
        objSetup: SceneObject,
        host: ObjectStateHost
    ): { x: number; y: number } {
        const targetRefId = state.refId
        const extContainer = container as PIXI.Container & { _renderedRefId?: string; _expressionRenderKey?: string }
        const currentRenderedId = extContainer._renderedRefId ?? ''
        const targetRenderKey = this.getExpressionRenderKey(targetRefId)

        if (targetRefId !== currentRenderedId || targetRenderKey !== extContainer._expressionRenderKey) {
            // refId or expression resource config changed: destroy old children, rebuild new sprite
            while (container.children.length > 0) {
                const child = container.children[0]
                if (child) {
                    container.removeChild(child)
                    child.destroy({ children: true })
                }
            }

            this.buildExpressionSprite(container, targetRefId)
        }

        return this.applySimpleTransform(container, state, host.getObjectDimensions(objSetup.id))
    }

    /**
     * Apply screen effect state (screen_effect branch)
     *
     * Phase 4b: Directly reads screen effect parameters from SceneObject's nested params structure,
     * rather than reading from ObjectStateSnapshot's flattened top level (eliminating structural disconnect).
     */
    private applyScreenEffectState(
        container: PIXI.Container,
        state: SceneObject,
        objSetup: SceneObject
    ): null {
        const scaleX = state.scaleX * (state.flipX ? -1 : 1)
        const scaleY = state.scaleY
        container.scale.set(scaleX, scaleY)
        container.rotation = state.rotation
        container.alpha = state.alpha
        container.visible = (state.spawned !== false) && state.visible
        container.zIndex = state.zIndex

        // Position: direct assignment (no halfW/halfH compensation, unified with Editor and ScenePlayer)
        container.position.set(state.x, state.y)

        // Redraw Graphics: directly use ScreenEffectObject.params
        const screenEffectObj = state as ScreenEffectObject
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const graphics = container.getChildByName('screen_effect_graphics') as PIXI.Graphics | null
        if (graphics && screenEffectObj.params) {
            // Debounce: skip redrawing when parameters are unchanged, avoiding remove/add feathering sprite on every render
            // Significantly reduces display tree jitter during high-frequency Action Mode + ghost updates.
            const drawKey = `${objSetup.width}x${objSetup.height}:${JSON.stringify(screenEffectObj.params)}`
            const extContainer = container as PIXI.Container & { _screenEffectDrawKey?: string }
            if (extContainer._screenEffectDrawKey !== drawKey) {
                drawScreenEffectGraphics(graphics, screenEffectObj.params, objSetup.width, objSetup.height, container)
                extContainer._screenEffectDrawKey = drawKey
            }
        }

        return null
    }

    /**
     * Apply camera state (camera branch)
     *
     * Camera differs from ordinary objects:
     * - Does not use scaleX/scaleY (fixed to 1,1), zoom is achieved by redrawing Graphics border
     * - Does not rotate (rotation fixed to 0)
     * - visible is controlled by cameraEditorVisible in editor toolbar
     * - zIndex is fixed to Z_INDEX_CAMERA_OVERLAY
     *
     * Aligned with camera inline logic in updateActionModeObjects,
     * used for syncContainerFromStore path (instant visual feedback during drag/zoom interaction).
     */
    private applyCameraState(
        container: PIXI.Container,
        state: SceneObject,
        _host: ObjectStateHost
    ): { x: number; y: number } {
        const cameraState = state as CameraObject
        const zoom = cameraState.zoom || 1.0
        const actionWidth = CAMERA_BASE_WIDTH / zoom
        const actionHeight = CAMERA_BASE_HEIGHT / zoom

        // Redraw camera_border to match dimensions under current zoom
        const graphics = container.getChildByName('camera_border') as PIXI.Graphics | undefined
        if (graphics) {
            graphics.clear()
            graphics.lineStyle(20, 0x00ff00)
            graphics.beginFill(0x000000, 0.001)
            graphics.drawRect(0, 0, actionWidth, actionHeight)
            graphics.endFill()
        }

        // pivot centered
        container.pivot.set(actionWidth / 2, actionHeight / 2)

        // Position
        container.position.set(state.x, state.y)

        // Fixed properties
        container.scale.set(1, 1)
        container.rotation = 0
        container.alpha = 1
        container.zIndex = Z_INDEX_CAMERA_OVERLAY

        // Visibility controlled uniformly by penetration list in render pipeline layer, default state value used here
        container.visible = state.visible

        return { x: state.x, y: state.y }
    }

    /**
     * Apply light source object state
     * Renders visual indicator in editor (ambient light = small circle, point light = range circle + center handle)
     * Actual lighting effect is processed uniformly by LightingFilter in render pipeline layer
     */
    private applyLightState(
        container: PIXI.Container,
        state: SceneObject,
    ): { x: number; y: number } {
        const lightState = state as LightObject
        const colorNum = parseInt((lightState.lightColor || '#ffffff').replace('#', ''), 16)
        const ambientCoreRadius = 18
        const ambientHaloRadius = 34
        const pointCoreRadius = 10
        const pointHandleRadius = 22
        const pointRadius = Math.max(lightState.lightRadius, pointHandleRadius + 12)

        // Redraw indicator graphics
        let graphics = container.getChildByName('light_indicator') as PIXI.Graphics | undefined
        if (!graphics) {
            graphics = new PIXI.Graphics()
            graphics.name = 'light_indicator'
            container.addChild(graphics)
        }
        graphics.clear()

        if (lightState.lightType === 'ambient') {
            // Ambient light: small global lighting badge, emphasizing "selectable but takes no canvas space"
            graphics.beginFill(colorNum, 0.16)
            graphics.drawCircle(0, 0, ambientHaloRadius)
            graphics.endFill()

            graphics.lineStyle(2, colorNum, 0.55)
            graphics.drawCircle(0, 0, ambientHaloRadius)

            graphics.beginFill(colorNum, 0.85)
            graphics.drawCircle(0, 0, ambientCoreRadius)
            graphics.endFill()

            graphics.lineStyle(2, colorNum, 0.9)
            for (let i = 0; i < 8; i++) {
                const angle = (Math.PI / 4) * i
                const inner = ambientCoreRadius + 6
                const outer = ambientHaloRadius + (i % 2 === 0 ? 10 : 4)
                graphics.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
                graphics.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
            }

            graphics.beginFill(0xffffff, 0.9)
            graphics.drawCircle(0, 0, 4)
            graphics.endFill()

            container.hitArea = new PIXI.Rectangle(-96, -96, 192, 192)
        } else if (lightState.lightType === 'spot') {
            const directionAngle = lightState.directionAngle ?? 0
            const coneAngleDeg = lightState.coneAngle ?? 100
            const coneHalfRad = (coneAngleDeg * Math.PI / 180) / 2
            const outerRadius = pointRadius

            graphics.beginFill(colorNum, 0.08)
            graphics.moveTo(0, 0)
            graphics.arc(0, 0, outerRadius, directionAngle - coneHalfRad, directionAngle + coneHalfRad)
            graphics.lineTo(0, 0)
            graphics.endFill()

            graphics.lineStyle(2, colorNum, 0.45)
            graphics.moveTo(0, 0)
            graphics.arc(0, 0, outerRadius, directionAngle - coneHalfRad, directionAngle + coneHalfRad)
            graphics.lineTo(0, 0)

            graphics.beginFill(colorNum, 0.18)
            graphics.drawCircle(0, 0, pointHandleRadius)
            graphics.endFill()

            graphics.lineStyle(2, colorNum, 0.95)
            graphics.drawCircle(0, 0, pointHandleRadius)

            graphics.beginFill(colorNum, 0.92)
            graphics.drawCircle(0, 0, pointCoreRadius)
            graphics.endFill()

            const arrowLength = Math.max(40, Math.min(outerRadius, 80))
            const arrowTipX = Math.cos(directionAngle) * arrowLength
            const arrowTipY = Math.sin(directionAngle) * arrowLength
            graphics.lineStyle(3, colorNum, 0.9)
            graphics.moveTo(0, 0)
            graphics.lineTo(arrowTipX, arrowTipY)
            graphics.lineTo(
                arrowTipX - Math.cos(directionAngle - Math.PI / 6) * 12,
                arrowTipY - Math.sin(directionAngle - Math.PI / 6) * 12,
            )
            graphics.moveTo(arrowTipX, arrowTipY)
            graphics.lineTo(
                arrowTipX - Math.cos(directionAngle + Math.PI / 6) * 12,
                arrowTipY - Math.sin(directionAngle + Math.PI / 6) * 12,
            )

            container.hitArea = new PIXI.Rectangle(-96, -96, 192, 192)
        } else {
            // Point light: display lighting range + center handle, balancing readability and hit-testing
            graphics.lineStyle(2, colorNum, 0.4)
            graphics.drawCircle(0, 0, pointRadius)

            graphics.lineStyle(1, colorNum, 0.2)
            graphics.drawCircle(0, 0, pointRadius * 0.66)

            graphics.beginFill(colorNum, 0.08)
            graphics.drawCircle(0, 0, pointRadius)
            graphics.endFill()

            graphics.beginFill(colorNum, 0.18)
            graphics.drawCircle(0, 0, pointHandleRadius)
            graphics.endFill()

            graphics.lineStyle(2, colorNum, 0.9)
            graphics.drawCircle(0, 0, pointHandleRadius)

            graphics.beginFill(colorNum, 0.85)
            graphics.drawCircle(0, 0, pointCoreRadius)
            graphics.endFill()

            graphics.lineStyle(2, colorNum, 0.8)
            graphics.moveTo(-pointHandleRadius - 8, 0)
            graphics.lineTo(pointHandleRadius + 8, 0)
            graphics.moveTo(0, -pointHandleRadius - 8)
            graphics.lineTo(0, pointHandleRadius + 8)

            container.hitArea = new PIXI.Rectangle(-96, -96, 192, 192)
        }

        // Position
        container.position.set(state.x, state.y)
        // Fixed properties
        container.scale.set(1, 1)
        container.rotation = 0
        container.alpha = 1
        container.zIndex = Z_INDEX_LIGHT_OVERLAY
        container.visible = state.visible

        return { x: state.x, y: state.y }
    }

    /**
     * Apply text object state (text branch)
     *
     * Updates PIXI.Text content and style, then delegates to applySimpleTransform for geometric transforms.
     */
    private applyTextState(
        container: PIXI.Container,
        state: SceneObject,
        dims: ObjectDimensions | undefined,
    ): { x: number; y: number } {
        const textState = state as import('@/types/sceneObject').TextObject
        const normalizedContent = normalizeTextContent(textState.content)
        const effectiveWordWrap = textState.wordWrap ?? true
        const isVertical = textState.writingMode === 'vertical'

        // Phase 1: Detect writingMode switch -> needs substructure rebuild
        const hasHorizontal = container.getChildByName('text_content') !== null
        const hasVertical = container.getChildByName('text_vertical_group') !== null

        if (isVertical && hasHorizontal) {
            // Horizontal -> vertical: destroy existing text_content, create vertical group
            const old = container.getChildByName('text_content')
            if (old) container.removeChild(old)
            const styleOpts = this.buildTextStyleOpts(textState)
            const vertGroup = this.createVerticalTextLayout(textState, styleOpts)
            vertGroup.name = 'text_vertical_group'
            container.addChild(vertGroup)
        } else if (!isVertical && hasVertical) {
            // Vertical -> horizontal: destroy vertical group, create text_content
            const old = container.getChildByName('text_vertical_group')
            if (old) container.removeChild(old)
            const styleOpts = this.buildTextStyleOpts(textState)
            const text = new PIXI.Text(textState.content ?? '', new PIXI.TextStyle(styleOpts))
            text.name = 'text_content'
            text.anchor.set(0.5)
            container.addChild(text)
        }

        if (isVertical) {
            // Vertical mode: rebuild vertical group content
            const vertGroup = container.getChildByName('text_vertical_group') as PIXI.Container | undefined
            if (vertGroup) {
                // Clear and re-layout
                vertGroup.removeChildren()
                const styleOpts = this.buildTextStyleOpts(textState)
                const newGroup = this.createVerticalTextLayout(textState, styleOpts)
                while (newGroup.children.length > 0) {
                    const child = newGroup.children[0]!
                    newGroup.removeChild(child)
                    vertGroup.addChild(child)
                }
            }
            const currentVert = container.getChildByName('text_vertical_group') as PIXI.Container | undefined
            this.syncTextBackground(container, textState, currentVert, textState.textBoxMode ?? 'auto-size')
        } else {
            // Horizontal mode: update PIXI.Text properties
            const textChild = container.getChildByName('text_content') as PIXI.Text | undefined
            if (textChild) {
                const lineHeightInfo = resolveTextLineHeight(textState.fontFamily, textState.fontSize, textState.lineHeight)
                const gradient = textState.fillType === 'linear_gradient'
                    ? resolveTextGradient(textState.gradientStops, textState.gradientAngle)
                    : null
                const fillValue = gradient ? gradient.colors : (textState.color ?? '#ffffff')
                const boxMode = textState.textBoxMode ?? 'auto-size'
                const styleOpts: Partial<PIXI.ITextStyle> = {
                    fontFamily: textState.fontFamily ?? 'Noto Sans SC',
                    fontSize: textState.fontSize ?? 72,
                    fontWeight: textState.fontWeight ?? 'normal',
                    fontStyle: textState.fontStyle ?? 'normal',
                    fill: fillValue,
                    align: (textState.align ?? 'center'),
                    breakWords: true,
                    whiteSpace: 'pre-line',
                    strokeThickness: textState.strokeThickness ?? 0,
                    dropShadow: textState.dropShadow ?? false,
                    dropShadowColor: textState.dropShadowColor ?? '#000000',
                    dropShadowBlur: textState.dropShadowBlur ?? 4,
                    dropShadowAngle: textState.dropShadowAngle ?? Math.PI / 4,
                    dropShadowDistance: textState.dropShadowDistance ?? 4,
                    lineHeight: lineHeightInfo.lineHeight,
                    leading: getAutoTextLeading(
                        textState.fontFamily,
                        textState.fontSize,
                        lineHeightInfo.source === 'explicit' ? lineHeightInfo.lineHeight : undefined,
                    ),
                    letterSpacing: textState.letterSpacing ?? 0,
                }
                if (gradient) {
                    styleOpts.fillGradientType = gradient.gradientType
                    styleOpts.fillGradientStops = gradient.gradientStops
                }
                if (textState.stroke) styleOpts.stroke = textState.stroke
                if (boxMode === 'auto-width' || boxMode === 'auto-size') {
                    styleOpts.wordWrap = false
                } else {
                    const wrapWidth = boxMode === 'fixed'
                        ? Math.max(50, textState.width ?? 400)
                        : Math.max(50, textState.wordWrapWidth ?? 400)
                    styleOpts.wordWrap = effectiveWordWrap
                    styleOpts.wordWrapWidth = wrapWidth
                }
                const content = normalizedContent
                const ws = state as unknown as import('@/utils/actionHandlers/types').WriteableState
                let displayText = content
                if (ws.revealProgress !== undefined) {
                    const visibleCount = Math.ceil(content.length * ws.revealProgress)
                    displayText = content.substring(0, visibleCount)
                }
                const rebuiltText = new PIXI.Text(displayText, new PIXI.TextStyle(styleOpts))
                rebuiltText.name = 'text_content'
                rebuiltText.anchor.set(0.5)
                container.removeChild(textChild)
                textChild.destroy()
                container.addChild(rebuiltText)
                this.syncTextBackground(container, textState, rebuiltText, boxMode)
            }
        }

        // Phase 1: fixed mode — add/update/remove rectangular mask to clip overflow
        const boxMode = textState.textBoxMode ?? 'auto-size'
        const existingMask = container.getChildByName('text_box_mask') as PIXI.Graphics | undefined
        if (boxMode === 'fixed' && state.width > 0 && state.height > 0) {
            const w = state.width
            const h = state.height
            if (existingMask) {
                existingMask.clear()
                existingMask.beginFill(0xffffff)
                existingMask.drawRect(-w / 2, -h / 2, w, h)
                existingMask.endFill()
            } else {
                const mask = new PIXI.Graphics()
                mask.name = 'text_box_mask'
                mask.beginFill(0xffffff)
                mask.drawRect(-w / 2, -h / 2, w, h)
                mask.endFill()
                container.addChild(mask)
                container.mask = mask
            }
        } else if (existingMask) {
            // Non-fixed mode: remove mask
            container.mask = null
            container.removeChild(existingMask)
        }

        return this.applySimpleTransform(container, state, dims)
    }

    /**
     * Build TextStyle options object (shared across horizontal/vertical)
     */
    private buildTextStyleOpts(textState: import('@/types/sceneObject').TextObject): Partial<PIXI.ITextStyle> {
        const effectiveWordWrap = textState.wordWrap ?? true
        const boxMode = textState.textBoxMode ?? 'auto-size'
        // Phase 2: Gradient fill: use color array when fillType=linear_gradient
        const gradient = textState.fillType === 'linear_gradient'
            ? resolveTextGradient(textState.gradientStops, textState.gradientAngle)
            : null
        const fillValue = gradient ? gradient.colors : (textState.color ?? '#ffffff')

        const opts: Partial<PIXI.ITextStyle> = {
            fontFamily: textState.fontFamily ?? 'Noto Sans SC',
            fontSize: textState.fontSize ?? 72,
            fontWeight: textState.fontWeight ?? 'normal',
            fontStyle: textState.fontStyle ?? 'normal',
            fill: fillValue,
            align: (textState.align ?? 'center'),
            breakWords: true,
            whiteSpace: 'pre-line',
            strokeThickness: textState.strokeThickness ?? 0,
            dropShadow: textState.dropShadow ?? false,
            dropShadowColor: textState.dropShadowColor ?? '#000000',
            dropShadowBlur: textState.dropShadowBlur ?? 4,
            dropShadowAngle: textState.dropShadowAngle ?? Math.PI / 4,
            dropShadowDistance: textState.dropShadowDistance ?? 4,
            letterSpacing: textState.letterSpacing ?? 0,
        }
        const lineHeightInfo = resolveTextLineHeight(textState.fontFamily, textState.fontSize, textState.lineHeight)
        opts.leading = getAutoTextLeading(
            textState.fontFamily,
            textState.fontSize,
            lineHeightInfo.source === 'explicit' ? lineHeightInfo.lineHeight : undefined,
        )
        if (gradient) {
            opts.fillGradientType = gradient.gradientType
            opts.fillGradientStops = gradient.gradientStops
        }
        if (boxMode === 'auto-width' || boxMode === 'auto-size') {
            opts.wordWrap = false
        } else {
            const wrapWidth = boxMode === 'fixed'
                ? Math.max(50, textState.width ?? 400)
                : Math.max(50, textState.wordWrapWidth ?? 400)
            opts.wordWrap = effectiveWordWrap
            opts.wordWrapWidth = wrapWidth
        }
        if (textState.stroke) opts.stroke = textState.stroke
        // Always set lineHeight: auto and explicit resolved uniformly via resolveTextLineHeight
        opts.lineHeight = lineHeightInfo.lineHeight
        return opts
    }

    // --------------------------------------------------------------------------
    // Dimension Measurement
    // --------------------------------------------------------------------------

    /**
     * Measure localBounds for all scene objects and cache to ObjectStateHost
     *
     * Called once after all object containers are created, ensuring accurate bounds measurement.
     */
    measureObjectBounds(
        objects: readonly SceneObject[],
        containers: Map<string, PIXI.Container>,
        host: ObjectStateHost
    ): void {
        for (const objSetup of objects) {
            if (objSetup.type === 'audio') continue
            // v25: Light objects do not need bounds measurement
            if (objSetup.type === 'light') continue
            const container = containers.get(objSetup.id)
            if (!container) continue

            // v19: composite container (especially union proxy) itself may be empty,
            // compute virtual bounds from children positions to support transform origin
            if (objSetup.type === 'composite') {
                const comp = objSetup as CompositeObject
                const childIds = comp.childIds ?? []
                if (childIds.length > 0) {
                    // Compute bounding box from children positions
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
                    for (const childId of childIds) {
                        const childObj = objects.find(o => o.id === childId)
                        if (!childObj) continue
                        // Child position is center coordinate, estimate bounds using child width/height;
                        // if none, use measured dims
                        const childDims = host.getObjectDimensions(childId)
                        const hw = childDims ? childDims.width / 2 : 50
                        const hh = childDims ? childDims.height / 2 : 50
                        minX = Math.min(minX, childObj.x - hw)
                        maxX = Math.max(maxX, childObj.x + hw)
                        minY = Math.min(minY, childObj.y - hh)
                        maxY = Math.max(maxY, childObj.y + hh)
                    }
                    if (minX < Infinity) {
                        const width = maxX - minX
                        const height = maxY - minY
                        const pivotX = minX + width / 2
                        const pivotY = minY + height / 2
                        host.setObjectDimensions(objSetup.id, {
                            width, height, pivotX, pivotY,
                            boundsX: minX, boundsY: minY
                        })
                    }
                }
                continue
            }

            const localBounds = getLocalBoundsIgnoringGroundShadow(container)
            if (localBounds.width <= 0 || localBounds.height <= 0) continue

            const pivotX = localBounds.x + localBounds.width / 2
            const pivotY = localBounds.y + localBounds.height / 2

            // prop/background/symbol set pivot
            // v18: expression does not set pivot (keeps (0,0) = anchor position, handled uniformly by applyTransformOriginPivot)
            if (objSetup.type === 'prop' || objSetup.type === 'background' || objSetup.type === 'symbol') {
                container.pivot.set(pivotX, pivotY)
            }

            host.setObjectDimensions(objSetup.id, {
                width: localBounds.width,
                height: localBounds.height,
                pivotX,
                pivotY,
                boundsX: localBounds.x,
                boundsY: localBounds.y
            })
        }
    }

    // --------------------------------------------------------------------------
    // Camera Transform
    // --------------------------------------------------------------------------

    /**
     * Apply camera transform to contentViewport container
     *
     * Unifies logic of ScenePlayer.applyCameraTransform and FrameCapture.applyCameraTransform.
     * Includes camera boundary clamping (ensuring camera does not exceed canvas bounds).
     *
     * @param contentViewport  Camera viewport container
     * @param cameraState  Runtime camera state
     */
    static applyCameraTransform(
        contentViewport: PIXI.Container,
        cameraState: RuntimeCameraState,
        snapToPixel = false
    ): void {
        const { x, y, zoom, shakeOffsetX, shakeOffsetY } = cameraState

        // Camera boundary clamping
        const halfViewWidth = (CAMERA_BASE_WIDTH / 2) / zoom
        const halfViewHeight = (CAMERA_BASE_HEIGHT / 2) / zoom
        const minX = halfViewWidth
        const maxX = CANVAS_WIDTH - halfViewWidth
        const minY = halfViewHeight
        const maxY = CANVAS_HEIGHT - halfViewHeight
        const clampedX = Math.max(minX, Math.min(maxX, x))
        const clampedY = Math.max(minY, Math.min(maxY, y))

        // Camera follow via pivot approach
        let pivotX = clampedX + shakeOffsetX
        let pivotY = clampedY + shakeOffsetY

        // Export path: align to physical pixel grid, eliminating subpixel texture sampling jitter
        // Screen physical pixel = pivot * zoom * resolution(2)
        // Requires pivot * zoom * 2 to be an integer -> alignment step = 1 / (zoom * 2)
        if (snapToPixel) {
            const snapGrid = zoom * 2
            pivotX = Math.round(pivotX * snapGrid) / snapGrid
            pivotY = Math.round(pivotY * snapGrid) / snapGrid
        }

        contentViewport.pivot.set(pivotX, pivotY)
        contentViewport.position.set(CAMERA_BASE_WIDTH / 2, CAMERA_BASE_HEIGHT / 2)
        contentViewport.scale.set(zoom, zoom)
    }

    // --------------------------------------------------------------------------
    // P2: Generic Child Container Creation (Children of Composite Object)
    // --------------------------------------------------------------------------

    /**
     * Create PIXI container for child of composite object
     *
     * Uses internal dispatch Map for polymorphic dispatch, eliminating if/else chain in renderComposite.
     * Caller only needs to iterate childIds and invoke this method for each child.
     */
    async createChildContainer(obj: SceneObject): Promise<PIXI.Container | null> {
        const dispatch: Record<string, (o: SceneObject) => PIXI.Container | Promise<PIXI.Container>> = {
            prop: (o) => this.createPropContainer(o),
            background: (o) => this.createBackgroundContainer(o),
            symbol: (o) => this.createSymbolContainer(o),
            expression: (o) => this.createExpressionContainer(o),
        }

        const factory = dispatch[obj.type]
        if (!factory) {
            // Unsupported child types (audio/text/camera etc. are not nested)
            return null
        }

        const container = await factory(obj)
        return container
    }

    // --------------------------------------------------------------------------
    // Screen Effect Rendering
    // --------------------------------------------------------------------------

    /**
     * Create screen effect PIXI container (Container + Graphics)
     *
     * Phase 3 normalization: unifies screen_effect container creation path between useSceneGraph and renderPipeline.
     */
    createScreenEffectContainer(
        id: string,
        params: ScreenEffectParams,
        width: number,
        height: number,
        zIndex: number
    ): { container: PIXI.Container; graphics: PIXI.Graphics } {
        const container = new PIXI.Container()
        container.name = id
        container.zIndex = zIndex
        container.sortableChildren = false

        const graphics = new PIXI.Graphics()
        graphics.name = 'screen_effect_graphics'

        // Add graphics to container first, then draw (feathering requires sprite to be added after graphics)
        container.addChild(graphics)
        drawScreenEffectGraphics(graphics, params, width, height, container)

        return { container, graphics }
    }

    // --------------------------------------------------------------------------
    // P2: Basic Transform Application (DRY)
    // --------------------------------------------------------------------------

    /**
     * Apply basic geometric transform to container
     *
     * Used in scenarios like renderComposite where only position/scale/rotation/alpha/zIndex/visible need to be set,
     * without involving pivot compensation or animation states.
     */
    static applyBasicTransform(container: PIXI.Container, obj: SceneObject): void {
        container.position.set(obj.x, obj.y)
        container.scale.set(obj.scaleX ?? 1, obj.scaleY ?? 1)
        container.rotation = obj.rotation ?? 0
        container.alpha = obj.alpha ?? 1
        container.zIndex = obj.zIndex
        container.visible = obj.visible ?? true
    }
}
