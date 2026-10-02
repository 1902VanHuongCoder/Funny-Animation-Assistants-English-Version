/**
 * Composite Object Container Factory & Lifecycle Hooks
 *
 * P2: PIXI container creation + lifecycle hooks for composite objects.
 *
 * Container factory: creates a parent PIXI.Container (sortableChildren = false),
 * child containers are created and attached by renderObjects.
 *
 * Lifecycle hooks:
 * - onBeforeDelete: cascade delete or bubble child objects depending on compositeMode
 * - onAfterDuplicate: recursively duplicate child objects, updating childIds/parentId
 */

import * as PIXI from 'pixi.js'

import { registerContainerFactory, registerLifecycleHooks } from '@/core/sceneObjectProviders/index'
import type { CompositeObject, SceneObject } from '@/types/sceneObject'
import {
    decomposeMatrixForState, invertMatrix, multiplyMatrix, resolveWorldMatrix,
} from '@/utils/actionHandlers/handlers/SetParentHandler'
import type { WriteableState } from '@/utils/actionHandlers/types'

/**
 * Register composite container factory + lifecycle hooks
 *
 * @param getObjects Callback to retrieve all scene objects (injected dependency to avoid circular Store imports)
 */
export function registerCompositeContainerFactory(
    _getObjects: () => SceneObject[],
): void {
    // v2.0.0: Container factory — composite only creates an empty transform container
    // Child containers are uniformly created by renderObjects and attached to this container
    // sortableChildren = false: render order controlled manually by caller (arranged by childIds + explicit sort)
    registerContainerFactory('composite', (_obj: SceneObject): Promise<PIXI.Container | null> => {
        const container = new PIXI.Container()
        container.name = `composite_${_obj.id}`
        container.sortableChildren = false

        // v20: union containers no longer set renderable=false.
        // In old architecture, children flattened into upper container; union itself not rendered so renderable=false was set.
        // In new architecture, children are added to union container; renderable=false would block entire subtree.
        // Union container has no visual content itself (pure Container), causing no extra draw calls.
        return Promise.resolve(container)
    })

    // Lifecycle hooks (registered separately for testing and Store invocation)
    registerCompositeLifecycleHooks()
}

/**
 * Register composite lifecycle hooks separately (no PIXI dependency)
 *
 * Can be called directly in registerAll.ts to ensure Store removeObject/duplicateObject
 * properly dispatches to composite hooks in test environments.
 */
export function registerCompositeLifecycleHooks(): void {
    registerLifecycleHooks('composite', {
        /**
         * Pre-deletion handling: decides child fate based on compositeMode
         * - entity: cascades deletion to all children
         * - union: children bubble up (clears parentId, removed from childIds)
         */
        onBeforeDelete(obj, store) {
            const composite = obj as CompositeObject
            const childIds = [...(composite.childIds ?? [])]

            if (composite.compositeMode === 'union') {
                // union mode: children bubble up, restoring as independent objects
                // Uses resolveWorldMatrix to recursively calculate full coordinate transform chain (consistent with SetParentHandler)
                const bubbleTargetId = composite.parentId
                const getObjectState = (id: string): WriteableState | undefined => {
                    const o = store.getObject(id)
                    return o ? ({ ...o } as WriteableState) : undefined
                }

                for (const childId of childIds) {
                    const child = store.getObject(childId)
                    if (child) {
                        const childState = { ...child } as WriteableState
                        // Recursively compute child world matrix
                        const worldMatrix = resolveWorldMatrix(
                            childState, getObjectState
                        )

                        if (bubbleTargetId) {
                            // Has parent ancestor -> convert to parent local coordinate space
                            const parentState = getObjectState(bubbleTargetId)
                            if (parentState) {
                                const parentWorld = resolveWorldMatrix(parentState, getObjectState)
                                const localMatrix = multiplyMatrix(invertMatrix(parentWorld), worldMatrix)
                                const d = decomposeMatrixForState(localMatrix, childState)
                                store.updateObject(childId, {
                                    x: d.x, y: d.y,
                                    scaleX: Math.abs(d.scaleX), scaleY: d.scaleY,
                                    rotation: d.rotation, flipX: d.scaleX < 0,
                                    parentId: bubbleTargetId,
                                })
                            } else {
                                // Ancestor does not exist, fallback to world coordinates
                                const d = decomposeMatrixForState(worldMatrix, childState)
                                store.updateObject(childId, {
                                    x: d.x, y: d.y,
                                    scaleX: Math.abs(d.scaleX), scaleY: d.scaleY,
                                    rotation: d.rotation, flipX: d.scaleX < 0,
                                    parentId: bubbleTargetId ?? undefined,
                                })
                            }
                        } else {
                            // No parent ancestor -> use world coordinates
                            const d = decomposeMatrixForState(worldMatrix, childState)
                            store.updateObject(childId, {
                                x: d.x, y: d.y,
                                scaleX: Math.abs(d.scaleX), scaleY: d.scaleY,
                                rotation: d.rotation, flipX: d.scaleX < 0,
                                parentId: undefined,
                            })
                        }
                    }
                    // Add bubbling child to parent's childIds
                    if (bubbleTargetId) {
                        const bubbleTarget = store.getObject(bubbleTargetId)
                        if (bubbleTarget?.type === 'composite') {
                            const targetChildIds = (bubbleTarget as CompositeObject).childIds
                            if (!targetChildIds.includes(childId)) {
                                targetChildIds.push(childId)
                            }
                        }
                    }
                }
                // Clear childIds (prevent redundant processing in removeObject)
                composite.childIds = []
            } else {
                // entity mode: cascade delete all descendants (depth-first)
                // Recursively collect all descendant IDs and clear each composite's childIds first,
                // preventing bubbling behavior in nested union composites from leaving orphans
                const allDescendantIds: string[] = []
                function collectDescendants(comp: CompositeObject) {
                    for (const cid of [...(comp.childIds ?? [])]) {
                        allDescendantIds.push(cid)
                        const child = store.getObject(cid)
                        if (child?.type === 'composite') {
                            collectDescendants(child as CompositeObject)
                            ;(child as CompositeObject).childIds = []
                        }
                    }
                    comp.childIds = []
                }
                collectDescendants(composite)

                for (const descId of allDescendantIds) {
                    store.removeObject(descId)
                }
            }
        },

        /**
         * Recursive duplication: creates copy for each child, updating childIds and parentId
         */
        onAfterDuplicate(original, duplicate, store) {
            const compositeOriginal = original as CompositeObject
            const newChildIds: string[] = []

            for (const childId of compositeOriginal.childIds ?? []) {
                const childDup = store.duplicateObject(childId)
                if (childDup) {
                    // Restore position (duplicateObject default +50 offset; children should not offset)
                    const originalChild = store.getObject(childId)
                    if (originalChild) {
                        store.updateObject(childDup.id, {
                            x: originalChild.x,
                            y: originalChild.y,
                            parentId: duplicate.id,
                        })
                    }
                    newChildIds.push(childDup.id)
                }
            }

            // Directly modify duplicate childIds
            ; (duplicate as CompositeObject).childIds = newChildIds
        },
    })
}
