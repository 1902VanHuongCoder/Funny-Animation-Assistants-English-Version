<template>
  <div class="screenplay-stream">
    <!-- Embedded toolbar -->
    <div class="embedded-toolbar">
      <!-- Left: Back button + Episode name -->
      <div class="toolbar-left">
        <button
          class="toolbar-btn back-btn"
          title="Back to Episode List"
          @click="$emit('back')"
        >
          ← Back to Episodes
        </button>
        
        <div class="toolbar-divider" />
        
        <div class="episode-name-editor">
          <label class="name-label">Episode Name:</label>
          <input 
            type="text" 
            :value="episodeName" 
            class="name-input"
            placeholder="Enter episode name"
            @input="$emit('update:episode-name', ($event.target as HTMLInputElement).value)"
          >
        </div>
      </div>
      
      <!-- Center: Add buttons group -->
      <div class="toolbar-center">
        <div class="add-button-wrapper">
          <button
            class="toolbar-btn"
            title="Add Item"
            @click="showAddMenu"
          >
            ➕ Add
          </button>
          <!-- Add menu -->
          <div
            v-if="addMenuVisible"
            class="add-menu"
            @click.stop
          >
            <button
              class="menu-item"
              @click="handleAddMenuItem('scene')"
            >
              🎬 Scene
            </button>
            <button 
              class="menu-item" 
              :disabled="!hasAnyScene"
              :class="{ disabled: !hasAnyScene }"
              @click="handleAddMenuItem('dialogue')"
            >
              💬 Dialogue
            </button>
            <button 
              class="menu-item" 
              :disabled="!hasAnyScene"
              :class="{ disabled: !hasAnyScene }"
              @click="handleAddMenuItem('narration')"
            >
              📢 Narration
            </button>
          </div>
        </div>
        
        <div class="toolbar-divider" />
        
        <button
          class="toolbar-btn"
          title="Narrator Settings"
          @click="$emit('edit-narrator')"
        >
          🎙️ Narrator
        </button>
        <button
          class="toolbar-btn"
          title="Actor Management"
          @click="$emit('manage-actors')"
        >
          👥 Actors
        </button>
        <button
          class="toolbar-btn"
          title="BGM Management"
          @click="$emit('manage-bgm')"
        >
          🎵 BGM
        </button>
      </div>
      
      <!-- Right: Action buttons -->
      <div class="toolbar-right">
        <button
          class="toolbar-btn"
          title="Save (Ctrl+S)"
          @click="$emit('save')"
        >
          💾 Save
        </button>
        <button
          class="toolbar-btn btn-preview"
          title="Preview"
          @click="$emit('preview')"
        >
          ▶️ Preview
        </button>
        <button
          class="toolbar-btn btn-primary"
          title="Export"
          @click="$emit('export')"
        >
          📤 Export
        </button>
      </div>
    </div>
    
    <!-- Scenes container list -->
    <div
      ref="containerRef"
      class="scenes-container"
    >
      <div
        v-if="scenes.length === 0"
        class="empty-state"
      >
        <p class="empty-icon">
          📝
        </p>
        <p class="empty-text">
          No Screenplay Content
        </p>
        <p class="empty-hint">
          Click the toolbar button to add a scene
        </p>
      </div>

      <template
        v-for="(scene, sceneIndex) in scenes"
        :key="scene.id"
      >
        <!-- Scene container header -->
        <div :data-scene-id="scene.id">
          <SceneContainerHeader
            :scene="scene"
            :is-selected="isSceneSelected(scene.id)"
            :is-expanded="isSceneExpanded(scene.id)"
            :block-count="scene.script.length"
            :can-move-up="sceneIndex > 0"
            :can-move-down="sceneIndex < scenes.length - 1"
            @select="handleSelectScene(scene.id)"
            @delete="handleDeleteScene(scene.id)"
            @toggle-expand="toggleSceneExpanded(scene.id)"
            @enter-setup-mode="handleEnterSetupMode(scene.id)"
            @preview-scene="handlePreviewScene(scene.id)"
            @update-title="handleUpdateSceneTitle(scene.id, $event)"
            @move-up="handleMoveScene(scene.id, 'up')"
            @move-down="handleMoveScene(scene.id, 'down')"
          />
        </div>

        <!-- + button and menu under scene container (shown when selected and expanded) -->
        <div
          v-if="selectedSceneId === scene.id && isSceneExpanded(scene.id)"
          class="insert-button-wrapper bottom"
        >
          <button
            class="btn-insert"
            @click.stop="showSceneAddMenu(scene.id, $event)"
          >
            ➕
          </button>
          <!-- Scene-level add menu (includes scene option) -->
          <div
            v-if="sceneAddMenuVisible === scene.id"
            class="insert-menu scene-menu"
            @click.stop
          >
            <button
              class="menu-item"
              @click="handleSceneAddMenuItem(scene.id, 'scene')"
            >
              🎬 Scene
            </button>
            <button
              class="menu-item"
              @click="handleSceneAddMenuItem(scene.id, 'dialogue')"
            >
              💬 Dialogue
            </button>
            <button
              class="menu-item"
              @click="handleSceneAddMenuItem(scene.id, 'narration')"
            >
              📢 Narration
            </button>
          </div>
        </div>

        <!-- Script block list (only shown when expanded) -->
        <template v-if="isSceneExpanded(scene.id)">
          <template
            v-for="block in scene.script"
            :key="block.id"
          >
            <!-- + button above block (shown only when selected) -->
            <div
              v-if="selectedBlockId === block.id"
              class="insert-button-wrapper top"
            >
              <button
                class="btn-insert"
                @click.stop="showInsertMenu(scene.id, block.id, 'before', $event)"
              >
                ➕
              </button>
            </div>

            <!-- Block component -->
            <div
              class="block-container"
              :data-block-id="block.id"
            >
              <component
                :is="getBlockComponent(block.type)"
                :block="block"
                :is-selected="selectedBlockId === block.id"
                :actor-name="getActorName(block, scene)"
                :character-id="getCharacterId(block, scene)"
                @select="handleSelectBlock(block.id)"
                @delete="handleDeleteBlock(scene.id, block.id)"
                @update="handleUpdateBlock(scene.id, block.id, $event)"
                @select-actor="handleSelectActor(scene.id, block.id)"
                @select-state="handleSelectState(scene.id, block.id)"
                @select-expression="handleSelectExpression(scene.id, block.id)"
                @enter-action-mode="handleEnterActionMode(scene.id, block.id)"
              />
            </div>

            <!-- + button below block (shown only when selected) -->
            <div
              v-if="selectedBlockId === block.id"
              class="insert-button-wrapper bottom"
            >
              <button
                class="btn-insert"
                @click.stop="showInsertMenu(scene.id, block.id, 'after', $event)"
              >
                ➕
              </button>
            </div>
          </template>
        </template>

        <!-- Scene divider -->
        <div
          v-if="sceneIndex < scenes.length - 1"
          class="scene-divider"
        />
      </template>

      <!-- Bottom spacer -->
      <div class="bottom-spacer" />
    </div>

    <!-- Insert menu (block-level, does not contain scene option) -->
    <div 
      v-if="insertMenuVisible" 
      class="insert-menu" 
      :style="{ top: insertMenuPosition.y + 'px', left: insertMenuPosition.x + 'px' }"
      @click.stop
    >
      <button
        class="menu-item"
        @click="handleInsertBlock('dialogue')"
      >
        💬 Dialogue
      </button>
      <button
        class="menu-item"
        @click="handleInsertBlock('narration')"
      >
        📢 Narration
      </button>
    </div>

    <!-- Click outside overlay to close menu -->
    <div
      v-if="insertMenuVisible"
      class="menu-overlay"
      @click="insertMenuVisible = false"
    />
    <div
      v-if="addMenuVisible"
      class="menu-overlay"
      @click="addMenuVisible = false"
    />
    <div
      v-if="sceneAddMenuVisible !== null"
      class="menu-overlay"
      @click="sceneAddMenuVisible = null"
    />

    <!-- New scene dialog -->
    <SceneCreationDialog
      v-if="sceneCreationState.visible"
      :scenes="scenes"
      v-bind="sceneCreationState.defaultSourceId ? { 'default-source-id': sceneCreationState.defaultSourceId } : {}"
      @close="sceneCreationState.visible = false"
      @confirm="handleConfirmCreateScene"
    />

    <!-- Delete scene confirmation dialog -->
    <ConfirmDialog
      v-if="deleteSceneConfirm.visible"
      title="Delete Scene"
      :message="deleteSceneConfirm.message"
      confirm-text="Delete"
      :is-danger="true"
      @confirm="confirmDeleteScene"
      @cancel="deleteSceneConfirm.visible = false"
    />

    <!-- Delete block confirmation dialog -->
    <ConfirmDialog
      v-if="deleteBlockConfirm.visible"
      title="Confirm Delete"
      message="Are you sure you want to delete this block?"
      confirm-text="Delete"
      :is-danger="true"
      @confirm="confirmDeleteBlock"
      @cancel="deleteBlockConfirm.visible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick,onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { CAMERA_BASE_HEIGHT,CAMERA_BASE_WIDTH, CANVAS_CENTER_X, CANVAS_CENTER_Y } from '@/constants/canvas'
