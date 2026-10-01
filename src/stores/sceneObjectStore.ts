// P1: Trigger all serializer registrations
import '@/core/sceneObjectProviders/serialization/registerAll'

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { CAMERA_BASE_HEIGHT, CAMERA_BASE_WIDTH, CANVAS_CENTER_X, CANVAS_CENTER_Y } from '@/constants/canvas'
import { Z_INDEX_BACKGROUND, Z_INDEX_CAMERA, Z_INDEX_DEFAULT, Z_INDEX_LIGHT, Z_INDEX_SCREEN_EFFECT, Z_INDEX_TEXT } from '@/constants/zIndex'
import { getLifecycleHooks } from '@/core/sceneObjectProviders/index'
import type { DeserializeContext } from '@/core/sceneObjectProviders/serialization/index'
import { getTypeSerializer } from '@/core/sceneObjectProviders/serialization/index'
import { useAnimationStore } from '@/stores/animationStore'
// Scene object types
import type {
  AudioObject,
  BackgroundObject,
  CameraObject,
  CompositeObject,
  ExpressionObject,
  LightObject,
  PropObject,
  SceneObject,
  SceneObjectBase,
  SceneObjectType,
  SceneObjectUpdateFor,
  ScreenEffectObject,
  ScreenEffectParams,
  SymbolObject,
  TextObject
} from '@/types/sceneObject'
import type { RuntimeSceneSnapshot,SceneSetup } from '@/types/screenplay'
import { createRuntimeSnapshot } from '@/types/screenplay'
import { globalToLocal, localToGlobal } from '@/utils/compositeTransform'
import { debugLog, isDebugEnabled } from '@/utils/debugLogger'
import type { RenderChainStoreAccessor } from '@/utils/renderChainManager'
import { expandChildIdsForRenderOrder as rcExpandChildIds,onCompositeDissolve as rcOnCompositeDissolve, onObjectAdded as rcOnObjectAdded, onObjectRemoved as rcOnObjectRemoved } from '@/utils/renderChainManager'
import { buildRenderChain, findInsertPosition, reconcileRenderChain, removeMultipleFromRenderChain, sortRenderChainByZIndex } from '@/utils/renderChainUtils'
import { generateId } from '@/utils/uuid'



export type {
  AudioObject,
  BackgroundObject,
  CameraObject,
  CompositeObject,
  ExpressionObject,
  PropObject,
  SceneObject,
  SceneObjectBase,
  SceneObjectType,
  ScreenEffectObject,
  ScreenEffectParams,
  SymbolObject,
  TextObject
}


