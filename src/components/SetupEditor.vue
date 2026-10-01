<template>
  <div
    ref="setupEditorContainer"
    class="setup-editor"
  >
    <!-- v8.6: Left sidebar removed, object selection and alias editing moved to right properties panel -->

    <!-- Center: Canvas area -->
    <main class="canvas-area">
      <!-- Top toolbar -->
      <div class="setup-toolbar">
        <div class="toolbar-left">
          <button
            class="toolbar-btn icon-only"
            title="Back"
            @click="handleReturn"
          >
            🔙
          </button>
          <span
            class="save-status"
            :class="{ unsaved: hasLocalChanges }"
          >
            {{ hasLocalChanges ? '● Unsaved' : '✓ Saved' }}
          </span>
          <span class="mouse-position">
            ({{ renderer?.mousePosition?.x || 0 }}, {{ renderer?.mousePosition?.y || 0 }})
          </span>
          <div class="scene-title">
            <span class="mode-icon">🏗️</span>
            <span class="scene-name">{{ currentSceneTitle }}</span>
          </div>
        </div>
        <div class="toolbar-right">
          <div class="add-menu-container">
            <button
              class="toolbar-btn add-btn"
              title="Add Asset"
              @click="toggleAddMenu"
            >
              <span class="btn-icon">+</span>
              <span class="btn-text">Add Asset</span>
            </button>
            <div
              v-if="showAddMenu"
              class="add-menu"
            >

              <button
                class="menu-item"
                @click="handleMenuItemClick('backgrounds')"
              >
                <span class="menu-icon">🖼️</span>
                <span>Background</span>
              </button>
              <button
                class="menu-item"
                @click="handleMenuItemClick('props')"
              >
                <span class="menu-icon">📦</span>
                <span>Prop</span>
              </button>
              <button
                class="menu-item"
                @click="handleMenuItemClick('sounds')"
              >
                <span class="menu-icon">🔊</span>
                <span>Sound</span>
              </button>
              <button
                class="menu-item"
                @click="handleMenuItemClick('screen_effects')"
              >
                <span class="menu-icon">🌟</span>
                <span>Visual Effect</span>
              </button>
              <button
                class="menu-item"
                @click="handleMenuItemClick('symbol')"
              >
                <span class="menu-icon">🔧</span>
                <span>Symbol</span>
              </button>
              <button
                class="menu-item"
                @click="handleMenuItemClick('expression')"
              >
                <span class="menu-icon">😀</span>
                <span>Expression</span>
              </button>
              <button
                class="menu-item"
                @click="handleMenuItemClick('scene_templates')"
              >
                <span class="menu-icon">🧩</span>
                <span>Scene Template</span>
              </button>
              <button
                class="menu-item"
                @click="handleMenuItemClick('actors')"
              >
                <span class="menu-icon">🎭</span>
                <span>Actor</span>
              </button>
              <button
                class="menu-item"
                @click="handleMenuItemClick('characters')"
              >
                <span class="menu-icon">👤</span>
                <span>Character</span>
              </button>
              <button
                class="menu-item"
                @click="handleMenuItemClick('light')"
              >
                <span class="menu-icon">💡</span>
                <span>Light</span>
              </button>
              <button
                class="menu-item"
                @click="handleMenuItemClick('text')"
              >
                <span class="menu-icon">📝</span>
                <span>Text</span>
              </button>
            </div>
          </div>
          <button 
            class="toolbar-btn icon-only" 
            title="Duplicate selected object" 
            :disabled="sceneObjectStore.getSelectedObject()?.type === 'camera'"
            @click="handleCopyObject"
          >
            ❐
          </button>
          <button
            class="toolbar-btn icon-only"
            title="Group"
            :disabled="sceneObjectStore.getSelectedObject()?.type === 'camera'"
            @click="handleStartGrouping"
          >
            🔗
          </button>
          <button
            class="toolbar-btn icon-only"
            title="Save as scene template"
            :disabled="nonCameraObjects.length === 0"
            @click="showSaveTemplateDialog = true"
          >
            🧩
          </button>
          <button 
            class="toolbar-btn danger icon-only" 
            title="Delete selected object" 
            :disabled="sceneObjectStore.getSelectedObject()?.type === 'camera' || (sceneObjectStore.getSelectedObject()?.type === 'light' && (sceneObjectStore.getSelectedObject() as any)?.lightType === 'ambient')"
            @click="handleDeleteObject()"
          >
            🗑️
          </button>
          <button
            class="toolbar-btn primary icon-only"
            title="Save"
            @click="handleSaveSetup"
          >
            💾
          </button>
          <button
            v-if="isDev"
            class="toolbar-btn icon-only"
            title="View Scene Render Chain"
            @click="showRenderChainDialog = true"
          >
            RC
          </button>
          <div style="position: relative; display: flex; align-items: center;">
            <button
              class="toolbar-btn icon-only"
              :class="{ active: showPassThroughPanel }"
              title="Pass-through Management"
              @click="showPassThroughPanel = !showPassThroughPanel; showPassThroughTip = false"
            >
              👻{{ passThroughCount > 0 ? ` ${passThroughCount}` : '' }}
            </button>
            <div v-if="showPassThroughTip" class="pass-through-tip-bubble">
              Camera and ambient light are set to pass-through mode by default, click to manage
            </div>
            <PassThroughPanel
              v-if="showPassThroughPanel"
              :entries="passThroughPanelEntries"
              @remove="removeFromPassThrough"
              @toggle-visible="togglePassThroughVisible"
              @select-object="handleSelectObject"
              @close="showPassThroughPanel = false"
            />
          </div>
          <button
            class="toolbar-btn icon-only"
            :title="isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'"
            @click="toggleFullscreen"
          >
            {{ isFullscreen ? '⛶' : '⛶' }}
          </button>
        </div>
      </div>

      <!-- P2: Grouping mode floating bar -->
      <GroupingModePanel
        v-if="groupingState"
        v-model:composite-mode="selectedCompositeMode"
        :mode="groupingState.mode === 'create' ? 'create' : 'addTo'"
        :composite-name="groupingState.mode === 'addTo' ? getCompositeDisplayName(groupingState.compositeId) : undefined"
        :pending-ids="groupingState.pendingIds"
        :tree-nodes="groupingEligibleObjects"
        :locked-parent-id="lockedParentId"
        @toggle="handleGroupingToggleById"
        @confirm="handleGroupingConfirm(selectedCompositeMode)"
        @cancel="handleGroupingCancel"
      />

      <!-- Canvas container -->
      <div
        ref="canvasContainer"
        class="canvas-container"
        @click="handleCanvasClickForGrouping"
      >
        <ZoomControls
          v-if="renderer"
          :current-zoom="renderer.userZoom"
          @zoom-change="(z: number) => renderer?.setZoomLevel(z)"
          @fit="() => renderer?.resetView()"
          @fit-all="() => renderer?.fitAll()"
          @zoom-100="() => renderer?.zoomTo100()"
        />
        <CanvasScrollbars
          v-if="renderer && canvasContainer"
          :canvas-width="renderer.canvasSize.width"
          :canvas-height="renderer.canvasSize.height"
          :viewport-width="canvasContainer.clientWidth"
          :viewport-height="canvasContainer.clientHeight"
          :effective-scale="renderer.transformParams.scale"
          :pan-x="renderer.panOffset.x"
          :pan-y="renderer.panOffset.y"
          @pan-change="(x: number, y: number) => renderer?.setPanOffset(x, y)"
        />
      </div>
    </main>

    <!-- Right resizer -->
    <div
      v-show="!rightPanelCollapsed"
      class="resizer right-resizer"
      @mousedown="startResizeRightPanel"
    />

    <!-- Right collapse button -->
    <button
      v-show="rightPanelCollapsed"
      class="expand-btn right"
      title="Expand Panel"
      @click="rightPanelCollapsed = false"
    >
      ◀
    </button>

    <!-- Right: Properties panel -->
    <aside
      v-show="!rightPanelCollapsed"
      class="right-panel"
      :style="{ width: rightPanelWidth + 'px' }"
    >
      <div class="panel-header">
        <button
          class="collapse-btn"
          title="Collapse Panel"
          @click="rightPanelCollapsed = true"
        >
          ▶
        </button>
        <h3>{{ propertyPanelTitle }}</h3>
      </div>

      <ObjectPropertiesPanel
        :selected-object="sceneObjectStore?.getSelectedObject()"
        :canvas-width="renderer?.canvasSize?.width || 1920"
        :canvas-height="renderer?.canvasSize?.height || 1080"
        :is-pass-through="selectedObjectIsPassThrough"
        :pass-through-visible="selectedObjectPassThroughVisible"
        :persist-changes="handleSaveSetup"
        @update="handleUpdateObject"
        @initial-state-update="handleInitialStateUpdate"
        @move-up="handleMoveUp"
        @move-down="handleMoveDown"
        @trigger-anim="handleTriggerAnim"
        @select-object="handleSelectObject"
        @edit-alias="handleEditAlias"
        @composite-action="handleCompositeAction"
        @animations-updated="() => workspace.markLocalChange()"
        @pass-through-toggle="handlePassThroughToggle"
        @pass-through-visible-toggle="togglePassThroughVisible"
      />
    </aside>

    <!-- Asset picker dialogs -->

    <BackgroundPickerDialog
      v-if="showBackgroundPicker"
      @select="handleBackgroundSelect"
      @close="showBackgroundPicker = false"
    />
    <PropPickerDialog
      v-if="showPropPicker"
      @select="handlePropSelect"
      @close="showPropPicker = false"
    />
    <!-- v7.3: EffectPickerDialog removed -->
    <SoundPickerDialog
      v-if="showSoundPicker"
      @select="handleSoundSelect"
      @close="showSoundPicker = false"
    />
    <ScreenEffectPickerDialog
      v-if="showScreenEffectPicker"
      @select="handleScreenEffectSelect"
      @select-mask="handleMaskFromDialog"
      @close="showScreenEffectPicker = false"
    />
    <LightPickerDialog
      v-if="showLightPicker"
      @select="handleLightSelect"
      @close="showLightPicker = false"
    />
    <SceneTemplatePickerDialog
      v-if="showTemplatePicker"
      @select="handleTemplateSelect"
      @close="showTemplatePicker = false"
    />

    <!-- v18: Expression picker dialog -->
    <ExpressionSelectorDialog
      v-if="showExpressionPicker"
      @select="handleExpressionSelect"
      @close="showExpressionPicker = false"
    />

    <!-- v19: Character picker dialog -->
    <CompositeCharacterPickerDialog
      v-if="showCharacterPicker"
      @select="handleCompositeCharacterSelect"
      @close="showCharacterPicker = false"
    />

    <!-- Actor picker dialog -->
    <ActorPickerDialog
      v-if="showActorPicker"
      @select="handleActorSelect"
      @close="showActorPicker = false"
    />

    <!-- v17: Save as scene template dialog -->
    <SaveTemplateDialog
      v-if="showSaveTemplateDialog"
      :visible="showSaveTemplateDialog"
      :initial-selected-object-id="sceneObjectStore.getSelectedObject()?.id"
      :all-scene-objects="nonCameraObjects"
      @cancel="showSaveTemplateDialog = false"
      @saved="handleTemplateSaved"
    />

    <!-- Confirm dialog -->
    <ConfirmDialog
      v-if="showConfirmDialog"
      :title="confirmDialogConfig.title"
      :message="confirmDialogConfig.message"
      :confirm-text="confirmDialogConfig.confirmText"
      :cancel-text="confirmDialogConfig.cancelText"
      :is-danger="confirmDialogConfig.isDanger"
      :show-secondary-confirm="confirmDialogConfig.showSecondaryConfirm"
      :secondary-confirm-text="confirmDialogConfig.secondaryConfirmText"
      @confirm="confirmDialogConfig.onConfirm"
      @secondary-confirm="confirmDialogConfig.onSecondaryConfirm"
      @cancel="showConfirmDialog = false"
    />

    <!-- Save confirm dialog -->
    <SaveConfirmDialog
      v-if="showSaveConfirmDialog"
      title="Save Changes"
      message="There are unsaved changes. How would you like to proceed?"
      @save-and-exit="handleSaveAndExit"
      @discard="handleDiscardAndExit"
      @cancel="showSaveConfirmDialog = false"
    />

    <!-- v7.1: Instance alias input dialog (supports all object types) -->
    <InstanceAliasDialog
      v-if="showAliasDialog"
      :actor-name="aliasDialogActorName"
      :suggested-alias="aliasDialogSuggestedAlias"
      :existing-aliases="existingAliases"
      :current-alias="aliasDialogCurrentAlias || ''"
      :object-type="aliasDialogObjectType"
      @confirm="handleAliasConfirm"
      @cancel="handleAliasCancel"
    />

    <!-- Save toast -->
    <SceneRenderChainDialog
      v-if="showRenderChainDialog"
      mode-description="Setup objects"
      @close="showRenderChainDialog = false"
    />

    <Transition name="toast">
      <div
        v-if="showSaveToast"
        class="save-toast"
        :class="saveToastType"
      >
        <span class="toast-icon">{{ saveToastType === 'success' ? '✓' : '✗' }}</span>
        <span class="toast-message">{{ saveToastMessage }}</span>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useAssetLoader } from '@/composables/useAssetLoader'
