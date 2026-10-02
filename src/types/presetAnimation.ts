/**
 * Preset animation template type definitions (v3 — name-addressed)
 *
 * All preset animations address track target objects via `targetName` (string, alias, or name).
 * Rig mechanism abolished: no longer uses requiredRigs / rigTracks / ArticulatedRigId.
 *
 * Instantiation always produces a single TrackAnimationDefinition (containing multiple tracks pointing to different targetObjectIds).
 */

import type { AnimationTrack } from './animation'

/** Preset animation category */
export type PresetAnimationCategory =
  | 'locomotion'
  | 'gesture'
  | 'idle'
  | 'emotion'
  | 'custom'

/**
 * Distributive Omit: executes Omit independently on each member of a union type
 * Standard Omit<A|B, K> only preserves common keys of A∩B; DistributiveOmit preserves unique keys of each member.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * In-template target description
 *
 * - `key`: Stable identifier within the template (binding unaffected even if recommendedName changes)
 * - `recommendedName`: Recommended name (alias or name) used for addressing; resolver searches by alias then name in character root subtree
 * - `optional`: Optional part. When missing, does not block application, only marked as skipped
 * - `hint`: UI hint
 */
export interface ExpectedTarget {
  key: string
  recommendedName: string
  /** Name fallback sequence: tried in order when exact match fails (coarse-grained fallback, e.g. Left Upper Arm -> Left Arm) */
  fallbackNames?: string[]
  optional?: boolean
  hint?: string
}

/**
 * Track group corresponding to a target
 *
 * During instantiation, the system maps targetKey to concrete object UUID,
 * injects targetObjectId into each track in tracks, then merges into a unified TrackAnimationDefinition.
 */
export interface TargetTrackGroup {
  targetKey: string
  /** Track list (template does not contain targetObjectId; filled during instantiation) */
  tracks: DistributiveOmit<AnimationTrack, 'targetObjectId'>[]
}

/** Preset action template */
export interface PresetAnimationTemplate {
  id: string
  name: string
  description?: string
  tags?: string[]
  category: PresetAnimationCategory
  thumbnailUrl?: string
  /** Template origin: 'system' = system built-in, 'user' = user custom */
  origin: 'system' | 'user'

  /** Expected target list for template (addressed by recommended name) */
  expectedTargets: ExpectedTarget[]
  /** Animation tracks for each target */
  targetTracks: TargetTrackGroup[]

  /** Whether to loop */
  loop: boolean
  /** Fill mode after animation ends */
  fillMode?: 'none' | 'forwards'
  /** Explicit total duration (ms); individual tracks can also have independent duration */
  duration?: number
}

/**
 * Template data integrity validation
 */
export function validatePresetTemplate(template: PresetAnimationTemplate): string[] {
  const errors: string[] = []

  const expectedKeys = new Set(template.expectedTargets.map(t => t.key))

  // 1. Keys in targetTracks must be declared in expectedTargets
  for (const group of template.targetTracks) {
    if (!expectedKeys.has(group.targetKey)) {
      errors.push(`targetTrack "${group.targetKey}" is not in expectedTargets`)
    }
    if (group.tracks.length === 0) {
      errors.push(`targetTrack "${group.targetKey}" has no track data`)
    }
  }

  // 2. Non-optional expectedTargets must have corresponding targetTrack
  const coveredKeys = new Set(template.targetTracks.map(g => g.targetKey))
  for (const t of template.expectedTargets) {
    if (!t.optional && !coveredKeys.has(t.key)) {
      errors.push(`expectedTarget "${t.key}" (${t.recommendedName}) has no corresponding targetTrack definition`)
    }
  }

  // 3. expectedTargets.key must not duplicate
  const keyCount = new Map<string, number>()
  for (const t of template.expectedTargets) {
    keyCount.set(t.key, (keyCount.get(t.key) ?? 0) + 1)
  }
  for (const [key, count] of keyCount) {
    if (count > 1) errors.push(`expectedTargets key "${key}" duplicated ${count} times`)
  }

  return errors
}
