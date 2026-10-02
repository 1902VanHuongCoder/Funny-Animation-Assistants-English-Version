/**
 * Action Runtime Evaluator
 * Used during every frame render cycle to calculate final property state of each object at current time point.
 * 
 * v6.3 updates:
 * - Streamline Action types; set_transform contains visual properties only (alpha/visible/flipX/zIndex)
 * - tween_transform contains geometric properties only (x/y/scaleX/scaleY/rotation)
 * 
 * v6.5 updates:
 * - Added RuntimeCameraState interface
 * - Added evaluateCameraState() function for camera state evaluation
 */

import type { SceneObject, ScreenEffectObject } from '@/types/sceneObject'
import type { Action, DurationAction, RuntimeSlot } from '@/types/screenplay'
import { type ActionType, getHandler } from '@/utils/actionHandlers'
import type { ActionHandlerContext, WriteableState } from '@/utils/actionHandlers/types'
import { sortActionsForEvaluation } from '@/utils/actionOrder'
import { sortCameraActionsForEvaluation } from '@/utils/cameraActionRules'

/**
 * Runtime camera state (v6.5)
 * Used for camera transform calculation in ActionPreviewDialog
 */
export interface RuntimeCameraState {
  // Camera position (canvas coordinates)
  x: number
  y: number

  // Zoom level (1 = normal, >1 = zoom in, <1 = zoom out)
  zoom: number

  // Shake offset (temporary effect)
  shakeOffsetX: number
  shakeOffsetY: number
}

function getFollowTargetCenter(
  followTarget: string,
  visualCenters?: Map<string, { x: number, y: number }>,
): { x: number, y: number } | undefined {
  return visualCenters?.get(followTarget)
}

// Easing functions library
const EasingFunctions: Record<string, (t: number) => number> = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => --t * t * t + 1,
  easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
}

/**
/**
 * Calculates absolute time range for an action (ms)
 * v6.2: Slot time calculation based on slotIndex + slotSpan
 */
function getActionTimeRange(
  action: Action,
  slots?: RuntimeSlot[]
): { start: number; end: number; duration: number } {
  let start = 0
  let duration = 0

  if (!slots || slots.length === 0) {
    return { start: 0, end: 0, duration: 0 }
  }

  const slot = slots[action.slotIndex]
  if (slot) {
    start = slot.startTime

    // Duration action: calculate duration based on slotSpan
    if (action.category === 'duration') {
      const span = (action as { slotSpan?: number }).slotSpan ?? 1
      for (let i = 0; i < span; i++) {
        const s = slots[action.slotIndex + i]
        if (s) duration += s.duration
      }
    }
  }

  return { start, end: start + duration, duration }
}

/**
/**
 * Linear interpolation
 */
function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t
}

/**
/**
 * Core: Evaluates state of a single object at a specific time point
 * @param startState Initial state at Block start (setup + prevReplay)
 * @param actions Action list within current Block (filtered for this object)
 * @param currentTime Current playback time (ms)
 * @param totalDuration Total Block duration (ms)
 * @param slots Runtime slots list (used to calculate action time ranges)
 */
