/**
 * AnimationPlayer.spec.ts
 * 
 * AnimationPlayer and AnimationPlayerManager Unit Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AnimationPlayer, AnimationPlayerManager } from '@/core/AnimationPlayer'
import type { AnimationDefinition } from '@/types/animation'

// Mock AnimationTrackEvaluator
vi.mock('@/core/AnimationTrackEvaluator', () => ({
    AUTO_DURATION_MARKER: -1,
    AnimationTrackEvaluator: {
        evaluate: () => ({ trackType: 'transform', transforms: {} }),
        getTrackDuration: (track: { duration?: number }) => track.duration ?? 1000
    },
    mergeTrackOutputs: () => ({ transforms: {}, partStates: {} })
}))

// Animation definition for testing
function createTestAnimation(overrides?: Partial<AnimationDefinition>): AnimationDefinition {
    return {
        type: 'track',
        id: 'test-anim-1',
        name: 'test-animation',
        loop: false,
        tracks: [
            {
                trackType: 'transform',
                duration: 1000,
                easing: 'linear',
                keyframes: [
                    { time: 0, x: 0, y: 0 },
                    { time: 1, x: 100, y: 50 }
                ]
            }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...overrides
    } as AnimationDefinition
}

describe('AnimationPlayer', () => {
    let player: AnimationPlayer

    beforeEach(() => {
        player = new AnimationPlayer()
    })

    describe('Initial state', () => {
        it('should start in stopped state', () => {
            expect(player.state).toBe('stopped')
            expect(player.isStopped).toBe(true)
            expect(player.isPlaying).toBe(false)
            expect(player.isPaused).toBe(false)
            expect(player.isFilled).toBe(false)
        })

        it('should have default progress and speed', () => {
            expect(player.progress).toBe(0)
            expect(player.speed).toBe(1)
            expect(player.loop).toBe(false)
        })

        it('should have no current animation', () => {
            expect(player.currentAnimation).toBeNull()
        })
    })

    describe('play()', () => {
        it('should start playing animation', () => {
            const animation = createTestAnimation()
            player.play(animation)

            expect(player.state).toBe('playing')
            expect(player.isPlaying).toBe(true)
            expect(player.currentAnimation).toBe(animation)
        })

        it('should calculate animation duration', () => {
            const animation = createTestAnimation()
            player.play(animation)

            expect(player.duration).toBe(1000)
        })

        it('should use loop setting defined on Animation', () => {
            const animation = createTestAnimation({ loop: true })
            player.play(animation)

            expect(player.loop).toBe(true)
        })

        it('should allow overriding loop setting via parameters', () => {
            const animation = createTestAnimation({ loop: false })
            player.play(animation, { loop: true })

            expect(player.loop).toBe(true)
        })

        it('should allow configuring playback speed', () => {
            const animation = createTestAnimation()
            player.play(animation, { speed: 2.0 })

            expect(player.speed).toBe(2.0)
        })

        it('should maintain current progress when reset: false', () => {
            const animation = createTestAnimation()
            player.play(animation)

            // Simulate some progress
            player.update(500)
            const progressBefore = player.progress

            // Replay without reset
            player.play(animation, { reset: false })

            expect(player.progress).toBe(progressBefore)
        })
    })

    describe('stop()', () => {
        it('should stop playback and reset progress', () => {
            const animation = createTestAnimation()
            player.play(animation)
            player.update(500)

            player.stop()

            expect(player.state).toBe('stopped')
            expect(player.isStopped).toBe(true)
            expect(player.progress).toBe(0)
        })
    })

    describe('pause() / resume()', () => {
        it('should pause currently playing animation', () => {
            const animation = createTestAnimation()
            player.play(animation)

            player.pause()

            expect(player.state).toBe('paused')
            expect(player.isPaused).toBe(true)
            expect(player.isPlaying).toBe(false)
        })

        it('should resume paused animation', () => {
            const animation = createTestAnimation()
            player.play(animation)
            player.pause()

            player.resume()

            expect(player.state).toBe('playing')
            expect(player.isPlaying).toBe(true)
        })

        it('should not update progress while paused', () => {
            const animation = createTestAnimation()
            player.play(animation)
            player.update(200)
            const progressBefore = player.progress

            player.pause()
            player.update(100)

            expect(player.progress).toBe(progressBefore)
        })
    })

    describe('update()', () => {
        it('should advance progress according to time', () => {
            const animation = createTestAnimation() // duration: 1000ms
            player.play(animation)

            player.update(500) // 50% progress

            expect(player.progress).toBeCloseTo(0.5, 1)
        })

        it('should take playback speed into account', () => {
            const animation = createTestAnimation()
            player.play(animation, { speed: 2.0 })

            player.update(250) // Update 250ms at 2x speed = 500ms progress

            expect(player.progress).toBeCloseTo(0.5, 1)
        })

        it('non-looping animation should stop after completion', () => {
            const animation = createTestAnimation({ loop: false })
            player.play(animation)

            player.update(1500) // Exceed animation duration

            expect(player.state).toBe('stopped')
            // Note: Non-looping animation progress stays at 1 (final frame) upon completion rather than resetting to 0
            expect(player.progress).toBe(1)
        })

        it('looping animation should restart', () => {
            const animation = createTestAnimation({ loop: true })
            player.play(animation)

            player.update(1500) // 1.5x animation duration

            expect(player.state).toBe('playing')
            expect(player.progress).toBeCloseTo(0.5, 1)
        })

        it('fillMode: forwards should enter filled state and keep output upon completion', () => {
            const callback = vi.fn()
            const filledPlayer = new AnimationPlayer(callback)
            const animation = createTestAnimation({ fillMode: 'forwards', loop: false })

            filledPlayer.play(animation)
            const output = filledPlayer.update(1500)

            expect(filledPlayer.state).toBe('filled')
            expect(filledPlayer.isPlaying).toBe(false)
            expect(filledPlayer.isFilled).toBe(true)
            expect(output).not.toBeNull()

            const secondOutput = filledPlayer.update(100)
            expect(secondOutput).not.toBeNull()
            expect(callback).toHaveBeenCalled()
        })

        it('stop() in filled state should transition correctly to stopped', () => {
            const animation = createTestAnimation({ fillMode: 'forwards', loop: false })

            player.play(animation)
            player.update(1500)
            expect(player.state).toBe('filled')

            player.stop()
            expect(player.state).toBe('stopped')
            expect(player.isStopped).toBe(true)
            expect(player.isFilled).toBe(false)
            expect(player.progress).toBe(0)
        })

        it('play() of new animation in filled state should transition to playing', () => {
            const animation1 = createTestAnimation({ fillMode: 'forwards', loop: false })
            const animation2 = createTestAnimation({ loop: true })

            player.play(animation1)
            player.update(1500)
            expect(player.state).toBe('filled')

            player.play(animation2)
            expect(player.state).toBe('playing')
            expect(player.isPlaying).toBe(true)
            expect(player.isFilled).toBe(false)
            expect(player.progress).toBe(0)
        })
    })

    describe('seek()', () => {
        it('should seek to specified progress', () => {
            const animation = createTestAnimation()
            player.play(animation)

            player.seek(0.75)

            expect(player.progress).toBe(0.75)
        })

        it('should clamp progress within 0-1 range', () => {
            const animation = createTestAnimation()
            player.play(animation)

            player.seek(1.5)
            expect(player.progress).toBe(1)

            player.seek(-0.5)
            expect(player.progress).toBe(0)
        })
    })

    describe('setSpeed() / setLoop()', () => {
        it('should update playback speed', () => {
            const animation = createTestAnimation()
            player.play(animation)

            player.setSpeed(0.5)
            expect(player.speed).toBe(0.5)
        })

        it('should update loop settings', () => {
            const animation = createTestAnimation()
            player.play(animation)

            player.setLoop(true)
            expect(player.loop).toBe(true)
        })
    })

    describe('Callbacks', () => {
        it('constructor should accept onUpdate callback', () => {
            const callback = vi.fn()
            const playerWithCallback = new AnimationPlayer(callback)
            const animation = createTestAnimation()

            playerWithCallback.play(animation)
            playerWithCallback.update(100)

            expect(callback).toHaveBeenCalled()
        })

        it('setOnUpdate should configure callback', () => {
            const callback = vi.fn()
            const animation = createTestAnimation()

            player.setOnUpdate(callback)
            player.play(animation)
            player.update(100)

            expect(callback).toHaveBeenCalled()
        })

        it('fillMode: forwards should trigger onStopCallback on natural finish', () => {
            const callback = vi.fn()
            const animation = createTestAnimation({ fillMode: 'forwards', loop: false })

            player.setOnStop(callback)
            player.play(animation)
            player.update(1500)

            expect(callback).toHaveBeenCalledTimes(1)
        })
    })
})

describe('AnimationPlayerManager', () => {
    let manager: AnimationPlayerManager

    beforeEach(() => {
        manager = new AnimationPlayerManager()
    })

    describe('getOrCreate()', () => {
        it('should create new player', () => {
            const player = manager.getOrCreate('player1')

            expect(player).toBeInstanceOf(AnimationPlayer)
            expect(manager.getAllIds()).toContain('player1')
        })

        it('should return existing player', () => {
            const player1 = manager.getOrCreate('player1')
            const player2 = manager.getOrCreate('player1')

            expect(player1).toBe(player2)
        })
    })

    describe('get()', () => {
        it('should return existing player', () => {
            manager.getOrCreate('player1')
            const player = manager.get('player1')

            expect(player).toBeDefined()
        })

        it('should return undefined when nonexistent', () => {
            const player = manager.get('nonexistent')

            expect(player).toBeUndefined()
        })
    })

    describe('remove()', () => {
        it('should remove player', () => {
            manager.getOrCreate('player1')

            const removed = manager.remove('player1')

            expect(removed).toBe(true)
            expect(manager.get('player1')).toBeUndefined()
        })

        it('should stop player prior to removal', () => {
            const player = manager.getOrCreate('player1')
            const animation = createTestAnimation()
            player.play(animation)

            manager.remove('player1')

            expect(player.isStopped).toBe(true)
        })
    })

    describe('updateAll()', () => {
        it('should update all players', () => {
            const player1 = manager.getOrCreate('player1')
            const player2 = manager.getOrCreate('player2')
            const animation = createTestAnimation()

            player1.play(animation)
            player2.play(animation)

            const outputs = manager.updateAll(500)

            expect(outputs.size).toBe(2)
            expect(outputs.has('player1')).toBe(true)
            expect(outputs.has('player2')).toBe(true)
        })
    })

    describe('stopAll()', () => {
        it('should stop all players', () => {
            const player1 = manager.getOrCreate('player1')
            const player2 = manager.getOrCreate('player2')
            const animation = createTestAnimation()

            player1.play(animation)
            player2.play(animation)

            manager.stopAll()

            expect(player1.isStopped).toBe(true)
            expect(player2.isStopped).toBe(true)
        })
    })

    describe('clear()', () => {
        it('should clear all players', () => {
            manager.getOrCreate('player1')
            manager.getOrCreate('player2')

            manager.clear()

            expect(manager.getAllIds().length).toBe(0)
        })
    })

    describe('getPlayingCount()', () => {
        it('should return count of actively playing players', () => {
            const player1 = manager.getOrCreate('player1')
            const player2 = manager.getOrCreate('player2')
            manager.getOrCreate('player3') // Create without playing, used for testing count
            const animation = createTestAnimation()

            player1.play(animation)
            player2.play(animation)
            // player3 does not play

            expect(manager.getPlayingCount()).toBe(2)
        })
    })
})
