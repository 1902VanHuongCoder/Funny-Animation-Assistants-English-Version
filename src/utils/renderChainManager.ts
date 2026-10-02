/**
 * RenderChain Manager — Uniformly manages scene render chain and entity render chains
 *
 * v19 refactor: Centralizes renderChain logic previously scattered across
 * addObject / removeObject / dissolveComposite into this module, following OOP encapsulation principles.
 *
 * Three owner renderChain requirements:
 * - Scene (sceneRenderChain): Root-level object ID list, union expanded, entity as single node
 * - Entity composite (renderChain): All renderable object IDs under entity (union expanded and flattened)
 * - Union composite: No owned renderChain — child objects pass through to parent entity or sceneRenderChain
 */

import type { CompositeObject, SceneObject } from '@/types/sceneObject'
import { findInsertPosition, removeFromRenderChain } from '@/utils/renderChainUtils'

function participatesInRenderChain(object: SceneObject): boolean {
  return object.type !== 'camera' && object.type !== 'audio' && object.type !== 'light'
}

// ==================== Type Definitions ====================

/**
 * Minimal Store dependency required by RenderChainManager
 * Injected via interface to avoid circular references
 */
export interface RenderChainStoreAccessor {
  getObject(id: string): SceneObject | undefined
  getSceneRenderChain(): string[]
}

// ==================== Core Operations ====================

/**
 * Automatically maintains the corresponding renderChain after an object is added.
 *
 * Rules:
 * 1. Entity composite → Initialize empty renderChain (construction guarantee)
 * 2. Union composite → Do not join any renderChain
 * 3. Child object → Penetrate union along parentId chain, append to nearest entity's renderChain
 * 4. Root-level object (no parentId) → Append to sceneRenderChain (inserted by zIndex)
 */
export function onObjectAdded(
    object: SceneObject,
    store: RenderChainStoreAccessor,
): void {
  // Rule 1: Entity composite construction guarantee — initialize empty renderChain
  if (object.type === 'composite' && (object as CompositeObject).compositeMode === 'entity') {
    if (!(object as CompositeObject).renderChain) {
      (object as CompositeObject).renderChain = []
    }
  }

  // Rule 2: Union composite does not join any renderChain (pass-through container)
  const isUnion = object.type === 'composite' && (object as CompositeObject).compositeMode === 'union'

  // Rule 3: Child object appended to belonging entity's renderChain (penetrating union chain)
  if (object.parentId && !isUnion && participatesInRenderChain(object)) {
    let currentParentId: string | undefined = object.parentId
    while (currentParentId) {
      const parent = store.getObject(currentParentId)
      if (parent?.type !== 'composite') break
      const parentComp = parent as CompositeObject
      if (parentComp.compositeMode === 'entity') {
        if (parentComp.renderChain && !parentComp.renderChain.includes(object.id)) {
          parentComp.renderChain.push(object.id)
        }
        break
      }
      // union → continue ascending the chain
      currentParentId = parentComp.parentId
    }
  }

  // Rule 4: Root-level object appended to sceneRenderChain
  if (!object.parentId && !isUnion) {
    if (participatesInRenderChain(object)) {
      const chain = store.getSceneRenderChain()
      const pos = findInsertPosition(chain, object.zIndex, store.getObject.bind(store))
      chain.splice(pos, 0, object.id)
    }
  }
}

/**
 * Automatically cleans up from belonging renderChain after an object is removed.
 *
 * Handles both:
 * - Removal from parent entity's renderChain
 * - Removal from sceneRenderChain
 */
export function onObjectRemoved(
    objectId: string,
    object: SceneObject,
    store: RenderChainStoreAccessor,
): void {
  // Remove from parent entity's renderChain
  if (object.parentId) {
    const parent = store.getObject(object.parentId)
    if (parent?.type === 'composite') {
      const compositeParent = parent as CompositeObject
      if (compositeParent.compositeMode === 'entity' && compositeParent.renderChain) {
        removeFromRenderChain(compositeParent.renderChain, objectId)
      }
    }
  }

  // Remove from sceneRenderChain
  removeFromRenderChain(store.getSceneRenderChain(), objectId)
}

/**
 * When composite is dissolved, transfer its render order to the target renderChain.
 *
 * Effect: The position of the entity in the target chain is "in-place replaced" by the ordered expansion of its child objects.
 * (The entity's own ID is removed during subsequent removeObject)
 *
 * @param compositeId ID of the dissolved composite
 * @param preservedRenderOrder Preserved render order (ordered ID list after expanding union)
 * @param bubbleTargetId Target where child objects bubble up to: undefined = root level, string = parent composite ID
 */
export function onCompositeDissolve(
    compositeId: string,
    preservedRenderOrder: string[],
    bubbleTargetId: string | undefined,
    store: RenderChainStoreAccessor,
): void {
  if (preservedRenderOrder.length === 0) return

  if (!bubbleTargetId) {
    // Bubble to root level → insert into sceneRenderChain
    const chain = store.getSceneRenderChain()
    const entityPos = chain.indexOf(compositeId)
    if (entityPos !== -1) {
      chain.splice(entityPos + 1, 0, ...preservedRenderOrder)
    } else {
      chain.push(...preservedRenderOrder)
    }
  } else {
    // Bubble to parent entity → insert into parent entity's renderChain
    const parentObj = store.getObject(bubbleTargetId)
    if (parentObj?.type === 'composite') {
      const parentComp = parentObj as CompositeObject
      if (parentComp.compositeMode === 'entity' && parentComp.renderChain) {
        const entityPos = parentComp.renderChain.indexOf(compositeId)
        if (entityPos !== -1) {
          parentComp.renderChain.splice(entityPos + 1, 0, ...preservedRenderOrder)
        } else {
          parentComp.renderChain.push(...preservedRenderOrder)
        }
      }
    }
  }
}

/**
 * Recursively expands union child objects in childIds (building render order fallback)
 * union does not appear in the result, its child objects are flattened
 */
export function expandChildIdsForRenderOrder(
    childIds: readonly string[],
    store: RenderChainStoreAccessor,
): string[] {
  const result: string[] = []
  for (const id of childIds) {
    const child = store.getObject(id)
    if (!child) continue
    if (child.type === 'composite' && (child as CompositeObject).compositeMode === 'union') {
      result.push(...expandChildIdsForRenderOrder((child as CompositeObject).childIds, store))
    } else {
      result.push(id)
    }
  }
  return result
}
