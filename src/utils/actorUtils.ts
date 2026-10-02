/**
 * Actor utility functions
 * v7.0: Updated to use instance lookup logic
 */

import { useProjectStore } from '@/stores/projectStore'
import type { SceneObject } from '@/types/sceneObject'
import type { SceneContainer } from '@/types/screenplay'

/**
 * Get actor config by characterId
 * @param characterId Character asset ID
 * @returns Actor config object, or null if not found
 */
export function getActorByCharacterId(characterId: string) {
  const projectStore = useProjectStore()

  // Find in project-level actor configs
  return projectStore.actors.find((a) => a.characterId === characterId) ?? null
}

/**
 * v7.0: Get scene object by instance ID
 * @param scene Scene container
 * @param instanceId Instance ID (SceneObject.id)
 * @returns Scene object, or null if not found
 */
export function getSceneObjectById(scene: SceneContainer, instanceId: string): SceneObject | null {
  return scene.setup.objects.find(obj => obj.id === instanceId) ?? null
}

/**
 * v7.0: Get alias of instance
 * @param scene Scene container
 * @param instanceId Instance ID
 * @returns Alias, or null if not found
 */
export function getInstanceAlias(scene: SceneContainer, instanceId: string): string | null {
  const obj = getSceneObjectById(scene, instanceId)
  if (!obj) return null

  return obj.alias ?? null
}
