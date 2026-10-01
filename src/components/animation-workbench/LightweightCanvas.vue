<!--
  LightweightCanvas.vue — Animation editing standalone canvas (v2: reuses useSceneRenderer pipeline)
  
  Uses useSceneRenderer + AnimationSceneObjectStore for complete data isolation,
  rendering, picking, and dragging logic completely match scene editing setup mode.
-->
<template>
  <div
    ref="containerRef"
    class="lightweight-canvas"
  >
    <CanvasScrollbars
      v-if="rendererReady && renderer && !props.disableViewportPanZoom"
      :canvas-width="rendererCanvasSize.width"
      :canvas-height="rendererCanvasSize.height"
      :viewport-width="viewportSize.width"
      :viewport-height="viewportSize.height"
      :effective-scale="rendererTransform.scale"
      :pan-x="rendererPanOffset.x"
      :pan-y="rendererPanOffset.y"
      @pan-change="(x: number, y: number) => renderer?.setPanOffset(x, y)"
    />
  </div>
</template>

<script setup lang="ts">
import * as PIXI from 'pixi.js'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'

import CanvasScrollbars from '@/components/CanvasScrollbars.vue'
import { type SetupChangePayload, useSceneRenderer } from '@/composables/useSceneRenderer'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/constants/canvas'
import { type AnimationSceneObjectRuntimeStore,createAnimationSceneObjectStore } from '@/stores/AnimationSceneObjectStore'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { CompositeObject, SceneObject } from '@/types/sceneObject'
import type { WorkbenchPreviewStore } from '@/types/WorkbenchPreviewStore'

// ===== Props & Emits =====

export interface LightweightCanvasProps {
  /** Object type */
  resourceType: 'prop' | 'background' | 'symbol' | 'composite' | 'expression'
  /** Asset reference ID */
  resourceId: string
  /** Scene object ID (scene-level entry) */
  sceneObjectId?: string | undefined
  /** composite child object target ID (when editing sub-part transform) */
  targetObjectId?: string | undefined
  /** Pivot handle mode: 'editable' (default) or 'readonly' (grey read-only gizmo) */
  originHandleMode?: 'editable' | 'readonly'
  /**
   * Initial zoom mode:
   *   'zoom-100' (default) — 1:1 pixel display, suitable for main workbench canvas;
   *   'fit-content' — Adaptive zoom based on object bounding box, suitable for small panels (e.g. PivotEditorPanel).
   */
  fitMode?: 'zoom-100' | 'fit-content'
  /**
   * Lock object interaction: dragging/scaling/rotating object itself forbidden.
   * Pivot handle remains usable. Primarily used for PivotEditorPanel.
   */
  lockObjectInteraction?: boolean
  /**
   * Disable viewport pan/zoom: wheel, middle-click/Space drag no longer trigger movement or zoom.
   * Used for fixed view panels to prevent object from scrolling or dragging out of view.
   */
  disableViewportPanZoom?: boolean
}

const props = defineProps<LightweightCanvasProps>()

const emit = defineEmits<{
  'container-ready': [payload: {
    container: PIXI.Container
    partContainers?: Map<string, PIXI.Container>
    objectBounds: { width: number; height: number }
  }]
  'canvas-app-ready': [app: PIXI.Application]
  /** Triggered after drag/scale/rotate on canvas ends */
  'setup-change': [payload: SetupChangePayload]
}>()

// ===== Refs =====

const containerRef = ref<HTMLElement | null>(null)
const rendererReady = ref(false)
const viewportSize = ref({ width: 1, height: 1 })
const rendererCanvasSize = computed(() => {
  void rendererReady.value
  return renderer?.canvasSize.value ?? { width: CANVAS_WIDTH, height: CANVAS_HEIGHT }
})
const rendererTransform = computed(() => {
  void rendererReady.value
  return renderer?.transformParams.value ?? { scale: 1, offsetX: 0, offsetY: 0 }
})
const rendererPanOffset = computed(() => {
  void rendererReady.value
  return renderer?.panOffset.value ?? { x: 0, y: 0 }
})

// Resolved containers from sceneGraph after rendering
const targetContainer = shallowRef<PIXI.Container | null>(null)
const partContainers = shallowRef<Map<string, PIXI.Container> | null>(null)

// Renderer instance & isolated store
let renderer: ReturnType<typeof useSceneRenderer> | null = null
let baseStoreRef: AnimationSceneObjectRuntimeStore | null = null
let runtimeStoreRef: AnimationSceneObjectRuntimeStore | null = null
let currentRootObjectId: string | null = null
let resizeObserver: ResizeObserver | null = null

// ===== Lifecycle =====

onMounted(async () => {
  await nextTick()
  await initCanvas()
})

// When prop changes (e.g. track switch causes targetObjectId change, or scene object switch),
// destroy current renderer and reinitialize — safest way to keep canvas + isolated store + selection consistent.
watch(
  () => [
    props.resourceType,
    props.resourceId,
    props.sceneObjectId ?? '',
    props.targetObjectId ?? '',
  ],
  async (next, prev) => {
    if (!prev) return
    if (next.join('|') === prev.join('|')) return
    destroyCanvas()
    await nextTick()
    await initCanvas()
  },
)

