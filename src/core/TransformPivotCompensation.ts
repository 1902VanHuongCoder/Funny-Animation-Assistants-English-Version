/**
 * TransformPivotCompensation
 *
 * When the pivot (transform origin) of a transform track changes, compensates (x, y) displacement
 * keyframe by keyframe to ensure the visual center position of the image does not jump at any keyframe.
 *
 * Formula (equivalent to store.x/y compensation in useSceneRenderer non-delegated setup branch):
 *     Δorigin = newPivot - oldPivot
 *     sx = baseObj.scaleX * baseFlipSign * kf.scaleX * kfFlipFactor
 *     sy = baseObj.scaleY * kf.scaleY
 *     rot = baseObj.rotation + kf.rotation
 *     adjustX = Δorigin.x * (sx * cos(rot) − baseFlipSign) − Δorigin.y * sy * sin(rot)
 *     adjustY = Δorigin.x * sx * sin(rot)             + Δorigin.y * (sy * cos(rot) − 1)
 *
 * Designed as a pure function without side effects (modifies input track keyframes.x/y in place) for easy unit testing.
 */

import type { TransformKeyframe, TransformTrack } from '@/types/animation'

export interface PivotCompensationBaseObject {
    rotation: number
    scaleX: number
    scaleY: number
    flipX?: boolean | undefined
}

export interface Vec2 {
    x: number
    y: number
}

/**
 * Apply pivot change position compensation to every keyframe of the track.
 *
 * @param track     Transform track (modifies keyframes.x/y in place)
 * @param baseObj   Base posture of target object (rotation/scale/flipX at time of animation mounting)
 * @param oldPivot  Old pivot (local pixels)
 * @param newPivot  New pivot (local pixels)
 * @returns         Number of keyframes actually compensated (returns 0 when Δ is less than threshold)
 */
export function compensateTrackKeyframesForPivotChange(
    track: TransformTrack,
    baseObj: PivotCompensationBaseObject,
    oldPivot: Vec2,
    newPivot: Vec2,
    epsilon = 1e-6,
): number {
    const dOriginX = newPivot.x - oldPivot.x
    const dOriginY = newPivot.y - oldPivot.y

    if (Math.abs(dOriginX) <= epsilon && Math.abs(dOriginY) <= epsilon) {
        return 0
    }

    const baseFlipSign = baseObj.flipX ? -1 : 1
    const baseScaleXSigned = baseObj.scaleX * baseFlipSign
    const baseScaleY = baseObj.scaleY
    const baseRotation = baseObj.rotation

    let compensated = 0
    for (const kf of track.keyframes) {
        compensated += applyPivotCompensationToKeyframe(
            kf,
            { baseFlipSign, baseScaleXSigned, baseScaleY, baseRotation },
            dOriginX,
            dOriginY,
        )
    }
    return compensated
}

interface KeyframeCompensationCtx {
    baseFlipSign: number
    baseScaleXSigned: number
    baseScaleY: number
    baseRotation: number
}

function applyPivotCompensationToKeyframe(
    kf: TransformKeyframe,
    ctx: KeyframeCompensationCtx,
    dOriginX: number,
    dOriginY: number,
): number {
    const kfFlipFactor = (kf.flipX ?? false) ? -1 : 1
    const sx = ctx.baseScaleXSigned * (kf.scaleX ?? 1) * kfFlipFactor
    const sy = ctx.baseScaleY * (kf.scaleY ?? 1)
    const rot = ctx.baseRotation + (kf.rotation ?? 0)
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    const adjustX = dOriginX * (sx * cos - ctx.baseFlipSign) - dOriginY * sy * sin
    const adjustY = dOriginX * sx * sin + dOriginY * (sy * cos - 1)
    kf.x = (kf.x ?? 0) + adjustX
    kf.y = (kf.y ?? 0) + adjustY
    return 1
}