export function evaluateObjectState(
  startState: SceneObject,
  actions: Action[],
  currentTime: number,
  _totalDuration: number,
  slots?: RuntimeSlot[],
  currentSlotIndex = -1,
  context?: ActionHandlerContext
): SceneObject {

  // 1. Clone initial state
  const baseState = { ...startState } as SceneObject & Record<string, unknown>
  const finalState = { ...startState } as SceneObject & Record<string, unknown>

  // Screen effect: deep clone params to avoid baseState/finalState reference sharing
  if (startState.type === 'screen_effect') {
    const p = (startState as unknown as ScreenEffectObject).params
    if (p) {
      ; (baseState as unknown as ScreenEffectObject).params = { ...p }
        ; (finalState as unknown as ScreenEffectObject).params = { ...p }
    }
  }

  // 2. Sort actions by slot index
  // v17: Point Actions precede Duration Actions within same slotIndex (consistent with evaluateObjectStateBySlot)
  // Ensures set_transform applies first (sets transformOrigin, etc.), and tween_transform interpolates based on that initial state
  const sortedActions = sortActionsForEvaluation(actions)

  for (const action of sortedActions) {
    const { start, end, duration } = getActionTimeRange(action, slots)

    // v7.16: Logic replacement - use Slot Index for Control Flow if available
    let isStarted = false
    let isFinished = false

    if (currentSlotIndex !== -1 && slots) {
      // Slot-based logic
      const actionStartSlot = action.slotIndex

      // Point actions happen at the start of the slot
      // Duration actions start at the start of the slot

      if (currentSlotIndex < actionStartSlot) {
        isStarted = false
      } else {
        isStarted = true

        // Check finish condition
        if (action.category === 'point' || duration === 0) {
          isFinished = true
        } else {
          const span = (action as DurationAction).slotSpan ?? 1
          const actionEndSlot = action.slotIndex + span
          if (currentSlotIndex >= actionEndSlot) {
            isFinished = true
          }
        }
      }
    } else {
      // Time-based logic (Fallback)
      if (currentTime >= start) {
        isStarted = true
        if (action.category === 'point' || duration === 0 || currentTime >= end) {
          isFinished = true
        }
      }
    }

    // Apply Logic
    if (!isStarted) continue

    // Instant Action
    if (action.category === 'point' || duration === 0) {
      applyPointAction(baseState, action, context)
      applyPointAction(finalState, action, context)
      continue
    }

    // Duration Action
    if (isFinished) {
      applyDurationActionFinal(baseState, action, context)
      applyDurationActionFinal(finalState, action, context)
    } else {
      // Interpolating
      // For interpolation value, we still rely on time as it provides sub-slot precision
      let progress = 0
      if (duration > 0) {
        progress = (currentTime - start) / duration
      }
      progress = Math.min(1, Math.max(0, progress))

      const easingName = (action as DurationAction).easing ?? 'linear'
      const ease = EasingFunctions[easingName] ?? EasingFunctions['linear']
      const easedProgress = ease ? ease(progress) : progress

      applyDurationActionTween(finalState, baseState, action, easedProgress, context)
    }
  }

  return finalState
}

/**
/**
 * Core: Evaluates state of a single object based on Slot (Target State Mode)
 * Dedicated to Scene Editor (Action Mode); does not rely on millisecond time, no interpolation
 * @param startState Initial state at Block start
 * @param actions Action list within current Block
 * @param currentSlotIndex Currently selected slot index
 * @param slots Runtime slots list
 */
export function evaluateObjectStateBySlot(
  startState: SceneObject,
  actions: Action[],
  currentSlotIndex: number,
  _slots?: RuntimeSlot[],
  context?: ActionHandlerContext
): SceneObject {

  // 1. Clone initial state
  const finalState = { ...startState } as SceneObject & Record<string, unknown>

  // Screen effect: deep clone params to avoid baseState/finalState reference sharing
  if (startState.type === 'screen_effect') {
    const p = (startState as unknown as ScreenEffectObject).params
    if (p) {
      ; (finalState as unknown as ScreenEffectObject).params = { ...p }
    }
  }

  // 2. Sort actions by slot index
  // v14.1: Point Actions precede Duration Actions within same slotIndex
  // Ensures set_transform applies first, overwritten by tween_transform (tween takes precedence as final state)
  const sortedActions = sortActionsForEvaluation(actions)

  for (const action of sortedActions) {
    if (action.slotIndex > currentSlotIndex) {
      continue
    }

  // Only apply action states that have already taken effect before current Slot
    if (action.category === 'point') {
      applyPointAction(finalState, action, context)
    } else {
      applyDurationActionFinal(finalState, action as DurationAction, context)
    }
  }

  return finalState
}

/**
/**
 * Core: Evaluates camera state based on Slot (Target State Mode)
 * Dedicated to Scene Editor (Action Mode); does not rely on millisecond time, no interpolation
 */
