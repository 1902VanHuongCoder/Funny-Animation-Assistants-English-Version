/**
 * Easing Functions Library
 * Easing library supporting various animation easing effects in the Animation system
 */

import type { EasingType } from '@/types/animation'

/**
 * Easing function type
 */
export type EasingFunction = (t: number) => number

/**
 * Linear easing
 */
export function linear(t: number): number {
    return t
}

/**
 * Step easing
 * Holds start value until completion, suitable for discrete state changes
 */
export function step(_t: number): number {
    // Always returns 0 to hold start value
    // Interpolation result: start + (end - start) * 0 = start
    return 0
}

/**
 * Quadratic easing - In
 */
export function easeInQuad(t: number): number {
    return t * t
}

/**
 * Quadratic easing - Out
 */
export function easeOutQuad(t: number): number {
    return 1 - (1 - t) * (1 - t)
}

/**
 * Quadratic easing - In/Out
 */
export function easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/**
 * Cubic easing - In
 */
export function easeInCubic(t: number): number {
    return t * t * t
}

/**
 * Cubic easing - Out
 */
export function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3)
}

/**
 * Cubic easing - In/Out
 */
export function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Sine easing - In
 */
export function easeInSine(t: number): number {
    return 1 - Math.cos((t * Math.PI) / 2)
}

/**
 * Sine easing - Out
 */
export function easeOutSine(t: number): number {
    return Math.sin((t * Math.PI) / 2)
}

/**
 * Sine easing - In/Out
 */
export function easeInOutSine(t: number): number {
    return -(Math.cos(Math.PI * t) - 1) / 2
}

/**
 * Elastic easing - In
 */
export function easeInElastic(t: number): number {
    const c4 = (2 * Math.PI) / 3
    return t === 0
        ? 0
        : t === 1
            ? 1
            : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4)
}

/**
 * Elastic easing - Out
 */
export function easeOutElastic(t: number): number {
    const c4 = (2 * Math.PI) / 3
    return t === 0
        ? 0
        : t === 1
            ? 1
            : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
}

/**
 * Elastic easing - In/Out
 */
export function easeInOutElastic(t: number): number {
    const c5 = (2 * Math.PI) / 4.5
    return t === 0
        ? 0
        : t === 1
            ? 1
            : t < 0.5
                ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
                : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1
}

/**
 * Bounce easing - In
 */
export function easeInBounce(t: number): number {
    return 1 - easeOutBounce(1 - t)
}

/**
 * Bounce easing - Out
 */
export function easeOutBounce(t: number): number {
    const n1 = 7.5625
    const d1 = 2.75

    if (t < 1 / d1) {
        return n1 * t * t
    } else if (t < 2 / d1) {
        return n1 * (t -= 1.5 / d1) * t + 0.75
    } else if (t < 2.5 / d1) {
        return n1 * (t -= 2.25 / d1) * t + 0.9375
    } else {
        return n1 * (t -= 2.625 / d1) * t + 0.984375
    }
}

/**
 * Bounce easing - In/Out
 */
export function easeInOutBounce(t: number): number {
    return t < 0.5
        ? (1 - easeOutBounce(1 - 2 * t)) / 2
        : (1 + easeOutBounce(2 * t - 1)) / 2
}

/**
 * Simplified easeIn (uses quadratic)
 */
export function easeIn(t: number): number {
    return easeInQuad(t)
}

/**
 * Simplified easeOut (uses quadratic)
 */
export function easeOut(t: number): number {
    return easeOutQuad(t)
}

/**
 * Simplified easeInOut (uses quadratic)
 */
export function easeInOut(t: number): number {
    return easeInOutQuad(t)
}

/**
 * Easing functions map
 */
const easingFunctions: Record<EasingType, EasingFunction> = {
    linear,
    step,
    easeIn,
    easeOut,
    easeInOut,
    easeInQuad,
    easeOutQuad,
    easeInOutQuad,
    easeInCubic,
    easeOutCubic,
    easeInOutCubic,
    easeInSine,
    easeOutSine,
    easeInOutSine,
    easeInElastic,
    easeOutElastic,
    easeInOutElastic,
    easeInBounce,
    easeOutBounce,
    easeInOutBounce,
}

/**
 * Get easing function
 */
export function getEasingFunction(type: EasingType): EasingFunction {
    return easingFunctions[type] ?? linear
}

/**
 * Apply easing function
 * @param t Normalized time (0-1)
 * @param easing Easing type
 */
export function applyEasing(t: number, easing: EasingType = 'linear'): number {
    const fn = getEasingFunction(easing)
    return fn(Math.max(0, Math.min(1, t)))
}

/**
 * Linear interpolation
 */
export function lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t
}
