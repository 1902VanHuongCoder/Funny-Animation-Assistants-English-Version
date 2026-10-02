/**
 * useInteraction - Interaction logic module
 * 
 * Responsibilities:
 * 1. Handle drag logic (handleDrag)
 * 2. Handle resize logic (handleResize)
 * 3. Handle rotate logic (handleRotate)
 * 4. Manage interaction states (isDragging, isResizing, isRotating)
 * 
 * Decoupling points:
 * - Receive mouse events, compute delta (dx, dy)
 * - Emit results through callbacks instead of directly modifying data
 */

import * as PIXI from 'pixi.js'

import type { SceneObject } from '@/stores/sceneObjectStore'

export function normalizeAngleDelta(deltaAngle: number): number {
  const fullTurn = Math.PI * 2
  while (deltaAngle > Math.PI) deltaAngle -= fullTurn
  while (deltaAngle < -Math.PI) deltaAngle += fullTurn
  return deltaAngle
}

export function accumulateRotationDelta(
  previousAngle: number,
  currentAngle: number,
  accumulatedDelta: number
): { currentAngle: number; accumulatedDelta: number } {
  return {
    currentAngle,
    accumulatedDelta: accumulatedDelta + normalizeAngleDelta(currentAngle - previousAngle)
  }
}

export interface DragState {
  objectId: string
  startMouseX: number
  startMouseY: number
  startMouseParentX: number
  startMouseParentY: number
  startObjectX: number
  startObjectY: number
  startObjectGlobalX: number
  startObjectGlobalY: number
}

export interface ResizeState {
  objectId: string
  corner: string
  startMouseX: number
  startMouseY: number
  startObjectX: number
  startObjectY: number
  startScaleX: number
  startScaleY: number
  startWidth: number
  startHeight: number
  startRotation: number
  originalAspect: number
}

export interface RotateState {
  objectId: string
  centerX: number
  centerY: number
  startAngle: number
  lastAngle: number
  accumulatedDelta: number
  startRotation: number
}

export interface InteractionCallbacks {
  onDragMove?: (objectId: string, newX: number, newY: number, deltaX: number, deltaY: number) => void
  onDragEnd?: (
    objectId: string,
    finalX: number,
    finalY: number,
    startX: number,
    startY: number,
    globalPosition?: { x: number; y: number }
  ) => void | Promise<void>
  onResizeMove?: (objectId: string, newScaleX: number, newScaleY: number, newX: number, newY: number) => void
  onResizeEnd?: (objectId: string) => void | Promise<void>
  onRotateMove?: (objectId: string, newRotation: number) => void
  onRotateEnd?: (objectId: string) => void | Promise<void>
  onSelect?: (objectId: string) => void
  getObject?: (objectId: string) => SceneObject | undefined
  getContainer?: (objectId: string) => PIXI.Container | undefined
  getCharacterEffectiveScale?: (objectId: string) => number | undefined
  /**
   * v19: Get evaluated position of object in data model (parent-local)
   * Setup Mode: returns obj.x/y
   * Action Mode: gets evaluated state after action from ghost states
   */
  getEvaluatedPosition?: (objectId: string) => { x: number; y: number } | undefined
  getEvaluatedGlobalPosition?: (objectId: string) => { x: number; y: number } | undefined
  /**
   * v20: Get evaluated transform of object in data model (scaleX, scaleY, rotation)
   * Setup Mode: returns obj.scaleX/scaleY/rotation
   * Action Mode: gets evaluated state after action from ghost states
   */
  getEvaluatedTransform?: (objectId: string) => { scaleX: number; scaleY: number; rotation: number } | undefined
  /** v19: Position compensation during drag (offset from Transform Origin → container.position) */
  getPositionCompensation?: (objectId: string) => { cx: number; cy: number }
  /** v19: Get effective flip state accumulated along parent chain (XOR of all ancestors + own flipX) */
  getEffectiveFlipX?: (objectId: string) => boolean
}

export interface UseInteractionOptions {
  stage: PIXI.Container
  canvasElement: HTMLCanvasElement
  callbacks: InteractionCallbacks
}

