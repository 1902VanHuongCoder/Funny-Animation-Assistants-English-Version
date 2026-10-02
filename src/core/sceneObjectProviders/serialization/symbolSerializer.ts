/**
 * Symbol serializer
 *
 * Handles SymbolObject subtype-specialized fields: materials / currentMaterialId.
 */

import type { SceneObject, SymbolObject } from '@/types/sceneObject'

import type { DeserializeContext, TypeSerializer } from './index'
import { registerTypeSerializer } from './index'

const symbolSerializer: TypeSerializer = {
    serializeFields(obj: SceneObject, base: Record<string, unknown>): void {
        const sym = obj as SymbolObject
        // v16: serialize materials directly (_runtimeUrl already removed from types, no need to strip manually)
        base['materials'] = sym.materials.map(m => ({
            ...m,
            // Ensure deep copy of frames (avoid shared references)
            ...(m.frames ? { frames: m.frames.map(f => ({ ...f })) } : {}),
        }))
        if (sym.currentMaterialId !== undefined) {
            base['currentMaterialId'] = sym.currentMaterialId
        }
        // v16: animations/initialAnimations handled uniformly in toSetupObject base
    },

    deserialize(objData: SceneObject, ctx: DeserializeContext): void {
        const symData = objData as SymbolObject
        const symbolObj = ctx.createSymbolObject(
            objData.alias ?? objData.name ?? 'Symbol',
            objData.id,
            objData.alias ?? '',
        )
        ctx.updateObject(symbolObj.id, {
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
            materials: symData.materials ?? [],
            currentMaterialId: symData.currentMaterialId,
        } as Partial<SymbolObject>)
    },
}

registerTypeSerializer('symbol', symbolSerializer)
