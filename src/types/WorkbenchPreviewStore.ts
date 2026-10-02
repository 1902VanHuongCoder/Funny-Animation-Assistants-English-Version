/**
 * WorkbenchPreviewStore — Narrow interface for animation workbench preview store
 *
 * Background:
 *   LightweightCanvas internally uses createAnimationSceneObjectStore() to construct an
 *   isolated store implementing the full SceneObjectProvider interface for reading/writing objects during preview,
 *   avoiding polluting the global sceneObjectStore.
 *
 * Why a narrow interface is needed:
 *   AnimationWorkbench.vue as a consumer only requires 5 capabilities: reading all objects, reading selected object ID,
 *   getting object by ID, writing object, and setting selection. Others (getSortedObjects / getSceneRenderChain
 *   / updateSetupObject, etc.) are outside the workbench's scope of responsibility. Exposing the full SceneObjectProvider
 *   would:
 *     1) Allow future code to casually invoke methods unrelated to workbench, widening coupling;
 *     2) Prevent readers from seeing at a glance "which exact capabilities of the store the workbench depends on".
 *
 *   This interface solidifies the minimum viable surface of the preview store from the "workbench perspective",
 *   retaining necessary read/write capabilities while avoiding exposing unnecessary implementation details.
 *
 * Invariants:
 *   The underlying instance remains the same AnimationSceneObjectStore return value (reactive object).
 *   `objects` / `selectedObjectId` continue to be reactive references, accessed directly in templates and computed properties.
 *   This module only performs type narrowing without introducing runtime wrappers.
 */

import type { SceneObject, SceneObjectUpdateFor } from '@/types/sceneObject'

export interface WorkbenchPreviewStore {
    /**
     * All objects in current isolated store (reactive array).
     * Note: Type remains mutable to stay compatible with prop signatures of downstream components like KeyframePropertyPanel;
     * Workbench itself should not directly push/splice this array — use updateObject / selectObject instead.
     */
    readonly objects: SceneObject[]
    /** Currently selected object ID; null when none selected. Reactive. */
    readonly selectedObjectId: string | null
    /** Find object by ID; returns undefined when not found. */
    getObject(id: string): SceneObject | undefined
    /** Write object field updates to isolated store (only affects preview, does not touch global store). */
    updateObject<T extends SceneObject = SceneObject>(
        id: string,
        updates: SceneObjectUpdateFor<T>,
    ): void
    /** Set currently selected object; pass null to deselect. */
    selectObject(id: string | null): void
    /**
     * Returns render chain order of current scene objects (bottom-to-top). Used by workbench to deduce object tree display order,
     * consistent with underlying SceneObjectProvider method of same name.
     */
    getSceneRenderChain(): string[]
}
