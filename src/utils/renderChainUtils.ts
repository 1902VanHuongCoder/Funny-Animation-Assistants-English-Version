/**
 * Render chain utility functions
 *
 * Decouples physical storage (objects/childIds) from rendering order (renderChain).
 * renderChain is an ordered list of IDs that determines the drawing order in PIXI.
 *
 * Core rules:
 * - union composite does not appear in renderChain; its child objects are flattened
 * - entity composite appears in renderChain, and owns its own renderChain
 * - zIndex ordering invariant: in renderChain, ∀ i<j: zIndex[chain[i]] ≤ zIndex[chain[j]]
 */

import type { CompositeObject, SceneObject } from '@/types/sceneObject'

function participatesInRenderChain(obj: SceneObject): boolean {
    return obj.type !== 'camera' && obj.type !== 'audio' && obj.type !== 'light'
}

// ==================== Build Render Chain ====================

/**
 * Automatically builds renderChain from physical storage (for initialization/migration)
 *
 * Scene root level: Collect all objects without parentId + expand union child objects
 * Entity internal: Collect entity child objects + expand union child objects
 *
 * Sorting rules: Sorted by (zIndex, original array index)
 *
 * @param objects All scene objects (flattened)
 * @param parentId Hierarchy limit: undefined=root level, entityId=inside entity
 */
export function buildRenderChain(
    objects: readonly SceneObject[],
    parentId?: string,
): string[] {
    const objectMap = new Map<string, SceneObject>()
    for (const obj of objects) {
        objectMap.set(obj.id, obj)
    }

    const result: { id: string; zIndex: number; originalIndex: number }[] = []

    // Collect renderable objects for this hierarchy (expanding union)
    collectRenderableIds(objects, objectMap, parentId, result)

    // Sort by (zIndex, originalIndex)
    result.sort((a, b) => {
        if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex
        return a.originalIndex - b.originalIndex
    })

    return result.map(r => r.id)
}

/**
 * Recursively collects renderable IDs (expands union, halts recursion when encountering entity)
 */
function collectRenderableIds(
    allObjects: readonly SceneObject[],
    objectMap: Map<string, SceneObject>,
    parentId: string | undefined,
    result: { id: string; zIndex: number; originalIndex: number }[],
): void {
    for (let i = 0; i < allObjects.length; i++) {
        const obj = allObjects[i]!
        // Filter direct objects at this hierarchy
        const objParent = obj.parentId
        if (parentId === undefined) {
            // Root level: objects without parentId, or parentId points to union (handled after recursive expansion)
            if (objParent !== undefined) continue
        } else {
            // Inside entity: parentId equals specified entityId
            if (objParent !== parentId) continue
        }

        // Skip non-screen content / editing helper objects; text is normal screen content and must participate in sorting.
        if (!participatesInRenderChain(obj)) continue

        if (obj.type === 'composite') {
            const comp = obj as CompositeObject
            if (comp.compositeMode === 'union') {
                // union: does not appear in render chain, recursively expand child objects
                expandUnionChildren(comp, objectMap, result)
                continue
            }
            // entity: appears in render chain itself (as CRT node)
        }

        result.push({ id: obj.id, zIndex: obj.zIndex, originalIndex: i })
    }
}

/**
 * Recursively expands union child objects into render chain
 */
function expandUnionChildren(
    union: CompositeObject,
    objectMap: Map<string, SceneObject>,
    result: { id: string; zIndex: number; originalIndex: number }[],
): void {
    for (const childId of union.childIds) {
        const child = objectMap.get(childId)
        if (!child) continue

        if (child.type === 'composite' && (child as CompositeObject).compositeMode === 'union') {
            // Nested union: continue recursive expansion
            expandUnionChildren(child as CompositeObject, objectMap, result)
        } else if (participatesInRenderChain(child)) {
            // Normal object or entity: add to results
            result.push({ id: child.id, zIndex: child.zIndex, originalIndex: result.length })
        }
    }
}

// ==================== Render Chain Insertion Position ====================

/**
 * Calculate correct insertion position of object in renderChain (maintaining zIndex ordering invariant)
 *
 * Inserts at the end of the matching zIndex segment.
 */
