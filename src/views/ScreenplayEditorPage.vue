<template>
  <div class="screenplay-editor-page">
    <!-- Screenplay stream (built-in toolbar) -->
    <ScreenplayStream
      ref="screenplayStreamRef"
      :episode-name="episodeName"
      @back="handleBack"
      @update:episode-name="handleUpdateEpisodeName"
      @edit-narrator="handleEditNarrator"
      @manage-actors="handleManageActors"
      @manage-bgm="handleManageBGM"
      @save="handleSave"
      @preview="handlePreview"
      @export="handleExport"
      @select-actor="handleSelectActor"
      @select-state="handleSelectState"
      @select-expression="handleSelectExpression"
      @edit-setup="handleEditSetup"
      @enter-setup-mode="handleEnterSetupMode"
      @enter-action-mode="handleEnterActionMode"
      @preview-scene="handlePreviewScene"
    />
    
    <!-- v6.10: Scene editor Overlay layer -->
    <Transition name="scene-editor-overlay">
      <div
        v-if="sceneEditorState.visible"
        class="scene-editor-overlay"
      >
        <SceneEditMode
          :episode="currentEpisode"
          :mode="sceneEditorState.mode"
          :scene-id="sceneEditorState.sceneId"
          :block-id="sceneEditorState.blockId"
          @exit-scene-edit="handleExitSceneEdit"
          @save-setup="handleSaveSetup"
        />
      </div>
    </Transition>
    
    <!-- Narration config dialog -->
    <NarratorConfigDialog
      v-if="narratorConfigVisible"
      :narrator="projectStore.narrator"
      @close="narratorConfigVisible = false"
      @save="handleSaveNarrator"
    />
    
    <!-- Actor management dialog -->
    <ActorManagementDialog
      v-if="actorManagementVisible"
      :actors="projectStore.actors"
      @close="actorManagementVisible = false"
      @add-actor="handleAddActorFromManagement"
      @update-actor="handleUpdateActorFromManagement"
      @delete-actor="handleDeleteActorFromManagement"
    />
    
    <!-- BGM management dialog -->
    <div
      v-if="soundManagerVisible"
      class="modal-overlay"
      @click.self="soundManagerVisible = false"
    >
      <div class="sound-manager-modal">
        <div class="modal-header">
          <h3 class="modal-title">
            Background Music Management
          </h3>
          <button
            class="btn-close"
            @click="soundManagerVisible = false"
          >
            ✕
          </button>
        </div>
        <div class="modal-body">
          <SoundManager initial-type="bgm" />
        </div>
      </div>
    </div>

    <!-- Screenplay soundtrack management dialog (v7.5) -->
    <BGMManagerDialog
      v-if="bgmManagerVisible"
      :episode-id="episodeId"
      @close="bgmManagerVisible = false"
    />

    <!-- v7.0: Instance selector dialog (select character instance in scene) -->
    <InstanceSelectorDialog
      v-if="instanceSelectorState.visible"
      :scene-objects="instanceSelectorState.sceneObjects"
      v-bind="instanceSelectorState.currentInstanceId ? { 'current-instance-id': instanceSelectorState.currentInstanceId } : {}"
      @close="instanceSelectorState.visible = false"
      @select="handleInstanceSelect"
    />
    

    
    <!-- Expression selector dialog -->
    <ExpressionSelectorDialog
      v-if="expressionSelectorState.visible"
      v-bind="expressionSelectorState.currentExpression ? { 'current-expression': expressionSelectorState.currentExpression } : {}"
      @close="expressionSelectorState.visible = false"
      @select="handleExpressionSelect"
    />
    
    <!-- Scene preview dialog -->
    <ScenePreviewDialog
      v-if="scenePreviewState.visible && currentEpisode"
      :visible="scenePreviewState.visible"
      :episode-id="episodeId"
      :scene-id="scenePreviewState.sceneId"
      :episode="currentEpisode"
      @close="scenePreviewState.visible = false"
    />
    
    <!-- Script preview dialog -->
    <ScriptPreviewDialog
      v-if="scriptPreviewState.visible && currentEpisode"
      :visible="scriptPreviewState.visible"
      :episode-id="episodeId"
      :episode="currentEpisode"
      @close="scriptPreviewState.visible = false"
    />
    

    
    <!-- Export confirm dialog -->
    <ExportConfirmDialog
      v-if="showConfirmDialog"
      :episode-id="episodeId"
      :settings="exportSettings"
      @confirm="confirmExport"
      @cancel="cancelExport"
    />
    
    <!-- Export progress dialog -->
    <ExportProgressDialog
      v-if="showProgressDialog"
      :status="exportState.status"
      :progress="exportState.progress"
      v-bind="exportState.error ? { error: exportState.error } : {}"
      @cancel="cancelExport"
      @close="showProgressDialog = false"
    />
    
    <!-- Export result dialog -->
    <ExportResultDialog
      v-if="showResultDialog && exportResult"
      :result="exportResult"
      @close="closeResultDialog"
      @export-again="exportAgain"
      @retry="retryExport"
    />

    <!-- Return confirm dialog -->
    <ConfirmDialog
      v-if="showBackConfirm"
      title="Unsaved Changes"
      message="There are unsaved changes. Are you sure you want to go back?"
      confirm-text="Leave"
      :is-danger="true"
      @confirm="confirmBack"
      @cancel="showBackConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import { type ComponentPublicInstance, computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ExportConfirmDialog from '@/components/export/ExportConfirmDialog.vue'