// v6.0: Use episodeStore and projectStore instead of screenplayStore
import { useEpisodeStore } from '@/stores/episodeStore'
import type { Action, SceneContainer, SceneSetup, ScriptBlock, ScriptBlockType } from '@/types/screenplay'
import { createInheritedSetup } from '@/utils/sceneStateCalculator'
import { generateId } from '@/utils/uuid'

import DialogueBlock from './DialogueBlock.vue'
import NarrationBlock from './NarrationBlock.vue'
import SceneContainerHeader from './SceneContainerHeader.vue'
import SceneCreationDialog from './SceneCreationDialog.vue'

// Props
defineProps<{
  episodeName?: string
}>()

const emit = defineEmits<{
  back: []
  'update:episode-name': [value: string]
  'edit-narrator': []
  'manage-actors': []
  'manage-bgm': []
  save: []
  preview: []
  export: []
  'select-actor': [sceneId: string, blockId: string]
  'select-state': [sceneId: string, blockId: string]
  'select-expression': [sceneId: string, blockId: string]
  'edit-setup': [sceneId: string, blockId: string]
  'enter-setup-mode': [sceneId: string]
  'enter-action-mode': [sceneId: string, blockId: string]
  'preview-scene': [sceneId: string]
}>()

// v6.0: Use new store
const route = useRoute()
const episodeStore = useEpisodeStore()
const episodeId = route.params['episodeId'] as string

