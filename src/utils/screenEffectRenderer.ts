/**
 * screenEffectRenderer.ts
 * Shared screen effect PIXI.Graphics rendering logic
 * Used for useSceneGraph / ScenePlayer / ActionPreviewDialog / FrameCapture
 *
 * v2.0: Supports feather effect
 *   When feather > 0, uses Canvas2D blur + PIXI.BLEND_MODES.ERASE to achieve soft-edge hole
 *   When feather === 0, uses traditional beginHole/endHole to achieve hard-edge hole
 */

import * as PIXI from 'pixi.js'

import type { ScreenEffectParams } from '@/types/sceneObject'

const FEATHER_SPRITE_NAME = '_feather_hole'
const LIGHT_SPRITE_NAME = '_light_sprite'
const PIXI_TREE_DEBUG_FLAG = '__AITALK_PIXI_TREE_DEBUG__'

function isPixiTreeDebugEnabled(): boolean {
    if (typeof window === 'undefined') return false
    const globalEnabled = (window as unknown as Record<string, unknown>)[PIXI_TREE_DEBUG_FLAG] === true
    const localEnabled = window.localStorage?.getItem('aitalk:pixi-tree-debug') === '1'
    return globalEnabled || localEnabled
}

function logPixiTree(event: string, payload: Record<string, unknown>): void {
    if (!isPixiTreeDebugEnabled()) return
    console.warn(`[PixiTreeDebug][ScreenEffect] ${event}`, payload)
}

/**
 * Draw screen effect graphics (centered on container origin)
 * Supports full screen coverage + hole cutout (ellipse/circle/rectangle) + feathering
 * @param graphics PIXI.Graphics instance
 * @param params Effect parameters
 * @param width Effect width (pixels)
 * @param height Effect height (pixels)
 * @param container Parent container (optional, enables feather rendering when passed)
 */
export function drawScreenEffectGraphics(
    graphics: PIXI.Graphics,
    params: ScreenEffectParams,
    width: number,
    height: number,
    container?: PIXI.Container
): void {
    graphics.clear()

    // ── Light mode: do not draw overlay, add glowing sprite instead ──
    if (params.lightMode && container) {
        drawLightEffect(graphics, params, width, height, container)
        return
    }

    const color = params.baseColor ?? '#000000'
    const opacity = 1.0 // Overlay opacity is uniformly controlled by container alpha
    const colorNum = parseInt(color.replace('#', ''), 16)
    const feather = params.feather ?? 0

    // Draw overlay rectangle centered at container origin
    const halfW = width / 2
    const halfH = height / 2

    // Clean up existing feather Sprite
    if (container) {
        const existing = container.getChildByName(FEATHER_SPRITE_NAME)
        if (existing) {
            logPixiTree('remove_feather_sprite', {
                containerName: container.name,
                existingParent: existing.parent?.name ?? null,
                existingDestroyed: existing.destroyed,
                childrenCount: container.children.length,
            })
            container.removeChild(existing)
            existing.destroy({ children: true, texture: true, baseTexture: true })
        }
    }

    graphics.beginFill(colorNum, opacity)
    graphics.drawRect(-halfW, -halfH, width, height)

    // If hole parameters exist, cut hole (coordinates relative to effect center, 0,0 = effect center)
    if (params.holeShape && params.openRatio !== undefined && params.openRatio > 0) {
        const cx = params.holeCenterX ?? 0
        const cy = params.holeCenterY ?? 0
        const baseW = (params.holeWidth ?? 400) / 2
        const baseH = (params.holeHeight ?? 300) / 2
        // openRatio scales according to shape direction:
        // horizontal_ellipse (eyes): only scale height → simulate blinking (width constant)
        // vertical_ellipse (spotlight): only scale width → simulate spotlight narrowing (height constant)
        // circle / rectangle: uniform scaling on both axes
        let hw: number
        let hh: number
        switch (params.holeShape) {
            case 'horizontal_ellipse':
                hw = baseW
                hh = baseH * params.openRatio
                break
            case 'vertical_ellipse':
                hw = baseW * params.openRatio
                hh = baseH
                break
            default:
                hw = baseW * params.openRatio
                hh = baseH * params.openRatio
                break
        }

        if (hw > 0 && hh > 0) {
            if (feather > 0 && container) {
                // ── Feather hole: Canvas2D blur generates soft-edge texture + ERASE blend mode ──
                graphics.endFill()

                const featherCanvas = generateFeatherCanvas(params.holeShape, hw, hh, feather)
                const texture = PIXI.Texture.from(featherCanvas)
                const sprite = new PIXI.Sprite(texture)
                sprite.name = FEATHER_SPRITE_NAME
                sprite.anchor.set(0.5)
                sprite.position.set(cx, cy)
                sprite.blendMode = PIXI.BLEND_MODES.ERASE
                container.addChild(sprite)
                logPixiTree('add_feather_sprite', {
                    containerName: container.name,
                    spriteParent: sprite.parent?.name ?? null,
                    childrenCount: container.children.length,
                    holeShape: params.holeShape,
                    feather,
                })

                // ERASE blend mode requires container rendered to buffer (triggered via filter)
                ensureContainerBuffered(container)
                // Fix hitArea to overlay rectangle, preventing feather Sprite from affecting container bounds
                container.hitArea = new PIXI.Rectangle(-halfW, -halfH, width, height)
                return
            } else {
                // ── Hard-edge hole: traditional beginHole/endHole ──
                graphics.beginHole()
                switch (params.holeShape) {
                    case 'circle':
                        graphics.drawCircle(cx, cy, Math.min(hw, hh))
                        break
                    case 'horizontal_ellipse':
                    case 'vertical_ellipse':
                        graphics.drawEllipse(cx, cy, hw, hh)
                        break
                    case 'rectangle':
                        graphics.drawRect(cx - hw, cy - hh, hw * 2, hh * 2)
                        break
                }
                graphics.endHole()
            }
        }
    }

    graphics.endFill()

    // Remove buffer filter when no feathering
    if (container) {
        removeContainerBuffer(container)
        // Fix hitArea to overlay rectangle, preventing feather Sprite from affecting container bounds (selection box jump)
        container.hitArea = new PIXI.Rectangle(-halfW, -halfH, width, height)
    }
}


