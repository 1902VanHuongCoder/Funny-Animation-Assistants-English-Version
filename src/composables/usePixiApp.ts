/**
 * usePixiApp - PixiJS Application base setup module
 * 
 * Responsibilities:
 * 1. Manage PixiJS Application lifecycle (init/destroy)
 * 2. Handle canvas dimensions and viewport transform (scale + translation)
 * 3. Manage basic layer hierarchy (stage, viewportLayer, selectionContainer, activeLayer)
 */

import * as PIXI from 'pixi.js'
import { ref } from 'vue'

import { CANVAS_HEIGHT,CANVAS_WIDTH } from '@/constants/canvas'

export interface PixiAppOptions {
  canvasContainer: HTMLElement
  canvasWidth?: number
  canvasHeight?: number
  mode?: 'setup' | 'action'
  wheelZoomAnchor?: 'pointer' | 'viewport-center'
  /**
   * Disable viewport wheel and pan interactions: wheel no longer zooms/pans, middle click and Space+drag no longer pan.
   * Used for fixed-view panels like PivotEditorPanel, preventing objects from being scrolled or dragged out of the visible area.
   */
  disableViewportPanZoom?: boolean
}

export interface PixiAppContext {
  app: PIXI.Application
  stage: PIXI.Container
  viewportLayer: PIXI.Container
  canvasElement: HTMLCanvasElement
  selectionContainer: PIXI.Container
  safeAreaOverlay: PIXI.Graphics
  activeLayer: PIXI.Container | null
  contentLayer: PIXI.Container | null
}

// ============================================================================
// Zoom Constants
// ============================================================================

const MIN_ZOOM = 0.1    // Minimum zoom ratio (relative to fitScale)
const MAX_ZOOM = 8.0    // Maximum zoom ratio
const ZOOM_STEP = 1.1   // Zoom step per wheel tick
const PAN_SPEED = 1.0   // Wheel pan speed multiplier