import { useSetupWorkspace } from '@/composables/useSetupWorkspace'
import { useToast } from '@/composables/useToast'
import { CAMERA_BASE_HEIGHT, CAMERA_BASE_WIDTH, CANVAS_CENTER_X, CANVAS_CENTER_Y } from '@/constants/canvas'
import { getTypeIcon } from '@/core/sceneObjectProviders/metadata'
import { logService } from '@/services/LogService'
import type { Episode } from '@/stores/episodeStore'
import { useEpisodeStore } from '@/stores/episodeStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { SceneSetup } from '@/types/screenplay'
import { collectSetupFromSceneObjects, loadSetupToSceneObjects } from '@/utils/sceneLoader'

import ActorPickerDialog from './ActorPickerDialog.vue'
import BackgroundPickerDialog from './BackgroundPickerDialog.vue'
import CanvasScrollbars from './CanvasScrollbars.vue'
import CompositeCharacterPickerDialog from './CompositeCharacterPickerDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import GroupingModePanel from './GroupingModePanel.vue'
import InstanceAliasDialog from './InstanceAliasDialog.vue'
import LightPickerDialog from './LightPickerDialog.vue'
import ObjectPropertiesPanel from './ObjectPropertiesPanel.vue'
import PassThroughPanel from './PassThroughPanel.vue'
import PropPickerDialog from './PropPickerDialog.vue'
import SaveConfirmDialog from './SaveConfirmDialog.vue'
import SaveTemplateDialog from './SaveTemplateDialog.vue'
import SceneRenderChainDialog from './SceneRenderChainDialog.vue'
import SceneTemplatePickerDialog from './SceneTemplatePickerDialog.vue'
import ScreenEffectPickerDialog from './ScreenEffectPickerDialog.vue'
import ExpressionSelectorDialog from './screenplay/ExpressionSelectorDialog.vue'
import SoundPickerDialog from './SoundPickerDialog.vue'
import ZoomControls from './ZoomControls.vue'

