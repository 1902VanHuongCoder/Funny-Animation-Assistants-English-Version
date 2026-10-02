/**
 * Transform matrix utilities.
 *
 * Runtime hierarchy changes are represented by scene-level set_scene_structure
 * actions. This module keeps the shared matrix helpers used by hierarchy,
 * tween, and composite rendering code.
 */

import type { WriteableState } from '../types'

// ==================== Transform Matrix Utilities ====================

/** 2D affine transformation matrix [a, b, c, d, tx, ty] */
interface Transform2D {
    a: number   // scaleX * cos(rotation)
    b: number   // scaleX * sin(rotation)
    c: number   // -scaleY * sin(rotation)
    d: number   // scaleY * cos(rotation)
    tx: number  // x
    ty: number  // y
}

/**
 * Build affine matrix from WriteableState
 * Transformation order: Scale → Rotate → Translate
 */
export function buildTransformMatrix(state: WriteableState): Transform2D {
    const x = state.x ?? 0
    const y = state.y ?? 0
    const rawScaleX = state.scaleX ?? 1
    const scaleY = state.scaleY ?? 1
    const rotation = state.rotation ?? 0
    // v19.2: Bake flipX into scaleX (consistent with compositeTransform.ts)
    const flipX = (state.flipX) ?? false
    const effScaleX = rawScaleX * (flipX ? -1 : 1)

    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const originX = state.transformOriginX ?? 0
    const originY = state.transformOriginY ?? 0
    const originPositionX = flipX ? -originX : originX
    const originPositionY = originY
    const a = effScaleX * cos
    const b = effScaleX * sin
    const c = -scaleY * sin
    const d = scaleY * cos

    return {
        a,
        b,
        c,
        d,
        tx: x + originPositionX - (a * originX + c * originY),
        ty: y + originPositionY - (b * originX + d * originY),
    }
}

/**
 * Matrix multiplication: parent * child → world
 */
export function multiplyMatrix(parent: Transform2D, child: Transform2D): Transform2D {
    return {
        a: parent.a * child.a + parent.c * child.b,
        b: parent.b * child.a + parent.d * child.b,
        c: parent.a * child.c + parent.c * child.d,
        d: parent.b * child.c + parent.d * child.d,
        tx: parent.a * child.tx + parent.c * child.ty + parent.tx,
        ty: parent.b * child.tx + parent.d * child.ty + parent.ty,
    }
}

/**
 * Matrix inversion
 */
export function invertMatrix(m: Transform2D): Transform2D {
    const det = m.a * m.d - m.b * m.c
    if (Math.abs(det) < 1e-10) {
        // Singular matrix (scale is 0), return identity matrix
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

/**
 * Extract x, y, scaleX, scaleY, rotation from affine matrix
 *
 * v19.2: When det < 0 (reflection), the negative sign is placed on scaleX, and rotation angle is corrected using atan2(-b, -a).
 * This avoids misinterpreting pure X flip as a 180° rotation (the atan2(0, -1) = π pitfall).
 * Kept consistent with decomposeMatrix in compositeTransform.ts.
 */
export function decomposeMatrix(m: Transform2D): {
    x: number; y: number; scaleX: number; scaleY: number; rotation: number
} {
    const x = m.tx
    const y = m.ty
    const scaleXRaw = Math.sqrt(m.a * m.a + m.b * m.b)
    const scaleY = Math.sqrt(m.c * m.c + m.d * m.d)
    const det = m.a * m.d - m.b * m.c

    let scaleX: number
    let rotation: number

    if (det < 0) {
        // Negative determinant = reflection (flipX), put negative sign on scaleX
        scaleX = -scaleXRaw
        // atan2(b, a) has extra π when a<0 (misinterpreting flipX as 180° rotation)
        // Compensate with atan2(-b, -a)
        rotation = Math.atan2(-m.b, -m.a)
    } else {
        scaleX = scaleXRaw
        rotation = Math.atan2(m.b, m.a)
    }

    return { x, y, scaleX, scaleY, rotation }
}

/**
 * Decomposes render matrix back into WriteableState coordinates.
 *
 * Like SceneObjectRenderer, buildTransformMatrix converts transformOriginX/Y
 * into PIXI pivot + position compensation; directly calling decomposeMatrix would treat
 * compensated tx/ty as state.x/y, causing the renderer to compensate a second time.
 * Here we invert back to state coordinates using the identical formula.
 */
export function decomposeMatrixForState(
    m: Transform2D,
    state: WriteableState
): { x: number; y: number; scaleX: number; scaleY: number; rotation: number } {
    const decomposed = decomposeMatrix(m)
    const originX = state.transformOriginX ?? 0
    const originY = state.transformOriginY ?? 0
    if (originX === 0 && originY === 0) {
        return decomposed
    }

    const flipX = decomposed.scaleX < 0
    const cos = Math.cos(decomposed.rotation)
    const sin = Math.sin(decomposed.rotation)
    const a = decomposed.scaleX * cos
    const b = decomposed.scaleX * sin
    const c = -decomposed.scaleY * sin
    const d = decomposed.scaleY * cos
    const originPositionX = flipX ? -originX : originX
    const originPositionY = originY

    return {
        ...decomposed,
        x: m.tx - originPositionX + (a * originX + c * originY),
        y: m.ty - originPositionY + (b * originX + d * originY),
    }
}

/**
 * Recursively resolves world transform matrix of an object
 * Traverses up the parentId chain, combining transformations layer by layer
 */
export function resolveWorldMatrix(
    state: WriteableState,
    getObjectState: (id: string) => WriteableState | undefined
): Transform2D {
    const localMatrix = buildTransformMatrix(state)

    if (!state.parentId) {
        return localMatrix
    }

    const parentState = getObjectState(state.parentId)
    if (!parentState) {
        return localMatrix
    }

    const parentWorldMatrix = resolveWorldMatrix(parentState, getObjectState)
    return multiplyMatrix(parentWorldMatrix, localMatrix)
}

// This module now only exports matrix utilities. Runtime parent changes are
// represented by scene-level set_scene_structure actions, not object-level handlers.
