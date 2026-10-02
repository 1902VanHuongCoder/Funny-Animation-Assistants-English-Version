/**
 * SetLifecycle Action Handler (Added in v9.3)
 * Handles object lifecycle: spawned
 * 
 * Used to control dynamic object spawning and despawning.
 * P2: When an entity composite object's lifecycle changes, automatically cascades child object spawned state.
 * Runtime hierarchy changes are handled by scene-level set_scene_structure actions.
 */

import type { SceneObject } from '@/types/sceneObject'
import type { SetLifecycleAction } from '@/types/screenplay'
import { getChildIdsByParentId } from '@/utils/hierarchyUtils'

import type { ActionHandler, ActionHandlerContext, WriteableState } from '../types'

/**
 * Recursively cascades spawned state (entity mode):
 * Traverses all descendant objects (including nested composites) to uniformly set spawned.
 */
function cascadeSpawnedState(
    childIds: string[],
    spawned: boolean,
    getObjectState: (id: string) => WriteableState | undefined
): void {
    for (const childId of childIds) {
        const childState = getObjectState(childId)
        if (!childState) continue
        childState.spawned = spawned
        // Recursive: if child object is also a composite, continue cascading
        const grandChildIds = (childState as unknown as { childIds?: string[] }).childIds
        if (grandChildIds && grandChildIds.length > 0) {
            cascadeSpawnedState(grandChildIds, spawned, getObjectState)
        }
    }
}

function getRuntimeObjects(context: ActionHandlerContext): WriteableState[] {
    return Array.isArray(context.objects) ? context.objects : []
}

function getChildIds(
    state: WriteableState,
    context: ActionHandlerContext,
): string[] {
    const objects = getRuntimeObjects(context)
    if (objects.length > 0 && state.id) {
        const derived = getChildIdsByParentId(objects as unknown as SceneObject[], state.id)
        if (derived.length > 0) return derived
    }
    return [...((state as unknown as { childIds?: string[] }).childIds ?? [])]
}

export const SetLifecycleHandler: ActionHandler<SetLifecycleAction> = {
    type: 'set_lifecycle',
    isPointAction: true,
    isDurationAction: false,
    affectsObjectState: true,

    applyToState(state: WriteableState, action: SetLifecycleAction, context?: ActionHandlerContext): void {
        const { params } = action

        // Lifecycle property
        if (params.spawned !== undefined) {
            state.spawned = params.spawned

            // Composite child object automatic handling
            if (context?.getObjectState && state.type === 'composite') {
                const childIds = getChildIds(state, context)
                const compositeMode = (state as unknown as { compositeMode?: string }).compositeMode ?? 'entity'

                if (params.spawned) {
                    if (compositeMode === 'entity' && childIds.length > 0) {
                        cascadeSpawnedState(childIds, true, context.getObjectState)
                    }
                } else {
                    if (compositeMode === 'entity' && childIds.length > 0) {
                        cascadeSpawnedState(childIds, false, context.getObjectState)
                    }
                }
            }
        }
    }
}
