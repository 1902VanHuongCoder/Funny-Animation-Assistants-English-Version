<template>
  <Teleport :to="teleportTarget">
    <div
      v-if="visible"
      class="preview-overlay"
      @click.self="handleClose"
    >
      <div class="preview-dialog">
        <!-- Title bar -->
        <div class="preview-header">
          <div class="header-left">
            <span class="preview-icon">🎬</span>
            <span class="preview-title">Scene Preview</span>
            <span class="scene-info">{{ sceneTitle }}</span>
            <span
              v-if="(scenePlayerRef?.currentTime ?? 0) > 0"
              class="block-indicator"
            >
              {{ formatTime(currentTime) }} / {{ formatTime(totalDuration) }}
            </span>
          </div>
          <button
            class="close-btn"
            title="Close"
            @click="handleClose"
          >
            ✕
          </button>
        </div>
        
        <!-- Preview area -->
        <div class="preview-content">
          <!-- Loading -->
          <div
            v-if="isLoading"
            class="loading-overlay"
          >
            <div class="loading-spinner" />
            <span>{{ loadingMessage }}</span>
          </div>
          
          <!-- Error message -->
          <div
            v-else-if="errorMessage"
            class="error-overlay"
          >
            <span class="error-icon">⚠️</span>
            <span>{{ errorMessage }}</span>
            <button
              class="retry-btn"
              @click="initPreview"
            >
              Retry
            </button>
          </div>

          <!-- Player -->
          <ScenePlayer
            v-else
            ref="scenePlayerRef"
            :episode-id="episodeId"
            :scene-id="sceneId"
            :episode="episodeCopy!"
            :auto-play="false"
            @playback-finished="handlePlaybackFinished"
            @progress="handleProgress"
            @play-state-change="handlePlayStateChange"
            @error="handlePlayerError"
          />
        </div>

        <!-- Controls -->
        <div class="preview-controls">
          <button 
            class="control-btn play-btn" 
            :disabled="isLoading || !!errorMessage"
            @click="handlePlayPause"
          >
            <span class="btn-icon">{{ isPlaying ? '⏸' : '▶' }}</span>
            <span class="btn-text">{{ isPlaying ? 'Pause' : 'Play' }}</span>
          </button>
          
          <button 
            class="control-btn reset-btn" 
            :disabled="isLoading"
            @click="handleReset"
          >
            <span class="btn-icon">⏮</span>
            <span class="btn-text">Reset</span>
          </button>
          
          <div class="progress-section">
            <input 
              type="range" 
              class="progress-slider"
              :min="0"
              :max="totalDuration"
              :value="currentTime"
              disabled
            >
            <span class="time-display">
              {{ formatTime(currentTime) }} / {{ formatTime(totalDuration) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import * as PIXI from 'pixi.js'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'

import { useAssetAudio } from '@/composables/useAssetAudio'
import { useAssetImage } from '@/composables/useAssetImage'
import { useAssetLoader } from '@/composables/useAssetLoader'
import type { Episode } from '@/stores/episodeStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
// v7.3: effectStore removed
import { useSoundStore } from '@/stores/soundStore'
import type { SceneObject } from '@/types/sceneObject'
import { ensureSceneTTS as sharedEnsureSceneTTS } from '@/utils/ttsUtils'
import { audioKit } from '@/utils/WebAudioKit'

import ScenePlayer from './ScenePlayer.vue'

const props = defineProps<{
  visible: boolean
  episodeId: string
  sceneId: string
  episode: Episode
}>()

const emit = defineEmits<{
  close: []
}>()

const projectStore = useProjectStore()
const sceneObjectStore = useSceneObjectStore()

// Teleport target
const teleportTarget = shallowRef<HTMLElement | string>('body')

// State
const isLoading = ref(true)
const loadingMessage = ref('Preparing preview...')
const errorMessage = ref<string | null>(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const totalDuration = ref(0)

interface ScenePlayerInstance {
  play: () => Promise<void>
  pause: () => void
  reset: () => void
  seek: (time: number) => void
  currentTime: number
  totalDuration: number
  isPlaying: boolean
}

// References
const scenePlayerRef = ref<ScenePlayerInstance | null>(null)

// Asset management
const generatedBlobUrls = new Set<string>()
const loadedTextureUrls = new Set<string>() // Track loaded textures
const loadedAudioUrls = new Set<string>() // Track loaded audio

const { loadImageUrl, getImageUrl } = useAssetImage()
const { loadAudioUrl, getAudioUrl, revokeBlobUrl } = useAssetAudio()

// Stores
// v7.3: effectStore removed
const soundStore = useSoundStore()

// Compute current scene
const currentScene = computed(() => {
  if (!props.episode) return null
  return props.episode.scenes.find(s => s.id === props.sceneId) || null
})

const sceneTitle = computed(() => currentScene.value?.title || 'Unnamed Scene')

// Update teleport target
function updateTeleportTarget() {
  const fullscreenElement = document.fullscreenElement
  teleportTarget.value = fullscreenElement ? fullscreenElement as HTMLElement : 'body'
}

// Format time
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const milliseconds = Math.floor((ms % 1000) / 10)
  return `${seconds.toString().padStart(2, '0')}:${milliseconds.toString().padStart(2, '0')}`
}

// Initialize preview
async function initPreview() {
  isLoading.value = true
  errorMessage.value = null
  generatedBlobUrls.clear() // Clear old ones if any
  
  try {
    loadingMessage.value = 'Initializing...'
    
    // Initialize AudioContext
    await audioKit.init()
    
    // 1. Ensure TTS
    await doEnsureSceneTTS()
    if (errorMessage.value) return
    
    // 2. Preload image assets (Texture)
    await preloadSceneImages()
    
    // 3. Preload audio assets
    await preloadSceneAudio()
    
    loadingMessage.value = 'Ready'
    
    // Wait one frame to ensure ScenePlayer mounts
    await nextTick()
  } catch (e) {
    console.error('Init preview failed', e)
    errorMessage.value = `Initialization failed: ${e instanceof Error ? e.message : 'Unknown error'}`
  } finally {
    isLoading.value = false
  }
}

/**
 * Use shared module to ensure scene TTS, then preload audio Blob URL
 */
async function doEnsureSceneTTS() {
  const scene = currentSceneCopy.value
  const originalScene = currentScene.value
  if (!scene || !originalScene) return

  loadingMessage.value = 'Checking voice assets...'

  try {
    await sharedEnsureSceneTTS(originalScene, scene, {
      sceneObjects: originalScene.setup.objects,
      actors: projectStore.actors,
      narrator: projectStore.narrator,
      episodeId: props.episodeId,
      onProgress: (msg) => { loadingMessage.value = msg }
    })
  } catch (e) {
    console.error('TTS error', e)
    const error = e as Error & { errorCode?: string }
    if (error.errorCode === 'TTS_PROVIDER_NOT_CONFIGURED') {
      errorMessage.value = 'Local TTS Provider is not configured. Please import local audio for lines, or configure a local TTS Provider.'
      return
    }
    throw e
  }

  // Preload audio Blob URL (bound to player lifecycle, kept inside component)
  for (const block of scene.script) {
    if (block.type !== 'dialogue' && block.type !== 'narration') continue
    const finalConfig = block.ttsConfig
    if (!finalConfig?.audioPath) continue

    try {
      const audioPath = finalConfig.audioPath
      if (audioPath.startsWith('blob:')) {
        await audioKit.load(audioPath)
        loadedAudioUrls.add(audioPath)
      } else {
        await loadAudioUrl(audioPath)
        let blobUrl = getAudioUrl(audioPath)

        // v12.9: Verify if blob URL is still valid
        if (blobUrl?.startsWith('blob:')) {
          try {
            const resp = await fetch(blobUrl)
            if (!resp.ok) throw new Error('Blob URL not accessible')
          } catch {
            console.warn('[ScenePreview] Cached Blob URL expired, reloading:', audioPath)
            revokeBlobUrl(audioPath)
            await loadAudioUrl(audioPath)
            blobUrl = getAudioUrl(audioPath)
          }
        }

        if (blobUrl) {
          await audioKit.load(blobUrl)
          loadedAudioUrls.add(blobUrl)
        }
      }
    } catch (e) {
      console.error('Audio loading error', e)
      finalConfig.audioPath = ''
    }
  }
}

async function preloadSceneImages() {
  const scene = currentSceneCopy.value
  if (!scene) return
  
  loadingMessage.value = 'Loading image assets...'
  
  // Use useAssetLoader to collect assets (including expressions and partAssetOverrides)
  const { collectAssets, loadAssets } = useAssetLoader()
  
  // Fix: Scan both Setup and all Block Actions dynamic assets
  // Ensures dynamically switched expressions in set_character are preloaded
  const allImageUrls = new Set<string>()
  
  // Step 1: Collect Setup static assets
  const { imageUrls: setupImageUrls } = collectAssets(scene.setup, null)
  setupImageUrls.forEach(url => allImageUrls.add(url))
  
  // Step 2: Collect dynamic assets from all Block Actions
  for (const block of scene.script) {
    const { imageUrls: blockImageUrls } = collectAssets(scene.setup, block)
    blockImageUrls.forEach(url => allImageUrls.add(url))
  }
  
  // console.log(`[ScenePreviewDialog] preloadSceneImages: collected ${allImageUrls.size} image URLs (setup: ${setupImageUrls.size}, with blocks: ${allImageUrls.size})`)
  
  // Load assets using useAssetLoader
  await loadAssets(allImageUrls, new Set())
  
  // Record loaded URLs (for cleanup)
  // Note: useAssetLoader uses textureCache internally; track blobUrl for PIXI.Assets cleanup
  for (const url of allImageUrls) {
    try {
      // Ensure assets loaded to useAssetImage blob store as well
      await loadImageUrl(url)
      const blobUrl = getImageUrl(url)
      if (blobUrl) {
        loadedTextureUrls.add(blobUrl)
      }
    } catch (e) {
      // Handled by loadAssets, tracking only here
    }
  }
}


async function preloadSceneAudio() {
  const scene = currentSceneCopy.value
  if (!scene) return

  loadingMessage.value = 'Loading audio assets...'
  const audioPaths = new Set<string>()
  
  // Collect SFX / BGM
  for (const obj of scene.setup.objects) {
      if (obj.type === 'audio') {
          const sound = soundStore.getSound(obj.refId)
          if (sound?.url) audioPaths.add(sound.url)
      }
  }
  
  const paths = Array.from(audioPaths)
  if (paths.length > 0) {
      await Promise.all(paths.map(async (path) => {
          try {
              await loadAudioUrl(path)
              const blobUrl = getAudioUrl(path)
              if (blobUrl) {
                  await audioKit.load(blobUrl)
                  loadedAudioUrls.add(blobUrl)
              }
          } catch (e) {
              console.warn('Failed to preload audio:', path)
          }
      }))
  }
}

// Event handling
function handlePlayPause() {
  if (isPlaying.value) {
    scenePlayerRef.value?.pause()
  } else {
    void scenePlayerRef.value?.play()
  }
}

function handleReset() {
  scenePlayerRef.value?.reset()
}

// Seek removed, progress bar displays current progress only



function handlePlaybackFinished() {
  isPlaying.value = false
}

function handleProgress(current: number, total: number) {
  currentTime.value = current
  totalDuration.value = total
}

function handlePlayStateChange(playing: boolean) {
  isPlaying.value = playing
}

function handlePlayerError(msg: string) {
  errorMessage.value = msg
}

function handleClose() {
  scenePlayerRef.value?.pause()
  
  // Release preloaded texture assets
  for (const url of loadedTextureUrls) {
      if (PIXI.Assets.cache.has(url)) {
          void PIXI.Assets.unload(url)
      }
  }
  loadedTextureUrls.clear()

  // Release preloaded audio assets (remove from audioKit cache, do not revoke blob URL)
  for (const url of loadedAudioUrls) {
      audioKit.unload(url)
  }
  loadedAudioUrls.clear()

  // v12.9: Do not revoke generatedBlobUrls, they may belong to useAssetAudio global cache
  // otherwise cached blob URLs invalidate, causing fetch failure (ERR_FILE_NOT_FOUND) on reopen
  generatedBlobUrls.clear()
  
  // Restore Base64 in Store (if modified to Blob URL)
  // We modified episode.scenes directly, which are the same state objects in Store
  // We might pollute Store.
  // This is a risk point.
  // Better practice: pass a Map to ScenePlayer without modifying originals?
  // Or restore Base64 backup on close?
  // Did we lose Base64 during 'Base64 -> Blob URL'?
  // No, read Base64 from Store and assigned converted value to .audio.
  // If not restored, will Store save Blob URLs?
  // Yes, if user saves project during preview. This is an issue.
  
  // Fix plan:
  // Do not modify block.ttsConfig.audio in ensureSceneTTS.
  // But ScenePlayer is designed to read from block.ttsConfig.audio.
  // ScenePlayer should support external Map or deep copied Scene data.
  
  // ScenePlayer only recognizes URLs after refactoring.
  // Simplest solution: deep copy currentScene for ScenePlayer.
  // But ScenePlayer receives episodeId/sceneId and fetches from Store...
  // leading ScenePlayer to always get raw data from Store.
  
  // Looking back at ScenePlayer.vue:
  // const currentScene = computed(() => props.episode.scenes.find...)
  // It uses props.episode.
  
  // So passing a deep copied Episode to ScenePlayer
  // allows modifying copy safely without affecting Store.
  
  emit('close')
}

// Fix: Pass copy to ScenePlayer
const episodeCopy = ref<Episode | null>(null)
// Backup SceneObjectStore data
const backupSceneObjects = ref<SceneObject[]>([])

// Override currentScene computed property using episodeCopy
const currentSceneCopy = computed(() => {
  if (!episodeCopy.value) return null
  return episodeCopy.value.scenes.find(s => s.id === props.sceneId) || null
})

watch(() => props.visible, async (val) => {
  if (val) {
    updateTeleportTarget()
    // Deep copy Episode to avoid polluting Store
    episodeCopy.value = JSON.parse(JSON.stringify(props.episode)) as Episode
    
    // Sync Scene Objects to Store so getVoiceId can find instances
    // Note: use original currentScene (from props) to get object data
    // Backup existing data
    backupSceneObjects.value = [...sceneObjectStore.setupState.objects]

    if (currentScene.value?.setup?.objects) {
       // Dual-layer: use initFromSetup instead of direct assignment (objects is read-only computed)
       sceneObjectStore.initFromSetup(currentScene.value.setup.objects)
    } else {
       sceneObjectStore.clearObjects()
    }

    await initPreview()
  } else {
    episodeCopy.value = null
    
    // Restore Scene Objects
    // Restore only when backup exists, avoiding data loss from multiple restores
    if (backupSceneObjects.value.length > 0 || sceneObjectStore.objects.length === 0) {
        // Dual-layer: use initFromSetup instead of direct assignment
        sceneObjectStore.initFromSetup(backupSceneObjects.value)
        backupSceneObjects.value = []
    }
  }
}, { immediate: true })

</script>

<style scoped>
.preview-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2147483647;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.preview-dialog {
  background: #1f2937;
  border-radius: 8px;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  width: 98vw;
  height: 96vh;
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid #374151;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.preview-icon {
  font-size: 16px;
}

.preview-title {
  font-size: 14px;
  font-weight: 600;
  color: #f3f4f6;
}

.scene-info {
  font-size: 12px;
  color: #9ca3af;
  background: #374151;
  padding: 2px 8px;
  border-radius: 4px;
}

.block-indicator {
  font-size: 12px;
  color: #60a5fa;
  background: #1e3a5f;
  padding: 2px 8px;
  border-radius: 4px;
}

.close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #9ca3af;
  font-size: 16px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.close-btn:hover {
  background: #374151;
  color: #f3f4f6;
}

.preview-content {
  position: relative;
  background: #111827;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  overflow: hidden;
}

.loading-overlay,
.error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(17, 24, 39, 0.9);
  color: #9ca3af;
  font-size: 14px;
  z-index: 10;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #374151;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-icon {
  font-size: 32px;
}

.retry-btn {
  margin-top: 10px;
  padding: 6px 12px;
  background: #374151;
  color: #f3f4f6;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.preview-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-top: 1px solid #374151;
  background: #1f2937;
  border-radius: 0 0 8px 8px;
  flex-shrink: 0;
}

.control-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.control-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.play-btn {
  background: #3b82f6;
  color: white;
}

.play-btn:hover:not(:disabled) {
  background: #2563eb;
}

.reset-btn {
  background: #374151;
  color: #f3f4f6;
}

.reset-btn:hover:not(:disabled) {
  background: #4b5563;
}

.btn-icon {
  font-size: 12px;
}

.progress-section {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-slider {
  flex: 1;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: #374151;
  border-radius: 3px;
  cursor: pointer;
}

.progress-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: #3b82f6;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.15s;
}

.progress-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.progress-slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.time-display {
  font-size: 12px;
  color: #9ca3af;
  font-family: monospace;
  min-width: 90px;
  text-align: right;
}
</style>
