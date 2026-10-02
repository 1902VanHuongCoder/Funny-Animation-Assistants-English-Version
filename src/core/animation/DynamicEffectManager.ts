/**
 * DynamicEffectManager.ts (v11.0)
 * 
 * Dynamic effect manager implementing 5 real-time visual effects:
 * - wave: Wave oscillation
 * - breathe: Breathing pulse (scaling)
 * - float: Floating up and down
 * - glow: Glow effect (requires renderer filter support)
 * - motion_blur: Motion blur (requires renderer filter support)
 * 
 * Effects are calculated in real-time via mathematical functions, without keyframes
 */

import type { EffectParams } from '@/types/animation'

/**
 * Effect output result
 */
export interface EffectOutput {
    // Transform deltas (additive on top of base transform)
    deltaX?: number
    deltaY?: number
    deltaScaleX?: number
    deltaScaleY?: number
    deltaRotation?: number  // radians
    deltaAlpha?: number

    // Filter parameters (requires renderer support)
    glowColor?: string
    glowIntensity?: number
    glowSize?: number

    // Motion blur parameters (requires renderer support)
    motionBlurVelocity?: [number, number]  // [velocityX, velocityY]
    motionBlurKernelSize?: number

    // Petrify effect parameters
    petrifyProgress?: number     // Petrify progress 0-1
    petrifyGrayScale?: boolean   // Whether to desaturate

    // Shatter effect parameters
    shatterProgress?: number     // Shatter progress 0-1
    shatterAlpha?: number        // Fade-out opacity
}

/**
 * Effect instance state
 */
interface EffectInstance {
    params: EffectParams
    startTime: number
    isActive: boolean
    wasActive: boolean  // Used to detect inactive-to-active transition
}

/**
 * DynamicEffectManager
 * Manages and calculates dynamic effects
 */
export class DynamicEffectManager {
    private effects = new Map<string, EffectInstance>()
    private currentTime = 0

    /**
     * Add or update effect
     * @param effectId Unique effect ID
     * @param params Effect parameters
     */
    addEffect(effectId: string, params: EffectParams): void {
        const existing = this.effects.get(effectId)
        if (existing) {
            // Effect already exists
            // If type changed, or jelly type transitioned from inactive to active, reset startTime
            const reactivateJelly = params.type === 'jelly' && !existing.wasActive

            if (existing.params.type !== params.type || reactivateJelly) {
                existing.startTime = this.currentTime
            }
            existing.params = params
            existing.wasActive = existing.isActive
            existing.isActive = true
        } else {
            // New effect, set startTime
            this.effects.set(effectId, {
                params,
                startTime: this.currentTime,
                isActive: true,
                wasActive: false
            })
        }
    }

    /**
     * Remove effect
     * @param effectId Unique effect ID
     */
    removeEffect(effectId: string): void {
        this.effects.delete(effectId)
    }

    /**
     * Pause effect
     */
    pauseEffect(effectId: string): void {
        const effect = this.effects.get(effectId)
        if (effect) {
            effect.wasActive = effect.isActive
            effect.isActive = false
        }
    }

    /**
     * Resume effect
     */
    resumeEffect(effectId: string): void {
        const effect = this.effects.get(effectId)
        if (effect) {
            effect.isActive = true
        }
    }

    /**
     * Update time
     * @param deltaTime Time delta (ms)
     */
    update(deltaTime: number): void {
        this.currentTime += deltaTime
    }

    /**
     * Evaluate effect output
     * @param effectId Unique effect ID
     * @returns Effect output result
     */
    evaluate(effectId: string): EffectOutput | null {
        const effect = this.effects.get(effectId)
        if (!effect?.isActive) return null

        const elapsed = this.currentTime - effect.startTime
        return this.calculateEffect(effect.params, elapsed)
    }

