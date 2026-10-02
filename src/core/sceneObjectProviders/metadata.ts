/**
 * Scene object type metadata registry
 *
 * P1: Uniformly manages icons, labels, AnimationResourceType mappings, and other metadata for each SceneObjectType,
 * eliminating scattered switch/if-else modifications across UI layers.
 *
 * Adding a new object type only requires registering metadata here; all consumers automatically reflect changes.
 */

import type { AnimationResourceType } from '@/types/animation'
import type { SceneObjectType } from '@/types/sceneObject'

// ============================================================================
// Types
// ============================================================================

export interface SceneObjectTypeMetadata {
    /** Type icon emoji */
    icon: string
    /** Type display label */
    label: string
    /**
     * Corresponding AnimationResourceType (used to query animationStore).
     * Types without animation capabilities (e.g. camera/text/audio) omit this field.
     */
    animationResourceType?: AnimationResourceType
}

// ============================================================================
// Registry
// ============================================================================

const metadataRegistry = new Map<SceneObjectType, SceneObjectTypeMetadata>()

function register(type: SceneObjectType, metadata: SceneObjectTypeMetadata): void {
    metadataRegistry.set(type, metadata)
}

// ============================================================================
// Register all built-in types
// ============================================================================

register('background', { icon: '🖼️', label: 'Background', animationResourceType: 'background' })
register('prop', { icon: '📦', label: 'Prop', animationResourceType: 'prop' })
register('audio', { icon: '🔊', label: 'Audio' })
register('camera', { icon: '📷', label: 'Camera' })
register('text', { icon: '📝', label: 'Text' })
register('screen_effect', { icon: '🌟', label: 'Screen Effect' })
register('composite', { icon: '🧩', label: 'Composite', animationResourceType: 'composite' })
register('symbol', { icon: '🔧', label: 'Symbol' })
register('expression', { icon: '😀', label: 'Expression' })
register('light', { icon: '💡', label: 'Light' })
// Clip-Mask Phase 1: Mask (icon uses rectangle style ▭, overridden by SceneObjectList ellipse branch)
register('mask', { icon: '▭', label: 'Mask' })

// ============================================================================
// Query API
// ============================================================================

/** Get type icon; returns '❓' for unregistered types */
export function getTypeIcon(type: string): string {
    return metadataRegistry.get(type as SceneObjectType)?.icon ?? '❓'
}

/** Get type label; returns type string for unregistered types */
export function getTypeLabel(type: string): string {
    return metadataRegistry.get(type as SceneObjectType)?.label ?? type
}

/**
 * Get AnimationResourceType corresponding to type.
 * Returns undefined if type does not support animation.
 */
export function getAnimationResourceType(type: string): AnimationResourceType | undefined {
    return metadataRegistry.get(type as SceneObjectType)?.animationResourceType
}

/** Get complete type metadata */
export function getTypeMetadata(type: string): SceneObjectTypeMetadata | undefined {
    return metadataRegistry.get(type as SceneObjectType)
}
