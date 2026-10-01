<template>
  <div 
    class="asset-item"
    :class="{ selected: isSelected }"
    @click="$emit('select', asset)"
    @dblclick="$emit('confirm', asset)"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <div class="asset-preview">
      <!-- Image/Video preview -->
      <template v-if="!showPlayButton">
        <img 
          v-if="displaySrc" 
          :src="displaySrc" 
          :alt="asset.name" 
          loading="lazy"
        >
        <div
          v-else
          class="placeholder"
        >
          {{ getPlaceholderIcon(asset.type) }}
        </div>
        <div
          v-if="asset.type === 'animation'"
          class="type-badge"
          :class="{ 'type-badge-playing': isAnimating }"
        >
          {{ isAnimating ? '▶ GIF' : 'GIF' }}
        </div>
      </template>
      
      <!-- Audio preview -->
      <template v-else>
        <div class="audio-icon">
          {{ asset.type === 'bgm' ? '🎵' : '🔊' }}
        </div>
        <!-- Add duration display -->
        <div
          v-if="asset.duration"
          class="duration-badge"
        >
          {{ formatDuration(asset.duration) }}
        </div>
        <button 
          class="play-btn"
          @click.stop="$emit('togglePlay', asset)"
        >
          {{ isPlaying ? '⏸' : '▶' }}
        </button>
      </template>
    </div>
    <p
      class="asset-name"
      :title="asset.name"
    >
      {{ asset.name }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { getTypeIcon } from '@/core/sceneObjectProviders/metadata'

interface Asset {
  id: string
  name?: string
  type: string
  duration?: number
  fps?: number
  [key: string]: unknown
}

const props = defineProps<{
  asset: Asset
  isSelected: boolean
  isPlaying: boolean
  showPlayButton?: boolean
  loadImage?: (id: string) => Promise<string>
  loadAllFrames?: (id: string) => Promise<string[]>
  revokeOnUnmount?: boolean
}>()

defineEmits<{
  select: [asset: Asset]
  confirm: [asset: Asset]
  togglePlay: [asset: Asset]
}>()

const imageUrl = ref('')

// --- Hover Frame Animation State ---
const allFrameUrls = ref<string[]>([])
const animFrameIndex = ref(0)
const animTimer = ref<number | null>(null)
const isHovering = ref(false)
const framesLoaded = ref(false)
const framesLoading = ref(false)

/** Whether playing frame animation */
const isAnimating = computed(() => isHovering.value && allFrameUrls.value.length > 0)

/** Displayed image src: frame sequence on hover, static frame otherwise */
const displaySrc = computed(() => {
  if (isAnimating.value) {
    return allFrameUrls.value[animFrameIndex.value] ?? imageUrl.value
  }
  return imageUrl.value
})

function formatDuration(seconds: number): string {
  if (!seconds && seconds !== 0) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

async function load() {
  if (!props.loadImage) return
  
  // Audio type skips image loading
  if (props.asset.type === 'bgm' || props.asset.type === 'sfx') return

  try {
    const url = await props.loadImage(props.asset.id)
    if (url) {
      imageUrl.value = url
    }
  } catch (e) {
    console.error(`Failed to load image for asset ${props.asset.id}`, e)
  }
}

// P1: Delegate to metadata registry, keep bgm/sfx special icons
function getPlaceholderIcon(type: string) {
  // bgm/sfx are Asset types (not SceneObjectType), require special handling
  if (type === 'bgm') return '🎵'
  if (type === 'sfx') return '🔊'
  return getTypeIcon(type)
}

// --- Hover Animation Logic ---

function handleMouseEnter() {
  // Enable frame animation only for dynamic assets
  if (props.asset.type !== 'animation' || !props.loadAllFrames) return
  
  isHovering.value = true

  if (framesLoaded.value) {
    // Frame data already loaded, start playback directly
    startAnimation()
  } else if (!framesLoading.value) {
    // First hover, lazily load all frames
    framesLoading.value = true
    props.loadAllFrames(props.asset.id)
      .then(urls => {
        allFrameUrls.value = urls
        framesLoaded.value = true
        // If still hovered after load, start playback
        if (isHovering.value && urls.length > 0) {
          startAnimation()
        }
      })
      .catch(err => {
        console.error(`Failed to load animation frames for asset ${props.asset.id}`, err)
      })
      .finally(() => {
        framesLoading.value = false
      })
  }
}

function handleMouseLeave() {
  isHovering.value = false
  stopAnimation()
}

function startAnimation() {
  stopAnimation() // Guard: clear potential lingering timer
  animFrameIndex.value = 0
  const fps = props.asset.fps ?? 12
  const interval = 1000 / fps
  animTimer.value = window.setInterval(() => {
    if (allFrameUrls.value.length === 0) return
    animFrameIndex.value = (animFrameIndex.value + 1) % allFrameUrls.value.length
  }, interval)
}

function stopAnimation() {
  if (animTimer.value !== null) {
    clearInterval(animTimer.value)
    animTimer.value = null
  }
  animFrameIndex.value = 0
}

onMounted(() => {
  void load()
})

onUnmounted(() => {
  stopAnimation()
  if (props.revokeOnUnmount && imageUrl.value?.startsWith('blob:')) {
    URL.revokeObjectURL(imageUrl.value)
  }
})
</script>

<style scoped>
.asset-item {
  cursor: pointer;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s;
  border: 2px solid transparent;
  height: 100%; /* Ensure filling container */
  display: flex;
  flex-direction: column;
}

.asset-item.selected {
  background-color: #eff6ff;
}

.asset-item.selected .asset-preview {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.asset-item:hover {
  transform: translateY(-2px);
}

.asset-preview {
  aspect-ratio: 1;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.2s;
  position: relative;
  width: 100%;
}

.asset-item:hover .asset-preview {
  border-color: #93c5fd;
}

.asset-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain; /* Use contain to avoid cropping */
}

.placeholder {
  font-size: 48px;
}

.type-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
  transition: background 0.2s;
}

.type-badge-playing {
  background: rgba(34, 197, 94, 0.85);
}

.audio-icon {
  font-size: 48px;
  color: #6b7280;
}

.play-btn {
  position: absolute;
  bottom: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: white;
  border: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.2s;
  color: #374151;
}

.play-btn:hover {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.asset-name {
  margin: 8px 0 0;
  font-size: 13px;
  color: #374151;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 4px;
}

.duration-badge {
  position: absolute;
  bottom: 6px;
  left: 6px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
  font-family: monospace;
}
</style>
