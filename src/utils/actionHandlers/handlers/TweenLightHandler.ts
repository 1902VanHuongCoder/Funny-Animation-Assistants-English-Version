/**
 * TweenLight Action Handler (Point light PRD Phase 0.5)
 * Handles continuous easing of light source parameters
 * Directly operates on state.lightColor / lightIntensity / lightRadius
 * Mirrors the implementation of TweenScreenEffectHandler
 */

import type { TweenLightAction } from '@/types/screenplay'

import type { ActionHandler, ActionHandlerContext, WriteableState } from '../types'

/**
 * Linear interpolation
 */
function lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t
}

/**
 * Hex color RGB per-channel linear interpolation
 */
function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '')
    return [
        parseInt(h.substring(0, 2), 16),
        parseInt(h.substring(2, 4), 16),
        parseInt(h.substring(4, 6), 16),
    ]
}

function rgbToHex(r: number, g: number, b: number): string {
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
    return '#' + [clamp(r), clamp(g), clamp(b)]
        .map(v => v.toString(16).padStart(2, '0'))
        .join('')
}

function lerpHexColor(from: string, to: string, t: number): string {
    const [r1, g1, b1] = hexToRgb(from)
    const [r2, g2, b2] = hexToRgb(to)
    return rgbToHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t))
}

export const TweenLightHandler: ActionHandler<TweenLightAction> = {
    type: 'tween_light',
    isPointAction: false,
    isDurationAction: true,
    affectsObjectState: true,

    applyToState(state: WriteableState, action: TweenLightAction, _context?: ActionHandlerContext): void {
        // Instantaneous application: directly set to target values
        const { params } = action
        if (params.lightColor !== undefined) state.lightColor = params.lightColor
        if (params.lightIntensity !== undefined) state.lightIntensity = params.lightIntensity
        if (params.lightRadius !== undefined) state.lightRadius = params.lightRadius
        // Phase 1: Flicker and directivity
        if (params.flicker !== undefined) state.flicker = params.flicker
        if (params.flickerSpeed !== undefined) state.flickerSpeed = params.flickerSpeed
        if (params.directionMode !== undefined) state.directionMode = params.directionMode
        if (params.directionAngle !== undefined) state.directionAngle = params.directionAngle
        if (params.coneAngle !== undefined) state.coneAngle = params.coneAngle
    },

    interpolate(
        state: WriteableState,
        action: TweenLightAction,
        progress: number,
        startState: WriteableState
    ): void {
        const { params } = action

        // Numeric parameter linear interpolation
        if (params.lightIntensity !== undefined && startState.lightIntensity !== undefined) {
            state.lightIntensity = lerp(startState.lightIntensity, params.lightIntensity, progress)
        }
        if (params.lightRadius !== undefined && startState.lightRadius !== undefined) {
            state.lightRadius = lerp(startState.lightRadius, params.lightRadius, progress)
        }
        // Color RGB per-channel interpolation
        if (params.lightColor !== undefined && startState.lightColor !== undefined) {
            state.lightColor = lerpHexColor(startState.lightColor, params.lightColor, progress)
        }
        // Phase 1: Flicker and directivity interpolation
        if (params.flicker !== undefined && startState.flicker !== undefined) {
            state.flicker = lerp(startState.flicker, params.flicker, progress)
        }
        if (params.flickerSpeed !== undefined && startState.flickerSpeed !== undefined) {
            state.flickerSpeed = lerp(startState.flickerSpeed, params.flickerSpeed, progress)
        }
        // directionMode is enum, do not interpolate, set final state directly
        if (params.directionMode !== undefined) {
            state.directionMode = params.directionMode
        }
        if (params.directionAngle !== undefined && startState.directionAngle !== undefined) {
            state.directionAngle = lerp(startState.directionAngle, params.directionAngle, progress)
        }
        if (params.coneAngle !== undefined && startState.coneAngle !== undefined) {
            state.coneAngle = lerp(startState.coneAngle, params.coneAngle, progress)
        }
    },

    getTargetState(state: WriteableState, action: TweenLightAction): void {
        this.applyToState(state, action)
    }
}