    /**
     * Evaluate all active effects and merge outputs
     * @returns Merged effect output
     */
    evaluateAll(): EffectOutput {
        const combined: EffectOutput = {
            deltaX: 0,
            deltaY: 0,
            deltaScaleX: 0,
            deltaScaleY: 0,
            deltaRotation: 0,
            deltaAlpha: 0
        }

        for (const [, effect] of this.effects) {
            if (!effect.isActive) continue

            const elapsed = this.currentTime - effect.startTime
            const output = this.calculateEffect(effect.params, elapsed)

            // Merge transform deltas
            combined.deltaX = (combined.deltaX ?? 0) + (output.deltaX ?? 0)
            combined.deltaY = (combined.deltaY ?? 0) + (output.deltaY ?? 0)
            combined.deltaScaleX = (combined.deltaScaleX ?? 0) + (output.deltaScaleX ?? 0)
            combined.deltaScaleY = (combined.deltaScaleY ?? 0) + (output.deltaScaleY ?? 0)
            combined.deltaRotation = (combined.deltaRotation ?? 0) + (output.deltaRotation ?? 0)
            combined.deltaAlpha = (combined.deltaAlpha ?? 0) + (output.deltaAlpha ?? 0)

            // Filter parameters use the last one
            if (output.glowColor) combined.glowColor = output.glowColor
            if (output.glowIntensity) combined.glowIntensity = output.glowIntensity
            if (output.glowSize) combined.glowSize = output.glowSize
            if (output.motionBlurVelocity) combined.motionBlurVelocity = output.motionBlurVelocity
            if (output.motionBlurKernelSize) combined.motionBlurKernelSize = output.motionBlurKernelSize
        }

        return combined
    }

    /**
     * Calculate output based on effect type
     */
    private calculateEffect(params: EffectParams, elapsedMs: number): EffectOutput {
        const t = elapsedMs / 1000 // Convert to seconds

        switch (params.type) {
            case 'wave':
                return this.calculateWave(params, t)
            case 'breathe':
                return this.calculateBreathe(params, t)
            case 'float':
                return this.calculateFloat(params, t)
            case 'glow':
                return this.calculateGlow(params, t)
            case 'motion_blur':
                return this.calculateMotionBlur(params, t)
            case 'jelly':
                return this.calculateJelly(params, t)
            case 'squash':
                return this.calculateSquash(params, t)
            case 'shake':
                return this.calculateShake(params, t)
            case 'petrify':
                return this.calculatePetrify(params, t)
            case 'shatter':
                return this.calculateShatter(params, t)
            default:
                return {}
        }
    }

    /**
     * Wave oscillation effect
     * Makes object sway horizontally/vertically like a flag or seaweed
     */
    private calculateWave(
        params: { type: 'wave'; speed?: number; amplitude?: number; frequency?: number; direction?: 'horizontal' | 'vertical' | 'both' },
        t: number
    ): EffectOutput {
        const speed = params.speed ?? 1
        const amplitude = params.amplitude ?? 5  // pixels
        const frequency = params.frequency ?? 2  // Hz
        const direction = params.direction ?? 'horizontal'

        // Sine wave displacement
        const phase = t * speed * frequency * Math.PI * 2
        const displacement = Math.sin(phase) * amplitude

        // Add minor rotation to enhance sway feel
        const rotationAmplitude = amplitude * 0.01  // radians
        const rotation = Math.sin(phase) * rotationAmplitude

        if (direction === 'horizontal') {
            return {
                deltaX: displacement,
                deltaRotation: rotation
            }
        } else if (direction === 'vertical') {
            return {
                deltaY: displacement,
                deltaRotation: rotation * 0.5
            }
        } else {
            // both
            return {
                deltaX: displacement,
                deltaY: displacement,
                deltaRotation: rotation * 0.75
            }
        }
    }

    /**
     * Breathing pulse effect
     * Periodically scales object, simulating breathing or heartbeat
     */
    private calculateBreathe(
        params: { type: 'breathe'; intensity?: number; speed?: number },
        t: number
    ): EffectOutput {
        const intensity = params.intensity ?? 0.05  // Scale amplitude (5%)
        const speed = params.speed ?? 1

        // Use smooth sine wave
        const phase = t * speed * Math.PI * 2
        // (1 - cos) / 2 produces smooth 0-1 waveform
        const scale = (1 - Math.cos(phase)) / 2 * intensity

        return {
            deltaScaleX: scale,
            deltaScaleY: scale
        }
    }

    /**
     * Floating effect
     * Makes object move up and down like floating on water
     */
    private calculateFloat(
        params: { type: 'float'; amplitude?: number; speed?: number },
        t: number
    ): EffectOutput {
        const amplitude = params.amplitude ?? 10  // pixels
        const speed = params.speed ?? 1

        // Calculate Y displacement with sine wave
        const phase = t * speed * Math.PI * 2 * 0.5  // Slower frequency is more natural
        const deltaY = Math.sin(phase) * amplitude

        // Add slight horizontal sway
        const deltaX = Math.cos(phase * 0.7) * amplitude * 0.2

        return {
            deltaX,
            deltaY
        }
    }