const props = defineProps<{
  episode: Episode | undefined
  sceneId: string
}>()

const emit = defineEmits<{
  exitSceneEdit: []
  saveSetup: [sceneId: string, setup: SceneSetup]
}>()

const projectStore = useProjectStore()
const episodeStore = useEpisodeStore()
const sceneObjectStore = useSceneObjectStore()
const isDev = import.meta.env.DEV

const toast = useToast()

// Canvas container element
const canvasContainer = ref<HTMLElement>()
const setupEditorContainer = ref<HTMLElement>()

// Save toast status
const showSaveToast = ref(false)
const saveToastMessage = ref('')
const saveToastType = ref<'success' | 'error'>('success')

// Current scene title
const currentSceneTitle = computed(() => {
  if (props.sceneId && props.episode) {
    const scene = props.episode.scenes.find((s) => s.id === props.sceneId)
    return scene ? scene.title : 'Untitled Scene'
  }
  return 'Untitled Scene'
})

// ===== Scene-specific: Save logic =====
async function handleSaveSetup(): Promise<void> {
  if (!props.sceneId || !props.episode) {
    console.error('[SetupEditor] Save requires sceneId and episode')
    return
  }

  const setup = collectSetupFromSceneObjects()
  const episodeId = props.episode.id

  episodeStore.updateScene(episodeId, props.sceneId, { setup })

  try {
    await projectStore.saveProject()
    workspace.resetLocalChanges()
    toast.success('Saved successfully')
  } catch (error) {
    console.error('[SetupEditor] Save failed:', error)
    toast.error('Failed to save: ' + ((error as Error).message || 'Unknown error'))
  }
}