const containerRef = ref<HTMLElement>()

// Scene collapse state
const sceneExpandedMap = ref<Record<string, boolean>>({})

// v6.0: Get data from current episode
const currentEpisode = computed(() => episodeStore.getEpisode(episodeId))
const scenes = computed(() => currentEpisode.value?.scenes || [])
const selectedBlockId = ref<string | null>(null)
const selectedSceneId = ref<string | null>(null)

// Determine if any scenes exist (scenes allow adding dialogue, narration, performance)
const hasAnyScene = computed(() => {
  return scenes.value.length > 0
})

// Determine if scene should display as selected
// Rule: scene selected only if selected and no child Block within it is selected
function isSceneSelected(sceneId: string): boolean {
  // If scene itself not selected, return false directly
  if (selectedSceneId.value !== sceneId) {
    return false
  }
  
  // If scene selected but child Block selected within it, do not display as selected
  const scene = scenes.value.find((s) => s.id === sceneId)
  if (scene && selectedBlockId.value) {
    const hasSelectedBlock = scene.script.some((block) => block.id === selectedBlockId.value)
    if (hasSelectedBlock) {
      return false
    }
  }
  
  return true
}

// Get Block component
function getBlockComponent(type: ScriptBlockType) {
  switch (type) {
    case 'dialogue':
      return DialogueBlock
    case 'narration':
      return NarrationBlock
    default:
      return 'div'
  }
}

// v7.0: Get actor instance name (alias from scene object)
function getActorName(block: ScriptBlock, scene: SceneContainer): string | undefined {
  if (block.type === 'dialogue') {
    // v7.0: Find instance from scene objects
    const instance = scene?.setup?.objects?.find((obj) => obj.id === block.instanceId)
    if (instance) {
      return instance.alias || 'Unnamed'
    }
    return 'Select Actor Instance'
  }
  return undefined
}

// v7.0: Get character ID corresponding to actor instance
function getCharacterId(block: ScriptBlock, scene: SceneContainer): string | undefined {
  if (block.type === 'dialogue') {
    // v7.0: Find instance from scene objects
    const instance = scene?.setup?.objects?.find((obj) => obj.id === block.instanceId)
    return instance?.refId
  }
  return undefined
}

// Toggle scene expand/collapse state
function toggleSceneExpanded(sceneId: string) {
  sceneExpandedMap.value[sceneId] = !sceneExpandedMap.value[sceneId]
}

// Get scene expand state (expanded by default)
function isSceneExpanded(sceneId: string): boolean {
  return sceneExpandedMap.value[sceneId] !== false
}

// Select scene
function handleSelectScene(sceneId: string) {
  // v6.0: Modify ref directly
  const scene = scenes.value.find((s) => s.id === sceneId)
  if (scene && selectedBlockId.value) {
    const hasSelectedBlock = scene.script.some((block) => block.id === selectedBlockId.value)
    if (hasSelectedBlock) {
      selectedBlockId.value = null
    }
  }
  
  selectedSceneId.value = sceneId
}

