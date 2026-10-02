/**
 * AnimationTrackEvaluator.spec.ts
 * 
 * Track Evaluator Unit Tests
 */

import { describe, expect, it } from 'vitest'

import { AnimationTrackEvaluator, mergeTrackOutputs } from '@/core/AnimationTrackEvaluator'
import type {
    EffectTrack,
    FrameSequenceTrack,
    TransformTrack,
    TransformTrackOutput,
    VisibilityTrack,
    VisibilityTrackOutput
} from '@/types/animation'

describe('AnimationTrackEvaluator', () => {
    describe('evaluateTransform', () => {
        it('returns default value for empty keyframes', () => {
            const track: TransformTrack = {
                trackType: 'transform',
                duration: 1000,
                easing: 'linear',
                keyframes: []
            }

            const result = AnimationTrackEvaluator.evaluateTransform(track, 0.5)

            expect(result.x).toBe(0)
            expect(result.y).toBe(0)
            expect(result.scaleX).toBe(1)
            expect(result.scaleY).toBe(1)
            expect(result.rotation).toBe(0)
        })

        it('returns value of single keyframe', () => {
            const track: TransformTrack = {
                trackType: 'transform',
                duration: 1000,
                easing: 'linear',
                keyframes: [
                    { time: 0, x: 100, y: 50, scaleX: 2, scaleY: 2, rotation: 45 }
                ]
            }

            const result = AnimationTrackEvaluator.evaluateTransform(track, 0.5)

            expect(result.x).toBe(100)
            expect(result.y).toBe(50)
            expect(result.scaleX).toBe(2)
            expect(result.scaleY).toBe(2)
            expect(result.rotation).toBe(45)
        })

        it('linearly interpolates between two keyframes', () => {
            const track: TransformTrack = {
                trackType: 'transform',
                duration: 1000,
                easing: 'linear',
                keyframes: [
                    { time: 0, x: 0, y: 0 },
                    { time: 1, x: 100, y: 50 }
                ]
            }

            const result = AnimationTrackEvaluator.evaluateTransform(track, 0.5)

            expect(result.x).toBeCloseTo(50, 0)
            expect(result.y).toBeCloseTo(25, 0)
        })

        it('should support targetObjectId', () => {
            const track: TransformTrack = {
                trackType: 'transform',
                targetObjectId: 'part-1',
                duration: 1000,
                easing: 'linear',
                keyframes: [{ time: 0, x: 0, y: 0 }]
            }

            const result = AnimationTrackEvaluator.evaluateTransform(track, 0)

            expect(result.targetObjectId).toBe('part-1')
        })

        it('should support pivot anchor', () => {
            const track: TransformTrack = {
                trackType: 'transform',
                duration: 1000,
                easing: 'linear',
                pivot: { x: 0.5, y: 0.5 },
                keyframes: [{ time: 0, x: 0, y: 0 }]
            }

            const result = AnimationTrackEvaluator.evaluateTransform(track, 0)

            expect(result.pivot).toEqual({ x: 0.5, y: 0.5 })
        })

        // v11.1: flipX discrete evaluation tests
        describe('flipX discrete evaluation (v11.1)', () => {
            it('single keyframe should return flipX value of that frame', () => {
                const track: TransformTrack = {
                    trackType: 'transform',
                    duration: 1000,
                    easing: 'linear',
                    keyframes: [{ time: 0, x: 0, y: 0, flipX: true }]
                }

                const result = AnimationTrackEvaluator.evaluateTransform(track, 0.5)

                expect(result.flipX).toBe(true)
            })

            it('empty keyframes should return undefined', () => {
                const track: TransformTrack = {
                    trackType: 'transform',
                    duration: 1000,
                    easing: 'linear',
                    keyframes: []
                }

                const result = AnimationTrackEvaluator.evaluateTransform(track, 0.5)

                expect(result.flipX).toBeUndefined()
            })

            it('flipX uses Step logic - takes previous frame when t < 0.5', () => {
                const track: TransformTrack = {
                    trackType: 'transform',
                    duration: 1000,
                    easing: 'linear',
                    keyframes: [
                        { time: 0, x: 0, y: 0, flipX: false },
                        { time: 1, x: 100, y: 0, flipX: true }
                    ]
                }

                // Progress 0.3 -> t = 0.3 < 0.5, should take prev.flipX = false
                const result = AnimationTrackEvaluator.evaluateTransform(track, 0.3)

                expect(result.flipX).toBe(false)
            })

            it('flipX uses Step logic - takes next frame when t >= 0.5', () => {
                const track: TransformTrack = {
                    trackType: 'transform',
                    duration: 1000,
                    easing: 'linear',
                    keyframes: [
                        { time: 0, x: 0, y: 0, flipX: false },
                        { time: 1, x: 100, y: 0, flipX: true }
                    ]
                }

                // Progress 0.7 -> t = 0.7 >= 0.5, should take next.flipX = true
                const result = AnimationTrackEvaluator.evaluateTransform(track, 0.7)

                expect(result.flipX).toBe(true)
            })

            it('flipX takes next frame when t = 0.5', () => {
                const track: TransformTrack = {
                    trackType: 'transform',
                    duration: 1000,
                    easing: 'linear',
                    keyframes: [
                        { time: 0, x: 0, y: 0, flipX: false },
                        { time: 1, x: 100, y: 0, flipX: true }
                    ]
                }

                const result = AnimationTrackEvaluator.evaluateTransform(track, 0.5)

                expect(result.flipX).toBe(true)
            })

            it('flipX passes undefined correctly', () => {
                const track: TransformTrack = {
                    trackType: 'transform',
                    duration: 1000,
                    easing: 'linear',
                    keyframes: [
                        { time: 0, x: 0, y: 0 },  // flipX undefined
                        { time: 1, x: 100, y: 0 }  // flipX undefined
                    ]
                }

                const result = AnimationTrackEvaluator.evaluateTransform(track, 0.5)

                expect(result.flipX).toBeUndefined()
            })
        })
    })

    describe('evaluateVisibility', () => {
        it('empty keyframes should return default alpha=1', () => {
            const track: VisibilityTrack = {
                trackType: 'visibility',
                duration: 1000,
                easing: 'linear',
                keyframes: []
            }

            const result = AnimationTrackEvaluator.evaluateVisibility(track, 0.5)

            expect(result.alpha).toBe(1)
        })

        it('interpolates between visibility keyframes', () => {
            const track: VisibilityTrack = {
                trackType: 'visibility',
                duration: 1000,
                easing: 'linear',
                keyframes: [
                    { time: 0, alpha: 0 },
                    { time: 1, alpha: 1 }
                ]
            }

            const result = AnimationTrackEvaluator.evaluateVisibility(track, 0.5)

            expect(result.alpha).toBeCloseTo(0.5, 1)
        })
    })

    // v11.52: evaluateFrameSequence tests removed
    // Frame animation plays directly via AnimatedSprite.play(), no evaluator needed

    describe('evaluateEffect', () => {
        it('should return effect parameters', () => {
            const track: EffectTrack = {
                trackType: 'effect',
                effectParams: { type: 'breathe', intensity: 0.5, speed: 2 }
            }

            const result = AnimationTrackEvaluator.evaluateEffect(track, 0, 1000)

            expect(result.effectParams.type).toBe('breathe')
            expect(result.effectParams).toHaveProperty('intensity', 0.5)
            expect(result.effectParams).toHaveProperty('speed', 2)
        })

        it('should support targetObjectId', () => {
            const track: EffectTrack = {
                trackType: 'effect',
                targetObjectId: 'body',
                effectParams: { type: 'wave', amplitude: 10 }
            }

            const result = AnimationTrackEvaluator.evaluateEffect(track, 0, 1000)

            expect(result.targetObjectId).toBe('body')
        })
    })

    describe('evaluate (dispatch)', () => {
        it('should correctly dispatch transform track', () => {
            const track: TransformTrack = {
                trackType: 'transform',
                duration: 1000,
                easing: 'linear',
                keyframes: [{ time: 0, x: 50, y: 25 }]
            }

            const result = AnimationTrackEvaluator.evaluate(track, 0)

            expect(result).toHaveProperty('x', 50)
            expect(result).toHaveProperty('y', 25)
        })

        it('should correctly dispatch visibility track', () => {
            const track: VisibilityTrack = {
                trackType: 'visibility',
                duration: 1000,
                easing: 'linear',
                keyframes: [{ time: 0, alpha: 0.5 }]
            }

            const result = AnimationTrackEvaluator.evaluate(track, 0)

            expect(result).toHaveProperty('alpha')
        })

        it('should throw error for frame_sequence track', () => {
            const track: FrameSequenceTrack = {
                trackType: 'frame_sequence',
                targetObjectId: 'part-1',
                assetId: 'test-asset'
            }

            // v11.52: frame_sequence track should throw error now
            expect(() => AnimationTrackEvaluator.evaluate(track, 0)).toThrow()
        })

        it('should correctly dispatch effect track', () => {
            const track: EffectTrack = {
                trackType: 'effect',
                effectParams: { type: 'glow', color: '#ff0000' }
            }

            const result = AnimationTrackEvaluator.evaluate(track, 0)

            expect(result).toHaveProperty('effectParams')
        })
    })

    describe('getTrackDuration', () => {
        it('should return track duration', () => {
            const track: TransformTrack = {
                trackType: 'transform',
                duration: 2000,
                easing: 'linear',
                keyframes: []
            }

            const duration = AnimationTrackEvaluator.getTrackDuration(track)

            expect(duration).toBe(2000)
        })

        it('should return default value when duration is missing', () => {
            const track: EffectTrack = {
                trackType: 'effect',
                effectParams: { type: 'breathe' }
            }

            const duration = AnimationTrackEvaluator.getTrackDuration(track)

            expect(duration).toBeGreaterThan(0)
        })
    })
})

describe('mergeTrackOutputs', () => {
    it('should merge multiple track outputs', () => {
        const transformOutput: TransformTrackOutput = {
            targetObjectId: undefined,
            x: 10,
            y: 20,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            pivot: undefined
        }
        const visibilityOutput: VisibilityTrackOutput = {
            targetObjectId: undefined,
            alpha: 0.5
        }

        const result = mergeTrackOutputs([transformOutput, visibilityOutput])

        // mergeTrackOutputs returns array format
        expect(result.transforms).toBeDefined()
        expect(Array.isArray(result.transforms)).toBe(true)
        expect(result.transforms.length).toBe(1)
    })

    it('should return empty result for empty output array', () => {
        const result = mergeTrackOutputs([])

        expect(result.transforms).toEqual([])
        expect(result.visibilities).toEqual([])
    })
})
