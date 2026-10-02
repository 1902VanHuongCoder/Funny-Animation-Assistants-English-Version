/**
 * Scene State Calculator
 * Runtime state reconstruction for Director Mode
 * 
 * v6.3 updates:
 * - set_transform handles visual properties only (alpha, visible, flipX, zIndex)
 * - set_character inherits set_transform + character state (pose, expression)
 * - tween_transform handles geometric properties only (x, y, scaleX, scaleY, rotation)
 */

import type { CompositeObject, SceneObject } from '@/types/sceneObject'
import type { Action, BaseDurationAction, GroupSceneStructureOperation, RuntimeSceneSnapshot, SceneContainer, SceneSetup, ScriptBlock, SetSceneStructureAction } from '@/types/screenplay'
import { createRuntimeSnapshot, SCENE_ACTION_TARGET } from '@/types/screenplay'
import { type ActionType, getHandler, isObjectStateAction } from '@/utils/actionHandlers'
import type { ActionHandlerContext, WriteableState } from '@/utils/actionHandlers/types'
import { getSceneStructureSpawnedTargetsForSlot, hasCustomActionOrderForSlot, isSceneStructureSpawnedTargetTransform, sortActionsForEvaluation } from '@/utils/actionOrder'
import { getChildIdsByParentId, rebuildChildIdsFromParentIds } from '@/utils/hierarchyUtils'
import { isAllowedMaskTargetType } from '@/utils/maskUtils'
import { buildParentOverridesForSlot, sortObjectsBySlotActionOrder, sortObjectsForEvaluation } from '@/utils/objectEvaluationOrder'
import { reconcileRenderChain } from '@/utils/renderChainUtils'
import { applySetSceneStructureActionToObjects, flattenSetSceneStructureParams } from '@/utils/setSceneStructureAction'
import { parseBlockToSlots } from '@/utils/slotUtils'

// ==================== Ghost Mode Types ====================

/**
 * Runtime camera state (used for Ghost Mode)
 */
export interface RuntimeCameraState {
  x: number
  y: number
  zoom: number
}

/**
 * Ghost/Real state pair for a single object
 */
export interface GhostStateResult {
  ghost: SceneObject | null  // null indicates no ghost required
  real: SceneObject
}

/**
 * Ghost/Real state pair for camera
 */
export interface CameraGhostStateResult {
  ghost: RuntimeCameraState | null  // null indicates no ghost required
  real: RuntimeCameraState
}

/**
 * State calculation result for entire Slot
 */
export interface SlotStatesResult {
  objects: Map<string, GhostStateResult>
  camera: CameraGhostStateResult
  /** Runtime scene-level render chain (after reconciliation with reconcileRenderChain) */
  renderChain: string[]
}

/**
/**
 * Computes scene runtime snapshot before specified Block starts (prevContext)
 * @param scene Scene container
 * @param blockId Current Block ID
 * @returns RuntimeSceneSnapshot at the end of previous Block
 */
export function calculatePrevContext(scene: SceneContainer, blockId: string): RuntimeSceneSnapshot {
  // Find index of current Block
  const blockIndex = scene.script.findIndex(b => b.id === blockId)

  // If not found or this is the first Block, create snapshot directly from setup
  if (blockIndex <= 0) {
    const snapshot = createRuntimeSnapshot(scene.setup)
    return snapshot
  }

  // Starting from scene setup, apply actions from all previous Blocks sequentially
  let currentState: RuntimeSceneSnapshot = createRuntimeSnapshot(scene.setup)

  for (let i = 0; i < blockIndex; i++) {
    const block = scene.script[i]
    if (block) {
      currentState = applyBlockActionsToState(currentState, block, scene)
    }
  }

  return currentState
}

/**
 * Converts SceneSetup to RuntimeSceneSnapshot (shared references, no deep copy)
 */
export function toRuntimeSnapshot(setup: SceneSetup): RuntimeSceneSnapshot {
  return {
    objects: setup.objects,
    renderChain: setup.renderChain,
    camera: {
      x: setup.camera.x,
      y: setup.camera.y,
      zoom: setup.camera.zoom,
      shakeOffsetX: 0,
      shakeOffsetY: 0,
    },
  }
}

function reconcileRuntimeHierarchy(state: RuntimeSceneSnapshot): void {
  rebuildChildIdsFromParentIds(state.objects)

  for (const obj of state.objects) {
    if (obj.type !== 'composite') continue
    const comp = obj as CompositeObject
    if (comp.compositeMode !== 'entity') continue
    comp.renderChain = reconcileRenderChain(comp.renderChain ?? [], state.objects, obj.id)
  }

  state.renderChain = reconcileRenderChain(state.renderChain ?? [], state.objects)
}

function applySceneStructureActionToRuntimeState(state: RuntimeSceneSnapshot, action: Action): void {
  if (action.type !== 'set_scene_structure') return
  const result = applySetSceneStructureActionToObjects(state.objects, action, state.renderChain)
  if (result.renderChain) {
    state.renderChain = result.renderChain
  }
  reconcileRuntimeHierarchy(state)
}

function createSceneStructureRestoreAction(
  state: RuntimeSceneSnapshot,
  action: SetSceneStructureAction,
): SetSceneStructureAction | null {
  const operations = action.params.operations
    .filter((operation): operation is GroupSceneStructureOperation =>
      operation.kind === 'group' && operation.autoRestoreOnBlockEnd !== false
    )
    .map(operation => ({
      id: `${operation.id}_auto_restore`,
      kind: 'ungroup' as const,
      groupId: operation.groupId,
      memberIds: [...operation.memberIds],
      groupParentId: operation.parentId,
      restoreParentId: operation.parentId,
    }))

  if (operations.length === 0) return null

  const existingObjectIds = new Set(state.objects.map(obj => obj.id))
  const filteredOperations = operations
    .map(operation => ({
      ...operation,
      memberIds: operation.memberIds.filter(id => existingObjectIds.has(id)),
    }))
    .filter(operation => existingObjectIds.has(operation.groupId) || operation.memberIds.length > 0)

  if (filteredOperations.length === 0) return null

  return {
    id: `${action.id}_auto_restore`,
    type: 'set_scene_structure',
    category: 'point',
    target: SCENE_ACTION_TARGET,
    slotIndex: action.slotIndex,
    params: {
      operations: filteredOperations,
    },
  }
}

