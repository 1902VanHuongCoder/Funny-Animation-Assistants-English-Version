/**
 * Expression serializer
 *
 * Handles subtype-specialized fields of ExpressionObject.
 * refId of ExpressionObject is serialized uniformly by base class toSetupObject;
 * this serializer only needs to handle deserialization creation logic.
 */

import type { ExpressionObject, SceneObject } from '@/types/sceneObject'

import type { DeserializeContext, TypeSerializer } from './index'
import { registerTypeSerializer } from './index'

const expressionSerializer: TypeSerializer = {
    serializeFields(obj: SceneObject, base: Record<string, unknown>): void {
        const expr = obj as ExpressionObject
        if (expr.defaultRefId) {
            base['defaultRefId'] = expr.defaultRefId
        }
    },

    deserialize(objData: SceneObject, ctx: DeserializeContext): void {
        const exprObj = ctx.createExpressionObject(
            objData.refId ?? '',
            objData.alias ?? objData.name ?? 'Expression',
            objData.id,
            objData.alias ?? '',
        )
        // Legacy data compatibility: fallback to refId when defaultRefId is missing
        const rawData = objData as ExpressionObject
        const defaultRefId = rawData.defaultRefId ?? objData.refId ?? ''
        ctx.updateObject(exprObj.id, {
            x: objData.x,
            y: objData.y,
            width: objData.width ?? 200,
            height: objData.height ?? 200,
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
            defaultRefId,
        } as Partial<ExpressionObject>)
    },
}

registerTypeSerializer('expression', expressionSerializer)