import ExportProgressDialog from '@/components/export/ExportProgressDialog.vue'
import ExportResultDialog from '@/components/export/ExportResultDialog.vue'
import SceneEditMode from '@/components/SceneEditMode.vue'
import ActorManagementDialog from '@/components/screenplay/ActorManagementDialog.vue'
import BGMManagerDialog from '@/components/screenplay/BGMManagerDialog.vue'
import ExpressionSelectorDialog from '@/components/screenplay/ExpressionSelectorDialog.vue'
import InstanceSelectorDialog from '@/components/screenplay/InstanceSelectorDialog.vue'
import NarratorConfigDialog from '@/components/screenplay/NarratorConfigDialog.vue'
import ScenePreviewDialog from '@/components/screenplay/ScenePreviewDialog.vue'
import ScreenplayStream from '@/components/screenplay/ScreenplayStream.vue'
import ScriptPreviewDialog from '@/components/screenplay/ScriptPreviewDialog.vue'
import SoundManager from '@/components/SoundManager.vue'
import { useToast } from '@/composables/useToast'
import { useVideoExport } from '@/composables/useVideoExport'
import { useEpisodeStore } from '@/stores/episodeStore'
import { useProjectStore } from '@/stores/projectStore'
import type { ActorConfig, NarratorConfig, SceneObject, SceneSetup, ScriptBlock } from '@/types/screenplay'
import { applyBlockActionsToState, calculatePrevContext } from '@/utils/sceneStateCalculator'

const route = useRoute()
const router = useRouter()
const episodeStore = useEpisodeStore()
const projectStore = useProjectStore()
const screenplayStreamRef = ref<ComponentPublicInstance | null>(null)
const { success, error } = useToast()

// Video export
const { 
  exportState, 
  exportSettings, 
  exportResult,
  showConfirmDialog, 
  showProgressDialog,
  showResultDialog,
  startExport, 
  confirmExport, 
  cancelExport,
  closeResultDialog,
  exportAgain,
  retryExport
} = useVideoExport()

const episodeId = route.params['episodeId'] as string

// v6.0: Get current episode from episodeStore
const currentEpisode = computed(() => episodeStore.getEpisode(episodeId))
const episodeName = computed(() => currentEpisode.value?.name || '')
const scenes = computed(() => currentEpisode.value?.scenes || [])

// v7.0: Instance selector dialog state (replaces original actor selection)
const instanceSelectorState = ref<{
  visible: boolean
  sceneId: string | null
  blockId: string | null
  sceneObjects: SceneObject[]
  currentInstanceId?: string
}>({
  visible: false,
  sceneId: null,
  blockId: null,
  sceneObjects: []
})



// Actor management dialog state
const actorManagementVisible = ref(false)

// BGM management dialog state
const soundManagerVisible = ref(false)
const bgmManagerVisible = ref(false)

// BGM selector dialog state (v7.5)
// const bgmSelectorState = ref<{
//   visible: boolean
//   sceneId: string | null
//   currentBgmId?: string
// }>({
//   visible: false,
//   sceneId: null
// })

// Narration config dialog state
const narratorConfigVisible = ref(false)

// Expression selector dialog state
const expressionSelectorState = ref<{
  visible: boolean
  sceneId: string | null
  blockId: string | null
  currentExpression?: string
}>({
  visible: false,
  sceneId: null,
  blockId: null
})

// Scene preview dialog state
const scenePreviewState = ref<{
  visible: boolean
  sceneId: string
}>({
  visible: false,
  sceneId: ''
})

// Script preview dialog state
const scriptPreviewState = ref<{
  visible: boolean
}>({
  visible: false
})

// v6.10: Scene editor Overlay state
const sceneEditorState = ref<{
  visible: boolean
  mode: 'setup' | 'action'
  sceneId: string | null
  blockId: string | null
}>({
  visible: false,
  mode: 'setup',
  sceneId: null,
  blockId: null
})

// Auto save state
const lastSaveTime = ref<number>(0)
let autoSaveTimer: number | null = null

