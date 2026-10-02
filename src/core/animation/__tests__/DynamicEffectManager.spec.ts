/**
 * DynamicEffectManager.spec.ts
 * 
 * Dynamic Effect Manager Unit Tests
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
    createDynamicEffectManager,
    DynamicEffectManager
} from '@/core/animation/DynamicEffectManager'

describe('DynamicEffectManager', () => {
    let manager: DynamicEffectManager

    beforeEach(() => {
        manager = createDynamicEffectManager()
    })

    describe('basic operations', () => {
        it('should be able to add and remove effects', () => {
            expect(manager.activeCount).toBe(0)

            manager.addEffect('effect1', { type: 'breathe' })
            expect(manager.activeCount).toBe(1)

            manager.removeEffect('effect1')
            expect(manager.activeCount).toBe(0)
        })

        it('should be able to pause and resume effects', () => {
            manager.addEffect('effect1', { type: 'float' })
            expect(manager.activeCount).toBe(1)

            manager.pauseEffect('effect1')
            expect(manager.activeCount).toBe(0)

            manager.resumeEffect('effect1')
            expect(manager.activeCount).toBe(1)
        })

        it('should be able to clear all effects', () => {
            manager.addEffect('effect1', { type: 'wave' })
            manager.addEffect('effect2', { type: 'breathe' })
            manager.addEffect('effect3', { type: 'float' })
            expect(manager.activeCount).toBe(3)

            manager.clear()
            expect(manager.activeCount).toBe(0)
        })
    })

    describe('wave effect', () => {
        it('should generate periodic displacement', () => {
            manager.addEffect('wave', {
                type: 'wave',
                amplitude: 10,
                frequency: 1,
                speed: 1
            })

            // Simulate time progression
            manager.update(0)
            const output0 = manager.evaluate('wave')
            expect(output0).not.toBeNull()
            expect(output0?.deltaX).toBe(0) // sin(0) = 0

            // Advance 250ms (1/4 cycle)
            manager.update(250)
            const output250 = manager.evaluate('wave')
            expect(output250?.deltaX).toBeCloseTo(10, 0) // sin(π/2) ≈ 1

            // Advance to 500ms (1/2 cycle)
            manager.update(250)
            const output500 = manager.evaluate('wave')
            expect(output500?.deltaX).toBeCloseTo(0, 0) // sin(π) = 0
        })

        it('vertical mode should produce Y displacement', () => {
            manager.addEffect('wave-v', {
                type: 'wave',
                direction: 'vertical',
                amplitude: 5
            })

            manager.update(500)
            const output = manager.evaluate('wave-v')
            expect(output?.deltaY).toBeDefined()
            expect(output?.deltaX).toBeUndefined()
        })
    })

    describe('breathe effect', () => {
        it('should generate periodic scaling', () => {
            manager.addEffect('breathe', {
                type: 'breathe',
                intensity: 0.1,
                speed: 1
            })

            manager.update(0)
            const output0 = manager.evaluate('breathe')
            expect(output0?.deltaScaleX).toBe(0) // (1 - cos(0)) / 2 = 0

            // Advance to 500ms (1/2 cycle, maximum)
            manager.update(500)
            const output500 = manager.evaluate('breathe')
            expect(output500?.deltaScaleX).toBeCloseTo(0.1, 1) // (1 - cos(π)) / 2 = 1
            expect(output500?.deltaScaleY).toBeCloseTo(0.1, 1)
        })
    })

    describe('float effect', () => {
        it('should generate vertical floating', () => {
            manager.addEffect('float', {
                type: 'float',
                amplitude: 20,
                speed: 1
            })

            manager.update(500)
            const output = manager.evaluate('float')
            expect(output?.deltaY).toBeDefined()
            expect(output?.deltaX).toBeDefined() // also slight horizontal sway
        })
    })

    describe('glow effect', () => {
        it('should generate glow parameters', () => {
            manager.addEffect('glow', {
                type: 'glow',
                color: '#ff0000',
                intensity: 0.8,
                size: 15
            })

            manager.update(100)
            const output = manager.evaluate('glow')
            expect(output?.glowColor).toBe('#ff0000')
            expect(output?.glowIntensity).toBeGreaterThan(0)
            expect(output?.glowSize).toBeGreaterThan(0)
        })

        it('should have pulsating effect', () => {
            manager.addEffect('glow', { type: 'glow', intensity: 1, size: 10 })

            // Evaluate at t=0
            const output0 = manager.evaluate('glow')

            // Advance to t=250ms (1/4 cycle), pulsation should change
            manager.update(250)
            const output250 = manager.evaluate('glow')

            // Intensity should change (sine wave has different values at different phases)
            expect(output0?.glowIntensity).not.toBeCloseTo(output250?.glowIntensity ?? 0, 2)
        })
    })

    describe('motion_blur effect', () => {
        it('should produce motion blur parameters', () => {
            manager.addEffect('motion_blur', {
                type: 'motion_blur',
                velocity: 20,
                angle: 0
            })

            manager.update(100)
            const output = manager.evaluate('motion_blur')
            expect(output?.motionBlurVelocity).toBeDefined()
            expect(output?.motionBlurVelocity?.[0]).toBeGreaterThan(0) // horizontal direction
        })

        it('should calculate velocity components based on angle', () => {
            manager.addEffect('motion_blur', { type: 'motion_blur', velocity: 20, angle: 90 })

            manager.update(100)
            const output = manager.evaluate('motion_blur')
            const velocity = output?.motionBlurVelocity

            expect(velocity).toBeDefined()
            if (velocity) {
                // At 90 degrees, Y component should be greater than X component
                expect(Math.abs(velocity[1])).toBeGreaterThan(Math.abs(velocity[0]))
            }
        })
    })

    describe('combined effects', () => {
        it('evaluateAll should merge multiple effects', () => {
            manager.addEffect('breathe', { type: 'breathe', intensity: 0.05 })
            manager.addEffect('float', { type: 'float', amplitude: 10 })

            manager.update(500)
            const combined = manager.evaluateAll()

            // Should have both scaling and displacement
            expect(combined.deltaScaleX).toBeGreaterThan(0)
            expect(combined.deltaY).toBeDefined()
        })

        it('paused effects should not be evaluated', () => {
            manager.addEffect('effect1', { type: 'breathe', intensity: 0.1 })
            manager.addEffect('effect2', { type: 'breathe', intensity: 0.1 })

            manager.update(500)
            const beforePause = manager.evaluateAll()

            manager.pauseEffect('effect1')
            const afterPause = manager.evaluateAll()

            // After pausing one, scale delta should decrease
            expect(afterPause.deltaScaleX).toBeLessThan(beforePause.deltaScaleX ?? 0)
        })
    })

    describe('petrify effect', () => {
        it('should return petrification progress', () => {
            manager.addEffect('petrify', {
                type: 'petrify',
                duration: 1.0,
                intensity: 1.0,
                grayScale: true
            })

            // At t=0, progress should be 0
            manager.update(0)
            const output0 = manager.evaluate('petrify')
            expect(output0?.petrifyProgress).toBe(0)
            expect(output0?.petrifyGrayScale).toBe(true)

            // At t=500ms (0.5s), progress should be 0.5
            manager.update(500)
            const output500 = manager.evaluate('petrify')
            expect(output500?.petrifyProgress).toBeCloseTo(0.5, 1)

            // At t=1000ms, progress should be 1.0
            manager.update(500)
            const output1000 = manager.evaluate('petrify')
            expect(output1000?.petrifyProgress).toBeCloseTo(1.0, 1)
        })

        it('should respect intensity parameter', () => {
            manager.addEffect('petrify', {
                type: 'petrify',
                duration: 1.0,
                intensity: 0.5  // only 50% intensity
            })

            manager.update(1000) // complete entire duration
            const output = manager.evaluate('petrify')
            expect(output?.petrifyProgress).toBeCloseTo(0.5, 1) // maximum only up to 0.5
        })
    })

    describe('shatter effect', () => {
        it('should return shatter progress and alpha', () => {
            manager.addEffect('shatter', {
                type: 'shatter',
                duration: 1.5,
                pieceCount: 5,
                explodeForce: 10
            })

            // At t=0, progress=0, alpha=1
            manager.update(0)
            const output0 = manager.evaluate('shatter')
            expect(output0?.shatterProgress).toBe(0)
            expect(output0?.shatterAlpha).toBeCloseTo(1.0, 1)

            // At t=1500ms, progress=1, alpha~=0
            manager.update(1500)
            const output1500 = manager.evaluate('shatter')
            expect(output1500?.shatterProgress).toBeCloseTo(1.0, 1)
            expect(output1500?.shatterAlpha).toBeCloseTo(0, 1)
        })

        it('alpha should attenuate using easeOutQuad', () => {
            manager.addEffect('shatter', {
                type: 'shatter',
                duration: 1.0
            })

            // At 50% progress, easeOutQuad is 0.75, so alpha = 0.25
            manager.update(500)
            const output = manager.evaluate('shatter')
            expect(output?.shatterProgress).toBeCloseTo(0.5, 1)
            expect(output?.shatterAlpha).toBeCloseTo(0.25, 1)
        })
    })

    // v11.70: Progress-driven mode tests
    describe('Progress-driven mode (v11.70)', () => {
        it('calculateWithProgress should calculate jelly amplitude correctly from progress', () => {
            const params = { type: 'jelly' as const, stiffness: 8, damping: 0.3, intensity: 0.3 }

            // At progress=0 it should be maximum amplitude (cos(0) = 1, decay = 1)
            const output0 = DynamicEffectManager.calculateWithProgress(params, 0, 1000)
            expect(output0.deltaScaleX).toBeCloseTo(0.3, 1) // intensity * 1 * 1

            // At progress=0.5 amplitude should decay
            const output50 = DynamicEffectManager.calculateWithProgress(params, 0.5, 1000)
            expect(Math.abs(output50.deltaScaleX!)).toBeLessThan(0.3)

            // At progress=1 amplitude should approach 0 (damped decay)
            const output100 = DynamicEffectManager.calculateWithProgress(params, 1, 1000)
            expect(Math.abs(output100.deltaScaleX!)).toBeLessThan(0.1)
        })

        it('loop playback should reset amplitude when progress returns to zero', () => {
            const params = { type: 'jelly' as const, stiffness: 8, damping: 0.3, intensity: 0.3 }

            // Amplitude at end of round 1 (decayed)
            const end1 = DynamicEffectManager.calculateWithProgress(params, 1, 1000)

            // Amplitude at start of round 2 (progress reset to 0)
            const start2 = DynamicEffectManager.calculateWithProgress(params, 0, 1000)

            // Amplitude at start of round 2 should regain magnitude (same as round 1 start)
            expect(Math.abs(start2.deltaScaleX!)).toBeGreaterThan(Math.abs(end1.deltaScaleX!))
            expect(start2.deltaScaleX).toBeCloseTo(0.3, 1)
        })

        it('calculateWithProgress should calculate squash correctly from progress', () => {
            const params = { type: 'squash' as const, intensity: 0.2, speed: 2 }

            // At progress=0 squash=0 (sin(0)=0)
            const output0 = DynamicEffectManager.calculateWithProgress(params, 0, 1000)
            expect(output0.deltaScaleX).toBeCloseTo(0, 1)

            // At progress=0.125 squash should approach peak (sin(pi/2)=1)
            const output125 = DynamicEffectManager.calculateWithProgress(params, 0.125, 1000)
            expect(output125.deltaScaleX).toBeCloseTo(0.2, 1)
            expect(output125.deltaScaleY).toBeCloseTo(-0.2, 1)
        })

        it('calculateWithProgress calculates correctly for non-damped effects', () => {
            const breatheParams = { type: 'breathe' as const, intensity: 0.1, speed: 1 }
            const output = DynamicEffectManager.calculateWithProgress(breatheParams, 0.5, 1000)
            expect(output.deltaScaleX).toBeDefined()
            expect(output.deltaScaleY).toBeDefined()
        })

        it('duration parameter should correctly affect time baseline', () => {
            const params = { type: 'jelly' as const, stiffness: 8, damping: 0.3, intensity: 0.3 }

            // Same progress=0.5 with different duration should yield different results
            const output1000 = DynamicEffectManager.calculateWithProgress(params, 0.5, 1000)
            const output2000 = DynamicEffectManager.calculateWithProgress(params, 0.5, 2000)

            // 2000ms t=1s vs 1000ms t=0.5s differ in decay degree
            expect(output1000.deltaScaleX).not.toBeCloseTo(output2000.deltaScaleX!, 2)
        })
    })
})