/**
 * Applies all actions in Block to state snapshot
 * Note: Used to compute final state at Block end; only processes actions affecting static state
 * @param prevState Previous state
 * @param block Script block
 * @param scene Scene container (optional, used for actor lookup)
 * @param forceAllActions Whether to force apply all actions (ignoring duration limits, for editor preview)
 * @param skipAutoDespawn Whether to skip auto despawn (default false)
 * @returns New state after applying actions
 */
export function applyBlockActionsToState(prevState: RuntimeSceneSnapshot, block: ScriptBlock, scene?: SceneContainer, forceAllActions = false, skipAutoDespawn = false): RuntimeSceneSnapshot {
  const newState: RuntimeSceneSnapshot = JSON.parse(JSON.stringify(prevState)) as RuntimeSceneSnapshot
  reconcileRuntimeHierarchy(newState)

  if (!block.actions || block.actions.length === 0) {
    return newState
  }

  // Calculate total Block duration (used to calculate final values of duration actions)
  // let blockDuration = 0 // Unused
  // if (block.type === 'dialogue' || block.type === 'narration') {
  //   blockDuration = block.ttsConfig?.duration ?? 0
  // } else if ((block as unknown as { type: string }).type === 'action') {
  //   blockDuration = (block as unknown as { duration: number }).duration ?? 0
  // }

  // Parse slot information
  const slots = parseBlockToSlots(block)

  // Build objectId -> prevState.objects index map (for sorting set_parent within same slot)
  const objectIndexMap = new Map<string, number>()
  prevState.objects.forEach((obj, idx) => {
    objectIndexMap.set(obj.id, idx)
  })

  // Apply each action (in slot index order; sort set_parent in same slot by target object position)
  const sortedActions = sortActionsForEvaluation(block.actions, objectIndexMap)
  const sceneStructureRestoreActions: SetSceneStructureAction[] = []

  // P2 + v17: Actions needing cross-object state access share context
  // - set_parent: Coordinate compensation reads parent object position
  // - set_lifecycle: Composite despawn cascades/bubbles child objects
  // - set_transform / tween_transform: Global -> local coordinate conversion reads parent coordinate and flipX
  const ctx: import('@/utils/actionHandlers/types').ActionHandlerContext = {
    getObjectState: (id: string) => {
      const obj = newState.objects.find(o => o.id === id)
      return obj ? (obj as unknown as WriteableState) : undefined
    },
    objects: newState.objects as unknown as WriteableState[],
  }

  for (const action of sortedActions) {
    if (action.type === 'set_scene_structure') {
      const restoreAction = createSceneStructureRestoreAction(newState, action)
      if (restoreAction) sceneStructureRestoreActions.push(restoreAction)
      const result = applySetSceneStructureActionToObjects(newState.objects, action, newState.renderChain)
      if (result.renderChain) newState.renderChain = result.renderChain
      continue
    }

    // Get Handler (action types without Handler are skipped automatically, e.g. set_anim/camera_shake/camera_follow)
    const handler = getHandler(action.type as ActionType)
    if (!handler) continue

    // Duration action: check if completed within Block
    if (handler.isDurationAction) {
      const durationAction = action as BaseDurationAction
      if (durationAction.slotIndex >= slots.length) continue
      const endSlotIndex = durationAction.slotIndex + (durationAction.slotSpan || 1)
      const isActionCompleted = endSlotIndex <= slots.length
      if (!forceAllActions && !isActionCompleted) continue
    }

    // Camera action: apply to newState.camera
    if (action.target === 'camera') {
      handler.applyToState(newState.camera as WriteableState, action)
      continue
    }

    // Object action: look up target object
    const targetObj = findTargetObject(newState, action.target, scene)
    if (!targetObj) continue

    // Screen effect action: Handler operates directly on state.params without flat -> params adaptation
    if (action.type === 'set_screen_effect' || action.type === 'tween_screen_effect') {
      handler.applyToState(targetObj as unknown as WriteableState, action)
      continue
    }

    // Light action: Handler directly operates on light fields on state (mirrors screen_effect branch)
    if (action.type === 'set_light' || action.type === 'tween_light') {
      handler.applyToState(targetObj as unknown as WriteableState, action)
      continue
    }

    // Actions requiring cross-object state access receive ctx; others delegate directly
    if (action.type === 'set_lifecycle' || action.type === 'set_transform' || action.type === 'tween_transform') {
      handler.applyToState(targetObj as WriteableState, action, ctx)
    } else if (action.type === 'set_mask') {
      // Clip-Mask Phase 1: set_mask is not applied directly in main loop,
      // but unified in mask post-pass below for same-slot folding + cross-mask exclusivity arbitration (D1.5).
      continue
    } else {
      handler.applyToState(targetObj as WriteableState, action)
    }

  }

  reconcileRuntimeHierarchy(newState)

  // ========== Clip-Mask Phase 1: Mask post-pass (D1.5 same-slot target merging) ==========
  // See docs/features/clip-mask.md §3 D1.5
  applyMaskPostPass(prevState, newState, sortedActions)

  // v9.5: After applying all actions, handle autoDespawnOnBlockEnd
  // skipAutoDespawn=true skips this step (for accumulatedParentIds needing real state after set_parent)
  if (!skipAutoDespawn) {
    // For birth actions (spawned=true) with autoDespawnOnBlockEnd !== false,
    // if no manual despawn action exists in same Block, automatically set spawned to false
    const birthActions = sortedActions.filter(
      a => a.type === 'set_lifecycle'
        && (a.params as { spawned: boolean; autoDespawnOnBlockEnd?: boolean }).spawned === true
    )
    for (const birthAction of birthActions) {
      const lifecycleParams = birthAction.params as { spawned: boolean; autoDespawnOnBlockEnd?: boolean }
      if (lifecycleParams.autoDespawnOnBlockEnd === false) continue

      // Check if manual despawn exists in same Block
      const hasManualDespawn = sortedActions.some(
        a => a.type === 'set_lifecycle'
          && a.target === birthAction.target
          && (a.params as { spawned: boolean }).spawned === false
      )
      if (hasManualDespawn) continue

      // Auto despawn: modify state
      const autoDespawnTarget = findTargetObject(newState, birthAction.target, scene)
      if (autoDespawnTarget) {
        autoDespawnTarget.spawned = false

        if (autoDespawnTarget.type === 'composite') {
          const childIds = getChildIdsByParentId(newState.objects, autoDespawnTarget.id)
          const compositeMode = (autoDespawnTarget as unknown as { compositeMode?: string }).compositeMode ?? 'entity'
          if (childIds.length > 0 && compositeMode === 'entity') {
            for (const childId of childIds) {
              const childObj = findTargetObject(newState, childId, scene)
              if (childObj) childObj.spawned = false
            }
          }
        }
      }
    }

  } // end if (!skipAutoDespawn)

  for (const action of sceneStructureRestoreActions.reverse()) {
    const result = applySetSceneStructureActionToObjects(newState.objects, action, newState.renderChain)
    if (result.renderChain) newState.renderChain = result.renderChain
  }

  reconcileRuntimeHierarchy(newState)

  return newState
}

