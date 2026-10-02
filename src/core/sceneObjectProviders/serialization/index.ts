/**
 * Scene object serialization Provider registry — TypeSerializer Registry
 *
 * P1: Replaces switch(obj.type) in toSetupObject / fromSetupObject of sceneObjectStore with a registry pattern.
 * Adding a new object type only requires registering a serializer via registerTypeSerializer().
 *
 * Design principles:
 * - Common base class fields (id/refId/type/x/y/scale...) handled uniformly by toSetupObject
 * - TypeSerializer is only responsible for **subtype-specialized fields** serialization/deserialization
 */

import type { SceneObjectType } from '@/types/sceneObject'

// ============================================================================
// Types
// ============================================================================

/**
 * Type serializer interface
 *
 * One implementation registered for each SceneObjectType.
 */
export interface TypeSerializer {
    /**
     * Serialization: writes subtype-specialized fields into base DTO
     *
     * @param obj    Runtime SceneObject (narrowed by type)
     * @param base   DTO object with common fields populated, this method appends specialized fields
     */
    serializeFields(obj: import('@/types/sceneObject').SceneObject, base: Record<string, unknown>): void

    /**
     * Deserialization: creates runtime SceneObject from persisted data and injects into Store
     *
     * @param objData  Persisted DTO data
     * @param ctx      Deserialization context (Store operation functions injected)
     */
    deserialize(objData: import('@/types/sceneObject').SceneObject, ctx: DeserializeContext): void
}

/**
 * Deserialization context
 *
 * Injects sceneObjectStore internal functions to serializers, avoiding circular dependencies.
 */
export interface DeserializeContext {
    createBackgroundObject: (
        backgroundId: string,
        name: string,
        customId?: string,
        customAlias?: string,
    ) => import('@/types/sceneObject').SceneObject
    createAudioObject: (
        soundId: string,
        name: string,
        options?: {
            volume?: number
            loop?: boolean
            fadeIn?: number
            fadeOut?: number
            playbackState?: 'play' | 'stop'
        },
        customId?: string,
        customAlias?: string,
    ) => import('@/types/sceneObject').SceneObject
    createPropObject: (
        propId: string,
        name: string,
        customId?: string,
        customAlias?: string,
    ) => import('@/types/sceneObject').SceneObject
    createScreenEffectObject: (
        effectClass: string,
        name: string,
        params?: import('@/types/sceneObject').ScreenEffectParams,
        customId?: string,
        customAlias?: string,
    ) => import('@/types/sceneObject').SceneObject
    createSymbolObject: (
        name: string,
        customId?: string,
        customAlias?: string,
    ) => import('@/types/sceneObject').SceneObject
    createExpressionObject: (
        expressionId: string,
        name: string,
        customId?: string,
        customAlias?: string,
    ) => import('@/types/sceneObject').SceneObject
    createCompositeObject: (
        name: string,
        childIds: string[],
        customId?: string,
        customAlias?: string,
        compositeMode?: 'entity' | 'union',
    ) => import('@/types/sceneObject').SceneObject
    /**
     * Clip-Mask Phase 1: Create mask object.
     * Called by maskSerializer during deserialization; initial targetIds passes empty array,
     * real targetIds backfilled and exclusive conflicts resolved during finalize step via `pendingMaskTargets`.
     */
    createMaskObject: (
        name: string,
        shape: import('@/types/sceneObject').MaskShape,
        options?: {
            width?: number
            height?: number
            mode?: import('@/types/sceneObject').MaskMode
        },
        customId?: string,
        customAlias?: string,
    ) => import('@/types/sceneObject').MaskObject
    /**
     * Clip-Mask Phase 1: Staging targetIds read during deserialization (key is mask id).
     * After all objects deserialize, `finalizeMaskTargets()` is called to backfill and clean up:
     * dead references / invalid target types / mask->mask nesting / multi-mask conflicts on same target.
     */
    pendingMaskTargets: Map<string, string[]>
    createTextObject: (
        content: string,
        canvasCenter?: { x: number; y: number },
        customId?: string,
        customAlias?: string,
    ) => import('@/types/sceneObject').TextObject
    createLightObject: (
        lightType: 'ambient' | 'point' | 'spot',
        name: string,
        options?: {
            lightColor?: string
            lightIntensity?: number
            lightRadius?: number
            flicker?: number
            flickerSpeed?: number
            directionMode?: 'omni' | 'cone'
            directionAngle?: number
            coneAngle?: number
            x?: number
            y?: number
        },
        customId?: string,
        customAlias?: string,
    ) => import('@/types/sceneObject').LightObject
    updateObject: <T extends import('@/types/sceneObject').SceneObject = import('@/types/sceneObject').SceneObject>(id: string, updates: import('@/types/sceneObject').SceneObjectUpdateFor<T>) => void
    resolveActorName: (
        refId: string,
        actorId?: string,
    ) => { displayName: string; resolvedActorId: string } | null
}

// ============================================================================
// Registry
// ============================================================================

const serializerRegistry = new Map<SceneObjectType, TypeSerializer>()

/**
 * Register a serializer for an object type
 */
export function registerTypeSerializer(type: SceneObjectType, serializer: TypeSerializer): void {
    serializerRegistry.set(type, serializer)
}

/**
 * Get registered serializer
 */
export function getTypeSerializer(type: SceneObjectType): TypeSerializer | undefined {
    return serializerRegistry.get(type)
}

/**
 * Clear registry (for testing only)
 */
export function clearSerializerRegistry(): void {
    serializerRegistry.clear()
}
