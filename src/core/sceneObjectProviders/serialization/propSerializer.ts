/**
 * Prop serializer
 *
 * Extracted from sceneObjectStore.toSetupObject / fromSetupObject prop case.
 */

import { usePropStore } from '@/stores/propStore'
import type { SceneObject } from '@/types/sceneObject'

import type { DeserializeContext, TypeSerializer } from './index'
import { registerTypeSerializer } from './index'

const propSerializer: TypeSerializer = {
    serializeFields(_obj: SceneObject, _base: Record<string, unknown>): void {
        // v16: animations/initialAnimations handled uniformly in toSetupObject base
    },

    deserialize(objData: SceneObject, ctx: DeserializeContext): void {
        const propStore = usePropStore()
        const propAsset = propStore.getProp(objData.refId)
        const propName = propAsset?.name ?? 'Unknown'

        const propObj = ctx.createPropObject(
            objData.refId,
            propName,
            objData.id,
            objData.alias ?? '',
        )

        const propUpdates: import('@/types/sceneObject').SceneObjectUpdateFor = {
            x: objData.x,
            y: objData.y,
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
        }
        if (objData.width !== undefined) propUpdates.width = objData.width
        if (objData.height !== undefined) propUpdates.height = objData.height
        ctx.updateObject(propObj.id, propUpdates)
    },
}

registerTypeSerializer('prop', propSerializer)
