/**
 * Composite character type definitions
 * Structure aligned with SceneTemplate, adding gender field
 */

import type { Gender } from './project'
import type { SceneObject } from './sceneObject'

/**
 * Composite Character — Character template asset based on CompositeObject + ExpressionObject
 *
 * Aligned with SceneTemplate structure: uses flat SceneObject[] list,
 * maintaining hierarchical relationships via parentId / childIds.
 * Key difference from SceneTemplate: must contain ExpressionObject, and has a gender property.
 */
export interface CompositeCharacter {
    id: string
    name: string
    gender: Gender              // 'male' | 'female' | 'other'
    tags?: string[]
    createdAt: number
    updatedAt?: number

    /** Relative path to thumbnail file */
    thumbnailPath?: string
    /** Runtime Blob URL (not persisted) */
    _runtimeThumbnailUrl?: string

    /** All scene objects contained in character (flat list, containing CompositeObject + ExpressionObject, etc.) */
    objects: SceneObject[]

    /** Scene-level render chain (ordered ID list determining root-level render order) */
    renderChain?: string[]

    /** Editor canvas anchor (bounding box center before zeroing), used to restore position when loaded into editor */
    editorAnchor?: { x: number; y: number }

    /** Source directory when importing config.json (relative to project root) */
    importSourcePath?: string

    /** Character root composite object ID (host for preset choreographed animation) */
    rootCompositeId?: string
}