// ===== Initialize composable =====
const workspace = useSetupWorkspace({
  canvasContainer,
  editorContainer: setupEditorContainer,
  rendererExtras: {
    episodeId: props.episode?.id ?? '',
    sceneId: props.sceneId,
    blockId: null,
  },
  onDataChange: () => projectStore.markAsUnsaved(),
  onSave: handleSaveSetup,
  onExit: () => emit('exitSceneEdit'),
})

// Destructure all needed template variables from composable
const {
  renderer,
  hasLocalChanges,
  rightPanelCollapsed,
  rightPanelWidth,

  startResizeRightPanel,
  handleSelectObject,
  handleUpdateObject,
  handleDeleteObject,
  handleCopyObject,
  handleMoveUp,
  handleMoveDown,
  handleInitialStateUpdate,
  showBackgroundPicker,
  showPropPicker,
  showSoundPicker,
  showScreenEffectPicker,
  showTemplatePicker,
  showLightPicker,
  showAddMenu,
  toggleAddMenu,
  handleMenuItemClick,
  handleLightSelect,
  handleBackgroundSelect,
  handlePropSelect,
  handleSoundSelect,
  handleScreenEffectSelect,
  handleTemplateSelect,
  handleExpressionSelect,
  showExpressionPicker,
  showCharacterPicker,
  handleCompositeCharacterSelect,
  showActorPicker,
  handleActorSelect,
  groupingState,

  getCompositeDisplayName,
  handleStartGrouping,
  handleCompositeAction,
  handleCanvasClickForGrouping,
  handleGroupingConfirm,
  handleGroupingCancel,
  handleGroupingToggleById,
  groupingEligibleObjects,
  lockedParentId,
  showAliasDialog,
  aliasDialogActorName,
  aliasDialogSuggestedAlias,
  aliasDialogCurrentAlias,
  aliasDialogObjectType,
  existingAliases,
  handleAliasConfirm,
  handleAliasCancel,
  handleEditAlias,
  handleTriggerAnim,
  showPassThroughTip,
  addToPassThrough,
  removeFromPassThrough,
  togglePassThroughVisible,
  getPassThroughEntries,
  isObjectPassThrough,
  isFullscreen,
  toggleFullscreen,
  showConfirmDialog,
  confirmDialogConfig,
  showSaveConfirmDialog,
  handleReturn,
  handleSaveAndExit,
  handleDiscardAndExit,
  initCanvas,
  destroyCanvas,
  setupWatchers,
  setupEventListeners,
  cleanupEventListeners,
} = workspace

