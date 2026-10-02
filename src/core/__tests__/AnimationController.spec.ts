/**
 * AnimationController.spec.ts
 *
 * AnimationController Unit Tests
 * Tests pure function helpers and core methods (via mocked AnimationHost)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
    AnimationController,
    calculateRuntimeDuration,
    getActionStartTime,
    hasAutoDuration,
    type AnimationHost,
} from '@/core/AnimationController'
import type { AnimationDefinition } from '@/types/animation'
import type { Action, RuntimeSlot, SetAnimAction } from '@/types/screenplay'
import type { TTSTimingFile } from '@/utils/ttsTiming'

// ============================================================================
// Helpers
// ============================================================================

function createSlots(...startTimes: number[]): RuntimeSlot[] {
    return startTimes.map((t, i) => ({
        index: i,
        startTime: t,
        duration: 500,
        type: 'subtitle' as const,
        text: '',
    }))
}

function createSetAnimAction(
    target: string,
    slotIndex: number,
    animations: SetAnimAction['params']['animations'],
    reset?: boolean,
): SetAnimAction {
    return {
        type: 'set_anim',
        target,
        slotIndex,
        id: `action-${target}-${slotIndex}`,
        category: 'point' as const,
        params: {
            animations: animations ?? [],
            reset: reset ?? true,
        },
    }
}

function createMockHost(overrides?: Partial<AnimationHost>): AnimationHost {
    return {
        getAnimationPlayer: vi.fn().mockReturnValue(null),
        getObjectContainer: vi.fn().mockReturnValue(null),
        getSceneObjects: vi.fn().mockReturnValue([]),
        getAnimationDefinition: vi.fn().mockReturnValue(null),
        ...overrides,
    }
}

function createTestDefinition(overrides?: Partial<AnimationDefinition>): AnimationDefinition {
    return {
        type: 'track',
        id: 'def-1',
        name: 'test-def',
        loop: false,
        tracks: [{ trackType: 'transform', duration: 1000, easing: 'linear', keyframes: [] }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...overrides,
    } as AnimationDefinition
}

function createTTSTimingFile(
    segments: TTSTimingFile['speechSegments'],
    animationSpeechSegments: TTSTimingFile['animationSpeechSegments'] = segments,
): TTSTimingFile {
    return {
        schemaVersion: 1,
        audioPath: 'cache/tts/test.mp3',
        audioDurationMs: 1000,
        createdAt: '2026-01-01T00:00:00.000Z',
        analyzer: {
            method: 'rms_silence_detect',
            frameMs: 10,
            thresholdDb: -35,
            minPauseMs: 100,
            mergeGapMs: 80,
            minSpeechMs: 60,
            animationStopPauseMs: 150,
        },
        pauseSegments: [],
        speechSegments: segments,
        animationSpeechSegments,
    }
}

// ============================================================================
// Pure Function Tests
// ============================================================================

describe('getActionStartTime', () => {
    it('returns 0 when slots is empty', () => {
        const action = { slotIndex: 0 } as Action
        expect(getActionStartTime(action, [])).toBe(0)
    })

    it('should return startTime of corresponding slot', () => {
        const action = { slotIndex: 1 } as Action
        const slots = createSlots(0, 500, 1200)
        expect(getActionStartTime(action, slots)).toBe(500)
    })

    it('returns 0 when slotIndex is out of range', () => {
        const action = { slotIndex: 5 } as Action
        const slots = createSlots(0, 500)
        expect(getActionStartTime(action, slots)).toBe(0)
    })
})

describe('hasAutoDuration', () => {
    it('returns true for transform track with auto duration', () => {
        const def = { tracks: [{ trackType: 'transform', duration: 'auto' as const }] }
        expect(hasAutoDuration(def)).toBe(true)
    })

    it('returns true for visibility track with auto duration', () => {
        const def = { tracks: [{ trackType: 'visibility', duration: 'auto' as const }] }
        expect(hasAutoDuration(def)).toBe(true)
    })

    it('returns false for fixed duration', () => {
        const def = { tracks: [{ trackType: 'transform', duration: 1000 }] }
        expect(hasAutoDuration(def)).toBe(false)
    })

    it('returns false for non-transform/visibility track even with auto', () => {
        const def = { tracks: [{ trackType: 'color', duration: 'auto' as const }] }
        expect(hasAutoDuration(def)).toBe(false)
    })
})

describe('calculateRuntimeDuration', () => {
    it('returns duration to stop when matching stop action exists', () => {
        const actions: Action[] = [
            createSetAnimAction('obj-1', 0, [{ animName: 'walk', action: 'play' }]),
            createSetAnimAction('obj-1', 1, [{ animName: 'walk', action: 'stop' }]),
        ]
        const slots = createSlots(0, 800)
        // play at 0, stop at 800 → duration = 800
        const result = calculateRuntimeDuration(actions, slots, 2000, 'obj-1', 'walk', 0)
        expect(result).toBe(800)
    })

    it('extends to Block end when no matching stop action exists', () => {
        const actions: Action[] = [
            createSetAnimAction('obj-1', 0, [{ animName: 'walk', action: 'play' }]),
        ]
        const slots = createSlots(0)
        const result = calculateRuntimeDuration(actions, slots, 3000, 'obj-1', 'walk', 0)
        expect(result).toBe(3000) // blockDuration - playStartTime
    })

    it('should not match stop occurring before play', () => {
        const actions: Action[] = [
            createSetAnimAction('obj-1', 0, [{ animName: 'walk', action: 'stop' }]),
            createSetAnimAction('obj-1', 1, [{ animName: 'walk', action: 'play' }]),
        ]
        const slots = createSlots(0, 500)
        // play at 500, stop at 0 (before play) → should extend to block end
        const result = calculateRuntimeDuration(actions, slots, 2000, 'obj-1', 'walk', 500)
        expect(result).toBe(1500) // 2000 - 500
    })
})

// ============================================================================
// AnimationController Method Tests
// ============================================================================

describe('AnimationController', () => {
    let controller: AnimationController
    let triggeredAnimations: Set<string>

    beforeEach(() => {
        triggeredAnimations = new Set()
    })

    describe('processSetAnimActions - Object Animation', () => {
        it('should trigger object animation playback at correct time', () => {
            const mockPlayer = {
                playAnimation: vi.fn(),
                stopAnimation: vi.fn(),
            }
            const mockDef = createTestDefinition()
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    { id: 'obj-1', type: 'prop', refId: 'prop-ref-1' },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
                getAnimationDefinition: vi.fn().mockReturnValue(mockDef),
            })
            controller = new AnimationController(host, triggeredAnimations)

            const actions: Action[] = [
                createSetAnimAction('obj-1', 0, [{ animName: 'wave', action: 'play' }]),
            ]
            const slots = createSlots(100)

            controller.processSetAnimActions(actions, slots, 200, 3000)

            expect(mockPlayer.playAnimation).toHaveBeenCalledWith(
                'wave', mockDef, expect.objectContaining({ reset: true }),
            )
        })

        it('should not trigger animation before timestamp', () => {
            const mockPlayer = { playAnimation: vi.fn(), stopAnimation: vi.fn() }
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    { id: 'obj-1', type: 'prop', refId: 'prop-ref-1' },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
            })
            controller = new AnimationController(host, triggeredAnimations)

            const actions: Action[] = [
                createSetAnimAction('obj-1', 0, [{ animName: 'wave', action: 'play' }]),
            ]
            const slots = createSlots(500)

            controller.processSetAnimActions(actions, slots, 200, 3000)

            expect(mockPlayer.playAnimation).not.toHaveBeenCalled()
        })

        it('should not trigger duplicate animations', () => {
            const mockPlayer = { playAnimation: vi.fn(), stopAnimation: vi.fn() }
            const mockDef = createTestDefinition()
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    { id: 'obj-1', type: 'prop', refId: 'prop-ref-1' },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
                getAnimationDefinition: vi.fn().mockReturnValue(mockDef),
            })
            controller = new AnimationController(host, triggeredAnimations)

            const actions: Action[] = [
                createSetAnimAction('obj-1', 0, [{ animName: 'wave', action: 'play' }]),
            ]
            const slots = createSlots(0)

            controller.processSetAnimActions(actions, slots, 500, 3000)
            controller.processSetAnimActions(actions, slots, 600, 3000)

            expect(mockPlayer.playAnimation).toHaveBeenCalledTimes(1)
        })

        it('stop command should stop animation', () => {
            const mockPlayer = { playAnimation: vi.fn(), stopAnimation: vi.fn() }
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    { id: 'obj-1', type: 'prop', refId: 'prop-ref-1' },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
            })
            controller = new AnimationController(host, triggeredAnimations)

            const actions: Action[] = [
                createSetAnimAction('obj-1', 0, [{ animName: 'wave', action: 'stop' }]),
            ]
            const slots = createSlots(0)

            controller.processSetAnimActions(actions, slots, 500, 3000)

            expect(mockPlayer.stopAnimation).toHaveBeenCalledWith('wave')
        })

        it('tts_speech should only play during voiced TTS segments and pause during breath pauses', () => {
            const mockPlayer = { playAnimation: vi.fn(), stopAnimation: vi.fn() }
            const mockDef = createTestDefinition({ timingMode: 'tts_speech' })
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    { id: 'obj-1', type: 'prop', refId: 'prop-ref-1' },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
                getAnimationDefinition: vi.fn().mockReturnValue(mockDef),
            })
            controller = new AnimationController(host, triggeredAnimations)

            const actions: Action[] = [
                createSetAnimAction('obj-1', 0, [{ animName: 'talk', action: 'play' }]),
            ]
            const slots = createSlots(0)
            const timing = createTTSTimingFile([
                { startMs: 0, endMs: 300, durationMs: 300 },
                { startMs: 500, endMs: 800, durationMs: 300 },
            ])

            controller.processSetAnimActions(actions, slots, 100, 1000, { blockId: 'block-1', ttsTiming: timing })
            controller.processSetAnimActions(actions, slots, 350, 1000, { blockId: 'block-1', ttsTiming: timing })
            controller.processSetAnimActions(actions, slots, 550, 1000, { blockId: 'block-1', ttsTiming: timing })

            expect(mockPlayer.playAnimation).toHaveBeenCalledTimes(2)
            expect(mockPlayer.stopAnimation).toHaveBeenCalledTimes(1)
            expect(mockPlayer.stopAnimation).toHaveBeenCalledWith('talk')
        })

        it('tts_speech should use animationSpeechSegments as animation gating segments', () => {
            const mockPlayer = { playAnimation: vi.fn(), stopAnimation: vi.fn() }
            const mockDef = createTestDefinition({ timingMode: 'tts_speech' })
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    { id: 'obj-1', type: 'prop', refId: 'prop-ref-1' },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
                getAnimationDefinition: vi.fn().mockReturnValue(mockDef),
            })
            controller = new AnimationController(host, triggeredAnimations)

            const actions: Action[] = [
                createSetAnimAction('obj-1', 0, [{ animName: 'talk', action: 'play' }]),
            ]
            const slots = createSlots(0)
            const timing = createTTSTimingFile(
                [
                    { startMs: 0, endMs: 300, durationMs: 300 },
                    { startMs: 420, endMs: 800, durationMs: 380 },
                ],
                [
                    { startMs: 0, endMs: 800, durationMs: 800 },
                ],
            )

            controller.processSetAnimActions(actions, slots, 100, 1000, { blockId: 'block-1', ttsTiming: timing })
            controller.processSetAnimActions(actions, slots, 350, 1000, { blockId: 'block-1', ttsTiming: timing })
            controller.processSetAnimActions(actions, slots, 500, 1000, { blockId: 'block-1', ttsTiming: timing })

            expect(mockPlayer.playAnimation).toHaveBeenCalledTimes(1)
            expect(mockPlayer.stopAnimation).not.toHaveBeenCalled()
        })

        it('tts_speech should not start continuous playback while timing is loading', () => {
            const mockPlayer = { playAnimation: vi.fn(), stopAnimation: vi.fn() }
            const mockDef = createTestDefinition()
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    { id: 'obj-1', type: 'prop', refId: 'prop-ref-1' },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
                getAnimationDefinition: vi.fn().mockReturnValue(mockDef),
            })
            controller = new AnimationController(host, triggeredAnimations)

            const actions: Action[] = [
                createSetAnimAction('obj-1', 0, [{ animName: 'talk', action: 'play', timingMode: 'tts_speech' }]),
            ]
            const slots = createSlots(0)

            controller.processSetAnimActions(actions, slots, 100, 1000)
            controller.processSetAnimActions(actions, slots, 200, 1000)

            expect(mockPlayer.playAnimation).not.toHaveBeenCalled()
            expect(mockPlayer.stopAnimation).not.toHaveBeenCalled()
        })

        it('tts_speech should fall back to continuous playback when no timing file exists', () => {
            const mockPlayer = { playAnimation: vi.fn(), stopAnimation: vi.fn() }
            const mockDef = createTestDefinition()
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    { id: 'obj-1', type: 'prop', refId: 'prop-ref-1' },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
                getAnimationDefinition: vi.fn().mockReturnValue(mockDef),
            })
            controller = new AnimationController(host, triggeredAnimations)

            const actions: Action[] = [
                createSetAnimAction('obj-1', 0, [{ animName: 'talk', action: 'play', timingMode: 'tts_speech' }]),
            ]
            const slots = createSlots(0)

            controller.processSetAnimActions(actions, slots, 100, 1000, { blockId: 'block-1', ttsTiming: null })
            controller.processSetAnimActions(actions, slots, 200, 1000, { blockId: 'block-1', ttsTiming: null })

            expect(mockPlayer.playAnimation).toHaveBeenCalledTimes(1)
            expect(mockPlayer.stopAnimation).not.toHaveBeenCalled()
        })

        it('tts_speech play should not restart in subsequent voiced segments after explicit stop', () => {
            const mockPlayer = { playAnimation: vi.fn(), stopAnimation: vi.fn() }
            const mockDef = createTestDefinition()
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    { id: 'obj-1', type: 'prop', refId: 'prop-ref-1' },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
                getAnimationDefinition: vi.fn().mockReturnValue(mockDef),
            })
            controller = new AnimationController(host, triggeredAnimations)

            const actions: Action[] = [
                createSetAnimAction('obj-1', 0, [{ animName: 'talk', action: 'play', timingMode: 'tts_speech' }]),
                createSetAnimAction('obj-1', 1, [{ animName: 'talk', action: 'stop' }]),
            ]
            const slots = createSlots(0, 300)
            const timing = createTTSTimingFile([
                { startMs: 0, endMs: 250, durationMs: 250 },
                { startMs: 400, endMs: 700, durationMs: 300 },
            ])

            controller.processSetAnimActions(actions, slots, 100, 1000, { blockId: 'block-1', ttsTiming: timing })
            controller.processSetAnimActions(actions, slots, 450, 1000, { blockId: 'block-1', ttsTiming: timing })

            expect(mockPlayer.playAnimation).toHaveBeenCalledTimes(1)
            expect(mockPlayer.stopAnimation).toHaveBeenCalledTimes(1)
        })
    })

    describe('processAutoStopOnBlockEnd', () => {
        it('should stop animation with autoStopOnBlockEnd', () => {
            const mockPlayer = { playAnimation: vi.fn(), stopAnimation: vi.fn() }
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    { id: 'obj-1', type: 'prop', refId: 'prop-ref-1' },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
            })
            controller = new AnimationController(host, triggeredAnimations)

            const actions: Action[] = [
                createSetAnimAction('obj-1', 0, [
                    { animName: 'walk', action: 'play' }, // autoStopOnBlockEnd defaults to true
                ]),
            ]

            controller.processAutoStopOnBlockEnd(actions)

            expect(mockPlayer.stopAnimation).toHaveBeenCalledWith('walk')
        })

        it('should not stop animation with autoStopOnBlockEnd=false', () => {
            const mockPlayer = { playAnimation: vi.fn(), stopAnimation: vi.fn() }
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    { id: 'obj-1', type: 'prop', refId: 'prop-ref-1' },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
            })
            controller = new AnimationController(host, triggeredAnimations)

            const actions: Action[] = [
                createSetAnimAction('obj-1', 0, [
                    { animName: 'breathe', action: 'play', autoStopOnBlockEnd: false },
                ]),
            ]

            controller.processAutoStopOnBlockEnd(actions)

            expect(mockPlayer.stopAnimation).not.toHaveBeenCalled()
        })

        it('stop action itself should not trigger auto stop', () => {
            const mockPlayer = { playAnimation: vi.fn(), stopAnimation: vi.fn() }
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    { id: 'obj-1', type: 'prop', refId: 'prop-ref-1' },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
            })
            controller = new AnimationController(host, triggeredAnimations)

            const actions: Action[] = [
                createSetAnimAction('obj-1', 0, [
                    { animName: 'walk', action: 'stop' },
                ]),
            ]

            controller.processAutoStopOnBlockEnd(actions)

            expect(mockPlayer.stopAnimation).not.toHaveBeenCalled()
        })
    })

    describe('processInitialAnimationStates', () => {
        it('should play object initial animation', () => {
            const mockPlayer = { playAnimation: vi.fn(), stopAnimation: vi.fn() }
            const mockDef = createTestDefinition()
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    {
                        id: 'obj-1', type: 'prop', refId: 'prop-ref-1',
                        initialAnimations: [{ name: 'idle', loop: true }],
                    },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
                getAnimationDefinition: vi.fn().mockReturnValue(mockDef),
            })
            controller = new AnimationController(host, triggeredAnimations)

            controller.processInitialAnimationStates()

            expect(mockPlayer.playAnimation).toHaveBeenCalledWith(
                'idle', mockDef, { loop: true, speed: 1.0, reset: true },
            )
        })

        it('should call onAnimationTriggered to handle prop initial animation', () => {
            const onTriggered = vi.fn()
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    {
                        id: 'prop-1', type: 'prop', refId: 'prop-ref-1',
                        initialAnimations: [{ name: 'spin', loop: true }],
                    },
                ]),
                getObjectContainer: vi.fn().mockReturnValue({ visible: true }),
                getAnimationDefinition: vi.fn().mockReturnValue(createTestDefinition()),
                onAnimationTriggered: onTriggered,
            })
            controller = new AnimationController(host, triggeredAnimations)

            controller.processInitialAnimationStates()

            expect(onTriggered).toHaveBeenCalledWith(
                'prop-1', '_initial', 'play',
            )
        })
    })

    describe('resetTriggeredAnimations', () => {
        it('should allow re-trigger after reset', () => {
            const mockPlayer = { playAnimation: vi.fn(), stopAnimation: vi.fn() }
            const mockDef = createTestDefinition()
            const host = createMockHost({
                getSceneObjects: vi.fn().mockReturnValue([
                    { id: 'obj-1', type: 'prop', refId: 'prop-ref-1' },
                ]),
                getAnimationPlayer: vi.fn().mockReturnValue(mockPlayer),
                getAnimationDefinition: vi.fn().mockReturnValue(mockDef),
            })
            controller = new AnimationController(host, triggeredAnimations)

            const actions: Action[] = [
                createSetAnimAction('obj-1', 0, [{ animName: 'wave', action: 'play' }]),
            ]
            const slots = createSlots(0)

            controller.processSetAnimActions(actions, slots, 500, 3000)
            expect(mockPlayer.playAnimation).toHaveBeenCalledTimes(1)

            controller.resetTriggeredAnimations()
            controller.processSetAnimActions(actions, slots, 500, 3000)
            expect(mockPlayer.playAnimation).toHaveBeenCalledTimes(2)
        })
    })
})
