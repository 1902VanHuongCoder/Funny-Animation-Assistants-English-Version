/**
 * AnimationSceneObjectStore - Isolated store dedicated to animation editing
 *
 * Implements SceneObjectProvider interface, deep-clones target object and its children from global sceneObjectStore,
 * providing a completely independent data layer. All transforms during animation editing are written to this store without affecting global state.
 *
 * Usage:
 *   const animStore = createAnimationSceneObjectStore(objectIds, globalStore)
 *   const renderer = useSceneRenderer({ canvasContainer, storeOverride: animStore })
 */

import { computed, reactive, ref } from 'vue'

import type { CompositeObject, SceneObject, SceneObjectUpdateFor } from '@/types/sceneObject'
import type { SceneObjectProvider } from '@/types/SceneObjectProvider'
import { buildRenderChain } from '@/utils/renderChainUtils'

export interface AnimationSceneObjectStoreOptions {
  /** Root object ID to include (composite automatically collects all descendants) */
  rootObjectId: string
  /** Global store reference (read only once for deep cloning) */
  globalStore: {
    objects: SceneObject[]
    getObject(id: string): SceneObject | undefined
    getSceneRenderChain(): string[]
  }
  /** Prebuilt object list (resource-level preview, bypassing copy from globalStore) */
  prebuiltObjects?: SceneObject[]
  /** Scene-level renderChain corresponding to prebuiltObjects; falls back to object list order if omitted */
  prebuiltRenderChain?: string[]
}

export interface AnimationSceneObjectRuntimeStore extends SceneObjectProvider {
  replaceObjects(objects: SceneObject[], renderChain?: string[]): void
  cloneObjects(): SceneObject[]
}

/**
 * Create an isolated animation editing store instance.
 * Returned object is reactive and can be passed directly as SceneObjectProvider into useSceneRenderer.
 */
export function createAnimationSceneObjectStore(
  options: AnimationSceneObjectStoreOptions
): AnimationSceneObjectRuntimeStore {
  const { rootObjectId, globalStore } = options

  let clonedObjects: SceneObject[]
  let clonedRenderChain: string[]

  if (options.prebuiltObjects) {
    // Resource-level preview: directly use prebuilt objects
    clonedObjects = options.prebuiltObjects
    clonedRenderChain = options.prebuiltRenderChain
      ? [...options.prebuiltRenderChain]
      : options.prebuiltObjects.map(o => o.id)
  } else {
    // Scene-level entry: deep-clone from global store
    const idsToClone = new Set<string>()
    collectObjectAndDescendants(rootObjectId, globalStore, idsToClone)

    clonedObjects = []
    for (const id of idsToClone) {
      const obj = globalStore.getObject(id)
      if (obj) {
        clonedObjects.push(JSON.parse(JSON.stringify(obj)) as SceneObject)
      }
    }

    const globalRenderChain = globalStore.getSceneRenderChain()
    clonedRenderChain = globalRenderChain.filter(id => idsToClone.has(id))
    // When rootObjectId is a composite child (not in scene-level renderChain),
    // the above filter strips the whole subtree causing empty render chain and blank canvas; fallback is needed.
    if (clonedRenderChain.length === 0) {
      // Crucial: let rootObjectId take the "main canvas working path" - sortCompositeContainers
      // only installs installRenderChainRenderer for composite with compositeMode === 'entity',
      // and only installed composites have their leaves explicitly dispatched by renderByRenderChain.
      // If root is union, union neither enters scene chain nor installs custom render,
      // relying on PIXI default Container.render recursion - which misses expression object rendering.
      //
      // Solution: "virtually promote" root union to entity in isolated store,
      // and construct a renderChain for it.
      //
      // Crucial: renderChain order must match main canvas!
      // In main canvas, head union's 3 children (expression + symB + symC) appear
      // within a contiguous slice of root entity's 14-leaf renderChain, already ordered correctly by Z.
      // If using buildRenderChain(clonedObjects, rootObjectId) directly, it would re-sort by zIndex,
      // potentially causing expression to be hidden behind opaque symbols (face/hair).
      // The correct approach is to slice from global chain while preserving original order.
      const rootObj = clonedObjects.find(o => o.id === rootObjectId)
      if (rootObj?.type === 'composite'
        && (rootObj as CompositeObject).compositeMode === 'union') {
        const rootComp = rootObj as CompositeObject
        const preservedChain = sliceGlobalRenderChainForSubtree(
          rootObjectId,
          idsToClone,
          globalStore,
        )
        rootComp.compositeMode = 'entity'
        rootComp.renderChain = preservedChain.length > 0
          ? preservedChain
          : buildRenderChain(clonedObjects, rootObjectId)
      }
      clonedRenderChain = [rootObjectId]
    }
  }

  // ---- Reactive state ----
  const objectsRef = ref<SceneObject[]>(clonedObjects)
  const selectedObjectId = ref<string | null>(null)

  const objects = computed(() => objectsRef.value)

  // ---- Methods ----

  function getObject(id: string): SceneObject | undefined {
    return objectsRef.value.find(o => o.id === id)
  }

  function isDescendantOf(objectId: string, ancestorId: string): boolean {
    let current = getObject(objectId)
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true
      current = getObject(current.parentId)
    }
    return false
  }

  function getSortedObjects(): SceneObject[] {
    // Order by appearance in renderChain
    const orderMap = new Map<string, number>()
    // First process scene-level renderChain
    clonedRenderChain.forEach((id, i) => orderMap.set(id, i))
    // Then process composite internal renderChain
    for (const obj of objectsRef.value) {
      if (obj.type === 'composite') {
        const comp = obj as CompositeObject
        const chain = comp.renderChain ?? comp.childIds ?? []
        chain.forEach((id, i) => {
          if (!orderMap.has(id)) {
            orderMap.set(id, 1000 + i)
          }
        })
      }
    }

    return [...objectsRef.value].sort((a, b) => {
      const oa = orderMap.get(a.id) ?? 9999
      const ob = orderMap.get(b.id) ?? 9999
      return oa - ob
    })
  }

  function getSceneRenderChain(): string[] {
    return clonedRenderChain
  }

  function cloneObjects(): SceneObject[] {
    return JSON.parse(JSON.stringify(objectsRef.value)) as SceneObject[]
  }

  function replaceObjects(objects: SceneObject[], renderChain?: string[]): void {
    const selected = selectedObjectId.value
    objectsRef.value = JSON.parse(JSON.stringify(objects)) as SceneObject[]
    if (renderChain) {
      clonedRenderChain = [...renderChain]
    }
    if (selected && !objectsRef.value.some(obj => obj.id === selected)) {
      selectedObjectId.value = null
    } else if (selected) {
      selectObject(selected)
    }
  }

  function selectObject(id: string | null): void {
    for (const obj of objectsRef.value) {
      if (obj.type !== 'composite') continue
      const comp = obj as CompositeObject
      if (comp.compositeLocked) continue
      if (id === comp.id) continue
      if (id && isDescendantOf(id, comp.id)) continue
      updateObject(comp.id, { compositeLocked: true } as SceneObjectUpdateFor<CompositeObject>)
    }
    selectedObjectId.value = id
  }

  function updateObject<T extends SceneObject = SceneObject>(
    id: string,
    updates: SceneObjectUpdateFor<T>,
  ): void {
    const idx = objectsRef.value.findIndex(o => o.id === id)
    if (idx < 0) return

    const obj = objectsRef.value[idx]!
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        delete (obj as Record<string, unknown>)[key]
      } else {
        ;(obj as Record<string, unknown>)[key] = value
      }
    }
  }

  function updateSetupObject<T extends SceneObject = SceneObject>(
    id: string,
    updates: SceneObjectUpdateFor<T>,
  ): void {
    // In isolated store, setupObject and object are equivalent
    updateObject(id, updates)
  }

  // ---- Construct reactive object to ensure Vue watch tracking ----
  const store: AnimationSceneObjectRuntimeStore = reactive({
    objects,
    selectedObjectId,
    getObject,
    getSortedObjects,
    getSceneRenderChain,
    replaceObjects,
    cloneObjects,
    selectObject,
    updateObject,
    updateSetupObject,
  }) as AnimationSceneObjectRuntimeStore

  return store
}