export function evaluateCameraStateBySlot(
  defaultState: RuntimeCameraState,
  actions: Action[],
  _currentSlotIndex: number,
  _slots?: RuntimeSlot[],
  visualCenters?: Map<string, { x: number, y: number }>,
  lastFollowPosition?: { x: number, y: number } | null,
): RuntimeCameraState {

  // 1. Filter camera actions
  const cameraActions = actions.filter(a => a.target === 'camera')

  // console.log('[Camera Debug] evaluateCameraStateBySlot called:')
  // console.log('[Camera Debug]   _currentSlotIndex:', _currentSlotIndex)
  // console.log('[Camera Debug]   cameraActions count:', cameraActions.length)
  // console.log('[Camera Debug]   cameraActions slotIndexes:', cameraActions.map(a => a.slotIndex))

  if (cameraActions.length === 0) {
    // console.log('[Camera Debug]   No camera actions, returning default state')
    return { ...defaultState, shakeOffsetX: 0, shakeOffsetY: 0 }
  }

  // 2. Initial state
  const finalState: RuntimeCameraState = { ...defaultState, shakeOffsetX: 0, shakeOffsetY: 0 }

  // 3. Sort by slot index
  const sortedActions = sortCameraActionsForEvaluation(cameraActions)

  for (const action of sortedActions) {
  // v8.3: Restore Slot boundary, showing cumulative state before current slot for camera
    if (action.slotIndex > _currentSlotIndex) {
      // console.log('[Camera Debug]   Skipping action at slotIndex', action.slotIndex, '> currentSlotIndex', _currentSlotIndex)
      continue
    }
    // console.log('[Camera Debug]   Applying action at slotIndex', action.slotIndex, 'type:', action.type)

  // 5. Apply action effects
    // Point action
    if (action.type === 'camera_cut') {
      if (action.params.x !== undefined) finalState.x = action.params.x
      if (action.params.y !== undefined) finalState.y = action.params.y
      if (action.params.zoom !== undefined) finalState.zoom = action.params.zoom
      continue
    }

    // Duration action (directly apply final state)
    if (action.type === 'camera_move') {
      const params = action.params
      if (params.x !== undefined) finalState.x = params.x
      if (params.y !== undefined) finalState.y = params.y
      if (params.zoom !== undefined) finalState.zoom = params.zoom
    } else if (action.type === 'camera_follow') {
      const params = action.params
      const followTarget = params.followTarget
      const offsetX = params.offsetX ?? 0
      const offsetY = params.offsetY ?? -50

      let finalX = finalState.x
      let finalY = finalState.y

      const targetCenter = getFollowTargetCenter(followTarget, visualCenters)
      if (targetCenter) {
        finalX = targetCenter.x + offsetX
        finalY = targetCenter.y + offsetY
      } else if (lastFollowPosition) {
        finalX = lastFollowPosition.x
        finalY = lastFollowPosition.y
      }

      // v7.21: Bounds constraint - fixes camera exceeding canvas bounds when following prop objects
      // Bounds constraint should be based on camera's own dimensions rather than target object's dimensions
      if (params.constrainBounds) {
        const targetZoom = params.zoom ?? finalState.zoom
        const cameraWidth = CAMERA_BASE_WIDTH / targetZoom
        const cameraHeight = CAMERA_BASE_HEIGHT / targetZoom
        const halfW = cameraWidth / 2
        const halfH = cameraHeight / 2

      // Ensure camera center point stays within canvas bounds so camera frame does not exceed boundaries
        finalX = Math.max(halfW, Math.min(CANVAS_WIDTH - halfW, finalX))
        finalY = Math.max(halfH, Math.min(CANVAS_HEIGHT - halfH, finalY))
      }

      finalState.x = finalX
      finalState.y = finalY
      if (params.zoom !== undefined) {
        finalState.zoom = params.zoom
      }
    }
  // camera_shake is usually ignored in edit mode because it requires time-driven shake animation
  }

  return finalState
}

/**
/**
 * Evaluates target state of an object (v7.9)
 * Calculates final state of object if all ongoing actions were completed immediately
 */
