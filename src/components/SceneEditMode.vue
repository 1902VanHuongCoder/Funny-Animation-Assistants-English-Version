<!--
  SceneEditMode.vue - Route dispatcher component
  
  Responsibility: Dispatch to corresponding editor component based on mode parameter
  - mode='setup' -> SetupEditor.vue (Scene initial state editing)
  - mode='action' -> ActionEditor.vue (Directing mode / action editing)
  
  Architecture notes:
  Split former 2000+ line hybrid component into two independent editor components:
  1. SetupEditor.vue - Handles scene initial state only, no timeline, ghosting, or ActionEvaluator
  2. ActionEditor.vue - Handles action editing, including Timeline, Ghosting, Playback, etc.
  
  Advantages:
  - Reduced cognitive overhead: Writing Setup logic does not affect Action Mode
  - Leaner code: Each component loads only what it needs
  - Clear state management: Setup modifies Scene Object, Action modifies Script Block
-->
<template>
  <SetupEditor 
    v-if="mode === 'setup' && sceneId" 
    :episode="episode"
    :scene-id="sceneId"
    @exit-scene-edit="handleExitSceneEdit"
    @save-setup="handleSaveSetup"
  />
  <ActionEditor 
    v-else-if="mode === 'action' && sceneId && blockId" 
    :key="`action-${sceneId}-${blockId}`"
    :episode="episode"
    :scene-id="sceneId"
    :block-id="blockId"
    @exit-scene-edit="handleExitSceneEdit"
  />
  <div
    v-else
    class="loading-placeholder"
  >
    <span>Loading...</span>
  </div>
</template>

<script setup lang="ts">
import type { Episode } from '@/stores/episodeStore'
import type { SceneSetup } from '@/types/screenplay'

import ActionEditor from './ActionEditor.vue'
import SetupEditor from './SetupEditor.vue'

defineProps<{
  episode: Episode | undefined
  editLine?: number
  mode?: 'setup' | 'action'
  sceneId?: string | null
  blockId?: string | null
}>()

const emit = defineEmits<{
  exitSceneEdit: []
  saveSetup: [sceneId: string, setup: SceneSetup]
}>()

/**
 * Handle exit scene editing
 */
function handleExitSceneEdit() {
  emit('exitSceneEdit')
}

/**
 * Handle save Setup (forward event)
 */
function handleSaveSetup(sceneId: string, setup: SceneSetup) {
  emit('saveSetup', sceneId, setup)
}
</script>

<style scoped>
.loading-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: #1a1a1a;
  color: #888;
  font-size: 14px;
}
</style>