// actorCharacterIds is no longer needed — ActorPickerDialog directly retrieves data from projectStore.actors

// v17: Save as scene template
const showSaveTemplateDialog = ref(false)
const selectedCompositeMode = ref<'entity' | 'union'>('union')

// ===== Pass-through list UI state =====
const showPassThroughPanel = ref(false)
const showRenderChainDialog = ref(false)

const passThroughCount = computed(() => {
  return getPassThroughEntries().size
})

const passThroughPanelEntries = computed(() => {
  const entries = getPassThroughEntries()
  const result: { objectId: string; name: string; icon: string; visible: boolean; isDefault: boolean }[] = []
  for (const [objectId, entry] of entries) {
    const obj = sceneObjectStore.getObject(objectId)
    if (obj) {
      result.push({
        objectId,
        name: obj.alias ?? obj.name ?? objectId,
        icon: getTypeIcon(obj.type),
        visible: entry.visible,
        isDefault: obj.type === 'camera' || (
          obj.type === 'light'
          && (obj as import('@/types/sceneObject').LightObject).lightType === 'ambient'
        ),
      })
    }
  }
  return result
})

const selectedObjectIsPassThrough = computed(() => {
  const selected = sceneObjectStore.getSelectedObject()
  if (!selected) return false
  return isObjectPassThrough(selected.id)
})

const selectedObjectPassThroughVisible = computed(() => {
  const selected = sceneObjectStore.getSelectedObject()
  if (!selected) return true
  const entries = getPassThroughEntries()
  const entry = entries.get(selected.id)
  return entry?.visible ?? true
})

