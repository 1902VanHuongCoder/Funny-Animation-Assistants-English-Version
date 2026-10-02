/**
 * Text processing utility functions
 */

/**
 * Normalize text line breaks to avoid CRLF / Unicode Line Separator interfering with rendering and measurement.
 */
export function normalizeTextContent(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[\r\u2028\u2029]/g, '\n')
}

/**
 * Automatic line height strategy: unified safety factor to avoid text overlap across fonts.
 */
export function getAutoTextLineHeight(_fontFamily: string | null | undefined, fontSize: number | null | undefined): number {
  const size = fontSize ?? 72
  return size * 1.2
}

export type TextLineHeightSource = 'auto' | 'explicit' | 'legacy-auto-migrated'

export interface ResolvedTextLineHeight {
  lineHeight: number
  source: TextLineHeightSource
}

/**
 * Unified line height resolution:
 * - undefined/null/invalid value => auto
 * - Legacy automatic value (fontSize * 1.3) => migrate to auto
 * - Other positive numbers => explicit line height
 */
export function resolveTextLineHeight(
  fontFamily: string | null | undefined,
  fontSize: number | null | undefined,
  lineHeight: number | null | undefined,
): ResolvedTextLineHeight {
  const auto = getAutoTextLineHeight(fontFamily, fontSize)
  if (lineHeight === undefined || lineHeight === null) {
    return { lineHeight: auto, source: 'auto' }
  }

  const explicit = Number(lineHeight)
  if (!Number.isFinite(explicit) || explicit <= 0) {
    return { lineHeight: auto, source: 'auto' }
  }

  const size = fontSize ?? 72
  const legacyAuto = size * 1.3
  if (Math.abs(explicit - legacyAuto) < 0.01) {
    return { lineHeight: auto, source: 'legacy-auto-migrated' }
  }

  return { lineHeight: explicit, source: 'explicit' }
}

/**
 * Automatic leading compensation:
 * Uses 0 as unified safe default to prevent negative leading causing text overlap.
 */
export function getAutoTextLeading(
  _fontFamily: string | null | undefined,
  _fontSize: number | null | undefined,
  explicitLineHeight?: number | null,
): number {
  if (explicitLineHeight !== undefined && explicitLineHeight !== null) return 0
  return 0
}

/**
 * Map angle to PIXI usable linear gradient direction (horizontal/vertical + forward/reverse).
 * Note: PIXI.TextStyle does not support arbitrary angles; uses closest 4-way discrete mapping.
 */
export function resolveTextGradient(
  stops: { offset: number; color: string }[] | null | undefined,
  angleDeg: number | null | undefined,
): { colors: string[]; gradientStops: number[]; gradientType: 0 | 1 } | null {
  if (!stops || stops.length === 0) return null
  const sorted = [...stops].sort((a, b) => a.offset - b.offset)
  let colors = sorted.map(s => s.color)
  let gradientStops = sorted.map(s => s.offset)

  const angle = ((angleDeg ?? 90) % 360 + 360) % 360
  // 0: left->right, 90: top->bottom, 180: right->left, 270: bottom->top
  const horizontal = (angle < 45) || (angle >= 135 && angle < 225) || (angle >= 315)
  const reverse = (angle >= 135 && angle < 315)

  if (reverse) {
    colors = [...colors].reverse()
    gradientStops = gradientStops.map(v => 1 - v).reverse()
  }

  return {
    colors,
    gradientStops,
    gradientType: horizontal ? 1 : 0, // 0=vertical, 1=horizontal
  }
}

/**
 * Truncate string in the middle
 * @param text Original text
 * @param maxLength Maximum length
 * @param startChars Number of characters to preserve at start
 * @param endChars Number of characters to preserve at end
 * @returns Truncated text
 */
export function truncateMiddle(
  text: string,
  maxLength = 20,
  startChars = 8,
  endChars = 8
): string {
  if (!text || text.length <= maxLength) {
    return text
  }

  // If text is too short to retain both start and end characters, keep the front part directly
  if (text.length <= startChars + endChars + 3) {
    return text.substring(0, maxLength - 3) + '...'
  }

  return `${text.substring(0, startChars)}...${text.substring(text.length - endChars)}`
}
