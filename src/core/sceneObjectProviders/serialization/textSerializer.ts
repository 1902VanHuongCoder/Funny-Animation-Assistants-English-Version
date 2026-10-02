/**
 * Text serializer
 *
 * Extracted from sceneObjectStore text case.
 * Serializes/deserializes TextObject subtype-specialized fields.
 */

import type { SceneObject, TextObject } from '@/types/sceneObject'
import { resolveTextLineHeight } from '@/utils/textUtils'

import type { DeserializeContext, TypeSerializer } from './index'
import { registerTypeSerializer } from './index'

const textSerializer: TypeSerializer = {
    serializeFields(obj: SceneObject, base: Record<string, unknown>): void {
        const text = obj as TextObject
        base['content'] = text.content
        base['fontSize'] = text.fontSize
        base['fontFamily'] = text.fontFamily
        base['fontWeight'] = text.fontWeight ?? 'normal'
        base['fontStyle'] = text.fontStyle ?? 'normal'
        base['color'] = text.color
        base['align'] = text.align
        base['wordWrap'] = text.wordWrap ?? true
        base['wordWrapWidth'] = text.wordWrapWidth ?? 400
        // Phase 1: Visual enhancement
        if (text.stroke !== undefined) base['stroke'] = text.stroke
        if (text.strokeThickness !== undefined) base['strokeThickness'] = text.strokeThickness
        if (text.dropShadow) {
            base['dropShadow'] = text.dropShadow
            if (text.dropShadowColor !== undefined) base['dropShadowColor'] = text.dropShadowColor
            if (text.dropShadowBlur !== undefined) base['dropShadowBlur'] = text.dropShadowBlur
            if (text.dropShadowAngle !== undefined) base['dropShadowAngle'] = text.dropShadowAngle
            if (text.dropShadowDistance !== undefined) base['dropShadowDistance'] = text.dropShadowDistance
        }
        if (text.lineHeight !== undefined) {
            const resolved = resolveTextLineHeight(text.fontFamily, text.fontSize, text.lineHeight)
            if (resolved.source === 'explicit') base['lineHeight'] = resolved.lineHeight
        }
        if (text.letterSpacing !== undefined) base['letterSpacing'] = text.letterSpacing
        if (text.textBoxMode && text.textBoxMode !== 'auto-size') base['textBoxMode'] = text.textBoxMode
        if (text.writingMode && text.writingMode !== 'horizontal') base['writingMode'] = text.writingMode
        // Phase 2: Animation
        if (text.revealInitialState === 'typewriter') base['revealInitialState'] = text.revealInitialState
        if (text.revealSpeed !== undefined) base['revealSpeed'] = text.revealSpeed
        if (text.fillType === 'linear_gradient') {
            base['fillType'] = text.fillType
            if (text.gradientStops) base['gradientStops'] = text.gradientStops
            if (text.gradientAngle !== undefined) base['gradientAngle'] = text.gradientAngle
        }
        if (text.textBackgroundEnabled) base['textBackgroundEnabled'] = true
        if (text.textBackgroundColor !== undefined) base['textBackgroundColor'] = text.textBackgroundColor
        if (text.textBackgroundAlpha !== undefined) base['textBackgroundAlpha'] = text.textBackgroundAlpha
        if (text.textBackgroundPaddingX !== undefined) base['textBackgroundPaddingX'] = text.textBackgroundPaddingX
        if (text.textBackgroundPaddingY !== undefined) base['textBackgroundPaddingY'] = text.textBackgroundPaddingY
        if (text.textBackgroundRadius !== undefined) base['textBackgroundRadius'] = text.textBackgroundRadius
    },

    deserialize(objData: SceneObject, ctx: DeserializeContext): void {
        const textData = objData as TextObject
        const textObj = ctx.createTextObject(
            textData.content ?? 'Text',
            undefined,
            objData.id,
            objData.alias ?? '',
        )
        const resolvedLineHeight = resolveTextLineHeight(
            textData.fontFamily ?? 'Noto Sans SC',
            textData.fontSize ?? 72,
            textData.lineHeight,
        )
        ctx.updateObject<import('@/types/sceneObject').TextObject>(textObj.id, {
            x: objData.x,
            y: objData.y,
            width: objData.width ?? textObj.width,
            height: objData.height ?? textObj.height,
            scaleX: objData.scaleX,
            scaleY: objData.scaleY,
            rotation: objData.rotation,
            zIndex: objData.zIndex,
            flipX: objData.flipX ?? false,
            visible: objData.visible ?? true,
            alpha: objData.alpha ?? 1,
            spawned: objData.spawned ?? true,
            transformOriginX: objData.transformOriginX,
            transformOriginY: objData.transformOriginY,
            parentId: objData.parentId,
            // Text specialized fields
            fontSize: textData.fontSize ?? 72,
            fontFamily: textData.fontFamily ?? 'Noto Sans SC',
            fontWeight: textData.fontWeight ?? 'normal',
            fontStyle: textData.fontStyle ?? 'normal',
            color: textData.color ?? '#ffffff',
            align: textData.align ?? 'center',
            wordWrap: textData.wordWrap ?? true,
            wordWrapWidth: textData.wordWrapWidth ?? 400,
            content: textData.content ?? 'Text',
            // Phase 1: Visual enhancement (backward compatibility: missing fields remain undefined, render layer ?? fallback)
            stroke: textData.stroke,
            strokeThickness: textData.strokeThickness,
            dropShadow: textData.dropShadow,
            dropShadowColor: textData.dropShadowColor,
            dropShadowBlur: textData.dropShadowBlur,
            dropShadowAngle: textData.dropShadowAngle,
            dropShadowDistance: textData.dropShadowDistance,
            lineHeight: resolvedLineHeight.source === 'explicit' ? resolvedLineHeight.lineHeight : undefined,
            letterSpacing: textData.letterSpacing,
            textBoxMode: textData.textBoxMode,
            writingMode: textData.writingMode,
            // Phase 2: Animation
            revealInitialState: textData.revealInitialState ?? 'complete',
            revealSpeed: textData.revealSpeed,
            fillType: textData.fillType,
            gradientStops: textData.gradientStops,
            gradientAngle: textData.gradientAngle,
            textBackgroundEnabled: textData.textBackgroundEnabled,
            textBackgroundColor: textData.textBackgroundColor,
            textBackgroundAlpha: textData.textBackgroundAlpha,
            textBackgroundPaddingX: textData.textBackgroundPaddingX,
            textBackgroundPaddingY: textData.textBackgroundPaddingY,
            textBackgroundRadius: textData.textBackgroundRadius,
        })
    },
}

registerTypeSerializer('text', textSerializer)
