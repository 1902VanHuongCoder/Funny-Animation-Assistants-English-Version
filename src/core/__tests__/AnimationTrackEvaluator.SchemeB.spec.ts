/**
 * AnimationTrackEvaluator.SchemeB.spec.ts
 *
 * v13 Scheme B — Split keyframe (valueIn/valueOut) evaluation semantics
 */

import { describe, expect, it } from 'vitest'

import { AnimationTrackEvaluator } from '@/core/AnimationTrackEvaluator'
import type { TransformTrack, VisibilityTrack } from '@/types/animation'

describe('AnimationTrackEvaluator · Scheme B split keyframes', () => {
    describe('transform', () => {
        it('keyframe without out set should be fully equivalent to legacy data (valueIn === valueOut)', () => {
            const track: TransformTrack = {
                trackType: 'transform',
                duration: 1000,
                easing: 'linear',
                keyframes: [
                    { time: 0, x: 0 },
                    { time: 1, x: 100 },
                ],
            }
            // Midpoint within segment should be 50 (fully compatible with legacy linear interpolation)
            expect(AnimationTrackEvaluator.evaluateTransform(track, 0.5).x).toBe(50)
        })

        it('middle frame with out.x: both segments interpolate with respective endpoints creating step jump', () => {
            // Segment [0, 0.5]: 0 -> 10
            // Segment [0.5, 1]: 100 -> 100
            const track: TransformTrack = {
                trackType: 'transform',
                duration: 1000,
                easing: 'linear',
                keyframes: [
                    { time: 0, x: 0 },
                    { time: 0.5, x: 10, out: { x: 100 } },
                    { time: 1, x: 100 },
                ],
            }

            // Segment 1 midpoint: 0->10 -> 5
            expect(AnimationTrackEvaluator.evaluateTransform(track, 0.25).x).toBe(5)
            // Keyframe time: segment 2 start valueOut=100 (forward-facing)
            expect(AnimationTrackEvaluator.evaluateTransform(track, 0.5).x).toBe(100)
            // Segment 2 midpoint: 100->100 -> 100
            expect(AnimationTrackEvaluator.evaluateTransform(track, 0.75).x).toBe(100)
        })

        it('when out overrides partial fields, un-overridden fields fall through to top level', () => {
            const track: TransformTrack = {
                trackType: 'transform',
                duration: 1000,
                easing: 'linear',
                keyframes: [
                    { time: 0, x: 0, y: 0 },
                    // Only overrides y valueOut; x on out side still uses top-level x=50
                    { time: 0.5, x: 50, y: 10, out: { y: 100 } },
                    { time: 1, x: 100, y: 100 },
                ],
            }
            // Segment 1 end (playhead=0.5): forward-facing valueOut -> x=50, y=100
            const atMid = AnimationTrackEvaluator.evaluateTransform(track, 0.5)
            expect(atMid.x).toBe(50)
            expect(atMid.y).toBe(100)
        })

        it('out on final frame has no effect (displays valueIn at playback end)', () => {
            const track: TransformTrack = {
                trackType: 'transform',
                duration: 1000,
                easing: 'linear',
                keyframes: [
                    { time: 0, x: 0 },
                    { time: 1, x: 100, out: { x: 999 } }, // Final frame out semantics is outside animation, should not display during playback
                ],
            }
            // progress=1 falls on final frame -> displays valueIn=100
            expect(AnimationTrackEvaluator.evaluateTransform(track, 1).x).toBe(100)
        })

        it('first frame out used as playback starting value (valueOut forward-facing)', () => {
            const track: TransformTrack = {
                trackType: 'transform',
                duration: 1000,
                easing: 'linear',
                keyframes: [
                    { time: 0, x: 0, out: { x: 50 } }, // First frame valueIn=0 (before pause), valueOut=50 (playback start)
                    { time: 1, x: 100 },
                ],
            }
            // progress=0 -> uses first frame valueOut=50
            expect(AnimationTrackEvaluator.evaluateTransform(track, 0).x).toBe(50)
            // Midpoint: 50->100 linear -> 75
            expect(AnimationTrackEvaluator.evaluateTransform(track, 0.5).x).toBe(75)
        })
    })

    describe('visibility', () => {
        it('alpha split: middle frame valueOut override creates step jump', () => {
            const track: VisibilityTrack = {
                trackType: 'visibility',
                duration: 1000,
                easing: 'linear',
                keyframes: [
                    { time: 0, alpha: 0 },
                    { time: 0.5, alpha: 0.2, out: { alpha: 1 } },
                    { time: 1, alpha: 1 },
                ],
            }
            // Segment 1 midpoint: 0->0.2 -> 0.1
            expect(AnimationTrackEvaluator.evaluateVisibility(track, 0.25).alpha).toBeCloseTo(0.1, 5)
            // Keyframe time -> takes valueOut=1
            expect(AnimationTrackEvaluator.evaluateVisibility(track, 0.5).alpha).toBe(1)
        })

        it('backward compatible with legacy interpolation when out is unset', () => {
            const track: VisibilityTrack = {
                trackType: 'visibility',
                duration: 1000,
                easing: 'linear',
                keyframes: [
                    { time: 0, alpha: 0 },
                    { time: 1, alpha: 1 },
                ],
            }
            expect(AnimationTrackEvaluator.evaluateVisibility(track, 0.5).alpha).toBeCloseTo(0.5, 5)
        })
    })
})