onBeforeUnmount(() => {
  destroyCanvas()
})

// ===== Canvas Init/Destroy =====

async function initCanvas() {
  const el = containerRef.value
  if (!el) return

  // 1. Create isolated store (deep copy target object from global store, or construct composite)
  const globalStore = useSceneObjectStore()

  let rootObjectId = resolveRootObjectId(globalStore)
  let prebuiltObjects: SceneObject[] | undefined

  if (!rootObjectId) {
    // Resource-level preview: no instance in current scene, construct composite object
    const syntheticId = `__anim_preview_${Date.now()}__`
    rootObjectId = syntheticId
    prebuiltObjects = [{
      id: syntheticId,
      type: props.resourceType as SceneObject['type'],
      refId: props.resourceId,
      name: 'preview',
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      zIndex: 0,
      width: 0,
      height: 0,
      visible: true,
    } as SceneObject]
  }

  currentRootObjectId = rootObjectId

  const baseStore = createAnimationSceneObjectStore({
    rootObjectId,
    globalStore,
    ...(prebuiltObjects ? { prebuiltObjects } : {}),
  })
  const runtimeStore = createAnimationSceneObjectStore({
    rootObjectId,
    globalStore: baseStore,
    prebuiltObjects: baseStore.cloneObjects(),
    prebuiltRenderChain: baseStore.getSceneRenderChain(),
  })
  baseStoreRef = baseStore
  runtimeStoreRef = runtimeStore

  // 2. Create useSceneRenderer, inject isolated store
  renderer = useSceneRenderer({
    canvasContainer: el,
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    mode: 'setup',
    storeOverride: runtimeStore,
    wheelZoomAnchor: 'pointer',
    readonlyOriginHandle: props.originHandleMode === 'readonly',
    lockObjectInteraction: props.lockObjectInteraction === true,
    disableViewportPanZoom: props.disableViewportPanZoom === true,
    onSetupChange: (change) => {
      // After canvas drag/scale/rotate ends, notify parent to write transform to keyframe
      emit('setup-change', change)
    },
  })

  // 3. Initialize renderer
  await renderer.initRenderer()
  rendererReady.value = true
  observeCanvasSize(el)

  const pixiApp = renderer.getPixiApp()
  const app = pixiApp.app
  if (!app) {
    console.error('[LightweightCanvas] PixiJS init failed')
    return
  }

  // 4. Hide safe area overlay (not needed for animation editing)
  const safeAreaOverlay = pixiApp.getContext()?.safeAreaOverlay
  if (safeAreaOverlay) {
    safeAreaOverlay.visible = false
  }

  // 5. Disable auto rendering (enable after renderObjects completes)
  renderer.setAutoRenderEnabled(false)

  // 6. Render objects
  await renderer.renderObjects()

  // 7. Resume auto rendering
  renderer.setAutoRenderEnabled(true)

  emit('canvas-app-ready', app)

  // 8. Resolve container and emit container-ready event
  resolveContainersAndEmit()

  // 9. Default zoom: fit-content adapts to object bounding box; zoom-100 is 1:1 pixel
  if (props.fitMode === 'fit-content') {
    // Must wait one tick for PIXI to finish initial render, otherwise getLocalBounds might return empty.
    // Refer to ObjectCollectionPreviewDialog fitContent flow: use contentLayer's
    // local bounds as fit target (world coordinates, unscaled by stage),
    // more stable than rootContainer.getBounds which is not yet in stage transform chain.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    const pixiCtx = pixiApp.getContext()
    const contentLayer = pixiCtx?.contentLayer
    const bounds = contentLayer?.getLocalBounds()
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      renderer.fitContent({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      })
    } else {
      renderer.fitAll()
    }
  } else {
    renderer.zoomTo100()
    renderer.scrollToCanvasCenter()
  }

  // 10. Auto select target (pivot edit panel depends on selection to render pivot handle):
  //   - Has targetObjectId (composite sub-part) -> select sub-part
  //   - Otherwise select root object
  // Note: lockObjectInteraction disables container pointer events, so must select actively via API.
  const selectId = props.targetObjectId ?? rootObjectId
  if (selectId) {
    renderer.selectObject(selectId)
  }
}

function destroyCanvas() {
  resizeObserver?.disconnect()
  resizeObserver = null
  rendererReady.value = false
  if (renderer) {
    renderer.destroyRenderer()
    renderer = null
  }
  baseStoreRef = null
  runtimeStoreRef = null
  currentRootObjectId = null
}