// Delete scene confirmation dialog state
const deleteSceneConfirm = ref<{
  visible: boolean
  sceneId: string
  message: string
}>({
  visible: false,
  sceneId: '',
  message: ''
})

// Delete scene
function handleDeleteScene(sceneId: string) {
  // v6.0: Find scene from episodes
  const scene = scenes.value.find((s) => s.id === sceneId)
  if (!scene) return
  
  // Build prompt message
  let message = `Are you sure you want to delete scene "${scene.title}"?`
  
  if (scene.script.length > 0) {
    const blockCounts = {
      dialogue: 0,
      narration: 0,
      action: 0
    }
    
    scene.script.forEach((block: ScriptBlock) => {
      if (block.type in blockCounts) {
        blockCounts[block.type]++
      }
    })
    
    const parts: string[] = []
    if (blockCounts.dialogue > 0) parts.push(`${blockCounts.dialogue} dialogue block(s)`)
    if (blockCounts.narration > 0) parts.push(`${blockCounts.narration} narration block(s)`)
    if (blockCounts.action > 0) parts.push(`${blockCounts.action} action block(s)`)
    
    message += `\n\nThis scene contains: ${parts.join(', ')}\nThis action cannot be undone!`
  }
  
  deleteSceneConfirm.value = {
    visible: true,
    sceneId,
    message
  }
}

// Confirm scene deletion
function confirmDeleteScene() {
  const { sceneId } = deleteSceneConfirm.value
  episodeStore.deleteScene(episodeId, sceneId)
  deleteSceneConfirm.value.visible = false
}

// Update scene title
function handleUpdateSceneTitle(sceneId: string, title: string) {
  // v6.0: Update scene via episodeStore
  episodeStore.updateScene(episodeId, sceneId, { title })
}

// Move scene order (up/down)
function handleMoveScene(sceneId: string, direction: 'up' | 'down') {
  episodeStore.moveScene(episodeId, sceneId, direction)
}

// Enter Setup Mode - v6.10: Overlay mode, component not unmounted, no need to save state
function handleEnterSetupMode(sceneId: string) {
  emit('enter-setup-mode', sceneId)
}

// Enter Action Mode - v6.10: Overlay mode, component not unmounted, no need to save state
function handleEnterActionMode(sceneId: string, blockId: string) {
  emit('enter-action-mode', sceneId, blockId)
}

// Preview scene
function handlePreviewScene(sceneId: string) {
  emit('preview-scene', sceneId)
}

// Select Block
function handleSelectBlock(blockId: string) {
  // v6.0: Modify ref directly
  selectedBlockId.value = blockId
  
  if (selectedSceneId.value) {
    selectedSceneId.value = null
  }
}

// Delete Block confirmation dialog state
const deleteBlockConfirm = ref<{
  visible: boolean
  sceneId: string
  blockId: string
}>({
  visible: false,
  sceneId: '',
  blockId: ''
})

// Delete Block
function handleDeleteBlock(sceneId: string, blockId: string) {
  deleteBlockConfirm.value = {
    visible: true,
    sceneId,
    blockId
  }
}

// Confirm Block deletion
function confirmDeleteBlock() {
  const { sceneId, blockId } = deleteBlockConfirm.value
  episodeStore.deleteBlockFromScene(episodeId, sceneId, blockId)
  deleteBlockConfirm.value.visible = false
}

// Update Block
function handleUpdateBlock(sceneId: string, blockId: string, updates: Partial<ScriptBlock>) {
  // v6.0: Update block via episodeStore
  episodeStore.updateBlockInScene(episodeId, sceneId, blockId, updates)
}

// Show add menu
function showAddMenu() {
  addMenuVisible.value = !addMenuVisible.value
}

// Show scene-level add menu
function showSceneAddMenu(sceneId: string, event: MouseEvent) {
  event.stopPropagation()
  // Toggle menu state
  sceneAddMenuVisible.value = sceneAddMenuVisible.value === sceneId ? null : sceneId
}

