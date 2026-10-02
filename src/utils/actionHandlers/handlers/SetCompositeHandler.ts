/**
 * SetComposite Action Handler (P2)
 * Handles composite object property changes: compositeMode, renderChain sorting, etc.
 *
 * Follows the "field family consolidation" design pattern (analogous to SetVisualHandler merging visible/flipX/zIndex),
 * consolidating composite-specific properties into a single Action type.
 *
 * Usage:
 * - set_composite { compositeMode: "entity" } → Switch composite mode
 * - set_composite { renderChain: ["B", "A", "C"] } → Modify render chain order
 */

import type { SetCompositeAction } from '@/types/screenplay'

import type { ActionHandler, ActionHandlerContext, WriteableState } from '../types'

export const SetCompositeHandler: ActionHandler<SetCompositeAction> = {
    type: 'set_composite',
    isPointAction: true,
    isDurationAction: false,
    affectsObjectState: true,

    applyToState(state: WriteableState, action: SetCompositeAction, _context?: ActionHandlerContext): void {
        const { params } = action

        if (params.compositeMode !== undefined) state.compositeMode = params.compositeMode
        if (params.renderChain !== undefined) state.renderChain = [...params.renderChain]
    },
}

