/**
 * useAnimationEdit — Scheme B (v13 valueIn/valueOut split) editing API unit tests
 *
 * Covers: splitKeyframeAt / mergeKeyframeAt / isKeyframeStructurallySplit
 *      / updateKeyframeOut / updateVisibilityKeyframeOut
 * And: persistence round-trip (JSON serialization/deserialization retains `out` field)
 */

import { describe, expect, it } from 'vitest'

import type { AnimationDefinition, TransformKeyframe, VisibilityKeyframe } from '@/types/animation'

import { useAnimationEdit } from '../useAnimationEdit'

function makeTransformAnim(): AnimationDefinition {
    const kfs: TransformKeyframe[] = [
        { time: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        { time: 0.5, x: 100, y: 50, scaleX: 2, scaleY: 2, rotation: 1 },
        { time: 1, x: 200, y: 100, scaleX: 1, scaleY: 1, rotation: 0 },
    ]
    return {
        id: 'anim-test',
        type: 'track',
        name: 'test',
        loop: false,
        createdAt: 0,
        updatedAt: 0,
        tracks: [
            {
                trackType: 'transform',
                duration: 1000,
                easing: 'linear',
                keyframes: kfs,
            },
        ],
    }
}

function makeVisibilityAnim(): AnimationDefinition {
    const kfs: VisibilityKeyframe[] = [
        { time: 0, alpha: 1 },
        { time: 0.5, alpha: 0.5 },
        { time: 1, alpha: 0 },
    ]
    return {
        id: 'anim-vis',
        type: 'track',
        name: 'vis',
        loop: false,
        createdAt: 0,
        updatedAt: 0,
        tracks: [
            {
                trackType: 'visibility',
                duration: 1000,
                easing: 'linear',
                keyframes: kfs,
            },
        ],
    }
}

function makeMixedAnim(): AnimationDefinition {
    return {
        id: 'anim-mixed',
        type: 'track',
        name: 'mixed',
        loop: false,
        createdAt: 0,
        updatedAt: 0,
        tracks: [
            {
                trackType: 'transform',
                duration: 1000,
                easing: 'linear',
                keyframes: [
                    { time: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
                    { time: 0.5, x: 100, y: 50, scaleX: 2, scaleY: 2, rotation: 1 },
                    { time: 1, x: 200, y: 100, scaleX: 1, scaleY: 1, rotation: 0 },
                ],
            },
            {
                trackType: 'visibility',
                duration: 1000,
                easing: 'linear',
                keyframes: [
                    { time: 0, alpha: 1 },
                    { time: 0.5, alpha: 0.5 },
                    { time: 1, alpha: 0 },
                ],
            },
        ],
    }
}

describe('useAnimationEdit — Scheme B splitKeyframeAt / mergeKeyframeAt', () => {
    it('splitKeyframeAt: clones transform keyframe valueIn fields to out (semantics preserved)', () => {
        const ctx = useAnimationEdit({ animation: makeTransformAnim() })
        const ok = ctx.splitKeyframeAt(1)
        expect(ok).toBe(true)
        const kf = ctx.currentTrack.value!.keyframes[1]!
        expect(kf.out).toBeDefined()
        expect(kf.out).toEqual({ x: 100, y: 50, scaleX: 2, scaleY: 2, rotation: 1 })
        // Top-level valueIn fields remain unchanged
        expect(kf.x).toBe(100)
        expect(kf.scaleX).toBe(2)
    })

    it('splitKeyframeAt: returns false on already-split keyframe without overwriting existing out', () => {
        const ctx = useAnimationEdit({ animation: makeTransformAnim() })
        ctx.splitKeyframeAt(1)
        const kf = ctx.currentTrack.value!.keyframes[1]!
        kf.out!.x = 999
        expect(ctx.splitKeyframeAt(1)).toBe(false)
        expect(kf.out!.x).toBe(999)
    })

    it('mergeKeyframeAt: removes out to restore single-value keyframe', () => {
        const ctx = useAnimationEdit({ animation: makeTransformAnim() })
        ctx.splitKeyframeAt(1)
        expect(ctx.mergeKeyframeAt(1)).toBe(true)
        expect(ctx.currentTrack.value!.keyframes[1]!.out).toBeUndefined()
    })

    it('mergeKeyframeAt: returns false for un-split keyframe', () => {
        const ctx = useAnimationEdit({ animation: makeTransformAnim() })
        expect(ctx.mergeKeyframeAt(1)).toBe(false)
    })

    it('isKeyframeStructurallySplit: returns true only when out exists and has at least one field', () => {
        const ctx = useAnimationEdit({ animation: makeTransformAnim() })
        const kfs = ctx.currentTrack.value!.keyframes
        expect(ctx.isKeyframeStructurallySplit(kfs[0])).toBe(false)
        ctx.splitKeyframeAt(1)
        expect(ctx.isKeyframeStructurallySplit(kfs[1])).toBe(true)
        // Considered un-split after manual clearing
        kfs[1]!.out = {}
        expect(ctx.isKeyframeStructurallySplit(kfs[1])).toBe(false)
    })

    it('updateKeyframeOut: sets/updates out fields', () => {
        const ctx = useAnimationEdit({ animation: makeTransformAnim() })
        ctx.splitKeyframeAt(1)
        ctx.updateKeyframeOut(1, 'x', 500)
        expect(ctx.currentTrack.value!.keyframes[1]!.out!.x).toBe(500)
    })

    it('updateKeyframeOut: passing undefined deletes single out field; deletes out entirely when empty', () => {
        const ctx = useAnimationEdit({ animation: makeTransformAnim() })
        const kf = ctx.currentTrack.value!.keyframes[1]!
        // Sets only one out field
        kf.out = { x: 500 }
        ctx.updateKeyframeOut(1, 'x', undefined)
        expect(kf.out).toBeUndefined()
    })

    it('updateKeyframeOut: automatically initializes out object', () => {
        const ctx = useAnimationEdit({ animation: makeTransformAnim() })
        const kf = ctx.currentTrack.value!.keyframes[1]!
        expect(kf.out).toBeUndefined()
        ctx.updateKeyframeOut(1, 'scaleX', 3)
        expect(kf.out).toEqual({ scaleX: 3 })
    })

    it('splitKeyframeAt (visibility): clones alpha to out', () => {
        const ctx = useAnimationEdit({ animation: makeVisibilityAnim() })
        ctx.splitKeyframeAt(1)
        const kf = ctx.currentVisibilityTrack.value!.keyframes[1]!
        expect(kf.out).toEqual({ alpha: 0.5 })
    })

    it('updateVisibilityKeyframeOut: sets / clears out.alpha', () => {
        const ctx = useAnimationEdit({ animation: makeVisibilityAnim() })
        ctx.splitKeyframeAt(1)
        ctx.updateVisibilityKeyframeOut(1, 0.2)
        expect(ctx.currentVisibilityTrack.value!.keyframes[1]!.out!.alpha).toBe(0.2)
        ctx.updateVisibilityKeyframeOut(1, undefined)
        expect(ctx.currentVisibilityTrack.value!.keyframes[1]!.out).toBeUndefined()
    })
})

describe('useAnimationEdit — Scheme B Persistence Round-trip (JSON)', () => {
    it('transform: splitKeyframeAt + custom out fields preserved across JSON round-trip', () => {
        const ctx = useAnimationEdit({ animation: makeTransformAnim() })
        ctx.splitKeyframeAt(1)
        ctx.updateKeyframeOut(1, 'x', 777)
        ctx.updateKeyframeOut(1, 'rotation', 0.25)

        // Simulate save -> reload
        const serialized = JSON.stringify(ctx.animationDef)
        const parsed = JSON.parse(serialized) as AnimationDefinition
        const ctx2 = useAnimationEdit({ animation: parsed })

        const kf = ctx2.currentTrack.value!.keyframes[1]!
        expect(kf.out).toEqual({ x: 777, y: 50, scaleX: 2, scaleY: 2, rotation: 0.25 })
        expect(kf.x).toBe(100)
        expect(ctx2.isKeyframeStructurallySplit(kf)).toBe(true)
    })

    it('visibility: splitKeyframeAt + out.alpha preserved across JSON round-trip', () => {
        const ctx = useAnimationEdit({ animation: makeVisibilityAnim() })
        ctx.splitKeyframeAt(1)
        ctx.updateVisibilityKeyframeOut(1, 0.1)

        const parsed = JSON.parse(JSON.stringify(ctx.animationDef)) as AnimationDefinition
        const ctx2 = useAnimationEdit({ animation: parsed })
        const kf = ctx2.currentVisibilityTrack.value!.keyframes[1]!
        expect(kf.out).toEqual({ alpha: 0.1 })
    })

    it('JSON no longer contains out field after mergeKeyframeAt', () => {
        const ctx = useAnimationEdit({ animation: makeTransformAnim() })
        ctx.splitKeyframeAt(1)
        ctx.mergeKeyframeAt(1)
        const serialized = JSON.stringify(ctx.animationDef)
        expect(serialized).not.toContain('"out"')
    })
})

describe('useAnimationEdit — clipboard workflows', () => {
    it('copyKeyframe records clipboard type and prevents cross-track pasting', () => {
        const ctx = useAnimationEdit({ animation: makeMixedAnim() })

        ctx.selectedKeyframeIndex.value = 1
        ctx.copyKeyframe()

        expect(ctx.hasKeyframeClipboard.value).toBe(true)
        expect(ctx.keyframeClipboardType.value).toBe('transform')
        expect(ctx.canPasteKeyframeToCurrentTrack()).toBe(true)

        ctx.seekTo(0.25)
        const insertIdx = ctx.pasteKeyframe()
        expect(insertIdx).toBe(1)
        expect(ctx.currentTrack.value!.keyframes).toHaveLength(4)
        expect(ctx.currentTrack.value!.keyframes[1]).toMatchObject({
            time: 0.25,
            x: 100,
            y: 50,
            scaleX: 2,
            scaleY: 2,
            rotation: 1,
        })

        ctx.selectTrack(1)
        expect(ctx.canPasteKeyframeToCurrentTrack()).toBe(false)
        expect(ctx.keyframeClipboardType.value).toBe('transform')

        const visibilityCount = ctx.currentVisibilityTrack.value!.keyframes.length
        expect(ctx.pasteKeyframe()).toBe(-1)
        expect(ctx.currentVisibilityTrack.value!.keyframes).toHaveLength(visibilityCount)
    })

    it('copyKeyframe / duplicateKeyframeToPlayhead supports visibility tracks', () => {
        const ctx = useAnimationEdit({ animation: makeMixedAnim() })

        ctx.selectTrack(1)
        ctx.selectedKeyframeIndex.value = 1
        ctx.copyKeyframe()

        expect(ctx.hasKeyframeClipboard.value).toBe(true)
        expect(ctx.keyframeClipboardType.value).toBe('visibility')
        expect(ctx.canPasteKeyframeToCurrentTrack()).toBe(true)
        expect(ctx.canDuplicateKeyframeToPlayhead()).toBe(true)

        ctx.seekTo(0.25)
        const insertIdx = ctx.duplicateKeyframeToPlayhead()
        expect(insertIdx).toBe(1)
        expect(ctx.currentVisibilityTrack.value!.keyframes).toHaveLength(4)
        expect(ctx.currentVisibilityTrack.value!.keyframes[1]).toEqual({ time: 0.25, alpha: 0.5 })
    })
})