// Handle scene-level add menu item click
function handleSceneAddMenuItem(sceneId: string, type: 'scene' | 'dialogue' | 'narration' | 'action') {
  sceneAddMenuVisible.value = null
  
  if (type === 'scene') {
    // Insert new scene after current scene
    selectedSceneId.value = null
    selectedBlockId.value = null
    
    // Find current scene index
    const currentSceneIndex = scenes.value.findIndex(s => s.id === sceneId)
    
    // Open create scene dialog
    sceneCreationState.value = {
      visible: true,
      insertIndex: currentSceneIndex !== -1 ? currentSceneIndex + 1 : -1,
      defaultSourceId: sceneId
    }
  } else {
    // Add block at start of scene
    const scene = scenes.value.find((s) => s.id === sceneId)
    if (!scene) return

    let newBlock: ScriptBlock | undefined
    switch (type) {
      case 'dialogue': {
        newBlock = {
          id: generateId(),
          type: 'dialogue' as const,
          instanceId: '',  // Leave empty for manual actor instance selection
          text: '',
          actions: [] as Action[]
        }
        break
      }
      case 'narration':
        newBlock = {
          id: generateId('block'),
          type: 'narration' as const,
          text: '',
          actions: [] as Action[]
        }
        break
      case 'action':
        newBlock = {
          id: generateId('block'),
          type: 'action' as const,
          duration: 2000,
          actions: [] as Action[]
        }
        break
    }
    
    if (newBlock) {
      episodeStore.addBlockToScene(episodeId, sceneId, newBlock)
      sceneExpandedMap.value[sceneId] = true
      selectedSceneId.value = null
      selectedBlockId.value = null
      selectedBlockId.value = newBlock.id
      void nextTick(() => {
        void scrollToBlock(newBlock.id)
      })
    }
  }
}

// Handle add menu item click
function handleAddMenuItem(type: 'scene' | 'dialogue' | 'narration' | 'action') {
  addMenuVisible.value = false
  
  if (type === 'scene') {
    handleAddScene()
  } else if (type === 'dialogue') {
    handleAddDialogue()
  } else if (type === 'narration') {
    handleAddNarration()
  } else if (type === 'action') {
    handleAddAction()
  }
}

// v6.0: Create scene helper function
function createEmptySetup(): SceneSetup {
  return {
    camera: {
      x: CANVAS_CENTER_X,
      y: CANVAS_CENTER_Y,
      width: CAMERA_BASE_WIDTH,
      height: CAMERA_BASE_HEIGHT,
      zoom: 1.0
    },
    objects: [],
    renderChain: [],
  }
}

function createScene(title?: string, setup?: SceneSetup): SceneContainer {
  // Copy setup if passed, otherwise create empty
  const newSetup = setup ? JSON.parse(JSON.stringify(setup)) as SceneSetup : createEmptySetup()
  
  return {
    id: generateId('scene'),
    type: 'scene_container',
    title: title || `Scene ${scenes.value.length + 1}`,
    setup: newSetup,
    script: []
  }
}

// Confirm scene creation
async function handleConfirmCreateScene(payload: { mode: 'copy' | 'empty' | 'inherit', sourceId?: string }) {
  sceneCreationState.value.visible = false
  
  let setup: SceneSetup | undefined
  
  if (payload.mode === 'copy' && payload.sourceId) {
    const sourceScene = scenes.value.find(s => s.id === payload.sourceId)
    if (sourceScene) {
      setup = sourceScene.setup
    }
  } else if (payload.mode === 'inherit' && payload.sourceId) {
    const sourceScene = scenes.value.find(s => s.id === payload.sourceId)
    if (sourceScene) {
      setup = createInheritedSetup(sourceScene)
    }
  }
  
  const newScene = createScene(undefined, setup)
  
  if (sceneCreationState.value.insertIndex !== -1) {
    // Insert at specified position
    episodeStore.insertScene(episodeId, newScene, sceneCreationState.value.insertIndex)
  } else {
    // Add to end
    episodeStore.addScene(episodeId, newScene)
  }
  
  selectedSceneId.value = newScene.id
  sceneExpandedMap.value[newScene.id] = true
  
  await nextTick()
  setTimeout(() => {
    if (containerRef.value) {
      const sceneElement = containerRef.value.querySelector(`[data-scene-id="${newScene.id}"]`)!
      if (sceneElement) {
        sceneElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      } else {
        containerRef.value?.scrollTo({ top: containerRef.value.scrollHeight, behavior: 'smooth' })
      }
    }
  }, 100)
}

// Add scene (click bottom add button)
function handleAddScene() {
  selectedSceneId.value = null
  selectedBlockId.value = null
  
  // Copy last scene by default
  const lastScene = scenes.value.length > 0 ? scenes.value[scenes.value.length - 1] : undefined
  
  sceneCreationState.value = {
    visible: true,
    insertIndex: -1, // append
    ...(lastScene?.id ? { defaultSourceId: lastScene.id } : {})
  }
}

// Add dialogue block to last scene
function handleAddDialogue() {
  if (scenes.value.length === 0) {
    handleAddScene()
    return
  }
  const lastScene = scenes.value[scenes.value.length - 1]
  if (!lastScene) return
  selectedSceneId.value = null
  selectedBlockId.value = null
  const newBlock = {
    id: generateId('block'),
    type: 'dialogue' as const,
    instanceId: '',  // Leave empty for manual actor instance selection
    text: '',
    actions: [] as Action[]
  }
  episodeStore.addBlockToScene(episodeId, lastScene.id, newBlock)
  selectedBlockId.value = newBlock.id
  void scrollToBottom()
}

