/**
 * SetLight Action Handler (Point light PRD Phase 0.5)
 * Handles instantaneous setting of light source parameters
 * Directly operates on state.lightColor / lightIntensity / lightRadius
 * Mirrors the concise implementation of SetScreenEffectHandler
 */

import type { SetLightAction } from '@/types/screenplay'

import type { ActionHandler, ActionHandlerContext, WriteableState } from '../types'

export const SetLightHandler: ActionHandler<SetLightAction> = {
    type: 'set_light',
    isPointAction: true,
    isDurationAction: false,
    affectsObjectState: true,

    applyToState(state: WriteableState, action: SetLightAction, _context?: ActionHandlerContext): void {
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
    }
}