/**
 * Clip-Mask Phase 1: D1.5 same-slot target merging + cross-mask exclusivity arbitration
 *
 * See docs/features/clip-mask.md §3 D1.5 and
 * docs/features/clip-mask.md §11.4.3.
 *
 * Algorithm (processed slot-by-slot in ascending slotIndex order):
 *   1. Fold: participating mask set_mask partially applied in chronological order within slot
 *      (targetIds full replacement, shape/width/height overwrite)
 *      -> yields candidate.targetIds for each participating mask.
 *   2. Construct Claimers(t): participating masks (candidate contains t) union upstream owner holding t without participating in this slot.
 *   3. Arbitrate: when |Claimers| >= 2, select head by stable ascending index of masks in newState.objects,
 *      prune rest from candidates with aggregated warning; non-participating masks silently retain ("no implicit release").
 *   4. Write-back: only masks *explicitly participating* in this slot are modified; non-participants (including original owner) untouched.
 *
 * Exported for fine-grained interactive previews (ScenePlayer.evaluateStates / FrameCapture) to reuse identical post-processing logic,
 * avoiding loss of cross-mask exclusivity / order-independent transfer semantics when applying set_mask per object in applyPreviewObjectAction.
 */
export function applyMaskPostPass(
  prevState: RuntimeSceneSnapshot,
  newState: RuntimeSceneSnapshot,
  sortedActions: Action[],
): void {
  type MaskLikeObj = SceneObject & { type: 'mask'; targetIds: string[]; shape: 'rectangle' | 'ellipse'; width: number; height: number }

  // Collect set_mask (grouped by slotIndex; preserving sortedActions order within group)
  const setMasksBySlot = new Map<number, import('@/types/screenplay').SetMaskAction[]>()
  for (const a of sortedActions) {
    if (a.type !== 'set_mask') continue
    const list = setMasksBySlot.get(a.slotIndex) ?? []
    list.push(a)
    setMasksBySlot.set(a.slotIndex, list)
  }
  if (setMasksBySlot.size === 0) return

  // Initialize mask running state (from prevState)
  const running = new Map<string, string[]>() // maskId → targetIds
  for (const obj of prevState.objects) {
    if (obj.type === 'mask') {
      running.set(obj.id, [...((obj as MaskLikeObj).targetIds ?? [])])
    }
  }
  // Include newly spawned masks within this block (not in prevState but existing in newState)
  for (const obj of newState.objects) {
    if (obj.type === 'mask' && !running.has(obj.id)) {
      // New mask initial targetIds taken from setupState defaults (masks in newState were skipped by main loop set_mask,
      // so targetIds is currently setup original value; use as pre-block running)
      running.set(obj.id, [...((obj as MaskLikeObj).targetIds ?? [])])
    }
  }

  // Mask stable index (newState.objects order)
  const maskIndex = new Map<string, number>()
  newState.objects.forEach((o, i) => {
    if (o.type === 'mask') maskIndex.set(o.id, i)
  })

  // Target validity index: alive in newState with permitted type (matching maskUtils.isAllowedMaskTargetType)
  // Used to prune illegal or dead-reference targetIds introduced by manual edits / legacy project leftovers / deserialization gaps.
  const validTargetIds = new Set<string>()
  for (const o of newState.objects) {
    if (isAllowedMaskTargetType(o.type)) validTargetIds.add(o.id)
  }
  const sanitize = (ids: string[], maskId: string): { kept: string[]; dropped: string[] } => {
    const kept: string[] = []
    const dropped: string[] = []
    for (const id of ids) {
      // Disallow mask self-reference
      if (id === maskId) { dropped.push(id); continue }
      if (validTargetIds.has(id)) kept.push(id)
      else dropped.push(id)
    }
    return { kept, dropped }
  }

  // Process in ascending slotIndex order
  const slotOrder = [...setMasksBySlot.keys()].sort((a, b) => a - b)
  for (const slot of slotOrder) {
    const actions = setMasksBySlot.get(slot)!

    // 1. In-slot folding: merge fields chronologically for each participating mask within slot
    interface Folded { targetIds?: string[]; shape?: 'rectangle' | 'ellipse'; width?: number; height?: number }
    const folded = new Map<string, Folded>()
    for (const a of actions) {
      const cur = folded.get(a.target) ?? {}
      if (a.params.targetIds !== undefined) cur.targetIds = [...a.params.targetIds]
      if (a.params.shape !== undefined) cur.shape = a.params.shape
      if (a.params.width !== undefined && Number.isFinite(a.params.width) && a.params.width > 0) cur.width = a.params.width
      if (a.params.height !== undefined && Number.isFinite(a.params.height) && a.params.height > 0) cur.height = a.params.height
      folded.set(a.target, cur)
    }

    // 2. Candidate targetIds: participating masks take folded.targetIds (keep running if undefined)
    //    Simultaneously sanitize: prune illegal types / dead references / self-references.
    const candidate = new Map<string, string[]>() // Participating masks only
    const sanitizeWarnings: string[] = []
    for (const [maskId, f] of folded) {
      const raw = f.targetIds !== undefined
        ? [...f.targetIds]
        : [...(running.get(maskId) ?? [])]
      const { kept, dropped } = sanitize(raw, maskId)
      if (dropped.length > 0) {
        sanitizeWarnings.push(`mask=${maskId} dropped=${dropped.join(',')}`)
      }
      candidate.set(maskId, kept)
    }
    // Also sanitize running of non-participating masks, preventing them from introducing deleted / invalid IDs
    // into Claimers calculation below (without mutating running itself — preserving "no implicit release" semantics).
    const runningSanitized = new Map<string, string[]>()
    for (const [maskId, ids] of running) {
      if (folded.has(maskId)) continue
      const { kept } = sanitize(ids, maskId)
      runningSanitized.set(maskId, kept)
    }
    if (sanitizeWarnings.length > 0) {
      console.warn(`[set_mask] slot ${slot}: invalid targetIds dropped — ${sanitizeWarnings.join('; ')}`)
    }

    // 3. Construct Claimers(t)
    const claimers = new Map<string, string[]>() // targetId → maskId[]
    const pushClaimer = (t: string, m: string) => {
      const arr = claimers.get(t)
      if (arr) {
        if (!arr.includes(m)) arr.push(m)
      } else {
        claimers.set(t, [m])
      }
    }
    for (const [maskId, targets] of candidate) {
      for (const t of targets) pushClaimer(t, maskId)
    }
    for (const [maskId, targets] of runningSanitized) {
      for (const t of targets) pushClaimer(t, maskId)
    }

    // 4. Arbitrate: stable index ascending order selects first
    const evicted: { maskId: string; target: string; winner: string }[] = []
    for (const [t, masks] of claimers) {
      if (masks.length < 2) continue
      const sorted = [...masks].sort(
        (a, b) => (maskIndex.get(a) ?? Number.POSITIVE_INFINITY) - (maskIndex.get(b) ?? Number.POSITIVE_INFINITY),
      )
      const winner = sorted[0]!
      for (const loser of sorted.slice(1)) {
        // Non-participating mask (original owner) silently retains t — do not modify its running
        if (!folded.has(loser)) continue
        const arr = candidate.get(loser)
        if (!arr) continue
        const idx = arr.indexOf(t)
        if (idx !== -1) arr.splice(idx, 1)
        evicted.push({ maskId: loser, target: t, winner })
      }
    }

    if (evicted.length > 0) {
      const summary = evicted
        .map(e => `target=${e.target} winner=${e.winner} loser=${e.maskId}`)
        .join('; ')
      console.warn(`[set_mask] slot ${slot}: contested targets resolved by stable index — ${summary}`)
    }

    // 5. Write back: participating masks only
    for (const [maskId, f] of folded) {
      const obj = newState.objects.find(o => o.id === maskId) as MaskLikeObj | undefined
      if (!obj || obj.type !== 'mask') continue
      const finalTargets = candidate.get(maskId) ?? []
      obj.targetIds = [...finalTargets]
      if (f.shape !== undefined) obj.shape = f.shape
      if (f.width !== undefined) obj.width = f.width
      if (f.height !== undefined) obj.height = f.height
      running.set(maskId, [...finalTargets])
    }
  }
}

