import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { Background } from '@/types/project'

import { useProjectStore } from './projectStore'


export const useBackgroundStore = defineStore('background', () => {
  const backgrounds = ref<Background[]>([])

  /**
   * Generate unique ID
   */
  function generateId(): string {
    return `bg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Get all used tags
   */
  const allTags = computed(() => {
    const tags = new Set<string>()
    backgrounds.value.forEach(p => p.tags?.forEach(t => tags.add(t)))
    return Array.from(tags).sort()
  })

  /**
   * Create new background
   */
  function createBackground(name: string, type: 'static' | 'animation' = 'static'): Background {
    const bg: Background = {
      id: generateId(),
      name,
      type,
      tags: [],
      createdAt: Date.now(),
      fps: 25,
      loop: true
    }
    backgrounds.value.push(bg)

    const projectStore = useProjectStore()
    projectStore.markAsUnsaved()

    return bg
  }

  /**
   * Delete background
   */
  function deleteBackground(id: string): boolean {
    const index = backgrounds.value.findIndex(p => p.id === id)
    if (index !== -1) {
      // Release Blob URL
      const bg = backgrounds.value[index]
      if (bg) {
        if (bg._runtimeUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(bg._runtimeUrl)
        }
        if (bg._runtimeStillUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(bg._runtimeStillUrl)
        }
        bg.frames?.forEach(frame => {
          if (frame._runtimeUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(frame._runtimeUrl)
          }
        })
      }

      backgrounds.value.splice(index, 1)

      const projectStore = useProjectStore()
      projectStore.markAsUnsaved()
      return true
    }
    return false
  }

  /**
   * Get background
   */
  function getBackground(id: string): Background | undefined {
    return backgrounds.value.find(p => p.id === id)
  }

  /**
   * Update background information
   */
  function updateBackground(id: string, updates: Partial<Background>): boolean {
    const bg = getBackground(id)
    if (bg) {
      Object.assign(bg, updates)

      const projectStore = useProjectStore()
      projectStore.markAsUnsaved()
      return true
    }
    return false
  }

  /**
   * Clear all backgrounds
   */
  function clearAll() {
    // Release all resources
    backgrounds.value.forEach(bg => {
      if (bg._runtimeUrl?.startsWith('blob:')) URL.revokeObjectURL(bg._runtimeUrl)
      if (bg._runtimeStillUrl?.startsWith('blob:')) URL.revokeObjectURL(bg._runtimeStillUrl)
      bg.frames?.forEach(frame => {
        if (frame._runtimeUrl?.startsWith('blob:')) URL.revokeObjectURL(frame._runtimeUrl)
      })
    })
    backgrounds.value = []
  }

  /**
   * Set background list (used for loading project)
   */
  function setBackgrounds(list: Background[]) {
    backgrounds.value = list
  }

  return {
    backgrounds,
    allTags,
    createBackground,
    deleteBackground,
    getBackground,
    updateBackground,
    clearAll,
    setBackgrounds
  }
})