// ==================== Lighting Effect ====================

/**
 * Light mode: Adds glowing sprite to container (does not draw black overlay)
 * Uses Canvas2D radial gradient to generate light spot texture, overlaid onto scene via ADD/SCREEN blend modes
 */
function drawLightEffect(
    _graphics: PIXI.Graphics,
    params: ScreenEffectParams,
    width: number,
    height: number,
    container: PIXI.Container
): void {
    // Clean up existing light sprite
    const existing = container.getChildByName(LIGHT_SPRITE_NAME)
    if (existing) {
        logPixiTree('remove_light_sprite', {
            containerName: container.name,
            existingParent: existing.parent?.name ?? null,
            existingDestroyed: existing.destroyed,
            childrenCount: container.children.length,
        })
        container.removeChild(existing)
        existing.destroy({ children: true, texture: true, baseTexture: true })
    }

    if (!params.holeShape || !params.openRatio || params.openRatio <= 0) {
        removeContainerBuffer(container)
        return
    }

    const cx = params.holeCenterX ?? 0
    const cy = params.holeCenterY ?? 0
    const baseW = (params.holeWidth ?? 400) / 2
    const baseH = (params.holeHeight ?? 300) / 2

    // Scale according to shape direction (consistent with mask mode)
    let hw: number
    let hh: number
    switch (params.holeShape) {
        case 'horizontal_ellipse':
            hw = baseW
            hh = baseH * params.openRatio
            break
        case 'vertical_ellipse':
            hw = baseW * params.openRatio
            hh = baseH
            break
        default:
            hw = baseW * params.openRatio
            hh = baseH * params.openRatio
            break
    }

    if (hw <= 0 || hh <= 0) {
        removeContainerBuffer(container)
        return
    }

    const feather = params.feather ?? 50
    const lightColor = params.lightColor ?? '#ffffff'
    const falloff = params.lightFalloff ?? 'smooth'

    // Generate radial gradient light spot texture
    const lightCanvas = generateLightCanvas(params.holeShape, hw, hh, feather, lightColor, falloff)
    const texture = PIXI.Texture.from(lightCanvas)
    const sprite = new PIXI.Sprite(texture)
    sprite.name = LIGHT_SPRITE_NAME
    sprite.anchor.set(0.5)
    sprite.position.set(cx, cy)
    sprite.blendMode = params.lightMode === 'additive'
        ? PIXI.BLEND_MODES.ADD
        : PIXI.BLEND_MODES.SCREEN

    container.addChild(sprite)
    logPixiTree('add_light_sprite', {
        containerName: container.name,
        spriteParent: sprite.parent?.name ?? null,
        childrenCount: container.children.length,
        holeShape: params.holeShape,
        lightMode: params.lightMode ?? 'screen',
    })

    // ADD/SCREEN blend modes also require container rendered to buffer
    ensureContainerBuffered(container)

    // Fix hitArea (consistent with mask mode)
    const halfW = width / 2
    const halfH = height / 2
    container.hitArea = new PIXI.Rectangle(-halfW, -halfH, width, height)
}

/**
 * Uses Canvas2D radial gradient to generate light spot texture
 * Center is lightColor, edges fade to transparent
 */