/**
 * Look up target object
 * @param setup Scene setup
 * @param target Target identifier (instance ID or objectId)
 * @param scene Scene container (optional, used for actor lookup)
 */
function findTargetObject(
  setup: { objects: SceneObject[] },
  target: string,
  _scene?: SceneContainer
): SceneObject | null {
  // First attempt lookup by objectId
  let targetObj = setup.objects.find(obj => obj.id === target)
  if (targetObj) return targetObj

  // If camera, return camera object (requires special handling)
  if (target === 'camera') {
    // Camera is not in objects, requires special handling
    return null
  }

  // v7.0: target is now instance ID, look up directly by ID
  targetObj = setup.objects.find(obj => obj.id === target)
  if (targetObj) return targetObj

  return null
}

/**
 * Update action in Block
 * @param scene Scene container
 * @param blockId Block ID
 * @param actionIndex Action index
 * @param updates Update content
 */
export function updateActionInBlock(
  scene: SceneContainer,
  blockId: string,
  actionIndex: number,
  updates: Partial<Action>
): void {
  const block = scene.script.find(b => b.id === blockId)
  if (!block?.actions) return

  if (actionIndex >= 0 && actionIndex < block.actions.length) {
    const targetAction = block.actions[actionIndex]
    if (targetAction) {
      Object.assign(targetAction, updates)
    }
  }
}

/**
 * Add action to Block
 * @param scene Scene container
 * @param blockId Block ID
 * @param action New action
 */
export function addActionToBlock(
  scene: SceneContainer,
  blockId: string,
  action: Action
): void {
  const block = scene.script.find(b => b.id === blockId)
  if (!block) return

  if (!block.actions) {
    block.actions = []
  }

  block.actions.push(action)
}

// ==================== Ghost Mode Core Functions ====================

/**
 * Determine whether action affects target object (point action)
 */
function isPointActionForTarget(action: Action, targetId: string): boolean {
  if (action.target !== targetId) return false
  return action.category === 'point' && isObjectStateAction(action)
}

/**
 * Determine whether action affects target object (duration action)
 */
function isDurationActionForTarget(action: Action, targetId: string): boolean {
  if (action.target !== targetId) return false
  return action.category === 'duration' && isObjectStateAction(action)
}

function getSceneStructureParentTargetsForSlot(actions: readonly Action[], slotIndex: number): Set<string> {
  const parentTargets = new Set<string>()
  for (const action of actions) {
    if (action.slotIndex !== slotIndex || action.type !== 'set_scene_structure') continue
    const patch = flattenSetSceneStructureParams(action.params)
    for (const parentId of Object.values(patch.parentById)) {
      if (parentId) parentTargets.add(parentId)
    }
  }
  return parentTargets
}

const SPATIAL_TRANSFORM_KEYS = [
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotation',
  'transformOriginX',
  'transformOriginY',
] as const

/**
 * Ghost is a spatial before/after aid. Non-spatial state changes still apply
 * to real state at the current slot, but they should not create a ghost layer.
 */
function shouldCreateObjectGhost(action: Action): boolean {
  if (action.type !== 'set_transform' && action.type !== 'tween_transform') {
    return false
  }

  const params = action.params as Record<string, unknown> | undefined
  return SPATIAL_TRANSFORM_KEYS.some(key => params?.[key] !== undefined)
}

function isPreStructurePointAction(
  action: Action,
  currentSlotSceneStructureSpawnedTargets: ReadonlySet<string>,
): boolean {
  if (action.category !== 'point') return false
  if (!isObjectStateAction(action)) return false
  if (action.type === 'set_scene_structure') return false

  if (action.type === 'set_lifecycle' || action.type === 'set_visual') {
    return true
  }

  if (action.type === 'set_transform') {
    return !isSceneStructureSpawnedTargetTransform(action, currentSlotSceneStructureSpawnedTargets)
  }

  return false
}

