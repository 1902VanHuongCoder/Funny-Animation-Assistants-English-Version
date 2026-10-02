/**
 * useSceneRenderer - Scene Renderer (Commander Pattern)
 * 
 * Architecture:
 * Following "Strategy Pattern + Composition Reuse" design, responsibilities are split into independent Composable modules:
 * 
 * 1. usePixiApp.ts    - PixiJS setup (init/destroy/resize)
 * 2. useSceneGraph.ts - Layer & object management (create/update/remove)
 * 3. useInteraction.ts - Interaction logic (drag/resize/rotate)
 * 
 * This file serves as the "Commander" role, responsible for:
 * - Assembling the above modules
 * - Coordinating data flow between modules
 * - Providing unified external interface
 */

import * as PIXI from 'pixi.js'
import { watch } from 'vue'

import { useAssetImage } from '@/composables/useAssetImage'
// v7.3: effectStore removed
import { useAssetLoader } from '@/composables/useAssetLoader'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/constants/canvas'
import { CAMERA_BASE_HEIGHT, CAMERA_BASE_WIDTH } from '@/constants/canvas'
import { Z_INDEX_CAMERA_OVERLAY } from '@/constants/zIndex'
import { LightingFilter } from '@/core/filters/LightingFilter'
import {
  applyAllMasks,
  createMaskRendererResources,
  disposeMaskRendererResources,
  type MaskRendererResources,
} from '@/core/maskRenderer'
import { installRenderChainRenderer, installRootRenderChainRenderer } from '@/core/RenderChainStage'
import { applyLightingFilter, type LightingFilterCache } from '@/core/renderPipeline'
import { type ObjectDimensions, type ObjectStateHost, SceneObjectRenderer } from '@/core/SceneObjectRenderer'
import { advanceAnimatedSprites } from '@/core/spriteAnimationDriver'
import type { TextureProvider } from '@/core/TextureProvider'
import { useBackgroundStore } from '@/stores/backgroundStore'
import { useExpressionStore } from '@/stores/expressionStore'
import { usePropStore } from '@/stores/propStore'
import { type CameraObject, type SceneObject, useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { LightObject, SymbolObject, TextObject } from '@/types/sceneObject'
import type { SceneObjectProvider } from '@/types/SceneObjectProvider'
// Import utilities
// v8.8: evaluateCameraStateBySlot and evaluateObjectStateBySlot removed
// Unified rendering pipeline directly uses calculateSlotStates results
import type { Action, RuntimeSceneSnapshot, RuntimeSlot, SceneSetup, SetAnimAction } from '@/types/screenplay'
import { localToGlobal } from '@/utils/actionHandlers/matrixUtils'
import type { WriteableState } from '@/utils/actionHandlers/types'
import { ensureFontLoaded } from '@/utils/fontLoader'
// v25.6: evaluateLight is called internally by shared applyLightingFilter, editor no longer imports directly
import { isPointLikeLight } from '@/utils/lightRuntime'
import { sortRenderChainByZIndex } from '@/utils/renderChainUtils'

import { type InteractionCallbacks, useInteraction } from './useInteraction'
// Import decomposed sub-modules
import { type PixiAppOptions, usePixiApp } from './usePixiApp'
import { useSceneGraph } from './useSceneGraph'
import { useScenePicking } from './useScenePicking'

interface UseSceneRendererOptions {
  canvasContainer: HTMLElement
  canvasWidth?: number
  canvasHeight?: number
  mode?: 'setup' | 'action'
  episodeId?: string | null
  sceneId?: string | null
  blockId?: string | null
  onActionUpdate?: (action: ActionUpdatePayload) => void | Promise<void>
  onSetupChange?: (change: SetupChangePayload) => void  // Setup Mode: Notification after drag/scale/rotate/origin edit completed
  wheelZoomAnchor?: 'pointer' | 'viewport-center'
  /** Optional store override for data-isolated scenes (e.g. animation editing). Uses global sceneObjectStore if omitted */
  storeOverride?: SceneObjectProvider
  /**
   * Downgrade transform origin handle to read-only gizmo:
   * - Rendered in gray, disables pointer events, does not respond to dragging
   * Used in animation workbench main canvas - transform origin editing migrated to PivotEditorPanel.
   */
  readonlyOriginHandle?: boolean
  /**
   * Lock object interaction: removes drag-related pointer events on object container,
   * preventing user from dragging/scaling/rotating the object body.
   * Transform origin handle remains active (handle is in selectionContainer, unaffected by container events).
   * Used in PivotEditorPanel isolated sub-canvas.
   */
  lockObjectInteraction?: boolean
  /**
   * Disable viewport pan/zoom: wheel, middle-click, and Space+drag no longer trigger viewport movement or zooming.
   * Used in PivotEditorPanel to avoid object being panned out of view.
   */
  disableViewportPanZoom?: boolean
}

// Action Mode operation callback payload type
export type ActionUpdatePayload =
  | { type: 'move'; target: string; params: { x: number; y: number; speed: string; globalX?: number; globalY?: number } }
  | { type: 'scale'; target: string; params: { scaleX: number; scaleY: number; x?: number; y?: number; globalX?: number; globalY?: number } }
  | { type: 'rotate'; target: string; params: { rotation: number; x?: number; y?: number; globalX?: number; globalY?: number } }
  | { type: 'set_origin'; target: string; params: { transformOriginX: number; transformOriginY: number } }

export type SetupChangePayload =
  | { type: 'transform'; objectId: string }
  | { type: 'origin'; objectId: string; pivot: { x: number; y: number } }

export function useSceneRenderer(options: UseSceneRendererOptions) {
  const _globalStore = useSceneObjectStore()
  const sceneObjectStore: SceneObjectProvider = options.storeOverride ?? _globalStore
  const propStore = usePropStore()

  // v7.3: effectStore removed

  const { imageCache: _imageCache } = useAssetImage()

  const mode = options.mode ?? 'setup'
  const onActionUpdate = options.onActionUpdate
  const onSetupChange = options.onSetupChange
  const readonlyOriginHandle = options.readonlyOriginHandle ?? false
  const lockObjectInteraction = options.lockObjectInteraction ?? false

  // ========== 1. Assemble Sub-modules ==========

  // 1.1 PixiJS Basic Setup
  const pixiAppOptions: PixiAppOptions = {
    canvasContainer: options.canvasContainer,
    mode
  }
  if (options.canvasWidth !== undefined) pixiAppOptions.canvasWidth = options.canvasWidth
  if (options.canvasHeight !== undefined) pixiAppOptions.canvasHeight = options.canvasHeight
  if (options.wheelZoomAnchor !== undefined) pixiAppOptions.wheelZoomAnchor = options.wheelZoomAnchor
  if (options.disableViewportPanZoom !== undefined) pixiAppOptions.disableViewportPanZoom = options.disableViewportPanZoom

  const pixiApp = usePixiApp(pixiAppOptions)

  // 1.2 Layer & Object Management
  const sceneGraph = useSceneGraph({ mode, ...(options.storeOverride ? { storeOverride: options.storeOverride } : {}) })

  // 1.3 Interaction Logic (lazy init, needs stage and canvasElement reference)
  let interaction: ReturnType<typeof useInteraction> | null = null

  // ========== 2. State Management ==========

  // v8.6 P1: Legacy time variables removed, unified to Slot-driven
  // v8.6 P0: currentActions migrated to SceneGraph, read from sceneGraph.getCurrentActions() instead
  // v8.6 P0: currentSlots migrated to SceneGraph, read from sceneGraph.getSlots() instead
  // v8.6 P0: currentSlotIndex migrated to SceneGraph, read from sceneGraph.getCurrentSlotIndex() instead
  let actionModeState: SceneSetup | RuntimeSceneSnapshot | null = null
  let isDestroyed = false // Flag to prevent repeated destruction
  let blankCanvasInteractionLayer: PIXI.Container | null = null
  let scenePickingInteractionLayer: PIXI.Container | null = null

  let autoRenderEnabled = true

  // Clip-Mask Phase 1: \u8499\u7248\u6e32\u67d3\u5668\u8d44\u6e90\uff08\u7f16\u8f91\u5668\u8def\u5f84\uff09
  const maskRendererResources: MaskRendererResources = createMaskRendererResources()
  let suppressObjectWatchRenderCount = 0

  // v7.9: Override Object States (Target Preview Mode)
  let overrideObjectStates: Map<string, SceneObject> | null = null

  // Action Mode resize/rotate initial state
  let resizeStartState: { scaleX: number; scaleY: number; width?: number; height?: number } | null = null
  let rotateStartState: { rotation: number } | null = null



  // Phase 3: Unified renderer — delegated to SceneObjectRenderer.applyObjectState
  const { getTexture: _getTexture } = useAssetLoader()
  const { getImageUrl: _getImageUrl } = useAssetImage()
  const editorTextureProvider: TextureProvider = {
    getTexture: (url: string) => _getTexture(url),
    getImageUrl: (url: string) => _getImageUrl(url)
  }
  const editorRenderer = new SceneObjectRenderer(
    editorTextureProvider,
    {
      propStore,
      backgroundStore: useBackgroundStore(),
      expressionStore: useExpressionStore()
    }
  )
  // Phase 3: Editor ObjectStateHost cache
  const lightingFilterInstance = new LightingFilter()
  const objectDimensionsCache = new Map<string, ObjectDimensions>()
  const textFontRenderTokens = new WeakMap<PIXI.Container, number>()

  // Interaction lock: records object IDs currently being dragged/resized/rotated
  // Prevents async applyObjectState after await from overwriting container transforms set during interaction
  const interactionLockedObjects = new Set<string>()

  const editorObjectStateHost: ObjectStateHost = {
    getObjectDimensions: (id: string) => objectDimensionsCache.get(id),
    setObjectDimensions: (id: string, dims: ObjectDimensions) => objectDimensionsCache.set(id, dims),
    isInteractionLocked: (objectId: string) => interactionLockedObjects.has(objectId),
  }

  async function applyEditorObjectState(
    container: PIXI.Container,
    state: SceneObject,
    objSetup: SceneObject,
  ): Promise<boolean> {
    if (state.type === 'text') {
      const textState = state as TextObject
      const token = (textFontRenderTokens.get(container) ?? 0) + 1
      textFontRenderTokens.set(container, token)
      await ensureFontLoaded(textState.fontFamily ?? 'Noto Sans SC', textState.content)
      if (container.destroyed || textFontRenderTokens.get(container) !== token) {
        return false
      }
    }
    editorRenderer.applyObjectState(container, state, objSetup, editorObjectStateHost)
    return true
  }

  // v6.6: Currently selected action type (used to restrict camera dragging)
  let currentSelectedActionType: string | null = null

  // v25.6: Lighting aggregation function — delegated to shared pipeline applyLightingFilter
  // Eliminates editor/ScenePlayer dual-pipeline divergence, ensuring coordinate projection, radius projection, and UV normalization are identical.
  const lightingFilterCache: LightingFilterCache = { instance: lightingFilterInstance }

  function aggregateLightingFilter(objects: readonly SceneObject[]): void {
    const ctx = pixiApp.getContext()
    if (!ctx) return
    const filterHost = ctx.activeLayer ?? ctx.stage
    if (!filterHost) return

    const canvasW = options.canvasWidth ?? 1600
    const canvasH = options.canvasHeight ?? 900
    const timeMs = mode === 'action' ? 0 : Date.now()

    // v25.6 fix: Must use explicit filterAreaOverride = renderer screen rectangle (0, 0, w, h).
    // Reason: computeCanvasWorldFilterArea produces negative coordinate filterArea after editor pan/zoom
    // (e.g. (-647, 0, 3182, 663)), but PIXI v7 FilterSystem internally clips sourceFrame
    // to renderer screen bounds, shifting the vTextureCoord mapping baseline and causing visual rightward shift.
    // Using app.screen always covers the visible area (0,0,w,h), consistent with ScenePlayer strategy.
    const pixi = pixiApp.app
    const screenArea = pixi
      ? new PIXI.Rectangle(0, 0, pixi.screen.width, pixi.screen.height)
      : undefined

    applyLightingFilter(
      objects,
      filterHost,
      canvasW,
      canvasH,
      lightingFilterCache,
      screenArea,
      (id) => sceneGraph.getContainer(id),
      timeMs,
      pixi?.renderer as PIXI.Renderer | undefined,
    )
  }

  // v7.15: Playback state (used to control animation playback)
  let isPlaying = false

  // v25.4: Recalculate lighting filter position when viewport pan/zoom changes
  // aggregateLightingFilter uses toGlobal to get screen coordinates; coordinates change after viewport transform
  pixiApp.onViewportTransformChanged(() => {
    const objects = sceneObjectStore.objects
    if (objects.length > 0) {
      aggregateLightingFilter(objects)
    }
  })

  // Phase 2: Flicker ticker — refreshes lighting filter each frame when flickering light sources exist
  let flickerTickerRegistered = false
  const flickerTickerCallback = (): void => {
    const objects = sceneObjectStore.objects
    if (objects.length > 0) {
      aggregateLightingFilter(objects)
    }
  }

  /**
   * Checks whether current scene needs flicker ticker, register/unregister on demand
   */
  function syncFlickerTicker(objects: readonly SceneObject[]): void {
    if (mode === 'action') {
      if (flickerTickerRegistered && pixiApp.app) {
        pixiApp.app.ticker.remove(flickerTickerCallback)
        flickerTickerRegistered = false
      }
      return
    }

    const hasFlicker = objects.some(
      o => o.type === 'light'
        && (o as SceneObject & { spawned?: boolean }).spawned !== false
        && isPointLikeLight(o as LightObject)
        && ((o as LightObject).flicker ?? 0) > 0 && o.visible
    )
    const app = pixiApp.app
    if (!app) return

    if (hasFlicker && !flickerTickerRegistered) {
      app.ticker.add(flickerTickerCallback)
      flickerTickerRegistered = true
    } else if (!hasFlicker && flickerTickerRegistered) {
      app.ticker.remove(flickerTickerCallback)
      flickerTickerRegistered = false
    }
  }

  // Transform Origin handle drag guard: set on handle pointerdown,
  // prevents setupObjectInteraction pointerdown in the same frame from triggering object drag
  let suppressNextObjectDrag = false

  // P2: Composite double-click unlock — tracks last selected target and timestamp
  let lastSelectTargetId: string | null = null
  let lastSelectTime = 0
  const DOUBLE_CLICK_THRESHOLD = 300 // ms

  /**
   * Transform Origin reverse compensation: calculate object logical center from container.position
   *
   * When transformOriginX/Y is not default, container.position includes compensation,
   * must subtract compensation to get the true obj.x/y (geometric center coordinates).
   */
  /**
   * v19: Get Transform Origin compensation offset
   * containerPosition = dataModelPos + offset
   * Extracted from the same formula in applyTransformOriginPivot
   *
   * @returns { cx, cy } Forward offset
   */
  function getTransformOriginOffset(objectId: string): { cx: number; cy: number } {
    const obj = sceneObjectStore.getObject(objectId)
    const originX = obj?.transformOriginX ?? 0
    const originY = obj?.transformOriginY ?? 0

    // v21: applySlotState has synced transformOriginX/Y to runtimeObjects,
    // getObject() returns runtimeObjects in Action Mode, read directly.

    // Pixel offset approach: directly return originX/Y as compensation
    return { cx: originX, cy: originY }
  }

  function getEvaluatedObjectState(objectId: string): SceneObject | undefined {
    const slotState = sceneGraph.getGhostStates()?.objects.get(objectId)?.real
    return slotState ?? sceneObjectStore.getObject(objectId)
  }

  function getEvaluatedGlobalPosition(objectId: string): { x: number; y: number } | undefined {
    const state = getEvaluatedObjectState(objectId)
    if (!state) return undefined

    const getObjState = (id: string): WriteableState | undefined => {
      const obj = getEvaluatedObjectState(id)
      return obj ? (obj as unknown as WriteableState) : undefined
    }
    const global = localToGlobal(state as unknown as WriteableState, getObjState)
    return { x: global.x, y: global.y }
  }

  /**
   * v19: Get object's effective flip state accumulated along parent chain
   * Traverse parentId chain, XOR all ancestors + own flipX
   * Used by interaction system to determine scale/rotation and cursor directions
   */
  function getEffectiveFlipX(objectId: string): boolean {
    let flipped = false
    let currentId: string | undefined = objectId
    while (currentId) {
      const obj = sceneObjectStore.getObject(currentId)
      if (!obj) break
      if (obj.flipX) flipped = !flipped
      currentId = obj.parentId
    }
    return flipped
  }

  let groupingPendingIds: string[] = []

  function ensureBlankCanvasInteractionLayer(contentRoot: PIXI.Container): void {
    if (blankCanvasInteractionLayer?.destroyed) {
      blankCanvasInteractionLayer = null
    }

    if (!blankCanvasInteractionLayer) {
      const interactionLayer = new PIXI.Container()
      interactionLayer.name = 'blank_canvas_interaction_layer'
      interactionLayer.zIndex = -10000
      interactionLayer.eventMode = 'static'
      interactionLayer.hitArea = new PIXI.Rectangle(
        0,
        0,
        options.canvasWidth ?? CANVAS_WIDTH,
        options.canvasHeight ?? CANVAS_HEIGHT,
      )
      interactionLayer.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation()

        if (event.button !== 0) return
        if (pixiApp.isSpacePressed || pixiApp.isPanning) return

        sceneObjectStore.selectObject(null)
      })
      blankCanvasInteractionLayer = interactionLayer
    }

    if (blankCanvasInteractionLayer.parent !== contentRoot) {
      contentRoot.addChild(blankCanvasInteractionLayer)
    }
  }

  const scenePicker = useScenePicking({
    store: sceneObjectStore,
    getContainer: (objectId) => sceneGraph.getContainer(objectId),
    isPassThrough: (objectId) => sceneGraph.isPassThrough(objectId),
  })

  function ensureScenePickingInteractionLayer(ctx: import('./usePixiApp').PixiAppContext): void {
    if (scenePickingInteractionLayer?.destroyed) {
      scenePickingInteractionLayer = null
    }

    if (!scenePickingInteractionLayer) {
      const layer = new PIXI.Container()
      layer.name = 'scene_picking_interaction_layer'
      layer.zIndex = 99999
      layer.eventMode = 'static'
      layer.cursor = 'default'
      layer.on('pointerdown', handleScenePickingPointerDown)
      layer.on('pointermove', handleScenePickingPointerMove)
      scenePickingInteractionLayer = layer
    }

    scenePickingInteractionLayer.hitArea = new PIXI.Rectangle(
      0,
      0,
      options.canvasWidth ?? CANVAS_WIDTH,
      options.canvasHeight ?? CANVAS_HEIGHT,
    )

    if (scenePickingInteractionLayer.parent !== ctx.viewportLayer) {
      if (scenePickingInteractionLayer.parent) {
        scenePickingInteractionLayer.parent.removeChild(scenePickingInteractionLayer)
      }
      ctx.viewportLayer.addChild(scenePickingInteractionLayer)
    }
  }

  function handleScenePickingPointerDown(event: PIXI.FederatedPointerEvent): void {
    event.stopPropagation()

    if (event.button !== 0) return
    if (pixiApp.isSpacePressed || pixiApp.isPanning) return
    if (suppressNextObjectDrag) return

    const pickResult = scenePicker.pickAt(event.global)

    if (!pickResult.selectTargetId) {
      sceneObjectStore.selectObject(null)
      return
    }

    let selectTargetId = pickResult.selectTargetId
    sceneObjectStore.selectObject(selectTargetId)

    // P2: Double-click detection — unlock composite. Picking layer preserves rawHitId,
    // allowing double-click on locked composite to switch back to actual hit child.
    const now = Date.now()
    const isDoubleClick = (now - lastSelectTime < DOUBLE_CLICK_THRESHOLD) && lastSelectTargetId === selectTargetId
    lastSelectTime = now
    lastSelectTargetId = selectTargetId

    if (isDoubleClick) {
      const targetObj = sceneObjectStore.getObject(selectTargetId)
      if (targetObj?.type === 'composite') {
        const comp = targetObj as import('@/types/sceneObject').CompositeObject
        if (comp.compositeLocked) {
          if (mode === 'action') {
            sceneObjectStore.updateSetupObject(selectTargetId, { compositeLocked: false } as Partial<SceneObject>)
          } else {
            sceneObjectStore.updateObject(selectTargetId, { compositeLocked: false } as Partial<SceneObject>)
          }
          if (pickResult.rawHitId && pickResult.rawHitId !== selectTargetId) {
            selectTargetId = pickResult.rawHitId
            sceneObjectStore.selectObject(selectTargetId)
          }
        }
      }
    }

    if (lockObjectInteraction) return

    const dragTargetId = selectTargetId
    const obj = sceneObjectStore.getObject(dragTargetId)
    if (!obj) return

    // Ambient light only supports selection, not dragging
    if (obj.type === 'light' && (obj as import('@/types/sceneObject').LightObject).lightType === 'ambient') {
      return
    }

    // v21: In Action mode, camera_follow cannot be dragged; allowed otherwise
    if (mode === 'action' && obj.type === 'camera' && currentSelectedActionType === 'camera_follow') {
      return
    }

    const dragContainer = sceneGraph.getContainer(dragTargetId)
    if (dragContainer) {
      interaction?.startDrag(dragTargetId, event, dragContainer)
    }
  }

  function handleScenePickingPointerMove(event: PIXI.FederatedPointerEvent): void {
    if (!scenePickingInteractionLayer) return
    if (pixiApp.isSpacePressed || pixiApp.isPanning) {
      scenePickingInteractionLayer.cursor = 'grab'
      return
    }

    const pickResult = scenePicker.pickAt(event.global)
    scenePickingInteractionLayer.cursor = pickResult.selectTargetId ? 'pointer' : 'default'
  }

  // ========== 3. Initialization Flow ==========

  async function initRenderer() {
    // 3.1 Initialize PixiJS Application
    const ctx = await pixiApp.initApp()
    if (!ctx) {
      console.error('[SceneRenderer] PixiJS initialization failed')
      return
    }

    // 3.2 Initialize Interaction System
    const interactionCallbacks: InteractionCallbacks = {
      onDragMove: handleDragMove,
      onDragEnd: handleDragEnd,
      onResizeMove: handleResizeMove,
      onResizeEnd: handleResizeEnd,
      onRotateMove: handleRotateMove,
      onRotateEnd: handleRotateEnd,
      onSelect: (objectId) => sceneObjectStore.selectObject(objectId),
      getObject: (objectId) => sceneObjectStore.getObject(objectId),
      getContainer: (objectId) => sceneGraph.getContainer(objectId),
      getCharacterEffectiveScale: (_objectId) => undefined,
      // v20: Unified data model position retrieval (shared between Setup and Action Mode)
      // Setup Mode: read directly from store
      // Action Mode: prioritize reading from ghost states (evaluated action state)
      getEvaluatedPosition: (objectId) => {
        // v21: applySlotState synced x/y/zoom to runtimeObjects,
        // Setup and Action Mode uniformly read from store.
        const obj = sceneObjectStore.getObject(objectId)
        return obj ? { x: obj.x, y: obj.y } : undefined
      },
      getEvaluatedGlobalPosition,
      // v20: Unified data model transform retrieval (shared between Setup and Action Mode)
      getEvaluatedTransform: (objectId) => {
        // v21: applySlotState synced scaleX/scaleY/rotation to runtimeObjects,
        // Setup and Action Mode uniformly read from store.
        const obj = sceneObjectStore.getObject(objectId)
        if (!obj) return undefined
        // Camera uses fixed transform values
        if (obj.type === 'camera') return { scaleX: 1, scaleY: 1, rotation: 0 }
        return { scaleX: obj.scaleX, scaleY: obj.scaleY, rotation: obj.rotation }
      },
      // v19: Transform Origin -> container.position compensation offset
      getPositionCompensation: (objectId) => getTransformOriginOffset(objectId),
      // v19: Effective flip state accumulated along parent chain
      getEffectiveFlipX: (objectId) => getEffectiveFlipX(objectId),
    }

    interaction = useInteraction({
      stage: ctx.viewportLayer,
      canvasElement: ctx.canvasElement,
      callbacks: interactionCallbacks
    })

    ensureScenePickingInteractionLayer(ctx)

    // Bindglobal events
    interaction.bindGlobalEvents()

    // v11.0: Start Ticker for Animation System
    // This drives CharacterSprite.update and GenericAnimationPlayer.update in Setup Mode
    pixiApp.app!.ticker.add(updateAnimations)

    // Automatically refresh selection box on zoom/pan change
    // selectionContainer is sibling to stage (unaffected by zoom), must redraw manually
    watch(pixiApp.transformParams, () => {
      updateSelectionBox()
    })
  }

  // Manual frame animation tick accumulator (replaces PIXI Ticker automatic update)
  // Shares same spriteAnimationDriver logic with ScenePlayer/FrameCapture
  const spriteAnimTimeAccumulator = new WeakMap<PIXI.AnimatedSprite, number>()

  // Animation Update Loop
  function updateAnimations() {
    // Only run if not destroyed
    if (!pixiApp.app?.renderer) return

    // v8.8: Use internal ticker.deltaMS (calculated from ticker.userData) or standard delta
    // PixiJS v7 ticker.deltaMS is usually reliable
    const deltaTime = pixiApp.app.ticker.deltaMS

    // Iterate all cached objects
    const cachedIds = sceneGraph.getCachedIds()
    for (const id of cachedIds) {
      // Update GenericAnimationPlayer (Prop/Background)
      const propPlayer = sceneGraph.getGenericAnimationPlayer(id)
      if (propPlayer) {
        propPlayer.update(deltaTime)
      }
    }

    // Manually advance frame index for all AnimatedSprites
    // Replaces PIXI Ticker automatic update, ensuring transform track and frame sequence advance synchronously
    for (const id of cachedIds) {
      const container = sceneGraph.getContainer(id)
      if (container?.visible) {
        advanceAnimatedSprites(container, deltaTime, spriteAnimTimeAccumulator)
      }
    }

    // v20: union child objects are inside container (real PIXI hierarchy), animation transform propagates automatically

    // Clip-Mask Phase 1: Compute and apply all mask relations before PIXI ticker automatic render
    // User callbacks in ticker default to priority=NORMAL, invoked before priority=LOW automatic render.
    const stage = pixiApp.app.stage
    if (stage) {
      // Root stage parent is null; direct updateTransform call in PIXI v7 internals
      // throws NPE accessing this.parent.transform. Manually recursively refresh subtree instead.
      for (const child of stage.children) {
        child.updateTransform()
      }
      applyAllMasks(
        sceneObjectStore.objects,
        (id) => sceneGraph.getContainer(id),
        maskRendererResources,
      )
    }
  }

  function applySlotStateSilently(
    slotStates: import('@/utils/sceneStateCalculator').SlotStatesResult,
    excludeIds?: Set<string>
  ): void {
    suppressObjectWatchRenderCount += 1
    try {
      sceneObjectStore.applySlotState?.(slotStates, excludeIds)
    } finally {
      queueMicrotask(() => {
        suppressObjectWatchRenderCount = Math.max(0, suppressObjectWatchRenderCount - 1)
      })
    }
  }



  // ========== 4. Interaction Callback Handlers ==========

  /**
   * v20: Synchronize partial rendering from store
   * Immediately update corresponding PIXI container after writing runtimeObjects, skipping Vue watch async delay.
   * Used for instant visual feedback during interaction (drag/scale/rotate).
   */
  function syncContainerFromStore(objectId: string): void {
    const obj = sceneObjectStore.getObject(objectId)
    const container = sceneGraph.getContainer(objectId)
    if (!obj || !container || container.destroyed) return

    // Delegate to applyObjectState to uniformly handle transforms (position, scale, rotation, pivot, visibility)
    editorRenderer.applyObjectState(container, obj, obj, editorObjectStateHost)

    // v20: union child objects are inside container, transforms propagate automatically, no applyUnionProxyChain needed

    // Cache base transform (required by animation system)
    const player = sceneGraph.getGenericAnimationPlayer(objectId)
    if (player) player.cacheBaseTransform()
  }


  function handleDragMove(objectId: string, newX: number, newY: number, _deltaX: number, _deltaY: number) {
    const obj = sceneObjectStore.getObject(objectId)
    if (!obj) return

    // v20: unified data-driven drag for both modes
    sceneObjectStore.updateObject(objectId, { x: newX, y: newY })
    syncContainerFromStore(objectId)

    // v20: union child objects are inside container, drag propagates automatically, no propagateUnionDragToChildren needed
    updateSelectionBox()
  }



  async function handleDragEnd(
    objectId: string,
    finalX: number,
    finalY: number,
    startX: number,
    startY: number,
    globalPosition?: { x: number; y: number }
  ) {
    if (mode === 'action' && onActionUpdate) {
      const obj = sceneObjectStore.getObject(objectId)
      if (!obj) {
        interactionLockedObjects.delete(objectId)
        return
      }

      const distance = Math.sqrt(Math.pow(finalX - startX, 2) + Math.pow(finalY - startY, 2))

      if (distance < 5) {
        // Distance too short, don't create action
        // v19: Do not directly call applyContainerPosition to restore position.
        // For union composite children, container.position is in stage space
        // (flattened by applyUnionProxyChain), while startX/Y are parent-local coordinates.
        // Directly writing parent-local coordinates breaks correct position established by proxy chain.
        // Re-evaluate via updateActionModeObjects, ensuring all objects (including union children)
        // get correct positions through the complete applyObjectState + applyUnionProxyChain pipeline.
        interactionLockedObjects.delete(objectId)
        void updateActionModeObjects()
        return
      }

      let speed: 'auto' | 'instant' | 'slow' | 'fast' = 'auto'
      if (distance < 50) speed = 'instant'
      else if (distance < 200) speed = 'slow'
      else speed = 'fast'
      const target = obj.type === 'camera' ? 'camera' : obj.id
      try {
        const moveParams: ActionUpdatePayload['params'] = { x: finalX, y: finalY, speed }
        if (globalPosition) {
          moveParams.globalX = globalPosition.x
          moveParams.globalY = globalPosition.y
        }
        await onActionUpdate({
          type: 'move',
          target,
          params: moveParams
        })
      } finally {
        interactionLockedObjects.delete(objectId)
        void renderObjects()
      }
    } else {
      interactionLockedObjects.delete(objectId)
    }
    // Setup Mode: notify drag completed (only when movement actually occurred)
    // Note: finalX/Y come from container.position (including Math.round rounding and Transform Origin compensation),
    // in different coordinate space from startX/Y (logical coordinates from obj.x/obj.y).
    // Must compare using current obj.x/obj.y in store (same space as startX/Y).
    if (mode === 'setup' && onSetupChange) {
      const obj = sceneObjectStore.getObject(objectId)
      if (obj) {
        const distance = Math.sqrt(Math.pow(obj.x - startX, 2) + Math.pow(obj.y - startY, 2))
        if (distance >= 5) {
          onSetupChange({ type: 'transform', objectId })
        }
      }
    }
  }

  function handleResizeMove(objectId: string, newScaleX: number, newScaleY: number, newX: number, newY: number) {
    const obj = sceneObjectStore.getObject(objectId)
    if (!obj) return

    // v20: unified data-driven resize for both modes
    resizeStartState ??= { scaleX: obj.scaleX, scaleY: obj.scaleY, width: obj.width, height: obj.height }

    if (obj.type === 'camera') {
      // camera: resize = zoom change
      // Use continuous values (only clamp) during dragging to avoid stepping artifacts from 0.1 step discretization
      // Rounding to 0.1 step is performed in handleResizeEnd
      const newZoom = 1 / newScaleX
      const continuousZoom = Math.max(0.1, Math.min(10, newZoom))
      sceneObjectStore.updateObject(objectId, {
        zoom: continuousZoom,
        width: CAMERA_BASE_WIDTH / continuousZoom,
        height: CAMERA_BASE_HEIGHT / continuousZoom
      } as Partial<SceneObject> & Record<string, unknown>)
    } else if (mode === 'setup' && obj.type === 'mask' && resizeStartState) {
      const baseScaleX = resizeStartState.scaleX ?? 1
      const baseScaleY = resizeStartState.scaleY ?? 1
      const baseWidth = resizeStartState.width ?? obj.width ?? 200
      const baseHeight = resizeStartState.height ?? obj.height ?? 200
      const nextWidth = Math.max(1, Math.round(baseWidth * Math.abs(newScaleX / baseScaleX)))
      const nextHeight = Math.max(1, Math.round(baseHeight * Math.abs(newScaleY / baseScaleY)))
      sceneObjectStore.updateObject(objectId, {
        width: nextWidth,
        height: nextHeight,
        scaleX: resizeStartState.scaleX,
        scaleY: resizeStartState.scaleY,
        x: newX,
        y: newY
      })
    } else {
      sceneObjectStore.updateObject(objectId, {
        scaleX: newScaleX,
        scaleY: newScaleY,
        x: newX,
        y: newY
      })
    }
    syncContainerFromStore(objectId)

    // v20: union child objects are inside container, scaling propagates automatically
    updateSelectionBox()
  }

  async function handleResizeEnd(objectId: string) {
    if (mode === 'action' && onActionUpdate && resizeStartState) {
      const obj = sceneObjectStore.getObject(objectId)
      if (!obj) {
        resizeStartState = null
        interactionLockedObjects.delete(objectId)
        return
      }

      const finalScaleX = obj.scaleX
      const finalScaleY = obj.scaleY

      // Camera scaleX/scaleY is always 1.0 (zoom is an independent field),
      // cannot use scale delta to judge change, use zoom delta instead
      if (obj.type === 'camera') {
        const camObj = obj as CameraObject
        const currentZoom = camObj.zoom ?? 1.0
        const startZoom = 1 / resizeStartState.scaleX // resizeStartState records interaction system scale
        const zoomChange = Math.abs(currentZoom - startZoom)
        if (zoomChange < 0.01) {
          // zoom change too small, revert
          sceneObjectStore.updateObject(objectId, {
            zoom: startZoom,
            width: CAMERA_BASE_WIDTH / startZoom,
            height: CAMERA_BASE_HEIGHT / startZoom
          } as Partial<SceneObject> & Record<string, unknown>)
          syncContainerFromStore(objectId)
          resizeStartState = null
          interactionLockedObjects.delete(objectId)
          updateSelectionBox()
          return
        }
      } else {
        // Normal objects: check scale delta
        const scaleChange = Math.abs(finalScaleX - resizeStartState.scaleX) + Math.abs(finalScaleY - resizeStartState.scaleY)
        if (scaleChange < 0.01) {
          // too small, restore original via store
          sceneObjectStore.updateObject(objectId, {
            scaleX: resizeStartState.scaleX,
            scaleY: resizeStartState.scaleY
          })
          syncContainerFromStore(objectId)
          resizeStartState = null
          interactionLockedObjects.delete(objectId)
          updateSelectionBox()
          return
        }
      }

      const target = obj.type === 'camera' ? 'camera' : obj.id

      // Camera: snap zoom to 0.1 step on release (continuous values during dragging for smoothness)
      // Also calculate equivalent scaleX = 1/zoom for handleCameraActionUpdate to invert zoom
      if (obj.type === 'camera') {
        const camObj = obj as CameraObject
        const snappedZoom = Math.max(0.1, Math.min(10, Math.round(camObj.zoom * 10) / 10))
        sceneObjectStore.updateObject(objectId, {
          zoom: snappedZoom,
          width: CAMERA_BASE_WIDTH / snappedZoom,
          height: CAMERA_BASE_HEIGHT / snappedZoom
        } as Partial<SceneObject> & Record<string, unknown>)
        syncContainerFromStore(objectId)

        // Camera scaleX/scaleY is always 1.0, cannot use obj.scaleX directly
        // handleCameraActionUpdate inverts zoom via zoom = 1 / scaleX,
        // so pass scaleX = 1 / snappedZoom here to restore correctly
        const cameraEquivalentScale = 1 / snappedZoom
        try {
          await onActionUpdate({
            type: 'scale',
            target,
            params: {
              scaleX: cameraEquivalentScale,
              scaleY: cameraEquivalentScale
            }
          })
        } finally {
          resizeStartState = null
          interactionLockedObjects.delete(objectId)
          void renderObjects()
        }
      } else {
        try {
          await onActionUpdate({
            type: 'scale',
            target,
            params: {
              scaleX: finalScaleX,
              scaleY: finalScaleY,
              x: obj.x,
              y: obj.y
            }
          })
        } finally {
          resizeStartState = null
          interactionLockedObjects.delete(objectId)
          void renderObjects()
        }
      }
      return
    }
    resizeStartState = null
    interactionLockedObjects.delete(objectId)
    if (mode === 'setup' && onSetupChange) {
      onSetupChange({ type: 'transform', objectId })
    }
  }

  function handleRotateMove(objectId: string, newRotation: number) {
    const obj = sceneObjectStore.getObject(objectId)
    if (!obj) return

    // v20: unified data-driven rotate for both modes
    rotateStartState ??= { rotation: obj.rotation }

    sceneObjectStore.updateObject(objectId, { rotation: newRotation })
    syncContainerFromStore(objectId)

    // v20: union child objects are inside container, rotation propagates automatically
    updateSelectionBox()
  }

  async function handleRotateEnd(objectId: string) {
    if (mode === 'action' && onActionUpdate && rotateStartState) {
      const obj = sceneObjectStore.getObject(objectId)
      if (!obj) {
        rotateStartState = null
        interactionLockedObjects.delete(objectId)
        return
      }

      const finalRotation = obj.rotation

      // check if change is significant
      const rotationChange = Math.abs(finalRotation - rotateStartState.rotation)
      if (rotationChange < 0.01) {
        // too small, restore original via store
        sceneObjectStore.updateObject(objectId, { rotation: rotateStartState.rotation })
        syncContainerFromStore(objectId)
        rotateStartState = null
        updateSelectionBox()
        return
      }

      const target = obj.type === 'camera' ? 'camera' : obj.id

      try {
        await onActionUpdate({
          type: 'rotate',
          target,
          params: {
            rotation: finalRotation
          }
        })
      } finally {
        rotateStartState = null
        interactionLockedObjects.delete(objectId)
        void renderObjects()
      }
      return
    }
    rotateStartState = null
    interactionLockedObjects.delete(objectId)
    if (mode === 'setup' && onSetupChange) {
      onSetupChange({ type: 'transform', objectId })
    }
  }

  // ========== 5. Render Loop ==========

  async function renderObjects() {
    const createDurationByType = new Map<string, number>()
    const mountDurationByType = new Map<string, number>()
    const interactionDurationByType = new Map<string, number>()
    const updateDurationByType = new Map<string, number>()
    const createCountByType = new Map<string, number>()
    const mountCountByType = new Map<string, number>()
    const interactionCountByType = new Map<string, number>()
    const updateCountByType = new Map<string, number>()
    const addTiming = (bucket: Map<string, number>, type: string, deltaMs: number) => {
      bucket.set(type, (bucket.get(type) ?? 0) + deltaMs)
    }
    const addCount = (bucket: Map<string, number>, type: string) => {
      bucket.set(type, (bucket.get(type) ?? 0) + 1)
    }
    const ctx = pixiApp.getContext()
    if (!ctx) {
      return
    }

    if (sceneGraph.getIsRendering()) {
      sceneGraph.setPendingRender(true)
      return
    }
    sceneGraph.setIsRendering(true)

    try {
      const objects = sceneObjectStore.getSortedObjects()
      let _createdContainerCount = 0
      let _recreatedContainerCount = 0
      const contentRoot = ctx.contentLayer ?? ctx.activeLayer ?? ctx.stage

      if (!contentRoot) {
        return
      }

      ensureBlankCanvasInteractionLayer(contentRoot)

      // v7.12: Log rendering in Setup Mode
      const logBuffer: string[] = []
      if (mode === 'setup') {
        logBuffer.push('[Setup Mode Rendering]')
      }

      // v2.0.0: Pre-render loop — create all composite containers first and cache
      // Only create and cache, do not addChild. addChild is executed uniformly by main loop in objects array order,
      // ensuring PIXI children index matches data model order (determines render overlap on identical zIndex).
      for (const obj of objects) {
        if (obj.type !== 'composite') continue
        if (sceneGraph.getContainer(obj.id)) continue // Existing container

        const createStart = performance.now()
        const newContainer = await sceneGraph.createObjectContainer(obj)
        addTiming(createDurationByType, obj.type, performance.now() - createStart)
        addCount(createCountByType, obj.type)
        if (newContainer) {
          _createdContainerCount++
          sceneGraph.setContainer(obj.id, newContainer)
          // Immediately apply transform (set composite position/scale/rotation)
          void sceneGraph.updateObjectContainer(newContainer, obj)
        }
      }

      // Iterate all objects
      for (const obj of objects) {
        // Audio objects are never rendered on canvas
        if (obj.type === 'audio') continue

        // Legacy BGM support (skip rendering)
        if ((obj as unknown as { type: string }).type === 'bgm') continue

        const container = sceneGraph.getContainer(obj.id)

        // v2.0.0: Determine which parent container this object should attach to
        // Child objects with parentId attach to composite container, otherwise attach to targetLayer
        // Dual-layer architecture: parentId written to runtimeObjects by applySlotState(), read directly
        let parentContainer: PIXI.Container = contentRoot
        const effectiveParentId = obj.parentId
        if (effectiveParentId) {
          // v20: union/entity uniformly attach to container corresponding to parentId
          const parentCompositeContainer = sceneGraph.getContainer(effectiveParentId)
          if (parentCompositeContainer) {
            parentContainer = parentCompositeContainer
          }
        }

        if (!container) {
          // v9.3: In Setup mode, skip spawned=false objects (dynamic objects)
          if (mode === 'setup' && obj.type !== 'camera') {
            const spawned = (obj as unknown as { spawned?: boolean }).spawned
            if (spawned === false) {
              continue  // Skip rendering this object
            }
          }

          const createStart = performance.now()
          const newContainer = await sceneGraph.createObjectContainer(obj)
          addTiming(createDurationByType, obj.type, performance.now() - createStart)
          addCount(createCountByType, obj.type)
          if (newContainer) {
            _createdContainerCount++
            sceneGraph.setContainer(obj.id, newContainer)
            const mountStart = performance.now()
            // Ensure parentContainer is not destroyed
            if (parentContainer && !parentContainer.destroyed) {
              parentContainer.addChild(newContainer)
            } else {
              contentRoot.addChild(newContainer)
            }

            addTiming(mountDurationByType, obj.type, performance.now() - mountStart)
            addCount(mountCountByType, obj.type)

            // Setup interaction
            const interactionStart = performance.now()
            setupObjectInteraction(newContainer, obj.id)
            addTiming(interactionDurationByType, obj.type, performance.now() - interactionStart)
            addCount(interactionCountByType, obj.type)
          }
        } else {
          // P2: Defensive check — container may have been destroyed by parent composite cascade destroy({children:true})
          if (container.destroyed) {
            sceneGraph.removeContainer(obj.id)
            // Recreate container
            const createStart = performance.now()
            const newContainer = await sceneGraph.createObjectContainer(obj)
            addTiming(createDurationByType, obj.type, performance.now() - createStart)
            addCount(createCountByType, obj.type)
            if (newContainer) {
              _recreatedContainerCount++
              sceneGraph.setContainer(obj.id, newContainer)
              const mountStart = performance.now()
              if (parentContainer && !parentContainer.destroyed) {
                parentContainer.addChild(newContainer)
              } else {
                contentRoot.addChild(newContainer)
              }
              addTiming(mountDurationByType, obj.type, performance.now() - mountStart)
              addCount(mountCountByType, obj.type)
              const interactionStart = performance.now()
              setupObjectInteraction(newContainer, obj.id)
              addTiming(interactionDurationByType, obj.type, performance.now() - interactionStart)
              addCount(interactionCountByType, obj.type)
              // Pass-through list: override interaction state
              const ptEntry = sceneGraph.getPassThroughEntry(obj.id)
              if (ptEntry) {
                newContainer.eventMode = 'none'
                newContainer.interactiveChildren = false
              }
            }
            continue
          }

          // v9.3: In Setup mode, objects with existing containers also need spawned check
          if (mode === 'setup' && obj.type !== 'camera') {
            const spawned = (obj as unknown as { spawned?: boolean }).spawned
            if (spawned === false) {
              container.visible = false
              container.eventMode = 'none'
              container.interactiveChildren = false
              continue  // Skip subsequent processing
            }
          }

          // v8.8: In Action Mode, skip updateObjectContainer
          // because it uses calculateActionModeObjectState (Block final state) rather than Slot accumulated state
          // State is uniformly handled by updateActionModeObjects
          if (mode !== 'action') {
            const updateStart = performance.now()
            void sceneGraph.updateObjectContainer(container, obj).finally(() => {
              addTiming(updateDurationByType, obj.type, performance.now() - updateStart)
              addCount(updateCountByType, obj.type)
            })

            // Setup Mode Logging
            if (mode === 'setup') {
              logBuffer.push(`Rendering ${obj.id} (${obj.type}): x=${obj.x.toFixed(1)}, y=${obj.y.toFixed(1)}, scale=${obj.scaleX.toFixed(2)}`)
            }
          }

          // Update hitArea on each update as well (since texture may have just loaded)
          if (obj.type === 'camera' || obj.type === 'composite') {
            const bounds = container.getLocalBounds()
            if (bounds.width > 0 && bounds.height > 0) {
              container.hitArea = new PIXI.Rectangle(
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height
              )
            }
          }

          // Clip-Mask Phase 1: mask shape / width / height may change, sync hitArea each frame
          if (obj.type === 'mask') {
            const m = obj as import('@/types/sceneObject').MaskObject
            const w = m.width || 200
            const h = m.height || 200
            if (m.shape === 'ellipse') {
              container.hitArea = new PIXI.Ellipse(0, 0, w / 2, h / 2)
            } else {
              container.hitArea = new PIXI.Rectangle(-w / 2, -h / 2, w, h)
            }
          }

          // v2.0.0: Ensure container is in correct parent
          // Pre-cached composite container parent is null when reaching here for the first time
          // Skip when container or parent container is destroyed (deleting composite cascades destruction of child containers)
          if (!container.destroyed && parentContainer && !parentContainer.destroyed && container.parent !== parentContainer) {
            const isFirstMount = !container.parent
            const mountStart = performance.now()
            if (container.parent) container.parent.removeChild(container)
            parentContainer.addChild(container)
            addTiming(mountDurationByType, obj.type, performance.now() - mountStart)
            addCount(mountCountByType, obj.type)
            // Configure interaction on first attachment to scene (pre-cached composite not yet set)
            if (isFirstMount) {
              const interactionStart = performance.now()
              setupObjectInteraction(container, obj.id)
              addTiming(interactionDurationByType, obj.type, performance.now() - interactionStart)
              addCount(interactionCountByType, obj.type)
            }
          }
        }
      }

      // Remove deleted objects
      const objectIds = new Set(objects.map(obj => obj.id))
      const cachedIds = sceneGraph.getCachedIds()

      cachedIds.forEach(id => {
        if (!objectIds.has(id)) {
          sceneGraph.removeContainer(id)
        }
      })


      // v23: Install renderChain-driven rendering logic for root-level containers
      // Render order is entirely determined by sceneRenderChain + sortRenderChainByZIndex,
      // no longer relies on PIXI sortChildren() or setChildIndex
      installRootRenderChainRenderer(
        contentRoot,
        () => {
          const chain = sceneObjectStore.getSceneRenderChain()
          return sortRenderChainByZIndex(
            chain,
            (id) => sceneObjectStore.getObject(id)?.zIndex ?? 0
          )
        },
        (id) => sceneGraph.getContainer(id),
      )


      // v7.22: In Action Mode, reapply calculated state
      // because updateObjectContainer reads from Store (Setup data) causing state reset
      if (mode === 'action' && actionModeState) {
        // v21: Use partial apply — exclude objects currently interacting, sync rest normally
        // updateActionModeObjects guardedInteractionIds skips rendering overwrite for locked objects
        sceneGraph.updateSlotIndex(sceneGraph.getCurrentSlotIndex())
        const slotStates = sceneGraph.getGhostStates()
        if (slotStates) {
          const lockedIds = getInteractionLockedIds()
          applySlotStateSilently(slotStates, lockedIds.size > 0 ? lockedIds : undefined)
        }
        void updateActionModeObjects()
      }

      // v25: Setup Mode lighting aggregation
      aggregateLightingFilter(objects)

      // P2: Manually sort composite child objects by (zIndex, childIds)
      // sortableChildren = false -> PIXI no longer auto-sorts, completely controlled by this function
      sortCompositeContainers()

      updateSelectionBox()
    } finally {
      sceneGraph.setIsRendering(false)
      if (sceneGraph.getPendingRender()) {
        sceneGraph.setPendingRender(false)
        await renderObjects()
      }
    }
  }

  // ========== 6. Object Interaction Setup ==========

  /**
   * v6.6: Set currently selected action type
   * Used to restrict camera drag in Action mode: dragging is allowed only when camera_cut or camera_move is selected
   */
  function setSelectedActionType(actionType: string | null) {
    currentSelectedActionType = actionType
  }

  async function preloadCurrentExpressionSpeakingFrames() {
    if (mode !== 'action') return

    const expressionStore = useExpressionStore()
    const { loadAssets } = useAssetLoader()
    const imageUrls = new Set<string>()

    for (const obj of sceneObjectStore.getSortedObjects()) {
      if (obj.type !== 'expression') continue
      if ((obj as SceneObject & { spawned?: boolean }).spawned === false) continue

      const expression = expressionStore.getExpression(obj.refId)
      expression?.speakingFrames?.forEach(frame => {
        if (frame?.url) imageUrls.add(frame.url)
      })
    }

    if (imageUrls.size === 0) return
    await loadAssets(imageUrls, new Set(), 'SceneRenderer.expression.speakingWarmup')
  }

  function setIsPlaying(playing: boolean) {
    isPlaying = playing
    if (playing) {
      void preloadCurrentExpressionSpeakingFrames().finally(() => {
        void updateActionModeObjects()
      })
      return
    }
    void updateActionModeObjects()
  }

  function setupObjectInteraction(container: PIXI.Container, objectId: string) {
    if (!interaction) return

    const obj = sceneObjectStore.getObject(objectId)

    // Lock object interaction (PivotEditorPanel standalone canvas): do not bind pointer events, non-pickable,
    // transform origin handle is still available (located on selectionContainer, unaffected).
    if (lockObjectInteraction) {
      container.eventMode = 'static'
      container.cursor = 'pointer'
      container.interactiveChildren = false
      container.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation()
        if (event.button !== 0) return
        sceneObjectStore.selectObject(objectId)
        updateSelectionBox()
      })
      return
    }

    // Pass-through mode objects: set to none; normal objects: set to static and cursor
    if (sceneGraph.isPassThrough(objectId)) {
      container.eventMode = 'none'
      container.interactiveChildren = false
    } else {
      container.eventMode = 'static'
      container.cursor = 'pointer'
    }

    // Set hitArea for camera and composite objects to ensure overall bounds inside transparent regions are clickable.
    if (obj?.type === 'camera' || obj?.type === 'composite') {
      const bounds = container.getLocalBounds()
      if (bounds.width > 0 && bounds.height > 0) {
        container.hitArea = new PIXI.Rectangle(
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height
        )
      }
    }

    // Clip-Mask Phase 1: mask container has no visible children itself, must explicitly set hitArea using width/height
    // otherwise clicks inside rectangle/ellipse will not hit (PIXI defaults to children bounds for picking).
    if (obj?.type === 'mask') {
      const m = obj as import('@/types/sceneObject').MaskObject
      const w = m.width || 200
      const h = m.height || 200
      if (m.shape === 'ellipse') {
        container.hitArea = new PIXI.Ellipse(0, 0, w / 2, h / 2)
      } else {
        container.hitArea = new PIXI.Rectangle(-w / 2, -h / 2, w, h)
      }
    }

    // Setup pointer events
    container.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
      // Stop event bubbling: child object pointerdown should not propagate to composite parent
      // otherwise composite pointerdown would override child selection and dragging
      event.stopPropagation()

      // Canvas pan mode: Space key pressed or panning in progress, skip object interaction
      if (pixiApp.isSpacePressed || pixiApp.isPanning) return

      // Transform Origin handle drag guard: handle already captured event in same frame, skip object drag
      if (suppressNextObjectDrag) return

      let selectTargetId = objectId
      const clickedObj = sceneObjectStore.getObject(objectId)
      // Dual-layer architecture: parentId written to runtimeObjects by applySlotState(), read directly
      const effectiveParentId = clickedObj?.parentId
      if (effectiveParentId) {
        let currentId: string | undefined = effectiveParentId
        while (currentId) {
          const ancestor = sceneObjectStore.getObject(currentId)
          if (ancestor?.type === 'composite') {
            const comp = ancestor as unknown as { compositeLocked?: boolean }
            if (comp.compositeLocked) {
              selectTargetId = ancestor.id  // Redirect to locked ancestor
            }
          }
          currentId = ancestor?.parentId
        }
      }
      sceneObjectStore.selectObject(selectTargetId)

      // P2: Double-click detection — unlock composite
      const now = Date.now()
      const isDoubleClick = (now - lastSelectTime < DOUBLE_CLICK_THRESHOLD) && lastSelectTargetId === selectTargetId
      lastSelectTime = now
      lastSelectTargetId = selectTargetId

      if (isDoubleClick) {
        const targetObj = sceneObjectStore.getObject(selectTargetId)
        if (targetObj?.type === 'composite') {
          const comp = targetObj as import('@/types/sceneObject').CompositeObject
          if (comp.compositeLocked) {
            // Unlock composite
            if (mode === 'action') {
              sceneObjectStore.updateSetupObject(selectTargetId, { compositeLocked: false } as Partial<SceneObject>)
            } else {
              sceneObjectStore.updateObject(selectTargetId, { compositeLocked: false } as Partial<SceneObject>)
            }
            // Re-select actual clicked child object (if not clicking composite itself)
            if (selectTargetId !== objectId) {
              selectTargetId = objectId
              sceneObjectStore.selectObject(selectTargetId)
            }
          }
        }
      }

      // Ambient light only supports selection, not dragging
      if (obj?.type === 'light' && (obj as import('@/types/sceneObject').LightObject).lightType === 'ambient') {
        return
      }

      // v21: In Action mode, camera_follow cannot be dragged; allowed otherwise
      if (mode === 'action' && obj?.type === 'camera') {
        if (currentSelectedActionType === 'camera_follow') {
          // camera_follow exclusive mode, dragging not allowed
          return
        }
      }

      // P2: When compositeLocked, drag target changes to composite
      const dragTargetId = selectTargetId
      const dragContainer = dragTargetId === objectId ? container : sceneGraph.getContainer(dragTargetId)
      if (dragContainer) {
        interaction?.startDrag(dragTargetId, event, dragContainer)
      }
    })
  }

  /**
   * Update camera interaction state
   * Set whether camera is pickable based on current selection state
   */
  function updateCameraInteractivity() {
    for (const obj of sceneObjectStore.objects) {
      if (obj.type === 'camera') {
        const container = sceneGraph.getContainer(obj.id)
        if (container) {
          // Camera in pass-through list: maintain none to prevent overwriting pass-through state
          if (sceneGraph.isPassThrough(obj.id)) {
            container.eventMode = 'none'
            container.interactiveChildren = false
          } else {
            container.eventMode = 'static'
            container.cursor = 'pointer'
          }
        }
      }
    }
  }

  // ========== 7. Selection Box ==========

  function updateSelectionBox() {
    const ctx = pixiApp.getContext()
    if (!ctx?.selectionContainer) return

    // Update camera interaction state (determine pickability based on selection state)
    updateCameraInteractivity()

    // Clear existing selection box
    ctx.selectionContainer.removeChildren()

    // P2: Composite mode highlight — draw light blue translucent background for pending group objects
    if (groupingPendingIds.length > 0) {
      for (const pendingId of groupingPendingIds) {
        const pendingContainer = sceneGraph.getContainer(pendingId)
        if (!pendingContainer) continue

        const pendingBounds = pendingContainer.getBounds()
        if (pendingBounds.width <= 0 || pendingBounds.height <= 0) continue

        const highlight = new PIXI.Graphics()
        highlight.name = `grouping_highlight_${pendingId}`

        // Light blue translucent fill + blue dashed border
        highlight.beginFill(0x4da6ff, 0.2)
        highlight.lineStyle(2, 0x2196f3, 0.8)
        const pad = 4
        highlight.drawRoundedRect(
          pendingBounds.x - pad,
          pendingBounds.y - pad,
          pendingBounds.width + pad * 2,
          pendingBounds.height + pad * 2,
          6
        )
        highlight.endFill()

        ctx.selectionContainer.addChild(highlight)
      }
    }

    const drawDashedSegment = (graphics: PIXI.Graphics, x1: number, y1: number, x2: number, y2: number, dash = 8, gap = 4) => {
      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.hypot(dx, dy)
      if (len <= 0) return
      const ux = dx / len
      const uy = dy / len
      let traveled = 0
      while (traveled < len) {
        const dStart = traveled
        const dEnd = Math.min(traveled + dash, len)
        graphics.moveTo(x1 + ux * dStart, y1 + uy * dStart)
        graphics.lineTo(x1 + ux * dEnd, y1 + uy * dEnd)
        traveled = dEnd + gap
      }
    }

    const drawMaskOutline = (
      graphics: PIXI.Graphics,
      maskObj: import('@/types/sceneObject').MaskObject,
      maskContainer: PIXI.Container,
      alpha = 1,
    ) => {
      const w = maskObj.width || 1
      const h = maskObj.height || 1
      graphics.lineStyle(2, 0xffd400, alpha)

      if (maskObj.shape === 'ellipse') {
        const points: PIXI.Point[] = []
        const steps = 72
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2
          points.push(maskContainer.toGlobal(new PIXI.Point(Math.cos(a) * w / 2, Math.sin(a) * h / 2)))
        }
        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i]!
          const p2 = points[i + 1]!
          drawDashedSegment(graphics, p1.x, p1.y, p2.x, p2.y)
        }
        return
      }

      const lT = maskContainer.toGlobal(new PIXI.Point(-w / 2, -h / 2))
      const rT = maskContainer.toGlobal(new PIXI.Point(w / 2, -h / 2))
      const rB = maskContainer.toGlobal(new PIXI.Point(w / 2, h / 2))
      const lB = maskContainer.toGlobal(new PIXI.Point(-w / 2, h / 2))
      drawDashedSegment(graphics, lT.x, lT.y, rT.x, rT.y)
      drawDashedSegment(graphics, rT.x, rT.y, rB.x, rB.y)
      drawDashedSegment(graphics, rB.x, rB.y, lB.x, lB.y)
      drawDashedSegment(graphics, lB.x, lB.y, lT.x, lT.y)
    }

    const selectedId = sceneObjectStore.selectedObjectId

    // Clip-Mask Phase 1: Editor path displays yellow dashed auxiliary border for all unselected masks.
    // Drawn here on selectionContainer, not written to object container, so it does not enter ScenePlayer / FrameCapture.
    for (const sceneObj of sceneObjectStore.objects) {
      if (sceneObj.type !== 'mask') continue
      if (sceneObj.id === selectedId) continue
      if (sceneObj.visible === false || sceneObj.spawned === false) continue
      const maskContainer = sceneGraph.getContainer(sceneObj.id)
      if (!maskContainer || maskContainer.destroyed) continue
      const outline = new PIXI.Graphics()
      outline.name = `mask_outline_${sceneObj.id}`
      drawMaskOutline(outline, sceneObj as import('@/types/sceneObject').MaskObject, maskContainer, 0.9)
      ctx.selectionContainer.addChild(outline)
    }

    if (!selectedId) return

    const container = sceneGraph.getContainer(selectedId)
    if (!container || container.destroyed || !container.position) return

    const obj = sceneObjectStore.getObject(selectedId)
    if (!obj) return
    const isLight = obj.type === 'light'
    const isMask = obj.type === 'mask'

    // Create main selection box Graphics
    const box = new PIXI.Graphics()
    box.name = 'selection_box'

    // v19: union composite container is empty (children attached to upper container), merge child bounds
    const isUnionComposite = obj.type === 'composite'
      && (obj as import('@/types/sceneObject').CompositeObject).compositeMode === 'union'

    // Compute localBounds uniformly (union uses merged child bounds)
    let localBounds: PIXI.Rectangle

    if (isUnionComposite) {
      // Iterate over child OBB corners, convert to union container local coordinates
      // Avoid using getBounds() (global AABB expands on rotation causing inaccurate selection box)
      const comp = obj as import('@/types/sceneObject').CompositeObject
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const childId of comp.childIds) {
        const childContainer = sceneGraph.getContainer(childId)
        if (!childContainer || childContainer.destroyed) continue
        let childLocal: PIXI.Rectangle
        try {
          childLocal = childContainer.getLocalBounds()
        } catch {
          continue // Texture released Sprite, skip
        }
        if (childLocal.width <= 0 || childLocal.height <= 0) continue
        // Child 4 OBB corners: local -> global -> union local
        const corners = [
          new PIXI.Point(childLocal.x, childLocal.y),
          new PIXI.Point(childLocal.x + childLocal.width, childLocal.y),
          new PIXI.Point(childLocal.x + childLocal.width, childLocal.y + childLocal.height),
          new PIXI.Point(childLocal.x, childLocal.y + childLocal.height),
        ]
        for (const corner of corners) {
          const global = childContainer.toGlobal(corner)
          const local = container.toLocal(global)
          minX = Math.min(minX, local.x)
          minY = Math.min(minY, local.y)
          maxX = Math.max(maxX, local.x)
          maxY = Math.max(maxY, local.y)
        }
      }
      if (!isFinite(minX)) return
      localBounds = new PIXI.Rectangle(minX, minY, maxX - minX, maxY - minY)
    } else if (obj.type === 'light') {
      // Light sources use an enlarged fixed selection box to improve operability after picking
      localBounds = new PIXI.Rectangle(-96, -96, 192, 192)
    } else if (obj.type === 'mask') {
      // Clip-Mask Phase 1: mask container has no visible children, use mask.width x mask.height as local bounding box
      const w = (obj as unknown as { width: number }).width || 1
      const h = (obj as unknown as { height: number }).height || 1
      localBounds = new PIXI.Rectangle(-w / 2, -h / 2, w, h)
    } else {
      try {
        localBounds = container.getLocalBounds()
      } catch {
        // Defensive: getLocalBounds() crashes when container contains Sprite with released texture
        return
      }
    }

    // Get global coordinates of four corners (OBB)
    const lT = container.toGlobal(new PIXI.Point(localBounds.x, localBounds.y))
    const rT = container.toGlobal(new PIXI.Point(localBounds.x + localBounds.width, localBounds.y))
    const rB = container.toGlobal(new PIXI.Point(localBounds.x + localBounds.width, localBounds.y + localBounds.height))
    const lB = container.toGlobal(new PIXI.Point(localBounds.x, localBounds.y + localBounds.height))

    // Get global coordinates of edge midpoints
    const topMid = new PIXI.Point((lT.x + rT.x) / 2, (lT.y + rT.y) / 2)
    const rightMid = new PIXI.Point((rT.x + rB.x) / 2, (rT.y + rB.y) / 2)
    const bottomMid = new PIXI.Point((lB.x + rB.x) / 2, (lB.y + rB.y) / 2)
    const leftMid = new PIXI.Point((lT.x + lB.x) / 2, (lT.y + lB.y) / 2)

    // Draw OBB selection box border
    if (isMask) {
      // Clip-Mask Phase 1: Yellow dashed OBB
      drawMaskOutline(box, obj as import('@/types/sceneObject').MaskObject, container, 1)
    } else {
      box.lineStyle(2, 0x00aaff, 1)
      box.moveTo(lT.x, lT.y)
      box.lineTo(rT.x, rT.y)
      box.lineTo(rB.x, rB.y)
      box.lineTo(lB.x, lB.y)
      box.closePath()
    }

    ctx.selectionContainer.addChild(box)

    if (isLight) {
      return
    }

    // Create scale handles (8 directions)
    const handleSize = 12
    const edgeHandleSize = 8
    // Dynamically calculate cursor direction (using CSS cursor rotation)
    // Find closest standard orientation based on container.rotation (n, ne, e, se, s, sw, w, nw)
    const baseCursors = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
    // Resolve extreme negative angle rotation issues
    const rotationDeg = ((container.rotation * 180 / Math.PI) % 360 + 360) % 360
    // Each orientation spans 45 degrees, n corresponds to 0 or 360 degrees
    const indexOffset = Math.round(rotationDeg / 45) % 8

    const isFlippedX = getEffectiveFlipX(selectedId)

    function getRotatedCursor(baseIndex: number): string {
      let calcIndex = baseIndex
      // If horizontal flip occurred, mirror 8 orientation cursors across y-axis (n and s unchanged, e <-> w, ne <-> nw, se <-> sw)
      if (isFlippedX) {
        calcIndex = (8 - calcIndex) % 8
      }
      const idx = (calcIndex + indexOffset) % 8
      return `${baseCursors[idx]}-resize`
    }

    const handles = [
      { name: 'top-left', x: lT.x, y: lT.y, cursor: getRotatedCursor(7) },   // nw
      { name: 'top', x: topMid.x, y: topMid.y, edge: true, cursor: getRotatedCursor(0) }, // n
      { name: 'top-right', x: rT.x, y: rT.y, cursor: getRotatedCursor(1) },  // ne
      { name: 'right', x: rightMid.x, y: rightMid.y, edge: true, cursor: getRotatedCursor(2) }, // e
      { name: 'bottom-right', x: rB.x, y: rB.y, cursor: getRotatedCursor(3) }, // se
      { name: 'bottom', x: bottomMid.x, y: bottomMid.y, edge: true, cursor: getRotatedCursor(4) }, // s
      { name: 'bottom-left', x: lB.x, y: lB.y, cursor: getRotatedCursor(5) }, // sw
      { name: 'left', x: leftMid.x, y: leftMid.y, edge: true, cursor: getRotatedCursor(6) } // w
    ]

    handles.forEach(h => {
      const handle = new PIXI.Graphics()
      handle.name = `resize_handle_${h.name}`

      // Draw handle (white fill + blue border)
      handle.beginFill(0xffffff)
      handle.lineStyle(2, 0x00aaff)

      if (h.edge) {
        handle.drawRect(-edgeHandleSize / 2, -edgeHandleSize / 2, edgeHandleSize, edgeHandleSize)
      } else {
        handle.drawRect(-handleSize / 2, -handleSize / 2, handleSize, handleSize)
      }
      handle.endFill()

      // Set position
      handle.position.set(h.x, h.y)

      // Set interactive properties
      handle.eventMode = 'static'
      // Make edge handles visually follow object rotation without overwriting global coordinates
      handle.rotation = container.rotation
      handle.cursor = h.cursor

      // Bind events
      handle.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation()

        // v21: In Action mode, camera_follow cannot be scaled; allowed otherwise
        if (mode === 'action' && obj.type === 'camera') {
          if (currentSelectedActionType === 'camera_follow') {
            return
          }
        }

        if (interaction) {
          interaction.startResize(
            selectedId,
            h.name,
            event,
            // Pass true base width/height of object (localWidth unaffected by current scale)
            { width: localBounds.width, height: localBounds.height }
          )
        }
      })

      ctx.selectionContainer.addChild(handle)
    })

    // Check if camera object
    const isCamera = obj.type === 'camera'

    // Camera: render center marker
    if (isCamera) {
      const centerX = (lT.x + rB.x) / 2
      const centerY = (lT.y + rB.y) / 2
      const crossSize = 12

      const centerMark = new PIXI.Graphics()
      centerMark.name = 'camera_center'

      // Draw crosshair
      centerMark.lineStyle(2, 0xff6600, 1)
      centerMark.moveTo(centerX - crossSize, centerY)
      centerMark.lineTo(centerX + crossSize, centerY)
      centerMark.moveTo(centerX, centerY - crossSize)
      centerMark.lineTo(centerX, centerY + crossSize)

      // Draw center dot
      centerMark.beginFill(0xff6600)
      centerMark.drawCircle(centerX, centerY, 4)
      centerMark.endFill()

      ctx.selectionContainer.addChild(centerMark)
    }

    // Non-camera objects: create rotation handle (above object based on actual rotation direction)
    if (!isCamera && !isLight) {
      const rotateHandleOffset = 30
      const rotateHandleRadius = 8

      // Normal vector: bottomMid towards topMid
      const dirX = topMid.x - bottomMid.x
      const dirY = topMid.y - bottomMid.y
      const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1
      const nX = dirX / len
      const nY = dirY / len

      const rotateHandleX = topMid.x + nX * rotateHandleOffset
      const rotateHandleY = topMid.y + nY * rotateHandleOffset

      // Draw connector line
      const rotateLine = new PIXI.Graphics()
      rotateLine.name = 'rotate_line'
      rotateLine.lineStyle(2, 0x00aaff, 0.5)
      rotateLine.moveTo(topMid.x, topMid.y)
      rotateLine.lineTo(rotateHandleX, rotateHandleY)
      ctx.selectionContainer.addChild(rotateLine)

      // Create rotation handle
      const rotateHandle = new PIXI.Graphics()
      rotateHandle.name = 'rotate_handle'
      rotateHandle.beginFill(0x00aaff)
      rotateHandle.lineStyle(2, 0xffffff)
      rotateHandle.drawCircle(0, 0, rotateHandleRadius)
      rotateHandle.endFill()
      rotateHandle.position.set(rotateHandleX, rotateHandleY)
      rotateHandle.eventMode = 'static'
      rotateHandle.cursor = 'grab'

      rotateHandle.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation()
        if (interaction) {
          // Use transform origin as center of rotation (not container position)
          // Read container.pivot directly from render pipeline (includes PivotBase + originX/Y offset)
          const originGlobalPt = container.toGlobal(new PIXI.Point(container.pivot.x, container.pivot.y))
          interaction.startRotate(selectedId, event, container, new PIXI.Point(originGlobalPt.x, originGlobalPt.y))
        }
      })

      ctx.selectionContainer.addChild(rotateHandle)
    }

    // ===== Transform Origin drag handle (non-camera objects) ===== 
    if (!isCamera && !isLight) {
      // Read current transformOrigin values
      // v21: applySlotState synced transformOriginX/Y to runtimeObjects, no extra slotStates read needed
      const currentOriginX = obj.transformOriginX ?? 0
      const currentOriginY = obj.transformOriginY ?? 0

      // Compute handle global position within OBB
      // Read container.pivot directly from render pipeline (includes PivotBase + originX/Y offset)
      const originGlobal = container.toGlobal(new PIXI.Point(container.pivot.x, container.pivot.y))

      // Crosshair + ring (includes transparent hit area)
      const originHandle = new PIXI.Graphics()
      originHandle.name = 'transform_origin_handle'
      const crossSize = 10
      const circleRadius = 6
      const hitRadius = 14  // Hit area radius (larger than visible elements)

      // v26: readonlyOriginHandle used for Animation Workbench main canvas —
      // transform origin editing migrated to PivotEditorPanel; main canvas only acts as read-only gizmo.
      const handleColor = readonlyOriginHandle ? 0x888888 : 0xFF6600

      // 1. Transparent fill circle — expands hit area (keeps visual in read-only mode, but ignores events)
      originHandle.beginFill(handleColor, 0.01)
      originHandle.drawCircle(0, 0, hitRadius)
      originHandle.endFill()

      // 2. Visible crosshair
      originHandle.lineStyle(2, handleColor, 1)
      originHandle.moveTo(-crossSize, 0)
      originHandle.lineTo(crossSize, 0)
      originHandle.moveTo(0, -crossSize)
      originHandle.lineTo(0, crossSize)

      // 3. Visible ring
      originHandle.lineStyle(2, handleColor, 1)
      originHandle.drawCircle(0, 0, circleRadius)

      originHandle.position.set(originGlobal.x, originGlobal.y)
      originHandle.eventMode = readonlyOriginHandle ? 'none' : 'static'
      originHandle.cursor = readonlyOriginHandle ? 'default' : 'crosshair'

      if (readonlyOriginHandle) {
        // Read-only mode: do not bind drag logic, only display current pivot position
        ctx.selectionContainer.addChild(originHandle)
        return
      }

      // Drag state
      let isDraggingOrigin = false

      originHandle.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation()
        // Set guard: prevent object container pointerdown in same frame from starting drag
        suppressNextObjectDrag = true
        queueMicrotask(() => { suppressNextObjectDrag = false })
        isDraggingOrigin = true
        originHandle.cursor = 'grabbing'

        // Use DOM-level events to track dragging (consistent with useInteraction resize/rotate handles)
        const onWindowMove = (e: PointerEvent) => {
          if (!isDraggingOrigin) return
          // DOM coordinates -> PIXI stage coordinates
          const rect = ctx.canvasElement.getBoundingClientRect()
          const globalX = e.clientX - rect.left
          const globalY = e.clientY - rect.top
          const stagePos = ctx.app.stage.toLocal({ x: globalX, y: globalY })
          originHandle.position.set(stagePos.x, stagePos.y)
        }

        const onWindowUp = () => {
          if (!isDraggingOrigin) return
          isDraggingOrigin = false
          originHandle.cursor = 'crosshair'

          // Handle stage position -> object local coordinates -> pixel offset
          // Pipeline pivot = PivotBase + originXY
          // New pivot position after drag = localPt (in container local coordinates)
          // New originXY = localPt - PivotBase = localPt - (pivot - currentOriginXY)
          const handleGlobal = new PIXI.Point(originHandle.position.x, originHandle.position.y)
          const localPt = container.toLocal(handleGlobal)
          const pivotBaseX = container.pivot.x - currentOriginX
          const pivotBaseY = container.pivot.y - currentOriginY
          const newOriginX = localPt.x - pivotBaseX
          const newOriginY = localPt.y - pivotBaseY

          // v26: Semantic separation between setup and action
          // - setup: modifying transform origin modifies static placement at that moment, requires position compensation sync
          // - action: modifying transform origin only affects subsequent rotate/scale, do not solidify compensation into action data
          const currentObj = mode === 'action'
            ? (sceneObjectStore.getObject(selectedId) ?? obj)
            : obj

          // Submit transform origin + position compensation
          if (mode === 'setup') {
            // ===== Position compensation: (R(θ)×S - I) × Δoffset =====
            // Consistent with Adobe Animate: when moving transform origin, synchronously adjust x/y to maintain visual invariance.
            let adjustX = 0
            let adjustY = 0
            let needsCompensation = false
            {
              const rotation = currentObj.rotation ?? 0
              const flipSign = (currentObj.flipX ?? false) ? -1 : 1
              const effectiveSx = (currentObj.scaleX ?? 1) * flipSign
              const sy = currentObj.scaleY ?? 1
              const deltaOffsetX = newOriginX - currentOriginX
              const deltaOffsetY = newOriginY - currentOriginY
              const cos = Math.cos(rotation)
              const sin = Math.sin(rotation)
              adjustX = deltaOffsetX * (effectiveSx * cos - flipSign) - deltaOffsetY * sy * sin
              adjustY = deltaOffsetX * effectiveSx * sin + deltaOffsetY * (sy * cos - 1)
              needsCompensation = Math.abs(adjustX) > 0.01 || Math.abs(adjustY) > 0.01
            }

            // Setup Mode: update Store directly (when using storeOverride, isolated store is updated,
            // so PivotEditorPanel immediately reflects new position without jumping back to old values).
            const updates: Record<string, number> = {
              transformOriginX: newOriginX,
              transformOriginY: newOriginY
            }
            if (needsCompensation) {
              updates['x'] = (currentObj.x ?? 0) + adjustX
              updates['y'] = (currentObj.y ?? 0) + adjustY
            }
            sceneObjectStore.updateObject(selectedId, updates)
            // v21: Synchronize PIXI container pivot and position compensation
            // otherwise container.pivot remains old value, causing rotate/scale around incorrect reference point
            syncContainerFromStore(selectedId)
            if (onSetupChange) {
              onSetupChange({
                type: 'origin',
                objectId: selectedId,
                pivot: { x: localPt.x, y: localPt.y },
              })
            }
          } else if (mode === 'action' && onActionUpdate) {
            // Action Mode: submit via callback
            // Only record new transform origin. Visual invariance logic is compensated instantaneously at runtime by SetTransformHandler,
            // avoiding baking x/y calculated from current pose into action data.
            void onActionUpdate({
              type: 'set_origin',
              target: selectedId,
              params: {
                transformOriginX: newOriginX,
                transformOriginY: newOriginY,
              }
            })
          }

          // Clean up DOM events
          window.removeEventListener('pointermove', onWindowMove)
          window.removeEventListener('pointerup', onWindowUp)

          // Refresh selection box
          updateSelectionBox()
        }

        window.addEventListener('pointermove', onWindowMove)
        window.addEventListener('pointerup', onWindowUp)
      })

      ctx.selectionContainer.addChild(originHandle)
    }
  }

  function clearSelectionBox() {
    const ctx = pixiApp.getContext()
    if (!ctx?.selectionContainer) return
    ctx.selectionContainer.removeChildren()
  }

  // ========== 8. Action Mode Time Control ==========
  // v8.6 P1: Legacy time control functions deprecated, unified to Slot-driven

  /** @deprecated v8.6 P1: Use updateSceneStateBySlot instead */
  function setActionTime(_time: number) {
    // No-op: Legacy time-based control removed
    void updateActionModeObjects()
  }

  /** @deprecated v8.6 P1: Duration setting no longer needed */
  function setActionDuration(_duration: number) {
    // No-op: Legacy time-based control removed
  }

  // v8.6 P0: setActions deprecated, Actions read from sceneGraph.getCurrentActions()
  // Function kept for API compatibility, but internally no longer stored
  function setActions(_actions: Action[]) {
    // No-op: Actions are now read from sceneGraph.getCurrentActions()
    // This function is kept for API compatibility during migration
  }

  function setActionContext(context: SceneSetup) {
    actionModeState = context
  }

  /**
   * v20: Manually sort children of all composite containers
   * PIXI no longer auto-sorts after sortableChildren = false.
   * entity: Sort by renderChain + runtime zIndex (including expanded union children)
   * union (root-level): Extract child relative order from scene-level renderChain
   * union (inside entity): Dispatched across containers by parent entity's renderByRenderChain, no separate sort needed
   */
  function sortCompositeContainers(): void {
    const objects = sceneObjectStore.getSortedObjects()

    // v21: zIndex and renderChain have been synced to runtimeObjects by applySlotState,
    // read directly from store, slotStates no longer needed.
    const zIndexGetter = (id: string): number => {
      return sceneObjectStore.getObject(id)?.zIndex ?? 0
    }

    for (const obj of objects) {
      if (obj.type !== 'composite') continue
      const comp = obj as import('@/types/sceneObject').CompositeObject
      const compositeContainer = sceneGraph.getContainer(obj.id)
      if (!compositeContainer) continue

      const compositeMode = comp.compositeMode ?? 'entity'

      if (compositeMode === 'entity') {
        // v21: renderChain has been synced to runtimeObjects by applySlotState, read directly
        const renderChain = comp.renderChain
        if (renderChain && renderChain.length > 0) {
          // v22: Sort by runtime zIndex (consistent with renderPipeline.ts sortCompositeContainers)
          // Ensures zIndex modified by set_visual reflects in actual render order
          const sortedChain = sortRenderChainByZIndex(renderChain, zIndexGetter)
          const containerMap = new Map<string, import('pixi.js').Container>()
          for (const id of sortedChain) {
            const c = sceneGraph.getContainer(id)
            if (c) containerMap.set(id, c)
          }
          installRenderChainRenderer(compositeContainer, sortedChain, containerMap)
        }
      }
      // union composite (root-level or inside entity):
      // Render order is dispatched uniformly by parent container (stage or entity) renderByRenderChain, no separate handling needed
    }
  }

  /**
   * v8.8: Unified Action Mode object rendering function
   * Merged original updateActionModeObjects and renderGhostObjects
   * 
   * Responsibilities:
   * 1. Apply Real state to all object containers (including character expressions, poses, etc.)
   * 2. Create Ghost containers (if needed)
   */
  async function updateActionModeObjects() {
    if (mode !== 'action' || !actionModeState) return

    const objects = sceneObjectStore.getSortedObjects()
    const ctx = pixiApp.getContext()
    const contentRoot = ctx?.contentLayer ?? ctx?.activeLayer
    if (!contentRoot) return

    // v6.3: Process Animation Triggers
    applyAnimationControl()

    // Interaction guard: skip objects currently being dragged/resized/rotated to prevent async overwrite
    const activeInteractionId = interaction?.getActiveInteractionObjectId() ?? null
    const guardedInteractionIds = new Set<string>(interactionLockedObjects)
    if (activeInteractionId) guardedInteractionIds.add(activeInteractionId)
    // v8.8: Get dedicated Ghost data (used only for ghost rendering and camera ghost)
    const ghostData = sceneGraph.getGhostData()
    const slotIndex = sceneGraph.getCurrentSlotIndex()
    // v20: applySlotState moved to updateSlotIndex caller for explicit execution
    // updateActionModeObjects is now a pure render function, no longer writes to runtimeObjects
    // ensuring watch->renderObjects->updateActionModeObjects path does not overwrite interaction intermediate values with stale cache

    // P2: PIXI container re-parenting — synchronize parentId change to PIXI hierarchy
    // SetLifecycleHandler may clear/modify evaluated parentId (e.g. child bubbling after union composite dies),
    // must move PIXI container to new parent (or activeLayer), otherwise hidden due to PIXI visibility inheritance.
    // v19.2: Prioritize parentId synced by applySlotState in runtimeObjects (true runtime ownership)
    for (const obj of objects) {
      if (obj.type === 'camera' || obj.type === 'audio') continue
      const container = sceneGraph.getContainer(obj.id)
      if (!container || container.destroyed) continue

      // v21: parentId synced to runtimeObjects by applySlotState, read directly
      const effectiveParentId = obj.parentId ?? null

      let expectedParent: PIXI.Container = contentRoot
      if (effectiveParentId) {
        // v20: union/entity attach to container corresponding to parentId
        const parentContainer = sceneGraph.getContainer(effectiveParentId)
        if (parentContainer && !parentContainer.destroyed) {
          expectedParent = parentContainer
        }
      }

      if (container.parent && container.parent !== expectedParent && !expectedParent.destroyed) {
        container.parent.removeChild(container)
        expectedParent.addChild(container)
      }
    }

    // Clear stale Ghost containers
    sceneGraph.clearGhostContainers()

    // v21: slotIndex === -1 indicates uninitialized, use Fallback logic
    if (slotIndex === -1) {
      // Fallback: use legacy approach
      for (const obj of objects) {
        const container = sceneGraph.getContainer(obj.id)
        if (!container || container.destroyed) continue

        // Interaction guard: skip objects currently interacting
        if (guardedInteractionIds.has(obj.id)) continue

        // Override mode priority
        if (overrideObjectStates?.has(obj.id)) {
          await applyEditorObjectState(container, overrideObjectStates.get(obj.id)!, obj)
          continue
        }

        // Fallback: use raw object in actionModeState
        const setupObj = actionModeState?.objects?.find(o => o.id === obj.id)
        if (!setupObj) continue
        await applyEditorObjectState(container, setupObj, obj)
        // v20: union child objects are inside container, transforms propagate automatically, no applyUnionProxyChain needed
      }
      sortCompositeContainers()
      updateSelectionBox()
      return
    }

    // v8.8: Unified rendering pipeline
    for (const obj of objects) {
      const container = sceneGraph.getContainer(obj.id)
      if (!container) continue

      // Defensive: skip destroyed PIXI containers (position is null indicates destroyed)
      if (container.destroyed) continue

      // Skip audio objects
      if (obj.type === 'audio') continue

      // Interaction guard: skip objects currently being dragged/resized/rotated,
      // prevents async applyObjectState from overwriting container transforms set by handleResizeMove/handleDragMove
      // v20: Extend to union composite children, as children are flattened into upper container,
      //      managed manually by propagateUnionDragToChildren / propagateUnionTransformToChildren
      if (activeInteractionId) {
        if (guardedInteractionIds.has(obj.id)) continue
        // Check if child of union composite currently interacting
        const interactingObj = activeInteractionId ? sceneObjectStore.getObject(activeInteractionId) : null
        if (interactingObj?.type === 'composite') {
          const interactingComp = interactingObj as import('@/types/sceneObject').CompositeObject
          if (interactingComp.compositeMode === 'union' && interactingComp.childIds.includes(obj.id)) {
            continue
          }
        }
      }

      // Override mode priority
      if (overrideObjectStates?.has(obj.id)) {
        await applyEditorObjectState(container, overrideObjectStates.get(obj.id)!, obj)
        continue
      }

      // Camera override
      if (obj.type === 'camera' && overrideObjectStates?.has('camera')) {
        await applyEditorObjectState(container, overrideObjectStates.get('camera')!, obj)
        continue
      }

      // === Handle Camera ===
      if (obj.type === 'camera') {
        // v21: Camera state synced to runtimeObjects by applySlotState, read directly from obj
        const camObj = obj as import('@/stores/sceneObjectStore').CameraObject
        const actionZoom = camObj.zoom || 1.0

        // Fix: Do not use container scale, recalculate camera dimensions based on action zoom
        const actionWidth = CAMERA_BASE_WIDTH / actionZoom
        const actionHeight = CAMERA_BASE_HEIGHT / actionZoom

        // Redraw camera_border to match dimensions under action zoom
        const graphics = container.getChildByName('camera_border') as PIXI.Graphics | undefined
        if (graphics) {
          graphics.clear()
          graphics.lineStyle(20, 0x00ff00)
          graphics.beginFill(0x000000, 0.001)
          graphics.drawRect(0, 0, actionWidth, actionHeight)
          graphics.endFill()
        }

        // Update pivot to keep centered positioning
        container.pivot.set(actionWidth / 2, actionHeight / 2)

        // Camera state: direct inline assignment
        container.position.set(obj.x, obj.y)
        container.scale.set(1, 1)
        container.rotation = 0
        container.alpha = 1
        // Pass-through list: uniformly control camera visibility and interaction
        const cameraPtEntry = sceneGraph.getPassThroughEntry(obj.id)
        if (cameraPtEntry) {
          container.visible = cameraPtEntry.visible
          container.eventMode = 'none'
          container.interactiveChildren = false
        } else {
          container.visible = true
          container.eventMode = 'static'
        }
        container.zIndex = Z_INDEX_CAMERA_OVERLAY

        // Camera Ghost (read from ghost dedicated cache)
        const cameraGhost = ghostData?.camera
        if (cameraGhost) {
          const ghostCamContainer = sceneGraph.createGhostCameraContainer(
            cameraGhost,
            actionWidth,
            actionHeight
          )
          contentRoot.addChildAt(ghostCamContainer, 0)
        }
        continue
      }

      // === Handle Normal Objects ===
      // v21: spawned/visible synced to runtimeObjects by applySlotState, read directly from obj
      {
        const isAlive = obj.spawned !== false
        if (!isAlive) {
          // Object dead: hide and disable interaction
          container.visible = false
          container.eventMode = 'none'
          container.interactiveChildren = false
          continue
        } else {
          // Object active: check pass-through list
          const ptEntry = sceneGraph.getPassThroughEntry(obj.id)
          if (ptEntry) {
            container.eventMode = 'none'
            container.interactiveChildren = false
          } else {
            container.eventMode = 'static'
            container.interactiveChildren = true
          }
        }
      }

      // v18: Texture preloading on expression refId switch — must finish before applyObjectState,
      // otherwise applyExpressionState detects refId change and rebuilds sprite with empty texture
      if (obj.type === 'expression') {
        const currentRenderedRefId = (container as unknown as Record<string, string>)['_renderedRefId']
        if (currentRenderedRefId !== obj.refId) {
          const expressionStore = useExpressionStore()
          const expr = expressionStore.getExpression(obj.refId)
          if (expr) {
            const urls = new Set<string>()
            if (expr.defaultFrame?.url) urls.add(expr.defaultFrame.url)
            expr.speakingFrames?.forEach(frame => {
              if (frame?.url) urls.add(frame.url)
            })
            if (urls.size > 0) {
              const { loadAssets } = useAssetLoader()
              await loadAssets(urls, new Set(), `SceneRenderer.expression.update(${obj.id})`)
            }
          }
        }
      }

      // === Phase 4c: Uniformly delegate to applyObjectState ===
      // v21: runtimeObjects is already in real state, use obj directly
      await applyEditorObjectState(container, obj, obj)

      // Pass-through list visible overrides visible set by applyObjectState
      const ptEntryAfterApply = sceneGraph.getPassThroughEntry(obj.id)
      if (ptEntryAfterApply) {
        container.visible = ptEntryAfterApply.visible
      }


      // v20: union child objects are inside container, transforms propagate automatically, no applyUnionProxyChain needed

      // v16: Symbol material switch detection — updateObjectContainer is not called in Action Mode,
      // so detect currentMaterialId changes here and rebuild container content
      if (obj.type === 'symbol') {
        const symbolObj = obj as unknown as SymbolObject
        const targetMaterialId = symbolObj.currentMaterialId ?? symbolObj.materials?.[0]?.id
        const renderedId =
          (container as unknown as Record<string, string>)['_renderedMaterialId']
          ?? (container as unknown as Record<string, string>)['_symbolMaterialId']
        if (renderedId !== targetMaterialId) {
          const material = targetMaterialId
            ? symbolObj.materials?.find(m => m.id === targetMaterialId)
            : symbolObj.materials?.[0]
          if (material) {
            await sceneGraph.preloadEditorSymbolMaterialTextures(material)
          }
          container.removeChildren()
          const newContainer = editorRenderer.createSymbolContainer(obj)
          while (newContainer.children.length > 0) {
            container.addChild(newContainer.children[0]!)
          }
          ; (container as unknown as Record<string, string>)['_renderedMaterialId'] = targetMaterialId ?? ''
            ; (container as unknown as Record<string, string>)['_symbolMaterialId'] = targetMaterialId ?? ''
        }
      }

      // Editor specific: GenericAnimationPlayer cache base transform
      const player = sceneGraph.getGenericAnimationPlayer(obj.id)
      if (player) player.cacheBaseTransform()

      // === Create Ghost Container (if needed) ===
      // v21: Ghost data read from dedicated cache, no longer from slotStates.objects
      const ghostState = ghostData?.objects.get(obj.id) ?? null
      if (ghostState) {
        // screen_effect is a fullscreen overlay object with low ghost utility and amplifies feather sprite churn;
        // skip ghost rendering to reduce scene tree jitter and parent race conditions.
        if (obj.type === 'screen_effect') {
          continue
        }
        const ghostContainer = sceneGraph.createGhostContainer(container, obj.id)

        // Delegate to applyObjectState to uniformly handle Ghost transforms
        // Crucial: createGhostContainer cloned pivot from real container,
        // but ghost state may have different transformOriginX/Y (pre-action values).
        // Recalculate pivot and position compensation via applyObjectState to ensure ghost
        // uses its own transformOrigin rather than real container's.
        await applyEditorObjectState(ghostContainer, ghostState, obj)

        // Override alpha to translucent (applyObjectState sets ghostState.alpha)
        ghostContainer.alpha = (ghostState.alpha ?? 1) * 0.4

        // Add to scene (below Real object)
        contentRoot.addChildAt(ghostContainer, 0)
      }
    }

    // v25: Aggregate light objects, update LightingFilter
    aggregateLightingFilter(objects)
    // Phase 2: Start/stop flicker ticker on demand
    syncFlickerTicker(objects)

    // v23: Action Mode root-level order is handled by targetLayer installRootRenderChainRenderer
    // but entity composite internal renderChain still needs update via sortCompositeContainers()
    sortCompositeContainers()

    updateSelectionBox()
  }

  // ==================== v8.6 P1: Unified Render Pipeline ====================
  /**
   * P1 Unified render entry: Action Mode staged rendering
   * 
   * Decomposes render flow into 6 distinct stages with single responsibilities:
   * 1. State computation (Evaluate)
   * 2. Resource synchronization (Sync)
   * 3. Real state application (Apply)
   * 4. Ghost container update (Ghost)
   * 5. Camera update (Camera)
   * 6. Selection box update (Selection)
   * 
   * @param slotIndex Current Slot index
   */
  function renderActionModeFrame(slotIndex: number): void {
    if (mode !== 'action' || !actionModeState) return

    // ========== Phase 1: State Evaluation ==========
    // Update SceneGraph slotIndex, triggering calculateSlotStates
    sceneGraph.updateSlotIndex(slotIndex)

    // v21: Render layer now reads runtimeObjects, must write evaluation result to runtime before rendering.
    // Otherwise updateActionModeObjects reads stale runtimeObjects, staying on outdated state.
    const slotStates = sceneGraph.getGhostStates()
    if (slotStates) {
      applySlotStateSilently(slotStates)
    }

    // ========== Phase 2-5: Unified Rendering ==========
    // v8.8: Call unified rendering function, which includes:
    // - Real state application (character expressions, poses, etc.)
    // - Ghost container creation
    // - Selection box update
    void updateActionModeObjects()
  }

  // Phase 4c: getStartStateFromContext and applyStateToContainer removed
  // All rendering handled uniformly through editorRenderer.applyObjectState


  // ========== 8a. Ghost Mode Rendering (v8.0) ==========
  // NOTE: v8.8 - renderGhostObjects merged into updateActionModeObjects
  // Ghost container creation is now done in updateActionModeObjects unified render pipeline


  // ========== 9. Coordinate Conversion ==========

  function canvasToWorld(canvasX: number, canvasY: number): { x: number; y: number } {
    const ctx = pixiApp.getContext()
    if (!ctx?.viewportLayer) return { x: canvasX, y: canvasY }

    return {
      x: (canvasX - ctx.viewportLayer.x) / ctx.viewportLayer.scale.x,
      y: (canvasY - ctx.viewportLayer.y) / ctx.viewportLayer.scale.y
    }
  }

  function worldToCanvas(worldX: number, worldY: number): { x: number; y: number } {
    const ctx = pixiApp.getContext()
    if (!ctx?.viewportLayer) return { x: worldX, y: worldY }

    return {
      x: worldX * ctx.viewportLayer.scale.x + ctx.viewportLayer.x,
      y: worldY * ctx.viewportLayer.scale.y + ctx.viewportLayer.y
    }
  }

  // ========== 10. Resize Handler ==========

  function handleResize(width: number, height: number) {
    const ctx = pixiApp.getContext()
    if (ctx?.app) {
      // Record old fitScale to proportionally adjust panOffset
      const oldFitScale = pixiApp.fitScale

      ctx.app.renderer.resize(width, height)
      pixiApp.updateTransformParams()

      const newFitScale = pixiApp.fitScale

      // When fitScale changes (viewport height changes), proportionally adjust panOffset to keep center world coordinates invariant
      if (oldFitScale > 0 && Math.abs(newFitScale - oldFitScale) > 0.0001) {
        const ratio = newFitScale / oldFitScale
        const viewportWidth = width
        const viewportHeight = height
        const oldPan = pixiApp.panOffset.value
        // Proportionally scale panOffset anchored at viewport center
        pixiApp.setPanOffset(
          viewportWidth / 2 - (viewportWidth / 2 - oldPan.x) * ratio,
          viewportHeight / 2 - (viewportHeight / 2 - oldPan.y) * ratio,
        )
      } else {
        // fitScale unchanged (width only changed, e.g. sidebar toggle), only re-center horizontally
        pixiApp.centerCanvasInViewport()
      }
    }
  }

  // ========== 11. Cleanup ==========

  function destroyRenderer() {
    // Prevent duplicate destruction
    if (isDestroyed) {
      return
    }
    isDestroyed = true

    // Clip-Mask Phase 1: Clean up mask render resources (before PIXI container destruction)
    disposeMaskRendererResources(maskRendererResources)

    if (interaction) {
      interaction.unbindGlobalEvents()
      interaction = null
    }

    if (blankCanvasInteractionLayer) {
      blankCanvasInteractionLayer.removeAllListeners()
      if (blankCanvasInteractionLayer.parent) {
        blankCanvasInteractionLayer.parent.removeChild(blankCanvasInteractionLayer)
      }
      blankCanvasInteractionLayer.destroy()
      blankCanvasInteractionLayer = null
    }

    if (scenePickingInteractionLayer) {
      scenePickingInteractionLayer.removeAllListeners()
      if (scenePickingInteractionLayer.parent) {
        scenePickingInteractionLayer.parent.removeChild(scenePickingInteractionLayer)
      }
      scenePickingInteractionLayer.destroy()
      scenePickingInteractionLayer = null
    }

    sceneGraph.clearAll()

    // Phase 2: Clean up flicker ticker
    if (flickerTickerRegistered && pixiApp.app) {
      pixiApp.app.ticker.remove(flickerTickerCallback)
      flickerTickerRegistered = false
    }

    pixiApp.destroyApp()

    if (lightingFilterCache.instance) {
      lightingFilterCache.instance.destroy()
      delete lightingFilterCache.instance
    }
    if (lightingFilterCache.maskRT) {
      lightingFilterCache.maskRT.destroy(true)
      delete lightingFilterCache.maskRT
    }
  }

  // ========== 11a. Animation Control Logic (v6.3) ==========

  function applyAnimationControl() {
    const objects = sceneObjectStore.getSortedObjects()

    for (const obj of objects) {
      if (obj.type === 'prop') {
        // v7.3: effect merged into prop, retain prop animation control only
        const container = sceneGraph.getContainer(obj.id)
        if (!container) continue

        const spriteName = 'prop_animation'
        const animatedSprite = container.getChildByName(spriteName) as PIXI.AnimatedSprite | undefined
        if (!animatedSprite) continue

        // 1. Get initial state
        let currentCmd = 'play'
        const currentLoop = true
        const currentSpeed = 1.0

        // v11.0: animState removed, play animation by default
        // v7.3: effect type deleted

        // 2. Apply Actions
        // v8.6 P0/P1: Read from SceneGraph, use Slot index comparison
        const propActions = sceneGraph.getCurrentActions()
        const currentSlotIdx = sceneGraph.getCurrentSlotIndex()
        const animActions = propActions.filter(
          a => a.type === 'set_anim' && a.target === obj.id
        ) as SetAnimAction[]

        let latestSlotIndex = -1

        for (const action of animActions) {
          if (action.slotIndex <= currentSlotIdx) {
            if (action.slotIndex > latestSlotIndex) {
              latestSlotIndex = action.slotIndex
              const params = action.params

              // v11.88: Get action from first animation item (default to play if absent)
              const firstAnim = params.animations?.[0]
              if (firstAnim?.action) currentCmd = firstAnim.action
              // v11.88: speed parameter removed
            }
          }
        }

        // 3. Execution control
        if (!isPlaying && currentCmd === 'play') {
          currentCmd = 'stop'
        }

        // Get Base FPS
        let baseFps = 25
        // v7.3: effect merged into prop, keep prop logic only
        if (obj.type === 'prop') {
          const propData = propStore.getProp(obj.refId)
          if (propData?.fps) baseFps = propData.fps
        }

        animatedSprite.loop = currentLoop
        animatedSprite.animationSpeed = currentSpeed * (baseFps / 60)

        if (currentCmd === 'play') {
          if (!animatedSprite.playing) animatedSprite.play()
        } else {
          if (animatedSprite.playing) animatedSprite.gotoAndStop(0)
        }
      }
    }
  }

  // ========== 12. Watcher Setup ==========

  watch(
      () => sceneObjectStore.objects,
      () => {
        if (!autoRenderEnabled) return
        if (suppressObjectWatchRenderCount > 0) {
          return
        }
        void renderObjects()
    },
    { deep: true }
  )

  watch(
    () => sceneObjectStore.selectedObjectId,
    () => {
      updateSelectionBox()
    }
  )


  // ========== 13. Additional APIs for Component Compatibility ==========

  function updateActionModeState(state: SceneSetup | RuntimeSceneSnapshot) {
    actionModeState = state
    void updateActionModeObjects()
  }

  /** @deprecated v8.6 P1: Use updateSceneStateBySlot instead */
  function updateTime(
    _time: number,
    _duration: number,
    _actions: Action[],
    context: SceneSetup | RuntimeSceneSnapshot,
    slots: RuntimeSlot[] = []
  ) {
    // v8.6 P1: Legacy time-driven removed, converted to Slot-driven
    sceneGraph.setSlots(slots)
    actionModeState = context
    sceneGraph.updateSlotIndex(0) // Use first Slot by default
    void updateActionModeObjects()
  }

  // v7.17: New Slot-based Update Interface
  function updateSceneStateBySlot(
    slotIndex: number,
    _actions: Action[], // v8.6 P0: Deprecated, actions read from sceneGraph.getCurrentActions()
    context: SceneSetup | RuntimeSceneSnapshot,
    slots: RuntimeSlot[]
  ) {
    // v8.6 P0: Store slots in SceneGraph
    sceneGraph.setSlots(slots)
    sceneGraph.updateSlotIndex(slotIndex)
    // v20: applySlotState explicitly syncs to runtimeObjects after slot recalculation
    const slotStates = sceneGraph.getGhostStates()
    if (slotStates) {
      applySlotStateSilently(slotStates)
    }
    actionModeState = context
    void updateActionModeObjects()
  }

  // ========== 14. External Interface ==========

  function setOverrideObjectStates(states: Map<string, SceneObject> | null) {
    overrideObjectStates = states
    void updateActionModeObjects()
  }

  function setAutoRenderEnabled(enabled: boolean) {
    autoRenderEnabled = enabled
  }

  function hasInteractionLock(): boolean {
    return interactionLockedObjects.size > 0 || (interaction?.getActiveInteractionObjectId() ?? null) !== null
  }

  /**
   * v21: Get set of object IDs currently locked by interaction
   * Used for applySlotState excludeIds parameter to achieve "partial apply".
   *
   * Includes composite subtree: when dragging/scaling a composite,
   * all its childIds must also be excluded, otherwise children get overwritten by slot evaluation,
   * causing parent to hold interaction intermediate values while children are reset (mixed-state).
   */
  function getInteractionLockedIds(): Set<string> {
    const ids = new Set<string>(interactionLockedObjects)
    const activeId = interaction?.getActiveInteractionObjectId() ?? null
    if (activeId) ids.add(activeId)

    // Expand composite subtree
    if (ids.size > 0) {
      const expandCompositeChildren = (parentId: string) => {
        const obj = sceneObjectStore.getObject(parentId)
        if (obj?.type === 'composite') {
          const comp = obj as import('@/types/sceneObject').CompositeObject
          for (const childId of comp.childIds) {
            if (!ids.has(childId)) {
              ids.add(childId)
              // Recursive: child object may also be a composite
              expandCompositeChildren(childId)
            }
          }
        }
      }
      // Iterate over snapshot of currently locked IDs (avoid modifying Set during iteration)
      for (const id of [...ids]) {
        expandCompositeChildren(id)
      }
    }

    return ids
  }

  // P2: Set grouping pending object IDs, trigger highlight rendering
  function setGroupingPendingIds(ids: string[]) {
    groupingPendingIds = ids
    updateSelectionBox()
  }

  return {
    // Initialization
    initRenderer,
    destroyRenderer,

    // Rendering
    renderObjects,
    syncObjectFromStore: syncContainerFromStore,

    // Selection
    updateSelectionBox,
    clearSelectionBox,

    // Action Mode
    setActionTime,
    setActionDuration,
    setActions,
    setActionContext,
    updateActionModeObjects,
    updateActionModeState,
    updateTime,
    updateSceneStateBySlot, // v7.17: New Interface
    renderActionModeFrame, // v8.6 P1: Unified render pipeline entry
    setOverrideObjectStates, // v7.9: Set override states (Target Preview)
    setSelectedActionType, // v6.6: Set selected action type
    setIsPlaying, // v7.15: Set playback state
    setGroupingPendingIds, // P2: Set grouping pending object highlights

    setAutoRenderEnabled,
    hasInteractionLock,
    getInteractionLockedIds,

    // Coordinate conversion
    canvasToWorld,
    worldToCanvas,

    // Resize
    handleResize,

    // Delegate to pixiApp for compatibility
    scrollToCanvasCenter: () => pixiApp.centerCanvasInViewport(),
    updateTransformParams: () => pixiApp.updateTransformParams(),
    resetView: () => pixiApp.resetView(),
    fitAll: () => pixiApp.fitAll(),
    fitContent: (bbox: { x: number; y: number; width: number; height: number }) => pixiApp.fitContent(bbox),
    zoomTo100: () => pixiApp.zoomTo100(),
    setZoomLevel: (zoom: number) => pixiApp.setZoomLevel(zoom),
    setPanOffset: (x: number, y: number) => pixiApp.setPanOffset(x, y),
    get userZoom() { return pixiApp.userZoom },
    get panOffset() { return pixiApp.panOffset },
    get transformParams() { return pixiApp.transformParams },
    get mousePosition() { return pixiApp.mousePosition },
    get canvasSize() { return pixiApp.canvasSize },

    // Sub-module access (for advanced usage)
    getPixiApp: () => pixiApp,
    getSceneGraph: () => sceneGraph,
    getInteraction: () => interaction,

    // Selection & store access (for PivotEditorPanel-style programmatic selection)
    selectObject: (id: string | null) => sceneObjectStore.selectObject(id),
    getStore: () => sceneObjectStore,
  }
}
