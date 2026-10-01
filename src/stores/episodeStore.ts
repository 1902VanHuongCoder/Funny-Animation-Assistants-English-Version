/**
 * Episode Store - Episode management
 * Responsible for managing multiple Episodes in project
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { BGMTrack, SceneContainer, ScriptBlock } from '@/types/screenplay'

import { useProjectStore } from './projectStore'

/**
 * Actor configuration
 */
export interface Actor {
  id: string                 // Name referenced in script (e.g. "Xiao Ming")
  name: string               // Actor name
  characterId: string        // Associated character ID
  voiceId: number            // TTS Provider voice ID
}

/**
 * Narration configuration
 */
export interface Narrator {
  id: string      // Narration ID
  name: string    // Narration name (e.g. "Narrator 1")
  voiceId: number // TTS Provider voice ID
}

/**
 * Episode
 * v6.0: Merged Screenplay, directly contains screenplay content (scenes)
 * Actor and narrator configurations have been moved to Project level
 */
export interface Episode {
  id: string
  episodeNumber: number      // Episode number (1, 2, 3...)
  name: string               // Episode name

  // Screenplay content (formerly Screenplay.scenes)
  scenes: SceneContainer[]   // Scene list

  // Soundtrack management (v7.5)
  bgmTracks: BGMTrack[]

  // Metadata
  duration: number           // Duration (seconds)
  thumbnail?: string         // Thumbnail (Base64 or Blob URL)
  createdAt: number
  modifiedAt: number
  version?: string           // Data version
}