/**
 * Recursively collect object ID and all its composite descendants
 */
function collectObjectAndDescendants(
  objectId: string,
  globalStore: { getObject(id: string): SceneObject | undefined },
  collected: Set<string>,
): void {
  if (collected.has(objectId)) return
  collected.add(objectId)

  const obj = globalStore.getObject(objectId)
  if (!obj) return

  if (obj.type === 'composite') {
    const comp = obj as CompositeObject
    const childIds = comp.childIds ?? []
    for (const childId of childIds) {
      collectObjectAndDescendants(childId, globalStore, collected)
    }
  }
}

/**
 * Slice leaves under rootObjectId subtree from global renderChain, preserving original order.
 *
 * Motivation: When rootObjectId is union (doesn't have its own renderChain), its renderable descendants' Z order
 * is recorded in the nearest ancestor entity's renderChain (union leaves are unrolled into ancestor chain).
 * Animation editing panel must maintain coverage consistent with main canvas, using this order rather than re-sorting by zIndex.
 *
 * Search strategy: Walk up to first ancestor entity with non-empty renderChain; if not found,
 * fall back to scene-level renderChain (for top-level entities).
 *
 * @returns Leaf IDs belonging to idsToClone and within rootObjectId subtree, preserving original order.
 */
function sliceGlobalRenderChainForSubtree(
  rootObjectId: string,
  idsToClone: Set<string>,
  globalStore: {
    getObject(id: string): SceneObject | undefined
    getSceneRenderChain(): string[]
  },
): string[] {
  // 1. Walk up to find first ancestor entity with non-empty renderChain
  let chainSource: readonly string[] | null = null
  let cursor = globalStore.getObject(rootObjectId)?.parentId
  while (cursor) {
    const anc = globalStore.getObject(cursor)
    if (!anc) break
    if (anc.type === 'composite') {
      const ac = anc as CompositeObject
      if (ac.compositeMode === 'entity' && ac.renderChain && ac.renderChain.length > 0) {
        chainSource = ac.renderChain
        break
      }
    }
    cursor = anc.parentId
  }
  // Fallback: scene-level renderChain
    chainSource ??= globalStore.getSceneRenderChain()

  // 2. Filter and keep: IDs in idsToClone, not rootObjectId itself, and verified subtree members
  return chainSource.filter(id =>
    idsToClone.has(id) && id !== rootObjectId,
  )
}
