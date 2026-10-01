/**
 * Auto-save functionality
 * Watches Store changes and periodically auto-saves project
 */

import { watch } from 'vue'

import { useBackgroundStore } from '@/stores/backgroundStore'
import { useEpisodeStore } from '@/stores/episodeStore'
import { useExpressionStore } from '@/stores/expressionStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSceneStore } from '@/stores/sceneStore'

// Debounce function
function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null

  return function (this: unknown, ...args: Parameters<T>) {
    if (timeout) {
      clearTimeout(timeout)
    }

    timeout = setTimeout(() => {
      func.apply(this, args)
      timeout = null
    }, wait)
  }
}

/**
 * Enable auto-save
 * @param interval Auto-save interval (ms), default 30 seconds
 */
export function useAutoSave(interval = 30000) {
  const expressionStore = useExpressionStore()
  const backgroundStore = useBackgroundStore()
  const sceneStore = useSceneStore()
  const episodeStore = useEpisodeStore()
  const projectStore = useProjectStore()

  // Create debounced auto-save function
  const debouncedAutoSave = debounce(async () => {
    if (!projectStore.autoSaveEnabled) return

    await projectStore.autoSave()
  }, interval)

  // characterStore watcher has been removed

  // Watch expressionStore changes
  watch(
    () => expressionStore.expressions,
    () => {
      debouncedAutoSave()
    },
    { deep: true }
  )

  // Watch backgroundStore changes
  watch(
    () => backgroundStore.backgrounds,
    () => {
      debouncedAutoSave()
    },
    { deep: true }
  )

  // Watch sceneStore changes
  watch(
    () => sceneStore.currentScene,
    () => {
      debouncedAutoSave()
    },
    { deep: true }
  )

  // Watch episodeStore changes
  watch(
    () => episodeStore.episodes,
    () => {
      debouncedAutoSave()
    },
    { deep: true }
  )

  return {
    enable: () => {
      projectStore.autoSaveEnabled = true
    },
    disable: () => {
      projectStore.autoSaveEnabled = false
    },
    triggerNow: () => {
      debouncedAutoSave()
    }
  }
}
