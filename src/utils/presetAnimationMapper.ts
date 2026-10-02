/**
 * Preset animation template instantiator (v3 — Name-addressed edition)
 *
 * Converts PresetAnimationTemplate addressed by targetName (alias or name)
 * into TrackAnimationDefinition addressed by UUID.
 *
 * Addressing priority:
 *   1. alias exact match
 *   2. name exact match
 *   3. No hit -> missing
 *   4. Multiple hits -> ambiguous
 *
 * Scope: Within character root composite subtree (does not cross characters)
 */

import { nanoid } from 'nanoid'

import type {
  AnimationTrack,
  TrackAnimationDefinition,
} from '@/types/animation'
import type {
  DistributiveOmit,
  ExpectedTarget,
  PresetAnimationTemplate,
  TargetTrackGroup,
} from '@/types/presetAnimation'
import type { SceneObject } from '@/types/sceneObject'

// ===== Type Definitions =====

export interface ResolveResult {
  status: 'unique' | 'missing' | 'ambiguous'
  objectId?: string
  /** Candidate object ID list when ambiguous */
  candidates?: string[]
}

export interface DiagnosticsUniqueEntry {
  targetKey: string
  recommendedName: string
  objectId: string
}

export interface DiagnosticsMissingEntry {
  targetKey: string
  recommendedName: string
  optional: boolean
  hint?: string
}

export interface DiagnosticsAmbiguousEntry {
  targetKey: string
  recommendedName: string
  candidates: string[]
  hint?: string
}

export interface InstantiationDiagnostics {
  unique: DiagnosticsUniqueEntry[]
  missing: DiagnosticsMissingEntry[]
  ambiguous: DiagnosticsAmbiguousEntry[]
}

export interface InstantiationResult {
  animation: TrackAnimationDefinition
  diagnostics: InstantiationDiagnostics
}

// ===== Subtree Collection =====

/**
 * Traverses from root composite object and collects all object IDs in subtree based on parentId / childIds.
 * Safely breaks on circular references.
 */
export function collectSubtreeIds(
  rootCompositeId: string,
  sceneObjects: Map<string, SceneObject>,
): Set<string> {
  const visited = new Set<string>()
  const stack: string[] = [rootCompositeId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    const obj = sceneObjects.get(id)
    if (!obj) continue
    if (obj.type === 'composite') {
      const childIds = (obj as { childIds?: string[] }).childIds ?? []
      for (const cid of childIds) {
        if (!visited.has(cid)) stack.push(cid)
      }
    }
  }
  return visited
}

// ===== Name Addressing =====

/**
 * Finds target object by name within character root subtree
 * Priority: alias exact match -> name exact match
 */
export function resolveTargetByName(
  name: string,
  rootCompositeId: string,
  sceneObjects: Map<string, SceneObject>,
): ResolveResult {
  if (!name) return { status: 'missing' }
  const subtreeIds = collectSubtreeIds(rootCompositeId, sceneObjects)

  // Pass 1: alias exact match
  const aliasMatches: string[] = []
  for (const id of subtreeIds) {
    const obj = sceneObjects.get(id)
    if (obj?.alias && obj.alias === name) aliasMatches.push(id)
  }
  if (aliasMatches.length === 1) return { status: 'unique', objectId: aliasMatches[0]! }
  if (aliasMatches.length > 1) return { status: 'ambiguous', candidates: aliasMatches }

  // Pass 2: name exact match
  const nameMatches: string[] = []
  for (const id of subtreeIds) {
    const obj = sceneObjects.get(id)
    if (obj?.name === name) nameMatches.push(id)
  }
  if (nameMatches.length === 1) return { status: 'unique', objectId: nameMatches[0]! }
  if (nameMatches.length > 1) return { status: 'ambiguous', candidates: nameMatches }

  return { status: 'missing' }
}

// ===== Diagnostics =====

/**
 * Checks whether template can be applied to specified character root object
 *
 * Returns full diagnostics: unique matches, missing, and ambiguous targets
 */
export function canApplyPreset(
  template: PresetAnimationTemplate,
  rootCompositeId: string,
  sceneObjects: Map<string, SceneObject>,
  overrides?: Record<string, string>,
): InstantiationDiagnostics {
  const diagnostics: InstantiationDiagnostics = {
    unique: [],
    missing: [],
    ambiguous: [],
  }

  for (const target of template.expectedTargets) {
    // Manual override takes precedence
    const overrideId = overrides?.[target.key]
    if (overrideId) {
      if (sceneObjects.has(overrideId)) {
        diagnostics.unique.push({
          targetKey: target.key,
          recommendedName: target.recommendedName,
          objectId: overrideId,
        })
        continue
      }
      // Override points to non-existent object: treat as missing
    }

    const result = resolveTargetWithFallback(target, rootCompositeId, sceneObjects)
    addDiagnosticEntry(diagnostics, target, result)
  }

  return diagnostics
}

/**
 * Attempts to resolve target by recommendedName + fallbackNames in sequential order.
 *
 * Rules:
 *   - unique hit -> return immediately
 *   - ambiguous hit -> return immediately (ambiguity is final state, not masked by subsequent fallbacks)
 *   - missing -> try next candidate
 * If all candidates are missing, return missing.
 */
function resolveTargetWithFallback(
  target: ExpectedTarget,
  rootCompositeId: string,
  sceneObjects: Map<string, SceneObject>,
): ResolveResult {
  const candidates = [target.recommendedName, ...(target.fallbackNames ?? [])]
  for (const name of candidates) {
    const result = resolveTargetByName(name, rootCompositeId, sceneObjects)
    if (result.status === 'unique' || result.status === 'ambiguous') return result
  }
  return { status: 'missing' }
}