export const useSceneObjectStore = defineStore('sceneObject', () => {
  // ==================== Aggregate Data Architecture ====================
  // setupState: Persistence layer - Reactive wrapper for SceneSetup
  //   - Setup Mode: Direct user editing modifications
  //   - Action Mode: Modified only via addSetupObject/removeSetupObject/updateSetupObject
  //   - Serialization: toSetupObject always reads from here
  const setupState = ref<SceneSetup>({
    camera: { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y, width: CAMERA_BASE_WIDTH, height: CAMERA_BASE_HEIGHT, zoom: 1 },
    objects: [],
    renderChain: [],
  })

  // runtimeState: Runtime layer - RuntimeSceneSnapshot under Action Mode
  //   - Setup Mode: null (unused)
  //   - Action Mode: Created by createRuntimeSnapshot upon entry, overwritten by applySlotState
  //   - Discarded upon exit
  const runtimeState = ref<RuntimeSceneSnapshot | null>(null)

  // v16: Lazily retrieve animationStore
  function getAnimationStore() {
    return useAnimationStore()
  }

  /**
   * Scene object array of current active layer (read-only proxy)
   * ⚠️ Setup Mode → setupState.objects | Action Mode → runtimeState.objects
   */
  const objects = computed(() => isActionMode.value ? runtimeState.value!.objects : setupState.value.objects)

  /**
   * Scene render chain of current active layer (read-only proxy)
   */
  const sceneRenderChain = computed(() => isActionMode.value ? runtimeState.value!.renderChain : setupState.value.renderChain)

  const selectedObjectId = ref<string | null>(null)

  // Mode flag
  const isActionMode = ref(false)

  // ==================== v17: Namespace Alias Management ====================

  /**
   * Find namespace root ID for object
   * - Walk up parentId chain, returning entity ID when encountering ancestor with compositeMode === 'entity'
   * - Reaching root (no parent or through union only) -> returns null (scene namespace)
   */
  function resolveNamespaceRoot(objectId: string): string | null {
    let currentId: string | undefined = objects.value.find(o => o.id === objectId)?.parentId
    while (currentId) {
      const parent = objects.value.find(o => o.id === currentId)
      if (!parent) break
      if (parent.type === 'composite') {
        const comp = parent as CompositeObject
        if (comp.compositeMode === 'entity') {
          return comp.id
        }
      }
      currentId = parent.parentId
    }
    return null
  }

  /**
   * Collect aliases of all objects within specified namespace
   * - namespaceRootId === null -> Scene namespace (root objects + union penetration)
   * - namespaceRootId === entityId -> Entity child objects + union penetration
   * - union composite is transparent; its child object aliases belong to parent namespace
   * - entity composite's own alias belongs to parent namespace; internal children do not
   */
  function getNamespaceAliases(namespaceRootId: string | null, excludeObjectId?: string): string[] {
    const aliases: string[] = []

    // Determine seed object list
    let seedObjects: SceneObject[]
    if (namespaceRootId === null) {
      // Scene namespace: all root objects
      seedObjects = objects.value.filter(o => !o.parentId)
    } else {
      // entity namespace: direct child objects of this entity
      const entity = objects.value.find(o => o.id === namespaceRootId) as CompositeObject | undefined
      if (!entity) return aliases
      seedObjects = entity.childIds
        .map(id => objects.value.find(o => o.id === id))
        .filter((o): o is SceneObject => o !== undefined)
    }

    // Recursive collection: penetrate union, stop at entity
    function collectAliases(objs: SceneObject[]) {
      for (const obj of objs) {
        if (obj.type === 'camera') continue
        if (obj.id === excludeObjectId) continue
        if (obj.alias) aliases.push(obj.alias)

        // union composite: penetrate and recursively collect children
        if (obj.type === 'composite') {
          const comp = obj as CompositeObject
          if (comp.compositeMode === 'union') {
            const children = comp.childIds
              .map(id => objects.value.find(o => o.id === id))
              .filter((o): o is SceneObject => o !== undefined)
            collectAliases(children)
          }
          // entity composite: own alias already collected, internal children not collected (isolation boundary)
        }
      }
    }

    collectAliases(seedObjects)
    return aliases
  }

  /**
   * Get alias list of all objects in specified namespace (excluding camera)
   * @param namespaceRootId Namespace root ID, null = scene namespace (default)
   */
  function getExistingAliases(namespaceRootId?: string | null): string[] {
    return getNamespaceAliases(namespaceRootId ?? null)
  }

  /**
   * Check whether alias already exists in specified namespace
   */
  function isAliasExists(alias: string, excludeObjectId?: string, namespaceRootId?: string | null): boolean {
    const aliases = getNamespaceAliases(namespaceRootId ?? null, excludeObjectId)
    return aliases.includes(alias)
  }

  /**
   * Generate unique alias in specified namespace
   * Rule: first without number, second is "xxx1", third is "xxx2"...
   * @param namespaceRootId Namespace root ID, null = scene namespace (default)
   */
  function generateUniqueAlias(baseName: string, namespaceRootId?: string | null, excludeObjectId?: string): string {
    const existingAliases = getNamespaceAliases(namespaceRootId ?? null, excludeObjectId)

    if (!existingAliases.includes(baseName)) {
      return baseName
    }

    let counter = 1
    while (existingAliases.includes(`${baseName}${counter}`)) {
      counter++
    }
    return `${baseName}${counter}`
  }

  function addObject(object: SceneObject) {
    // Setup Mode: write to persistence layer; Action Mode: write to display layer
    if (isActionMode.value) {
      runtimeState.value!.objects.push(object)
    } else {
      setupState.value.objects.push(object)
    }

    // v19 Refactor: Unified renderChain management (Setup and Action share same path)
    rcOnObjectAdded(object, rcStoreAccessor)
  }

  // Get default layer
  function getDefaultZIndex(): number {
    return Z_INDEX_DEFAULT
  }

  /**
   * v21: Automatically add frame animations with origin='auto' to initialAnimations
   *
   * Called only on object creation to ensure frame animation plays by default.
   * Objects with existing initialAnimations are unmodified (respecting user settings).
   */
  function autoPopulateInitialAnimations(obj: SceneObject): void {
    // Only handle prop and background
    if (obj.type !== 'prop' && obj.type !== 'background') return
    // If initialAnimations already exist, do not overwrite
    if (obj.initialAnimations && obj.initialAnimations.length > 0) return

    const animations = obj.animations
    if (!animations) return

    const autoFrameAnims = Object.values(animations).filter(
      a => a.origin === 'auto' && a.type === 'track' && a.tracks.some(t => t.trackType === 'frame_sequence')
    )

    if (autoFrameAnims.length > 0) {
      obj.initialAnimations = autoFrameAnims.map(a => ({
        name: a.name,
        loop: a.loop ?? true,
      }))
      // v24: Write back via updateSetupObject to ensure episode sync (ScenePlayer preview reads from episode)
      const storeObj = getObject(obj.id)
      if (storeObj) {
        updateSetupObject(obj.id, { initialAnimations: [...obj.initialAnimations] } as Partial<SceneObject>)
      }
    }
  }

  // createCharacterObject has been removed

  // Create background object
  // v7.1: Added alias and customId parameters
  function createBackgroundObject(
    backgroundId: string,
    name: string,
    customId?: string,
    customAlias?: string
  ): BackgroundObject {
    // Background defaults to center; actual coordinates update during render based on image dimensions
    const defaultWidth = 0
    const defaultHeight = 0

    // v7.1: Generate unique alias
    const alias = customAlias ?? generateUniqueAlias(name)

    const obj: BackgroundObject = {
      id: customId ?? generateId('sceneobject'), // v7.36: Uniformly use sceneobject prefix
      type: 'background',
      name,
      alias,  // v7.1: Added alias
      // PT Phase 6: backgroundId removed, uniformly use refId
      refId: backgroundId,
      x: CANVAS_CENTER_X,  // v2.0.0: Unified center coordinates (updated on render based on texture size)
      y: CANVAS_CENTER_Y,
      width: defaultWidth,  // Default width, updated during render based on actual image
      height: defaultHeight, // Default height, updated during render based on actual image
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      flipX: false,
      zIndex: Z_INDEX_BACKGROUND,
      visible: true
    }
    addObject(obj)
    // v16: Automatically generate frame animation Animation upon object creation
    getAnimationStore().hydrateObjectAnimations(obj)
    return obj
  }

  // Create audio object
  function createAudioObject(
    soundId: string,
    name: string,
    options: {
      volume?: number,
      loop?: boolean,
      fadeIn?: number,
      fadeOut?: number,
      playbackState?: 'play' | 'stop'
    } = {},
    customId?: string,
    customAlias?: string
  ): AudioObject {
    // Generate unique alias
    const alias = customAlias ?? generateUniqueAlias(name)

    const obj: AudioObject = {
      id: customId ?? generateId('sceneobject'), // v7.36: Uniformly use sceneobject prefix
      type: 'audio',
      name,
      alias,
      refId: soundId,
      volume: options.volume ?? 1.0,
      loop: options.loop ?? false,
      fadeIn: options.fadeIn ?? 0,
      fadeOut: options.fadeOut ?? 0,
      playbackState: options.playbackState ?? 'stop', // Defaults to stopped, manual start required
      x: 0,   // Audio object is not displayed on canvas
      y: 0,
      width: 0,
      height: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      flipX: false,
      zIndex: 0,
      visible: true,
      spawned: true
    }
    addObject(obj)
    return obj
  }

  // Create prop object
  // v7.1: Added alias and customId parameters
  // v7.1.1: Fix HMR issue
  function createPropObject(
    propId: string,
    name: string,
    customId?: string,
    customAlias?: string
  ): PropObject {
    const width = 200 // Default dimension, updated during render
    const height = 200

    // Defaults to canvas center
    const centerX = CANVAS_CENTER_X
    const centerY = CANVAS_CENTER_Y

    // v7.1: Generate unique alias
    const alias = customAlias ?? generateUniqueAlias(name)

    const obj: PropObject = {
      id: customId ?? generateId('sceneobject'), // v7.36: Uniformly use sceneobject prefix
      type: 'prop',
      name,
      alias,
      // PT Phase 6: propId removed, uniformly use refId
      refId: propId,
      x: centerX,  // v2.0.0: Unified center coordinates
      y: centerY,
      width,
      height,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      flipX: false,
      zIndex: getDefaultZIndex(),
      visible: true
    }
    addObject(obj)
    // v16: Automatically generate frame animation Animation upon object creation
    getAnimationStore().hydrateObjectAnimations(obj)
    // Write back hydrate result via Store API to ensure Vue reactivity tracking
    if (obj.animations && Object.keys(obj.animations).length > 0) {
      updateObject(obj.id, { animations: { ...obj.animations } })
    }
    return getObject(obj.id) as PropObject
  }

  // v7.3: createEffectObject removed, effects merged into props
  // To add effects, use createPropObject function

  // Phase 1: Create screen effect object
  function createScreenEffectObject(
    effectClass: string,
    name: string,
    params: ScreenEffectParams = {},
    customId?: string,
    customAlias?: string
  ): ScreenEffectObject {
    const alias = customAlias ?? generateUniqueAlias(name)

    // Default size is 110% of camera viewport to ensure full coverage with margin
    const defaultWidth = Math.round(CAMERA_BASE_WIDTH * 1.1)
    const defaultHeight = Math.round(CAMERA_BASE_HEIGHT * 1.1)

    const obj: ScreenEffectObject = {
      id: customId ?? generateId('sceneobject'),
      type: 'screen_effect',
      name,
      refId: effectClass,
      alias,
      effectClass,
      params: {
        baseColor: params.baseColor ?? '#000000',
        // coverOpacity removed, coverage opacity controlled by alpha
        openRatio: params.openRatio ?? 1.0,
        feather: params.feather ?? 0,
        ...params
      },
      x: CANVAS_CENTER_X,
      y: CANVAS_CENTER_Y,
      width: defaultWidth,
      height: defaultHeight,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      flipX: false,
      zIndex: Z_INDEX_SCREEN_EFFECT,
      visible: true
    }
    addObject(obj)
    return obj
  }

  // v16: Create symbol object
  function createSymbolObject(
    name: string,
    customId?: string,
    customAlias?: string
  ): SymbolObject {
    const alias = customAlias ?? generateUniqueAlias(name)

    const obj: SymbolObject = {
      id: customId ?? generateId('sceneobject'),
      type: 'symbol',
      name,
      alias,
      refId: '',
      materials: [],
      x: CANVAS_CENTER_X,
      y: CANVAS_CENTER_Y,
      width: 200,
      height: 200,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      flipX: false,
      zIndex: getDefaultZIndex(),
      visible: true
    }
    addObject(obj)
    // v16: Automatically generate frame animation Animation upon object creation
    getAnimationStore().hydrateObjectAnimations(obj)
    // Write back hydrate result via Store API to ensure Vue reactivity tracking
    if (obj.animations && Object.keys(obj.animations).length > 0) {
      updateObject(obj.id, { animations: { ...obj.animations } })
    }
    return getObject(obj.id) as SymbolObject
  }

  // v18: Create standalone expression object
  function createExpressionObject(
    expressionId: string,
    name: string,
    customId?: string,
    customAlias?: string
  ): ExpressionObject {
    const alias = customAlias ?? generateUniqueAlias(name)

    const obj: ExpressionObject = {
      id: customId ?? generateId('sceneobject'),
      type: 'expression',
      name,
      alias,
      refId: expressionId,
      defaultRefId: expressionId,
      x: CANVAS_CENTER_X,
      y: CANVAS_CENTER_Y,
      width: 200,
      height: 200,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      flipX: false,
      zIndex: getDefaultZIndex(),
      visible: true
    }
    addObject(obj)
    // Automatically generate frame animation Animation upon object creation
    getAnimationStore().hydrateObjectAnimations(obj)
    if (obj.animations && Object.keys(obj.animations).length > 0) {
      updateObject(obj.id, { animations: { ...obj.animations } })
    }
    return getObject(obj.id) as ExpressionObject
  }

  // Clip-Mask Phase 1: Create mask object.
  // See docs/features/clip-mask.md (v2.1).
  // targetIds intentionally omitted from options: UI path defaults to empty array; deserialization path backfilled via finalize step in maskSerializer,
  // avoiding bypassing exclusive validation on creation.
  function createMaskObject(
    name: string,
    shape: import('@/types/sceneObject').MaskShape,
    options?: {
      width?: number
      height?: number
      mode?: import('@/types/sceneObject').MaskMode
    },
    customId?: string,
    customAlias?: string,
  ): import('@/types/sceneObject').MaskObject {
    const alias = customAlias ?? generateUniqueAlias(name)
    const obj: import('@/types/sceneObject').MaskObject = {
      id: customId ?? generateId('sceneobject'),
      type: 'mask',
      name,
      alias,
      refId: '',
      shape,
      mode: options?.mode ?? 'inside_visible',
      targetIds: [],
      x: CANVAS_CENTER_X,
      y: CANVAS_CENTER_Y,
      width: options?.width ?? 200,
      height: options?.height ?? 200,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      flipX: false,
      zIndex: getDefaultZIndex(),
      visible: true,
    }
    addObject(obj)
    return getObject(obj.id) as import('@/types/sceneObject').MaskObject
  }

  // Clip-Mask Phase 1: Staged targetIds during deserialization (key = mask id).
  // Written by maskSerializer.deserialize; backfilled by finalizeMaskTargets() after all objects are ready, arbitrating exclusive conflicts, then cleared.
  const _pendingMaskTargets = new Map<string, string[]>()

  /**
   * Clip-Mask Phase 1: Backfill mask.targetIds after deserialization and clean stale data.
   *
   * Invocation timing: in sceneLoader.ts after `for (objData) fromSetupObject(...)` loop,
   * called once before `rebuildEntityRenderChains()`.
   *
   * Clean rules (processed in stable ascending order of mask in setupState.objects, giving priority to smaller indices):
   * - Dead reference: id in targetIds does not exist in scene -> silently remove
   * - Invalid target type: !isAllowedMaskTargetType(target.type) -> silently remove
   * - Nesting: target itself is 'mask' -> silently remove
   * - Same target multi-mask conflict: first come first served (ascending array index), latter removed + 1 aggregated warning
   * - mode !== 'inside_visible': keep read object field intact (default inside_visible from createMaskObject,
   *   legacy dirty data downgraded to inside_visible and warned via maskSerializer in deserialize phase)
   */
  function finalizeMaskTargets(): void {
    if (_pendingMaskTargets.size === 0) return

    const claimedTargets = new Set<string>() // Already claimed target IDs
    let droppedCount = 0
    const droppedReasons: string[] = []

    // Process masks in ascending index order in setupState.objects, ensuring lower initial index wins
    const masksInOrder = setupState.value.objects
      .map((o, idx) => ({ obj: o, idx }))
      .filter(({ obj }) => obj.type === 'mask' && _pendingMaskTargets.has(obj.id))
      .sort((a, b) => a.idx - b.idx)

    for (const { obj } of masksInOrder) {
      const mask = obj as import('@/types/sceneObject').MaskObject
      const raw = _pendingMaskTargets.get(mask.id) ?? []
      const accepted: string[] = []
      for (const id of raw) {
        const tgt = setupState.value.objects.find(o => o.id === id)
        if (!tgt) {
          droppedCount++
          droppedReasons.push(`${mask.id}→${id}: dead reference`)
          continue
        }
        if (tgt.type === 'mask') {
          droppedCount++
          droppedReasons.push(`${mask.id}→${id}: mask→mask nesting (Phase 1.5)`)
          continue
        }
        // Safer to import module directly; inline common types check to avoid circular dependencies
        const allowed = tgt.type === 'prop' || tgt.type === 'text' || tgt.type === 'symbol'
          || tgt.type === 'expression' || tgt.type === 'composite' || tgt.type === 'background'
        if (!allowed) {
          droppedCount++
          droppedReasons.push(`${mask.id}→${id}: disallowed target type '${tgt.type}'`)
          continue
        }
        if (claimedTargets.has(id)) {
          droppedCount++
          droppedReasons.push(`${mask.id}→${id}: already claimed by earlier mask`)
          continue
        }
        accepted.push(id)
        claimedTargets.add(id)
      }
      mask.targetIds = accepted
    }

    _pendingMaskTargets.clear()

    if (droppedCount > 0) {
      console.warn(`[mask] cleaned ${droppedCount} stale targetIds reference(s) during deserialize`, droppedReasons)
    }
  }

  // Create camera object
  function createCameraObject(name: string, canvasCenter?: { x: number, y: number }, zoom?: number, customId?: string): CameraObject {
    const width = CAMERA_BASE_WIDTH
    const height = CAMERA_BASE_HEIGHT

    // Camera uses center coordinates
    const centerX = canvasCenter?.x ?? CANVAS_CENTER_X
    const centerY = canvasCenter?.y ?? CANVAS_CENTER_Y

    const obj: CameraObject = {
      id: customId ?? generateId('sceneobject'), // v7.36: Uniformly use sceneobject prefix
      type: 'camera',
      name,
      refId: '',
      x: centerX,  // Camera stores center coordinates
      y: centerY,  // Camera stores center coordinates
      width,   // PRD spec: default camera width
      height,   // PRD spec: default camera height
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      flipX: false,
      zIndex: Z_INDEX_CAMERA,
      visible: true,
      zoom: zoom ?? 1.0  // Default zoom = 1.0
    }
    addObject(obj)
    return obj
  }

  // Create light object (ambient or point)
  function createLightObject(
    lightType: 'ambient' | 'point' | 'spot',
    name: string,
    options?: {
      lightColor?: string
      lightIntensity?: number
      lightRadius?: number
      flicker?: number
      flickerSpeed?: number
      directionMode?: 'omni' | 'cone'
      directionAngle?: number
      coneAngle?: number
      x?: number
      y?: number
    },
    customId?: string,
    customAlias?: string
  ): LightObject {
    const alias = customAlias ?? generateUniqueAlias(name)

    const obj: LightObject = {
      id: customId ?? generateId('sceneobject'),
      type: 'light',
      name,
      alias,
      refId: '',
      lightType,
      lightColor: options?.lightColor ?? '#ffffff',
      lightIntensity: options?.lightIntensity ?? 1.0,
      lightRadius: options?.lightRadius ?? 500,
      flicker: options?.flicker ?? 0,
      flickerSpeed: options?.flickerSpeed ?? 0.35,
      directionMode: options?.directionMode ?? (lightType === 'spot' ? 'cone' : 'omni'),
      directionAngle: options?.directionAngle ?? 0,
      coneAngle: options?.coneAngle ?? 100,
      x: options?.x ?? CANVAS_CENTER_X,
      y: options?.y ?? CANVAS_CENTER_Y,
      width: 96,
      height: 96,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      flipX: false,
      zIndex: Z_INDEX_LIGHT,
      visible: true,
    }
    addObject(obj)
    return obj
  }

  // Create text object
  // v7.1: Added alias and customId parameters
  function createTextObject(
    content: string,
    canvasCenter?: { x: number, y: number },
    customId?: string,
    customAlias?: string
  ): TextObject {
    const width = 400
    const height = 100

    // v2.0.0: Uniformly use center coordinates
    const centerX = canvasCenter?.x ?? CANVAS_CENTER_X
    const centerY = canvasCenter?.y ?? CANVAS_CENTER_Y

    // v7.1: Generate unique alias
    const alias = customAlias ?? generateUniqueAlias('Text')

    const obj: TextObject = {
      id: customId ?? generateId('sceneobject'), // v7.36: Uniformly use sceneobject prefix
      type: 'text',
      name: 'Text',
      refId: '',
      alias,  // v7.1: Added alias
      content,
      fontSize: 72,
      fontFamily: 'Noto Sans SC',
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: '#ffffff',
      align: 'center',
      wordWrap: false,
      wordWrapWidth: 400,
      textBoxMode: 'auto-size',
      revealInitialState: 'complete',
      x: centerX,  // v2.0.0: Unified center coordinates
      y: centerY,
      width,   // Default width
      height,  // Default height
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      flipX: false,
      zIndex: Z_INDEX_TEXT,
      visible: true
    }
    addObject(obj)
    return obj
  }

  // P2: Create composite object
  function createCompositeObject(
    name: string,
    childIds: string[] = [],
    customId?: string,
    customAlias?: string,
    compositeMode: 'entity' | 'union' = 'union',
    namespaceRootId?: string | null
  ): CompositeObject {
    const alias = customAlias ?? generateUniqueAlias(name, namespaceRootId)

    const obj: CompositeObject = {
      id: customId ?? generateId('sceneobject'),
      type: 'composite',
      name,
      alias,
      refId: '',
      childIds: [...childIds],
      compositeLocked: true,
      compositeMode,
      x: CANVAS_CENTER_X,
      y: CANVAS_CENTER_Y,
      width: 0,
      height: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      flipX: false,
      zIndex: getDefaultZIndex(),
      visible: true
    }

    addObject(obj)

    // Set child object parentId
    for (const childId of childIds) {
      updateObject(childId, { parentId: obj.id })
    }

    // After addObject Vue wraps obj as reactive proxy; return getObject to get actual reference in array
    return getObject(obj.id) as CompositeObject
  }

  /**
   * Get object from current active layer
   * Setup Mode -> reads setupObjects | Action Mode -> reads runtimeObjects
   */
  function getObject(id: string): SceneObject | undefined {
    return objects.value.find(obj => obj.id === id)
  }

  /**
   * Update object properties in current active layer
   * Setup Mode -> writes setupObjects (persistence layer) | Action Mode -> writes runtimeObjects (display layer, does not affect persistence)
   *
   * Properties with undefined value in updates will be removed from object (clearing optional properties)
   */
  function updateObject<T extends SceneObject = SceneObject>(id: string, updates: SceneObjectUpdateFor<T>) {
    const targetArray = isActionMode.value ? runtimeState.value!.objects : setupState.value.objects
    // Mask geometry diagnostics are opt-in via localStorage.
    const updatesRec = updates as Record<string, unknown>
    const obj = targetArray.find(o => o.id === id)
    const touchesMaskField = 'targetIds' in updatesRec || 'shape' in updatesRec
    if (isDebugEnabled('mask') && (obj?.type === 'mask' || touchesMaskField)) {
      debugLog('mask', '[MASK-DEBUG] sceneObjectStore.updateObject\n' + JSON.stringify({
        id,
        targetType: obj?.type,
        mode: isActionMode.value ? 'action' : 'setup',
        updates: JSON.parse(JSON.stringify(updates)) as unknown,
        before: obj?.type === 'mask' ? {
          targetIds: (obj as unknown as { targetIds?: unknown }).targetIds,
          shape: (obj as unknown as { shape?: unknown }).shape,
          width: obj.width,
          height: obj.height,
          x: obj.x,
          y: obj.y,
          scaleX: obj.scaleX,
          scaleY: obj.scaleY,
          rotation: obj.rotation,
          transformOriginX: obj.transformOriginX,
          transformOriginY: obj.transformOriginY,
        } : null,
      }, null, 2))
    }
    applyUpdatesToArray(targetArray, id, updates)
  }

  /** Internal helper: Apply updates to object with specified id in target array */
  function applyUpdatesToArray<T extends SceneObject = SceneObject>(
    arr: SceneObject[], id: string, updates: SceneObjectUpdateFor<T>
  ) {
    const index = arr.findIndex(obj => obj.id === id)
    if (index !== -1) {
      const merged = { ...arr[index], ...updates }
      const updatesRecord = updates as Record<string, unknown>
      for (const key of Object.keys(updates)) {
        if (updatesRecord[key] === undefined) {
          delete (merged as Record<string, unknown>)[key]
        }
      }

      arr[index] = merged as SceneObject
    }
  }

  /** Detach child object from composite: local -> global (preserving visual appearance) */
  function resolveWorldTransform(obj: SceneObject): {
    x: number
    y: number
    scaleX: number
    scaleY: number
    rotation: number
    flipX?: boolean
  } {
    if (!obj.parentId) {
      return {
        x: obj.x,
        y: obj.y,
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
        rotation: obj.rotation,
        flipX: obj.flipX,
      }
    }

    const parent = getObject(obj.parentId)
    if (!parent) {
      return {
        x: obj.x,
        y: obj.y,
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
        rotation: obj.rotation,
        flipX: obj.flipX,
      }
    }

    const parentWorld = resolveWorldTransform(parent)
    return localToGlobal(obj, parentWorld)
  }

  function detachChild(childId: string, comp: CompositeObject): void {
    const child = getObject(childId)
    if (!child) return

    // v2.0.0 Solution A: Complete transform compensation (position + scale + rotation)
    // v19.2: localToGlobal returns flipX to restore global flip state
    const compWorld = resolveWorldTransform(comp)
    const global = localToGlobal(child, compWorld)
    const newParentId = comp.parentId ?? undefined
    const nextTransform = newParentId
      ? (() => {
          const newParent = getObject(newParentId)
          if (!newParent) return global
          return globalToLocal(global, resolveWorldTransform(newParent))
        })()
      : global

    updateObject(childId, {
      x: nextTransform.x,
      y: nextTransform.y,
      scaleX: nextTransform.scaleX,
      scaleY: nextTransform.scaleY,
      rotation: nextTransform.rotation,
      flipX: nextTransform.flipX ?? child.flipX,
      parentId: newParentId,  // Bubble up to parent; no parent = standalone
    })
  }

  /** Attach child object to composite: global -> local (preserving visual appearance) */
  function attachChild(childId: string, comp: CompositeObject): void {
    const child = getObject(childId)
    if (!child) return

    // v2.0.0 Solution A: Complete transform compensation (position + scale + rotation)
    // v19.2: globalToLocal returns flipX; child flips to counteract when parent.flipX=true
    const childWorld = resolveWorldTransform(child)
    const compWorld = resolveWorldTransform(comp)
    const local = globalToLocal(childWorld, compWorld)
    updateObject(childId, {
      parentId: comp.id,
      x: local.x,
      y: local.y,
      scaleX: local.scaleX,
      scaleY: local.scaleY,
      rotation: local.rotation,
      flipX: local.flipX ?? child.flipX,
    })
  }

  // Store operation adapter for lifecycle hooks
  const storeAccessor: import('@/core/sceneObjectProviders/index').LifecycleStoreAccessor = {
    getObject,
    removeObject: (id: string) => removeObject(id),
    updateObject,
    duplicateObject: (id: string) => duplicateObject(id),
  }

  // Lifecycle accessor dedicated to persistence layer (setupState) in Action Mode.
  // Prevents removeSetupObject onBeforeDelete from erroneously cleaning parent-child relations in runtimeState.
  const setupStoreAccessor: import('@/core/sceneObjectProviders/index').LifecycleStoreAccessor = {
    getObject: (id: string) => setupState.value.objects.find(o => o.id === id),
    removeObject: (id: string) => {
      const setupObj = setupState.value.objects.find(o => o.id === id)
      if (!setupObj) return

      const hooks = getLifecycleHooks(setupObj.type)
      hooks?.onBeforeDelete?.(setupObj, setupStoreAccessor)

      if (setupObj.parentId) {
        const parent = setupState.value.objects.find(o => o.id === setupObj.parentId)
        if (parent?.type === 'composite') {
          const compositeParent = parent as CompositeObject
          const idx = compositeParent.childIds.indexOf(id)
          if (idx !== -1) compositeParent.childIds.splice(idx, 1)
        }
      }

      rcOnObjectRemoved(id, setupObj, rcSetupAccessor)

      const index = setupState.value.objects.findIndex(o => o.id === id)
      if (index !== -1) {
        setupState.value.objects.splice(index, 1)
      }
    },
    updateObject: <T extends SceneObject = SceneObject>(id: string, updates: SceneObjectUpdateFor<T>) => {
      applyUpdatesToArray(setupState.value.objects, id, updates)
    },
    duplicateObject: () => {
      throw new Error('[sceneObjectStore] setupStoreAccessor.duplicateObject is not supported')
    },
  }

  // v19: Store adapter for RenderChainManager
  const rcStoreAccessor: RenderChainStoreAccessor = {
    getObject,
    getSceneRenderChain: () => sceneRenderChain.value,
  }

  // v19: RenderChain adapter dedicated to directly manipulating persistence layer (setupState) in Action Mode
  // Bypasses sceneRenderChain computed (which points to runtimeState under isActionMode),
  // ensuring addSetupObject / removeSetupObject correctly writes to setupState.renderChain
  const rcSetupAccessor: RenderChainStoreAccessor = {
    getObject: (id) => setupState.value.objects.find(o => o.id === id),
    getSceneRenderChain: () => setupState.value.renderChain,
  }

  // Delete object (type-specific behavior via lifecycle hooks)
  // Setup Mode: Delete from setupObjects
  // Action Mode: Delete from runtimeObjects (persistence layer handled separately via removeSetupObject)
  function removeObject(id: string) {
    const obj = getObject(id)
    if (!obj) return

    // Lifecycle hook: type-specific pre-deletion handling (e.g. composite cascading child deletion)
    const hooks = getLifecycleHooks(obj.type)
    hooks?.onBeforeDelete?.(obj, storeAccessor)

    // Remove self from parent object's childIds
    if (obj.parentId) {
      const parent = getObject(obj.parentId)
      if (parent?.type === 'composite') {
        const compositeParent = parent as CompositeObject
        const idx = compositeParent.childIds.indexOf(id)
        if (idx !== -1) compositeParent.childIds.splice(idx, 1)
      }
    }

    // Clip-Mask Phase 1: Clear id reference from targetIds of all mask objects
    // - If deleted object is a target: all referencing mask.targetIds must purge this id
    // - If deleted object is mask itself: does not affect other masks (no-op)
    if (obj.type !== 'mask') {
      const targetArrayForCleanup = isActionMode.value ? runtimeState.value!.objects : setupState.value.objects
      for (const o of targetArrayForCleanup) {
        if (o.type !== 'mask') continue
        const mask = o as import('@/types/sceneObject').MaskObject
        const idx = mask.targetIds.indexOf(id)
        if (idx !== -1) mask.targetIds.splice(idx, 1)
      }
    }

    // v19 Refactor: Unified renderChain management
    rcOnObjectRemoved(id, obj, rcStoreAccessor)

    const targetArray = isActionMode.value ? runtimeState.value!.objects : setupState.value.objects
    const index = targetArray.findIndex(o => o.id === id)
    if (index !== -1) {
      targetArray.splice(index, 1)
      if (selectedObjectId.value === id) {
        selectedObjectId.value = null
      }
    }
  }

  /** Recursively collect all descendant IDs of composite object (depth-first) */
  function collectAllDescendantIds(compositeId: string): string[] {
    const result: string[] = []
    const obj = getObject(compositeId)
    if (obj?.type !== 'composite') return result
    const comp = obj as CompositeObject
    for (const childId of comp.childIds) {
      result.push(childId)
      result.push(...collectAllDescendantIds(childId))
    }
    return result
  }

  /** Check whether objectId is descendant of ancestorId (walking up parentId chain) */
  function isDescendantOf(objectId: string, ancestorId: string): boolean {
    let current = getObject(objectId)
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true
      current = getObject(current.parentId)
    }
    return false
  }

  /** Force cascade deletion of composite and all its descendants (regardless of compositeMode) */
  function removeObjectWithDescendants(id: string): void {
    const obj = getObject(id)
    if (!obj) return

    if (obj.type === 'composite') {
      const comp = obj as CompositeObject
      const allDescendantIds = collectAllDescendantIds(id)
      // Clear childIds of all composites to prevent onBeforeDelete from bubbling
      comp.childIds = []
      for (const descId of allDescendantIds) {
        const descObj = getObject(descId)
        if (descObj?.type === 'composite') {
          (descObj as CompositeObject).childIds = []
        }
      }
      // Delete descendants one by one (childIds cleared, will not trigger cascade or bubble)
      for (const descId of allDescendantIds) {
        removeObject(descId)
      }
    }
    // Finally delete self
    removeObject(id)
  }

  /**
   * Dissolve composite: child objects bubble up to parent, coordinate compensation, clear childIds.
   * Does not delete composite itself (caller needs to invoke removeObject subsequently).
   * Used for "delete group only" three-option deletion - shared by entity and union.
   */
  function dissolveComposite(compositeId: string): void {
    const obj = getObject(compositeId)
    if (obj?.type !== 'composite') return
    const comp = obj as CompositeObject
    const childIds = [...comp.childIds]
    const bubbleTargetId = comp.parentId

    // v19: Save entity render order before dissolving (ordered ID list after unrolling union children)
    // This order will be transferred to target renderChain later, replacing entity's position in chain
    let preservedRenderOrder: string[] = []
    if (comp.compositeMode === 'entity') {
      if (comp.renderChain && comp.renderChain.length > 0) {
        preservedRenderOrder = [...comp.renderChain]
      } else {
        // fallback: Unroll union children from childIds (via Manager)
        preservedRenderOrder = rcExpandChildIds(comp.childIds, rcStoreAccessor)
      }
    }

    for (const childId of childIds) {
      const child = getObject(childId)
      if (!child) continue
      // Coordinate compensation: local coordinates -> global coordinates
      // v19.2: localToGlobal returns flipX, restoring global flip state upon dissolution
      const global = localToGlobal(child, comp)
      updateObject(childId, {
        x: global.x,
        y: global.y,
        scaleX: global.scaleX,
        scaleY: global.scaleY,
        rotation: global.rotation,
        flipX: global.flipX ?? child.flipX,
        parentId: bubbleTargetId ?? undefined,
      })
      // Add to parent composite's childIds
      if (bubbleTargetId) {
        const parent = getObject(bubbleTargetId)
        if (parent?.type === 'composite') {
          const parentComp = parent as CompositeObject
          if (!parentComp.childIds.includes(childId)) {
            parentComp.childIds.push(childId)
          }
        }
      }
    }

    // v19 Refactor: Transfer render order via Manager
    if (preservedRenderOrder.length > 0) {
      rcOnCompositeDissolve(compositeId, preservedRenderOrder, bubbleTargetId, rcStoreAccessor)
    }

    // Clear childIds - subsequent removeObject onBeforeDelete will not process children
    comp.childIds = []
  }

  // Select object
  function selectObject(id: string | null) {
    // Auto-relock: Restore locked state of all unlocked composites when non-descendant object is selected
    for (const obj of objects.value) {
      if (obj.type !== 'composite') continue
      const comp = obj as CompositeObject
      if (comp.compositeLocked) continue // Already locked
      // Newly selected object is composite itself or its descendant -> keep unlocked
      if (id === comp.id) continue
      if (id && isDescendantOf(id, comp.id)) continue
      // Restore locked state
      if (isActionMode.value) {
        updateSetupObject(comp.id, { compositeLocked: true } as Partial<SceneObject>)
      } else {
        updateObject(comp.id, { compositeLocked: true } as Partial<SceneObject>)
      }
    }
    selectedObjectId.value = id
  }

  // Get selected object
  function getSelectedObject(): SceneObject | undefined {
    return selectedObjectId.value ? getObject(selectedObjectId.value) : undefined
  }

  /**
   * Fix render chain references after copying composite:
   * - Copying adds children to root level before backfilling parentId, which may leave orphan child IDs in root chain
   * - entity composite's renderChain must map oldId -> newId to new subtree, preserving custom order
   * - union has no own renderChain, relying on reconciliation with parent entity or scene root chain
   */
  function reconcileRenderChainsAfterCompositeDuplicate(originalRoot: SceneObject, rootDuplicate: SceneObject): void {
    const visited = new Set<string>()
    const oldToNewId = new Map<string, string>()
    const duplicatedEntityPairs: { originalId: string; duplicateId: string }[] = []

    const canDuplicate = (obj: SceneObject | undefined): obj is SceneObject => {
      if (!obj) return false
      if (obj.type === 'camera') return false
      if (obj.type === 'light' && (obj as LightObject).lightType === 'ambient') return false
      return true
    }

    const mapDuplicateTree = (originalObj: SceneObject | undefined, duplicateObj: SceneObject | undefined): void => {
      if (!canDuplicate(originalObj) || !duplicateObj) return
      if (visited.has(originalObj.id)) return
      visited.add(originalObj.id)
      oldToNewId.set(originalObj.id, duplicateObj.id)

      if (originalObj.type !== 'composite' || duplicateObj.type !== 'composite') return

      const originalComp = originalObj as CompositeObject
      const duplicateComp = duplicateObj as CompositeObject
      if (originalComp.compositeMode === 'entity' && duplicateComp.compositeMode === 'entity') {
        duplicatedEntityPairs.push({ originalId: originalObj.id, duplicateId: duplicateObj.id })
      }

      let duplicateChildIndex = 0
      for (const originalChildId of originalComp.childIds ?? []) {
        const originalChild = getObject(originalChildId)
        if (!canDuplicate(originalChild)) continue

        const duplicateChildId = duplicateComp.childIds?.[duplicateChildIndex]
        duplicateChildIndex++
        if (!duplicateChildId) continue

        mapDuplicateTree(originalChild, getObject(duplicateChildId))
      }
    }

    mapDuplicateTree(originalRoot, rootDuplicate)

    // First map internal renderChain of entities in newly copied subtree, preserving user custom order.
    for (const pair of duplicatedEntityPairs) {
      const originalObj = getObject(pair.originalId)
      const duplicateObj = getObject(pair.duplicateId)
      if (originalObj?.type !== 'composite' || duplicateObj?.type !== 'composite') continue

      const originalComp = originalObj as CompositeObject
      const duplicateComp = duplicateObj as CompositeObject
      const mappedChain = (originalComp.renderChain ?? [])
        .map(id => oldToNewId.get(id))
        .filter((id): id is string => Boolean(id))

      duplicateComp.renderChain = mappedChain.length > 0
        ? reconcileRenderChain(mappedChain, objects.value, duplicateComp.id)
        : buildRenderChain(objects.value, duplicateComp.id)
    }

    // Then reconcile root chain of current layer, cleaning residual root child IDs reparented to parent
    const reconciled = reconcileRenderChain(sceneRenderChain.value ?? [], objects.value)
    if (isActionMode.value) {
      runtimeState.value!.renderChain = reconciled
    } else {
      setupState.value.renderChain = reconciled
    }
  }

  // Copy object
  // v7.1: Generate new alias when copying (original alias + number)
  function duplicateObject(id: string): SceneObject | undefined {
    const original = getObject(id)
    if (!original) return undefined

    // Camera and ambient light cannot be copied
    if (original.type === 'camera') {
      return undefined
    }
    if (original.type === 'light' && (original as LightObject).lightType === 'ambient') {
      return undefined
    }

    // v7.1: Generate new alias (original alias + number)
    const originalAlias = original.alias ?? original.name
    const newAlias = generateUniqueAlias(originalAlias)

    // Clones default to top-level objects - remove parentId
    const { parentId: _parentId, ...rest } = original
    const duplicate: SceneObject = {
      ...rest,
      id: generateId('sceneobject'),
      name: `${original.name} Copy`,
      alias: newAlias,
      x: original.x + 50,
      y: original.y + 50,
    }

    addObject(duplicate)

    // Lifecycle hook: type-specific post-copy handling (e.g. composite recursively copying children)
    const hooks = getLifecycleHooks(original.type)
    hooks?.onAfterDuplicate?.(original, duplicate, storeAccessor)

    if (duplicate.type === 'composite') {
      reconcileRenderChainsAfterCompositeDuplicate(original, duplicate)
    }

    return duplicate
  }

  // v19: Object list sorted by renderChain order (root level)
  function getSortedObjects(): SceneObject[] {
    // v19: If renderChain exists, order root-level objects by renderChain order
    // Note: Must return all objects (including children) as render loop traverses them
    if (sceneRenderChain.value.length > 0) {
      const chainIds = sceneRenderChain.value
      const inChain = new Set(chainIds)
      const result: SceneObject[] = []
      // First order on-chain objects by renderChain order
      for (const id of chainIds) {
        const obj = objects.value.find(o => o.id === id)
        if (obj) result.push(obj)
      }
      // Append off-chain objects (children, camera, text, etc.)
      for (const obj of objects.value) {
        if (!inChain.has(obj.id)) {
          result.push(obj)
        }
      }
      return result
    }
    // fallback: sort by zIndex
    return [...objects.value].sort((a, b) => a.zIndex - b.zIndex)
  }

  // P2: Query child objects of composite
  // v19: entity returns in renderChain order (if present), otherwise falls back to childIds
  function getChildObjects(compositeId: string): SceneObject[] {
    const composite = getObject(compositeId)
    if (composite?.type !== 'composite') return []
    const comp = composite as CompositeObject
    // entity mode with renderChain: order by renderChain
    if (comp.compositeMode === 'entity' && comp.renderChain && comp.renderChain.length > 0) {
      return comp.renderChain
        .map(id => objects.value.find(o => o.id === id))
        .filter((o): o is SceneObject => o !== undefined)
    }
    // fallback: childIds order
    return comp.childIds
      .map(id => objects.value.find(o => o.id === id))
      .filter((o): o is SceneObject => o !== undefined)
  }

  // P2: Reorder child objects in renderChain (allowed within same zIndex only)
  // v19: Manipulate entity's renderChain or scene's sceneRenderChain
  function reorderChild(compositeId: string, fromIndex: number, toIndex: number): void {
    const composite = getObject(compositeId)
    if (composite?.type !== 'composite') return
    const comp = composite as CompositeObject
    // v19: Manipulate renderChain
    const chain = comp.compositeMode === 'entity' ? comp.renderChain : undefined
    if (!chain) return
    if (fromIndex < 0 || fromIndex >= chain.length) return
    if (toIndex < 0 || toIndex >= chain.length) return
    if (fromIndex === toIndex) return
    // zIndex check: prohibit dragging across zIndex
    const fromObj = getObject(chain[fromIndex]!)
    const toObj = getObject(chain[toIndex]!)
    if (fromObj && toObj && fromObj.zIndex !== toObj.zIndex) return
    const [moved] = chain.splice(fromIndex, 1)
    if (moved !== undefined) chain.splice(toIndex, 0, moved)
  }

  // v19: Adjust order of scene root-level renderChain
  function reorderSceneRenderChain(fromIndex: number, toIndex: number): void {
    const chain = sceneRenderChain.value
    if (fromIndex < 0 || fromIndex >= chain.length) return
    if (toIndex < 0 || toIndex >= chain.length) return
    if (fromIndex === toIndex) return
    // zIndex validation
    const fromObj = getObject(chain[fromIndex]!)
    const toObj = getObject(chain[toIndex]!)
    if (fromObj && toObj && fromObj.zIndex !== toObj.zIndex) return
    const [moved] = chain.splice(fromIndex, 1)
    if (moved !== undefined) chain.splice(toIndex, 0, moved)
  }

  /**
   * v19: Collect renderable IDs from a set of object IDs (recursively unrolling union children)
   * Used during groupObjects to determine which IDs to remove from parent render chain
   */
  function collectRenderableChildIds(objectIds: string[]): string[] {
    const result: string[] = []
    for (const id of objectIds) {
      const obj = getObject(id)
      if (!obj) continue
      if (obj.type === 'composite' && (obj as CompositeObject).compositeMode === 'union') {
        // union: not present in render chain, recursively unroll children
        result.push(...collectRenderableChildIds((obj as CompositeObject).childIds))
      } else if (obj.type !== 'camera' && obj.type !== 'audio' && obj.type !== 'light') {
        result.push(id)
      }
    }
    return result
  }

  // P2: Query top-level objects (filtering out children with parentId)
  function getRootObjects(): SceneObject[] {
    return objects.value.filter(obj => !obj.parentId)
  }

  // P2: Group multiple objects into a composite
  // Supports sibling grouping: all objects must share same parentId (including undefined for root)
  function groupObjects(
    objectIds: string[],
    mode: 'entity' | 'union' = 'union'
  ): CompositeObject {
    // Calculate bounding box center of all objects to group as composite position
    const targetObjs = objectIds
      .map(id => getObject(id))
      .filter((o): o is SceneObject => o !== undefined)

    if (targetObjs.length === 0) {
      throw new Error('[groupObjects] No objects found to group')
    }

    // Validate that all objects share the same parentId
    const sharedParentId = targetObjs[0]!.parentId
    for (const obj of targetObjs) {
      if (obj.parentId !== sharedParentId) {
        throw new Error('[groupObjects] All objects to be grouped must share the same parentId (siblings)')
      }
    }

    let sumX = 0, sumY = 0
    for (const obj of targetObjs) {
      sumX += obj.x
      sumY += obj.y
    }
    const centerX = sumX / targetObjs.length
    const centerY = sumY / targetObjs.length

    // Sibling grouping: first remove these children from old parent's childIds
    if (sharedParentId) {
      const oldParent = getObject(sharedParentId)
      if (oldParent?.type === 'composite') {
        const oldComp = oldParent as CompositeObject
        for (const objId of objectIds) {
          const idx = oldComp.childIds.indexOf(objId)
          if (idx !== -1) oldComp.childIds.splice(idx, 1)
        }
      }
    }

    // Resolve namespace: ensure alias is unique in correct entity namespace
    const namespaceRoot = resolveNamespaceRoot(objectIds[0]!)
    // Create composite (omit childIds, set manually later for coordinate compensation)
    const composite = createCompositeObject('Group', [], undefined, undefined, mode, namespaceRoot)

    // Set composite position to members center
    updateObject(composite.id, {
      x: centerX,
      y: centerY,
    } as Partial<SceneObject>)

    // Sibling grouping: new composite inherits shared parentId
    if (sharedParentId) {
      updateObject(composite.id, { parentId: sharedParentId } as Partial<SceneObject>)
      // Add new composite to old parent's childIds
      const oldParent = getObject(sharedParentId)
      if (oldParent?.type === 'composite') {
        (oldParent as CompositeObject).childIds.push(composite.id)
      }
    }

    // Note: updateObject uses spread to create new object; composite becomes stale reference.
    // Re-fetch to set childIds before attachChild (needs comp coordinates).
    const updatedComposite = getObject(composite.id) as CompositeObject
    updatedComposite.childIds = objectIds.slice()

    // Add objects to composite: convert coordinates to local + set parentId
    for (const obj of targetObjs) {
      attachChild(obj.id, updatedComposite)
    }

    // v19: Render chain synchronization
    if (!isActionMode.value) {
      if (mode === 'union') {
        // union: renderChain completely unchanged (children maintain position)
        // union composite itself should not be in renderChain (excluded in addObject)
        // entity's renderChain was initialized in addObject; no extra operation needed
      } else {
        // entity：
        // 1. Collect renderable IDs of children in current renderChain (unrolling nested unions)
        const childRenderableIds = collectRenderableChildIds(objectIds)
        // 2. Find position of last child object in renderChain
        const targetChain = sharedParentId
          ? (getObject(sharedParentId) as CompositeObject | undefined)?.renderChain
          : sceneRenderChain.value
        if (targetChain) {
          let lastPos = -1
          for (const cid of childRenderableIds) {
            const pos = targetChain.indexOf(cid)
            if (pos > lastPos) lastPos = pos
          }
          // 3. Remove children from parent renderChain
          removeMultipleFromRenderChain(targetChain, childRenderableIds)
          // Fix: When new entity composite created (no parentId), rcOnObjectAdded Rule 4
          // appended it to end of sceneRenderChain. Must remove from sceneRenderChain before inserting at correct position,
          // otherwise duplicate entries occur:
          //   - Nested scenario (sharedParentId non-empty): composite exists in both sceneRenderChain and
          //     parent entity renderChain; contentRoot renders container separately again after character,
          //     always overlaying on the topmost layer.
          //   - Root grouping (sharedParentId empty): targetChain === sceneRenderChain.value,
          //     splice below inserts a second copy, causing container to be rendered twice in same frame.
          removeMultipleFromRenderChain(sceneRenderChain.value, [composite.id])
          // 4. Insert entity node into original position of last child object
          const insertPos = lastPos !== -1 ? Math.min(lastPos, targetChain.length) : targetChain.length
          targetChain.splice(insertPos, 0, composite.id)
        }
        // 5. entity zIndex takes maximum value among children
        const maxZ = targetObjs.reduce((max, o) => Math.max(max, o.zIndex), targetObjs[0]!.zIndex)
        updateObject(composite.id, { zIndex: maxZ } as Partial<SceneObject>)
        // 6. Initialize entity's internal renderChain
        const entityComp = getObject(composite.id) as CompositeObject
        entityComp.renderChain = buildRenderChain(objects.value, composite.id)
      }
    }

    return updatedComposite
  }

  // P2: Ungroup all child objects of composite
  function ungroupAll(compositeId: string): void {
    const composite = getObject(compositeId)
    if (composite?.type !== 'composite') {
      throw new Error(`[ungroupAll] Object ${compositeId} is not a composite`)
    }

    const comp = composite as CompositeObject
    const isEntity = comp.compositeMode === 'entity'

    // v19: Save renderChain before ungrouping entity for in-place expansion
    const entityRenderChain = isEntity ? [...(comp.renderChain ?? comp.childIds)] : undefined

    const childIdsCopy = [...comp.childIds]

    for (const childId of childIdsCopy) {
      detachChild(childId, comp)
    }

    // v19: Render chain synchronization (unroll upon ungrouping entity)
    if (!isActionMode.value && isEntity && entityRenderChain) {
      // Penetrate union ancestors to find entity or scene root holding renderChain
      const targetChain = findOwningRenderChain(comp)
      const entityPos = targetChain.indexOf(compositeId)
      if (entityPos !== -1) {
        // Replace entity node with entity's renderChain content (in-place unroll)
        targetChain.splice(entityPos, 1, ...entityRenderChain)
      }
    }
    // union ungroup: renderChain unchanged

    // Clear childIds and delete empty composite
    comp.childIds = []
    comp.renderChain = []
    removeObject(compositeId)
  }

  /** Detect circular reference: whether childId is ancestor of compositeId */
  function wouldCreateCycle(compositeId: string, childId: string): boolean {
    let current: string | undefined = compositeId
    while (current) {
      if (current === childId) return true
      const obj = getObject(current)
      current = obj?.parentId
    }
    return false
  }

  // P2: Add object to existing composite
  function addToComposite(compositeId: string, objectIds: string[]): void {
    const composite = getObject(compositeId)
    if (composite?.type !== 'composite') {
      throw new Error(`[addToComposite] Object ${compositeId} is not a composite`)
    }

    const comp = composite as CompositeObject

    // === Phase 1: Record original state (before attachChild) ===
    interface PendingEntry {
      objectId: string
      renderableIds: string[]
      originalParentId: string | undefined
    }
    const pending: PendingEntry[] = []

    for (const objectId of objectIds) {
      if (wouldCreateCycle(compositeId, objectId)) {
        throw new Error(`[addToComposite] Circular reference: ${objectId} is an ancestor of ${compositeId}`)
      }
      const obj = getObject(objectId)
      pending.push({
        objectId,
        renderableIds: collectRenderableChildIds([objectId]),
        originalParentId: obj?.parentId,
      })
    }

    // === Phase 2: attachChild + childIds (modifies parentId) ===
    for (const { objectId, originalParentId } of pending) {
      // Remove from old parent's childIds
      if (originalParentId) {
        const oldParent = getObject(originalParentId)
        if (oldParent?.type === 'composite') {
          const oldComp = oldParent as CompositeObject
          const idx = oldComp.childIds.indexOf(objectId)
          if (idx !== -1) oldComp.childIds.splice(idx, 1)
        }
      }
      attachChild(objectId, comp)
      if (!comp.childIds.includes(objectId)) {
        comp.childIds.push(objectId)
      }
    }

    // === Phase 3: renderChain update (Setup Mode only) ===
    if (!isActionMode.value) {
      for (const { renderableIds, originalParentId } of pending) {
        const sourceChain = resolveRenderChainByParentId(originalParentId)

        // Determine target renderChain
        let targetChain: string[]
        if (comp.compositeMode === 'entity') {
          comp.renderChain ??= []
          targetChain = comp.renderChain
        } else {
          // union -> penetrate to nearest entity ancestor
          targetChain = findOwningRenderChain(comp)
        }

        // Same chain migration check: object moves within same entity unrolled scope; renderChain unchanged
        if (sourceChain && sourceChain === targetChain) continue

        // Different chains: remove from source chain -> insert into target chain
        if (sourceChain) {
          removeMultipleFromRenderChain(sourceChain, renderableIds)
        }
        for (const rid of renderableIds) {
          const obj = getObject(rid)
          if (obj) {
            const pos = findInsertPosition(targetChain, obj.zIndex, getObject)
            targetChain.splice(pos, 0, rid)
          }
        }
      }
    }
  }

  function removeFromComposite(childIds: string[]): void {
    for (const childId of childIds) {
      const child = getObject(childId)
      if (!child?.parentId) continue

      const composite = getObject(child.parentId)
      if (composite?.type !== 'composite') continue

      const comp = composite as CompositeObject
      const wasEntity = comp.compositeMode === 'entity'

      detachChild(childId, comp)

      // Remove from current parent's childIds
      const childIdx = comp.childIds.indexOf(childId)
      if (childIdx !== -1) comp.childIds.splice(childIdx, 1)

      // detachChild bubbles parentId up; sync parent's childIds
      const updatedChild = getObject(childId)
      const bubbleTargetId = updatedChild?.parentId
      if (bubbleTargetId) {
        const bubbleTarget = getObject(bubbleTargetId)
        if (bubbleTarget?.type === 'composite') {
          const bubbleComp = bubbleTarget as CompositeObject
          if (!bubbleComp.childIds.includes(childId)) {
            bubbleComp.childIds.push(childId)
          }
        }
      }

      // === renderChain cascade update (Setup Mode only) ===
      // Under Action Mode, completely rebuilt by buildRenderChain in sceneStateCalculator
      // union split: union is unrolled in renderChain; bubbled children remain at same level, no change
      // entity split: children become directly visible from being encapsulated in entity; update renderChain
      if (!isActionMode.value && wasEntity) {
        const targetChain = findOwningRenderChain(comp)

        // Same chain check: still falls within unrolled scope of same entity; renderChain unchanged
        if (comp.renderChain && comp.renderChain !== targetChain) {
          // 1. Remove from source entity's renderChain (union unrolled for batch removal)
          const removableIds = collectRenderableChildIds([childId])
          removeMultipleFromRenderChain(comp.renderChain, removableIds)

          // 2. Insert renderable IDs into target renderChain (ordered by zIndex position)
          const insertableIds = collectRenderableChildIds([childId])
          for (const insertId of insertableIds) {
            const obj = getObject(insertId)
            if (obj) {
              const pos = findInsertPosition(targetChain, obj.zIndex, getObject)
              targetChain.splice(pos, 0, insertId)
            }
          }
        }
      }
    }
  }

  /**
   * Walk up from specified composite to find its owning renderChain.
   * Penetrate all union ancestors to find nearest entity ancestor's renderChain;
   * if no entity ancestor, return scene root-level sceneRenderChain.
   */
  function findOwningRenderChain(comp: CompositeObject): string[] {
    let currentParentId = comp.parentId
    while (currentParentId) {
      const ancestor = getObject(currentParentId)
      if (ancestor?.type !== 'composite') break

      const ancestorComp = ancestor as CompositeObject
      if (ancestorComp.compositeMode === 'entity') {
        // Found entity ancestor
        ancestorComp.renderChain ??= []
        return ancestorComp.renderChain
      }
      // union: transparent container, continue upward
      currentParentId = ancestorComp.parentId
    }
    // No entity ancestor -> scene root level
    return sceneRenderChain.value
  }

  /**
   * Locate owning renderChain based on object's parentId.
   * - No parent -> sceneRenderChain
   * - parent is entity -> entity.renderChain
   * - parent is union -> penetrate to nearest entity ancestor
   */
  function resolveRenderChainByParentId(parentId: string | undefined): string[] | null {
    if (!parentId) return sceneRenderChain.value
    const parent = getObject(parentId)
    if (parent?.type !== 'composite') return null
    const parentComp = parent as CompositeObject
    if (parentComp.compositeMode === 'entity') {
      return parentComp.renderChain ?? null
    }
    return findOwningRenderChain(parentComp)
  }

  function clearObjects() {
    setupState.value = {
      camera: { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y, width: CAMERA_BASE_WIDTH, height: CAMERA_BASE_HEIGHT, zoom: 1 },
      objects: [],
      renderChain: [],
    }
    runtimeState.value = null
    selectedObjectId.value = null
  }

  // ==================== Action Mode API ====================

  /** Initialize persistence layer from Setup data (on scene load) */
  function initFromSetup(sourceObjects: SceneObject[]): void {

    setupState.value.objects = JSON.parse(JSON.stringify(sourceObjects)) as SceneObject[]
  }

  /** Set Action Mode flag */
  function setActionMode(enabled: boolean): void {

    isActionMode.value = enabled
    if (enabled) {
      // Enter Action Mode: create RuntimeSceneSnapshot from setupState
      runtimeState.value = createRuntimeSnapshot(setupState.value)
    } else {
      // Exit Action Mode: discard runtimeState; objects computed automatically switches back to setupState
      runtimeState.value = null
    }
  }

  /** Get whether currently in Action Mode */
  function getIsActionMode(): boolean {
    return isActionMode.value
  }

  // ==================== v24: Episode Auto Sync ====================
  let _episodeSetupRef: SceneSetup | null = null

  /** Register episode sync target in Action Mode. Pass null to unregister. */
  function registerEpisodeSync(setup: SceneSetup | null): void {
    _episodeSetupRef = setup
  }

  /** v24: Sync persistence layer renderChain to registered episode data */
  function syncRegisteredEpisodeRenderChain(): void {
    if (!_episodeSetupRef) return
    _episodeSetupRef.renderChain = reconcileRenderChain(
      setupState.value.renderChain ?? [],
      _episodeSetupRef.objects,
    )
    for (const obj of _episodeSetupRef.objects) {
      if (obj.type !== 'composite') continue
      const composite = obj as CompositeObject
      if (composite.compositeMode !== 'entity') continue
      // v24.1: Read entity renderChain baseline from setupState (authoritative Store source),
      // rather than episode copy, which might hold stale renderChain due to deep-copy timing.
      const storeComposite = setupState.value.objects.find(o => o.id === composite.id) as CompositeObject | undefined
      composite.renderChain = reconcileRenderChain(
        storeComposite?.renderChain ?? [],
        _episodeSetupRef.objects,
        composite.id,
      )
    }
  }

  // ==================== Action Mode Persistence Operation API ====================
  // The following APIs are for valid persistence modifications in Action Mode (dynamic object management + UI-only properties)

  /** Add dynamic object to persistence layer in Action Mode (sync write to setupState + runtimeState + episode) */
  function addSetupObject(obj: SceneObject): void {
    setupState.value.objects.push(obj)
    
    // 1. Sync persistence layer (Setup) renderChain (use rcSetupAccessor to bypass isActionMode hijacking)
    rcOnObjectAdded(obj, rcSetupAccessor)

    // 2. Sync write to runtimeState for immediate Action Mode render visibility
    if (runtimeState.value) {
      const runtimeObj = JSON.parse(JSON.stringify(obj)) as SceneObject
      runtimeState.value.objects.push(runtimeObj)
      rcOnObjectAdded(runtimeObj, rcStoreAccessor)
    }

    // 3. v24: Auto-sync to episode persistent data (deep copy ensures independence)
    if (_episodeSetupRef) {
      _episodeSetupRef.objects.push(JSON.parse(JSON.stringify(obj)) as SceneObject)
      syncRegisteredEpisodeRenderChain()
    }
  }
  /**
   * Delete dynamic object from persistence layer in Action Mode (sync remove from setupState + runtimeState)
   */
  function removeSetupObject(id: string): void {
    const setupIdx = setupState.value.objects.findIndex(o => o.id === id)
    if (setupIdx !== -1) {
      const obj = setupState.value.objects[setupIdx]!
      // Trigger deletion hooks and ensure parent-child cleanup acts on setupState persistence layer
      const hooks = getLifecycleHooks(obj.type)
      hooks?.onBeforeDelete?.(obj, setupStoreAccessor)

      setupState.value.objects.splice(setupIdx, 1)

      // Sync clean persistence layer (Setup) renderChain (use rcSetupAccessor to bypass isActionMode hijacking)
      rcOnObjectRemoved(id, obj, rcSetupAccessor)
    }

    if (runtimeState.value) {
      const runtimeIdx = runtimeState.value.objects.findIndex(o => o.id === id)
      if (runtimeIdx !== -1) {
        const runtimeObj = runtimeState.value.objects[runtimeIdx]!
        runtimeState.value.objects.splice(runtimeIdx, 1)

        // Sync clean runtimeState renderChain
        rcOnObjectRemoved(id, runtimeObj, rcStoreAccessor)
      }
    }

    // v24: Overwrite entire state to episode (onBeforeDelete may have cascaded parentId/childIds changes)
    if (_episodeSetupRef) {
      _episodeSetupRef.objects = JSON.parse(JSON.stringify(setupState.value.objects)) as SceneObject[]
      syncRegisteredEpisodeRenderChain()
    }
  }

  /** Modify persistence layer properties in Action Mode (alias, compositeLocked, etc. UI-only persistent properties) */
  function updateSetupObject<T extends SceneObject = SceneObject>(id: string, updates: SceneObjectUpdateFor<T>): void {
    // Write to both persistence and display layers
    applyUpdatesToArray(setupState.value.objects, id, updates)
    if (runtimeState.value) {
      applyUpdatesToArray(runtimeState.value.objects, id, updates)
    }
    // v24: Auto-sync to episode persistent data (exact sync by ID)
    if (_episodeSetupRef) {
      applyUpdatesToArray(_episodeSetupRef.objects, id, updates)
    }
  }

  /** Get object from persistence layer (for Action Mode scenarios reading Setup raw values) */
  function getSetupObject(id: string): SceneObject | undefined {
    return setupState.value.objects.find(obj => obj.id === id)
  }

  /**
   * Apply Slot calculation results to runtime layer
   *
   * Uses realState from calculateSlotStates as single source of truth, syncing property-by-property to runtimeObjects.
   * Dirty-check ensures identical values do not trigger Vue setter, preventing watcher infinite loops.
   *
   * @param excludeIds Object IDs to skip (excludes objects currently in interaction,
   *        preventing applySlotState from overwriting intermediate values from handleDragMove/handleResizeMove)
   */
  function applySlotState(
    slotStates: import('@/utils/sceneStateCalculator').SlotStatesResult,
    excludeIds?: Set<string>
  ): void {

    if (!runtimeState.value) return
    // Only write to display layer (runtimeState), never touch persistence layer (setupState)
    // v17: animations / initialAnimations managed by Store (updateSetupObject),
    // not overwritten by scene.setup -> calculateSlotStates -> applySlotState pipeline
    // v19: compositeLocked is UI-only property (not serialized), preserved to avoid slot override
    // v23: alias / name are metadata fields modified via updateSetupObject, unaffected by any Action.
    //      sceneGraph cached slotStates might hold stale values; unprotected names would revert.
    const preserveKeys = new Set(['animations', 'initialAnimations', 'compositeLocked', 'alias', 'name'])
    const nearlyEqual = (a: number | undefined, b: number | undefined, epsilon = 0.0001): boolean => {
      if (a === b) return true
      if (a === undefined || b === undefined) return false
      return Math.abs(a - b) <= epsilon
    }

    for (const runtimeObj of runtimeState.value.objects) {
      // Camera is synchronized from slotStates.camera.real below.
      // Do not also flow it through the generic objects map, otherwise camera
      // fields such as zoom/width/height can be written twice by two sources.
      if (runtimeObj.type === 'camera') continue
      // v21: Skip interacting objects to prevent overwriting drag/scale/rotate intermediate values
      if (excludeIds?.has(runtimeObj.id)) continue
      const stateResult = slotStates.objects.get(runtimeObj.id)
      if (!stateResult) continue

      const target = stateResult.real as unknown as Record<string, unknown>
      const runtimeRec = runtimeObj as unknown as Record<string, unknown>
      // Sync: target (realState) is single source of truth
      // v17: Skip preserveKeys - these fields managed directly by Store, not overridden by scene.setup snapshot
      for (const [key, newValue] of Object.entries(target)) {
        if (preserveKeys.has(key)) continue
        const oldValue = runtimeRec[key]
        if (oldValue !== newValue) {
          if (typeof oldValue === 'object' && typeof newValue === 'object'
            && oldValue !== null && newValue !== null
            && JSON.stringify(oldValue) === JSON.stringify(newValue)) {
            continue
          }

          runtimeRec[key] = newValue
        }
      }

      // Remove extraneous properties on runtimeObj not in target
      // v16: Retain fields in preserveKeys
      for (const key of Object.keys(runtimeRec)) {
        if (!(key in target) && !preserveKeys.has(key)) {
          delete runtimeRec[key]
        }
      }

    }


    // Sync runtime renderChain
    if (slotStates.renderChain.length > 0) {
      runtimeState.value.renderChain = slotStates.renderChain
    }

    // Sync camera state to camera object in store
    // applySlotState previously only synced objects map without camera,
    // causing stale camera values in store (x/y/zoom) after deleting camera action,
    // resulting in subsequent interactions reading ghost data from store
    // Camera uses zoom as its primary scale state, while width/height are
    // derived values. Keep camera sync isolated here so there is a single
    // authoritative write path for runtime camera state.
    const cameraObj = runtimeState.value.objects.find(o => o.type === 'camera')
    // v21: Skip sync when camera is interaction-locked to avoid overwriting drag/zoom intermediates
    if (cameraObj && !excludeIds?.has(cameraObj.id)) {
      const camReal = slotStates.camera.real
      if (!nearlyEqual(cameraObj.x, camReal.x)) cameraObj.x = camReal.x
      if (!nearlyEqual(cameraObj.y, camReal.y)) cameraObj.y = camReal.y
      const cameraTyped = cameraObj as CameraObject
      if (!nearlyEqual(cameraTyped.zoom, camReal.zoom)) {
        cameraTyped.zoom = camReal.zoom
        cameraObj.width = CAMERA_BASE_WIDTH / camReal.zoom
        cameraObj.height = CAMERA_BASE_HEIGHT / camReal.zoom
      } else {
        const expectedWidth = CAMERA_BASE_WIDTH / camReal.zoom
        const expectedHeight = CAMERA_BASE_HEIGHT / camReal.zoom
        if (!nearlyEqual(cameraObj.width, expectedWidth)) cameraObj.width = expectedWidth
        if (!nearlyEqual(cameraObj.height, expectedHeight)) cameraObj.height = expectedHeight
      }
    }
  }

  // ==================== PT Phase 8.2: Persistent Serialization ====================

  /**
   * Convert SceneObject to persistent DTO
   * Whoever creates data is responsible for serialization - Store knows each type's fields best
   * P1: Specialized fields dispatched via TypeSerializer registry without switch
   *
   * Dual-layer architecture: always reads from setupObjects (persistence layer), ensuring Action Mode runtime state is never serialized
   */
  function toSetupObject(obj: SceneObject): SceneObject {
    // Dual-layer architecture: under Action Mode, look up original data from setupObjects
    // Thus even if obj comes from runtimeObjects (overwritten by applySlotState), serialized data retains Setup raw values
    const sourceObj = isActionMode.value
      ? (setupState.value.objects.find(s => s.id === obj.id) ?? obj)
      : obj

    // Common geometry properties (shared across all types)
    const base: Partial<SceneObject> & Record<string, unknown> = {
      id: sourceObj.id,
      refId: sourceObj.refId,
      type: sourceObj.type,
      name: sourceObj.name,
      x: sourceObj.x,
      y: sourceObj.y,
      width: sourceObj.width,
      height: sourceObj.height,
      scaleX: sourceObj.scaleX,
      scaleY: sourceObj.scaleY,
      rotation: sourceObj.rotation,
      zIndex: sourceObj.zIndex,
      flipX: sourceObj.flipX,
      visible: sourceObj.visible,
      alpha: sourceObj.alpha,
      ...(sourceObj.receiveLighting === false
        ? { receiveLighting: false }
        : {}),
      ...(sourceObj.castShadow === true
        ? { castShadow: true }
        : {}),
      spawned: (sourceObj as unknown as { spawned?: boolean }).spawned ?? true,
      ...(sourceObj.parentId ? { parentId: sourceObj.parentId } : {}),
      // Transform origin (optional, default 0 not serialized)
      ...(sourceObj.transformOriginX !== undefined && sourceObj.transformOriginX !== 0
        ? { transformOriginX: sourceObj.transformOriginX } : {}),
      ...(sourceObj.transformOriginY !== undefined && sourceObj.transformOriginY !== 0
        ? { transformOriginY: sourceObj.transformOriginY } : {}),
      // v16: Uniformly serialize animation data
      ...(sourceObj.animations && Object.keys(sourceObj.animations).length > 0
        ? { animations: sourceObj.animations } : {}),
      ...(sourceObj.initialAnimations !== undefined
        ? { initialAnimations: sourceObj.initialAnimations } : {}),
    }

    // Save alias for all non-camera objects
    if (sourceObj.alias) base.alias = sourceObj.alias

    // v20: Serialize extraInfo (source identity marker)
    if (sourceObj.extraInfo) base.extraInfo = sourceObj.extraInfo

    // P1: Populate specialized fields by type - delegated to TypeSerializer
    const serializer = getTypeSerializer(sourceObj.type)
    if (serializer) {
      serializer.serializeFields(sourceObj, base)
    }
    // text/camera have no registered serializer; common fields suffice

    return base as SceneObject
  }

  /**
   * Phase 2: Deserialize from SceneObject to runtime SceneObject
   * Character name resolution injected via callback, decoupling Store from projectStore/actorUtils
   * P1: Deserialization logic for each type delegated to TypeSerializer registry
   */
  function fromSetupObject(
    objData: SceneObject,
    resolveActorName: (refId: string, actorId?: string) => { displayName: string; resolvedActorId: string } | null
  ): void {
    const serializer = getTypeSerializer(objData.type)
    if (!serializer) {
      // camera/text not loaded via setup.objects, no serializer needed
      return
    }

    // Construct deserialization context, injecting Store internal functions to serializer
    const ctx: DeserializeContext = {
      createBackgroundObject,
      createAudioObject,
      createPropObject,
      createScreenEffectObject,
      createSymbolObject,
      createExpressionObject,
      createCompositeObject,
      createTextObject,
      createLightObject,
      createMaskObject,
      pendingMaskTargets: _pendingMaskTargets,
      updateObject,
      resolveActorName,
    }

    serializer.deserialize(objData, ctx)

    // v16: Uniformly restore animation data (shared by all types)
    const createdObj = setupState.value.objects.find(o => o.id === objData.id)
    if (createdObj) {
      if (objData.receiveLighting !== undefined) {
        createdObj.receiveLighting = objData.receiveLighting
      }
      if (objData.castShadow !== undefined) {
        createdObj.castShadow = objData.castShadow
      }
      // v20: Restore extraInfo (source identity marker)
      if (objData.extraInfo) {
        createdObj.extraInfo = objData.extraInfo
      }
      if (objData.animations && Object.keys(objData.animations).length > 0) {
        // New file: restore from persisted data
        createdObj.animations = objData.animations
      }
      // Migration: legacy files lack animations, hydrated as fallback
      if (!createdObj.animations || Object.keys(createdObj.animations).length === 0) {
        getAnimationStore().hydrateObjectAnimations(createdObj)
      }
      if (objData.initialAnimations !== undefined) {
        createdObj.initialAnimations = objData.initialAnimations
      }
      // v21: Legacy file migration - only supply default playback when initialAnimations completely absent in file
      if (objData.initialAnimations === undefined) {
        autoPopulateInitialAnimations(createdObj)
      }
    }
  }

  // v19: RenderChain management API
  function getSceneRenderChain(): string[] {
    return sceneRenderChain.value
  }

  function setSceneRenderChain(chain: string[]): void {
    setupState.value.renderChain = chain
  }

  /** Automatically build scene renderChain from current objects (for init/migration) */
  function rebuildSceneRenderChain(): void {
    setupState.value.renderChain = buildRenderChain(objects.value)
  }

  /** Reconcile renderChain for all entity composites (called after deserialization/migration) */
  function rebuildEntityRenderChains(): void {
    for (const obj of setupState.value.objects) {
      if (obj.type !== 'composite') continue
      const comp = obj as CompositeObject
      if (comp.compositeMode !== 'entity') continue
      // Rebuild when legacy data missing; incrementally reconcile persisted data to preserve user order and admit new types.
      if (!comp.renderChain || comp.renderChain.length === 0) {
        comp.renderChain = buildRenderChain(setupState.value.objects, comp.id)
      } else {
        comp.renderChain = reconcileRenderChain(comp.renderChain, setupState.value.objects, comp.id)
      }
    }
  }

  /**
   * v19: Stable sort renderChain of specified object (Setup Mode only).
   * Used to maintain zIndex ordered invariant after zIndex changes.
   *
   * Stable sort vs full rebuild:
   * - Stable sort: regroup by zIndex only, preserving user custom relative order within same zIndex
   * - Full rebuild (buildRenderChain): loses user custom order, regressing to objects array index ordering
   *
   * Locating logic:
   * - Object in entity -> sort that entity's renderChain
   * - Object in union -> penetrate to nearest entity ancestor to sort
   * - Root-level object -> sort sceneRenderChain
   */
  function sortOwningRenderChain(objectId: string): void {
    if (isActionMode.value) return // Action Mode handled by sceneStateCalculator
    const obj = getObject(objectId)
    if (!obj) return

    const zIndexGetter = (id: string): number => getObject(id)?.zIndex ?? 0

    // Walk up parentId chain to find nearest entity ancestor
    let currentParentId = obj.parentId
    while (currentParentId) {
      const parent = getObject(currentParentId)
      if (parent?.type === 'composite') {
        const parentComp = parent as CompositeObject
        if (parentComp.compositeMode === 'entity') {
          if (parentComp.renderChain) {
            parentComp.renderChain = sortRenderChainByZIndex(parentComp.renderChain, zIndexGetter)
          }
          return
        }
        // union: continue upward
        currentParentId = parentComp.parentId
      } else {
        break
      }
    }
    // Root-level object: stable sort sceneRenderChain
    setupState.value.renderChain = sortRenderChainByZIndex(sceneRenderChain.value, zIndexGetter)
  }

  return {
    objects,             // computed proxy: Setup Mode -> setupState.objects, Action Mode -> runtimeState.objects
    setupState,          // Persistence layer SceneSetup (for serialization, migration)
    runtimeState,        // Runtime layer RuntimeSceneSnapshot | null
    selectedObjectId,
    // v17: Namespace alias management
    resolveNamespaceRoot,
    getNamespaceAliases,
    getExistingAliases,
    isAliasExists,
    generateUniqueAlias,
    // Object operation functions
    addObject,
    createBackgroundObject,
    createAudioObject,
    createPropObject,
    autoPopulateInitialAnimations,  // v21: Only invoked by UI creation path
    createScreenEffectObject,
     createSymbolObject,        // v16
    createExpressionObject,    // v18
    createCompositeObject,   // P2
    createMaskObject,         // Clip-Mask Phase 1
    finalizeMaskTargets,      // Clip-Mask Phase 1: Backfill after deserialization + exclusive validation
    createCameraObject,
    createLightObject,
    createTextObject,
    getObject,
    updateObject,
    removeObject,
    selectObject,
    getSelectedObject,
    duplicateObject,
    getSortedObjects,
    getChildObjects,         // P2
    getRootObjects,          // P2
    groupObjects,            // P2: Multi-selection grouping
    ungroupAll,              // P2: Ungroup all
    addToComposite,          // P2: Add member
    removeFromComposite,     // P2: Remove member
    reorderChild,            // P2: Reorder child rendering order
    reorderSceneRenderChain, // v19: Scene root renderChain ordering
    collectAllDescendantIds, // P2: Recursively collect descendant IDs
    removeObjectWithDescendants, // P2: Force cascade deletion
    dissolveComposite,           // P2: Dissolve composite (children bubble up)
    clearObjects,
    toSetupObject,
    fromSetupObject,
    // v19: RenderChain management
    getSceneRenderChain,
    setSceneRenderChain,
    rebuildSceneRenderChain,
    rebuildEntityRenderChains,
    sortOwningRenderChain,
    // Action Mode API
    initFromSetup,
    applySlotState,
    setActionMode,
    getIsActionMode,
    // Action Mode persistence operation API
    addSetupObject,
    removeSetupObject,
    updateSetupObject,
    getSetupObject,
    registerEpisodeSync,
  }
})
