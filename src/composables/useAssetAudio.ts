import { computed, reactive, ref } from 'vue'

import { useProjectStore } from '@/stores/projectStore'
import { loadAssetFromDisk } from '@/utils/fileSystem'

// ========================================
// Global singleton cache (shared across all components)
// ========================================
const globalAudioCache = reactive<Record<string, string>>({})
const globalCacheVersion = ref(0)
const globalLoadingPaths = new Set<string>()
const globalCreatedBlobUrls = new Set<string>()

/**
 * Unified asset audio loader Composable
 * Converts relative paths to Blob URLs for playback
 */
export function useAssetAudio() {
  const projectStore = useProjectStore()

  /**
   * Get audio URL (sync version)
   * If it is a path, loads asynchronously and caches it
   * If not cached, returns empty string
   */
  function getAudioUrl(pathOrUrl: string | null | undefined): string {
    if (!pathOrUrl) return ''

    // If already Blob URL or data URL, return directly
    if (pathOrUrl.startsWith('blob:') || pathOrUrl.startsWith('data:')) {
      return pathOrUrl
    }

    // Access cacheVersion to ensure reactive tracking
    if (globalCacheVersion.value < 0) { /* noop */ }

    // Check cache
    if (pathOrUrl in globalAudioCache) {
      return globalAudioCache[pathOrUrl] ?? ''
    }

    // If it is a path, load asynchronously
    if (projectStore.isProjectOpen && projectStore.projectHandle) {
      void loadAudioUrl(pathOrUrl)
    }

    return ''
  }

  /**
   * Asynchronously load audio URL
   */
  async function loadAudioUrl(path: string) {
    // If already Blob URL or data URL, no need to load
    if (path.startsWith('blob:') || path.startsWith('data:')) {
      return
    }

    if (!projectStore.projectHandle) {
      console.warn('[useAssetAudio] Project not open, skipping load:', path)
      return
    }

    // If already in cache, return directly
    if (path in globalAudioCache) {

      return
    }

    // If already loading, wait for completion
    if (globalLoadingPaths.has(path)) {
      console.log('[useAssetAudio] Waiting for existing load:', path)
      // Wait for completion (polling)
      while (globalLoadingPaths.has(path)) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      return
    }

    // Mark as loading
    globalLoadingPaths.add(path)


    try {
      const blobUrl = await loadAssetFromDisk(projectStore.projectHandle, path)


      if (blobUrl) {
        globalAudioCache[path] = blobUrl
        // Record created Blob URL
        if (blobUrl.startsWith('blob:')) {
          globalCreatedBlobUrls.add(blobUrl)
        }
        // Trigger reactive update
        globalCacheVersion.value++
      } else {
        console.warn('[useAssetAudio] Load returned empty:', path)
      }
    } catch (error) {
      console.error('[useAssetAudio] Failed to load audio:', path, error)
    } finally {
      // Remove loading flag
      globalLoadingPaths.delete(path)
    }
  }

  /**
   * Preload multiple audio files
   */
  function preloadAudios(paths: string[]) {
    if (!projectStore.isProjectOpen || !projectStore.projectHandle) return

    // Deduplicate paths
    const uniquePaths = Array.from(new Set(paths))

    uniquePaths.forEach(path => {
      if (path && !path.startsWith('blob:') && !path.startsWith('data:') && !(path in globalAudioCache) && !globalLoadingPaths.has(path)) {
        void loadAudioUrl(path)
      }
    })
  }

  /**
   * Clear cache
   */
  function clearCache() {
    // Revoke all Blob URLs
    globalCreatedBlobUrls.forEach(url => {
      try {
        URL.revokeObjectURL(url)
      } catch (error) {
        console.error('[useAssetAudio] Failed to revoke Blob URL:', url, error)
      }
    })
    globalCreatedBlobUrls.clear()

    // Clear cache object
    Object.keys(globalAudioCache).forEach(key => {
      delete globalAudioCache[key]
    })
    globalCacheVersion.value++
  }

  /**
   * Revoke single Blob URL
   * @param path Path
   */
  function revokeBlobUrl(path: string) {
    const url = globalAudioCache[path]
    if (url?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url)
        globalCreatedBlobUrls.delete(url)
        delete globalAudioCache[path]
        globalCacheVersion.value++
      } catch (error) {
        console.error('[useAssetAudio] Failed to revoke Blob URL:', path, error)
      }
    }
  }

  /**
   * Check if asset is ready
   */
  function isAudioReady(path: string): boolean {
    if (!path) return true
    return path in globalAudioCache
  }

  return {
    getAudioUrl,
    loadAudioUrl,
    preloadAudios,
    clearCache,
    revokeBlobUrl,
    isAudioReady,
    audioCache: computed(() => globalAudioCache)
  }
}
