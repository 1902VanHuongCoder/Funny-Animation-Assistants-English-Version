/**
 * SetScreenEffect Action Handler (Phase 1)
 * Handles instantaneous setting of screen effect parameters
 * Directly operates on nested state.params structure (eliminating flat state intermediate layer)
 */

import type { ScreenEffectParams } from '@/types/sceneObject'
import type { SetScreenEffectAction } from '@/types/screenplay'

import type { ActionHandler, ActionHandlerContext, WriteableState } from '../types'

export const SetScreenEffectHandler: ActionHandler<SetScreenEffectAction> = {
    type: 'set_screen_effect',
    isPointAction: true,
    isDurationAction: false,
    affectsObjectState: true,

    applyToState(state: WriteableState, action: SetScreenEffectAction, _context?: ActionHandlerContext): void {
        const { params } = action
        state.params ??= {} as ScreenEffectParams
        const p = state.params

        // Coverage parameters (coverOpacity deleted, uniformly controlled by alpha)
        if (params.baseColor !== undefined) p.baseColor = params.baseColor

        // Hole parameters
        if (params.holeShape !== undefined) p.holeShape = params.holeShape
        if (params.holeCenterX !== undefined) p.holeCenterX = params.holeCenterX
        if (params.holeCenterY !== undefined) p.holeCenterY = params.holeCenterY
        if (params.holeWidth !== undefined) p.holeWidth = params.holeWidth
        if (params.holeHeight !== undefined) p.holeHeight = params.holeHeight
        if (params.openRatio !== undefined) p.openRatio = params.openRatio
        if (params.feather !== undefined) p.feather = params.feather

        // Target following parameters
        if (params.targetId !== undefined) p.targetId = params.targetId
        if (params.offsetX !== undefined) p.offsetX = params.offsetX
        if (params.offsetY !== undefined) p.offsetY = params.offsetY
    }
}