export function evaluateObjectTargetState(
  currentState: SceneObject,
  actions: Action[],
  currentTime: number,
  _totalDuration: number,
  slots?: RuntimeSlot[],
  currentSlotIndex = -1
): SceneObject | null {

  // 1. Filter out DurationActions currently in progress
  const activeActions = actions.filter(action => {
  // Must be duration action
    if (action.category !== 'duration') return false

    // v7.16: Slot logic
    if (currentSlotIndex !== -1 && slots) {
      const span = (action as unknown as { slotSpan?: number }).slotSpan ?? 1
      const startSlot = action.slotIndex
      const endSlot = action.slotIndex + span
      return currentSlotIndex >= startSlot && currentSlotIndex < endSlot
    }

    const { start, end } = getActionTimeRange(action, slots)
    return currentTime >= start && currentTime < end
  })

  if (activeActions.length === 0) {
    return null
  }

  // 2. Based on current state, apply final effects of all ongoing actions
  const targetState = { ...currentState } as SceneObject & Record<string, unknown>

  // Sort by slot to ensure correct override order
  activeActions.sort((a, b) => a.slotIndex - b.slotIndex)

  // v7.10: Mixed handling of Point Action and Duration Action
  // Principles:
  // 1. Point Action should be checked and applied before Duration Action (if in same Slot)
  //    Because Point Action is usually an instantaneous state change (initial position, expression switch),
  //    while Duration Action is a gradual tween based on this initial state.
  //    If Duration Action is active, its final state should override Point Action settings (for identical properties).
  // 2. Duration Actions in Preroll Slots must also be processed.

  // Collect Point Actions for current Slot
  const currentSlotPointActions = actions.filter(action => {
    if (action.category !== 'point') return false

    // v7.16: Slot logic
    if (currentSlotIndex !== -1 && slots) {
      return action.slotIndex === currentSlotIndex
    }

    const { start } = getActionTimeRange(action, slots)
      return start >= currentTime // Simple determination: belongs after current time window (inclusive)
  })

  // Merge lists and sort by slotIndex; if slotIndex is identical, Point Action precedes Duration Action
  const allTargetActions = [...activeActions, ...currentSlotPointActions].sort((a, b) => {
    if (a.slotIndex !== b.slotIndex) {
      return a.slotIndex - b.slotIndex
    }
    // Same slotIndex: Point Action takes precedence
    const aIsPoint = a.category === 'point'
    const bIsPoint = b.category === 'point'
    if (aIsPoint && !bIsPoint) return -1
    if (!aIsPoint && bIsPoint) return 1
    return 0
  })

  for (const action of allTargetActions) {
    if (action.category === 'point') {
    // Point action
      applyPointAction(targetState, action)
    } else {
      // Apply duration action final state
      applyDurationActionFinal(targetState, action as DurationAction)
    }
  }

  return targetState
}

// Canvas and camera constants (imported from unified constants file)
import {
  CAMERA_BASE_HEIGHT,
  CAMERA_BASE_WIDTH,
  CANVAS_HEIGHT,
  CANVAS_WIDTH
} from '@/constants/canvas'

/**
/**
 * Evaluates camera state at a specific time point (v6.6)
 * @param defaultState Camera default state
 * @param actions All actions within current Block
 * @param currentTime Current playback time (ms)
 * @param totalDuration Total Block duration (ms)
 * @param slots Runtime slots list
 * @param visualCenters Visual centers mapping of objects (used for follow calculations)
 * @param lastFollowPosition Last follow position (used to maintain position when target disappears)
 */
