/**
 * TransformPivotCompensation.spec.ts
 *
 * Verification: After pivot change, compensation formula preserves "image center world position" at each keyframe.
 */

import { describe, expect, it } from 'vitest'

import {
    compensateTrackKeyframesForPivotChange,
    type PivotCompensationBaseObject,
} from '@/core/TransformPivotCompensation'
import type { TransformTrack } from '@/types/animation'

/**
 * Computes image center world position for given keyframe under a specific pivot.
 * Simulates PIXI container transform order:
 *   world = storePos + R(rot) · S(scale) · (0 − pivot) + flipSign · pivot_correction
 *
 * To align with actual implementation in useSceneRenderer, this uses
 * derivation consistent with applyTransformOriginPivot:
 *   container.pivot = PivotBase + origin
 *   container.position = storeX + flipSign·originX
 * Therefore world position of image center (at PivotBase):
 *   V = (storeX + f·origin) + R·S·(PivotBase − (PivotBase+origin))
 *     = storeX + f·origin − R·S·origin
 *
 * After compensation storeX' = storeX + adjust, keeping V constant.
 */
function computeCenterWorldPos(
    storeX: number,
    storeY: number,
    origin: { x: number; y: number },
    baseObj: PivotCompensationBaseObject,
    kf: { rotation?: number; scaleX?: number; scaleY?: number; flipX?: boolean },
): { x: number; y: number } {
    const baseFlipSign = baseObj.flipX ? -1 : 1
    const kfFlipFactor = (kf.flipX ?? false) ? -1 : 1
    const sx = baseObj.scaleX * baseFlipSign * (kf.scaleX ?? 1) * kfFlipFactor
    const sy = baseObj.scaleY * (kf.scaleY ?? 1)
    const rot = baseObj.rotation + (kf.rotation ?? 0)
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)

    // (R·S) · (-origin)
    const rx = -origin.x * sx * cos + origin.y * sy * sin
    const ry = -origin.x * sx * sin - origin.y * sy * cos

    return {
        x: storeX + baseFlipSign * origin.x + rx,
        y: storeY + origin.y + ry,
    }
}