function observeCanvasSize(el: HTMLElement) {
  resizeObserver?.disconnect()
  resizeObserver = new ResizeObserver(() => {
    viewportSize.value = {
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
    }
    if (!renderer) return
    const width = viewportSize.value.width
    const height = viewportSize.value.height
    renderer.handleResize(width, height)
    renderer.updateSelectionBox()
    // Force PIXI to redraw current frame, preventing scene objects from disappearing after sidebar toggle
    renderer.getPixiApp().app?.render()
  })
  viewportSize.value = {
    width: Math.max(1, el.clientWidth),
    height: Math.max(1, el.clientHeight),
  }
  resizeObserver.observe(el)
}

// ===== Object ID Resolution =====

/**
 * Resolve root object ID to render from props.
 * Scene-level entry uses sceneObjectId, otherwise searches matching resourceId.
 */
function resolveRootObjectId(globalStore: ReturnType<typeof useSceneObjectStore>): string | null {
  if (props.sceneObjectId) {
    return props.sceneObjectId
  }

  // Find object with matching refId in store
  const obj = globalStore.objects.find(
    o => o.refId === props.resourceId && o.type === props.resourceType,
  )
  return obj?.id ?? null
}

// ===== Container Resolution =====

/**
 * After render completes, get containers from sceneGraph, construct partContainers map,
 * then emit container-ready event.
 */
function resolveContainersAndEmit() {
  if (!renderer || !runtimeStoreRef || !currentRootObjectId) return

  const sceneGraph = renderer.getSceneGraph()
  const rootId = currentRootObjectId

  const rootContainer = sceneGraph.getContainer(rootId)
  if (!rootContainer) {
    console.warn('[LightweightCanvas] Root container not found in sceneGraph:', rootId)
    return
  }

  // Collect composite child object containers (read from isolated store)
  const rootObj = runtimeStoreRef.getObject(rootId)
  const parts = new Map<string, PIXI.Container>()

  if (rootObj?.type === 'composite') {
    collectPartContainers(rootObj as CompositeObject, sceneGraph, runtimeStoreRef, parts)
  }

  targetContainer.value = rootContainer
  partContainers.value = parts.size > 0 ? parts : null

  // Calculate bounding box
  const bounds = rootContainer.getLocalBounds()

  emit('container-ready', {
    container: rootContainer,
    ...(parts.size > 0 ? { partContainers: parts } : {}),
    objectBounds: {
      width: bounds.width || 200,
      height: bounds.height || 200,
    },
  })
}

/**
 * Recursively collect all child object containers of composite
 */
function collectPartContainers(
  compositeObj: CompositeObject,
  sceneGraph: ReturnType<ReturnType<typeof useSceneRenderer>['getSceneGraph']>,
  store: { getObject(id: string): SceneObject | undefined },
  parts: Map<string, PIXI.Container>,
) {
  const childIds = compositeObj.childIds ?? []
  for (const childId of childIds) {
    const childContainer = sceneGraph.getContainer(childId)
    if (childContainer) {
      parts.set(childId, childContainer)
    }

    const childObj = store.getObject(childId)
    if (childObj?.type === 'composite') {
      collectPartContainers(childObj as CompositeObject, sceneGraph, store, parts)
    }
  }
}

// ===== Viewport =====

function fitToObject() {
  if (!renderer || !currentRootObjectId) return

  const container = renderer.getSceneGraph().getContainer(currentRootObjectId)
  if (!container) return

  const el = containerRef.value
  if (!el) return

  const bounds = container.getLocalBounds()
  if (bounds.width <= 0 || bounds.height <= 0) return

  const padding = 80
  const scaleX = (el.clientWidth - padding * 2) / bounds.width
  const scaleY = (el.clientHeight - padding * 2) / bounds.height
  const fitZoom = Math.min(scaleX, scaleY, 2)

  renderer.setZoomLevel(fitZoom)
  renderer.scrollToCanvasCenter()
}

// ===== Expose =====

defineExpose({
  get app() { return renderer?.getPixiApp().app ?? null },
  get contentLayer() { return renderer?.getPixiApp().getContext()?.contentLayer ?? null },
  targetContainer,
  partContainers,
  fitToObject,
  /** Get underlying renderer instance */
  get renderer() { return renderer },
  /** Get isolated sceneGraph */
  get sceneGraph() { return renderer?.getSceneGraph() ?? null },
  /**
   * Get preview store (narrow interface).
   * This getter exposes only 5 capabilities defined in WorkbenchPreviewStore; underlying is still
   * reactive instance returned by AnimationSceneObjectStore, so objects / selectedObjectId
   * can be accessed directly in computed as reactive fields.
   */
  get previewStore(): WorkbenchPreviewStore | null { return runtimeStoreRef as WorkbenchPreviewStore | null },
  get baseStore(): WorkbenchPreviewStore | null { return baseStoreRef as WorkbenchPreviewStore | null },
  resetRuntimeFromBase() {
    if (!baseStoreRef || !runtimeStoreRef) return
    runtimeStoreRef.replaceObjects(baseStoreRef.cloneObjects(), baseStoreRef.getSceneRenderChain())
  },
})
</script>

<style scoped>
.lightweight-canvas {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  cursor: default;
  background: #e8eaee;
}

.lightweight-canvas canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>