export function evaluateCameraState(
  defaultState: RuntimeCameraState,
  actions: Action[],
  currentTime: number,
  _totalDuration: number,
  slots?: RuntimeSlot[],
  visualCenters?: Map<string, { x: number, y: number }>,
  lastFollowPosition?: { x: number, y: number } | null,
  frameDeltaMs = 16.67,
  previousFrameState?: RuntimeCameraState | null,
  currentSlotIndex = -1 // v7.16
): RuntimeCameraState {
  // Filter camera actions
  const cameraActions = actions.filter(a => a.target === 'camera')

  if (cameraActions.length === 0) {
    return { ...defaultState, shakeOffsetX: 0, shakeOffsetY: 0 }
  }

  // Initial state
  const baseState: RuntimeCameraState = { ...defaultState, shakeOffsetX: 0, shakeOffsetY: 0 }
  const finalState: RuntimeCameraState = { ...defaultState, shakeOffsetX: 0, shakeOffsetY: 0 }

  // Sort by slot index
  const sortedActions = sortCameraActionsForEvaluation(cameraActions)

  for (const action of sortedActions) {
    const { start, end, duration } = getActionTimeRange(action, slots)

    // v7.16: Logic replacement - use Slot Index for Control Flow
    let isStarted = false
    let isFinished = false

    if (currentSlotIndex !== -1 && slots) {
      const actionStartSlot = action.slotIndex
      if (currentSlotIndex < actionStartSlot) {
        isStarted = false
      } else {
        isStarted = true
        if (action.category === 'point' || duration === 0) {
          isFinished = true
        } else {
          const span = (action as DurationAction).slotSpan ?? 1
          const actionEndSlot = action.slotIndex + span
          if (currentSlotIndex >= actionEndSlot) {
            isFinished = true
          }
        }
      }
    } else {
      // Time-based
      if (currentTime >= start) {
        isStarted = true
        if (action.category === 'point' || duration === 0 || currentTime >= end) {
          isFinished = true
        }
      }
    }

    if (!isStarted) continue

    // Point action (camera_cut)
    if (action.category === 'point' || duration === 0) {
      if (action.type === 'camera_cut') {
    // v6.6: Add undefined check to preserve original value
        if (action.params.x !== undefined) {
          baseState.x = action.params.x
          finalState.x = action.params.x
        }
        if (action.params.y !== undefined) {
          baseState.y = action.params.y
          finalState.y = action.params.y
        }
        if (action.params.zoom !== undefined) {
          baseState.zoom = action.params.zoom
          finalState.zoom = action.params.zoom
        }
      }
      continue
    }

    // Duration action
    if (isFinished) {
      // Action completed
      if (action.type === 'camera_move') {
        const params = action.params
        if (params.x !== undefined) baseState.x = params.x
        if (params.y !== undefined) baseState.y = params.y
        if (params.zoom !== undefined) baseState.zoom = params.zoom
        finalState.x = baseState.x
        finalState.y = baseState.y
        finalState.zoom = baseState.zoom
      } else if (action.type === 'camera_follow') {
      // v6.7: After camera_follow completes, camera remains at last position (no longer follows)
        const params = action.params
        const followTarget = params.followTarget
        const offsetX = params.offsetX ?? 0
        const offsetY = params.offsetY ?? -50

        let finalX = baseState.x
        let finalY = baseState.y

      // Prefer currently provided visual centers to compute final position
        const targetCenter = getFollowTargetCenter(followTarget, visualCenters)
        if (targetCenter) {
          finalX = targetCenter.x + offsetX
          finalY = targetCenter.y + offsetY
        } else if (lastFollowPosition) {
          finalX = lastFollowPosition.x
          finalY = lastFollowPosition.y
        }

      // v7.21: Bounds constraint - fixes camera exceeding canvas bounds when following prop objects
      // Bounds constraint should be based on camera's own dimensions rather than target object's dimensions
        if (params.constrainBounds) {
          const targetZoom = params.zoom ?? baseState.zoom
          const cameraWidth = CAMERA_BASE_WIDTH / targetZoom
          const cameraHeight = CAMERA_BASE_HEIGHT / targetZoom
          const halfW = cameraWidth / 2
          const halfH = cameraHeight / 2

      // Ensure camera center point stays within canvas bounds so camera frame does not exceed boundaries
          finalX = Math.max(halfW, Math.min(CANVAS_WIDTH - halfW, finalX))
          finalY = Math.max(halfH, Math.min(CANVAS_HEIGHT - halfH, finalY))
        }

        baseState.x = finalX
        baseState.y = finalY
        finalState.x = finalX
        finalState.y = finalY

      // zoom retains last configured value
        if (params.zoom !== undefined) {
          baseState.zoom = params.zoom
          finalState.zoom = params.zoom
        }
      }
      // camera_shake does not affect base state after completion
    } else {
      // Action in progress
      let progress = (currentTime - start) / duration
      progress = Math.min(1, Math.max(0, progress))

      const easingName = (action as DurationAction).easing ?? 'linear'
      const ease = EasingFunctions[easingName] ?? EasingFunctions['linear']
      const easedProgress = ease ? ease(progress) : progress

      if (action.type === 'camera_move') {
        const moveAction = action as unknown as { params: { x?: number, y?: number, zoom?: number } }
        const params = moveAction.params
        if (params.x !== undefined) {
          finalState.x = lerp(baseState.x, params.x, easedProgress)
        }
        if (params.y !== undefined) {
          finalState.y = lerp(baseState.y, params.y, easedProgress)
        }
        if (params.zoom !== undefined) {
          finalState.zoom = lerp(baseState.zoom, params.zoom, easedProgress)
        }
      } else if (action.type === 'camera_shake') {
      // Camera shake calculation
        const shakeAction = action as unknown as { params: { intensity?: number, frequency?: number, decay?: boolean } }
        const params = shakeAction.params
        let intensity = params.intensity ?? 10
        const frequency = params.frequency ?? 30

      // Decay factor
        if (params.decay) {
          intensity *= (1 - easedProgress)
        }

      // Calculate shake offset based on time and frequency (using sine waves)
        const elapsed = currentTime - start
        const phase = (elapsed / 1000) * frequency * Math.PI * 2

      // Superimpose multiple sine waves for more natural camera shake effect
        finalState.shakeOffsetX = intensity * (
          Math.sin(phase) * 0.6 +
          Math.sin(phase * 1.7) * 0.3 +
          Math.sin(phase * 2.3) * 0.1
        )
        finalState.shakeOffsetY = intensity * (
          Math.cos(phase * 0.9) * 0.6 +
          Math.cos(phase * 1.5) * 0.3 +
          Math.cos(phase * 2.1) * 0.1
        )
      } else if (action.type === 'camera_follow' && visualCenters) {
      // Camera follow calculation (v6.6, v15: smooth entry + auto dolly zoom)
        const followAction = action as unknown as { params: { followTarget: string, damping?: number, offsetX?: number, offsetY?: number, zoom?: number, smoothEntry?: boolean, smoothEntryDuration?: number, autoZoom?: boolean, autoZoomRange?: number, autoZoomCycles?: number, constrainBounds?: boolean } }
        const params = followAction.params
        const followTarget = params.followTarget
        const offsetX = params.offsetX ?? 0
      const offsetY = params.offsetY ?? -50  // Default offset, slightly lower character
        const damping = Math.max(0, params.damping ?? 0)
      const targetZoom = params.zoom  // Optional zoom parameter
      const smoothEntry = params.smoothEntry ?? false  // v15: Default disabled smooth entry
      const smoothEntryDuration = params.smoothEntryDuration ?? 300  // v15: Default 300ms
      const constrainBounds = params.constrainBounds ?? false  // v6.9: Bounds constraint

      // v6.6: Get target object visual center position
        const targetCenter = getFollowTargetCenter(followTarget, visualCenters)

      // Calculate target position
        let targetX: number
        let targetY: number

        if (targetCenter) {
      // Target visible: use visual center position directly
          targetX = targetCenter.x + offsetX
          targetY = targetCenter.y + offsetY
        } else if (lastFollowPosition) {
      // Target invisible: maintain last position
          targetX = lastFollowPosition.x
          targetY = lastFollowPosition.y
        } else {
      // No target information: maintain current camera position
          targetX = baseState.x
          targetY = baseState.y
        }

      // v15: Smooth entry vs instant switch
        let newX: number
        let newY: number
        let newZoom = baseState.zoom
        const elapsed = currentTime - start

        if (smoothEntry && elapsed < smoothEntryDuration) {
      // Smooth entry: interpolate from baseState position to target position
          const entryProgress = Math.min(1, elapsed / smoothEntryDuration)
      // easeOutCubic: quickly approach target, decelerate near end
          const eased = 1 - Math.pow(1 - entryProgress, 3)
          newX = lerp(baseState.x, targetX, eased)
          newY = lerp(baseState.y, targetY, eased)
          if (targetZoom !== undefined) {
            newZoom = lerp(baseState.zoom, targetZoom, eased)
          }
        } else {
      // damping requires previous frame camera state as start point; otherwise each frame re-interpolates from block start
          if (damping > 0) {
            const factor = Math.min(1, Math.max(0, frameDeltaMs / damping))
            const dampingStartX = previousFrameState?.x ?? finalState.x
            const dampingStartY = previousFrameState?.y ?? finalState.y
            const dampingStartZoom = params.autoZoom
              ? (targetZoom ?? finalState.zoom)
              : (previousFrameState?.zoom ?? finalState.zoom)
            newX = lerp(dampingStartX, targetX, factor)
            newY = lerp(dampingStartY, targetY, factor)
            if (targetZoom !== undefined) {
              newZoom = lerp(dampingStartZoom, targetZoom, factor)
            }
          } else {
            newX = targetX
            newY = targetY
            if (targetZoom !== undefined) {
              newZoom = targetZoom
            }
          }
        }

      // v15: Auto dolly zoom (sine wave scale oscillation)
        const baseZoomBeforeAutoZoom = newZoom
        if (params.autoZoom && baseZoomBeforeAutoZoom > 0) {
          const range = params.autoZoomRange ?? 5
          const cycles = params.autoZoomCycles ?? 0.5
          const amplitude = baseZoomBeforeAutoZoom * (range / 100)
          const actionDuration = end - start
          if (actionDuration > 0 && cycles > 0) {
            const cycleDuration = actionDuration / cycles
            const phase = (elapsed / cycleDuration) * Math.PI * 2
            newZoom = Math.max(0.1, baseZoomBeforeAutoZoom + amplitude * Math.sin(phase))
          }
        }

      // v7.21: Bounds constraint - fixes camera exceeding canvas bounds when following prop objects
      // Bounds constraint should be based on camera's own dimensions rather than target object's dimensions
        if (constrainBounds) {
          // Calculate camera actual dimensions based on zoom
          const cameraWidth = CAMERA_BASE_WIDTH / newZoom
          const cameraHeight = CAMERA_BASE_HEIGHT / newZoom
          const halfW = cameraWidth / 2
          const halfH = cameraHeight / 2

      // Ensure camera center point stays within canvas bounds so camera frame does not exceed boundaries
          newX = Math.max(halfW, Math.min(CANVAS_WIDTH - halfW, newX))
          newY = Math.max(halfH, Math.min(CANVAS_HEIGHT - halfH, newY))
        }

        finalState.x = newX
        finalState.y = newY
        finalState.zoom = newZoom
      // v15: Synchronize baseState update to ensure subsequent actions (like smooth entry of second camera_follow)
      // transition from current follow position rather than from position prior to follow action
        baseState.x = newX
        baseState.y = newY
        baseState.zoom = newZoom
      }
    }
  }

  return finalState
}

