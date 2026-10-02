/**
 * SceneObjectProvider — Scene object data access abstraction interface
 *
 * Abstracting direct dependency of useSceneRenderer / useSceneGraph on sceneObjectStore,
 * enabling isolated scenarios like animation editing to inject independent store implementations for complete data isolation.
 *
 * Global sceneObjectStore naturally satisfies this interface (subset), requiring no adaptation.
 */

import type { SceneObject, SceneObjectUpdateFor } from '@/types/sceneObject'
import type { SlotStatesResult } from '@/utils/sceneStateCalculator'

export interface SceneObjectProvider {
  // ---- Reactive state ----
  /**
   * Active layer object list (setup or runtime).
   * For Pinia stores, this is an auto-unwrapped computed (returns array directly).
   * For custom implementations, provide a getter returning a reactive array.
   */
  readonly objects: SceneObject[]
  /** Currently selected object ID (Pinia automatically unwraps to string | null) */
  selectedObjectId: string | null

  // ---- Read methods ----
  getObject(id: string): SceneObject | undefined
  getSortedObjects(): SceneObject[]
  getSceneRenderChain(): string[]

  // ---- Write methods ----
  selectObject(id: string | null): void
  updateObject<T extends SceneObject = SceneObject>(id: string, updates: SceneObjectUpdateFor<T>): void
  updateSetupObject<T extends SceneObject = SceneObject>(id: string, updates: SceneObjectUpdateFor<T>): void

  // ---- Optional: Action Mode ----
  applySlotState?(slotStates: SlotStatesResult, excludeIds?: Set<string>): void
}