export const useEpisodeStore = defineStore('episode', () => {
  const projectStore = useProjectStore()

  // State
  const episodes = ref<Episode[]>([])
  const currentEpisodeId = ref<string | null>(null)

  // Computed properties
  const currentEpisode = computed(() => {
    if (!currentEpisodeId.value) return null
    return episodes.value.find(ep => ep.id === currentEpisodeId.value)
  })

  const sortedEpisodes = computed(() => {
    return [...episodes.value].sort((a, b) => a.episodeNumber - b.episodeNumber)
  })

  /**
   * Create new animation episode
   */
  function createEpisode(name: string): Episode {
    const maxEpisodeNumber = episodes.value.length > 0
      ? Math.max(...episodes.value.map(ep => ep.episodeNumber))
      : 0

    const episode: Episode = {
      id: `episode_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      episodeNumber: maxEpisodeNumber + 1,
      name: name || `Episode ${maxEpisodeNumber + 1}`,
      scenes: [],  // Initialized as empty scene list
      bgmTracks: [], // Initialized as empty soundtrack list
      duration: 0,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      version: '6.0'
    }

    episodes.value.push(episode)


    return episode
  }

  /**
   * Get episode
   */
  function getEpisode(id: string): Episode | undefined {
    return episodes.value.find(ep => ep.id === id)
  }

  /**
   * Update episode
   */
  function updateEpisode(id: string, data: Partial<Episode>): void {
    const index = episodes.value.findIndex(ep => ep.id === id)
    const currentEp = episodes.value[index]
    if (index !== -1 && currentEp) {
      episodes.value[index] = {
        ...currentEp,
        ...data,
        modifiedAt: Date.now()
      }

    }
  }

  /**
   * Delete episode
   */
  function deleteEpisode(id: string): void {
    const index = episodes.value.findIndex(ep => ep.id === id)
    if (index !== -1) {
      episodes.value.splice(index, 1)

      // If deleting current episode, clear current episode ID
      if (currentEpisodeId.value === id) {
        currentEpisodeId.value = null
      }


    }
  }

  /**
   * Set currently editing episode
   */
  function setCurrentEpisode(id: string): void {
    if (episodes.value.find(ep => ep.id === id)) {
      currentEpisodeId.value = id

    }
  }

  /**
   * Clear all episodes
   */
  function clearAll(): void {
    episodes.value = []
    currentEpisodeId.value = null
  }

  // ==================== Scene Management Methods ====================

  /**
   * Add scene to episode
   */
  function addScene(episodeId: string, scene: SceneContainer): void {
    const episode = getEpisode(episodeId)
    if (episode) {
      episode.scenes.push(scene)
      episode.modifiedAt = Date.now()
      projectStore.markAsUnsaved()

    }
  }

  /**
   * Insert scene at specified index
   */
  function insertScene(episodeId: string, scene: SceneContainer, index: number): void {
    const episode = getEpisode(episodeId)
    if (episode) {
      episode.scenes.splice(index, 0, scene)
      episode.modifiedAt = Date.now()
      projectStore.markAsUnsaved()

    }
  }

  /**
   * Get scene
   */
  function getScene(episodeId: string, sceneId: string): SceneContainer | undefined {
    const episode = getEpisode(episodeId)
    return episode?.scenes.find((s) => s.id === sceneId)
  }

  /**
   * Update scene
   */
  function updateScene(episodeId: string, sceneId: string, updates: Partial<SceneContainer>): void {
    const episode = getEpisode(episodeId)
    if (episode) {
      const scene = episode.scenes.find((s) => s.id === sceneId)
      if (scene) {
        Object.assign(scene, updates)
        episode.modifiedAt = Date.now()
        projectStore.markAsUnsaved()
      }
    }
  }

  /**
   * Delete scene
   */
  function deleteScene(episodeId: string, sceneId: string): void {
    const episode = getEpisode(episodeId)
    if (episode) {
      const index = episode.scenes.findIndex((s) => s.id === sceneId)
      if (index !== -1) {
        episode.scenes.splice(index, 1)
        episode.modifiedAt = Date.now()
        projectStore.markAsUnsaved()

      }
    }
  }

  /**
   * Move scene position (move up / move down)
   */
  function moveScene(episodeId: string, sceneId: string, direction: 'up' | 'down'): void {
    const episode = getEpisode(episodeId)
    if (!episode) return

    const index = episode.scenes.findIndex((s) => s.id === sceneId)
    if (index === -1) return

    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= episode.scenes.length) return

    // Swap adjacent elements
    const temp = episode.scenes[index]!
    episode.scenes[index] = episode.scenes[targetIndex]!
    episode.scenes[targetIndex] = temp

    episode.modifiedAt = Date.now()
    projectStore.markAsUnsaved()
  }

  /**
   * Update scene list for episode
   */
  function updateScenes(episodeId: string, scenes: SceneContainer[]): void {
    const episode = getEpisode(episodeId)
    if (episode) {
      episode.scenes = scenes
      episode.modifiedAt = Date.now()
      projectStore.markAsUnsaved()
    }
  }

  /**
   * Get scene list for episode
   */
  function getScenes(episodeId: string): SceneContainer[] {
    const episode = getEpisode(episodeId)
    return episode?.scenes ?? []
  }

  // ==================== Block Management Methods ====================

  /**
   * Add Block to scene
   */
  function addBlockToScene(episodeId: string, sceneId: string, block: ScriptBlock): void {
    const scene = getScene(episodeId, sceneId)
    if (scene) {
      scene.script.push(block)
      const episode = getEpisode(episodeId)
      if (episode) {
        episode.modifiedAt = Date.now()
        projectStore.markAsUnsaved()
      }
    }
  }

  /**
   * Update Block in scene
   */
  function updateBlockInScene(episodeId: string, sceneId: string, blockId: string, updates: Partial<ScriptBlock>): void {
    const scene = getScene(episodeId, sceneId)
    if (scene) {
      const block = scene.script.find((b) => b.id === blockId)
      if (block) {
        Object.assign(block, updates)
        const episode = getEpisode(episodeId)
        if (episode) {
          episode.modifiedAt = Date.now()
          projectStore.markAsUnsaved()
        }
      }
    }
  }

  /**
   * Delete Block in scene
   * v10: Also clean up Shadow Objects born in this Block
   */
  function deleteBlockFromScene(episodeId: string, sceneId: string, blockId: string): void {
    const scene = getScene(episodeId, sceneId)
    if (scene) {
      const index = scene.script.findIndex((b) => b.id === blockId)
      if (index !== -1) {
        const block = scene.script[index]
        if (!block) return

        // v10: Clean up associated shadow objects before deleting block
        if (block.actions && scene.setup?.objects) {
          // Find object IDs corresponding to all birth actions (set_lifecycle + spawned: true) in this block
          const birthTargetIds = block.actions
            .filter(a => a.type === 'set_lifecycle' && (a as { params: { spawned: boolean } }).params.spawned === true)
            .map(a => a.target)

          for (const targetId of birthTargetIds) {
            // Only delete shadow object (dynamic object with spawned === false in setup)
            const setupObj = scene.setup.objects.find(o => o.id === targetId)
            if (setupObj?.spawned === false) {
              // Remove object from setup
              scene.setup.objects = scene.setup.objects.filter(o => o.id !== targetId)
              // Clean up actions referencing this object in other blocks
              for (const otherBlock of scene.script) {
                if (otherBlock.id !== blockId && otherBlock.actions) {
                  otherBlock.actions = otherBlock.actions.filter(a => a.target !== targetId)
                }
              }
            }
          }
        }

        scene.script.splice(index, 1)
        const episode = getEpisode(episodeId)
        if (episode) {
          episode.modifiedAt = Date.now()
          projectStore.markAsUnsaved()
        }
      }
    }
  }

  // ==================== BGM Management Methods (v7.5) ====================

  function addBGMTrack(episodeId: string, track: BGMTrack): void {
    const episode = getEpisode(episodeId)
    if (episode) {
      if (!episode.bgmTracks) episode.bgmTracks = []
      episode.bgmTracks.push(track)
      episode.modifiedAt = Date.now()
      projectStore.markAsUnsaved()
    }
  }

  function updateBGMTrack(episodeId: string, trackId: string, updates: Partial<BGMTrack>): void {
    const episode = getEpisode(episodeId)
    if (episode?.bgmTracks) {
      const track = episode.bgmTracks.find(t => t.id === trackId)
      if (track) {
        Object.assign(track, updates)
        episode.modifiedAt = Date.now()
        projectStore.markAsUnsaved()
      }
    }
  }

  function removeBGMTrack(episodeId: string, trackId: string): void {
    const episode = getEpisode(episodeId)
    if (episode?.bgmTracks) {
      const index = episode.bgmTracks.findIndex(t => t.id === trackId)
      if (index !== -1) {
        episode.bgmTracks.splice(index, 1)
        episode.modifiedAt = Date.now()
        projectStore.markAsUnsaved()
      }
    }
  }

  function setBGMTracks(episodeId: string, tracks: BGMTrack[]): void {
    const episode = getEpisode(episodeId)
    if (episode) {
      episode.bgmTracks = tracks
      episode.modifiedAt = Date.now()
      projectStore.markAsUnsaved()
    }
  }

  return {
    // State
    episodes,
    currentEpisodeId,
    currentEpisode,
    sortedEpisodes,

    // Episode management methods
    createEpisode,
    getEpisode,
    updateEpisode,
    deleteEpisode,
    setCurrentEpisode,
    clearAll,

    // Scene management methods
    addScene,
    insertScene,
    getScene,
    updateScene,
    deleteScene,
    moveScene,
    updateScenes,
    getScenes,

    // Block management methods
    addBlockToScene,
    updateBlockInScene,
    deleteBlockFromScene,

    // BGM management
    addBGMTrack,
    updateBGMTrack,
    removeBGMTrack,
    setBGMTracks
  }
})