/**
/**
 * Evaluates target state of camera (v7.9)
 * Calculates final state of camera if all ongoing actions were completed immediately
 */
export function evaluateCameraTargetState(
  currentState: RuntimeCameraState,
  actions: Action[],
  currentTime: number,
  _totalDuration: number,
  slots?: RuntimeSlot[],
  visualCenters?: Map<string, { x: number, y: number }>,
  lastFollowPosition?: { x: number, y: number } | null,
  currentSlotIndex = -1 // v7.16
): RuntimeCameraState | null {

  // 1. Filter out DurationActions currently in progress
  const activeActions = actions.filter(action => {
    if (action.target !== 'camera') return false
    if (action.category !== 'duration') return false

    // v7.16: Slot logic
    if (currentSlotIndex !== -1 && slots) {
      const span = (action as unknown as { slotSpan?: number }).slotSpan ?? 1
      const startSlot = action.slotIndex
      const endSlot = action.slotIndex + span
      // Active: start <= current < end
      return currentSlotIndex >= startSlot && currentSlotIndex < endSlot
    }

    const { start, end } = getActionTimeRange(action, slots)
    return currentTime >= start && currentTime < end
  })

  if (activeActions.length === 0) {
    return null
  }

  // 2. Calculate target state
  const targetState: RuntimeCameraState = { ...currentState, shakeOffsetX: 0, shakeOffsetY: 0 }

  activeActions.sort((a, b) => a.slotIndex - b.slotIndex)

  for (const action of activeActions) {
    if (action.type === 'camera_move') {
      const moveAction = action as unknown as { params: { x?: number, y?: number, zoom?: number } }
      const params = moveAction.params
      if (params.x !== undefined) targetState.x = params.x
      if (params.y !== undefined) targetState.y = params.y
      if (params.zoom !== undefined) targetState.zoom = params.zoom
    } else if (action.type === 'camera_follow') {
    // Camera follow target state calculation logic
      const followAction = action as unknown as { params: { followTarget: string, damping?: number, offsetX?: number, offsetY?: number, zoom?: number, constrainBounds?: boolean } }
      const params = followAction.params
      const followTarget = params.followTarget
      const offsetX = params.offsetX ?? 0
      const offsetY = params.offsetY ?? -50

      let finalX = targetState.x
      let finalY = targetState.y

    // Use current visualCenters (assuming target object's own position may also change when action finishes, but only current reference point is accessible here)
    // Strictly speaking, target position of camera_follow depends on target object's position.
    // If target object is also moving, then target position when camera action ends is actually (target object final position + offset).
    // For simplicity here, we use the incoming visualCenters (which may be current frame position or target position passed in).
    // A better approach is to compute TargetState for all objects before calling this function, and pass that in as visualCenters.
      const targetCenter = getFollowTargetCenter(followTarget, visualCenters)
      if (targetCenter) {
        finalX = targetCenter.x + offsetX
        finalY = targetCenter.y + offsetY
      } else if (lastFollowPosition) {
        finalX = lastFollowPosition.x
        finalY = lastFollowPosition.y
      }

      // v7.21: Bounds constraint - fixes camera exceeding canvas bounds when following prop objects
      // Bounds constraint should be based on camera's own dimensions rather than target object's dimensions
      if (params.constrainBounds) {
        const targetZoom = params.zoom ?? targetState.zoom
        const cameraWidth = CAMERA_BASE_WIDTH / targetZoom
        const cameraHeight = CAMERA_BASE_HEIGHT / targetZoom
        const halfW = cameraWidth / 2
        const halfH = cameraHeight / 2

      // Ensure camera center point stays within canvas bounds so camera frame does not exceed boundaries
        finalX = Math.max(halfW, Math.min(CANVAS_WIDTH - halfW, finalX))
        finalY = Math.max(halfH, Math.min(CANVAS_HEIGHT - halfH, finalY))
      }

      targetState.x = finalX
      targetState.y = finalY
      if (params.zoom !== undefined) {
        targetState.zoom = params.zoom
      }
    }
    // camera_shake has no explicit "target state" concept; normally reset to zero or ignored
  }

  return targetState
}

