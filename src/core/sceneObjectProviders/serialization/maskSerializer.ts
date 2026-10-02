/**
 * Mask serializer (Clip-Mask Phase 1)
 *
 * See docs/features/clip-mask.md (v2.1).
 *
 * Specialized fields:
 * - shape: 'rectangle' | 'ellipse'
 * - mode:  'inside_visible' (Phase 1 single mode; fallback + warn on invalid data)
 * - targetIds: string[] (list of clipped target IDs)
 *
 * Two-phase deserialization:
 * 1) Current deserialize: Creates object with empty targetIds, temporarily staging read targetIds in ctx.pendingMaskTargets.
 * 2) Handled by sceneObjectStore.finalizeMaskTargets() after all objects are ready, cleaning up:
 *    dead references / invalid types / mask->mask nesting / multi-mask conflicts on same target.
 */

import type { MaskMode, MaskObject, MaskShape, SceneObject } from '@/types/sceneObject'

import type { DeserializeContext, TypeSerializer } from './index'
import { registerTypeSerializer } from './index'

const ALLOWED_SHAPES: ReadonlySet<MaskShape> = new Set<MaskShape>(['rectangle', 'ellipse'])
const ALLOWED_MODES: ReadonlySet<MaskMode> = new Set<MaskMode>(['inside_visible'])

const maskSerializer: TypeSerializer = {
    serializeFields(obj: SceneObject, base: Record<string, unknown>): void {
        const mask = obj as MaskObject
        base['shape'] = mask.shape
        base['mode'] = mask.mode
        base['targetIds'] = Array.isArray(mask.targetIds) ? [...mask.targetIds] : []
    },

    deserialize(objData: SceneObject, ctx: DeserializeContext): void {
        const raw = objData as MaskObject

        // Shape: unknown value falls back to rectangle + warn
        let shape: MaskShape = 'rectangle'
        if (raw.shape && ALLOWED_SHAPES.has(raw.shape)) {
            shape = raw.shape
        } else if (raw.shape) {
            console.warn(`[mask] unknown shape '${raw.shape}' for mask ${raw.id}; fallback to 'rectangle'`)
        }

        // Mode: Phase 1 inside_visible only; fallback + warn on dirty data
        let mode: MaskMode = 'inside_visible'
        if (raw.mode && ALLOWED_MODES.has(raw.mode)) {
            mode = raw.mode
        } else if (raw.mode) {
            console.warn(`[mask] unsupported mode '${raw.mode}' for mask ${raw.id}; downgraded to 'inside_visible' (Phase 1)`)
        }

        const created = ctx.createMaskObject(
            objData.name ?? 'Mask',
            shape,
            { mode },
            objData.id,
            objData.alias ?? '',
        )

        ctx.updateObject<MaskObject>(created.id, {
            x: objData.x,
            y: objData.y,
            width: objData.width ?? 200,
            height: objData.height ?? 200,
            scaleX: objData.scaleX ?? 1,
            scaleY: objData.scaleY ?? 1,
            rotation: objData.rotation ?? 0,
            zIndex: objData.zIndex,
            flipX: objData.flipX ?? false,
            visible: objData.visible ?? true,
            alpha: objData.alpha ?? 1,
            spawned: objData.spawned ?? true,
            transformOriginX: objData.transformOriginX,
            transformOriginY: objData.transformOriginY,
            parentId: objData.parentId,
        })

        // Cache targetIds, backfilled by finalizeMaskTargets after all objects are ready
        const targets = Array.isArray(raw.targetIds)
            ? raw.targetIds.filter((t): t is string => typeof t === 'string' && t.length > 0)
            : []
        ctx.pendingMaskTargets.set(created.id, targets)
    },
}

registerTypeSerializer('mask', maskSerializer)
