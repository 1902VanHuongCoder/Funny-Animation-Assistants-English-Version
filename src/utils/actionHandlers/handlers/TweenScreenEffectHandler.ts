/**
 * TweenScreenEffect Action Handler (Phase 1)
 * Handles continuous easing of screen effect parameters
 * Directly operates on nested state.params structure (eliminating flat state intermediate layer)
 */

import type { ScreenEffectParams } from '@/types/sceneObject'
import type { TweenScreenEffectAction } from '@/types/screenplay'

import type { ActionHandler, ActionHandlerContext, WriteableState } from '../types'

/**
 * Linear interpolation
 */
function lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t
}

export const TweenScreenEffectHandler: ActionHandler<TweenScreenEffectAction> = {
    type: 'tween_screen_effect',
    isPointAction: false,
    isDurationAction: true,
    affectsObjectState: true,

    applyToState(state: WriteableState, action: TweenScreenEffectAction, _context?: ActionHandlerContext): void {
        // Instantaneous application: directly set to target values
        const { params } = action
        state.params ??= {} as ScreenEffectParams
        const p = state.params

        // coverOpacity deleted, uniformly controlled by alpha
        if (params.baseColor !== undefined) p.baseColor = params.baseColor
        if (params.holeShape !== undefined) p.holeShape = params.holeShape
        if (params.holeCenterX !== undefined) p.holeCenterX = params.holeCenterX
        if (params.holeCenterY !== undefined) p.holeCenterY = params.holeCenterY
        if (params.holeWidth !== undefined) p.holeWidth = params.holeWidth
        if (params.holeHeight !== undefined) p.holeHeight = params.holeHeight
        if (params.openRatio !== undefined) p.openRatio = params.openRatio
        if (params.feather !== undefined) p.feather = params.feather
        if (params.targetId !== undefined) p.targetId = params.targetId
        if (params.offsetX !== undefined) p.offsetX = params.offsetX
        if (params.offsetY !== undefined) p.offsetY = params.offsetY
    },

    interpolate(
        state: WriteableState,
        action: TweenScreenEffectAction,
        progress: number,
        startState: WriteableState
    ): void {
        const { params } = action
        state.params ??= {} as ScreenEffectParams
        const p = state.params
        const sp = startState.params

        // Linear interpolation for numeric parameters

        // coverOpacity deleted, opacity interpolation uniformly handled by alpha in tween_transform
        if (params.holeCenterX !== undefined && sp?.holeCenterX !== undefined) {
            p.holeCenterX = lerp(sp.holeCenterX, params.holeCenterX, progress)
        }
        if (params.holeCenterY !== undefined && sp?.holeCenterY !== undefined) {
            p.holeCenterY = lerp(sp.holeCenterY, params.holeCenterY, progress)
        }
        if (params.holeWidth !== undefined && sp?.holeWidth !== undefined) {
            p.holeWidth = lerp(sp.holeWidth, params.holeWidth, progress)
        }
        if (params.holeHeight !== undefined && sp?.holeHeight !== undefined) {
            p.holeHeight = lerp(sp.holeHeight, params.holeHeight, progress)
        }
        if (params.openRatio !== undefined && sp?.openRatio !== undefined) {
            p.openRatio = lerp(sp.openRatio, params.openRatio, progress)
        }
        if (params.feather !== undefined && sp?.feather !== undefined) {
            p.feather = lerp(sp.feather, params.feather, progress)
        }
        if (params.offsetX !== undefined && sp?.offsetX !== undefined) {
            p.offsetX = lerp(sp.offsetX, params.offsetX, progress)
        }
        if (params.offsetY !== undefined && sp?.offsetY !== undefined) {
            p.offsetY = lerp(sp.offsetY, params.offsetY, progress)
        }

        // Non-numeric parameters (baseColor, holeShape, targetId) are not interpolated, switched when progress >= 1
        if (progress >= 1) {
            if (params.baseColor !== undefined) p.baseColor = params.baseColor
            if (params.holeShape !== undefined) p.holeShape = params.holeShape
            if (params.targetId !== undefined) p.targetId = params.targetId
        }
    },

    getTargetState(state: WriteableState, action: TweenScreenEffectAction): void {
        // Same as applyToState
        this.applyToState(state, action)
    }
}
