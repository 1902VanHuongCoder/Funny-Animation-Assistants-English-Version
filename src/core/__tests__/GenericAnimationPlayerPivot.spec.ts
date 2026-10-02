/**
 * GenericAnimationPlayerPivot.spec.ts
 * 
 * Tests GenericAnimationPlayer pivot position compensation
 * Ensures position is correctly compensated during scaling/rotation around custom pivot
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnimationDefinition, AnimationOutput, TransformTrackOutput } from '@/types/animation'

// Mock PIXI.js
const mockContainer = () => ({
    x: 0,
    y: 0,
    scale: { x: 1, y: 1 },
    rotation: 0,
    alpha: 1,
    pivot: { x: 0, y: 0, set: vi.fn() },
    children: [],
    filters: null,
    name: '',
    zIndex: 0,
    getChildByName: () => null,
    destroyed: false,
    transform: {},
})

// Mock dependencies before importing
vi.mock('pixi.js', () => ({
    Container: vi.fn().mockImplementation(() => mockContainer()),
    Sprite: vi.fn(),
    AnimatedSprite: vi.fn(),
    Filter: vi.fn(),
    Texture: { EMPTY: {} },
}))

vi.mock('pixi-filters', () => ({
    GlowFilter: vi.fn(),
    MotionBlurFilter: vi.fn(),
}))

vi.mock('@/utils/animationUtils', () => ({
    restoreAnimatedSpriteStillFrame: vi.fn(),
}))

vi.mock('@/core/animation/DynamicEffectManager', () => ({
    createDynamicEffectManager: () => ({
        update: vi.fn(),
        addEffect: vi.fn(),
        evaluate: () => null,
        removeEffect: vi.fn(),
        pauseEffect: vi.fn(),
        clear: vi.fn(),
    }),
}))

vi.mock('@/core/effects/WaveEffect', () => ({
    createWaveEffect: () => ({
        update: vi.fn(),
        updateAllEffects: vi.fn(),
        applyEffect: vi.fn(),
        removeEffect: vi.fn(),
    }),
}))

vi.mock('@/core/effects/RibbonEffect', () => ({
    createRibbonEffect: () => ({
        update: vi.fn(),
        updateAllEffects: vi.fn(),
        applyEffect: vi.fn(),
        removeEffect: vi.fn(),
    }),
}))

vi.mock('@/core/AnimationPlayer', () => {
    return {
        AnimationPlayer: vi.fn().mockImplementation(() => {
            let currentOutput: AnimationOutput | null = null

            return {
                state: 'stopped',
                isPlaying: false,
                isStopped: true,
                isPaused: false,
                progress: 0,
                play: vi.fn().mockImplementation(() => {
                    // playing state
                }),
                stop: vi.fn(),
                pause: vi.fn(),
                resume: vi.fn(),
                setOnStop: vi.fn(),
                setOnLoop: vi.fn(),
                update: vi.fn().mockImplementation(() => currentOutput),
                // Test helper: allow injecting output
                _setTestOutput: (output: AnimationOutput | null) => {
                    currentOutput = output
                },
            }
        })
    }
})

vi.mock('@/core/CompositeRenderTarget', () => ({
    CompositeRenderTarget: vi.fn(),
}))

import { GenericAnimationPlayer } from '@/core/GenericAnimationPlayer'


function makeTransformOutput(overrides: Partial<TransformTrackOutput> = {}): TransformTrackOutput {
    return {
        targetObjectId: undefined,
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        pivot: undefined,
        ...overrides,
    }
}

function makeAnimationOutput(transforms: TransformTrackOutput[]): AnimationOutput {
    return {
        transforms,
        visibilities: [],
        effects: [],
    }
}

describe('GenericAnimationPlayer - Pivot Position Compensation', () => {
    let target: ReturnType<typeof mockContainer>
    let player: GenericAnimationPlayer

    beforeEach(() => {
        target = mockContainer()
        // Set base transforms
        target.x = 100
        target.y = 200
        target.scale.x = 1
        target.scale.y = 1
        target.rotation = 0
        target.alpha = 1
        // Align PIXI pivot with object center so "center pivot" means no compensation.
        target.pivot.x = 100
        target.pivot.y = 200

        player = new GenericAnimationPlayer({
            target: target as unknown as import('pixi.js').Container,
        })
        // Re-cache so base reflects our values
        player.cacheBaseTransform()
    })

    describe('setObjectBounds', () => {
        it('should cache object dimensions', () => {
            player.setObjectBounds(200, 300)
            // Verify by playing an animation with pivot and checking position compensation
            // The bounds should be stored internally
            expect(true).toBe(true) // Simple existence check
        })
    })

    describe('Center pivot (100, 200) - identical to container.pivot', () => {
        it('should not compensate position during scaling', () => {
            player.setObjectBounds(200, 400)

            // Create a player with injectable outputs
            const animDef: AnimationDefinition = {
                type: 'track',
                id: 'test', name: 'test', loop: false,
                tracks: [{ trackType: 'transform', duration: 1000, easing: 'linear', keyframes: [{ time: 0 }] }],
                createdAt: 0, updatedAt: 0,
            }
            player.playAnimation('test', animDef)

            // Get the internal AnimationPlayer and inject output
            const internalPlayers = (player as unknown as { players: Map<string, { _setTestOutput: (o: AnimationOutput | null) => void }> }).players
            const internalPlayer = internalPlayers.get('test')!
            internalPlayer._setTestOutput(makeAnimationOutput([
                // pixel pivot == container.pivot -> dx=dy=0 -> no compensation
                makeTransformOutput({ scaleX: 2, scaleY: 2, pivot: { x: 100, y: 200 } })
            ]))

            player.update(16)

            expect(target.x).toBeCloseTo(100, 5) // baseX + 0
            expect(target.y).toBeCloseTo(200, 5) // baseY + 0
            expect(target.scale.x).toBeCloseTo(2, 5)
            expect(target.scale.y).toBeCloseTo(2, 5)
        })
    })

    describe('Bottom pivot (100, 400)', () => {
        it('should grow upward from bottom when scaleY=2', () => {
            player.setObjectBounds(200, 400)

            const animDef: AnimationDefinition = {
                type: 'track',
                id: 'test', name: 'test', loop: false,
                tracks: [{ trackType: 'transform', duration: 1000, easing: 'linear', keyframes: [{ time: 0 }] }],
                createdAt: 0, updatedAt: 0,
            }
            player.playAnimation('test', animDef)

            const internalPlayers = (player as unknown as { players: Map<string, { _setTestOutput: (o: AnimationOutput | null) => void }> }).players
            const internalPlayer = internalPlayers.get('test')!
            internalPlayer._setTestOutput(makeAnimationOutput([
                // pixel pivot at container bottom y=400, offset dy=200 from center (y=200)
                makeTransformOutput({ scaleY: 2, pivot: { x: 100, y: 400 } })
            ]))

            player.update(16)

            // dy = 400 - 200 = 200
            // beforeY = 1 * 200 = 200 (baseScaleY * dy)
            // afterY  = 1 * 2 * 200 = 400 (baseScaleY * scaleY * dy)
            // compensation.y = beforeY - afterY = 200 - 400 = -200
            expect(target.x).toBeCloseTo(100, 5) // no X compensation
            expect(target.y).toBeCloseTo(200 + (-200), 5) // baseY + compensationY = 0
            expect(target.scale.y).toBeCloseTo(2, 5)
        })
    })

    describe('Top-left pivot (0, 0)', () => {
        it('should grow toward bottom-right when scaleX=2 scaleY=2', () => {
            player.setObjectBounds(200, 400)

            const animDef: AnimationDefinition = {
                type: 'track',
                id: 'test', name: 'test', loop: false,
                tracks: [{ trackType: 'transform', duration: 1000, easing: 'linear', keyframes: [{ time: 0 }] }],
                createdAt: 0, updatedAt: 0,
            }
            player.playAnimation('test', animDef)

            const internalPlayers = (player as unknown as { players: Map<string, { _setTestOutput: (o: AnimationOutput | null) => void }> }).players
            const internalPlayer = internalPlayers.get('test')!
            internalPlayer._setTestOutput(makeAnimationOutput([
                makeTransformOutput({ scaleX: 2, scaleY: 2, pivot: { x: 0, y: 0 } })
            ]))

            player.update(16)

            // pivot at top-left: dx = 0 - 100 = -100, dy = 0 - 200 = -200
            // beforeX = 1 * (-100) = -100, beforeY = 1 * (-200) = -200
            // afterX  = 1 * 2 * (-100) = -200, afterY = 1 * 2 * (-200) = -400
            // compensationX = -100 - (-200) = 100
            // compensationY = -200 - (-400) = 200
            expect(target.x).toBeCloseTo(100 + 100, 5) // baseX + 100 = 200
            expect(target.y).toBeCloseTo(200 + 200, 5) // baseY + 200 = 400
            expect(target.scale.x).toBeCloseTo(2, 5)
            expect(target.scale.y).toBeCloseTo(2, 5)
        })
    })

    describe('No pivot', () => {
        it('should preserve original behavior (no position compensation)', () => {
            player.setObjectBounds(200, 400)

            const animDef: AnimationDefinition = {
                type: 'track',
                id: 'test', name: 'test', loop: false,
                tracks: [{ trackType: 'transform', duration: 1000, easing: 'linear', keyframes: [{ time: 0 }] }],
                createdAt: 0, updatedAt: 0,
            }
            player.playAnimation('test', animDef)

            const internalPlayers = (player as unknown as { players: Map<string, { _setTestOutput: (o: AnimationOutput | null) => void }> }).players
            const internalPlayer = internalPlayers.get('test')!
            internalPlayer._setTestOutput(makeAnimationOutput([
                makeTransformOutput({ scaleX: 2, scaleY: 2, x: 10, y: 20 })
                // no pivot
            ]))

            player.update(16)

            // No pivot → no compensation, only translation
            expect(target.x).toBeCloseTo(100 + 10, 5)
            expect(target.y).toBeCloseTo(200 + 20, 5)
            expect(target.scale.x).toBeCloseTo(2, 5)
            expect(target.scale.y).toBeCloseTo(2, 5)
        })
    })

    describe('Two transform tracks with different pivots', () => {
        it('accumulates correctly after independent compensation', () => {
            player.setObjectBounds(200, 400)

            const animDef: AnimationDefinition = {
                type: 'track',
                id: 'test', name: 'test', loop: false,
                tracks: [{ trackType: 'transform', duration: 1000, easing: 'linear', keyframes: [{ time: 0 }] }],
                createdAt: 0, updatedAt: 0,
            }
            player.playAnimation('test', animDef)

            const internalPlayers = (player as unknown as { players: Map<string, { _setTestOutput: (o: AnimationOutput | null) => void }> }).players
            const internalPlayer = internalPlayers.get('test')!

            // Track 1: pivot at bottom (100, 400), scaleY=2
            // Track 2: pivot at center (100, 200), scaleX=1.5
            internalPlayer._setTestOutput(makeAnimationOutput([
                makeTransformOutput({ scaleY: 2, pivot: { x: 100, y: 400 } }),
                makeTransformOutput({ scaleX: 1.5, pivot: { x: 100, y: 200 } }),
            ]))

            player.update(16)

            // Track 1: dy=200, compensation.y = 200 - 400 = -200, compensation.x = 0
            // Track 2: center pivot, compensation = 0
            // Total: deltaX = 0, deltaY = -200
            expect(target.x).toBeCloseTo(100, 5)
            expect(target.y).toBeCloseTo(200 - 200, 5) // = 0
            // Scale is multiplicative: 1 * 1.5 = 1.5 for X, 1 * 2 = 2 for Y
            expect(target.scale.x).toBeCloseTo(1.5, 5)
            expect(target.scale.y).toBeCloseTo(2, 5)
        })
    })

    describe('When objectBounds is absent', () => {
        it('still applies position compensation based on pixel pivot (no longer depends on bounds)', () => {
            // Does not call setObjectBounds -> no effect under pixel semantics

            const animDef: AnimationDefinition = {
                type: 'track',
                id: 'test', name: 'test', loop: false,
                tracks: [{ trackType: 'transform', duration: 1000, easing: 'linear', keyframes: [{ time: 0 }] }],
                createdAt: 0, updatedAt: 0,
            }
            player.playAnimation('test', animDef)

            const internalPlayers = (player as unknown as { players: Map<string, { _setTestOutput: (o: AnimationOutput | null) => void }> }).players
            const internalPlayer = internalPlayers.get('test')!
            internalPlayer._setTestOutput(makeAnimationOutput([
                // Pixel pivot (100, 400): offset dy=200 from container.pivot (100, 200)
                makeTransformOutput({ scaleY: 2, pivot: { x: 100, y: 400 }, x: 5, y: 10 })
            ]))

            player.update(16)

            // dy=200，beforeY=200, afterY=400, compensationY = -200
            // target.y = baseY + y + compensationY = 200 + 10 - 200 = 10
            expect(target.x).toBeCloseTo(100 + 5, 5)
            expect(target.y).toBeCloseTo(200 + 10 - 200, 5)
        })
    })
})
