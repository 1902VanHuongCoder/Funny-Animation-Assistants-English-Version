/**
 * Scene object Provider registry — ContainerFactory Registry
 *
 * P1: Replaces switch(obj.type) scattered modifications with a registry pattern.
 * Adding a new object type only requires registering a factory function via registerContainerFactory().
 *
 * This module only defines the registry and query API; factory functions for each type are registered
 * by consumers (useSceneGraph / FrameCapture) at initialization — keeping a "lightweight registration" strategy
 * without extracting heavyweight engine-specific logic.
 */

import type { SceneObjectType } from '@/types/sceneObject'

// ============================================================================
// Types
// ============================================================================

/**
 * Container factory function signature
 *
 * Receives scene object data and returns PIXI.Container (async, some types require texture loading).
 * Returning null indicates this type currently requires no rendering container (e.g. audio).
 */
export type ContainerFactory<TObj = import('@/types/sceneObject').SceneObject> = (
    obj: TObj,
) => Promise<import('pixi.js').Container | null>

// ============================================================================
// Registry
// ============================================================================

const containerFactoryRegistry = new Map<SceneObjectType, ContainerFactory>()

/**
 * Register a container factory for an object type
 *
 * Re-registering same type overwrites previous (supports HMR).
 */
export function registerContainerFactory(
    type: SceneObjectType,
    factory: ContainerFactory,
): void {
    containerFactoryRegistry.set(type, factory)
}

/**
 * Get registered container factory
 *
 * Returns undefined if unregistered; caller should fallback or throw.
 */
export function getContainerFactory(type: SceneObjectType): ContainerFactory | undefined {
    return containerFactoryRegistry.get(type)
}

/**
 * Check if a type is registered
 */
export function hasContainerFactory(type: SceneObjectType): boolean {
    return containerFactoryRegistry.has(type)
}

/**
 * Get list of all registered types (for debugging/testing)
 */
export function getRegisteredTypes(): SceneObjectType[] {
    return [...containerFactoryRegistry.keys()]
}

/**
 * Clear registry (testing only)
 */
export function clearContainerFactoryRegistry(): void {
    containerFactoryRegistry.clear()
}

// ============================================================================
// Lifecycle Hooks Registry (P2)
// ============================================================================

/**
 * Store operation interface (minimum dependencies passed to hooks)
 *
 * Prevents hooks from directly referencing Store (avoiding circular dependencies), only exposing necessary operations.
 */
export interface LifecycleStoreAccessor {
    getObject(id: string): import('@/types/sceneObject').SceneObject | undefined
    removeObject(id: string): void
    updateObject<T extends import('@/types/sceneObject').SceneObject = import('@/types/sceneObject').SceneObject>(id: string, updates: import('@/types/sceneObject').SceneObjectUpdateFor<T>): void
    duplicateObject(id: string): import('@/types/sceneObject').SceneObject | undefined
}

/**
 * Object type lifecycle hooks
 *
 * Types extend generic Store operations by registering hooks, avoiding internal type-check + cast in Store.
 */
export interface ObjectLifecycleHooks {
    /** Pre-deletion callback — used for cascading child deletion, etc. */
    onBeforeDelete?(obj: import('@/types/sceneObject').SceneObject, store: LifecycleStoreAccessor): void
    /** Post-duplication callback — used for recursive child duplication, relation updates, etc. */
    onAfterDuplicate?(original: import('@/types/sceneObject').SceneObject, duplicate: import('@/types/sceneObject').SceneObject, store: LifecycleStoreAccessor): void
}

const lifecycleHooksRegistry = new Map<SceneObjectType, ObjectLifecycleHooks>()

/** Register lifecycle hooks for an object type */
export function registerLifecycleHooks(type: SceneObjectType, hooks: ObjectLifecycleHooks): void {
    lifecycleHooksRegistry.set(type, hooks)
}

/** Get lifecycle hooks for an object type */
export function getLifecycleHooks(type: SceneObjectType): ObjectLifecycleHooks | undefined {
    return lifecycleHooksRegistry.get(type)
}
