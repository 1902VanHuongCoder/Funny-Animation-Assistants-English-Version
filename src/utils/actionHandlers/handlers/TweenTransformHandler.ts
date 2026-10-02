/**
 * TweenTransform Action Handler
 * Handles continuous transformation of position / scale / rotation / alpha
 *
 * v17/v27:
 * - x/y stored in global coordinates, converted back to local coordinates under current parent during playback
 * - rotation/scale stored and interpolated using the object's local values
 */

import type { TweenTransformAction } from '@/types/screenplay'

import { globalToLocal } from '../matrixUtils'
import type { ActionHandler, ActionHandlerContext, WriteableState } from '../types'
import { decomposeMatrixForState, resolveWorldMatrix } from './SetParentHandler'

/**
 * Linear interpolation
 */
function lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t
}

export const TweenTransformHandler: ActionHandler<TweenTransformAction> = {
    type: 'tween_transform',
    isPointAction: false,
    isDurationAction: true,
    affectsObjectState: true,

    applyToState(state: WriteableState, action: TweenTransformAction, context?: ActionHandlerContext): void {
        // Instantaneous application:
        // - x/y: global → local
        // - rotation/scale: directly apply local values
        const { params } = action

        const positionParams: { x?: number; y?: number } = {}
        if (params.x !== undefined) positionParams.x = params.x
        if (params.y !== undefined) positionParams.y = params.y
        const coordinateBasis: WriteableState = {
            ...state,
            ...(params.scaleX !== undefined ? { scaleX: params.scaleX } : {}),
            ...(params.scaleY !== undefined ? { scaleY: params.scaleY } : {}),
            ...(params.rotation !== undefined ? { rotation: params.rotation } : {}),
        }
        const localPosition = globalToLocal(positionParams, coordinateBasis, context?.getObjectState)
        if (localPosition.x !== undefined) state.x = localPosition.x
        if (localPosition.y !== undefined) state.y = localPosition.y
        if (params.scaleX !== undefined) state.scaleX = params.scaleX
        if (params.scaleY !== undefined) state.scaleY = params.scaleY
        if (params.rotation !== undefined) state.rotation = params.rotation
        // alpha is unaffected by coordinate systems
        if (params.alpha !== undefined) state.alpha = params.alpha
    },

    interpolate(
        state: WriteableState,
        action: TweenTransformAction,
        progress: number,
        startState: WriteableState,
        context?: ActionHandlerContext
    ): void {
        const { params } = action

        // Fast path: no parent → position and pose can directly interpolate with original values
        if (!state.parentId || !context?.getObjectState) {
            if (params.x !== undefined && startState.x !== undefined) {
                state.x = lerp(startState.x, params.x, progress)
            }
            if (params.y !== undefined && startState.y !== undefined) {
                state.y = lerp(startState.y, params.y, progress)
            }
            if (params.scaleX !== undefined && startState.scaleX !== undefined) {
                state.scaleX = lerp(startState.scaleX, params.scaleX, progress)
            }
            if (params.scaleY !== undefined && startState.scaleY !== undefined) {
                state.scaleY = lerp(startState.scaleY, params.scaleY, progress)
            }
            if (params.rotation !== undefined && startState.rotation !== undefined) {
                state.rotation = lerp(startState.rotation, params.rotation, progress)
            }
            if (params.alpha !== undefined && startState.alpha !== undefined) {
                state.alpha = lerp(startState.alpha, params.alpha, progress)
            }
            return
        }

        // Has parent:
        // - x/y interpolated in global space, result converted back to local
        // - rotation/scale directly interpolated in local space
        const getObj = context.getObjectState

        // 1. startState local → global
        const startWorld = resolveWorldMatrix(startState, getObj)
        const startDecomp = decomposeMatrixForState(startWorld, startState)

        // 2. Position components interpolated independently in global space
        const globalResult: { x?: number; y?: number } = {}
        if (params.x !== undefined) {
            globalResult.x = lerp(startDecomp.x, params.x, progress)
        }
        if (params.y !== undefined) {
            globalResult.y = lerp(startDecomp.y, params.y, progress)
        }

        const basisState: WriteableState = { ...state }
        if (params.scaleX !== undefined && startState.scaleX !== undefined) {
            basisState.scaleX = lerp(startState.scaleX, params.scaleX, progress)
        }
        if (params.scaleY !== undefined && startState.scaleY !== undefined) {
            basisState.scaleY = lerp(startState.scaleY, params.scaleY, progress)
        }
        if (params.rotation !== undefined && startState.rotation !== undefined) {
            basisState.rotation = lerp(startState.rotation, params.rotation, progress)
        }

        // 3. Position: global → local
        const localPosition = globalToLocal(globalResult, basisState, getObj)
        if (localPosition.x !== undefined) state.x = localPosition.x
        if (localPosition.y !== undefined) state.y = localPosition.y
        if (params.scaleX !== undefined && basisState.scaleX !== undefined) state.scaleX = basisState.scaleX
        if (params.scaleY !== undefined && basisState.scaleY !== undefined) state.scaleY = basisState.scaleY
        if (params.rotation !== undefined && basisState.rotation !== undefined) state.rotation = basisState.rotation

        // alpha directly interpolated (unaffected by coordinate systems)
        if (params.alpha !== undefined && startState.alpha !== undefined) {
            state.alpha = lerp(startState.alpha, params.alpha, progress)
        }
    },

    getTargetState(state: WriteableState, action: TweenTransformAction): void {
        // Same as applyToState
        this.applyToState(state, action)
    }
}
