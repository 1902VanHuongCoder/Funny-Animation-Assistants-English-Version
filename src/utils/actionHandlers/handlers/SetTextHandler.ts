/**
 * SetText Action Handler (Text PRD Phase 0 + Phase 1)
 * Handles instantaneous setting of text properties
 * Directly operates on text fields on state (follows SetScreenEffectHandler pattern)
 */

import type { SetTextAction } from '@/types/screenplay'
import { resolveTextLineHeight } from '@/utils/textUtils'

import type { ActionHandler, WriteableState } from '../types'

export const SetTextHandler: ActionHandler<SetTextAction> = {
    type: 'set_text',
    isPointAction: true,
    isDurationAction: false,
    affectsObjectState: true,

    applyToState(state: WriteableState, action: SetTextAction): void {
        const { params } = action
        // Phase 0: Basic properties
        if (params.content !== undefined) state.content = params.content
        if (params.fontSize !== undefined) state.fontSize = params.fontSize
        if (params.fontFamily !== undefined) state.fontFamily = params.fontFamily
        if (params.fontWeight !== undefined) state.fontWeight = params.fontWeight
        if (params.fontStyle !== undefined) state.fontStyle = params.fontStyle
        if (params.color !== undefined) state.color = params.color
        if (params.align !== undefined) state.align = params.align
        if (params.wordWrap !== undefined) state.wordWrap = params.wordWrap
        if (params.wordWrapWidth !== undefined) state.wordWrapWidth = params.wordWrapWidth
        // Phase 1: Stroke
        if (params.stroke !== undefined) state.stroke = params.stroke
        if (params.strokeThickness !== undefined) state.strokeThickness = params.strokeThickness
        // Phase 1: Drop shadow
        if (params.dropShadow !== undefined) state.dropShadow = params.dropShadow
        if (params.dropShadowColor !== undefined) state.dropShadowColor = params.dropShadowColor
        if (params.dropShadowBlur !== undefined) state.dropShadowBlur = params.dropShadowBlur
        if (params.dropShadowAngle !== undefined) state.dropShadowAngle = params.dropShadowAngle
        if (params.dropShadowDistance !== undefined) state.dropShadowDistance = params.dropShadowDistance
        // Phase 1: Spacing
        if (params.letterSpacing !== undefined) state.letterSpacing = params.letterSpacing
        if (params.lineHeight !== undefined) {
            const resolved = resolveTextLineHeight(
                state.fontFamily,
                state.fontSize,
                params.lineHeight,
            )
            if (resolved.source === 'explicit') {
                state.lineHeight = resolved.lineHeight
            } else {
                delete state.lineHeight
            }
        }
        if (params.textBoxMode !== undefined) state.textBoxMode = params.textBoxMode
        if (params.writingMode !== undefined) state.writingMode = params.writingMode
        // Phase 2: Typewriter
        if (params.revealSpeed !== undefined) {
            const speed = Number(params.revealSpeed)
            state.revealSpeed = Number.isFinite(speed)
                ? Math.max(0.5, Math.min(60, speed))
                : 8
        }
        if (params.fillType !== undefined) state.fillType = params.fillType
        if (params.gradientStops !== undefined) state.gradientStops = params.gradientStops
        if (params.gradientAngle !== undefined) state.gradientAngle = params.gradientAngle
        if (params.textBackgroundEnabled !== undefined) state.textBackgroundEnabled = params.textBackgroundEnabled
        if (params.textBackgroundColor !== undefined) state.textBackgroundColor = params.textBackgroundColor
        if (params.textBackgroundAlpha !== undefined) state.textBackgroundAlpha = params.textBackgroundAlpha
        if (params.textBackgroundPaddingX !== undefined) state.textBackgroundPaddingX = params.textBackgroundPaddingX
        if (params.textBackgroundPaddingY !== undefined) state.textBackgroundPaddingY = params.textBackgroundPaddingY
        if (params.textBackgroundRadius !== undefined) state.textBackgroundRadius = params.textBackgroundRadius
    },
}
