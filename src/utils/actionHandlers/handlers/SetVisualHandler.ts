/**
 * SetVisual Action Handler (Added in v9.3)
 * Handles visual property transforms: visible, flipX, zIndex
 * 
 * Can coexist with set_transform and tween_transform
 */

import type { SetVisualAction } from '@/types/screenplay'

import type { ActionHandler, ActionHandlerContext, WriteableState } from '../types'

export const SetVisualHandler: ActionHandler<SetVisualAction> = {
    type: 'set_visual',
    isPointAction: true,
    isDurationAction: false,
    affectsObjectState: true,

    applyToState(state: WriteableState, action: SetVisualAction, _context?: ActionHandlerContext): void {
        const { params } = action

        // Visual properties
        if (params.visible !== undefined) state.visible = params.visible
        if (params.flipX !== undefined) state.flipX = params.flipX
        if (params.zIndex !== undefined) state.zIndex = params.zIndex
        if (params.receiveLighting !== undefined) state.receiveLighting = params.receiveLighting
        if (params.castShadow !== undefined) state.castShadow = params.castShadow
    }
}
