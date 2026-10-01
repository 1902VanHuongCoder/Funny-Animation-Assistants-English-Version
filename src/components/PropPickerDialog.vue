<template>
  <AssetBrowser
    title="Select Prop"
    :assets="propStore.props"
    :all-tags="propStore.allTags"
    :type-filter-options="typeFilterOptions"
    empty-text="No prop assets yet. Please add props in Asset Manager first"
    :load-image="loadImage"
    :load-all-frames="loadAllFrames"
    @select="handleSelect"
    @close="$emit('close')"
  />
</template>

<script setup lang="ts">
import { useAssetImage } from '@/composables/useAssetImage'
import { usePropStore } from '@/stores/propStore'
import type { PropAsset } from '@/types/project'

import AssetBrowser from './AssetBrowser.vue'

const emit = defineEmits<{
  select: [prop: PropAsset]
  close: []
}>()

const propStore = usePropStore()
const { getImageUrl, loadImageUrl } = useAssetImage()

const typeFilterOptions = [
  { label: 'All', value: 'all' },
  { label: 'Static', value: 'static' },
  { label: 'Animated', value: 'animation' }
]

function handleSelect(asset: { id: string; [key: string]: unknown }) {
  // Get full Prop object from store
  const prop = propStore.getProp(asset.id)
  if (prop) {
    emit('select', prop)
  }
}

// Load image - returns Promise<string> for AssetBrowser compatibility
async function loadImage(id: string): Promise<string> {
  const prop = propStore.getProp(id)
  if (!prop) return ''
  
  // 1. Static prop
  if (prop.type === 'static') {
    const propWithRuntime = prop as typeof prop & { _runtimeUrl?: string }
    if (propWithRuntime._runtimeUrl) {
      return propWithRuntime._runtimeUrl
    }
    if (prop.url) {
      await loadImageUrl(prop.url)
      return getImageUrl(prop.url)
    }
    return ''
  }

  // 2. Dynamic prop: use still frame config
  // 2.1 Custom still frame
  if (prop.stillFrameSource === 'custom') {
    const propWithRuntime = prop as typeof prop & { _runtimeStillUrl?: string }
    if (propWithRuntime._runtimeStillUrl) {
      return propWithRuntime._runtimeStillUrl
    }
    if (prop.stillFrameCustomUrl) {
      await loadImageUrl(prop.stillFrameCustomUrl)
      return getImageUrl(prop.stillFrameCustomUrl)
    }
  }

  // 2.2 Use specified frame index (default first frame)
  const frameIndex = prop.stillFrameIndex ?? 0
  const frame = prop.frames?.[frameIndex]
  if (frame) {
    const frameWithRuntime = frame as typeof frame & { _runtimeUrl?: string }
    if (frameWithRuntime._runtimeUrl) {
      return frameWithRuntime._runtimeUrl
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
  const prop = propStore.getProp(id)
  if (prop?.type !== 'animation' || !prop?.frames?.length) {
    return []
  }

  const urls: string[] = []
  for (const frame of prop.frames) {
    const frameWithRuntime = frame as typeof frame & { _runtimeUrl?: string }
    if (frameWithRuntime._runtimeUrl) {
      urls.push(frameWithRuntime._runtimeUrl)
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