function addDiagnosticEntry(
  diagnostics: InstantiationDiagnostics,
  target: ExpectedTarget,
  result: ResolveResult,
): void {
  if (result.status === 'unique' && result.objectId) {
    diagnostics.unique.push({
      targetKey: target.key,
      recommendedName: target.recommendedName,
      objectId: result.objectId,
    })
  } else if (result.status === 'ambiguous') {
    const entry: DiagnosticsAmbiguousEntry = {
      targetKey: target.key,
      recommendedName: target.recommendedName,
      candidates: result.candidates ?? [],
    }
    if (target.hint !== undefined) entry.hint = target.hint
    diagnostics.ambiguous.push(entry)
  } else {
    const entry: DiagnosticsMissingEntry = {
      targetKey: target.key,
      recommendedName: target.recommendedName,
      optional: target.optional ?? false,
    }
    if (target.hint !== undefined) entry.hint = target.hint
    diagnostics.missing.push(entry)
  }
}

/** Determines if diagnostics allow immediate application (no blocking missing / ambiguous) */
export function isDiagnosticsApplicable(diagnostics: InstantiationDiagnostics): boolean {
  const blockingMissing = diagnostics.missing.filter(m => !m.optional)
  return blockingMissing.length === 0 && diagnostics.ambiguous.length === 0
}

// ===== Instantiation =====

/**
 * Instantiates preset animation template
 *
 * @param template Preset animation template (name-addressed)
 * @param rootCompositeId Character root composite object ID
 * @param sceneObjects Scene object Map (used for name resolution)
 * @param overrides Manually specified targetKey -> objectId overrides (resolves missing / ambiguous)
 */
export function instantiatePresetAnimation(
  template: PresetAnimationTemplate,
  rootCompositeId: string,
  sceneObjects: Map<string, SceneObject>,
  overrides?: Record<string, string>,
): InstantiationResult {
  const diagnostics = canApplyPreset(template, rootCompositeId, sceneObjects, overrides)

  // Build targetKey -> objectId resolution map
  const keyToObjectId = new Map<string, string>()
  for (const entry of diagnostics.unique) {
    keyToObjectId.set(entry.targetKey, entry.objectId)
  }

  const now = Date.now()
  const allTracks: AnimationTrack[] = []

  // Traverse template targetTracks, converting targetKey -> UUID
  for (const group of template.targetTracks) {
    const objectId = keyToObjectId.get(group.targetKey)
    if (!objectId) continue // missing / ambiguous targets -> skip tracks

    for (const templateTrack of group.tracks) {
      const track: AnimationTrack = {
        ...templateTrack,
        targetObjectId: objectId,
      } as AnimationTrack
      allTracks.push(track)
    }
  }

  const animation: TrackAnimationDefinition = {
    type: 'track',
    id: nanoid(),
    name: template.name,
    loop: template.loop,
    tracks: allTracks,
    createdAt: now,
    updatedAt: now,
  }
  if (template.description !== undefined) animation.description = template.description
  if (template.tags !== undefined) animation.tags = template.tags
  if (template.fillMode !== undefined) animation.fillMode = template.fillMode
  if (template.duration !== undefined) animation.duration = template.duration

  return { animation, diagnostics }
}

/**
 * Reverse extraction: generates ExpectedTargets from existing TrackAnimationDefinition
 *
 * Used for "Save as preset action" wizard:
 * Scans targetObjectId of all animation tracks, reads corresponding object's alias (fallback to name),
 * and aggregates into expectedTargets + targetTracks.
 *
 * @returns Extraction result, or error if any track's targetObjectId cannot be found
 */
export function extractPresetTargetsFromAnimation(
  animation: TrackAnimationDefinition,
  sceneObjects: Map<string, SceneObject>,
): {
  expectedTargets: ExpectedTarget[]
  targetTracks: TargetTrackGroup[]
  warnings: string[]
} {
  const warnings: string[] = []
  const objectIdToKey = new Map<string, string>()
  const targetsByKey = new Map<string, ExpectedTarget>()
  const tracksByKey = new Map<string, DistributiveOmit<AnimationTrack, 'targetObjectId'>[]>()

  for (const track of animation.tracks) {
    const targetId = track.targetObjectId
    if (!targetId || targetId === '_self') {
      warnings.push(`Track "${track.displayName ?? track.trackType}" has target _self or unset, cannot export`)
      continue
    }
    const obj = sceneObjects.get(targetId)
    if (!obj) {
      warnings.push(`Track "${track.displayName ?? track.trackType}" target object ${targetId} does not exist`)
      continue
    }

    let key = objectIdToKey.get(targetId)
    if (!key) {
      const aliasName = obj.alias?.trim()
      const recommendedName = aliasName && aliasName.length > 0 ? aliasName : obj.name
      if (recommendedName.trim() === '') {
        warnings.push(`Object ${targetId} lacks alias and name, cannot serve as recommended name`)
        continue
      }
      key = `target_${targetsByKey.size + 1}`
      objectIdToKey.set(targetId, key)
      targetsByKey.set(key, { key, recommendedName })
      tracksByKey.set(key, [])
    }

    // Strip targetObjectId from track to match template format
    const { targetObjectId: _omit, ...rest } = track as AnimationTrack & { targetObjectId?: string }
    void _omit
    tracksByKey.get(key)!.push(rest as DistributiveOmit<AnimationTrack, 'targetObjectId'>)
  }

  return {
    expectedTargets: Array.from(targetsByKey.values()),
    targetTracks: Array.from(tracksByKey.entries()).map(([targetKey, tracks]) => ({ targetKey, tracks })),
    warnings,
  }
}