// Add narration block to last scene
function handleAddNarration() {
  if (scenes.value.length === 0) {
    handleAddScene()
    return
  }
  const lastScene = scenes.value[scenes.value.length - 1]
  if (!lastScene) return
  selectedSceneId.value = null
  selectedBlockId.value = null
  const newBlock = {
    id: generateId('block'),
    type: 'narration' as const,
    text: '',
    actions: [] as Action[]
  }
  episodeStore.addBlockToScene(episodeId, lastScene.id, newBlock)
  selectedBlockId.value = newBlock.id
  void scrollToBottom()
}

// Add performance block
function handleAddAction() {
  if (scenes.value.length === 0) {
    handleAddScene()
    return
  }
  const lastScene = scenes.value[scenes.value.length - 1]
  if (!lastScene) return
  selectedSceneId.value = null
  selectedBlockId.value = null
  const newBlock = {
    id: generateId('block'),
    type: 'action' as const,
    duration: 2000,
    actions: [] as Action[]
  }
  episodeStore.addBlockToScene(episodeId, lastScene.id, newBlock)
  selectedBlockId.value = newBlock.id
  void scrollToBottom()
}

// Select actor
function handleSelectActor(sceneId: string, blockId: string) {
  emit('select-actor', sceneId, blockId)
}

// Select state
function handleSelectState(sceneId: string, blockId: string) {
  emit('select-state', sceneId, blockId)
}

// Select expression
function handleSelectExpression(sceneId: string, blockId: string) {
  emit('select-expression', sceneId, blockId)
}

// Toolbar add menu state
const addMenuVisible = ref(false)

// Scene-level add menu state (records scene ID currently showing menu)
const sceneAddMenuVisible = ref<string | null>(null)

// Insert menu state
const insertMenuVisible = ref(false)
const insertMenuPosition = ref({ x: 0, y: 0 })
const insertMenuContext = ref<{ sceneId: string; blockId: string; position: 'before' | 'after' } | null>(null)

// Create scene dialog state
const sceneCreationState = ref<{
  visible: boolean
  insertIndex: number // -1 indicates add to end
  defaultSourceId?: string
}>({
  visible: false,
  insertIndex: -1
})

// Show insert menu (block-level)
function showInsertMenu(sceneId: string, blockId: string, position: 'before' | 'after', event: MouseEvent) {
  const button = event.target as HTMLElement
  const rect = button.getBoundingClientRect()
  insertMenuPosition.value = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height + 5
  }
  insertMenuContext.value = { sceneId, blockId, position }
  insertMenuVisible.value = true
}

// Handle insert block (block-level insert only)
function handleInsertBlock(type: 'dialogue' | 'narration' | 'action') {
  if (!insertMenuContext.value) return

  const { sceneId, blockId, position } = insertMenuContext.value
  const scene = scenes.value.find((s) => s.id === sceneId)
  if (!scene) return

  const blockIndex = scene.script.findIndex((b) => b.id === blockId)
  if (blockIndex === -1) return

  const insertIndex = position === 'before' ? blockIndex : blockIndex + 1

  let newBlock: ScriptBlock
  switch (type) {
    case 'dialogue': {
      newBlock = {
        id: generateId('block'),
        type: 'dialogue',
        instanceId: '',  // Leave empty for manual actor instance selection
        text: '',
        actions: []
      }
      break
    }
    case 'narration':
      newBlock = {
        id: generateId('block'),
        type: 'narration',
        text: '',
        actions: []
      }
      break
    case 'action':
      newBlock = {
        id: generateId('block'),
        type: 'action',
        duration: 2000,
        actions: [] as Action[]
      }
      break
  }

  if (newBlock) {
    scene.script.splice(insertIndex, 0, newBlock)
    sceneExpandedMap.value[sceneId] = true
    selectedSceneId.value = null
    selectedBlockId.value = null
    selectedBlockId.value = newBlock.id
    void nextTick(() => {
      void scrollToBlock(newBlock.id)
    })
  }

  insertMenuVisible.value = false
  insertMenuContext.value = null
}