function generateLightCanvas(
    _shape: string,
    halfWidth: number,
    halfHeight: number,
    feather: number,
    lightColor: string,
    falloff: string
): HTMLCanvasElement {
    const margin = Math.ceil(feather * 2)
    const totalW = halfWidth + margin
    const totalH = halfHeight + margin
    const canvasW = Math.max(4, Math.ceil(totalW * 2))
    const canvasH = Math.max(4, Math.ceil(totalH * 2))
    const canvas = document.createElement('canvas')
    canvas.width = canvasW
    canvas.height = canvasH
    const ctx = canvas.getContext('2d')!

    const cx = canvasW / 2
    const cy = canvasH / 2

    // For non-circles: use scale transform to convert ellipse gradient to circular gradient before drawing
    const maxR = Math.max(totalW, totalH)
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR)

    // Inner radius ratio (light spot core area, no attenuation)
    const coreRatio = Math.max(0, Math.min(0.95,
        Math.min(halfWidth, halfHeight) / maxR * 0.5
    ))

    // Set gradient color stops based on falloff curve
    switch (falloff) {
        case 'linear':
            gradient.addColorStop(0, lightColor)
            gradient.addColorStop(coreRatio, lightColor)
            gradient.addColorStop(1, 'rgba(0,0,0,0)')
            break
        case 'quadratic':
            gradient.addColorStop(0, lightColor)
            gradient.addColorStop(coreRatio, lightColor)
            gradient.addColorStop(coreRatio + (1 - coreRatio) * 0.3, lightColor + 'aa')
            gradient.addColorStop(coreRatio + (1 - coreRatio) * 0.6, lightColor + '44')
            gradient.addColorStop(1, 'rgba(0,0,0,0)')
            break
        case 'smooth':
        default:
            gradient.addColorStop(0, lightColor)
            gradient.addColorStop(coreRatio, lightColor + 'cc')
            gradient.addColorStop(coreRatio + (1 - coreRatio) * 0.4, lightColor + '66')
            gradient.addColorStop(coreRatio + (1 - coreRatio) * 0.7, lightColor + '22')
            gradient.addColorStop(1, 'rgba(0,0,0,0)')
            break
    }

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvasW, canvasH)

    return canvas
}


// ==================== Internal Helper Functions ====================

/**
 * Uses Canvas2D filter: blur() to generate feathered hole texture
 * Principle: Draw hard-edge shape on Canvas, achieve soft edge via CSS blur filter
 * Generated texture used as ERASE sprite, white area = erased (transparent hole)
 */
function generateFeatherCanvas(
    shape: string,
    halfWidth: number,
    halfHeight: number,
    feather: number
): HTMLCanvasElement {
    // Blur extends outward ~3x, allocate sufficient margin
    const margin = Math.ceil(feather * 3)
    const canvasW = Math.max(4, Math.ceil((halfWidth + margin) * 2))
    const canvasH = Math.max(4, Math.ceil((halfHeight + margin) * 2))
    const canvas = document.createElement('canvas')
    canvas.width = canvasW
    canvas.height = canvasH
    const ctx = canvas.getContext('2d')!

    const cx = canvasW / 2
    const cy = canvasH / 2

    // CSS blur filter automatically adds soft edges to drawn shapes, suitable for all shapes
    ctx.filter = `blur(${feather}px)`
    ctx.fillStyle = 'white'

    switch (shape) {
        case 'circle': {
            const r = Math.min(halfWidth, halfHeight)
            ctx.beginPath()
            ctx.arc(cx, cy, r, 0, Math.PI * 2)
            ctx.fill()
            break
        }
        case 'horizontal_ellipse':
        case 'vertical_ellipse': {
            ctx.beginPath()
            ctx.ellipse(cx, cy, halfWidth, halfHeight, 0, 0, Math.PI * 2)
            ctx.fill()
            break
        }
        case 'rectangle': {
            ctx.fillRect(cx - halfWidth, cy - halfHeight, halfWidth * 2, halfHeight * 2)
            break
        }
        default: {
            // Default fallback to ellipse
            ctx.beginPath()
            ctx.ellipse(cx, cy, halfWidth, halfHeight, 0, 0, Math.PI * 2)
            ctx.fill()
            break
        }
    }

    return canvas
}

/**
 * Ensure container has AlphaFilter so ERASE blend mode takes effect
 * PIXI ERASE requires container to be rendered to an isolated buffer (filter triggers this behavior)
 */
function ensureContainerBuffered(container: PIXI.Container): void {
    // Check if AlphaFilter we added already exists
    if (container.filters?.length) return
    container.filters = [new PIXI.AlphaFilter(1)]
}

/**
 * Remove AlphaFilter added exclusively for ERASE (when feathering is no longer needed)
 */
function removeContainerBuffer(container: PIXI.Container): void {
    if (
        container.filters?.length === 1 &&
        container.filters[0] instanceof PIXI.AlphaFilter
    ) {
        container.filters = null
    }
}
