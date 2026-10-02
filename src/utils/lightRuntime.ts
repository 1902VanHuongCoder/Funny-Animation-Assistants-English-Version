/**
 * lightRuntime — Light source runtime evaluator
 *
 * Phase 2: Drives dynamic flicker effects based on simplified parameters (flicker/flickerSpeed).
 * Phase 3: Passes directional parameters (directionMode/directionAngle/coneAngle).
 *
 * Design principles:
 * - Pure functions, side-effect free, stateless
 * - Same input always returns same output (deterministic for same timeMs)
 * - Short-circuits when flicker=0 to return static values (zero overhead)
 */

import type { LightObject } from '@/types/sceneObject'

export interface EvaluatedLight {
    /** Light X coordinate */
    x: number
    /** Light Y coordinate (including flicker micro-jitter) */
    y: number
    /** Dynamic intensity */
    intensity: number
    /** Dynamic radius */
    radius: number
    /** Light color (hex) */
    color: string
    /** Emission mode */
    directionMode: 'omni' | 'cone'
    /** Direction angle (radians) */
    directionAngle: number
    /** Cone aperture angle (degrees) */
    coneAngle: number
    /** Edge softness (internal constant) */
    softness: number
}

/** @deprecated Compatibility alias, please use EvaluatedLight */
export type EvaluatedPointLight = EvaluatedLight

/**
 * Type guard: determines whether lightType is a positional light (point or spot)
 * Used to filter lights requiring GPU computation in render pipeline
 */
export function isPointLikeLight(light: { lightType: string }): boolean {
    return light.lightType === 'point' || light.lightType === 'spot'
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}

/**
 * Generates stable phase offset from object id so multiple lights flicker out-of-sync
 * Uses multiplicative hash (hash = hash * 31 + charCode) to improve dispersion,
 * preventing structured IDs (e.g. sceneobject_01 vs sceneobject_10) from yielding identical offsets
 */
function stablePhase(id: string): number {
    let hash = 0
    for (let i = 0; i < id.length; i++) {
        hash = (hash * 31 + id.charCodeAt(i)) | 0
    }
    return Math.abs(hash) * 10.0
}

/**
 * Evaluates dynamic state of light at given time
 *
 * @param light - Light object (basic parameters + flicker/directional parameters)
 * @param timeMs - Current time (ms), typically Date.now() or virtual clock
 * @returns Evaluated runtime light state after flicker calculations
 */
export function evaluateLight(light: LightObject, timeMs: number): EvaluatedLight {
    return evaluatePointLight(light, timeMs)
}

/** @deprecated Compatibility alias, please use evaluateLight */
export function evaluatePointLight(light: LightObject, timeMs: number): EvaluatedLight {
    const baseIntensity = light.lightIntensity ?? 1.0
    const baseRadius = light.lightRadius ?? 500
    const baseX = light.x ?? 0
    const baseY = light.y ?? 0
    const flicker = light.flicker ?? 0
    const color = light.lightColor ?? '#ffffff'

    // flicker=0 short-circuit: completely static, skip noise computation
    if (flicker <= 0) {
        return {
            x: baseX,
            y: baseY,
            intensity: baseIntensity,
            radius: baseRadius,
            color,
            directionMode: light.directionMode ?? 'omni',
            directionAngle: light.directionAngle ?? 0,
            coneAngle: light.coneAngle ?? 100,
            softness: 0.35,
        }
    }

    // --- Flicker calculation ---

    const timeSec = timeMs / 1000
    const phase = stablePhase(light.id)
    const speed = lerp(0.8, 4.0, light.flickerSpeed ?? 0.35)

    // Dual-layer sine superposition (PRD §7.6)
    const baseSin = Math.sin((timeSec * speed + phase) * Math.PI * 2)
    const detailSin = Math.sin((timeSec * speed * 2.37 + phase * 1.73) * Math.PI * 2)
    const rawSignal = baseSin * 0.72 + detailSin * 0.28
    const flickerSignal = Math.max(-1, Math.min(1, rawSignal))

    // Flicker scaling factors (PRD §7.4)
    const intensityAmount = flicker * 0.18
    const radiusAmount = flicker * 0.08
    const positionJitterY = flicker * 3

    // PRD §7.8: Shift warmer (slight shift only when flickerSignal > 0)
    // normalizedSignal: 0~1, degree of warmth shift
    const normalizedSignal = Math.max(0, flickerSignal)
    const colorShiftAmount = flicker * 0.06  // Max shift magnitude
    const shiftedColor = shiftColorWarmer(color, normalizedSignal * colorShiftAmount)

    return {
        x: baseX,
        y: baseY + flickerSignal * positionJitterY,
        intensity: Math.max(0, baseIntensity * (1 + flickerSignal * intensityAmount)),
        radius: Math.max(1, baseRadius * (1 + flickerSignal * radiusAmount)),
        color: shiftedColor,
        directionMode: light.directionMode ?? 'omni',
        directionAngle: light.directionAngle ?? 0,
        coneAngle: light.coneAngle ?? 100,
        softness: 0.35,
    }
}

/**
 * Shifts hex color slightly warmer: increases R, decreases B, preserves G
 * @param hex - '#rrggbb' format
 * @param amount - Shift amount 0~1 (0=no shift, 1=max shift)
 */
function shiftColorWarmer(hex: string, amount: number): string {
    if (amount <= 0) return hex
    const h = hex.replace('#', '')
    const r = parseInt(h.substring(0, 2), 16)
    const g = parseInt(h.substring(2, 4), 16)
    const b = parseInt(h.substring(4, 6), 16)

    // Increase R, decrease B with subtle magnitude (max ±15/255 ≈ 6%)
    const shift = Math.round(amount * 15)
    const nr = Math.min(255, r + shift)
    const nb = Math.max(0, b - shift)

    const toHex = (v: number): string => v.toString(16).padStart(2, '0')
    return `#${toHex(nr)}${toHex(g)}${toHex(nb)}`
}
