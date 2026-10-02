/**
 * State utility functions (v6.2)
 * Computes runtime object states and state difference comparisons
 */

import type { SceneObject } from '@/stores/sceneObjectStore'
import type { Action, SceneSetup } from '@/types/screenplay'

import { evaluateObjectState } from './actionEvaluator'


// Phase 4e: Eliminated SubtypeSnapshotBuilder registry, use SceneObject directly

/**
 * Unified object state snapshot builder (Phase 4e simplification)
 * Returns a shallow clone of SceneObject without flattening subtype fields
 * @deprecated Use { ...obj } directly after Phase 4e
 */
export function buildObjectStateSnapshot(obj: SceneObject): SceneObject {
  return { ...obj }
}

/**
 * State difference
 */
export interface StateDiff {
  transform?: Partial<{
    x: number
    y: number
    scaleX: number
    scaleY: number
    rotation: number
    alpha: number
  }>
  active?: {
    visible: boolean
  }
}

/**
 * Get runtime state from scene object
 */
export function getObjectRuntimeState(obj: SceneObject | null | undefined): SceneObject | null {
  if (!obj) return null
  return { ...obj }
}

/**
 * Compare two states and return difference
 * Returns only changed properties
 */
export function compareObjectState(
  baseline: SceneObject,
  current: SceneObject
): StateDiff {
  const diff: StateDiff = {}

  const transformDiff: NonNullable<StateDiff['transform']> = {}

  if (baseline.x !== current.x) transformDiff.x = current.x
  if (baseline.y !== current.y) transformDiff.y = current.y
  if (baseline.scaleX !== current.scaleX) transformDiff.scaleX = current.scaleX
  if (baseline.scaleY !== current.scaleY) transformDiff.scaleY = current.scaleY
  if (baseline.rotation !== current.rotation) transformDiff.rotation = current.rotation
  if (baseline.alpha !== current.alpha) transformDiff.alpha = current.alpha

  if (Object.keys(transformDiff).length > 0) {
    diff.transform = transformDiff
  }


  // Visibility comparison
  if (baseline.visible !== current.visible) {
    diff.active = { visible: current.visible }
  }

  return diff
}

/**
 * Check whether state difference is empty
 */
export function isStateDiffEmpty(diff: StateDiff): boolean {
  const hasTransform = diff.transform && Object.keys(diff.transform).length > 0
  const hasActive = diff.active !== undefined

  return !hasTransform && !hasActive
}

/**
 * Determine action type based on updated properties (v6.3)
 * - set_transform: visual properties (alpha/visible/flipX/zIndex)
 */
export function getActionTypeFromUpdates(updates: Partial<SceneObject>): 'set_transform' | null {
  const keys = Object.keys(updates)

  // Visual properties (v6.3: alpha, visible, flipX, zIndex only)
  const visualKeys = ['alpha', 'visible', 'flipX', 'zIndex']
  const hasVisualKey = keys.some(k => visualKeys.includes(k))
  if (hasVisualKey) {
    return 'set_transform'
  }

  return null
}

/**
 * v7.0: Get target identifier from scene object (used for Action.target)
 * For character objects, returns its runtime object ID (SceneObject.id)
 */
export function getTargetAliasFromObject(obj: SceneObject): string | null {
  if (!obj) return null

  if (obj.type === 'camera') {
    return 'camera'
  }

  // All types return object ID
  return obj.id
}

/**
 * Extract transform parameters from update object (used for set_transform action)
 */
export function extractTransformParams(updates: Partial<SceneObject>): Record<string, number> | null {
  const params: Record<string, number> = {}

  if (updates.x !== undefined) params['x'] = updates.x
  if (updates.y !== undefined) params['y'] = updates.y
  if (updates.scaleX !== undefined) params['scaleX'] = updates.scaleX
  if (updates.scaleY !== undefined) params['scaleY'] = updates.scaleY
  if (updates.rotation !== undefined) params['rotation'] = updates.rotation
  if (updates.alpha !== undefined) params['alpha'] = updates.alpha

  return Object.keys(params).length > 0 ? params : null
}



/**
 * Get initial state of object from SceneSetup
 * Used in Action Mode to compute runtime object state at specified time
 */
export function getStartStateFromSetup(
  setup: SceneSetup,
  _obj: SceneObject,
  targetAlias: string
): SceneObject | null {
  // Camera special handling - construct pseudo SceneObject
  if (targetAlias === 'camera') {
    return {
      id: 'camera',
      type: 'camera',
      name: 'camera',
      refId: '',
      x: setup.camera.x,
      y: setup.camera.y,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      visible: true,
      zIndex: 0,
    } as SceneObject
  }

  // v7.0: Look up corresponding setup object directly by ID
  let setupObj: SceneObject | null = null

  for (const setupObject of setup.objects) {
    // v7.0: target is now instance ID
    if (setupObject.id === targetAlias) {
      setupObj = setupObject
      break
    }
  }

  if (!setupObj) return null

  return { ...setupObj }
}

/**
 * Compute runtime state of object at start of specified slot
 * @param setup Previous state (state before block starts)
 * @param obj Currently selected scene object
 * @param targetAlias Target alias of object (for matching Actions)
 * @param actions All actions of current block
 * @param slotStartTime Slot start time (ms)
 * @param totalDuration Total block duration (ms)
 * @param slots Runtime slot list
 */
export function computeObjectStateAtSlot(
  setup: SceneSetup,
  obj: SceneObject,
  targetAlias: string,
  actions: Action[],
  slotStartTime: number,
  totalDuration: number,
  slots?: import('@/types/screenplay').RuntimeSlot[]
): SceneObject | null {
  // Get start state (pass obj for future extension)
  const startState = getStartStateFromSetup(setup, obj, targetAlias)
  if (!startState) return null

  // Filter actions targeting this object
  const objectActions = actions.filter(a => a.target === targetAlias)

  // Use evaluateObjectState to compute state at slotStartTime
  return evaluateObjectState(
    startState,
    objectActions,
    slotStartTime,
    totalDuration,
    slots
  )
}
