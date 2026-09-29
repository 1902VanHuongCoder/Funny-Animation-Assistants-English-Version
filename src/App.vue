<template>
  <div class="app">
    <TopMenuBar />
    <main class="main">
      <router-view />
    </main>
    <GlobalToast />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount,onMounted } from 'vue'
import { useRoute,useRouter } from 'vue-router'

import GlobalToast from './components/GlobalToast.vue'
import TopMenuBar from './components/TopMenuBar.vue'
import { useAutoSave } from './composables/useAutoSave'
import { useProjectStore } from './stores/projectStore'

const projectStore = useProjectStore()
const router = useRouter()
const route = useRoute()

// Enable autosave at a 30-second interval.
useAutoSave(30000)

const autoSavePromptRoutes = new Set(['ProjectHome', 'EpisodeEdit', 'ScreenplayEditor'])

// Check for recoverable autosave data on startup.
onMounted(async () => {
  await router.isReady()
  if (!autoSavePromptRoutes.has(String(route.name ?? ''))) return

  const hasAutoSaveData = projectStore.hasAutoSave()
  if (hasAutoSaveData) {
    const saveTime = projectStore.getAutoSaveTime()
    const timeStr = saveTime ? saveTime.toLocaleString() : 'an unknown time'
    
    if (confirm(`Autosaved project data found (${timeStr}). Restore it?`)) {
      const success = projectStore.restoreFromAutoSave()
      if (!success) {
        alert('Failed to restore the autosaved project.')
      }
    }
  }
})

// Warn before leaving with unsaved changes.
onMounted(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (projectStore.hasUnsavedChanges && projectStore.isProjectOpen) {
      // Use the browser's standard before-unload prompt.
      e.preventDefault()
      e.returnValue = 'The current project has unsaved changes. Are you sure you want to leave?'
    }
  }

  window.addEventListener('beforeunload', handleBeforeUnload)

  // Clean up the event listener.
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', handleBeforeUnload)
  })
})

</script>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.main {
  flex: 1;
  background: #f9fafb;
  overflow: auto;
}
</style>