export function useInteraction(options: UseInteractionOptions) {
  const { stage, canvasElement, callbacks } = options

  // Drag state
  let isDragging = false
  let dragState: DragState | null = null

  // v19: Track data model coordinates during drag
  // Used by handleDragEnd to get final position in same coordinate space as startObjectX/Y,
  // avoiding reading from container.position (union child objects are flattened in stage space via proxy chain)
  let dragMoved = false
  let lastDragModelX = 0
  let lastDragModelY = 0
  let lastDragGlobalX = 0
  let lastDragGlobalY = 0

  // Resize state
  let isResizing = false
  let resizeState: ResizeState | null = null

  // Rotation state
  let isRotating = false
  let rotateState: RotateState | null = null

  /**
   * v2.0.0: Get object center coordinates from container position
   * In v2.0.0+ container.position directly stores center coordinates (no offset compensation), read directly
   */
  function getObjectPositionFromContainer(container: PIXI.Container, _obj: SceneObject): { x: number; y: number } {
    return {
      x: container.position.x,
      y: container.position.y
    }
  }

  /**
   * v2.0.0: Apply object center coordinates to container
   * In v2.0.0+ directly assign center coordinates, consistent with updateActionModeObjects / applyTransform
   */
  function applyContainerPosition(container: PIXI.Container, _obj: SceneObject, newX: number, newY: number) {
    container.position.set(
      Math.round(newX),
      Math.round(newY)
    )
  }

  /**
   * Get canvas coordinates
   */
  function getCanvasPosition(event: PointerEvent): { x: number; y: number } {
    const rect = canvasElement.getBoundingClientRect()
    const globalX = event.clientX - rect.left
    const globalY = event.clientY - rect.top
    const globalPos = { x: globalX, y: globalY }
    return stage.toLocal(globalPos)
  }

  /**
   * Convert stage coordinates to local coordinates of object's parent container.
   *
   * Object data model x/y lives in parent-local coordinate space. When dragging a child object,
   * mouse displacement must first be projected into the same parent-local coordinate space; otherwise
   * when parent composite has rotation/scale/flip, adding stage delta directly to x/y deviates from mouse.
   */
  function getPointerPositionInObjectParent(objectId: string, stagePos: { x: number; y: number }): { x: number; y: number } {
    const container = callbacks.getContainer?.(objectId)
    const parent = container?.parent
    if (!parent || parent === stage) return stagePos

    const parentLocal = parent.toLocal(new PIXI.Point(stagePos.x, stagePos.y), stage)
    return { x: parentLocal.x, y: parentLocal.y }
  }

  /**
   * Start drag
   */
  function startDrag(objectId: string, event: PIXI.FederatedPointerEvent, _container: PIXI.Container) {
    const obj = callbacks.getObject?.(objectId)
    if (!obj) return

    const localPos = stage.toLocal(event.global)
    const parentLocalPos = getPointerPositionInObjectParent(objectId, localPos)

    // v20: Uniformly get current position from getEvaluatedPosition
    // Setup Mode: returns obj.x/y
    // Action Mode: gets parent-local coordinates evaluated after actions from ghost states
    const evaluatedPos = callbacks.getEvaluatedPosition?.(objectId)
    const currentObjectX = evaluatedPos?.x ?? obj.x
    const currentObjectY = evaluatedPos?.y ?? obj.y
    const evaluatedGlobalPos = callbacks.getEvaluatedGlobalPosition?.(objectId)
    const currentObjectGlobalX = evaluatedGlobalPos?.x ?? currentObjectX
    const currentObjectGlobalY = evaluatedGlobalPos?.y ?? currentObjectY

    isDragging = true
    dragMoved = false
    lastDragModelX = currentObjectX
    lastDragModelY = currentObjectY
    lastDragGlobalX = currentObjectGlobalX
    lastDragGlobalY = currentObjectGlobalY
    dragState = {
      objectId,
      startMouseX: localPos.x,
      startMouseY: localPos.y,
      startMouseParentX: parentLocalPos.x,
      startMouseParentY: parentLocalPos.y,
      startObjectX: currentObjectX,
      startObjectY: currentObjectY,
      startObjectGlobalX: currentObjectGlobalX,
      startObjectGlobalY: currentObjectGlobalY
    }

    // Select object
    callbacks.onSelect?.(objectId)
  }

  /**
   * Handle drag move
   */
  function handleDragMove(event: PointerEvent) {
    if (!isDragging || !dragState) return

    const localPos = getCanvasPosition(event)
    const obj = callbacks.getObject?.(dragState.objectId)
    if (!obj) return

    // Calculate delta
    const deltaX = localPos.x - dragState.startMouseX
    const deltaY = localPos.y - dragState.startMouseY
    const parentLocalPos = getPointerPositionInObjectParent(dragState.objectId, localPos)
    const parentDeltaX = parentLocalPos.x - dragState.startMouseParentX
    const parentDeltaY = parentLocalPos.y - dragState.startMouseParentY

    // New position = start position + parent-local delta.
    // Parent-local delta from PIXI matrix transform naturally covers parent rotation/scale/flip/nested composite.
    const newX = dragState.startObjectX + parentDeltaX
    const newY = dragState.startObjectY + parentDeltaY

    // v19: Track data model coordinates (same space as startObjectX/Y)
    dragMoved = true
    lastDragModelX = newX
    lastDragModelY = newY
    lastDragGlobalX = dragState.startObjectGlobalX + deltaX
    lastDragGlobalY = dragState.startObjectGlobalY + deltaY

    // Notify via callback
    callbacks.onDragMove?.(dragState.objectId, newX, newY, deltaX, deltaY)
  }

  /**
   * Handle drag end
   */
  function handleDragEnd() {
    if (!isDragging || !dragState) {
      isDragging = false
      dragState = null
      return
    }

    const obj = callbacks.getObject?.(dragState.objectId)

    if (obj) {
      // v19: Use tracked data model coordinates as final position instead of reading from container.position.
      // For union composite child objects:
      //   container.position is in stage space (flattened by applyUnionProxyChain),
      //   while startObjectX/Y is in parent-local space (from getEvaluatedPosition).
      //   Coordinate space mismatch leads to failed distance checks and incorrect action creation.
      // Using lastDragModelX/Y (from startObjectX + delta in handleDragMove)
      // guarantees same coordinate space as startObjectX/Y.
      const finalX = dragMoved ? lastDragModelX : dragState.startObjectX
      const finalY = dragMoved ? lastDragModelY : dragState.startObjectY
      const finalGlobalX = dragMoved ? lastDragGlobalX : dragState.startObjectGlobalX
      const finalGlobalY = dragMoved ? lastDragGlobalY : dragState.startObjectGlobalY

      void callbacks.onDragEnd?.(
        dragState.objectId,
        finalX,
        finalY,
        dragState.startObjectX,
        dragState.startObjectY,
        { x: finalGlobalX, y: finalGlobalY }
      )
    }

    isDragging = false
    dragState = null
  }

  /**
   * Start resize
   */
  function startResize(
    objectId: string,
    corner: string,
    event: PIXI.FederatedPointerEvent,
    bounds: { width: number; height: number }
  ) {
    const obj = callbacks.getObject?.(objectId)
    if (!obj) return

    const localPos = stage.toLocal(event.global)

    // v20: Uniformly get initial state from getEvaluatedPosition/getEvaluatedTransform
    // Setup Mode: returns obj.x/y/scaleX/scaleY/rotation
    // Action Mode: gets evaluated state after action from ghost states
    const evaluatedPos = callbacks.getEvaluatedPosition?.(objectId)
    const evaluatedTransform = callbacks.getEvaluatedTransform?.(objectId)
    const currentObjectX = evaluatedPos?.x ?? obj.x
    const currentObjectY = evaluatedPos?.y ?? obj.y
    const currentScaleX = evaluatedTransform?.scaleX ?? obj.scaleX
    const currentScaleY = evaluatedTransform?.scaleY ?? obj.scaleY
    const currentRotation = evaluatedTransform?.rotation ?? (obj.rotation || 0)

    isResizing = true
    resizeState = {
      objectId,
      corner,
      startMouseX: localPos.x,
      startMouseY: localPos.y,
      startObjectX: currentObjectX,
      startObjectY: currentObjectY,
      startScaleX: currentScaleX,
      startScaleY: currentScaleY,
      startWidth: bounds.width,
      startHeight: bounds.height,
      startRotation: currentRotation,
      originalAspect: bounds.width / bounds.height
    }
  }

  /**
   * Handle resize move
   * v9.4: Center Pivot scale - keeps object visual center fixed while scaling
   * Supports OBB local projection scale and independent aspect ratio scaling
   */
  function handleResizeMove(event: PointerEvent) {
    if (!isResizing || !resizeState) return

    const localPos = getCanvasPosition(event)
    const obj = callbacks.getObject?.(resizeState.objectId)
    if (!obj) return

    // Calculate global mouse movement delta
    const deltaX = localPos.x - resizeState.startMouseX
    const deltaY = localPos.y - resizeState.startMouseY

    // Inverse rotation projection: map mouse delta from global coordinates to object unrotated local coordinates
    const angle = resizeState.startRotation
    const cosA = Math.cos(-angle)
    const sinA = Math.sin(-angle)

    // If object effective flip is true (including parent inheritance), x axis is reversed; project deltaX inverted
    const effectiveFlip = callbacks.getEffectiveFlipX?.(resizeState.objectId) ?? obj.flipX ?? false
    const flipMultiplierX = effectiveFlip ? -1 : 1

    // Project to object unrotated local coordinates, considering flip to fix mouse drag direction
    const localDeltaX = (deltaX * cosA - deltaY * sinA) * flipMultiplierX
    const localDeltaY = deltaX * sinA + deltaY * cosA

    const corner = resizeState.corner
    let scaleChangeX = 0
    let scaleChangeY = 0

    // Calculate X/Y independent scale changes based on dragged handle and local delta
    // Note: If negative handle is pulled negative distance, it is an enlarge, so formula has negative sign
    if (corner === 'top-left') {
      scaleChangeX = -localDeltaX / resizeState.startWidth
      scaleChangeY = -localDeltaY / resizeState.startHeight
    } else if (corner === 'top-right') {
      scaleChangeX = localDeltaX / resizeState.startWidth
      scaleChangeY = -localDeltaY / resizeState.startHeight
    } else if (corner === 'bottom-left') {
      scaleChangeX = -localDeltaX / resizeState.startWidth
      scaleChangeY = localDeltaY / resizeState.startHeight
    } else if (corner === 'bottom-right') {
      scaleChangeX = localDeltaX / resizeState.startWidth
      scaleChangeY = localDeltaY / resizeState.startHeight
    } else if (corner === 'top') {
      // Edge handles only: single-axis calculation
      scaleChangeY = -localDeltaY / resizeState.startHeight
    } else if (corner === 'bottom') {
      scaleChangeY = localDeltaY / resizeState.startHeight
    } else if (corner === 'left') {
      scaleChangeX = -localDeltaX / resizeState.startWidth
    } else if (corner === 'right') {
      scaleChangeX = localDeltaX / resizeState.startWidth
    }

    let newScaleX = resizeState.startScaleX + scaleChangeX
    let newScaleY = resizeState.startScaleY + scaleChangeY

    // Default behavior: regular objects scale proportionally by dragging corners, hold Shift for free scale.
    // Masks are crop boxes, dragging corners directly changes aspect ratio; dragging edge handles is always single axis.
    if (obj.type !== 'mask' && !event.shiftKey && corner.includes('-')) {
      const avgScaleChange = (scaleChangeX + scaleChangeY) / 2
      newScaleX = resizeState.startScaleX + avgScaleChange
      newScaleY = resizeState.startScaleY + avgScaleChange
    }

    // Clamp minimum scale value
    newScaleX = Math.max(0.1, newScaleX)
    newScaleY = Math.max(0.1, newScaleY)

    // v2.0.0: Under center coordinates, center stays fixed during scale, position needs no compensation
    const newX = resizeState.startObjectX
    const newY = resizeState.startObjectY

    callbacks.onResizeMove?.(resizeState.objectId, newScaleX, newScaleY, newX, newY)
  }

  /**
   * Handle resize end
   */
  function handleResizeEnd() {
    if (isResizing && resizeState) {
      void callbacks.onResizeEnd?.(resizeState.objectId)
    }
    isResizing = false
    resizeState = null
  }

  /**
   * Start rotate
   */
  function startRotate(objectId: string, event: PIXI.FederatedPointerEvent, container: PIXI.Container, rotationCenter?: PIXI.Point) {
    const obj = callbacks.getObject?.(objectId)
    if (!obj) return

    // Use provided rotation center (transform origin), or fall back to container position (center point)
    const globalCenter = rotationCenter ?? container.getGlobalPosition()
    const stageCenter = stage.toLocal(globalCenter)
    const stageMousePos = stage.toLocal(event.global)
    const startAngle = Math.atan2(stageMousePos.y - stageCenter.y, stageMousePos.x - stageCenter.x)

    isRotating = true
    rotateState = {
      objectId,
      centerX: stageCenter.x,
      centerY: stageCenter.y,
      startAngle,
      lastAngle: startAngle,
      accumulatedDelta: 0,
      startRotation: container.rotation
    }
  }

  /**
   * Handle rotate move
   */
  function handleRotateMove(event: PointerEvent) {
    if (!isRotating || !rotateState) return

    const localPos = getCanvasPosition(event)
    const obj = callbacks.getObject?.(rotateState.objectId)
    if (!obj) return

    // Calculate angle of mouse relative to rotation center
    const dx = localPos.x - rotateState.centerX
    const dy = localPos.y - rotateState.centerY
    const currentAngle = Math.atan2(dy, dx)

    // Accumulate shortest arc delta step by step, supporting single drag beyond 180° or multiple rotations
    const accumulated = accumulateRotationDelta(
      rotateState.lastAngle,
      currentAngle,
      rotateState.accumulatedDelta
    )
    rotateState.lastAngle = accumulated.currentAngle
    rotateState.accumulatedDelta = accumulated.accumulatedDelta
    let deltaAngle = rotateState.accumulatedDelta

    // v20: flipX rotation direction compensation
    // Only consider parent chain accumulated flip (excluding self), because:
    // - Self flipX via PIXI scale.x < 0 is already correctly handled in matrix for rotation direction
    // - Parent flip mirrors coordinate space where mouse resides, requiring reversed delta compensation
    let parentFlipped = false
    const selfObj = callbacks.getObject?.(rotateState.objectId)
    if (selfObj?.parentId) {
      // Traverse starting from parent object, excluding self
      const parentFlip = callbacks.getEffectiveFlipX?.(selfObj.parentId)
      // getEffectiveFlipX traverses from parameter object including itself; passing parentId means "parent chain including parent itself"
      // But here we need "flip in parent chain", so start with parentId
      // Note: getEffectiveFlipX(parentId) correctly computes accumulated flip starting from parent
      parentFlipped = parentFlip ?? false
    }
    if (parentFlipped) {
      deltaAngle = -deltaAngle
    }

    const newRotation = rotateState.startRotation + deltaAngle

    callbacks.onRotateMove?.(rotateState.objectId, newRotation)
  }

  /**
   * Handle rotate end
   */
  function handleRotateEnd() {
    if (isRotating && rotateState) {
      void callbacks.onRotateEnd?.(rotateState.objectId)
    }
    isRotating = false
    rotateState = null
  }

  /**
   * Handle global pointer move
   */
  function handleGlobalPointerMove(event: PointerEvent) {
    if (isDragging) {
      handleDragMove(event)
    } else if (isResizing) {
      handleResizeMove(event)
    } else if (isRotating) {
      handleRotateMove(event)
    }
  }

  /**
   * Handle global pointer up
   */
  function handleGlobalPointerUp() {
    handleDragEnd()
    handleResizeEnd()
    handleRotateEnd()
  }

  /**
   * Bind global events
   */
  function bindGlobalEvents() {
    window.addEventListener('pointerup', handleGlobalPointerUp)
    window.addEventListener('pointermove', handleGlobalPointerMove)
  }

  /**
   * Unbind global events
   */
  function unbindGlobalEvents() {
    window.removeEventListener('pointerup', handleGlobalPointerUp)
    window.removeEventListener('pointermove', handleGlobalPointerMove)
  }

  /**
   * Get object ID currently undergoing interaction (drag/resize/rotate)
   * Used to prevent async rendering from overwriting container state directly set during interaction
   */
  function getActiveInteractionObjectId(): string | null {
    if (isDragging && dragState) return dragState.objectId
    if (isResizing && resizeState) return resizeState.objectId
    if (isRotating && rotateState) return rotateState.objectId
    return null
  }

  return {
    // State
    get isDragging() { return isDragging },
    get isResizing() { return isResizing },
    get isRotating() { return isRotating },
    get dragState() { return dragState },

    // Actions
    startDrag,
    startResize,
    startRotate,

    // Event binding
    bindGlobalEvents,
    unbindGlobalEvents,

    // Utility functions
    getObjectPositionFromContainer,
    applyContainerPosition,
    getCanvasPosition,
    getActiveInteractionObjectId
  }
}