    /**
     * Glow effect
     * Produces a pulsating glow outline on object (requires renderer filter support)
     */
    private calculateGlow(
        params: { type: 'glow'; color?: string; intensity?: number; size?: number },
        t: number
    ): EffectOutput {
        const color = params.color ?? '#ffffff'
        const baseIntensity = params.intensity ?? 2.0
        const baseSize = params.size ?? 15

        // Glow intensity pulsation
        const phase = t * Math.PI * 2
        const pulse = (Math.sin(phase) + 1) / 2  // 0-1

        return {
            glowColor: color,
            glowIntensity: baseIntensity * (0.7 + pulse * 0.3),  // 70%-100%
            glowSize: baseSize * (0.8 + pulse * 0.2)  // 80%-100%
        }
    }

    /**
     * Motion blur effect
     * Computes blur parameters based on direction and speed
     */
    private calculateMotionBlur(
        params: { type: 'motion_blur'; velocity?: number; angle?: number; kernelSize?: number },
        t: number
    ): EffectOutput {
        const velocity = params.velocity ?? 20
        const angle = params.angle ?? 0  // degrees
        const kernelSize = params.kernelSize ?? 5

        // Calculate velocity components based on angle
        const radians = angle * Math.PI / 180
        // Add subtle pulsation effect
        const pulse = 0.8 + Math.sin(t * Math.PI * 2) * 0.2
        const velocityX = Math.cos(radians) * velocity * pulse
        const velocityY = Math.sin(radians) * velocity * pulse

        return {
            motionBlurVelocity: [velocityX, velocityY],
            motionBlurKernelSize: kernelSize
        }
    }

    /**
     * Jelly wobble effect
     * Simulates elastic vibration using damped spring model
     */
    private calculateJelly(
        params: { type: 'jelly'; stiffness?: number; damping?: number; intensity?: number },
        t: number
    ): EffectOutput {
        const stiffness = params.stiffness ?? 8
        const damping = params.damping ?? 0.3
        const intensity = params.intensity ?? 0.3

        // Damped vibration formula: A * e^(-damping*t) * cos(stiffness*t)
        const decay = Math.exp(-damping * t * stiffness)
        const oscillation = Math.cos(stiffness * t * Math.PI * 2)
        const scaleOffset = decay * oscillation * intensity

        // Phase difference in X/Y directions creates jelly feel
        return {
            deltaScaleX: scaleOffset,
            deltaScaleY: scaleOffset * Math.cos(t * stiffness * 0.7)
        }
    }

    /**
     * Squash and stretch effect
     * Complementary scaling in X/Y directions, simulating volume conservation
     */
    private calculateSquash(
        params: { type: 'squash'; intensity?: number; speed?: number },
        t: number
    ): EffectOutput {
        const intensity = params.intensity ?? 0.2
        const speed = params.speed ?? 2

        // Use absolute sine wave to produce periodic squash
        const phase = t * speed * Math.PI * 2
        const squashFactor = Math.abs(Math.sin(phase)) * intensity

        // X stretch, Y squash (volume conservation)
        return {
            deltaScaleX: squashFactor,
            deltaScaleY: -squashFactor
        }
    }

    /**
     * Shake / nod effect
     * Periodic rotation or translation
     */
    private calculateShake(
        params: { type: 'shake'; speed?: number; range?: number; axis?: 'x' | 'y' | 'rotation' },
        t: number
    ): EffectOutput {
        const speed = params.speed ?? 5
        const range = params.range ?? 10
        const axis = params.axis ?? 'rotation'

        const phase = t * speed * Math.PI * 2
        const offset = Math.sin(phase) * range

        if (axis === 'rotation') {
            // Rotation shake (degrees to radians)
            return {
                deltaRotation: offset * (Math.PI / 180)
            }
        } else if (axis === 'x') {
            return {
                deltaX: offset
            }
        } else {
            return {
                deltaY: offset
            }
        }
    }

    /**
     * Petrify effect
     * Gradually petrifies over time, returns progress for renderer ColorMatrixFilter application
     */
    private calculatePetrify(
        params: { type: 'petrify'; duration?: number; intensity?: number; grayScale?: boolean },
        t: number
    ): EffectOutput {
        const duration = params.duration ?? 1.0
        const intensity = params.intensity ?? 1.0
        const grayScale = params.grayScale ?? true

        // Calculate progress (0-1), scaled by intensity
        const rawProgress = Math.min(t / duration, 1.0)
        const progress = rawProgress * intensity

        return {
            petrifyProgress: progress,
            petrifyGrayScale: grayScale
        }
    }

