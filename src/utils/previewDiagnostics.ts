import type { CompositeObject, SceneObject } from '@/types/sceneObject'

function isRenderableType(type: SceneObject['type']): boolean {
  return type !== 'camera' && type !== 'audio' && type !== 'light'
}

function isUnionComposite(obj: SceneObject): boolean {
  return obj.type === 'composite' && (obj as CompositeObject).compositeMode === 'union'
}

function isEntityComposite(obj: SceneObject): boolean {
  return obj.type === 'composite' && (obj as CompositeObject).compositeMode === 'entity'
}

export interface PreviewChainDiagnostic {
  rootRenderableIds: string[]
  missingRootRenderableIds: string[]
}

export interface BoundsLike {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Diagnose whether the preview renderChain covers root-level renderable objects.
 *
 * Rules:
 * - camera/audio/light do not participate in render chains
 * - Root-level union composite itself should not appear in renderChain (its child objects are flattened)
 * - Root-level entity composite should appear in renderChain
 * - Other root-level renderable objects should appear in renderChain
 */
export function diagnosePreviewRenderChain(
  objects: readonly SceneObject[],
  renderChain: readonly string[],
): PreviewChainDiagnostic {
  const chainSet = new Set(renderChain)
  const rootRenderableIds: string[] = []
  const missingRootRenderableIds: string[] = []

  for (const obj of objects) {
    if (obj.parentId) continue
    if (!isRenderableType(obj.type)) continue
    if (isUnionComposite(obj)) continue

    rootRenderableIds.push(obj.id)
    if (!chainSet.has(obj.id)) {
      missingRootRenderableIds.push(obj.id)
    }
  }

  return { rootRenderableIds, missingRootRenderableIds }
}

/**
 * Used for debug output only: summarize key visibility fields of root-level objects.
 */
export function collectRootVisibilitySnapshot(objects: readonly SceneObject[]): Record<string, unknown>[] {
  return objects
    .filter(o => !o.parentId)
    .map(o => ({
      id: o.id,
      type: o.type,
      isEntityComposite: isEntityComposite(o),
      isUnionComposite: isUnionComposite(o),
      x: o.x,
      y: o.y,
      alpha: o.alpha,
      visible: o.visible,
      spawned: o.spawned ?? true,
      zIndex: o.zIndex,
    }))
}

/**
 * Select bounds used by preview fitContent:
 * Prefers contentLayer (actual content), falls back to stage when invalid.
 */
export function choosePreviewFitBounds(
  contentLayerBounds: BoundsLike | null | undefined,
  stageBounds: BoundsLike,
): { chosen: 'contentLayer' | 'stage'; bounds: BoundsLike } {
  if (contentLayerBounds && contentLayerBounds.width > 0 && contentLayerBounds.height > 0) {
    return { chosen: 'contentLayer', bounds: contentLayerBounds }
  }
  return { chosen: 'stage', bounds: stageBounds }
}