function handlePassThroughToggle(objectId: string) {
  if (isObjectPassThrough(objectId)) {
    removeFromPassThrough(objectId)
  } else {
    addToPassThrough(objectId)
  }
}
const nonCameraObjects = computed(() => sceneObjectStore.objects.filter(o => o.type !== 'camera' && o.spawned !== false))
const propertyPanelTitle = computed(() => 'Properties')

function handleTemplateSaved(_templateId: string) {
  showSaveTemplateDialog.value = false
}

// Clip-Mask Phase 1: Callback when "Clip Mask" group is selected in visual effect dialog,
// routes through handleMenuItemClick to reuse existing mask creation path.
function handleMaskFromDialog(shape: 'rectangle' | 'ellipse') {
  showScreenEffectPicker.value = false
  handleMenuItemClick(shape === 'ellipse' ? 'mask_ellipse' : 'mask_rectangle')
}

// ===== Lifecycle =====

onMounted(async () => {
  sceneObjectStore.setActionMode(false)
  let initialSetup: SceneSetup | null = null

  if (props.sceneId && props.episode) {
    const scene = props.episode.scenes.find((s) => s.id === props.sceneId)
    if (scene) {
      loadSetupToSceneObjects(scene.setup)
      initialSetup = scene.setup
      logSetupState(scene.setup)
    } else {
      const defaultSetup = {
        camera: {
          x: CANVAS_CENTER_X,
          y: CANVAS_CENTER_Y,
          width: CAMERA_BASE_WIDTH,
          height: CAMERA_BASE_HEIGHT,
          zoom: 1.0,
        },
        objects: [],
        renderChain: [],
      }
      initialSetup = defaultSetup
      loadSetupToSceneObjects(defaultSetup)
    }
  }

  await initCanvas()

  if (initialSetup) {
    const { collectEditorFirstPaintAssets, loadAssets } = useAssetLoader()
    const { imageUrls, audioUrls } = collectEditorFirstPaintAssets(initialSetup, null)
    if (imageUrls.size > 0 || audioUrls.size > 0) {
      await loadAssets(imageUrls, audioUrls, `SetupEditor.sceneAssets(${props.sceneId ?? 'default'})`)
    }
  }

  if (renderer.value) {
    await renderer.value.renderObjects()
  }
  setupWatchers()
  setupEventListeners()
})

onBeforeUnmount(() => {
  cleanupEventListeners()
  destroyCanvas()
  sceneObjectStore.clearObjects()
})

// ===== Scene-specific: Logging =====

function logSetupState(setup: SceneSetup): void {
  const header = `\n========== Setup Mode Initial State ==========\nScene: ${props.sceneId}`
  logService.addLog(header)

  if (setup.camera) {
    const log = `📷 Camera [Setup]: x=${setup.camera.x.toFixed(1)}, y=${setup.camera.y.toFixed(1)}, zoom=${setup.camera.zoom?.toFixed(2) ?? 1.0}`
    logService.addLog(log)
  }

  for (const obj of setup.objects) {
    const typeIcon = getTypeIcon(obj.type)
    const name = obj.alias || obj.refId

    const log = `${typeIcon} ${name} [Setup]: x=${obj.x.toFixed(1)}, y=${obj.y.toFixed(1)}, scale=${obj.scaleX.toFixed(2)}, z=${obj.zIndex}`



    logService.addLog(log)
  }

  logService.addLog('================================================\n')
}
</script>

<style scoped>
.setup-editor {
  display: flex;
  height: 100%;  /* v6.10: Fills parent container in Overlay mode */
  background: #f9fafb;
}

.pass-through-tip-bubble {
  position: absolute;
  top: 125%;
  left: 50%;
  transform: translateX(-50%);
  background-color: #3b82f6;
  color: white;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 100;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  animation: bounceTip 1.5s infinite;
}
.pass-through-tip-bubble::after {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-width: 5px;
  border-style: solid;
  border-color: transparent transparent #3b82f6 transparent;
}
@keyframes bounceTip {
  0%, 100% { transform: translate(-50%, 0); }
  50% { transform: translate(-50%, -4px); }
}

.left-panel {
  flex-shrink: 0;
  background: white;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  background: #f9fafb;
}

.panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}

/* v11.0: Tab switcher styles */
.panel-tabs {
  display: flex;
  gap: 4px;
  flex: 1;
  margin-left: 8px;
}