function isPostStructurePointAction(
  action: Action,
  currentSlotSceneStructureSpawnedTargets: ReadonlySet<string>,
): boolean {
  if (action.category !== 'point') return false
  if (!isObjectStateAction(action)) return false
  if (action.type === 'set_scene_structure') return false
  return !isPreStructurePointAction(action, currentSlotSceneStructureSpawnedTargets)
}

function getObjectStateBeforeActionSlot(
  prevContext: RuntimeSceneSnapshot,
  sortedActions: Action[],
  objId: string,
  actionSlotIndex: number,
  fallback: SceneObject,
): SceneObject {
  const ghostState: RuntimeSceneSnapshot = JSON.parse(JSON.stringify(prevContext)) as RuntimeSceneSnapshot

  for (const action of sortedActions) {
    if (action.target !== objId) continue
    if (action.slotIndex >= actionSlotIndex) break

    if (action.category === 'point' && isObjectStateAction(action)) {
      const idx = ghostState.objects.findIndex(o => o.id === objId)
      if (idx !== -1) {
        ghostState.objects[idx] = applyActionToObjectWithContext(ghostState.objects[idx]!, action, ghostState)
        rebuildChildIdsFromParentIds(ghostState.objects)
      }
    } else if (action.category === 'duration' && isDurationActionForTarget(action, objId)) {
      const span = (action as { slotSpan?: number }).slotSpan ?? 1
      if (action.slotIndex + span <= actionSlotIndex) {
        const idx = ghostState.objects.findIndex(o => o.id === objId)
        if (idx !== -1) {
          ghostState.objects[idx] = applyActionToObjectWithContext(ghostState.objects[idx]!, action, ghostState)
          rebuildChildIdsFromParentIds(ghostState.objects)
        }
      }
    }
  }

  return ghostState.objects.find(o => o.id === objId) ?? fallback
}

/**
 * Determine camera point action
 */
function isCameraPointAction(action: Action): boolean {
  return action.target === 'camera' && action.type === 'camera_cut'
}

/**
 * Determine camera duration action (camera_move supports Ghost)
 */
function isCameraDurationAction(action: Action): boolean {
  return action.target === 'camera' && action.type === 'camera_move'
}

/**
 * Apply action with context (set_parent / set_lifecycle requires access to other object states)
 * - set_parent: Coordinate compensation needs to read parent object position
 * - set_lifecycle: Composite despawn needs to cascade/bubble child objects
 */
function applyActionToObjectWithContext(
  state: SceneObject,
  action: Action,
  allState: { objects: SceneObject[] }
): SceneObject {
  const newState: SceneObject = JSON.parse(JSON.stringify(state)) as SceneObject

  const handler = getHandler(action.type as ActionType)
  if (handler) {
    if (action.type === 'set_lifecycle' || action.type === 'set_transform' || action.type === 'tween_transform') {
      const ctx: ActionHandlerContext = {
        getObjectState: (id: string) => {
          const obj = allState.objects.find(o => o.id === id)
          return obj ? (obj as unknown as WriteableState) : undefined
        },
        objects: allState.objects as unknown as WriteableState[],
      }
      handler.applyToState(newState as unknown as WriteableState, action, ctx)
    } else {
      handler.applyToState(newState as unknown as WriteableState, action)
    }
  }

  return newState
}

/**
 * Apply action to camera state
 */
function applyActionToCamera(state: RuntimeCameraState, action: Action): RuntimeCameraState {
  const newState: RuntimeCameraState = { ...state }

  if (action.type === 'camera_cut' || action.type === 'camera_move') {
    if (action.params.x !== undefined) newState.x = action.params.x
    if (action.params.y !== undefined) newState.y = action.params.y
    if (action.params.zoom !== undefined) newState.zoom = action.params.zoom
  }

  return newState
}

/**
 * Calculate Ghost/Real states for all objects and camera at specified Slot
 * 
 * @param scene Scene container
 * @param block Current Block
 * @param slotIndex Currently selected Slot index
 * @param prevContextOverride Optional previous context override
 * @returns SlotStatesResult containing state pairs for all objects and camera
 */