export function usePixiApp(options: PixiAppOptions) {

  // Application instance
  let app: PIXI.Application | null = null
  let stage: PIXI.Container | null = null
  let viewportLayer: PIXI.Container | null = null
  let canvasElement: HTMLCanvasElement | null = null
  let selectionContainer: PIXI.Container | null = null
  let safeAreaOverlay: PIXI.Graphics | null = null
  let activeLayer: PIXI.Container | null = null
  let contentLayer: PIXI.Container | null = null
  let lightingBoundsAnchor: PIXI.Graphics | null = null

  // v25.4: Viewport transform change callbacks (notify external listeners to update lighting, etc. on pan/zoom)
  const viewportTransformCallbacks = new Set<() => void>()

  // Coordinate transform parameters
  const transformParams = ref({
    scale: 1,
    offsetX: 0,
    offsetY: 0
  })

  // Canvas dimensions
  const canvasSize = ref({
    width: options.canvasWidth ?? CANVAS_WIDTH,
    height: options.canvasHeight ?? CANVAS_HEIGHT
  })

  // Mouse position (canvas coordinates)
  const mousePosition = ref({ x: 0, y: 0 })

  // ========== Zoom and Pan State ==========

  /** Base fit scale (fill viewport height), calculated by updateTransformParams */
  let fitScale = 1

  /** User zoom factor (default 1.0 = Fit Height) */
  const userZoom = ref(1.0)

  /** User pan offset (screen pixels) */
  const panOffset = ref({ x: 0, y: 0 })

  /** Whether currently panning */
  let isPanning = false
  let panStartX = 0
  let panStartY = 0
  let panStartOffsetX = 0
  let panStartOffsetY = 0

  /** Space key pressed state (for Space+drag panning) */
  let spacePressed = false

  /**
   * Initialize PixiJS Application
   */
  async function initApp(): Promise<PixiAppContext | null> {
    if (app) {
      return getContext()
    }

    await Promise.resolve() // Ensure async behavior

    // Create PixiJS Application — renderer size equals viewport size
    app = new PIXI.Application({
      width: options.canvasContainer.clientWidth,
      height: options.canvasContainer.clientHeight,
      backgroundColor: 0x1a1a1a,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    })

    // Mount to container
    canvasElement = app.view as HTMLCanvasElement
    options.canvasContainer.appendChild(canvasElement)

    // Create root stage
    stage = new PIXI.Container()
    stage.sortableChildren = true
    stage.name = 'main_stage'
    app.stage.addChild(stage)

    // Create viewport layer (hosts scale + pan)
    viewportLayer = new PIXI.Container()
    viewportLayer.sortableChildren = true
    viewportLayer.name = 'viewport_layer'
    stage.addChild(viewportLayer)

    // Create selection box container
    selectionContainer = new PIXI.Container()
    selectionContainer.zIndex = 9999
    selectionContainer.name = 'selection_container'
    app.stage.addChild(selectionContainer)

    // Create safe area overlay
    safeAreaOverlay = new PIXI.Graphics()
    safeAreaOverlay.zIndex = 9998
    safeAreaOverlay.name = 'safe_area_overlay'
    app.stage.addChild(safeAreaOverlay)

    // v25.3: activeLayer acts as filter host layer, contentLayer holds actual scene objects
    activeLayer = new PIXI.Container()
    activeLayer.zIndex = 1
    activeLayer.sortableChildren = true
    activeLayer.name = 'active_layer'
    viewportLayer.addChild(activeLayer)

    // Fix activeLayer local bounds to cover whole canvas,
    // avoiding LightingFilter input space degrading into "current visible object bounding box".
    lightingBoundsAnchor = new PIXI.Graphics()
    lightingBoundsAnchor.name = 'lighting_bounds_anchor'
    lightingBoundsAnchor.zIndex = -9999
    lightingBoundsAnchor.eventMode = 'none'
    // Primitive with alpha=0 will not stably enter getLocalBounds(); keep extremely low opacity here
    // so activeLayer filter input space covers the entire canvas.
    lightingBoundsAnchor.beginFill(0xffffff, 0.001)
    lightingBoundsAnchor.drawRect(0, 0, canvasSize.value.width, canvasSize.value.height)
    lightingBoundsAnchor.endFill()
    activeLayer.addChild(lightingBoundsAnchor)

    contentLayer = new PIXI.Container()
    contentLayer.zIndex = 0
    contentLayer.sortableChildren = true
    contentLayer.name = 'content_layer'
    activeLayer.addChild(contentLayer)

    // Calculate coordinate transform parameters
    updateTransformParams()

    // Initial pan: horizontally center canvas in viewport
    centerCanvasInViewport()

    // Bind base events
    bindEvents()

    return getContext()
  }

  /**
   * Get application context
   */
  function getContext(): PixiAppContext | null {
    if (!app || !stage || !viewportLayer || !canvasElement || !selectionContainer || !safeAreaOverlay) {
      return null
    }
    return {
      app,
      stage,
      viewportLayer,
      canvasElement,
      selectionContainer,
      safeAreaOverlay,
      activeLayer,
      contentLayer,
    }
  }

  // ========== Viewport Transform ==========

  /**
   * Calculate effectiveScale and apply to viewportLayer
   */
  function applyTransform() {
    if (!viewportLayer || !app) return

    const effectiveScale = fitScale * userZoom.value

    viewportLayer.scale.set(effectiveScale, effectiveScale)
    viewportLayer.position.set(panOffset.value.x, panOffset.value.y)

    // Safe area overlay follows viewportLayer transform
    if (safeAreaOverlay) {
      safeAreaOverlay.scale.set(effectiveScale, effectiveScale)
      safeAreaOverlay.position.set(panOffset.value.x, panOffset.value.y)
    }

    // Selection box container remains in screen coordinate system (toGlobal returns screen coordinates)
    // No need to follow stage transform, handle sizes naturally remain constant in screen pixels

    transformParams.value = {
      scale: effectiveScale,
      offsetX: panOffset.value.x,
      offsetY: panOffset.value.y
    }

    updateSafeAreaOverlay()

    // v25.4: Notify external listeners that viewport transform updated (lighting filter needs to recompute screen coordinates)
    for (const cb of viewportTransformCallbacks) cb()
  }

  /**
   * Update coordinate transform parameters (fill viewport height)
   */
  function updateTransformParams() {
    if (!options.canvasContainer || !app) return

    const viewportWidth = options.canvasContainer.clientWidth
    const viewportHeight = options.canvasContainer.clientHeight

    // Calculate base fit scale (height fill)
    fitScale = viewportHeight / canvasSize.value.height

    // Renderer size = viewport size (no longer scales with canvas width)
    app.renderer.resize(viewportWidth, viewportHeight)

    applyTransform()
  }

  /**
   * Center canvas horizontally in viewport
   */
  function centerCanvasInViewport() {
    if (!options.canvasContainer) return

    const viewportWidth = options.canvasContainer.clientWidth
    const effectiveScale = fitScale * userZoom.value
    const canvasPixelWidth = canvasSize.value.width * effectiveScale

    // If canvas is wider than viewport, center canvas center with viewport center
    if (canvasPixelWidth > viewportWidth) {
      panOffset.value = {
        x: (viewportWidth - canvasPixelWidth) / 2,
        y: panOffset.value.y
      }
    } else {
      // If canvas is narrower than viewport, also center
      panOffset.value = {
        x: (viewportWidth - canvasPixelWidth) / 2,
        y: panOffset.value.y
      }
    }

    applyTransform()
  }

  // ========== Zoom ==========

  /**
   * Zoom anchored at specified screen coordinates
   * @param newZoom New userZoom value
   * @param anchorScreenX Anchor screen X (relative to canvas element)
   * @param anchorScreenY Anchor screen Y (relative to canvas element)
   */
  function zoomAtPoint(newZoom: number, anchorScreenX: number, anchorScreenY: number) {
    const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom))
    const oldZoom = userZoom.value
    if (Math.abs(clampedZoom - oldZoom) < 0.001) return

    userZoom.value = clampedZoom

    // Anchor formula: keep world coordinates pointed by mouse unchanged
    const ratio = clampedZoom / oldZoom
    panOffset.value = {
      x: anchorScreenX - (anchorScreenX - panOffset.value.x) * ratio,
      y: anchorScreenY - (anchorScreenY - panOffset.value.y) * ratio,
    }

    applyTransform()
  }

  /**
   * Set zoom level (anchored at viewport center)
   * Used by toolbar +/- buttons and preset lists
   */
  function setZoomLevel(newZoom: number) {
    if (!options.canvasContainer) return
    const viewportWidth = options.canvasContainer.clientWidth
    const viewportHeight = options.canvasContainer.clientHeight
    zoomAtPoint(newZoom, viewportWidth / 2, viewportHeight / 2)
  }

  /**
   * Directly set pan offset (called by scrollbar component)
   */
  function setPanOffset(x: number, y: number) {
    panOffset.value = { x, y }
    applyTransform()
  }

  /**
   * Reset view to default Fit Height + horizontal center
   */
  function resetView() {
    userZoom.value = 1.0
    panOffset.value = { x: 0, y: 0 }
    updateTransformParams()
    centerCanvasInViewport()
  }

  /**
   * Fit All: zoom so entire canvas is completely visible in viewport
   */
  function fitAll() {
    if (!options.canvasContainer) return

    const viewportWidth = options.canvasContainer.clientWidth
    const viewportHeight = options.canvasContainer.clientHeight

    const scaleX = viewportWidth / canvasSize.value.width
    const scaleY = viewportHeight / canvasSize.value.height
    const targetFitScale = Math.min(scaleX, scaleY)

    // userZoom = targetFitScale / fitScale
    userZoom.value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetFitScale / fitScale))

    // Center
    const effectiveScale = fitScale * userZoom.value
    const canvasPixelWidth = canvasSize.value.width * effectiveScale
    const canvasPixelHeight = canvasSize.value.height * effectiveScale
    panOffset.value = {
      x: (viewportWidth - canvasPixelWidth) / 2,
      y: (viewportHeight - canvasPixelHeight) / 2,
    }

    applyTransform()
  }

  /**
   * Fit Content: zoom so given bounding box is completely visible in viewport (leaves 15% padding)
   * @param bbox Bounding box (world coordinates)
   */
  function fitContent(bbox: { x: number; y: number; width: number; height: number }) {
    if (!options.canvasContainer || bbox.width <= 0 || bbox.height <= 0) return

    const viewportWidth = options.canvasContainer.clientWidth
    const viewportHeight = options.canvasContainer.clientHeight
    const padding = 0.85 // Leave 15% padding

    const scaleX = (viewportWidth * padding) / bbox.width
    const scaleY = (viewportHeight * padding) / bbox.height
    const targetEffectiveScale = Math.min(scaleX, scaleY)

    userZoom.value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetEffectiveScale / fitScale))

    // Align bounding box center to viewport center
    const effectiveScale = fitScale * userZoom.value
    const bboxCenterX = (bbox.x + bbox.width / 2) * effectiveScale
    const bboxCenterY = (bbox.y + bbox.height / 2) * effectiveScale
    panOffset.value = {
      x: viewportWidth / 2 - bboxCenterX,
      y: viewportHeight / 2 - bboxCenterY,
    }

    applyTransform()
  }

  /**
   * 100% View: 1:1 pixel display, canvas center aligned to viewport center
   */
  function zoomTo100() {
    if (!options.canvasContainer) return

    const viewportWidth = options.canvasContainer.clientWidth
    const viewportHeight = options.canvasContainer.clientHeight

    // fitScale * userZoom = 1.0 → userZoom = 1 / fitScale
    userZoom.value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, 1.0 / fitScale))

    // Center canvas center to viewport center
    const effectiveScale = fitScale * userZoom.value
    const canvasPixelWidth = canvasSize.value.width * effectiveScale
    const canvasPixelHeight = canvasSize.value.height * effectiveScale
    panOffset.value = {
      x: (viewportWidth - canvasPixelWidth) / 2,
      y: (viewportHeight - canvasPixelHeight) / 2,
    }

    applyTransform()
  }

  // ========== Safe Area Overlay ==========

  /**
   * Update safe area overlay
   * Safe area overlay follows stage transform (scale + position),
   * so drawing coordinates use world coordinate space (consistent with stage)
   */
  function updateSafeAreaOverlay() {
    if (!safeAreaOverlay || !app) return

    safeAreaOverlay.clear()

    const effectiveScale = fitScale * userZoom.value
    if (effectiveScale <= 0) return

    // Visible area (world coordinates)
    const viewportWidth = options.canvasContainer.clientWidth / effectiveScale
    const viewportHeight = options.canvasContainer.clientHeight / effectiveScale
    const viewOriginX = -panOffset.value.x / effectiveScale
    const viewOriginY = -panOffset.value.y / effectiveScale

    // Fill entire visible area with semi-transparent black
    safeAreaOverlay.beginFill(0x000000, 0.3)
    const padding = 10000
    safeAreaOverlay.drawRect(
      viewOriginX - padding,
      viewOriginY - padding,
      viewportWidth + padding * 2,
      viewportHeight + padding * 2
    )

    // Cut out center safe area
    safeAreaOverlay.beginHole()
    safeAreaOverlay.drawRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    safeAreaOverlay.endHole()
    safeAreaOverlay.endFill()

    // Draw safe area green border
    safeAreaOverlay.lineStyle(4 / effectiveScale, 0x00ff00, 0.5)
    safeAreaOverlay.drawRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  }

  // ========== Event Handling ==========

  /**
   * Handle wheel events
   */
  function handleWheel(e: WheelEvent) {
    if (options.disableViewportPanZoom) {
      e.preventDefault()
      return
    }

    // Ctrl/Meta + wheel: zoom
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const factor = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const useViewportCenter = options.wheelZoomAnchor === 'viewport-center'
      const offsetX = useViewportCenter
        ? options.canvasContainer.clientWidth / 2
        : e.clientX - rect.left
      const offsetY = useViewportCenter
        ? options.canvasContainer.clientHeight / 2
        : e.clientY - rect.top
      zoomAtPoint(userZoom.value * factor, offsetX, offsetY)
    } else if (e.shiftKey) {
      // Shift + wheel: horizontal pan
      e.preventDefault()
      panOffset.value = {
        x: panOffset.value.x - e.deltaY * PAN_SPEED,
        y: panOffset.value.y
      }
      applyTransform()
    } else {
      // Wheel: vertical pan
      e.preventDefault()
      panOffset.value = {
        x: panOffset.value.x,
        y: panOffset.value.y - e.deltaY * PAN_SPEED
      }
      applyTransform()
    }
  }

  /**
   * Pointer down: detect middle click drag / Space+drag
   */
  function handlePointerDownForPan(e: PointerEvent) {
    if (options.disableViewportPanZoom) {
      if (e.button === 1 || (spacePressed && e.button === 0)) {
        e.preventDefault()
      }
      return
    }

    if (e.button === 1 || (spacePressed && e.button === 0)) {
      e.preventDefault()
      isPanning = true
      panStartX = e.clientX
      panStartY = e.clientY
      panStartOffsetX = panOffset.value.x
      panStartOffsetY = panOffset.value.y

      // Set cursor
      if (canvasElement) {
        canvasElement.style.cursor = 'grabbing'
      }
    }
  }

  /**
   * Pointer move: pan drag
   */
  function handlePointerMoveForPan(e: PointerEvent) {
    if (!isPanning) return

    panOffset.value = {
      x: panStartOffsetX + (e.clientX - panStartX),
      y: panStartOffsetY + (e.clientY - panStartY),
    }
    applyTransform()
  }

  /**
   * Pointer up: end pan
   */
  function handlePointerUpForPan(_e: PointerEvent) {
    if (isPanning) {
      isPanning = false
      // Restore cursor
      if (canvasElement) {
        canvasElement.style.cursor = spacePressed ? 'grab' : ''
      }
    }
  }

  /**
   * Key down: Space key
   */
  function handleKeyDown(e: KeyboardEvent) {
    // Ctrl+0: Fit All
    if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.code === 'Digit0')) {
      e.preventDefault()
      if (options.disableViewportPanZoom) return
      fitAll()
      return
    }

    // Ctrl+1: 100% view
    if ((e.ctrlKey || e.metaKey) && (e.key === '1' || e.code === 'Digit1')) {
      e.preventDefault()
      if (options.disableViewportPanZoom) return
      zoomTo100()
      return
    }

    if (e.code === 'Space' && !e.repeat) {
      // Only activate pan mode when focus is not in input/textarea/select
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      e.preventDefault()
      if (options.disableViewportPanZoom) return
      spacePressed = true
      if (canvasElement && !isPanning) {
        canvasElement.style.cursor = 'grab'
      }
    }
  }

  /**
   * Key up: Space key
   */
  function handleKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') {
      spacePressed = false
      if (canvasElement && !isPanning) {
        canvasElement.style.cursor = ''
      }
    }
  }

  /**
   * Canvas mouse move event (update world coordinates)
   */
  function handleCanvasPointerMove(event: PointerEvent) {
    if (!viewportLayer || !canvasElement) return

    // Pan drag handling
    handlePointerMoveForPan(event)

    const rect = canvasElement.getBoundingClientRect()
    const globalX = event.clientX - rect.left
    const globalY = event.clientY - rect.top
    const globalPos = { x: globalX, y: globalY }
    const localPos = viewportLayer.toLocal(globalPos)

    mousePosition.value = {
      x: Math.round(localPos.x),
      y: Math.round(localPos.y)
    }
  }

  // ========== Event Binding ==========

  /**
   * Bind base events
   */
  function bindEvents() {
    if (!canvasElement || !stage) return

    const container = options.canvasContainer

    // Mouse move event (update mouse position + pan)
    canvasElement.addEventListener('pointermove', handleCanvasPointerMove as EventListener)

    // Wheel event (zoom / pan)
    container.addEventListener('wheel', handleWheel, { passive: false })

    // Middle click / Space+left click pan
    canvasElement.addEventListener('pointerdown', handlePointerDownForPan as EventListener)
    window.addEventListener('pointerup', handlePointerUpForPan as EventListener)

    // Space key
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    // Prevent default middle click scroll behavior
    canvasElement.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    })
  }

  /**
   * Unbind events
   */
  function unbindEvents() {
    if (!canvasElement) return

    const container = options.canvasContainer

    canvasElement.removeEventListener('pointermove', handleCanvasPointerMove as EventListener)
    container.removeEventListener('wheel', handleWheel)
    canvasElement.removeEventListener('pointerdown', handlePointerDownForPan as EventListener)
    window.removeEventListener('pointerup', handlePointerUpForPan as EventListener)
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('keyup', handleKeyUp)
  }

  /**
   * Destroy PixiJS Application
   */
  function destroyApp() {
    unbindEvents()

    if (safeAreaOverlay) {
      safeAreaOverlay.destroy()
      safeAreaOverlay = null
    }

    if (lightingBoundsAnchor) {
      lightingBoundsAnchor.destroy()
      lightingBoundsAnchor = null
    }

    if (app) {
      // v8.8 Fix: Do not destroy shared texture cache (texture)
      // Only destroy Container and Sprite created by this component, keeping global texture cache for other components
      app.destroy(true, { children: true, texture: false })
      app = null
    }

    stage = null
    viewportLayer = null
    selectionContainer = null
    activeLayer = null
    contentLayer = null
    canvasElement = null

  }


  return {
    // Lifecycle
    initApp,
    destroyApp,
    getContext,

    // Viewport control
    updateTransformParams,
    resetView,
    fitAll,
    fitContent,
    zoomTo100,
    setZoomLevel,
    setPanOffset,
    zoomAtPoint,
    centerCanvasInViewport,

    // Zoom and pan state
    userZoom,
    panOffset,
    get fitScale() { return fitScale },

    // State
    canvasSize,
    mousePosition,
    transformParams,

    // Pan state query (for interaction module to determine whether to suppress object dragging)
    get isSpacePressed() { return spacePressed },
    get isPanning() { return isPanning },

    // Internal references (for other modules)
    get app() { return app },
    get stage() { return stage },
    get viewportLayer() { return viewportLayer },
    get canvasElement() { return canvasElement },
    get selectionContainer() { return selectionContainer },
    get activeLayer() { return activeLayer },

    // v25.4: Viewport transform change callbacks
    onViewportTransformChanged(cb: () => void) { viewportTransformCallbacks.add(cb) },
    offViewportTransformChanged(cb: () => void) { viewportTransformCallbacks.delete(cb) },
  }
}
