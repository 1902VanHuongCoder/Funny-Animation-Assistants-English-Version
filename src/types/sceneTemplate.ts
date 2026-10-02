/**
 * Scene template type definitions
 * v17: Multi-root flat list structure, aligned with SceneSetup.objects
 */

import type { SceneObject } from './sceneObject'

/**
 * Scene Template — First-class asset resource, peer to character/prop/background
 *
 * Internally uses existing SceneObject types directly.
 * All objects reside in flat objects list (including composite children),
 * maintaining hierarchy through parentId / childIds.
 */
export interface SceneTemplate {
    id: string
    name: string
    tags?: string[]
    createdAt: number
    updatedAt?: number

    /** Relative path to thumbnail file */
    thumbnailPath?: string
    /** Runtime Blob URL (not persisted) */
    _runtimeThumbnailUrl?: string

    /** All scene objects contained in template (flat list, aligned with SceneSetup.objects) */
    objects: SceneObject[]

    /** v19: Scene-level render chain (ordered ID list determining root-level render order) */
    renderChain?: string[]

    /** Template editor canvas anchor (bounding box center before zeroing), used to restore position when loaded into editor */
    editorAnchor?: { x: number; y: number }

    /** Relative path to directory containing import source config.json */
    importSourcePath?: string
}
