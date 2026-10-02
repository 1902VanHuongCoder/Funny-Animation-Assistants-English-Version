import { computed, reactive, ref } from 'vue'

import { useProjectStore } from '@/stores/projectStore'
import { loadAssetFromDisk } from '@/utils/fileSystem'

// ========================================
// Global singleton cache (shared across all components)
// ========================================
const globalImageCache = reactive<Record<string, string>>({})
const globalCacheVersion = ref(0)
const globalLoadingPaths = new Set<string>()
const globalCreatedBlobUrls = new Set<string>()

/**
 * Unified asset image loader Composable
 * Converts relative paths to Blob URLs for display
 */
export function useAssetImage() {
  const projectStore = useProjectStore()

  /**
   * Get image URL (sync version, used in templates)
   * If it is a path, loads asynchronously and caches it
   * If not cached, returns a transparent placeholder (avoids browser attempting to load invalid path)
   */
  function getImageUrl(pathOrUrl: string | null | undefined): string {
    if (!pathOrUrl) return ''

    // If already Blob URL or data URL, return directly
    if (pathOrUrl.startsWith('blob:') || pathOrUrl.startsWith('data:')) {
      return pathOrUrl
    }

    // Access cacheVersion to ensure reactive tracking
    if (globalCacheVersion.value < 0) { /* noop */ }

    // Check cache
    if (pathOrUrl in globalImageCache) {
      const cachedUrl = globalImageCache[pathOrUrl]
      return cachedUrl ?? ''
    }

    // If it is a path, load asynchronously (do not return raw path to prevent browser image errors)
    if (projectStore.isProjectOpen && projectStore.projectHandle) {
      void loadImageUrl(pathOrUrl)
    }

    // Return transparent placeholder (1x1 pixel transparent PNG) to prevent browser loading empty string as relative URL
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  }

  /**
   * Asynchronously load image URL
   */
  async function loadImageUrl(path: string) {
    if (!projectStore.projectHandle) {
      console.warn('[useAssetImage] Project not open, skipping load:', path)
      return
    }

    // If already in cache, return directly
    if (path in globalImageCache) {
      return
    }

    // If already loading, wait for completion
    if (globalLoadingPaths.has(path)) {
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
        globalImageCache[path] = blobUrl
        // Record created Blob URL
        if (blobUrl.startsWith('blob:')) {
          globalCreatedBlobUrls.add(blobUrl)
        }
        // Trigger reactive update
        globalCacheVersion.value++
      } else {
        console.warn('[useAssetImage] Load returned empty:', path)
      }
    } catch (error) {
      console.error('[useAssetImage] Failed to load image:', path, error)
    } finally {
      // Remove loading flag
      globalLoadingPaths.delete(path)
    }
  }

  /**
   * Preload multiple images
   */
  async function preloadImages(paths: string[]) {
    if (!projectStore.isProjectOpen || !projectStore.projectHandle) return

    // Deduplicate paths
    const uniquePaths = Array.from(new Set(paths))

    await Promise.all(uniquePaths.map(path => {
      if (path && !path.startsWith('blob:') && !path.startsWith('data:') && !(path in globalImageCache)) {
        return loadImageUrl(path)
      }
      return Promise.resolve()
    }))
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
        console.error('[useAssetImage] Failed to revoke Blob URL:', url, error)
      }
    })
    globalCreatedBlobUrls.clear()

    // Clear cache object
    Object.keys(globalImageCache).forEach(key => {
      delete globalImageCache[key]
    })
    globalCacheVersion.value++
  }

  /**
   * Revoke single Blob URL
   * @param path Path
   */
  function revokeBlobUrl(path: string) {
    const url = globalImageCache[path]
    if (url?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url)
        globalCreatedBlobUrls.delete(url)
        delete globalImageCache[path]
        globalCacheVersion.value++
      } catch (error) {
        console.error('[useAssetImage] Failed to revoke Blob URL:', path, error)
      }
    }
  }

  /**
   * Check if string is a path (not Blob URL or data URL)
   */
  function isPath(url: string | null | undefined): boolean {
    if (!url) return false
    return !url.startsWith('blob:') && !url.startsWith('data:')
  }

  /**
   * Check if asset is ready (loaded and not placeholder)
   */
  function isImageReady(path: string): boolean {
    if (!path) return true // Empty path is considered ready (no load needed)
    const url = globalImageCache[path]
    // Check if in cache and not placeholder
    return !!url && !url.startsWith('data:image/png;base64')
  }

  return {
    getImageUrl,
    loadImageUrl,
    preloadImages,
    clearCache,
    revokeBlobUrl,
    isPath,
    isImageReady,
    imageCache: computed(() => globalImageCache)
  }
}

