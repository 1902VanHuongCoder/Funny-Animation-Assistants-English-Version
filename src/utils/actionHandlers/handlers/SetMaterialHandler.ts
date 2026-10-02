/**
 * SetMaterial Action Handler (Added in v16)
 * Switches SymbolObject's current material
 */

import type { SetMaterialAction } from '@/types/screenplay'

import type { ActionHandler, ActionHandlerContext, WriteableState } from '../types'

export const SetMaterialHandler: ActionHandler<SetMaterialAction> = {
    type: 'set_material',
    isPointAction: true,
    isDurationAction: false,
    affectsObjectState: true,

    applyToState(state: WriteableState, action: SetMaterialAction, _context?: ActionHandlerContext): void {
        const { params } = action
        if (params.materialId !== undefined) {
            state.currentMaterialId = params.materialId
            // v18: Also write refId so ExpressionObject can also respond to set_material
            state.refId = params.materialId
        }
    }
}