export function findInsertPosition(
    renderChain: readonly string[],
    zIndex: number,
    getObject: (id: string) => SceneObject | undefined,
): number {
    // Find the last position where zIndex <= given value
    let insertPos = renderChain.length
    for (let i = renderChain.length - 1; i >= 0; i--) {
        const obj = getObject(renderChain[i]!)
        if (obj && obj.zIndex <= zIndex) {
            insertPos = i + 1
            break
        }
        // If all objects have zIndex greater than given value, insert at the very beginning
        if (i === 0) {
            const firstObj = getObject(renderChain[0]!)
            if (firstObj && firstObj.zIndex > zIndex) {
                insertPos = 0
            }
        }
    }
    return insertPos
}

/**
 * Remove specified ID from renderChain
 */
export function removeFromRenderChain(
    renderChain: string[],
    objectId: string,
): void {
    const idx = renderChain.indexOf(objectId)
    if (idx !== -1) {
        renderChain.splice(idx, 1)
    }
}

/**
 * Batch remove specified IDs from renderChain
 */
export function removeMultipleFromRenderChain(
    renderChain: string[],
    objectIds: string[],
): void {
    const toRemove = new Set(objectIds)
    for (let i = renderChain.length - 1; i >= 0; i--) {
        if (toRemove.has(renderChain[i]!)) {
            renderChain.splice(i, 1)
        }
    }
}

// ==================== Incremental Reconciliation ====================

/**
 * Incrementally reconcile render chain (Setup copy + incremental maintenance)
 *
 * Retains still-valid IDs and their relative order from existingChain,
 * removes IDs that no longer belong to current hierarchy, and inserts new IDs by zIndex.
 *
 * Used in applyBlockActionsToState / calculateSlotStates:
 * After set_scene_structure / set_lifecycle / auto-despawn modifies members,
 * incrementally reconciles instead of fully rebuilding (which would lose user-customized ordering).
 *
 * @param existingChain Currently held render chain (inherited from setup or previous calculation)
 * @param objects All scene objects (flattened)
 * @param parentId Hierarchy limit: undefined=root level, entityId=inside entity
 */
export function reconcileRenderChain(
    existingChain: readonly string[],
    objects: readonly SceneObject[],
    parentId?: string,
): string[] {
    // Calculate set of IDs that should currently be included (same rules as buildRenderChain)
    const expectedIds = buildRenderChain(objects, parentId)
    const expectedSet = new Set(expectedIds)

    // Retain still-valid IDs in existing chain (order preserved)
    const retained = existingChain.filter(id => expectedSet.has(id))
    const retainedSet = new Set(retained)

    // New IDs = in expected but not in retained
    const result = [...retained]
    const objectMap = new Map(objects.map(o => [o.id, o]))
    for (const id of expectedIds) {
        if (!retainedSet.has(id)) {
            const obj = objectMap.get(id)
            const pos = findInsertPosition(result, obj?.zIndex ?? 0, rid => objectMap.get(rid))
            result.splice(pos, 0, id)
        }
    }

    return result
}

// ==================== Runtime zIndex Sorting ====================

/**
 * Stable-sorts renderChain by runtime zIndex
 *
 * Design rationale: renderChain is sorted by setup zIndex during scene initialization,
 * but set_visual actions can modify zIndex at runtime.
 * If initial renderChain directly overwrote sortChildren results,
 * runtime zIndex changes would not be reflected in actual rendering order.
 *
 * This function returns a new array (without modifying original renderChain),
 * objects with identical zIndex preserve their relative order in the original renderChain (stable sort).
 *
 * @param renderChain Original render chain
 * @param getZIndex Runtime zIndex query callback
 */
export function sortRenderChainByZIndex(
    renderChain: readonly string[],
    getZIndex: (id: string) => number,
): string[] {
    // Preserve original indices to achieve stable sorting
    const indexed = renderChain.map((id, i) => ({ id, zIndex: getZIndex(id), originalIndex: i }))
    indexed.sort((a, b) => {
        if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex
        return a.originalIndex - b.originalIndex
    })
    return indexed.map(item => item.id)
}