export function calculateSlotStates(
  scene: SceneContainer,
  block: ScriptBlock,
  slotIndex: number,
  prevContextOverride?: RuntimeSceneSnapshot
): SlotStatesResult {
  const results = new Map<string, GhostStateResult>()

  // 1. Calculate base state before Block starts (PrevContext)
  const prevContext = prevContextOverride ?? calculatePrevContext(scene, block.id)
  const actions = block.actions || []

  // 2. Calculate BaseState: apply all completed actions where slotIndex < currentSlot
  // This is the state "at the start of current Slot"
  const baseState: RuntimeSceneSnapshot = JSON.parse(JSON.stringify(prevContext)) as RuntimeSceneSnapshot
  reconcileRuntimeHierarchy(baseState)

  // Build objectId -> prevContext.objects index mapping (for set_parent sorting in same slot)
  const objectIndexMap = new Map<string, number>()
  prevContext.objects.forEach((obj, idx) => {
    objectIndexMap.set(obj.id, idx)
  })

  const sortedActions = sortActionsForEvaluation(actions, objectIndexMap)
  const currentSlotSceneStructureSpawnedTargets = getSceneStructureSpawnedTargetsForSlot(sortedActions, slotIndex)
  const currentSlotSceneStructureParentTargets = getSceneStructureParentTargetsForSlot(sortedActions, slotIndex)

  for (const action of sortedActions) {
    if (action.type === 'set_scene_structure') {
      if (action.slotIndex < slotIndex) {
        applySceneStructureActionToRuntimeState(baseState, action)
      }
      continue
    }

    // Process actions completed before current Slot only
    if (action.category === 'point' && action.slotIndex < slotIndex) {
      // Point action: triggered before slotIndex
      const targetObj = findTargetObject(baseState, action.target, scene)
      if (targetObj) {
        const idx = baseState.objects.findIndex(o => o.id === action.target)
        if (idx !== -1) {
          baseState.objects[idx] = applyActionToObjectWithContext(targetObj, action, baseState)
          reconcileRuntimeHierarchy(baseState)
        }
      }
      // Camera action
      if (action.target === 'camera' && action.type === 'camera_cut') {
        baseState.camera = {
          ...baseState.camera,
          ...applyActionToCamera({
            x: baseState.camera.x,
            y: baseState.camera.y,
            zoom: baseState.camera.zoom
          }, action)
        }
      }
    } else if (action.category === 'duration') {
      const span = (action as { slotSpan?: number }).slotSpan ?? 1
      const endSlot = action.slotIndex + span
      // Duration action: completed before current Slot
      if (endSlot <= slotIndex) {
        const targetObj = findTargetObject(baseState, action.target, scene)
        if (targetObj) {
          const idx = baseState.objects.findIndex(o => o.id === action.target)
          if (idx !== -1) {
            baseState.objects[idx] = applyActionToObjectWithContext(targetObj, action, baseState)
            reconcileRuntimeHierarchy(baseState)
          }
        }
      // Camera action
        if (action.target === 'camera' && action.type === 'camera_move') {
          baseState.camera = {
            ...baseState.camera,
            ...applyActionToCamera({
              x: baseState.camera.x,
              y: baseState.camera.y,
              zoom: baseState.camera.zoom
            }, action)
          }
        }
      }
    }
  }

  // 3. Traverse all objects, compute Ghost/Real states
  if (hasCustomActionOrderForSlot(sortedActions, slotIndex)) {
    const slotStartState: RuntimeSceneSnapshot = JSON.parse(JSON.stringify(baseState)) as RuntimeSceneSnapshot
    const directPointGhostTargets = new Set<string>()

    for (const action of sortedActions) {
      if (action.category !== 'point' || action.slotIndex !== slotIndex) continue

      if (action.type === 'set_scene_structure') {
        applySceneStructureActionToRuntimeState(baseState, action)
        continue
      }

      if (action.target === 'camera' || !isObjectStateAction(action)) continue

      const idx = baseState.objects.findIndex(o => o.id === action.target)
      if (idx === -1) continue

      if (shouldCreateObjectGhost(action)) {
        directPointGhostTargets.add(action.target)
      }
      baseState.objects[idx] = applyActionToObjectWithContext(baseState.objects[idx]!, action, baseState)
      reconcileRuntimeHierarchy(baseState)
    }

    const sortedObjects = sortObjectsForEvaluation(baseState.objects)
    for (const objSetup of sortedObjects) {
      const objId = objSetup.id
      const slotStartObj = slotStartState.objects.find(o => o.id === objId)
      let realState = JSON.parse(JSON.stringify(baseState.objects.find(o => o.id === objId) ?? objSetup)) as SceneObject
      let ghostState = directPointGhostTargets.has(objId) && slotStartObj
        ? JSON.parse(JSON.stringify(slotStartObj)) as SceneObject
        : null

      const activeDurationActions = sortedActions.filter(a => {
        if (!isDurationActionForTarget(a, objId)) return false
        const span = (a as { slotSpan?: number }).slotSpan ?? 1
        return a.slotIndex <= slotIndex && slotIndex < a.slotIndex + span
      })
      const activeGhostDurationActions = activeDurationActions.filter(shouldCreateObjectGhost)

      if (activeDurationActions.length > 0) {
        if (!ghostState && activeGhostDurationActions.length > 0) {
          const earliestGhostAction = activeGhostDurationActions.reduce((prev, curr) =>
            curr.slotIndex < prev.slotIndex ? curr : prev
          )
          ghostState = JSON.parse(JSON.stringify(
            getObjectStateBeforeActionSlot(prevContext, sortedActions, objId, earliestGhostAction.slotIndex, objSetup)
          )) as SceneObject
        }
        for (const action of activeDurationActions) {
          realState = applyActionToObjectWithContext(realState, action, baseState)
        }
        const baseIdx = baseState.objects.findIndex(o => o.id === objId)
        if (baseIdx !== -1) {
          baseState.objects[baseIdx] = JSON.parse(JSON.stringify(realState)) as SceneObject
          reconcileRuntimeHierarchy(baseState)
        }
      }

      results.set(objId, {
        ghost: ghostState,
        real: realState,
      })
    }
  } else {
  const parentOverrides = buildParentOverridesForSlot(sortedActions, slotIndex)
  const sortedObjects = sortObjectsForEvaluation(
    sortObjectsBySlotActionOrder(baseState.objects, sortedActions, slotIndex),
    parentOverrides,
  )
  for (const objSetup of sortedObjects) {
    const objId = objSetup.id
    const baseObj = baseState.objects.find(o => o.id === objId) ?? objSetup

    // Phase A: pre-structure actions keep WYSIWYG reparent/grouping behavior.
    const preStructurePointActions = sortedActions.filter(a =>
      isPointActionForTarget(a, objId)
      && a.slotIndex === slotIndex
      && isPreStructurePointAction(a, currentSlotSceneStructureSpawnedTargets)
    )

    const activeDurationActions = sortedActions.filter(a => {
      if (!isDurationActionForTarget(a, objId)) return false
      if (currentSlotSceneStructureSpawnedTargets.has(objId)) return false
      if (currentSlotSceneStructureParentTargets.has(objId)) return false
      const span = (a as { slotSpan?: number }).slotSpan ?? 1
      return a.slotIndex <= slotIndex && slotIndex < a.slotIndex + span
    })
    const hasPointGhostAction = preStructurePointActions.some(shouldCreateObjectGhost)
    const activeGhostDurationActions = activeDurationActions.filter(shouldCreateObjectGhost)

    // Case A: Has point action
    if (preStructurePointActions.length > 0) {
      let realState = JSON.parse(JSON.stringify(baseObj)) as SceneObject
      for (const action of preStructurePointActions) {
        realState = applyActionToObjectWithContext(realState, action, baseState)
      }
      // Also apply active duration action target states
      for (const action of activeDurationActions) {
        realState = applyActionToObjectWithContext(realState, action, baseState)
      }

      // v19: GCA fix — write evaluation result within current slot back to baseState,
      // so subsequent child object globalToLocal can read parent's latest position.
      // Otherwise child globalToLocal uses parent position at slot start rather than accumulated update.
      const baseIdx = baseState.objects.findIndex(o => o.id === objId)
      if (baseIdx !== -1) {
        baseState.objects[baseIdx] = JSON.parse(JSON.stringify(realState)) as SceneObject
        reconcileRuntimeHierarchy(baseState)
      }

      let ghostState: SceneObject | null = null
      if (hasPointGhostAction) {
        ghostState = JSON.parse(JSON.stringify(baseObj)) as SceneObject
      } else if (activeGhostDurationActions.length > 0) {
        const earliestGhostAction = activeGhostDurationActions.reduce((prev, curr) =>
          curr.slotIndex < prev.slotIndex ? curr : prev
        )
        ghostState = JSON.parse(JSON.stringify(
          getObjectStateBeforeActionSlot(prevContext, sortedActions, objId, earliestGhostAction.slotIndex, baseObj)
        )) as SceneObject
      }

      results.set(objId, {
        ghost: ghostState,
        real: realState
      })
      continue
    }

    // Case B: Has ongoing duration action
    if (activeDurationActions.length > 0) {
      const earliestGhostAction = activeGhostDurationActions.length > 0
        ? activeGhostDurationActions.reduce((prev, curr) =>
          curr.slotIndex < prev.slotIndex ? curr : prev
        )
        : null
      const ghostObj = earliestGhostAction
        ? getObjectStateBeforeActionSlot(prevContext, sortedActions, objId, earliestGhostAction.slotIndex, baseObj)
        : null

      // Real State: apply target state of all active duration actions
      let realState = JSON.parse(JSON.stringify(baseObj)) as SceneObject
      for (const action of activeDurationActions) {
        realState = applyActionToObjectWithContext(realState, action, baseState)
      }

      // v19: GCA fix — same as Case A, write back to baseState for subsequent child objects
      const baseIdx = baseState.objects.findIndex(o => o.id === objId)
      if (baseIdx !== -1) {
        baseState.objects[baseIdx] = JSON.parse(JSON.stringify(realState)) as SceneObject
        reconcileRuntimeHierarchy(baseState)
      }

      results.set(objId, {
        ghost: ghostObj ? JSON.parse(JSON.stringify(ghostObj)) as SceneObject : null,
        real: realState
      })
      continue
    }

    // Case C: No action (Idle)
    results.set(objId, {
      ghost: null,
      real: JSON.parse(JSON.stringify(baseObj)) as SceneObject
    })
  }

  for (const action of sortedActions) {
    if (action.type === 'set_scene_structure' && action.slotIndex === slotIndex) {
      applySceneStructureActionToRuntimeState(baseState, action)
    }
  }

  // Phase C: relationship-dependent actions see the final current-slot tree.
  for (const action of sortedActions) {
    if (action.slotIndex !== slotIndex) continue
    if (!isPostStructurePointAction(action, currentSlotSceneStructureSpawnedTargets)) continue

    const idx = baseState.objects.findIndex(o => o.id === action.target)
    if (idx === -1) continue

    const nextState = applyActionToObjectWithContext(baseState.objects[idx]!, action, baseState)
    baseState.objects[idx] = nextState
    reconcileRuntimeHierarchy(baseState)

    const result = results.get(action.target)
    if (result) {
      result.real = JSON.parse(JSON.stringify(nextState)) as SceneObject
    } else {
      results.set(action.target, {
        ghost: null,
        real: JSON.parse(JSON.stringify(nextState)) as SceneObject,
      })
    }
  }

  const delayedDurationTargets = new Set([
    ...currentSlotSceneStructureSpawnedTargets,
    ...currentSlotSceneStructureParentTargets,
  ])
  for (const objId of delayedDurationTargets) {
    const activeDurationActions = sortedActions.filter(a => {
      if (!isDurationActionForTarget(a, objId)) return false
      const span = (a as { slotSpan?: number }).slotSpan ?? 1
      return a.slotIndex <= slotIndex && slotIndex < a.slotIndex + span
    })
    if (activeDurationActions.length === 0) continue
    const activeGhostDurationActions = activeDurationActions.filter(shouldCreateObjectGhost)

    const idx = baseState.objects.findIndex(o => o.id === objId)
    if (idx === -1) continue

    const beforeDelayedDuration = JSON.parse(JSON.stringify(baseState.objects[idx]!)) as SceneObject
    let nextState = baseState.objects[idx]!
    for (const action of activeDurationActions) {
      nextState = applyActionToObjectWithContext(nextState, action, baseState)
    }
    baseState.objects[idx] = nextState
    reconcileRuntimeHierarchy(baseState)

    const result = results.get(objId)
    if (result) {
      if (!result.ghost && activeGhostDurationActions.length > 0) {
        if (currentSlotSceneStructureSpawnedTargets.has(objId)) {
          result.ghost = beforeDelayedDuration
        } else {
          const earliestGhostAction = activeGhostDurationActions.reduce((prev, curr) =>
            curr.slotIndex < prev.slotIndex ? curr : prev
          )
          result.ghost = JSON.parse(JSON.stringify(
            getObjectStateBeforeActionSlot(prevContext, sortedActions, objId, earliestGhostAction.slotIndex, beforeDelayedDuration)
          )) as SceneObject
        }
      }
      result.real = JSON.parse(JSON.stringify(nextState)) as SceneObject
    } else {
      let ghost: SceneObject | null = null
      if (activeGhostDurationActions.length > 0) {
        if (currentSlotSceneStructureSpawnedTargets.has(objId)) {
          ghost = beforeDelayedDuration
        } else {
          const earliestGhostAction = activeGhostDurationActions.reduce((prev, curr) =>
            curr.slotIndex < prev.slotIndex ? curr : prev
          )
          ghost = JSON.parse(JSON.stringify(
            getObjectStateBeforeActionSlot(prevContext, sortedActions, objId, earliestGhostAction.slotIndex, beforeDelayedDuration)
          )) as SceneObject
        }
      }
      results.set(objId, {
        ghost,
        real: JSON.parse(JSON.stringify(nextState)) as SceneObject,
      })
    }
  }
  }

  // 3.5 Post-process: synchronize composite childIds + child object parentId
  // In Phase 3 per-object evaluation, handler cross-object modifications (via ctx.getObjectState) write to baseState,
  // but modified object results.real may already be generated (evaluation order issue), requiring sync from baseState.

  reconcileRuntimeHierarchy(baseState)

  // Pass 1: synchronize composite childIds and renderChain
  for (const [objId, result] of results) {
    const baseObj = baseState.objects.find(o => o.id === objId)
    if (baseObj?.type !== 'composite') continue

    const baseChildIds = (baseObj as unknown as { childIds?: string[] }).childIds
    if (baseChildIds) {
      ; (result.real as unknown as { childIds: string[] }).childIds = [...baseChildIds]
      if (result.ghost) {
        ; (result.ghost as unknown as { childIds: string[] }).childIds = [...baseChildIds]
      }
    }

    // v19: incrementally reconcile entity renderChain
    const baseMode = (baseObj as CompositeObject).compositeMode
    if (baseMode === 'entity') {
      const existingChain = (baseObj as CompositeObject).renderChain ?? []
      const reconciledChain = reconcileRenderChain(existingChain, baseState.objects, objId)
      ;(result.real as CompositeObject).renderChain = reconciledChain
      if (result.ghost) {
        ;(result.ghost as CompositeObject).renderChain = reconciledChain
      }
    }
  }

  // v21: incrementally reconcile scene-level renderChain (handles root object set changes from spawn/despawn)
  baseState.renderChain = reconcileRenderChain(
    baseState.renderChain ?? [], baseState.objects
  )

  // Pass 2: synchronize parentId and coordinates for all objects
  // SetLifecycleHandler (birth attachment / death bubbling) and SetParentHandler may modify
  // parentId / coords / spawned of other objects in baseState via ctx, which may already be generated in Phase 3.
  // Global traversal ensures all cross-object modifications sync to results regardless of evaluation order.
  for (const [objId, result] of results) {
    const baseObj = baseState.objects.find(o => o.id === objId)
    if (!baseObj) continue
    // parentId change: sync parentId + coordinates + flipX (birth attach / death bubble / set_parent)
    if (result.real.parentId !== baseObj.parentId) {
      ;(result.real as unknown as { parentId: string | undefined }).parentId = baseObj.parentId
      result.real.x = baseObj.x
      result.real.y = baseObj.y
      result.real.scaleX = baseObj.scaleX
      result.real.scaleY = baseObj.scaleY
      result.real.rotation = baseObj.rotation
      ;(result.real as unknown as { flipX: boolean }).flipX = (baseObj as unknown as { flipX?: boolean }).flipX ?? false
    }
    // spawned change: sync spawned (entity cascade birth/death, parentId may remain unchanged)
    if (result.real.spawned !== baseObj.spawned) {
      ;(result.real as unknown as { spawned: boolean }).spawned = (baseObj as unknown as { spawned?: boolean }).spawned !== false
    }

  }

  // 4. Calculate camera Ghost/Real states
  const baseCameraState: RuntimeCameraState = {
    x: baseState.camera.x,
    y: baseState.camera.y,
    zoom: baseState.camera.zoom
  }

  const cameraPointActions = actions.filter(a =>
    isCameraPointAction(a) && a.slotIndex === slotIndex
  )

  const cameraDurationActions = actions.filter(a => {
    if (!isCameraDurationAction(a)) return false
    const span = (a as { slotSpan?: number }).slotSpan ?? 1
    return a.slotIndex <= slotIndex && slotIndex < a.slotIndex + span
  })

  let cameraResult: CameraGhostStateResult

  if (cameraPointActions.length > 0) {
    let realCamera = { ...baseCameraState }
    for (const action of cameraPointActions) {
      realCamera = applyActionToCamera(realCamera, action)
    }
    for (const action of cameraDurationActions) {
      realCamera = applyActionToCamera(realCamera, action)
    }
    cameraResult = { ghost: { ...baseCameraState }, real: realCamera }
  }
  else if (cameraDurationActions.length > 0) {
    const earliestCameraAction = cameraDurationActions.reduce((prev, curr) =>
      curr.slotIndex < prev.slotIndex ? curr : prev
    )

    let ghostCameraState: RuntimeCameraState = {
      x: prevContext.camera.x,
      y: prevContext.camera.y,
      zoom: prevContext.camera.zoom
    }
    for (const action of sortedActions) {
      if (action.target !== 'camera') continue
      if (action.slotIndex >= earliestCameraAction.slotIndex) break
      ghostCameraState = applyActionToCamera(ghostCameraState, action)
    }

    let realCamera = { ...baseCameraState }
    for (const action of cameraDurationActions) {
      realCamera = applyActionToCamera(realCamera, action)
    }

    cameraResult = { ghost: ghostCameraState, real: realCamera }
  }
  else {
    cameraResult = { ghost: null, real: baseCameraState }
  }

  const result = {
    objects: results,
    camera: cameraResult,
    renderChain: baseState.renderChain ?? [],
  }
  return result
}