// Return confirmation dialog
const showBackConfirm = ref(false)

// Initialize screenplay
onMounted(() => {
  // v6.0: No longer need to initialize screenplay, directly use episode
  if (!currentEpisode.value) {
    void router.replace('/project')
    return
  }
  
  // Set current episode ID to Store for child components (such as BGMManagerDialog)
  episodeStore.setCurrentEpisode(episodeId)
  
  // Initialize lastSaveTime to current episode modifiedAt to avoid false positives for unsaved changes
  lastSaveTime.value = currentEpisode.value.modifiedAt || Date.now()
  
  // Start auto save
  startAutoSave()
  
  // Add keyboard shortcut listener
  document.addEventListener('keydown', handleGlobalKeyDown)
})

// Clean up when component unmounts
onBeforeUnmount(() => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
  }
  document.removeEventListener('keydown', handleGlobalKeyDown)
})

// Start auto save
function startAutoSave() {
  // v6.0: Watch episode modifiedAt changes
  watch(
    () => currentEpisode.value?.modifiedAt,
    (newTime) => {
      if (newTime && newTime > lastSaveTime.value) {
        // Clear previous timer
        if (autoSaveTimer) {
          clearTimeout(autoSaveTimer)
        }
        
        // Auto save after 3 seconds
        autoSaveTimer = window.setTimeout(() => {
          void autoSave()
        }, 3000)
      }
    }
  )
}

// Auto save
async function autoSave() {
  if (!currentEpisode.value) return
  if (!projectStore.isProjectOpen) {
    return
  }
  
  try {
    await projectStore.saveProject()
    lastSaveTime.value = Date.now()
  } catch (error) {
    console.error('[AutoSave] Failed:', error)
  }
}

// Global keyboard shortcut handling
function handleGlobalKeyDown(event: KeyboardEvent) {
  // Ctrl+S / Cmd+S: Save
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault()
    void handleSave()
  }
}

// Return to episode list
function handleBack() {
  // v6.0: Check episode modification time
  const lastModified = currentEpisode.value?.modifiedAt || 0
  const hasUnsavedChanges = lastModified > lastSaveTime.value
  
  if (hasUnsavedChanges) {
    showBackConfirm.value = true
    return
  }
  
  void router.push('/project')
}

// Confirm return (discard unsaved changes)
function confirmBack() {
  showBackConfirm.value = false
  void router.push('/project')
}

// Note: Logic for adding and inserting Blocks is now handled internally by ScreenplayStream component

