/**
 * AudioController.spec.ts
 *
 * computeAudioState pure function unit tests
 */

import { describe, expect, it } from 'vitest'

import { computeAudioState, type AudioBlockInfo } from '@/core/AudioController'
import type { SceneObject, SetAudioAction } from '@/types/screenplay'

// ============================================================================
// Helpers
// ============================================================================

function createAudioObject(overrides?: Partial<SceneObject>): SceneObject {
    return {
        id: 'audio-1',
        type: 'audio',
        refId: 'sound-ref-1',
        x: 0, y: 0,
        zIndex: 0,
        ...overrides,
    } as SceneObject
}

function createBlockInfo(
    startTime: number,
    actions: { slotIndex: number; target: string; params: SetAudioAction['params'] }[],
    slots?: { startTime: number }[],
): AudioBlockInfo {
    const mappedSlots = slots?.map((s, i) => ({
        index: i,
        startTime: s.startTime,
        duration: 1000,
        type: 'subtitle' as const,
        text: '',
    }))
    return {
        startTime,
        blockActions: actions.map((a, i) => ({
            type: 'set_audio' as const,
            slotIndex: a.slotIndex,
            target: a.target,
            id: `audio-action-${i}`,
            category: 'point' as const,
            params: a.params,
        })),
        ...(mappedSlots ? { slots: mappedSlots } : {}),
    }
}

// ============================================================================
// Tests
// ============================================================================

