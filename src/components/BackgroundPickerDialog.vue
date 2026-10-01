<template>
  <AssetBrowser
    title="Select Background"
    :assets="backgroundStore.backgrounds"
    :all-tags="backgroundStore.allTags"
    :type-filter-options="typeFilterOptions"
    empty-text="No background assets yet. Please add backgrounds in Asset Manager first"
    :load-image="loadImage"
    :load-all-frames="loadAllFrames"
    @select="handleSelect"
    @close="$emit('close')"
  />
</template>

<script setup lang="ts">
import { useAssetImage } from '@/composables/useAssetImage'
import { useBackgroundStore } from '@/stores/backgroundStore'
import type { Background } from '@/types/project'

import AssetBrowser from './AssetBrowser.vue'

const emit = defineEmits<{
  select: [background: Background]
  close: []
}>()

const backgroundStore = useBackgroundStore()
const { getImageUrl, loadImageUrl } = useAssetImage()

const typeFilterOptions = [
  { label: 'All', value: 'all' },
  { label: 'Static', value: 'static' },
  { label: 'Animated', value: 'animation' }
]

function handleSelect(asset: { id: string; [key: string]: unknown }) {
  // Get full Background object from store
  const background = backgroundStore.getBackground(asset.id)
  if (background) {
    emit('select', background)
  }
}

// Load background image
async function loadImage(id: string): Promise<string> {
  const bg = backgroundStore.getBackground(id)
  if (!bg) return ''

  // 1. Static background
  if (bg.type === 'static') {
    if (bg._runtimeUrl) {
      return bg._runtimeUrl
    }
    if (bg.url) {
      await loadImageUrl(bg.url)
      return getImageUrl(bg.url)
    }
    return ''
  }
  
  // 2. Dynamic background: use still frame config
  // 2.1 Custom still frame
  if (bg.stillFrameSource === 'custom') {
    if (bg._runtimeStillUrl) {
      return bg._runtimeStillUrl
    }
    if (bg.stillFrameCustomUrl) {
      await loadImageUrl(bg.stillFrameCustomUrl)
      return getImageUrl(bg.stillFrameCustomUrl)
    }
  }

  // 2.2 Use specified frame index (default first frame)
  const frameIndex = bg.stillFrameIndex ?? 0
  const frame = bg.frames?.[frameIndex]
  if (frame) {
    if (frame._runtimeUrl) {
      return frame._runtimeUrl
    }
    if (frame.url) {
      await loadImageUrl(frame.url)
      return getImageUrl(frame.url)
    }
  }

  return ''
}

// Load all frame URLs - for hover animation preview
async function loadAllFrames(id: string): Promise<string[]> {
  const bg = backgroundStore.getBackground(id)
  if (bg?.type !== 'animation' || !bg?.frames?.length) {
    return []
  }

  const urls: string[] = []
  for (const frame of bg.frames) {
    if (frame._runtimeUrl) {
      urls.push(frame._runtimeUrl)
    } else if (frame.url) {
      await loadImageUrl(frame.url)
      const url = getImageUrl(frame.url)
      if (url) {
        urls.push(url)
      }
    }
  }
  return urls
}
</script>