/**
 * Apply point action (v6.3)
 * v8.6 P2: Unified handling via Handler Registry
 * set_transform: Visual properties (alpha, visible, flipX, zIndex)
 * set_character: Visual properties + character state (pose, expression)
 */
function applyPointAction(state: WriteableState, action: Action, context?: ActionHandlerContext) {
  const handler = getHandler(action.type as ActionType)
  if (handler) {
    handler.applyToState(state, action, context)
  }
}

/**
 * Apply duration action final value (after action ends) (v6.3)
 * v17: Unified delegation to Handler (tween_transform requires context for global -> local coordinate conversion)
 */
function applyDurationActionFinal(state: WriteableState, action: DurationAction, context?: ActionHandlerContext) {
  if (action.type === 'camera_move') {
    // Camera action: direct assignment (no coordinate system conversion required)
    const params = action.params
    if (params.x !== undefined) state.x = params.x
    if (params.y !== undefined) state.y = params.y
    if (params.zoom !== undefined) state.zoom = params.zoom
  } else {
    // tween_transform / tween_screen_effect etc: unified delegation to Handler
    const handler = getHandler(action.type as ActionType)
    if (handler) {
      handler.applyToState(state, action, context)
    }
  }
}

/**
 * Apply duration action interpolation (action in progress) (v6.3)
 * v17: Unified delegation to Handler (tween_transform requires context for global space interpolation)
 */