    /**
     * Shatter effect
     * Object gradually dissipates over time, returns progress and alpha for renderer application
     */
    private calculateShatter(
        params: { type: 'shatter'; pieceCount?: number; explodeForce?: number; duration?: number },
        t: number
    ): EffectOutput {
        const duration = params.duration ?? 1.5
        // pieceCount and explodeForce only affect renderer behavior in simplified implementation; only compute progress here

        // Calculate progress (0-1)
        const progress = Math.min(t / duration, 1.0)

        // Alpha fades from 1 to 0, using easeOutQuad for more natural dissipation
        // easeOutQuad: 1 - (1-t)^2
        const easeOutQuad = 1 - (1 - progress) * (1 - progress)
        const alpha = 1.0 - easeOutQuad

        return {
            shatterProgress: progress,
            shatterAlpha: alpha
        }
    }

    // ========== v11.70: Progress-driven mode ==========

    /**
     * v11.70: Progress-driven mode - compute effect output based on animation progress
     * Pure function, independent of Manager internal state (currentTime/startTime)
     * 
     * @param params Effect parameters
     * @param progress Animation progress (0-1)
     * @param duration Animation duration (ms)
     * @returns Effect output result
     */
    static calculateWithProgress(params: EffectParams, progress: number, duration: number): EffectOutput {
        const t = (progress * duration) / 1000 // Convert to seconds
        return DynamicEffectManager.calculateEffectStatic(params, t)
    }

    /**
     * v11.70: Static effect calculation
     * Extracts original calculateEffect logic as static method
     */
    private static calculateEffectStatic(params: EffectParams, t: number): EffectOutput {
        switch (params.type) {
            case 'wave':
                return DynamicEffectManager.calculateWaveStatic(params, t)
            case 'breathe':
                return DynamicEffectManager.calculateBreatheStatic(params, t)
            case 'float':
                return DynamicEffectManager.calculateFloatStatic(params, t)
            case 'glow':
                return DynamicEffectManager.calculateGlowStatic(params, t)
            case 'motion_blur':
                return DynamicEffectManager.calculateMotionBlurStatic(params, t)
            case 'jelly':
                return DynamicEffectManager.calculateJellyStatic(params, t)
            case 'squash':
                return DynamicEffectManager.calculateSquashStatic(params, t)
            case 'shake':
                return DynamicEffectManager.calculateShakeStatic(params, t)
            case 'petrify':
                return DynamicEffectManager.calculatePetrifyStatic(params, t)
            case 'shatter':
                return DynamicEffectManager.calculateShatterStatic(params, t)
            default:
                return {}
        }
    }

    // ========== v11.70: Static effect calculation methods ==========

    private static calculateWaveStatic(
        params: { type: 'wave'; speed?: number; amplitude?: number; frequency?: number; direction?: 'horizontal' | 'vertical' | 'both' },
        t: number
    ): EffectOutput {
        const speed = params.speed ?? 1
        const amplitude = params.amplitude ?? 5
        const frequency = params.frequency ?? 2
        const direction = params.direction ?? 'horizontal'

        const phase = t * speed * frequency * Math.PI * 2
        const displacement = Math.sin(phase) * amplitude
        const rotationAmplitude = amplitude * 0.01
        const rotation = Math.sin(phase) * rotationAmplitude

        if (direction === 'horizontal') {
            return { deltaX: displacement, deltaRotation: rotation }
        } else if (direction === 'vertical') {
            return { deltaY: displacement, deltaRotation: rotation * 0.5 }
        } else {
            return { deltaX: displacement, deltaY: displacement, deltaRotation: rotation * 0.75 }
        }
    }

    private static calculateBreatheStatic(
        params: { type: 'breathe'; intensity?: number; speed?: number },
        t: number
    ): EffectOutput {
        const intensity = params.intensity ?? 0.05
        const speed = params.speed ?? 1
        const phase = t * speed * Math.PI * 2
        const scale = (1 - Math.cos(phase)) / 2 * intensity
        return { deltaScaleX: scale, deltaScaleY: scale }
    }

    private static calculateFloatStatic(
        params: { type: 'float'; amplitude?: number; speed?: number },
        t: number
    ): EffectOutput {
        const amplitude = params.amplitude ?? 10
        const speed = params.speed ?? 1
        const phase = t * speed * Math.PI * 2 * 0.5
        const deltaY = Math.sin(phase) * amplitude
        const deltaX = Math.cos(phase * 0.7) * amplitude * 0.2
        return { deltaX, deltaY }
    }

