/**
 * SetMask Action Handler — Clip-Mask Phase 1
 *
 * Handles mask object property changes: targetIds, shape, width, height
 * Does not handle mode (Phase 1 locked to inside_visible)
 * Does not handle transform/visual fields (handled via set_transform / set_visual)
 *
 * Partial update semantics: omitted fields remain unchanged.
 *
 * Note: This Handler internally *does not* resolve multiple masks targeting the same target exclusive conflicts.
 * Merging within the same slot + global reverse-index resolution is done in sceneStateCalculator's
 * mask post-pass (see docs/features/clip-mask.md §3 D1.5).
 *
 * Usage:
 * - set_mask { shape: 'ellipse' }
 * - set_mask { targetIds: ['propA', 'propB'] }
 * - set_mask { width: 640, height: 180 }
 */

import type { SetMaskAction } from '@/types/screenplay'

import type { ActionHandler, WriteableState } from '../types'

export const SetMaskHandler: ActionHandler<SetMaskAction> = {
    type: 'set_mask',
    isPointAction: true,
    isDurationAction: false,
    affectsObjectState: true,

    applyToState(state: WriteableState, action: SetMaskAction): void {
        const { params } = action

        if (params.targetIds !== undefined) {
            // Whole array replacement (no deduplication / type validation here — guaranteed by ActionEditor write side + deserialization guard)
            state.targetIds = [...params.targetIds]
        }
        if (params.shape !== undefined) {
            state.shape = params.shape
        }
        if (params.width !== undefined && Number.isFinite(params.width) && params.width > 0) {
            state.width = params.width
        }
        if (params.height !== undefined && Number.isFinite(params.height) && params.height > 0) {
            state.height = params.height
        }
    },
}
