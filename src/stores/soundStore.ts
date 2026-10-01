import { defineStore } from 'pinia'
import { computed,ref } from 'vue'

import type { SoundAsset } from '@/types/project'
import { generateId } from '@/utils/uuid'

import { useProjectStore } from './projectStore'

export const useSoundStore = defineStore('sound', () => {
  const sounds = ref<SoundAsset[]>([])

  /**
   * Get all used tags
   */
  const allTags = computed(() => {
    const tags = new Set<string>()
    sounds.value.forEach(p => p.tags?.forEach(t => tags.add(t)))
    return Array.from(tags).sort()
  })

  /**
   * Get all BGM
   */
  const bgms = computed(() => {
    return sounds.value.filter(s => s.type === 'bgm')
  })

  /**
   * Get all SFX
   */
  const sfxs = computed(() => {
    return sounds.value.filter(s => s.type === 'sfx')
  })

  /**
   * Create new sound effect
   */
  function createSound(name: string, type: 'bgm' | 'sfx' = 'sfx'): SoundAsset {
    const sound: SoundAsset = {
      id: generateId('sound'),
      name,
      type,
      tags: [],
      url: '', // Initially empty, set later
      createdAt: Date.now(),
      // Default properties
      volume: 1.0,
      loop: type === 'bgm', // BGM loops by default
      fadeIn: 0,
      fadeOut: 0
    }
    sounds.value.push(sound)
    
    const projectStore = useProjectStore()
    projectStore.markAsUnsaved()
    
    return sound
  }

  /**
   * Delete sound effect
   */
  function deleteSound(id: string) {
    const index = sounds.value.findIndex(p => p.id === id)
    if (index !== -1) {
      sounds.value.splice(index, 1)
      const projectStore = useProjectStore()
      projectStore.markAsUnsaved()
    }
  }

  /**
   * Get sound effect
   */
  function getSound(id: string): SoundAsset | undefined {
    return sounds.value.find(p => p.id === id)
  }

  /**
   * Update sound effect information
   */
  function updateSound(id: string, updates: Partial<SoundAsset>): boolean {
    const sound = getSound(id)
    if (sound) {
      Object.assign(sound, updates)
      
      const projectStore = useProjectStore()
      projectStore.markAsUnsaved()
      return true
    }
    return false
  }

  /**
   * Clear all data
   */
  function clearAll() {
    sounds.value = []
  }

  /**
   * Set sound effects list (used for loading project)
   */
  function setSounds(list: SoundAsset[]) {
    sounds.value = list
  }

  return {
    sounds,
    allTags,
    bgms,
    sfxs,
    createSound,
    deleteSound,
    getSound,
    updateSound,
    clearAll,
    setSounds
  }
})