describe('computeAudioState', () => {
    describe('Initial state (no Action)', () => {
        it('when default playbackState is stop, shouldPlay is false', () => {
            const obj = createAudioObject()
            const result = computeAudioState(obj, [], 0, 0)
            expect(result.shouldPlay).toBe(false)
        })

        it('when playbackState is play, shouldPlay is true', () => {
            const obj = createAudioObject({
                playbackState: 'play',
                volume: 0.8,
                loop: true,
            } as Partial<SceneObject>)
            const result = computeAudioState(obj as SceneObject, [], 500, 0)
            expect(result.shouldPlay).toBe(true)
            expect(result.targetVolume).toBe(0.8)
            expect(result.loop).toBe(true)
            expect(result.playTime).toBe(0)
        })
    })

    describe('Play Action', () => {
        it('should play after Action timestamp', () => {
            const obj = createAudioObject()
            const blocks: AudioBlockInfo[] = [
                createBlockInfo(0, [{
                    slotIndex: 0,
                    target: 'audio-1',
                    params: { action: 'play', volume: 0.7, loop: false, fadeIn: 0.5 },
                }], [{ startTime: 100 }]),
            ]
            const result = computeAudioState(obj, blocks, 200, 0)
            expect(result.shouldPlay).toBe(true)
            expect(result.targetVolume).toBe(0.7)
            expect(result.loop).toBe(false)
            expect(result.fadeIn).toBe(0.5)
            expect(result.playTime).toBe(100) // blockStart(0) + slotStart(100)
        })

        it('should not play before Action timestamp', () => {
            const obj = createAudioObject()
            const blocks: AudioBlockInfo[] = [
                createBlockInfo(0, [{
                    slotIndex: 0,
                    target: 'audio-1',
                    params: { action: 'play', volume: 1.0, loop: false },
                }], [{ startTime: 500 }]),
            ]
            const result = computeAudioState(obj, blocks, 200, 0)
            expect(result.shouldPlay).toBe(false)
        })

        it('subsequent Play Action should override previous one', () => {
            const obj = createAudioObject()
            const blocks: AudioBlockInfo[] = [
                createBlockInfo(0, [
                    {
                        slotIndex: 0,
                        target: 'audio-1',
                        params: { action: 'play', volume: 0.5, loop: false },
                    },
                    {
                        slotIndex: 1,
                        target: 'audio-1',
                        params: { action: 'play', volume: 0.9, loop: true },
                    },
                ], [{ startTime: 100 }, { startTime: 500 }]),
            ]
            const result = computeAudioState(obj, blocks, 600, 0)
            expect(result.shouldPlay).toBe(true)
            expect(result.targetVolume).toBe(0.9)
            expect(result.loop).toBe(true)
            expect(result.playTime).toBe(500)
        })
    })

    describe('Stop Action', () => {
        it('should stop playback after Stop Action', () => {
            const obj = createAudioObject()
            const blocks: AudioBlockInfo[] = [
                createBlockInfo(0, [
                    {
                        slotIndex: 0,
                        target: 'audio-1',
                        params: { action: 'play', volume: 1.0, loop: true },
                    },
                    {
                        slotIndex: 1,
                        target: 'audio-1',
                        params: { action: 'stop', fadeOut: 0 },
                    },
                ], [{ startTime: 0 }, { startTime: 1000 }]),
            ]
            const result = computeAudioState(obj, blocks, 1500, 0)
            expect(result.shouldPlay).toBe(false)
        })

        it('when Stop Action has fadeOut, volume is within FadeOut interval', () => {
            const obj = createAudioObject()
            const blocks: AudioBlockInfo[] = [
                createBlockInfo(0, [
                    {
                        slotIndex: 0,
                        target: 'audio-1',
                        params: { action: 'play', volume: 1.0, loop: true },
                    },
                    {
                        slotIndex: 1,
                        target: 'audio-1',
                        params: { action: 'stop', fadeOut: 2 }, // 2-second fadeOut
                    },
                ], [{ startTime: 0 }, { startTime: 1000 }]),
            ]
            // After stop point (1000ms), before fadeOut ends (3000ms)
            const result = computeAudioState(obj, blocks, 2000, 0)
            expect(result.shouldPlay).toBe(true)
            expect(result.inFadeOutTail).toBe(true)
            expect(result.fadeOutDuration).toBe(2)
            expect(result.stopTime).toBe(1000)
        })

        it('should stop playback after fadeOut finishes', () => {
            const obj = createAudioObject()
            const blocks: AudioBlockInfo[] = [
                createBlockInfo(0, [
                    {
                        slotIndex: 0,
                        target: 'audio-1',
                        params: { action: 'play', volume: 1.0, loop: true },
                    },
                    {
                        slotIndex: 1,
                        target: 'audio-1',
                        params: { action: 'stop', fadeOut: 1 }, // 1-second fadeOut
                    },
                ], [{ startTime: 0 }, { startTime: 1000 }]),
            ]
            // After fadeOut finishes (1000 + 1000 = 2000ms)
            const result = computeAudioState(obj, blocks, 2500, 0)
            expect(result.shouldPlay).toBe(false)
        })
    })

    describe('Natural finish FadeOut (non-looping)', () => {
        it('non-looping + fadeOut + known duration -> FadeOut before natural finish', () => {
            const obj = createAudioObject()
            const blocks: AudioBlockInfo[] = [
                createBlockInfo(0, [{
                    slotIndex: 0,
                    target: 'audio-1',
                    params: { action: 'play', volume: 1.0, loop: false, fadeOut: 1 }, // 1-second fadeOut
                }], [{ startTime: 0 }]),
            ]
            // Audio 5s, fadeOut 1s -> autoStopStartTime = 0 + 5000 - 1000 = 4000ms
            const result = computeAudioState(obj, blocks, 4500, 5)
            expect(result.shouldPlay).toBe(true)
            expect(result.inFadeOutTail).toBe(true)
            expect(result.stopTime).toBe(4000)
        })

        it('should stop after natural finish', () => {
            const obj = createAudioObject()
            const blocks: AudioBlockInfo[] = [
                createBlockInfo(0, [{
                    slotIndex: 0,
                    target: 'audio-1',
                    params: { action: 'play', volume: 1.0, loop: false, fadeOut: 1 },
                }], [{ startTime: 0 }]),
            ]
            const result = computeAudioState(obj, blocks, 6000, 5)
            expect(result.shouldPlay).toBe(false)
        })
    })

    describe('Isolation across different objects', () => {
        it('should not match actions belonging to other objects', () => {
            const obj = createAudioObject({ id: 'audio-1' })
            const blocks: AudioBlockInfo[] = [
                createBlockInfo(0, [{
                    slotIndex: 0,
                    target: 'audio-2', // Different object
                    params: { action: 'play', volume: 1.0, loop: true },
                }], [{ startTime: 0 }]),
            ]
            const result = computeAudioState(obj, blocks, 500, 0)
            expect(result.shouldPlay).toBe(false)
        })
    })
})
