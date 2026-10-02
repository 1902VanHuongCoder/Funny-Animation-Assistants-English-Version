/**
 * Preset Animation System - System-level recommended name lexicon
 *
 * Used for:
 * 1. expectedTargets[i].recommendedName in system built-in animation templates
 * 2. Reference in character editor NamingCheckPanel
 * 3. namingDiagnostics D2 missing recommended names, D3 non-standard name similarity
 *
 * Lexicon scope: 17 common body parts for composite characters. Excludes hands and feet.
 *
 * Coarse/fine semantic fallback (explicitly declared in ExpectedTarget.fallbackNames):
 *   Left Upper Arm / Left Lower Arm -> Left Arm
 *   Right Upper Arm / Right Lower Arm -> Right Arm
 *   Left Thigh / Left Calf -> Left Leg
 *   Right Thigh / Right Calf -> Right Leg
 */

export const RECOMMENDED_NAMES = [
  'Body',
  'Head',
  'Expression',
  'Face',
  'Hair',
  'Left Upper Arm',
  'Left Lower Arm',
  'Right Upper Arm',
  'Right Lower Arm',
  'Left Arm',
  'Right Arm',
  'Left Thigh',
  'Left Calf',
  'Right Thigh',
  'Right Calf',
  'Left Leg',
  'Right Leg',
] as const

export type RecommendedName = typeof RECOMMENDED_NAMES[number]

/** Convenience set */
export const RECOMMENDED_NAMES_SET: ReadonlySet<string> = new Set(RECOMMENDED_NAMES)

/**
 * Semantic fallback table for system recommended names.
 * Used when building system preset animation templates to generate ExpectedTarget.fallbackNames.
 * Targets system-level names only; user custom actions do not receive fallback.
 */
export const RECOMMENDED_NAME_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  'Left Upper Arm': ['Left Arm'],
  'Left Lower Arm': ['Left Arm'],
  'Right Upper Arm': ['Right Arm'],
  'Right Lower Arm': ['Right Arm'],
  'Left Thigh': ['Left Leg'],
  'Left Calf': ['Left Leg'],
  'Right Thigh': ['Right Leg'],
  'Right Calf': ['Right Leg'],
}

/** Get fallback sequence for recommended name (defaults to empty array) */
export function getRecommendedFallbacks(name: string): readonly string[] {
  return RECOMMENDED_NAME_FALLBACKS[name] ?? []
}
