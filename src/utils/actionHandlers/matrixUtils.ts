/**
 * Global Coordinates ↔ Local Coordinates Conversion Utilities
 * v17: Provides unified coordinate transformation functions for global coordinate schemes
 *
 * Matrix utility functions (resolveWorldMatrix / invertMatrix / decomposeMatrix / buildTransformMatrix)
 * are defined and exported in SetParentHandler.ts; this module encapsulates high-level conversion interfaces on top.
 */

import {
    buildTransformMatrix,
    decomposeMatrixForState,
    resolveWorldMatrix,
} from './handlers/SetParentHandler'
import type { WriteableState } from './types'

/**
 * Convert global coordinates to local coordinates under the state's current parent
 *
 * - When state.parentId is empty: global = local, return original values directly
 * - When state.parentId has value: transform via inverse matrix of parent chain world matrix
 *
 * @param globalParams Global coordinate parameters (some properties optional)
 * @param state Target object's current runtime state (must contain parentId)
 * @param getObjectState Callback to query object state
 * @returns Converted local coordinate parameters
 */
export function globalToLocal(
    globalParams: { x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number },
    state: WriteableState,
    getObjectState?: (id: string) => WriteableState | undefined
): { x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number } {
    // Fast path: No parent -> global coordinates = local coordinates
    if (!state.parentId || !getObjectState) {
        return globalParams
    }

    const parentState = getObjectState(state.parentId)
    if (!parentState) {
        return globalParams
    }

    const parentWorldMatrix = resolveWorldMatrix(parentState, getObjectState)
    const invParent = invertMatrix(parentWorldMatrix)

    // Key fix: For missing globalParams, use global equivalent of state's current local value as fallback
    // Avoid mixing global parameters and local parameters into the same matrix
    const currentWorldMatrix = resolveWorldMatrix(state, getObjectState)
    const currentGlobal = decomposeMatrixForState(currentWorldMatrix, state)

    const globalMatrixState: WriteableState = {
        x: globalParams.x ?? currentGlobal.x,
        y: globalParams.y ?? currentGlobal.y,
        scaleX: globalParams.scaleX ?? currentGlobal.scaleX,
        scaleY: globalParams.scaleY ?? currentGlobal.scaleY,
        rotation: globalParams.rotation ?? currentGlobal.rotation,
    }
    if (state.flipX !== undefined) globalMatrixState.flipX = state.flipX
    if (state.transformOriginX !== undefined) globalMatrixState.transformOriginX = state.transformOriginX
    if (state.transformOriginY !== undefined) globalMatrixState.transformOriginY = state.transformOriginY

    const globalMatrix = buildTransformMatrix(globalMatrixState)

    const localMatrix = multiplyMatrix(invParent, globalMatrix)
    const local = decomposeMatrixForState(localMatrix, state)

    // Only return properties explicitly provided in globalParams
    const result: { x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number } = {}
    if (globalParams.x !== undefined) result.x = local.x
    if (globalParams.y !== undefined) result.y = local.y
    if (globalParams.scaleX !== undefined) result.scaleX = local.scaleX
    if (globalParams.scaleY !== undefined) result.scaleY = local.scaleY
    if (globalParams.rotation !== undefined) result.rotation = local.rotation
    return result
}

/**
 * Resolve state's local coordinates to global coordinates
 *
 * @param state Object state containing local coordinates
 * @param getObjectState Callback to query object state
 * @returns Geometric properties in global coordinates
 */
export function localToGlobal(
    state: WriteableState,
    getObjectState?: (id: string) => WriteableState | undefined
): { x: number; y: number; scaleX: number; scaleY: number; rotation: number } {
    if (!state.parentId || !getObjectState) {
        return {
            x: state.x ?? 0,
            y: state.y ?? 0,
            scaleX: state.scaleX ?? 1,
            scaleY: state.scaleY ?? 1,
            rotation: state.rotation ?? 0,
        }
    }

    const worldMatrix = resolveWorldMatrix(state, getObjectState)
    return decomposeMatrixForState(worldMatrix, state)
}

// ==================== Internal Matrix Utilities ====================
// multiplyMatrix and invertMatrix are not exported from SetParentHandler
// Copied implementation here to avoid modifying SetParentHandler exports

/** 2D Affine Transformation Matrix */
interface Transform2D {
    a: number
    b: number
    c: number
    d: number
    tx: number
    ty: number
}

function multiplyMatrix(parent: Transform2D, child: Transform2D): Transform2D {
    return {
        a: parent.a * child.a + parent.c * child.b,
        b: parent.b * child.a + parent.d * child.b,
        c: parent.a * child.c + parent.c * child.d,
        d: parent.b * child.c + parent.d * child.d,
        tx: parent.a * child.tx + parent.c * child.ty + parent.tx,
        ty: parent.b * child.tx + parent.d * child.ty + parent.ty,
    }
}

function invertMatrix(m: Transform2D): Transform2D {
    const det = m.a * m.d - m.b * m.c
    if (Math.abs(det) < 1e-10) {
        return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
    }
    const invDet = 1 / det
    return {
        a: m.d * invDet,
        b: -m.b * invDet,
        c: -m.c * invDet,
        d: m.a * invDet,
        tx: (m.c * m.ty - m.d * m.tx) * invDet,
        ty: (m.b * m.tx - m.a * m.ty) * invDet,
    }
}