// Save
async function handleSave() {
  // v6.0: Check if current episode has scenes
  if (scenes.value.length === 0) {
    error('The screenplay must contain at least one scene! Please add a scene first.', 3000)
    return
  }
  
  if (!projectStore.isProjectOpen) {
    error('Project is not open. Unable to save screenplay!', 3000)
    return
  }
  
  try {
    await projectStore.saveProject()
    lastSaveTime.value = Date.now()
    success('Screenplay saved successfully!')
  } catch (err: unknown) {
    console.error('[Manual Save] Failed:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    error('Save failed: ' + message, 3000)
  }
}

// Preview
function handlePreview() {
  // v6.0: Check if current episode has scenes
  if (scenes.value.length === 0) {
    alert('The screenplay must contain at least one scene! Please add a scene first.')
    return
  }
  
  scriptPreviewState.value = {
    visible: true
  }
}

// Export
function handleExport() {
  // v6.0: Check if current episode has scenes
  if (scenes.value.length === 0) {
    alert('The screenplay must contain at least one scene! Please add a scene first.')
    return
  }
  
  // Call export functionality
  void startExport(episodeId)
}

// Edit narration configuration
function handleEditNarrator() {
  narratorConfigVisible.value = true
}

// Save narration configuration
function handleSaveNarrator(narrator: NarratorConfig) {
  projectStore.updateNarrator(narrator)
  narratorConfigVisible.value = false
}

// Open actor management dialog
function handleManageActors() {
  actorManagementVisible.value = true
}

// Open BGM management dialog
function handleManageBGM() {
  bgmManagerVisible.value = true
}

// Add actor from actor management
function handleAddActorFromManagement(actor: ActorConfig) {
  projectStore.addActor(actor)
}

// Update actor from actor management
function handleUpdateActorFromManagement(alias: string, actor: ActorConfig) {
  projectStore.updateActor(alias, actor)
}

// Delete actor from actor management
function handleDeleteActorFromManagement(alias: string) {
  projectStore.deleteActor(alias)
}

// v7.0: Select character instance (dialogue block) - use instances in scene rather than actors
function handleSelectActor(sceneId: string, blockId: string) {
  // Get current scene
  const scene = episodeStore.getScene(episodeId, sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === blockId)
  if (block?.type === 'dialogue') {
    // v20: Compute runtime objects up to current Block (including spawned state)
    const runtimeSetup = applyBlockActionsToState(
      calculatePrevContext(scene, blockId),
      block,
      scene
    )

    instanceSelectorState.value = {
      visible: true,
      sceneId,
      blockId,
      sceneObjects: runtimeSetup.objects,
      currentInstanceId: block.instanceId
    }
  }
}

// v7.0: Character instance selection confirmation
function handleInstanceSelect(instanceId: string) {
  const { sceneId, blockId } = instanceSelectorState.value
  if (sceneId && blockId) {
    // v7.0: Update instanceId rather than actorAlias
    episodeStore.updateBlockInScene(episodeId, sceneId, blockId, { instanceId })
  }
  instanceSelectorState.value.visible = false
}

// Pose selection functionality has been removed with character system
function handleSelectState(_sceneId: string, _blockId: string) {
  // no-op: character pose selection removed
}

/* Deprecated BGM handling logic
// Select BGM (v5.0: Get and update from setup.objects of scene)
function handleSelectBGM(sceneId: string) {
...
}
*/

// Select expression
function handleSelectExpression(sceneId: string, blockId: string) {
  const scene = episodeStore.getScene(episodeId, sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === blockId)
  if (block?.type === 'dialogue') {
    expressionSelectorState.value = {
      visible: true,
      sceneId,
      blockId,
      ...(block.expression ? { currentExpression: block.expression } : {})
    }
  }
}

// Expression selection confirmation
function handleExpressionSelect(expressionId: string) {
  const { sceneId, blockId } = expressionSelectorState.value
  if (sceneId && blockId) {
    episodeStore.updateBlockInScene(episodeId, sceneId, blockId, { expression: expressionId })
  }
  expressionSelectorState.value.visible = false
}

// Enter Setup Mode (edit initial layout) - v6.10: Use Overlay mode
function handleEnterSetupMode(sceneId: string) {
  sceneEditorState.value = {
    visible: true,
    mode: 'setup',
    sceneId,
    blockId: null
  }
}

// Enter Action Mode (choreograph actions) - v6.10: Use Overlay mode
function handleEnterActionMode(sceneId: string, blockId: string) {
  sceneEditorState.value = {
    visible: true,
    mode: 'action',
    sceneId,
    blockId
  }
}

// v6.10: Exit scene edit (Overlay mode)
function handleExitSceneEdit() {
  sceneEditorState.value = { visible: false, mode: 'setup', sceneId: '', blockId: null }
}

// v6.10: Exit after saving Setup (Overlay mode)
function handleSaveSetup(_savedSceneId: string, _setup: SceneSetup) {
  // SceneEditMode has already called episodeStore.updateScene; only need to close Overlay here
  sceneEditorState.value = { visible: false, mode: 'setup', sceneId: '', blockId: null }
}

// Edit visual (compatible with legacy interface, deprecated)
function handleEditSetup(sceneId: string, blockId: string) {
  // For script blocks, enter Action Mode
  handleEnterActionMode(sceneId, blockId)
}

// Preview scene
function handlePreviewScene(sceneId: string) {
  const scene = episodeStore.getScene(episodeId, sceneId)
  if (!scene) {
    error('Scene does not exist')
    return
  }
  
  if (scene.script.length === 0) {
    error('Scene has no content to preview')
    return
  }
  
  scenePreviewState.value = {
    visible: true,
    sceneId
  }
}

// Update animation name
function handleUpdateEpisodeName(name: string) {
  if (currentEpisode.value) {
    episodeStore.updateEpisode(episodeId, { name })
  }
}
</script>

<style scoped>
.screenplay-editor-page {
  padding: 24px;
  background: #f9fafb;
  min-height: calc(100vh - 60px);
  position: relative;
}

/* v6.10: Scene editor Overlay styles */
.scene-editor-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  background: #1a1a1a;
}

/* Overlay transition animation */
.scene-editor-overlay-enter-active {
  animation: overlay-slide-up 0.3s ease-out;
}

.scene-editor-overlay-leave-active {
  animation: overlay-slide-down 0.25s ease-in;
}

@keyframes overlay-slide-up {
  from {
    transform: translateY(100%);
    opacity: 0.8;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes overlay-slide-down {
  from {
    transform: translateY(0);
    opacity: 1;
  }
  to {
    transform: translateY(100%);
    opacity: 0.8;
  }
}


/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.sound-manager-modal {
  background: white;
  width: 900px;
  height: 80vh;
  max-width: 95vw;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  padding: 16px 24px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #111827;
}

.btn-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #9ca3af;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
}

.btn-close:hover {
  background: #f3f4f6;
  color: #4b5563;
}

.modal-body {
  flex: 1;
  overflow: hidden;
}
</style>