describe('TransformPivotCompensation', () => {
    it('does not modify keyframe when delta pivot is 0', () => {
        const track: TransformTrack = {
            trackType: 'transform',
            keyframes: [{ time: 0, x: 1, y: 2, rotation: 0.5 }],
        }
        const baseObj: PivotCompensationBaseObject = { rotation: 0, scaleX: 1, scaleY: 1 }
        const changed = compensateTrackKeyframesForPivotChange(
            track,
            baseObj,
            { x: 10, y: 20 },
            { x: 10, y: 20 },
        )
        expect(changed).toBe(0)
        expect(track.keyframes[0]!.x).toBe(1)
        expect(track.keyframes[0]!.y).toBe(2)
    })

    it('center position remains constant after compensation without rotation or scale', () => {
        const track: TransformTrack = {
            trackType: 'transform',
            keyframes: [{ time: 0.5, x: 5, y: -3, rotation: 0 }],
        }
        const baseObj: PivotCompensationBaseObject = { rotation: 0, scaleX: 1, scaleY: 1 }
        const storeBaseX = 100
        const storeBaseY = 200

        const kf = track.keyframes[0]!
        const oldPivot = { x: 10, y: 10 }
        const newPivot = { x: 30, y: -5 }
        const beforeCenter = computeCenterWorldPos(
            storeBaseX + (kf.x ?? 0),
            storeBaseY + (kf.y ?? 0),
            oldPivot,
            baseObj,
            kf,
        )
        compensateTrackKeyframesForPivotChange(track, baseObj, oldPivot, newPivot)
        const afterCenter = computeCenterWorldPos(
            storeBaseX + (kf.x ?? 0),
            storeBaseY + (kf.y ?? 0),
            newPivot,
            baseObj,
            kf,
        )
        expect(afterCenter.x).toBeCloseTo(beforeCenter.x, 6)
        expect(afterCenter.y).toBeCloseTo(beforeCenter.y, 6)
    })

    it('center position remains constant after compensation when keyframe has rotation', () => {
        const track: TransformTrack = {
            trackType: 'transform',
            keyframes: [
                { time: 0, x: 0, y: 0, rotation: 0 },
                { time: 1, x: 0, y: 0, rotation: Math.PI / 3 },
            ],
        }
        const baseObj: PivotCompensationBaseObject = { rotation: 0, scaleX: 1, scaleY: 1 }
        const storeBaseX = 100
        const storeBaseY = 200
        const oldPivot = { x: 0, y: 0 }
        const newPivot = { x: 25, y: 40 }

        const kfs = track.keyframes.map(k => ({ ...k }))
        const before = kfs.map(kf =>
            computeCenterWorldPos(storeBaseX + (kf.x ?? 0), storeBaseY + (kf.y ?? 0), oldPivot, baseObj, kf),
        )

        compensateTrackKeyframesForPivotChange(track, baseObj, oldPivot, newPivot)

        const after = track.keyframes.map(kf =>
            computeCenterWorldPos(storeBaseX + (kf.x ?? 0), storeBaseY + (kf.y ?? 0), newPivot, baseObj, kf),
        )

        for (let i = 0; i < before.length; i++) {
            expect(after[i]!.x).toBeCloseTo(before[i]!.x, 6)
            expect(after[i]!.y).toBeCloseTo(before[i]!.y, 6)
        }
    })

    it('center position remains constant when base object has rotation and keyframe has scale', () => {
        const track: TransformTrack = {
            trackType: 'transform',
            keyframes: [
                { time: 0, x: 10, y: 20, scaleX: 1.5, scaleY: 0.8, rotation: Math.PI / 4 },
            ],
        }
        const baseObj: PivotCompensationBaseObject = { rotation: Math.PI / 6, scaleX: 1.2, scaleY: 1.1 }
        const storeBaseX = 50
        const storeBaseY = -30
        const oldPivot = { x: 5, y: 5 }
        const newPivot = { x: -10, y: 15 }

        const kf = track.keyframes[0]!
        const before = computeCenterWorldPos(
            storeBaseX + (kf.x ?? 0),
            storeBaseY + (kf.y ?? 0),
            oldPivot,
            baseObj,
            kf,
        )
        compensateTrackKeyframesForPivotChange(track, baseObj, oldPivot, newPivot)
        const after = computeCenterWorldPos(
            storeBaseX + (kf.x ?? 0),
            storeBaseY + (kf.y ?? 0),
            newPivot,
            baseObj,
            kf,
        )
        expect(after.x).toBeCloseTo(before.x, 6)
        expect(after.y).toBeCloseTo(before.y, 6)
    })

    it('compensation formula direction is correct when base flipX=true', () => {
        const track: TransformTrack = {
            trackType: 'transform',
            keyframes: [{ time: 0, x: 0, y: 0, rotation: Math.PI / 5 }],
        }
        const baseObj: PivotCompensationBaseObject = { rotation: 0, scaleX: 1, scaleY: 1, flipX: true }
        const storeBaseX = 0
        const storeBaseY = 0
        const oldPivot = { x: 0, y: 0 }
        const newPivot = { x: 20, y: 10 }

        const kf = track.keyframes[0]!
        const before = computeCenterWorldPos(
            storeBaseX + (kf.x ?? 0),
            storeBaseY + (kf.y ?? 0),
            oldPivot,
            baseObj,
            kf,
        )
        compensateTrackKeyframesForPivotChange(track, baseObj, oldPivot, newPivot)
        const after = computeCenterWorldPos(
            storeBaseX + (kf.x ?? 0),
            storeBaseY + (kf.y ?? 0),
            newPivot,
            baseObj,
            kf,
        )
        expect(after.x).toBeCloseTo(before.x, 6)
        expect(after.y).toBeCloseTo(before.y, 6)
    })
})