.panel-tab {
  flex: 1;
  padding: 6px 8px;
  font-size: 12px;
  border: none;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
  white-space: nowrap;
}

.panel-tab:hover {
  background: #e5e7eb;
  color: #374151;
}

.panel-tab.active {
  background: #3b82f6;
  color: white;
}

.collapse-btn {
  padding: 4px 8px;
  font-size: 12px;
  border: none;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
}

.collapse-btn:hover {
  background: #e5e7eb;
  color: #374151;
}

.expand-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  padding: 8px 6px;
  font-size: 12px;
  border: 1px solid #e5e7eb;
  background: white;
  color: #6b7280;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.expand-btn:hover {
  background: #f3f4f6;
  color: #374151;
}

.expand-btn.left {
  left: 8px;
}

.expand-btn.right {
  right: 8px;
}

.resizer {
  width: 4px;
  background: transparent;
  cursor: col-resize;
  flex-shrink: 0;
  position: relative;
  transition: background 0.2s;
}

.resizer:hover {
  background: #3b82f6;
}

.left-resizer::before,
.right-resizer::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  left: -2px;
}

.left-panel > :not(.panel-header) {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.canvas-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
  min-width: 0;
  position: relative; /* P2: Positioning context for grouping mode floating toolbar */
}

.setup-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.add-menu-container {
  position: relative;
}

.add-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  min-width: 160px;
  overflow: hidden;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 16px;
  font-size: 13px;
  background: white;
  border: none;
  color: #374151;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.menu-item:hover {
  background: #f3f4f6;
}

.menu-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}

.scene-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #374151;
}

.mode-icon {
  font-size: 16px;
}

.mode-label {
  font-weight: 500;
  color: #6b7280;
}

.scene-name {
  font-weight: 600;
  color: #111827;
}

.mouse-position {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #6b7280;
  min-width: 160px;
}

.save-status {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  background: #dcfce7;
  color: #166534;
  font-weight: 500;
}

.save-status.unsaved {
  background: #fef3c7;
  color: #92400e;
}

.toolbar-btn {
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  color: #374151;
  cursor: pointer;
  transition: all 0.2s;
}

.toolbar-btn.icon-only {
  padding: 6px 10px;
  font-size: 16px;
  min-width: 36px;
}

.toolbar-btn:hover:not(:disabled) {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toolbar-btn.primary {
  background: #3b82f6;
  border-color: #3b82f6;
  color: white;
}

.toolbar-btn.primary:hover:not(:disabled) {
  background: #2563eb;
  border-color: #2563eb;
}

.toolbar-btn.danger {
  color: #dc2626;
}

.toolbar-btn.danger:hover:not(:disabled) {
  background: #fef2f2;
  border-color: #fca5a5;
}

.canvas-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #1a1a1a;
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
}

.right-panel {
  flex-shrink: 0;
  background: white;
  border-left: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
}

.right-panel > :not(.panel-header) {
  flex: 1;
  overflow-y: auto;
}

.setup-editor:fullscreen {
  height: 100vh;
}

.setup-editor:fullscreen .canvas-area {
  height: 100%;
}

:deep(canvas) {
  display: block;
  flex-shrink: 0;
  margin: 0 auto;
}

.toolbar-btn.add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  color: #3b82f6;
  background: #eff6ff;
  border-color: #bfdbfe;
}

.toolbar-btn.add-btn:hover {
  background: #dbeafe;
  border-color: #93c5fd;
}

.btn-icon {
  font-size: 16px;
  font-weight: bold;
  line-height: 1;
}

.btn-text {
  font-size: 13px;
  font-weight: 500;
}

.save-toast {
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10000;
  min-width: 200px;
  justify-content: center;
}

.save-toast.success {
  background: #10b981;
  color: white;
}

.save-toast.error {
  background: #ef4444;
  color: white;
}

.toast-icon {
  font-size: 18px;
  font-weight: bold;
}

.toast-message {
  font-size: 14px;
}

.toast-enter-active {
  animation: toast-in 0.3s ease-out;
}

.toast-leave-active {
  animation: toast-out 0.3s ease-in;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

@keyframes toast-out {
  from {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
  to {
    opacity: 0;
    transform: translateX(-50%) translateY(-20px);
  }
}

/* Grouping mode CSS moved to GroupingModePanel.vue */
</style>
