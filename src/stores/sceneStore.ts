/**
 * Scene management Store
 * Manages current scene and its script nodes
 */

import { defineStore } from 'pinia'
import { computed,ref } from 'vue'

import type { Scene, TimelineNode } from '@/types/project'
import type { ActorConfig } from '@/types/screenplay'

export const useSceneStore = defineStore('scene', () => {
  // Scene list
  const scenes = ref<Scene[]>([])
  // Current scene
  const currentScene = ref<Scene | null>(null)

  /**
   * Generate unique ID
   */
  function generateId(prefix = 'id'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Create new scene
   */
  function createScene(name: string, backgroundId: string): Scene {
    const scene: Scene = {
      id: generateId('scene'),
      name,
      backgroundId,
      actors: [],
      script: [],
      duration: 0,
      createdAt: Date.now()
    }

    scenes.value.push(scene)
    currentScene.value = scene

    return scene
  }

  /**
   * Switch current scene
   */
  function switchScene(sceneId: string): boolean {
    const scene = scenes.value.find(s => s.id === sceneId)
    if (!scene) return false

    currentScene.value = scene
    return true
  }

  /**
   * Set current scene
   */
  function setCurrentScene(scene: Scene | null): void {
    currentScene.value = scene
  }

  /**
   * Update scene information
   */
  function updateScene(updates: Partial<Scene>): boolean {
    if (!currentScene.value) return false

    Object.assign(currentScene.value, updates)
    return true
  }

  /**
   * Add actor to scene
   */
  function addActor(actor: ActorConfig): boolean {
    if (!currentScene.value) return false

    currentScene.value.actors.push(actor)
    return true
  }

  /**
   * Remove actor from scene
   */
  function removeActor(actorId: string): boolean {
    if (!currentScene.value) return false

    const index = currentScene.value.actors.findIndex(a => a.id === actorId)
    if (index !== -1) {
      currentScene.value.actors.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * Get actor in scene
   */
  function getActor(actorId: string): ActorConfig | undefined {
    if (!currentScene.value) return undefined
    return currentScene.value.actors.find(a => a.id === actorId)
  }

  /**
   * Update actor information
   */
  function updateActor(actorId: string, updates: Partial<ActorConfig>): boolean {
    const actor = getActor(actorId)
    if (!actor) return false

    Object.assign(actor, updates)
    return true
  }

  /**
   * Add script node
   */
  function addScriptNode(node: TimelineNode): boolean {
    if (!currentScene.value) return false

    currentScene.value.script.push(node)
    recalculateDuration()
    return true
  }

  /**
   * Remove script node
   */
  function removeScriptNode(nodeId: string): boolean {
    if (!currentScene.value) return false

    const index = currentScene.value.script.findIndex(n => n.id === nodeId)
    if (index !== -1) {
      currentScene.value.script.splice(index, 1)
      recalculateDuration()
      return true
    }
    return false
  }

  /**
   * Get script node
   */
  function getScriptNode(nodeId: string): TimelineNode | undefined {
    if (!currentScene.value) return undefined
    return currentScene.value.script.find(n => n.id === nodeId)
  }

  /**
   * Update script node
   */
  function updateScriptNode(nodeId: string, updates: Partial<TimelineNode>): boolean {
    const node = getScriptNode(nodeId)
    if (!node) return false

    Object.assign(node, updates)
    recalculateDuration()
    return true
  }

  /**
   * Recalculate scene duration
   */
  function recalculateDuration(): void {
    if (!currentScene.value) return

    if (currentScene.value.script.length === 0) {
      currentScene.value.duration = 0
      return
    }

    // Find end time of the last node
    const maxEnd = Math.max(
      ...currentScene.value.script.map(node => node.start + node.duration)
    )
    currentScene.value.duration = maxEnd
  }

  /**
   * Ripple editing: automatically push subsequent nodes when updating node duration
   */
  function updateNodeDurationWithRipple(nodeId: string, newDuration: number): boolean {
    if (!currentScene.value) return false

    const node = getScriptNode(nodeId)
    if (!node) return false

    const oldDuration = node.duration
    const deltaTime = newDuration - oldDuration

    // Update current node duration
    node.duration = newDuration

    // Push subsequent nodes
    if (deltaTime !== 0) {
      currentScene.value.script.forEach(n => {
        if (n.start > node.start) {
          n.start += deltaTime
        }
      })
    }

    recalculateDuration()
    return true
  }

  /**
   * Sort script nodes (by start time)
   */
  function sortScriptNodes(): void {
    if (!currentScene.value) return
    currentScene.value.script.sort((a, b) => a.start - b.start)
  }

  /**
   * Clear scene
   */
  function clearScene(): void {
    currentScene.value = null
  }

  /**
   * Delete scene
   */
  function deleteScene(sceneId: string): boolean {
    const index = scenes.value.findIndex(s => s.id === sceneId)
    if (index === -1) return false

    scenes.value.splice(index, 1)

    // If deleted scene is current scene, switch to first scene
    if (currentScene.value?.id === sceneId) {
      const firstScene = scenes.value[0]
      currentScene.value = firstScene ?? null
    }

    return true
  }

  // Computed properties
  const hasScene = computed(() => currentScene.value !== null)
  const actorCount = computed(() => currentScene.value?.actors.length ?? 0)
  const nodeCount = computed(() => currentScene.value?.script.length ?? 0)
  const sceneDuration = computed(() => currentScene.value?.duration ?? 0)

  return {
    // State
    scenes,
    currentScene,
    hasScene,
    actorCount,
    nodeCount,
    sceneDuration,

    // Scene management
    createScene,
    switchScene,
    setCurrentScene,
    updateScene,
    clearScene,
    deleteScene,

    // Actor management
    addActor,
    removeActor,
    getActor,
    updateActor,

    // Script node management
    addScriptNode,
    removeScriptNode,
    getScriptNode,
    updateScriptNode,
    updateNodeDurationWithRipple,
    sortScriptNodes,
    recalculateDuration
  }
})
