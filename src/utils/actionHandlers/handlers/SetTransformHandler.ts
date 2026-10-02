/**
 * SetTransform Action Handler (Updated in v9.3)
 * Handles geometric transform properties: x, y, scaleX, scaleY, rotation, alpha
 * 
 * v17/v27:
 * - x/y stored in global coordinates, converted to local coordinates under current parent on applyToState
 * - rotation/scale/transformOrigin stored and applied using the object's local values
 * 
 * Note: visible/flipX/zIndex have been moved to SetVisualHandler
 *       spawned has been moved to SetLifecycleHandler
 */

import type { SetTransformAction } from '@/types/screenplay'

import { globalToLocal } from '../matrixUtils'
import type { ActionHandler, ActionHandlerContext, WriteableState } from '../types'

function applyTransformOriginCompensation(state: WriteableState, nextOriginX: number, nextOriginY: number): void {
    const prevOriginX = state.transformOriginX ?? 0
    const prevOriginY = state.transformOriginY ?? 0
    const deltaOffsetX = nextOriginX - prevOriginX
    const deltaOffsetY = nextOriginY - prevOriginY

    if (Math.abs(deltaOffsetX) < 0.01 && Math.abs(deltaOffsetY) < 0.01) {
        return
    }

    const rotation = state.rotation ?? 0
    const flipSign = (state.flipX ?? false) ? -1 : 1
    const effectiveSx = (state.scaleX ?? 1) * flipSign
    const sy = state.scaleY ?? 1
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)

    const adjustX = deltaOffsetX * (effectiveSx * cos - flipSign) - deltaOffsetY * sy * sin
    const adjustY = deltaOffsetX * effectiveSx * sin + deltaOffsetY * (sy * cos - 1)

    if (Math.abs(adjustX) > 0.01) {
        state.x = (state.x ?? 0) + adjustX
    }
    if (Math.abs(adjustY) > 0.01) {
        state.y = (state.y ?? 0) + adjustY
    }
}

export const SetTransformHandler: ActionHandler<SetTransformAction> = {
    type: 'set_transform',
    isPointAction: true,
    isDurationAction: false,
    affectsObjectState: true,

    applyToState(state: WriteableState, action: SetTransformAction, context?: ActionHandlerContext): void {
        const { params } = action

        // Only position uses global → local conversion; pose parameters preserve local semantics
        const positionParams: { x?: number; y?: number } = {}
        if (params.x !== undefined) positionParams.x = params.x
        if (params.y !== undefined) positionParams.y = params.y
        const coordinateBasis: WriteableState = {
            ...state,
            ...(params.scaleX !== undefined ? { scaleX: params.scaleX } : {}),
            ...(params.scaleY !== undefined ? { scaleY: params.scaleY } : {}),
            ...(params.rotation !== undefined ? { rotation: params.rotation } : {}),
            ...(params.transformOriginX !== undefined ? { transformOriginX: params.transformOriginX } : {}),
            ...(params.transformOriginY !== undefined ? { transformOriginY: params.transformOriginY } : {}),
        }
        const localPosition = globalToLocal(positionParams, coordinateBasis, context?.getObjectState)

        // Geometric properties (v9.3: Only handles geometric transforms and opacity)
        if (localPosition.x !== undefined) state.x = localPosition.x
        if (localPosition.y !== undefined) state.y = localPosition.y
        if (params.scaleX !== undefined) state.scaleX = params.scaleX
        if (params.scaleY !== undefined) state.scaleY = params.scaleY
        if (params.rotation !== undefined) state.rotation = params.rotation
        // alpha is unaffected by coordinate systems
        if (params.alpha !== undefined) state.alpha = params.alpha
        // When the action only moves the pivot, perform instantaneous position compensation once
        // to prevent dragging pivot alone from altering current visual placement. If the same action
        // also contains rotation/scale, visible changes should occur around the new pivot;
        // if it contains x/y, the explicit position is the final constraint.
        const hasOriginOverride = params.transformOriginX !== undefined || params.transformOriginY !== undefined
        const hasExplicitPosition = localPosition.x !== undefined || localPosition.y !== undefined
        const hasOriginDrivenTransform =
            params.rotation !== undefined ||
            params.scaleX !== undefined ||
            params.scaleY !== undefined
        if (hasOriginOverride && !hasExplicitPosition && !hasOriginDrivenTransform) {
            applyTransformOriginCompensation(
                state,
                params.transformOriginX ?? (state.transformOriginX ?? 0),
                params.transformOriginY ?? (state.transformOriginY ?? 0),
            )
        }
        // Transform origin override (pixel offset, unaffected by coordinate system)
        if (params.transformOriginX !== undefined) state.transformOriginX = params.transformOriginX
        if (params.transformOriginY !== undefined) state.transformOriginY = params.transformOriginY
    }
}