function applyDurationActionTween(
  finalState: WriteableState,
  baseState: WriteableState,
  action: DurationAction,
  progress: number,
  context?: ActionHandlerContext
) {
  if (action.type === 'camera_move') {
  // Camera move: direct lerp (no coordinate system conversion required)
    const moveAction = action as unknown as { params: { x?: number, y?: number, zoom?: number } }
    const params = moveAction.params
    if (params.x !== undefined) {
      finalState.x = lerp(baseState.x!, params.x, progress)
    }
    if (params.y !== undefined) {
      finalState.y = lerp(baseState.y!, params.y, progress)
    }
    if (params.zoom !== undefined) {
      finalState.zoom = lerp((baseState.zoom!) ?? 1, params.zoom, progress)
    }
  }
  else if (action.type === 'camera_shake') {
  // Camera shake: random offset
    const shakeAction = action as unknown as { params: { intensity: number, decay?: boolean } }
    const params = shakeAction.params
    let intensity = params.intensity
    if (params.decay) {
      intensity *= (1 - progress)
    }
    const angle = Math.random() * Math.PI * 2
    finalState.shakeOffsetX = Math.cos(angle) * intensity * (Math.random() * 0.5 + 0.5)
    finalState.shakeOffsetY = Math.sin(angle) * intensity * (Math.random() * 0.5 + 0.5)
  }
  else {
  // tween_transform / tween_screen_effect etc: unified delegation to Handler's interpolate
    const handler = getHandler(action.type as ActionType)
    if (handler?.interpolate) {
      handler.interpolate(
        finalState,
        action,
        progress,
        baseState,
        context
      )
    }
  }
}