function handleKeyDown(event: KeyboardEvent) {
  // Do not process shortcuts when inside input
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return
  }

  if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    event.preventDefault()
    if (scenes.value.length === 0) {
      handleAddScene()
      return
    }
    const lastScene = scenes.value[scenes.value.length - 1]
    if (!lastScene) return
    // v7.0: Use first object instance in scene
    const firstInstance = lastScene.setup?.objects?.[0]
    if (!firstInstance) {
      alert('No objects found in scene. Please add objects in Setup mode first.')
      return
    }
    selectedSceneId.value = null
    selectedBlockId.value = null
    const newBlock = {
      id: generateId('block'),
      type: 'dialogue' as const,
      instanceId: firstInstance.id,  // v7.0: Use instance ID
      text: '',
      actions: [] as Action[]
    }
    episodeStore.addBlockToScene(episodeId, lastScene.id, newBlock)
    selectedBlockId.value = newBlock.id
    void scrollToBottom()
  }
  
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
    event.preventDefault()
    if (scenes.value.length === 0) {
      handleAddScene()
      return
    }
    const lastScene = scenes.value[scenes.value.length - 1]
    if (!lastScene) return
    selectedSceneId.value = null
    selectedBlockId.value = null
    const newBlock = {
      id: generateId('block'),
      type: 'narration' as const,
      text: '',
      actions: [] as Action[]
    }
    episodeStore.addBlockToScene(episodeId, lastScene.id, newBlock)
    selectedBlockId.value = newBlock.id
    void scrollToBottom()
  }
  
  // Shift+Enter: Add performance block
  if (event.key === 'Enter' && event.shiftKey) {
    event.preventDefault()
    handleAddAction()
  }
  
  if (event.key === 'Delete' && selectedBlockId.value) {
    event.preventDefault()
    for (const scene of scenes.value) {
      const block = scene.script.find((b) => b.id === selectedBlockId.value)
      if (block) {
        handleDeleteBlock(scene.id, block.id)
        break
      }
    }
  }
}

onMounted(() => {
  // console.log('[ScreenplayStream] onMounted, episodeId:', episodeId)
  document.addEventListener('keydown', handleKeyDown)
  // v6.10: Overlay mode avoids unmounting, no need to restore state
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeyDown)
})



async function scrollToBlock(blockId: string) {
  const scene = scenes.value.find((s) => s.script.some((b) => b.id === blockId))
  if (scene) {
    sceneExpandedMap.value[scene.id] = true
  }
  
  // 2. Wait for Vue to render DOM
  await nextTick()
  
  // 3. Find DOM element
  if (!containerRef.value) {
    console.warn('scrollToBlock: containerRef is null')
    return
  }
  
  // Use robust lookup logic with delay retries
  // Reduce wait time, enhance responsiveness with frequent checks
  const findElement = () => containerRef.value?.querySelector(`[data-block-id="${blockId}"]`)
  
  let blockElement = findElement()
  let attempts = 0
  
  // If not found, poll several times (handles async render latency)
  while (!blockElement && attempts < 5) {
    await new Promise(resolve => setTimeout(resolve, 50)) // Check every 50ms
    blockElement = findElement()
    attempts++
  }
  
  if (blockElement) {
    // Core fix: use native API with block: 'center' to ensure new element visible
    blockElement.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'center',  // Centered vertically
      inline: 'nearest' 
    })
    
    // Provide highlight feedback (optional)
    blockElement.classList.add('highlight-flash')
    setTimeout(() => blockElement.classList.remove('highlight-flash'), 1000)
  } else {
    // Fallback: scroll to bottom if element not found
    console.warn(`scrollToBlock: element not found for ${blockId}, falling back to bottom`)
    containerRef.value.scrollTo({
      top: containerRef.value.scrollHeight,
      behavior: 'smooth'
    })
  }
}

// Scroll to last content
async function scrollToBottom() {
  // 1. Find last scene
  if (scenes.value.length === 0) return
  const lastScene = scenes.value[scenes.value.length - 1]
  if (!lastScene) return
  
  // 2. Ensure last scene expanded
  sceneExpandedMap.value[lastScene.id] = true
  
  await nextTick()

  // 3. Determine if last scene has Block
  if (lastScene.script.length > 0) {
    // If Block exists, scroll to last Block
    const lastBlock = lastScene.script[lastScene.script.length - 1]
    if (lastBlock) {
      await scrollToBlock(lastBlock.id)
    }
  } else {
    // If no Block (empty scene), scroll to scene header
    // Can assign id or data attribute to SceneContainerHeader for positioning
    // Use fallback scrollHeight, typically accurate after nextTick
    setTimeout(() => {
      if (containerRef.value) {
        containerRef.value.scrollTo({
          top: containerRef.value.scrollHeight,
          behavior: 'smooth'
        })
      }
    }, 100)
  }
}

// Expose for parent component invocation
defineExpose({
  scrollToBottom
})
</script>

