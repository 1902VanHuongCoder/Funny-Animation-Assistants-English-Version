import type { Expression } from '@/types/project'

interface AlignableAsset {
  offsetFix?: { x: number; y: number }
  pivot?: { x: number; y: number }
}

/**
 * Anchor alignment utility functions
 * Used to preserve visual positioning consistency when switching expression assets
 */

/**
 * Calculate offset for new asset so that new anchor aligns with old anchor
 * @param oldResource Old asset
 * @param newResource New asset
 * @param oldExpression Old expression data (contains anchor info)
 * @param newExpression New expression data (contains anchor info)
 * @param assumedImageSize Assumed image size (default 200x200)
 * @returns New offset coordinates
 */
export function calculateAlignedOffset(
  oldResource: AlignableAsset,
  oldExpression: Expression,
  newExpression: Expression,
  assumedImageSize = 200
): { x: number; y: number } {
  // Use anchor from expression data
  const oldAnchor = oldExpression.anchor
  const newAnchor = newExpression.anchor
  // Asset itself no longer carries scale, treat as 1
  const oldScale = { x: 1, y: 1 }
  const newScale = { x: 1, y: 1 }
  
  // Calculate old anchor world position (relative to asset center)
  // anchor is normalized (0-1), convert to pixel coordinates
  const oldAnchorWorldX = (oldAnchor.x - 0.5) * assumedImageSize * Math.abs(oldScale.x)
  const oldAnchorWorldY = (oldAnchor.y - 0.5) * assumedImageSize * Math.abs(oldScale.y)
  
  // Calculate new anchor world position (relative to asset center)
  const newAnchorWorldX = (newAnchor.x - 0.5) * assumedImageSize * Math.abs(newScale.x)
  const newAnchorWorldY = (newAnchor.y - 0.5) * assumedImageSize * Math.abs(newScale.y)
  
  // Calculate new offset to align new anchor with old anchor
  const oldOffsetX = oldResource.offsetFix?.x ?? 0
  const oldOffsetY = oldResource.offsetFix?.y ?? 0
  const newOffsetX = oldOffsetX + oldAnchorWorldX - newAnchorWorldX
  const newOffsetY = oldOffsetY + oldAnchorWorldY - newAnchorWorldY
  
  return { x: newOffsetX, y: newOffsetY }
}

/**
 * Apply anchor alignment to new asset
 * @param oldResource Old asset
 * @param newResource New asset (mutated)
 * @param oldExpression Old expression data
 * @param newExpression New expression data
 * @param assumedImageSize Assumed image size
 */
export function applyAnchorAlignment(
  oldResource: AlignableAsset,
  newResource: AlignableAsset,
  oldExpression: Expression,
  newExpression: Expression,
  assumedImageSize = 200
): void {
  const newOffset = calculateAlignedOffset(
    oldResource,
    oldExpression,
    newExpression,
    assumedImageSize
  )
  
  // Update offsetFix of new asset
  newResource.offsetFix ??= { x: 0, y: 0 }
  newResource.offsetFix.x = newOffset.x
  newResource.offsetFix.y = newOffset.y
  
  // Also update pivot of new asset to new expression anchor
  newResource.pivot = { ...newExpression.anchor }
}
