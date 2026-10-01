<template>
  <AssetBrowser
    title="Select Audio"
    :assets="soundStore.sounds"
    :all-tags="soundStore.allTags"
    :type-filter-options="typeFilterOptions"
    empty-text="No audio assets yet. Please add audio in Asset Manager first"
    show-play-button
    show-duration-sort
    @select="handleSelect"
    @close="$emit('close')"
  />
</template>

<script setup lang="ts">
import { useSoundStore } from '@/stores/soundStore'
import type { SoundAsset } from '@/types/project'

import AssetBrowser from './AssetBrowser.vue'

const emit = defineEmits<{
  select: [sound: SoundAsset]
  close: []
}>()

const soundStore = useSoundStore()

const typeFilterOptions = [
  { label: 'All', value: 'all' },
  { label: 'Music', value: 'bgm' },
  { label: 'Sound Effect', value: 'sfx' }
]

function handleSelect(asset: { id: string; url?: string; [key: string]: unknown }) {
  emit('select', asset as SoundAsset)
}
</script>