<style scoped>
.screenplay-stream {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

/* Embedded toolbar */
.embedded-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  background: #f8f9fa;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.toolbar-left,
.toolbar-center,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-center {
  flex: 1;
  justify-content: center;
}

.toolbar-divider {
  width: 1px;
  height: 24px;
  background: #d1d5db;
  margin: 0 4px;
}

.toolbar-btn {
  padding: 8px 16px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.toolbar-btn:hover {
  background: #f9fafb;
  border-color: #9ca3af;
}

.toolbar-btn.back-btn {
  color: #3b82f6;
  border-color: #3b82f6;
}

.toolbar-btn.back-btn:hover {
  background: #eff6ff;
  border-color: #2563eb;
}

.toolbar-btn.btn-primary {
  background: #3b82f6;
  border-color: #3b82f6;
  color: white;
}

.toolbar-btn.btn-primary:hover {
  background: #2563eb;
  border-color: #2563eb;
}

.episode-name-editor {
  display: flex;
  align-items: center;
  gap: 8px;
}

.name-label {
  font-size: 14px;
  color: #6b7280;
  white-space: nowrap;
}

.name-input {
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  color: #1f2937;
  width: 200px;
  transition: all 0.2s;
}

.name-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.name-input::placeholder {
  color: #9ca3af;
}

.scenes-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  padding-bottom: 80px;
  background: #f9fafb;
}

.scene-divider {
  height: 24px;
  margin: 16px 0;
  border-bottom: 2px dashed #e5e7eb;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.empty-text {
  font-size: 18px;
  font-weight: 500;
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 14px;
}

/* Bottom floating bar */
.floating-action-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  background: linear-gradient(to top, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.9) 70%, transparent 100%);
  backdrop-filter: blur(8px);
  border-top: 1px solid rgba(229, 231, 235, 0.5);
}

.btn-add {
  padding: 10px 20px;
  background: white;
  border: 2px solid #3b82f6;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #3b82f6;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.1);
}

.btn-add:hover {
  background: #3b82f6;
  color: white;
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(59, 130, 246, 0.2);
}

.btn-add:active {
  transform: translateY(0);
}

/* Scrollbar styles */
.blocks-container::-webkit-scrollbar {
  width: 8px;
}

.blocks-container::-webkit-scrollbar-track {
  background: #f1f5f9;
}

.blocks-container::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}

.blocks-container::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

.bottom-spacer {
  height: 50vh;
  min-height: 300px;
}

.block-container {
  margin-left: 24px;
  position: relative;
}

.block-container::before {
  content: '';
  position: absolute;
  left: -12px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: linear-gradient(to bottom, #e5e7eb 0%, #e5e7eb 100%);
}

.insert-button-wrapper {
  display: flex;
  justify-content: center;
  padding: 8px 0;
  position: relative;
}

.insert-button-wrapper.top {
  margin-bottom: -4px;
}

.insert-button-wrapper.bottom {
  margin-top: -4px;
}

.btn-insert {
  width: 36px;
  height: 24px;
  border-radius: 4px;
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: #3b82f6;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.btn-insert:hover {
  background: rgba(59, 130, 246, 0.25);
  border-color: rgba(59, 130, 246, 0.5);
  transform: scale(1.05);
}

.insert-menu {
  position: fixed;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  padding: 4px;
  z-index: 1000;
  min-width: 120px;
  transform: translateX(-50%);
}

/* Scene-level menu (positioned relative to + button) */
.insert-menu.scene-menu {
  position: absolute;
  top: calc(100% + 5px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 160px;
}

.menu-item {
  width: 100%;
  padding: 10px 16px;
  text-align: left;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.menu-item:hover {
  background: #f3f4f6;
}

.menu-item:disabled,
.menu-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  color: #9ca3af;
}

.menu-item:disabled:hover,
.menu-item.disabled:hover {
  background: white;
}

.menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
}

.add-button-wrapper {
  position: relative;
}

.add-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  padding: 4px;
  z-index: 1000;
  min-width: 180px;
}

.add-menu .menu-item {
  width: 100%;
  padding: 10px 16px;
  text-align: left;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.add-menu .menu-item:hover {
  background: #f3f4f6;
}

/* New Block highlight animation */
.highlight-flash {
  animation: flash-bg 1s ease-out;
}

@keyframes flash-bg {
  0% { background-color: #dbeafe; } /* Light blue highlight */
  100% { background-color: transparent; }
}

.btn-preview {
  background-color: #10b981;
  color: white;
  border-color: #059669;
  font-weight: 600;
}

.btn-preview:hover {
  background-color: #059669;
  border-color: #047857;
}
</style>