    private static calculateGlowStatic(
        params: { type: 'glow'; color?: string; intensity?: number; size?: number },
        t: number
    ): EffectOutput {
        const color = params.color ?? '#ffffff'
        const baseIntensity = params.intensity ?? 2.0
        const baseSize = params.size ?? 15
        const phase = t * Math.PI * 2
        const pulse = (Math.sin(phase) + 1) / 2
        return {
            glowColor: color,
            glowIntensity: baseIntensity * (0.7 + pulse * 0.3),
            glowSize: baseSize * (0.8 + pulse * 0.2)
        }
    }

    private static calculateMotionBlurStatic(
        params: { type: 'motion_blur'; velocity?: number; angle?: number; kernelSize?: number },
        t: number
    ): EffectOutput {
        const velocity = params.velocity ?? 20
        const angle = params.angle ?? 0
        const kernelSize = params.kernelSize ?? 5
        const radians = angle * Math.PI / 180
        const pulse = 0.8 + Math.sin(t * Math.PI * 2) * 0.2
        const velocityX = Math.cos(radians) * velocity * pulse
        const velocityY = Math.sin(radians) * velocity * pulse
        return { motionBlurVelocity: [velocityX, velocityY], motionBlurKernelSize: kernelSize }
    }

    private static calculateJellyStatic(
        params: { type: 'jelly'; stiffness?: number; damping?: number; intensity?: number },
        t: number
    ): EffectOutput {
        const stiffness = params.stiffness ?? 8
        const damping = params.damping ?? 0.3
        const intensity = params.intensity ?? 0.3
        const decay = Math.exp(-damping * t * stiffness)
        const oscillation = Math.cos(stiffness * t * Math.PI * 2)
        const scaleOffset = decay * oscillation * intensity
        return {
            deltaScaleX: scaleOffset,
            deltaScaleY: scaleOffset * Math.cos(t * stiffness * 0.7)
        }
    }

    private static calculateSquashStatic(
        params: { type: 'squash'; intensity?: number; speed?: number },
        t: number
    ): EffectOutput {
        const intensity = params.intensity ?? 0.2
        const speed = params.speed ?? 2
        const phase = t * speed * Math.PI * 2
        const squashFactor = Math.abs(Math.sin(phase)) * intensity
        return { deltaScaleX: squashFactor, deltaScaleY: -squashFactor }
    }

    private static calculateShakeStatic(
        params: { type: 'shake'; speed?: number; range?: number; axis?: 'x' | 'y' | 'rotation' },
        t: number
    ): EffectOutput {
        const speed = params.speed ?? 5
        const range = params.range ?? 10
        const axis = params.axis ?? 'rotation'
        const phase = t * speed * Math.PI * 2
        const offset = Math.sin(phase) * range

        if (axis === 'rotation') {
            return { deltaRotation: offset * (Math.PI / 180) }
        } else if (axis === 'x') {
            return { deltaX: offset }
        } else {
            return { deltaY: offset }
        }
    }

    private static calculatePetrifyStatic(
        params: { type: 'petrify'; duration?: number; intensity?: number; grayScale?: boolean },
        t: number
    ): EffectOutput {
        const duration = params.duration ?? 1.0
        const intensity = params.intensity ?? 1.0
        const grayScale = params.grayScale ?? true
        const rawProgress = Math.min(t / duration, 1.0)
        const progress = rawProgress * intensity
        return { petrifyProgress: progress, petrifyGrayScale: grayScale }
    }

    private static calculateShatterStatic(
        params: { type: 'shatter'; pieceCount?: number; explodeForce?: number; duration?: number },
        t: number
    ): EffectOutput {
        const duration = params.duration ?? 1.5
        const progress = Math.min(t / duration, 1.0)
        const easeOutQuad = 1 - (1 - progress) * (1 - progress)
        const alpha = 1.0 - easeOutQuad
        return { shatterProgress: progress, shatterAlpha: alpha }
    }

    /**
     * Clear all effects
     */
    clear(): void {
        this.effects.clear()
        this.currentTime = 0
    }

    /**
     * Get number of active effects
     */
    get activeCount(): number {
        let count = 0
        for (const [, effect] of this.effects) {
            if (effect.isActive) count++
        }
        return count
    }
}

// Export singleton factory function
let _instance: DynamicEffectManager | null = null

export function getDynamicEffectManager(): DynamicEffectManager {
    _instance ??= new DynamicEffectManager()
    return _instance
}

export function createDynamicEffectManager(): DynamicEffectManager {
    return new DynamicEffectManager()
}
