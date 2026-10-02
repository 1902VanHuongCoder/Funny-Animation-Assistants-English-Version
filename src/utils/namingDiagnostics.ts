/**
 * Character naming diagnostics utility
 *
 * Supports four categories of detection:
 *   D1 Duplicate alias: Multiple objects sharing the same alias in the same character root subtree
 *   D2 Missing recommended name: Entries in the system recommended names list not present in character
 *   D3 Non-standard naming: Object alias/name is "similar but not equal" to a recommended name (edit distance <= 1 or substring relation)
 *   D4 Rename impact: When renaming/modifying alias, lists affected preset animations
 */

import { RECOMMENDED_NAMES, RECOMMENDED_NAMES_SET } from '@/constants/recommendedNames'
import type { PresetAnimationTemplate } from '@/types/presetAnimation'
import type { SceneObject } from '@/types/sceneObject'
import { collectSubtreeIds } from '@/utils/presetAnimationMapper'

// ===== D1 =====

export interface DuplicateAliasEntry {
  alias: string
  objectIds: string[]
}

export function findDuplicateAliases(
  rootCompositeId: string,
  sceneObjects: Map<string, SceneObject>,
): DuplicateAliasEntry[] {
  const subtreeIds = collectSubtreeIds(rootCompositeId, sceneObjects)
  const byAlias = new Map<string, string[]>()
  for (const id of subtreeIds) {
    const obj = sceneObjects.get(id)
    if (!obj?.alias) continue
    const bucket = byAlias.get(obj.alias)
    if (bucket) bucket.push(id)
    else byAlias.set(obj.alias, [id])
  }
  const out: DuplicateAliasEntry[] = []
  for (const [alias, ids] of byAlias) {
    if (ids.length > 1) out.push({ alias, objectIds: ids })
  }
  return out
}

// ===== D2 =====

export interface MissingRecommendedEntry {
  recommendedName: string
}

/**
 * Detect entries in recommended names list not covered by character alias/name
 */
export function findMissingRecommendedNames(
  rootCompositeId: string,
  sceneObjects: Map<string, SceneObject>,
): MissingRecommendedEntry[] {
  const subtreeIds = collectSubtreeIds(rootCompositeId, sceneObjects)
  const present = new Set<string>()
  for (const id of subtreeIds) {
    const obj = sceneObjects.get(id)
    if (!obj) continue
    if (obj.alias) present.add(obj.alias)
    if (obj.name) present.add(obj.name)
  }
  return RECOMMENDED_NAMES
    .filter(n => !present.has(n))
    .map(recommendedName => ({ recommendedName }))
}

// ===== D3 =====

export interface NonStandardNameEntry {
  objectId: string
  field: 'alias' | 'name'
  value: string
  suggested: string
}

/** Levenshtein edit distance (iterative implementation) */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const m = a.length
  const n = b.length
  const prev = new Array<number>(n + 1)
  const curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,        // deletion
        (curr[j - 1] ?? 0) + 1,    // insertion
        (prev[j - 1] ?? 0) + cost, // substitution
      )
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j] ?? 0
  }
  return prev[n] ?? 0
}

/** Determine whether candidate is "similar but not equal" to target: edit distance <= 1 or substring relation */
export function isSimilarButNotEqual(candidate: string, target: string): boolean {
  if (!candidate || !target) return false
  if (candidate === target) return false
  if (candidate.includes(target) || target.includes(candidate)) return true
  return editDistance(candidate, target) <= 1
}

/**
 * Find alias/name similar but not equal to a recommended name
 * Returns suggestion to change value to suggested (closest recommended name)
 */
export function findNonStandardNames(
  rootCompositeId: string,
  sceneObjects: Map<string, SceneObject>,
): NonStandardNameEntry[] {
  const subtreeIds = collectSubtreeIds(rootCompositeId, sceneObjects)
  const results: NonStandardNameEntry[] = []

  for (const id of subtreeIds) {
    const obj = sceneObjects.get(id)
    if (!obj) continue

    // If object alias/name itself is a recommended name, skip
    const aliasIsRecommended = obj.alias ? RECOMMENDED_NAMES_SET.has(obj.alias) : false
    const nameIsRecommended = RECOMMENDED_NAMES_SET.has(obj.name)

    if (!aliasIsRecommended && obj.alias) {
      const sug = findClosestRecommended(obj.alias)
      if (sug) results.push({ objectId: id, field: 'alias', value: obj.alias, suggested: sug })
    }
    // Only check name if alias is empty and name is non-standard, avoiding double reports
    if (!obj.alias && !nameIsRecommended) {
      const sug = findClosestRecommended(obj.name)
      if (sug) results.push({ objectId: id, field: 'name', value: obj.name, suggested: sug })
    }
  }
  return results
}

function findClosestRecommended(candidate: string): string | undefined {
  for (const rec of RECOMMENDED_NAMES) {
    if (isSimilarButNotEqual(candidate, rec)) return rec
  }
  return undefined
}

// ===== D4 =====

export interface RenameImpactEntry {
  templateId: string
  templateName: string
  origin: 'system' | 'user'
  affectedTargetKeys: string[]
}

/**
 * Analyze rename impact: traverse all templates, listing entries in expectedTargets
 * where recommendedName or fallbackNames contains oldName.
 *
 * Also matches fallbackNames: since system templates can use coarse-grained names (left arm / right leg)
 * as fallbacks for fine-grained targets, renaming coarse names also impacts these templates.
 */
export function analyzeRenameImpact(
  oldName: string,
  templates: PresetAnimationTemplate[],
): RenameImpactEntry[] {
  const out: RenameImpactEntry[] = []
  for (const tpl of templates) {
    const affected = tpl.expectedTargets
      .filter(t =>
        t.recommendedName === oldName ||
        (t.fallbackNames?.includes(oldName) ?? false),
      )
      .map(t => t.key)
    if (affected.length > 0) {
      out.push({
        templateId: tpl.id,
        templateName: tpl.name,
        origin: tpl.origin,
        affectedTargetKeys: affected,
      })
    }
  }
  return out
}