/**
 * Calculate final scene state (used for scene inheritance)
 * @param scene Scene object
 * @returns Final SceneSetup
 */
export function calculateFinalSceneState(scene: SceneContainer): SceneSetup {
  // 1. Create RuntimeSceneSnapshot from initial Setup
  let currentState: RuntimeSceneSnapshot = createRuntimeSnapshot(scene.setup)

  // 2. Traverse all script blocks and apply actions
  for (const block of scene.script) {
    // forceAllActions = true: force apply final state of all actions (ignoring duration)
    currentState = applyBlockActionsToState(currentState, block, scene, true)
  }

  // 3. Convert back to SceneSetup (persistence format)
  return {
    camera: {
      x: currentState.camera.x,
      y: currentState.camera.y,
      width: scene.setup.camera.width,
      height: scene.setup.camera.height,
      zoom: currentState.camera.zoom,
    },
    objects: currentState.objects,
    renderChain: currentState.renderChain,
  }
}

/**
 * Create inherited Setup (filters out objects with spawned: false)
 * @param sourceScene Source scene
 * @returns Setup for new scene
 */
export function createInheritedSetup(sourceScene: SceneContainer): SceneSetup {
  const finalState = calculateFinalSceneState(sourceScene)

  // Filter objects: remove all objects where spawned is false
  const filteredObjects = finalState.objects.filter(obj => {
    // undefined defaults to true (v9.3 compatibility)
    return obj.spawned !== false
  })

  // Return new Setup
  // v19: inherit renderChain and filter out removed object IDs
  const survivingIds = new Set(filteredObjects.map(o => o.id))
  const inheritedRenderChain = (finalState.renderChain ?? []).filter(id => survivingIds.has(id))
  return {
    camera: finalState.camera,
    objects: filteredObjects,
    renderChain: inheritedRenderChain,
  }
}
