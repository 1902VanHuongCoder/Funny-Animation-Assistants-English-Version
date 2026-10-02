/**
 * Clip-Mask Phase 1 shared utilities
 *
 * See docs/features/clip-mask.md (v2.1).
 * Utility functions in this module are shared across maskSerializer / SetMaskHandler / Mask UI, etc.
 */

import type { SceneObjectType } from '@/types/sceneObject'

/**
 * Determines whether a given SceneObjectType is allowed as a mask clipping target.
 *
 * Phase 1 allowed: visual / spatial types (prop / text / symbol / expression / composite / background)
 * Phase 1 forbidden:
 * - 'mask': Avoid mask nesting (supported in Phase 1.5)
 * - 'camera' / 'audio' / 'light' / 'screen_effect': Non-spatial pixel objects, no clipping semantics
 */
export function isAllowedMaskTargetType(type: SceneObjectType): boolean {
  switch (type) {
    case 'prop':
    case 'text':
    case 'symbol':
    case 'expression':
    case 'composite':
    case 'background':
      return true
    case 'mask':
    case 'camera':
    case 'audio':
    case 'light':
    case 'screen_effect':
      return false
    default: {
      // Fallback: treat unknown types as disabled (force explicit branch when new types appear)
      const _exhaustive: never = type
      return _exhaustive
    }
  }
}
