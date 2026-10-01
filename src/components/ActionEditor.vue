<template>
  <div
    ref="actionEditorContainer"
    class="action-editor"
  >

    <!-- Center: Canvas Area -->
    <main class="canvas-area">
      <!-- Top Toolbar -->
      <div class="action-toolbar">
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
            ({{ currentMousePos.x }}, {{ currentMousePos.y }})
          </span>
          <div class="scene-title">
            <span class="mode-icon">🎬</span>
            <span class="block-description" :title="currentBlockDescription">{{ truncatedBlockDescription }}</span>
            <button 
              class="edit-text-btn" 
              title="Edit Text" 
              @click="openTextEditDialog"
            >
              ✏️
            </button>
          </div>
        </div>
        
        <!-- v9.2: Right Toolbar (consistent with Setup mode layout) -->
        <div class="toolbar-right">
          <!-- Add Asset -->
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
                @click="handleAddMenuItemClick('backgrounds')"
              >
                <span class="menu-icon">🖼️</span>
                <span>Background</span>
              </button>
              <button
                class="menu-item"
                @click="handleAddMenuItemClick('props')"
              >
                <span class="menu-icon">📦</span>
                <span>Prop</span>
              </button>
              <button
                class="menu-item"
                @click="handleAddMenuItemClick('sounds')"
              >
                <span class="menu-icon">🔊</span>
                <span>Sound</span>
              </button>
              <button
                class="menu-item"
                @click="handleAddMenuItemClick('screen_effects')"
              >
                <span class="menu-icon">🌟</span>
                <span>Visual Effect</span>
              </button>
              <button
                class="menu-item"
                @click="handleAddMenuItemClick('symbol')"
              >
                <span class="menu-icon">🔧</span>
                <span>Symbol</span>
              </button>
              <button
                class="menu-item"
                @click="handleAddMenuItemClick('expression')"
              >
                <span class="menu-icon">😀</span>
                <span>Expression</span>
              </button>
              <button
                class="menu-item"
                @click="handleAddMenuItemClick('scene_templates')"
              >
                <span class="menu-icon">🧩</span>
                <span>Scene Template</span>
              </button>
              <button
                class="menu-item"
                @click="handleAddMenuItemClick('actors')"
              >
                <span class="menu-icon">🎭</span>
                <span>Actor</span>
              </button>
              <button
                class="menu-item"
                @click="handleAddMenuItemClick('characters')"
              >
                <span class="menu-icon">👤</span>
                <span>Character</span>
              </button>
              <button
                class="menu-item"
                @click="handleAddMenuItemClick('light')"
              >
                <span class="menu-icon">💡</span>
                <span>Light</span>
              </button>
              <button
                class="menu-item"
                @click="handleAddMenuItemClick('text')"
              >
                <span class="menu-icon">📝</span>
                <span>Text</span>
              </button>
            </div>
          </div>
          <!-- Duplicate Button -->
          <button 
            class="toolbar-btn icon-only" 
            title="Duplicate Selected Object" 
            :disabled="!canCopySelectedObject"
            @click="handleCopyObject"
          >
            ❐
          </button>
          <!-- P2: Group Button -->
          <button
            class="toolbar-btn icon-only"
            title="Group"
            :disabled="!canCopySelectedObject"
            @click="handleStartGrouping"
          >
            🔗
          </button>
          <!-- v17: Save as Scene Template -->
          <button
            class="toolbar-btn icon-only"
            title="Save as Scene Template"
            :disabled="aliveNonCameraObjects.length === 0"
            @click="showSaveTemplateDialog = true"
          >
            🧩
          </button>
          <!-- Delete Button -->
          <button 
            class="toolbar-btn danger icon-only" 
            title="Delete Selected Object"
            :disabled="!canDeleteSelectedObject"
            @click="handleDeleteDynamicObject"
          >
            🗑️
          </button>
          <!-- Preview -->
          <button 
            class="toolbar-btn preview-btn icon-only" 
            title="Preview" 
            @click="handlePreview"
          >
            👁️
          </button>
          <!-- Save -->
          <button 
            class="toolbar-btn primary icon-only" 
            title="Save" 
            @click="handleSaveAction"
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
              Camera is in pass-through mode, click to manage
            </div>
            <PassThroughPanel
              v-if="showPassThroughPanel"
              :entries="passThroughPanelEntries"
              @remove="handleRemoveFromPassThrough"
              @toggle-visible="handleTogglePassThroughVisible"
              @select-object="handleSelectObject"
              @close="showPassThroughPanel = false"
            />
          </div>
          <!-- Fullscreen -->
          <button 
            class="toolbar-btn icon-only" 
            :title="isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'" 
            @click="toggleFullscreen"
          >
            {{ isFullscreen ? '⛶' : '⛶' }}
          </button>
        </div>
      </div>

      <!-- P2: Group Mode Floating Bar -->
      <GroupingModePanel
        v-if="actionGroupingState"
        v-model:composite-mode="selectedCompositeMode"
        :mode="actionGroupingState.mode === 'create' ? 'create' : 'addTo'"
        :composite-name="actionGroupingState.mode === 'addTo' ? getCompositeDisplayName(actionGroupingState.compositeId) : undefined"
        :pending-ids="actionGroupingState.pendingIds"
        :tree-nodes="actionGroupingTreeNodes"
        :locked-parent-id="lockedGroupingParentId"
        :hide-composite-mode="true"
        @toggle="handleGroupingToggleById"
        @confirm="handleGroupingConfirm"
        @cancel="handleGroupingCancel"
      />

      <!-- Canvas Container -->
      <div 
        ref="canvasContainer" 
        class="canvas-container recording-mode"
        @mousemove="handleMouseMove"
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

      <!-- Bottom Action Sequencer -->
      <ActionSequencer
        v-if="currentBlock"
        :block="currentBlock"
        :actions="currentBlockActions"
        :current-slot-index="currentSlotIndex"
        :selected-action-id="selectedAction?.id ?? null"
        :selected-object-id="sceneObjectStore.selectedObjectId"

        @update:current-slot-index="handleSlotIndexChange"
        @select-action="handleSelectAction"
        @select-object="handleSelectObject"
        @update-action="handleUpdateActionFromSequencer"
        @delete-action="handleDeleteActionFromSequencer"
        @reorder-actions="handleReorderActionsInSlot"
        @reset-action-order="handleResetActionOrderInSlot"
        @add-action="handleAddActionFromSequencer"
        @collapse-change="handleSequencerCollapseChange"
      />
    </main>

    <!-- Right Divider -->
    <div 
      v-show="!rightPanelCollapsed"
      class="resizer right-resizer" 
      @mousedown="startResizeRightPanel"
    />

    <!-- Right Collapse Button -->
    <button
      v-show="rightPanelCollapsed"
      class="expand-btn right"
      title="Expand Panel"
      @click="rightPanelCollapsed = false"
    >
      ◀
    </button>

    <!-- Right: Properties Panel -->
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
        <!-- Header shown when no action selected -->
        <template v-if="!selectedAction">
          <h3>Properties</h3>
        </template>
        <template v-else>
          <h3>Action Properties</h3>
        </template>
      </div>
      
      <!-- Show ActionInspector when action selected -->
      <ActionInspector
        v-if="selectedAction"
        :action="selectedAction"
        :block-duration="currentBlockDuration"
        :slots="currentBlockSlots"
        :focus-field="actionFocusField"
        :alive-object-ids="aliveObjectIds"
        :episode-id="props.episode?.id"
        :scene-id="props.sceneId"
        @update="handleActionInspectorUpdate"
        @delete="handleActionInspectorDelete"
      />
      <!-- Show properties panel when no action selected -->
      <template v-else>
        <!-- Properties panel -->
        <ObjectPropertiesPanel
          :selected-object="sceneObjectStore?.getSelectedObject()"
          :object-record-mode="objectRecordMode"
          :runtime-state="null"
          :canvas-width="renderer?.canvasSize?.width ?? 1920"
          :canvas-height="renderer?.canvasSize?.height ?? 1080"
          :is-action-mode="true"
          :current-slot-index="currentSlotIndex"
          :current-slot-text="currentSlotText"
          :camera-record-mode="cameraRecordMode"
          :current-camera-action="currentSlotCameraAction"
          :current-slot-has-shake="currentSlotHasShake"
          :alive-object-ids="aliveObjectIds"
          :is-pass-through="selectedObjectIsPassThrough"
          :pass-through-visible="selectedObjectPassThroughVisible"
          :persist-changes="handleSaveActionAsync"

          @update="handleObjectUpdateInActionMode"
          @initial-state-update="handleInitialStateUpdate"
          @move-up="handleMoveUp"
          @move-down="handleMoveDown"
          @trigger-anim="handleTriggerAnim"
          @camera-record-mode-change="handleCameraRecordModeChange"
          @camera-action-update="handleCameraActionFromPanel"
          @trigger-audio="handleTriggerAudio"
          @trigger-text-reveal="handleTriggerTextReveal"

          @select-object="handleSelectObject"
          @record-mode-change="handleObjectRecordModeChange"
          @visual-action-update="handleVisualActionUpdate"
          @material-action-update="handleMaterialActionUpdate"
          @material-save="handleMaterialSave"
          @animations-updated="handleAnimationsUpdated"
          @edit-alias="handleEditAlias"
          @composite-action="handleCompositeAction"
          @pass-through-toggle="handlePassThroughToggle"
          @pass-through-visible-toggle="handleTogglePassThroughVisible"
        />
      </template>
    </aside>

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
    
    <!-- Save confirmation dialog -->
    <SaveConfirmDialog
      v-if="showSaveConfirmDialog"
      title="Save Changes"
      message="There are unsaved changes. What would you like to do?"
      @save-and-exit="handleSaveAndExit"
      @discard="handleDiscardAndExit"
      @cancel="showSaveConfirmDialog = false"
    />
    
    <!-- Action preview dialog -->
    <ActionPreviewDialog
      v-if="showPreviewDialog && episode"
      :visible="showPreviewDialog"
      :episode-id="episode.id"
      :scene-id="sceneId"
      :block-id="blockId"
      :episode="episode"
      @close="showPreviewDialog = false"
    />

    <!-- Save Toast -->
    <SceneRenderChainDialog
      v-if="showRenderChainDialog"
      mode-description="Runtime objects"
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

    <!-- v8.3: Text edit dialog -->
    <div v-if="showTextEditDialog" class="text-edit-dialog-overlay" @click.self="showTextEditDialog = false">
      <div class="text-edit-dialog">
        <div class="dialog-header">
          <span>Edit Text</span>
          <button class="close-btn" @click="showTextEditDialog = false">×</button>
        </div>
        <div class="dialog-body">
          <textarea v-model="editingText" class="text-edit-textarea" rows="5" />
        </div>
        <div class="dialog-footer">
          <button class="cancel-btn" @click="showTextEditDialog = false">Cancel</button>
          <button class="confirm-btn" @click="saveEditedText">Confirm</button>
        </div>
      </div>
    </div>


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
    <SoundPickerDialog
      v-if="showSoundPicker"
      @select="handleSoundSelect"
      @close="showSoundPicker = false"
    />
    <ScreenEffectPickerDialog
      v-if="showScreenEffectPicker"
      @select="handleScreenEffectSelect"
      @select-mask="handleAddMaskFromDialog"
      @close="showScreenEffectPicker = false"
    />
    <LightPickerDialog
      v-if="showLightPicker"
      @select="handleLightSelect"
      @close="showLightPicker = false"
    />
    <ExpressionSelectorDialog
      v-if="showExpressionPicker"
      @select="handleExpressionSelect"
      @close="showExpressionPicker = false"
    />
    <SceneTemplatePickerDialog
      v-if="showTemplatePicker"
      @select="handleTemplateSelect"
      @close="showTemplatePicker = false"
    />

    <!-- Actor selector dialog -->
    <ActorPickerDialog
      v-if="showActorPicker"
      @select="handleActorSelect"
      @close="showActorPicker = false"
    />

    <!-- Character selector dialog -->
    <CompositeCharacterPickerDialog
      v-if="showCharacterPicker"
      @select="handleCharacterSelect"
      @close="showCharacterPicker = false"
    />

    <!-- v17: Save as scene template dialog -->
    <SaveTemplateDialog
      v-if="showSaveTemplateDialog"
      :visible="showSaveTemplateDialog"
      :initial-selected-object-id="sceneObjectStore.getSelectedObject()?.id"
      :all-scene-objects="aliveNonCameraObjects"
      @cancel="showSaveTemplateDialog = false"
      @saved="handleSaveTemplateSaved"
    />

    <!-- Instance alias edit dialog -->
    <InstanceAliasDialog
      v-if="showAliasDialog"
      :actor-name="aliasDialogActorName"
      :suggested-alias="aliasDialogSuggestedAlias"
      :existing-aliases="existingAliases"
      :current-alias="aliasDialogCurrentAlias"
      :object-type="aliasDialogObjectType"
      @confirm="handleAliasConfirm"
      @cancel="handleAliasCancel"
    />

  </div>
</template>

<script setup lang="ts">
import * as PIXI from 'pixi.js'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { type ActionUpdatePayload, useSceneRenderer } from '@/composables/useSceneRenderer'
import { useToast } from '@/composables/useToast'
import { CAMERA_BASE_HEIGHT,CAMERA_BASE_WIDTH, CANVAS_CENTER_X, CANVAS_CENTER_Y, CANVAS_HEIGHT, CANVAS_WIDTH } from '@/constants/canvas'
import { Z_INDEX_SCREEN_EFFECT, Z_INDEX_TEXT } from '@/constants/zIndex'
import { getTypeIcon } from '@/core/sceneObjectProviders/metadata'
import { logService } from '@/services/LogService'
import { useAnimationStore } from '@/stores/animationStore'
import { useBackgroundStore } from '@/stores/backgroundStore'  // v7.1: Used to get background name
import type { Episode } from '@/stores/episodeStore'
import { useEpisodeStore } from '@/stores/episodeStore'
import { useExpressionStore } from '@/stores/expressionStore'
import { useProjectStore } from '@/stores/projectStore'
// P2: usePropStore is no longer needed (object loading delegated by fromSetupObject)
import type { AudioObject, CameraObject } from '@/stores/sceneObjectStore'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
// v7.3: useEffectStore removed
import { useSoundStore } from '@/stores/soundStore'
import type { AnimationTimingMode } from '@/types/animation'
import type { CompositeCharacter } from '@/types/compositeCharacter'
// Phase 4e: ObjectStateSnapshot replaced by SceneObject
import type { SceneObject as ActionRuntimeState } from '@/types/sceneObject'
import type { LightObject,MaskObject,ScreenEffectObject, ScreenEffectPreset, SymbolMaterial, TextObject } from '@/types/sceneObject'
import type { CompositeExtraInfo } from '@/types/sceneObject'
import type { SceneTemplate } from '@/types/sceneTemplate'
import type { 
  Action, 
  BaseDurationAction, 
  CameraCutAction, 
  CameraMoveAction, 
  SceneContainer, 
  SceneObject, 
  SceneSetup, 
  SceneStructureOperation,
  ScriptBlock, 
  SetAnimAction,
  SetLifecycleAction,
  SetMaskAction,
  SetMaterialAction,
  SetSceneStructureAction,
  SetTransformAction, 
  SetVisualAction, 
  TweenTransformAction 
} from '@/types/screenplay'
import { SCENE_ACTION_TARGET } from '@/types/screenplay'
import { 
  evaluateCameraStateBySlot,
  evaluateObjectStateBySlot,
  type RuntimeCameraState, 
} from '@/utils/actionEvaluator'
import { localToGlobal } from '@/utils/actionHandlers/matrixUtils'
import type { WriteableState } from '@/utils/actionHandlers/types'
// v9.3: Determine spawn action
import { isBirthAction } from '@/utils/actionHelpers'
import {
  getActionOrderModeForSlot,
  hasCustomActionOrderForSlot,
  reconcileActionOrderForSlot,
} from '@/utils/actionOrder'
import { getActorByCharacterId } from '@/utils/actorUtils'
import {
  findCameraConflict,
  findUpsertableCameraAction,
  isCameraActionType,
  isCameraFollowAction,
  isCameraPositionAction,
} from '@/utils/cameraActionRules'
import { applyMeasuredDefaultSize } from '@/utils/sceneObjectDefaultSize'
import { calculatePrevContext } from '@/utils/sceneStateCalculator'
import { instantiateTemplate, snapshotToTemplate } from '@/utils/sceneTemplateEngine'
// v9.1: Shadow Object dynamic object creation
import { createShadowObject } from '@/utils/shadowObject'
import { detectSlotTextChanges, migrateActionsOnSlotDelete, migrateActionsOnSlotInsert, parseBlockToSlots } from '@/utils/slotUtils'
import { 
  getObjectRuntimeState, 
  getTargetAliasFromObject,
} from '@/utils/stateUtils'
import { generateId } from '@/utils/uuid'

import ActionInspector from './ActionInspector.vue'
import ActionPreviewDialog from './ActionPreviewDialog.vue'
import ActionSequencer from './ActionSequencer.vue'
import ActorPickerDialog from './ActorPickerDialog.vue'
// v9.1: Add asset Picker component
import BackgroundPickerDialog from './BackgroundPickerDialog.vue'
import CanvasScrollbars from './CanvasScrollbars.vue'
import CompositeCharacterPickerDialog from './CompositeCharacterPickerDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import GroupingModePanel from './GroupingModePanel.vue'
import type { GroupingTreeNode } from './groupingTypes'
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
  blockId: string
}>()

const emit = defineEmits<{
  exitSceneEdit: []
}>()

const route = useRoute()
const projectStore = useProjectStore()
const episodeStore = useEpisodeStore()
const sceneObjectStore = useSceneObjectStore()
const isDev = import.meta.env.DEV
const backgroundStore = useBackgroundStore()  // v7.1: Used to get background name
// v7.3: effectStore removed
// P2: propStore is no longer used directly (object loading delegated by fromSetupObject)
const soundStore = useSoundStore()
const canvasContainer = ref<HTMLElement>()
const actionEditorContainer = ref<HTMLElement>()

// Scene renderer
const renderer = ref<ReturnType<typeof useSceneRenderer> | null>(null)

// Current mouse position (Canvas Physical Coordinates)
const currentMousePos = ref({ x: 0, y: 0 })

function handleMouseMove(event: MouseEvent) {
  if (!renderer.value) return
  
  const canvasElement = renderer.value.getPixiApp().canvasElement
  if (!canvasElement) return
  
  const rect = canvasElement.getBoundingClientRect()
  const canvasX = event.clientX - rect.left
  const canvasY = event.clientY - rect.top
  
  const worldPos = renderer.value.canvasToWorld(canvasX, canvasY)
  
  currentMousePos.value = {
    x: Math.round(worldPos.x),
    y: Math.round(worldPos.y)
  }
}

// Confirmation dialog state
const showConfirmDialog = ref(false)
const confirmDialogConfig = ref({
  title: 'Confirm',
  message: '',
  confirmText: 'OK',
  cancelText: 'Cancel',
  isDanger: false,
  showSecondaryConfirm: false,
  secondaryConfirmText: '',
  onConfirm: () => { /* empty */ },
  onSecondaryConfirm: () => { /* empty */ },
})

// v9.1: Add asset menu state
const showAddMenu = ref(false)

const showBackgroundPicker = ref(false)
const showPropPicker = ref(false)
const showSoundPicker = ref(false)
const showScreenEffectPicker = ref(false)
const showTemplatePicker = ref(false)
const showExpressionPicker = ref(false)
const showActorPicker = ref(false)
const showLightPicker = ref(false)
const showCharacterPicker = ref(false)

// Actor-associated characterId list (used for actor picker dialog includeIds)
// actorCharacterIds no longer needed — ActorPickerDialog gets data directly from projectStore.actors

// Through-list management
const showPassThroughTip = ref(true)
const showPassThroughPanel = ref(false)
const showRenderChainDialog = ref(false)

function addToPassThrough(objectId: string): void {
  if (renderer.value) {
    renderer.value.getSceneGraph().addPassThrough(objectId)
    void renderer.value.renderObjects()
  }
}

function handleRemoveFromPassThrough(objectId: string): void {
  if (renderer.value) {
    renderer.value.getSceneGraph().removePassThrough(objectId)
    void renderer.value.renderObjects()
  }
}

function handleTogglePassThroughVisible(objectId: string): void {
  if (renderer.value) {
    const sceneGraph = renderer.value.getSceneGraph()
    const entry = sceneGraph.getPassThroughEntry(objectId)
    if (entry) {
      sceneGraph.setPassThroughVisible(objectId, !entry.visible)
      void renderer.value.renderObjects()
    }
  }
}

function isObjectPassThrough(objectId: string): boolean {
  if (renderer.value) {
    return renderer.value.getSceneGraph().isPassThrough(objectId)
  }
  return false
}

const passThroughCount = computed(() => {
  if (!renderer.value) return 0
  return renderer.value.getSceneGraph().getPassThroughEntries().size
})

const passThroughPanelEntries = computed(() => {
  if (!renderer.value) return []
  const entries = renderer.value.getSceneGraph().getPassThroughEntries()
  const result: { objectId: string; name: string; icon: string; visible: boolean; isDefault: boolean }[] = []
  for (const [objectId, entry] of entries) {
    const obj = sceneObjectStore.getObject(objectId)
    if (obj) {
      result.push({
        objectId,
        name: obj.alias ?? obj.name ?? objectId,
        icon: getTypeIcon(obj.type),
        visible: entry.visible,
        isDefault: obj.type === 'camera',
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
  if (!renderer.value) return true
  const entry = renderer.value.getSceneGraph().getPassThroughEntry(selected.id)
  return entry?.visible ?? true
})

function handlePassThroughToggle(objectId: string) {
  if (isObjectPassThrough(objectId)) {
    handleRemoveFromPassThrough(objectId)
  } else {
    addToPassThrough(objectId)
  }
}

// Alias editing dialog state
const showAliasDialog = ref(false)
const editingAliasObjectId = ref<string | null>(null)

const aliasDialogActorName = computed(() => {
  if (!editingAliasObjectId.value) return ''
  const obj = sceneObjectStore.getObject(editingAliasObjectId.value)
  if (!obj) return ''
  if (obj.type === 'background') {
    const bgObj = obj as unknown as { refId: string }
    const bg = backgroundStore.getBackground(bgObj.refId)
    return bg?.name || obj.name || 'Background'
  } else if (obj.type === 'audio') {
    const audioObj = obj as unknown as { refId: string }
    const sound = soundStore.getSound(audioObj.refId)
    return sound?.name || obj.name || 'Sound'
  }
  return obj.name || 'Untitled'
})

const aliasDialogSuggestedAlias = computed(() => {
  if (!editingAliasObjectId.value) return ''
  const obj = sceneObjectStore.getObject(editingAliasObjectId.value)
  return obj?.alias || obj?.name || ''
})

const aliasDialogCurrentAlias = computed(() => {
  if (!editingAliasObjectId.value) return ''
  const obj = sceneObjectStore.getObject(editingAliasObjectId.value)
  return obj?.alias || ''
})

const aliasDialogObjectType = computed(() => {
  if (!editingAliasObjectId.value) return 'prop' as const
  const obj = sceneObjectStore.getObject(editingAliasObjectId.value)
  return (obj?.type || 'prop') as 'background' | 'bgm' | 'prop' | 'text'
})

const existingAliases = computed(() => {
  // v17: Namespace aware — collect alias based on namespace where edited object resides
  const nsRoot = editingAliasObjectId.value
    ? sceneObjectStore.resolveNamespaceRoot(editingAliasObjectId.value)
    : null
  return sceneObjectStore.getExistingAliases(nsRoot)
})

function handleEditAlias(objectId: string) {
  const obj = sceneObjectStore.getObject(objectId)
  if (!obj || obj.type === 'camera') return
  editingAliasObjectId.value = objectId
  showAliasDialog.value = true
}

async function handleAliasConfirm(alias: string) {
  if (!editingAliasObjectId.value) {
    showAliasDialog.value = false
    return
  }
  
  const obj = sceneObjectStore.getObject(editingAliasObjectId.value)
  if (obj && obj.type !== 'camera') {
    const selectedObjectIdBeforeUpdate = sceneObjectStore.selectedObjectId
    // v24: Write setupState + runtimeState + episode simultaneously via updateSetupObject
    sceneObjectStore.updateSetupObject(obj.id, {
      alias: alias
    } as unknown as Partial<SceneObject>)
    if (selectedObjectIdBeforeUpdate === obj.id) {
      sceneObjectStore.selectObject(obj.id)
    }
    await refreshGhostRealStates()
    
    markLocalChange()
  }
  
  editingAliasObjectId.value = null
  showAliasDialog.value = false
}

function handleAliasCancel() {
  editingAliasObjectId.value = null
  showAliasDialog.value = false
}

// v9.1: Toggle add asset menu visibility
function toggleAddMenu() {
  showAddMenu.value = !showAddMenu.value
}

// v9.1: Handle add asset menu item click
function handleAddMenuItemClick(type: string) {
  showAddMenu.value = false
  
  switch(type) {    case 'backgrounds':
      showBackgroundPicker.value = true
      break
    case 'props':
      showPropPicker.value = true
      break
    case 'sounds':
      showSoundPicker.value = true
      break
    case 'screen_effects':
      showScreenEffectPicker.value = true
      break
    case 'symbol': {
      // v16: Follow Shadow Object flow
      if (!props.sceneId || !props.episode) break
      const symScene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
      const symBlock = symScene?.script.find((b: ScriptBlock) => b.id === props.blockId)
      if (!symScene || !symBlock) break
      
      const symName = sceneObjectStore.generateUniqueAlias('Symbol')
      const symCameraCenter = getCameraCenterPosition()
      const { setupObject: symSetupObj, spawnAction: symSpawnAction } = createShadowObject({
        scene: symScene,
        block: symBlock,
        slotIndex: currentSlotIndex.value,
        objectType: 'symbol',
        resourceId: '',
        resourceName: symName,
        cameraCenterX: symCameraCenter.x,
        cameraCenterY: symCameraCenter.y
      })
      addShadowObjectToScene(symSetupObj, symSpawnAction)
      break
    }
    case 'scene_templates':
      showTemplatePicker.value = true
      break
    case 'expression':
      showExpressionPicker.value = true
      break
    case 'actors':
      showActorPicker.value = true
      break
    case 'characters':
      showCharacterPicker.value = true
      break
    case 'light': {
      showLightPicker.value = true
      break
    }
    case 'text': {
      if (!props.sceneId || !props.episode) break
      const textName = sceneObjectStore.generateUniqueAlias('Text')
      const textSetupObj: TextObject = {
        id: generateId('sceneobject'),
        type: 'text',
        name: 'Text',
        refId: '',
        alias: textName,
        content: 'Text',
        fontSize: 72,
        fontFamily: 'Noto Sans SC',
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#ffffff',
        align: 'center',
        wordWrap: false,
        wordWrapWidth: 400,
        textBoxMode: 'auto-size',
        revealInitialState: 'complete',
        x: CANVAS_CENTER_X,
        y: CANVAS_CENTER_Y,
        width: 400,
        height: 100,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        alpha: 1,
        flipX: false,
        zIndex: Z_INDEX_TEXT,
        visible: true,
        spawned: false,
      }
      const textSpawnAction: SetLifecycleAction = {
        id: generateId(),
        type: 'set_lifecycle',
        category: 'point',
        target: textSetupObj.id,
        slotIndex: currentSlotIndex.value,
        params: {
          spawned: true,
          autoDespawnOnBlockEnd: true,
        },
      }
      addShadowObjectToScene(textSetupObj, textSpawnAction)
      break
    }
    case 'mask_rectangle':
    case 'mask_ellipse': {
      if (!props.sceneId || !props.episode) break
      const maskShape: 'rectangle' | 'ellipse' = type === 'mask_ellipse' ? 'ellipse' : 'rectangle'
      const maskName = sceneObjectStore.generateUniqueAlias(maskShape === 'ellipse' ? 'Ellipse Mask' : 'Rectangle Mask')
      const maskCameraCenter = getCameraCenterPosition()
      const maskSetupObj: MaskObject = {
        id: generateId('sceneobject'),
        type: 'mask',
        name: maskShape === 'ellipse' ? 'Ellipse Mask' : 'Rectangle Mask',
        refId: '',
        alias: maskName,
        shape: maskShape,
        mode: 'inside_visible',
        targetIds: [],
        x: maskCameraCenter.x,
        y: maskCameraCenter.y,
        width: 200,
        height: 200,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        alpha: 1,
        flipX: false,
        zIndex: Z_INDEX_TEXT,
        visible: true,
        spawned: false,
      }
      const maskSpawnAction: SetLifecycleAction = {
        id: generateId(),
        type: 'set_lifecycle',
        category: 'point',
        target: maskSetupObj.id,
        slotIndex: currentSlotIndex.value,
        params: {
          spawned: true,
          autoDespawnOnBlockEnd: true,
        },
      }
      addShadowObjectToScene(maskSetupObj, maskSpawnAction)
      break
    }
  }
}

function handleLightSelect(result: { lightType: 'point' | 'spot'; params?: { lightColor?: string; lightIntensity?: number; lightRadius?: number; flicker?: number; flickerSpeed?: number; directionAngle?: number; coneAngle?: number } }) {
  showLightPicker.value = false

  if (!props.sceneId || !props.episode) return
  const lightScene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  const lightBlock = lightScene?.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!lightScene || !lightBlock) return

  const isSpot = result.lightType === 'spot'
  const p = result.params
  const lightName = sceneObjectStore.generateUniqueAlias(isSpot ? 'Spotlight' : 'Point Light')
  const lightCameraCenter = getCameraCenterPosition()
  const { setupObject: lightSetupObj, spawnAction: lightSpawnAction } = createShadowObject({
    scene: lightScene,
    block: lightBlock,
    slotIndex: currentSlotIndex.value,
    objectType: 'light',
    resourceId: '',
    resourceName: lightName,
    cameraCenterX: lightCameraCenter.x,
    cameraCenterY: lightCameraCenter.y,
  })

  const lightObject = lightSetupObj as SceneObject & {
    lightType: 'point' | 'spot'
    lightRadius: number
    lightColor: string
    lightIntensity: number
    directionMode?: 'omni' | 'cone'
    directionAngle?: number
    coneAngle?: number
    flicker?: number
    flickerSpeed?: number
  }
  lightObject.lightType = isSpot ? 'spot' : 'point'
  lightObject.lightRadius = p?.lightRadius ?? (isSpot ? 420 : 300)
  lightObject.lightColor = p?.lightColor ?? '#ffffff'
  lightObject.lightIntensity = p?.lightIntensity ?? 1.0
  lightObject.flicker = p?.flicker ?? 0
  lightObject.flickerSpeed = p?.flickerSpeed ?? 0.35
  lightObject.directionMode = isSpot ? 'cone' : 'omni'
  lightObject.directionAngle = p?.directionAngle ?? 0
  lightObject.coneAngle = p?.coneAngle ?? (isSpot ? 70 : 100)

  addShadowObjectToScene(lightSetupObj, lightSpawnAction)
}

// v16: Handle scene template selection — instantiate and place on canvas (Shadow Object mode)
function handleTemplateSelect(template: SceneTemplate) {
  showTemplatePicker.value = false

  if (!props.sceneId || !props.episode) return
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  const block = scene?.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!scene || !block) return
  if (!block.actions) block.actions = []

  const result = instantiateTemplate(template, CANVAS_CENTER_X, CANVAS_CENTER_Y)
  
  let firstObjectId: string | undefined
  for (const obj of result.objects) {
    // Regenerate unique alias (based on scene namespace)
    const uniqueAlias = sceneObjectStore.generateUniqueAlias(obj.alias ?? obj.name)
    if (uniqueAlias !== obj.alias) {
      obj.alias = uniqueAlias
    }

    // All objects spawned=false (cascade activated by entity root set_lifecycle)
    obj.spawned = false

    // v24: Write to persistence layer (addSetupObject automatically synced to episode)
    sceneObjectStore.addSetupObject(obj)
    
    if (!firstObjectId) firstObjectId = obj.id
  }

  // Create 1 set_lifecycle only for entity root
  const entityRoot = result.objects.find(o => !o.parentId)
  if (entityRoot) {
    const spawnAction: SetLifecycleAction = {
      id: generateId('action'),
      type: 'set_lifecycle',
      category: 'point',
      target: entityRoot.id,
      slotIndex: currentSlotIndex.value,
      params: { spawned: true, autoDespawnOnBlockEnd: true }
    }
    appendActionWithSlotOrder(block.actions, spawnAction as unknown as Action)
  }
  
  // Update Episode Store
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })
  
  // Refresh scene
  loadSetupToSceneObjects(scene.setup)
  void refreshGhostRealStates()
  
  // Set top-level root object alias and extraInfo
  const templateRoot = result.objects.find(o => !o.parentId)
  if (templateRoot) {
    const uniqueAlias = sceneObjectStore.generateUniqueAlias(template.name)
    const extraInfo: CompositeExtraInfo = { kind: 'template', templateId: template.id }
    // v24: updateSetupObject writes setupState + runtimeState + episode simultaneously
    sceneObjectStore.updateSetupObject(templateRoot.id, { alias: uniqueAlias, extraInfo } as Partial<SceneObject>)
  }

  if (firstObjectId) {
    sceneObjectStore.selectObject(firstObjectId)
  }
  
  markLocalChange()
}

// Actor/character selection — instantiate as entity mode composite object (Shadow Object mode)
function handleCompositeCharacterSelectInAction(character: CompositeCharacter, displayName?: string, extraInfo?: CompositeExtraInfo): void {
  if (!props.sceneId || !props.episode) return
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  const block = scene?.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!scene || !block) return
  if (!block.actions) block.actions = []

  const pseudoTemplate: SceneTemplate = {
    id: character.id,
    name: character.name,
    objects: character.objects,
    createdAt: character.createdAt,
    ...(character.tags ? { tags: character.tags } : {}),
    ...(character.editorAnchor ? { editorAnchor: character.editorAnchor } : {}),
    ...(character.renderChain ? { renderChain: character.renderChain } : {}),
  }

  const result = instantiateTemplate(pseudoTemplate, CANVAS_CENTER_X, CANVAS_CENTER_Y, {
    wrapperCompositeMode: 'entity',
  })

  let firstObjectId: string | undefined
  // Build lookup table
  for (const obj of result.objects) {
    const uniqueAlias = sceneObjectStore.generateUniqueAlias(obj.alias ?? obj.name)
    if (uniqueAlias !== obj.alias) {
      obj.alias = uniqueAlias
    }

    // All objects spawned=false (cascade activated by entity root set_lifecycle)
    obj.spawned = false

    // v24: Write to persistence layer (addSetupObject automatically synced to episode)
    sceneObjectStore.addSetupObject(obj)

    if (!firstObjectId) firstObjectId = obj.id
  }

  // Create 1 set_lifecycle only for entity root
  const entityRoot = result.objects.find(o => !o.parentId)
  if (entityRoot) {
    const spawnAction: SetLifecycleAction = {
      id: generateId('action'),
      type: 'set_lifecycle',
      category: 'point',
      target: entityRoot.id,
      slotIndex: currentSlotIndex.value,
      params: { spawned: true, autoDespawnOnBlockEnd: true }
    }
    appendActionWithSlotOrder(block.actions, spawnAction as unknown as Action)
  }

  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })

  loadSetupToSceneObjects(scene.setup)
  void refreshGhostRealStates()

  // Set top-level root object alias and extraInfo
  const targetName = displayName ?? character.name
  const resolvedExtraInfo = extraInfo ?? { kind: 'character' as const, characterId: character.id }
  const charRoot = result.objects.find(o => !o.parentId)
  if (charRoot) {
    const uniqueAlias = sceneObjectStore.generateUniqueAlias(targetName)
    // v24: updateSetupObject writes setupState + runtimeState + episode simultaneously
    sceneObjectStore.updateSetupObject(charRoot.id, { alias: uniqueAlias, extraInfo: resolvedExtraInfo } as Partial<SceneObject>)

    // Remap rootCompositeId (use idMap to convert template object ID to scene instance ID)
    if (character.rootCompositeId) {
      const remappedRoot = result.idMap.get(character.rootCompositeId)
      if (remappedRoot) {
        sceneObjectStore.updateSetupObject(charRoot.id, {
          instanceRootCompositeId: remappedRoot,
        } as Partial<SceneObject>)
      }
    }
  }

  if (firstObjectId) {
    sceneObjectStore.selectObject(firstObjectId)
  }

  markLocalChange()
}

function handleActorSelect(character: CompositeCharacter, actorName: string, actorId: string): void {
  showActorPicker.value = false
  handleCompositeCharacterSelectInAction(character, actorName, { kind: 'actor', actorId })
}

function handleCharacterSelect(character: CompositeCharacter): void {
  showCharacterPicker.value = false
  handleCompositeCharacterSelectInAction(character)
}

// Clip-Mask Phase 1: Callback when 'Clipping Mask' group is selected in visual effects dialog,
// Reuse existing mask_rectangle / mask_ellipse path
function handleAddMaskFromDialog(shape: 'rectangle' | 'ellipse') {
  showScreenEffectPicker.value = false
  handleAddMenuItemClick(shape === 'ellipse' ? 'mask_ellipse' : 'mask_rectangle')
}

// Phase 1: Handle screen effect selection
function handleScreenEffectSelect(preset: ScreenEffectPreset) {
  showScreenEffectPicker.value = false

  if (!props.sceneId || !props.blockId || !props.episode) return

  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  const block = scene?.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!scene || !block) return

  const effectId = generateId('sceneobject')
  const effectAlias = sceneObjectStore.generateUniqueAlias(preset.name)

  // Add object to Scene Setup (spawned: false, dynamic object)
  const setupObj = {
    id: effectId,
    refId: preset.effectClass,
    type: 'screen_effect' as const,
    name: preset.name,
    effectClass: preset.effectClass,
    params: {
      baseColor: preset.params.baseColor ?? '#000000',
      openRatio: preset.params.openRatio ?? 1.0,
      feather: preset.params.feather ?? 0,
      ...preset.params
    },
    alias: effectAlias,
    x: CANVAS_CENTER_X,
    y: CANVAS_CENTER_Y,
    width: Math.round(CAMERA_BASE_WIDTH * 1.1),
    height: Math.round(CAMERA_BASE_HEIGHT * 1.1),
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    zIndex: Z_INDEX_SCREEN_EFFECT,
    flipX: false,
    alpha: preset.defaultAlpha ?? 1,
    visible: true,
    spawned: false
  } as SceneObject
  // v24: addSetupObject automatically synced to episode
  sceneObjectStore.addSetupObject(setupObj)

  // Add spawn Action (set_lifecycle)
  const birthAction: SetLifecycleAction = {
    id: generateId('action'),
    type: 'set_lifecycle',
    category: 'point',
    target: effectId,
    slotIndex: currentSlotIndex.value,
    params: { spawned: true }
  }
  if (!block.actions) block.actions = []
  appendActionWithSlotOrder(block.actions, birthAction as unknown as Action)

  // Update Store
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })

  // Refresh state
  void refreshGhostRealStates()
  markLocalChange()

  // Select new object
  sceneObjectStore.selectObject(effectId)
}

// Determine whether selected object can be duplicated (non-camera + alive in current Slot)
const canCopySelectedObject = computed(() => {
  const selectedObj = sceneObjectStore.getSelectedObject()
  if (!selectedObj) return false
  if (selectedObj.type === 'camera') return false
  return aliveObjectIds.value.includes(selectedObj.id)
})

// v9.1: Determine whether selected object can be removed (all alive non-camera objects can be removed)
const canDeleteSelectedObject = computed(() => {
  const selectedObj = sceneObjectStore.getSelectedObject()
  if (!selectedObj) return false
  if (selectedObj.type === 'camera') return false
  // v25: Ambient light cannot be deleted
  if (selectedObj.type === 'light' && (selectedObj as unknown as import('@/types/sceneObject').LightObject).lightType === 'ambient') return false
  // All non-camera objects alive in current Slot can be removed
  return aliveObjectIds.value.includes(selectedObj.id)
})

// v9.1: Handle deleting dynamic object
function handleDeleteDynamicObject() {
  const selectedObj = sceneObjectStore.getSelectedObject()
  if (!selectedObj) return
  if (!props.sceneId || !props.blockId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return
  
  // v9.3: Find object's spawn Slot (using SetLifecycleAction)
  const lifecycleActions = (block.actions ?? []).filter(
    (a: Action) => a.type === 'set_lifecycle' && a.target === selectedObj.id
  ) as SetLifecycleAction[]
  
  // Find first spawn Action with spawned: true
  const birthAction = lifecycleActions
    .filter(a => a.params.spawned === true)
    .sort((a, b) => a.slotIndex - b.slotIndex)[0]
  
  const birthSlotIndex = birthAction?.slotIndex ?? -1
  const isAtBirthSlot = currentSlotIndex.value === birthSlotIndex
  const isShadowObject = sceneObjectStore.getSetupObject(selectedObj.id)?.spawned === false
  
  if (isShadowObject && isAtBirthSlot) {
    // Spawn Slot deletion = true delete (Setup + all Actions)
    const alias = (selectedObj as unknown as { alias?: string }).alias || selectedObj.name || 'this object'
    const isCompositeObj = selectedObj.type === 'composite'
    
    // Recursively collect all descendant IDs (including grandchildren), read childIds from runtime data
    // Approach A: childIds empty in setup, need to use getObject (runtimeObjects)
    function collectAllDescendantIds(parentId: string): string[] {
      const parentObj = sceneObjectStore.getObject(parentId)
      if (parentObj?.type !== 'composite') return []
      const directChildIds = [...((parentObj as unknown as { childIds?: string[] }).childIds || [])]
      const allIds = [...directChildIds]
      for (const childId of directChildIds) {
        allIds.push(...collectAllDescendantIds(childId))
      }
      return allIds
    }
    
    const descendantIds = isCompositeObj ? collectAllDescendantIds(selectedObj.id) : []
    
    if (isCompositeObj && descendantIds.length > 0) {
      const compositeMode = (selectedObj as unknown as { compositeMode?: string }).compositeMode ?? 'entity'
      if (compositeMode === 'entity') {
        // entity: Direct cascade deletion (no 'delete composite only' option provided)
        confirmDialogConfig.value = {
          title: 'Delete Composite Object',
          message: `Are you sure you want to delete "${alias}" and its ${descendantIds.length} child object(s)?`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          isDanger: true,
          showSecondaryConfirm: false,
          secondaryConfirmText: '',
          onConfirm: () => {
            deleteCompositeObjects([selectedObj.id, ...descendantIds], selectedObj.id)
            showConfirmDialog.value = false
          },
          onSecondaryConfirm: () => { /* empty */ },
        }
        showConfirmDialog.value = true
      } else {
        // union: Two-option dialog — delete composite only (child objects bubble automatically via onBeforeDelete)
        confirmDialogConfig.value = {
          title: 'Ungroup',
          message: `Are you sure you want to ungroup "${alias}"?`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          isDanger: true,
          showSecondaryConfirm: false,
          secondaryConfirmText: '',
          onConfirm: () => {
            deleteCompositeObjects([selectedObj.id], selectedObj.id)
            showConfirmDialog.value = false
          },
          onSecondaryConfirm: () => { /* empty */ },
        }
        showConfirmDialog.value = true
      }
      return
    }
    
    // Non-union or childless: Standard two-option deletion
    confirmDialogConfig.value = {
      title: 'Delete Object',
      message: `Are you sure you want to delete "${alias}"? This will delete the object and all its associated actions.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDanger: true,
      showSecondaryConfirm: false,
      secondaryConfirmText: '',
      onConfirm: () => {
        deleteCompositeObjects([selectedObj.id], selectedObj.type === 'composite' ? selectedObj.id : undefined)
        showConfirmDialog.value = false
      },
      onSecondaryConfirm: () => { /* empty */ },
    }
  } else {
    // v9.2: Other Slot deletion = insert spawned: false Action (logical deletion)
    const objAlias = (selectedObj as unknown as { alias?: string }).alias || selectedObj.name || 'this object'
    const isUnionComposite = selectedObj.type === 'composite'
      && ((selectedObj as unknown as { compositeMode?: string }).compositeMode ?? 'entity') === 'union'

    confirmDialogConfig.value = {
      title: isUnionComposite ? 'Ungroup' : 'Remove Object',
      message: isUnionComposite
        ? `Are you sure you want to ungroup "${objAlias}"?`
        : `Are you sure you want to remove "${objAlias}"? This object will no longer be displayed from this point onwards.`,
      confirmText: isUnionComposite ? 'Ungroup' : 'Remove',
      cancelText: 'Cancel',
      isDanger: isUnionComposite,
      showSecondaryConfirm: false,
      secondaryConfirmText: '',
      onConfirm: () => {
        // v9.3: Insert set_lifecycle Action (despawn)
        const despawnAction: SetLifecycleAction = {
          id: `action_despawn_${Date.now()}`,
          type: 'set_lifecycle',
          category: 'point',
          target: selectedObj.id,
          slotIndex: currentSlotIndex.value,
          params: {
            spawned: false
          }
        }
        
        if (!block.actions) {
          block.actions = []
        }
        appendActionWithSlotOrder(block.actions, despawnAction as unknown as Action)
        
        // Update Store
        const episodeId = route.params['id'] as string
        episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
          actions: block.actions
        })
        
        void refreshGhostRealStates()
        
        showConfirmDialog.value = false
        markLocalChange()
      },
      onSecondaryConfirm: () => { /* empty */ },
    }
  }
  showConfirmDialog.value = true
}

// P2: ActionEditor grouping mode state machine (PRD 8.3/8.5)
type ActionGroupingState =
  | { mode: 'create'; pendingIds: string[] }
  | { mode: 'addTo'; compositeId: string; pendingIds: string[] }
  | null

const actionGroupingState = ref<ActionGroupingState>(null)

// P2: Get object display name
function getObjectDisplayName(objectId: string): string {
  const obj = sceneObjectStore.getObject(objectId)
  if (!obj) return objectId
  return (obj as unknown as { alias?: string }).alias ?? obj.name ?? 'Untitled'
}

// P2: Get composite object display name (for addTo mode)
function getCompositeDisplayName(compositeId: string | undefined): string {
  if (!compositeId) return 'Unknown'
  return getObjectDisplayName(compositeId)
}

function appendActionWithSlotOrder(actions: Action[], action: Action): void {
  const mode = getActionOrderModeForSlot(actions, action.slotIndex)
  actions.push(action)
  if (mode === 'custom') {
    reconcileActionOrderForSlot(actions, action.slotIndex, {
      mode: 'custom',
      appendActionId: action.id,
      objectIndexMap: getActionObjectIndexMap(),
    })
  } else {
    delete action.order
  }
}

// P2: Enter grouping mode
function handleStartGrouping() {
  actionGroupingState.value = { mode: 'create', pendingIds: [] }
}

// v19: Grouping mode compositeMode selection
const selectedCompositeMode = ref<'entity' | 'union'>('union')

/** Build grouping object tree from runtime objects (spawned only and non-camera) */
const actionGroupingTreeNodes = computed<GroupingTreeNode[]>(() => {
  const objects: SceneObject[] = sceneObjectStore.objects.filter(
    (o): o is SceneObject => o.type !== 'camera' && (o as unknown as { spawned?: boolean }).spawned !== false
  )
  const objectMap = new Map<string, SceneObject>(objects.map(o => [o.id, o]))

  function buildNode(obj: SceneObject, depth: number): GroupingTreeNode {
    const displayName = (obj as unknown as { alias?: string }).alias ?? obj.name ?? 'Untitled'
    const children: GroupingTreeNode[] = []

    if (obj.type === 'composite') {
      const comp = obj as unknown as { childIds: string[]; compositeMode?: string }
      for (const childId of comp.childIds) {
        const child = objectMap.get(childId)
        if (child && child.type !== 'camera') {
          children.push(buildNode(child, depth + 1))
        }
      }
    }

    return {
      id: obj.id,
      name: displayName,
      icon: getTypeIcon(obj.type),
      depth,
      parentId: obj.parentId,
      children,
    }
  }

  return objects
    .filter((o): o is SceneObject => !o.parentId)
    .sort((a, b) => b.zIndex - a.zIndex)
    .map(o => buildNode(o, 0))
})

/** Current level-locked parentId (determined by first pending object) */
const lockedGroupingParentId = computed<string | undefined | null>(() => {
  if (!actionGroupingState.value) return null
  const ids = actionGroupingState.value.pendingIds
  if (ids.length === 0) return null
  const firstObj = sceneObjectStore.getObject(ids[0]!)
  return firstObj?.parentId
})

/** Inline list toggle selection */
function handleGroupingToggleById(objectId: string): void {
  if (!actionGroupingState.value) return

  const selectedObj = sceneObjectStore.getObject(objectId)
  if (!selectedObj || selectedObj.type === 'camera') return

  const pendingIds = actionGroupingState.value.pendingIds

  // In addTo mode: cannot select target composite itself or its descendants
  if (actionGroupingState.value.mode === 'addTo') {
    const compositeId = actionGroupingState.value.compositeId
    if (objectId === compositeId) return
    let current = selectedObj
    while (current.parentId) {
      if (current.parentId === compositeId) return
      const parent = sceneObjectStore.getObject(current.parentId)
      if (!parent) break
      current = parent
    }
  }

  // toggle
  const idx = pendingIds.indexOf(objectId)
  if (idx !== -1) {
    pendingIds.splice(idx, 1)
  } else {
    // Peer sibling rule
    if (pendingIds.length > 0) {
      const firstObj = sceneObjectStore.getObject(pendingIds[0]!)
      const requiredParentId = firstObj?.parentId
      if (selectedObj.parentId !== requiredParentId) {
        const toast = useToast()
        toast.warning('Only peer objects at the same level can be grouped')
        return
      }
    }
    pendingIds.push(objectId)
  }
}

// P2: Canvas click — toggle object selection in grouping mode
function handleCanvasClickForGrouping() {
  if (!actionGroupingState.value) return

  // Get currently selected object (via useSceneRenderer hit-test)
  const selectedObj = sceneObjectStore.getSelectedObject()
  if (!selectedObj || selectedObj.type === 'camera') return

  const objectId = selectedObj.id
  const pendingIds = actionGroupingState.value.pendingIds

  // In addTo mode: cannot select target composite itself or its descendants
  if (actionGroupingState.value.mode === 'addTo') {
    const compositeId = actionGroupingState.value.compositeId
    if (objectId === compositeId) {
      const toast = useToast()
      toast.warning('Cannot add composite object to itself')
      return
    }
    // Traverse up parentId chain, check if already descendant of target composite
    let current = selectedObj
    while (current.parentId) {
      if (current.parentId === compositeId) {
        const toast = useToast()
        toast.warning('This object is already a descendant of this composite, cannot add again')
        return
      }
      const parent = sceneObjectStore.getObject(current.parentId)
      if (!parent) break
      current = parent
    }
  }

  // toggle: Remove if already in list, otherwise add
  const idx = pendingIds.indexOf(objectId)
  if (idx !== -1) {
    pendingIds.splice(idx, 1)
  } else {
    // Peer sibling rule: Objects participating in group must share same parentId
    // First selected object establishes parentId benchmark, subsequent selections must match
    if (pendingIds.length > 0) {
      const firstObj = sceneObjectStore.getObject(pendingIds[0]!)
      const requiredParentId = firstObj?.parentId
      if (selectedObj.parentId !== requiredParentId) {
        const toast = useToast()
        toast.warning('Only peer objects at the same level can be grouped')
        return
      }
    }
    pendingIds.push(objectId)
  }
}

function getOrCreateSceneStructureAction(actions: Action[], slotIndex: number): SetSceneStructureAction {
  const existing = actions.find(
    (action): action is SetSceneStructureAction =>
      action.type === 'set_scene_structure'
      && action.target === SCENE_ACTION_TARGET
      && action.slotIndex === slotIndex
  )
  if (existing) return existing

  const structureAction: SetSceneStructureAction = {
    id: generateId('action'),
    type: 'set_scene_structure',
    category: 'point',
    target: SCENE_ACTION_TARGET,
    slotIndex,
    params: {
      operations: [],
    },
  }
  appendActionWithSlotOrder(actions, structureAction as Action)
  return structureAction
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

function appendSceneStructureOperation(
  actions: Action[],
  slotIndex: number,
  operation: SceneStructureOperation,
): void {
  const structureAction = getOrCreateSceneStructureAction(actions, slotIndex)
  structureAction.params.operations.push(operation)
  selectedAction.value = structureAction as unknown as Action
}

function upsertGroupSceneStructureOperation(
  actions: Action[],
  slotIndex: number,
  groupId: string,
  memberIds: readonly string[],
  parentId: string | null,
): void {
  const structureAction = getOrCreateSceneStructureAction(actions, slotIndex)
  const existing = structureAction.params.operations.find(
    operation => operation.kind === 'group' && operation.groupId === groupId
  )
  if (existing?.kind === 'group') {
    existing.memberIds = uniqueIds([...existing.memberIds, ...memberIds])
    existing.parentId = parentId
    selectedAction.value = structureAction as unknown as Action
    return
  }

  structureAction.params.operations.push({
    id: generateId('structure_op'),
    kind: 'group',
    groupId,
    memberIds: uniqueIds(memberIds),
    parentId,
  })
  selectedAction.value = structureAction as unknown as Action
}

function appendUngroupSceneStructureOperation(
  actions: Action[],
  slotIndex: number,
  groupId: string,
  memberIds: readonly string[],
  restoreParentId: string | null,
  groupParentId: string | null = null,
): void {
  appendSceneStructureOperation(actions, slotIndex, {
    id: generateId('structure_op'),
    kind: 'ungroup',
    groupId,
    memberIds: uniqueIds(memberIds),
    groupParentId,
    restoreParentId,
  })
}

function appendReparentSceneStructureOperation(
  actions: Action[],
  slotIndex: number,
  objectIds: readonly string[],
  parentId: string | null,
): void {
  appendSceneStructureOperation(actions, slotIndex, {
    id: generateId('structure_op'),
    kind: 'reparent',
    objectIds: uniqueIds(objectIds),
    parentId,
  })
}

function getNamespaceRootForParentId(parentId: string | null): string | null {
  let currentId = parentId ?? undefined
  while (currentId) {
    const parent = sceneObjectStore.getObject(currentId)
    if (!parent) return null
    if (parent.type === 'composite') {
      const mode = (parent as unknown as { compositeMode?: string }).compositeMode ?? 'entity'
      if (mode === 'entity') return parent.id
    }
    currentId = parent.parentId
  }
  return null
}

function getGroupingCompositePlacement(
  pendingIds: readonly string[],
  fallbackParentId: string | null,
): { x: number; y: number; width: number; height: number } {
  const sceneGraph = renderer.value?.getSceneGraph()
  if (!sceneGraph) {
    return { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y, width: 0, height: 0 }
  }

  const containers = pendingIds
    .map(id => sceneGraph.getContainer(id))
    .filter((container): container is PIXI.Container => Boolean(container && !container.destroyed))

  if (containers.length === 0) {
    return { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y, width: 0, height: 0 }
  }

  const referenceContainer = containers[0]?.parent
    ?? (fallbackParentId ? sceneGraph.getContainer(fallbackParentId)?.parent : undefined)
    ?? (fallbackParentId ? sceneGraph.getContainer(fallbackParentId) : undefined)

  if (referenceContainer?.parent && !referenceContainer.destroyed) {
    referenceContainer.updateTransform()
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const container of containers) {
    if (container.parent && !container.destroyed) {
      container.updateTransform()
    }
    const bounds = container.getBounds()
    if (bounds.width > 0 || bounds.height > 0) {
      minX = Math.min(minX, bounds.x)
      minY = Math.min(minY, bounds.y)
      maxX = Math.max(maxX, bounds.x + bounds.width)
      maxY = Math.max(maxY, bounds.y + bounds.height)
      continue
    }

    const point = container.toGlobal(new PIXI.Point(0, 0))
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y, width: 0, height: 0 }
  }

  const centerGlobal = new PIXI.Point((minX + maxX) / 2, (minY + maxY) / 2)
  const centerLocal = referenceContainer
    ? referenceContainer.toLocal(centerGlobal)
    : centerGlobal

  return {
    x: centerLocal.x,
    y: centerLocal.y,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/**
 * P2: In same slot, ensure composite object has only one set_composite action (Upsert semantics).
 * - If set_composite exists for same slot + target -> merge params
 * - If not exists -> create new action and push
 * Auto-select action after create/update, jump to ActionInspector.
 */
function upsertSetCompositeAction(
  actions: Action[],
  target: string,
  slotIndex: number,
  params: { compositeMode?: 'entity' | 'union'; renderChain?: string[] }
): void {
  const existing = actions.find(
    (a) => a.type === 'set_composite' && a.target === target && a.slotIndex === slotIndex
  )
  if (existing) {
    // Merge params (keep existing other fields)
    const existingParams = (existing as unknown as { params: Record<string, unknown> }).params
    Object.assign(existingParams, params)
    // Auto select
    selectedAction.value = existing
  } else {
    const newAction: Action = {
      id: generateId('action'),
      type: 'set_composite',
      category: 'point',
      target,
      slotIndex,
      params: { ...params }
    } as unknown as Action
    appendActionWithSlotOrder(actions, newAction)
    // Auto select
    selectedAction.value = newAction
  }
}

/**
 * Clip-Mask Phase 1 D2: Upsert set_mask Action (merge same slot + target).
 * - If set_mask exists for same slot + target -> merge params (targetIds/shape/width/height full section override)
 * - If not exists -> create new action
 * Cross-mask exclusive conflict handled by sceneStateCalculator post-pass (see §3 D1.5).
 */
function upsertSetMaskAction(
  actions: Action[],
  target: string,
  slotIndex: number,
  params: { targetIds?: string[]; shape?: 'rectangle' | 'ellipse'; width?: number; height?: number }
): void {
  const existing = actions.find(
    (a) => a.type === 'set_mask' && a.target === target && a.slotIndex === slotIndex
  )
  if (existing) {
    const existingParams = (existing as unknown as { params: Record<string, unknown> }).params
    if (params.targetIds !== undefined) existingParams['targetIds'] = [...params.targetIds]
    if (params.shape !== undefined) existingParams['shape'] = params.shape
    if (params.width !== undefined) existingParams['width'] = params.width
    if (params.height !== undefined) existingParams['height'] = params.height
    selectedAction.value = existing
  } else {
    const newAction: SetMaskAction = {
      id: generateId('action'),
      type: 'set_mask',
      category: 'point',
      target,
      slotIndex,
      params: {
        ...(params.targetIds !== undefined ? { targetIds: [...params.targetIds] } : {}),
        ...(params.shape !== undefined ? { shape: params.shape } : {}),
        ...(params.width !== undefined ? { width: params.width } : {}),
        ...(params.height !== undefined ? { height: params.height } : {}),
      },
    }
    appendActionWithSlotOrder(actions, newAction as unknown as Action)
    selectedAction.value = newAction as unknown as Action
  }
}

// P2: Confirm grouping (Action Mode specific logic)
function handleGroupingConfirm() {
  if (!actionGroupingState.value) return
  if (!props.sceneId || !props.blockId || !props.episode) return

  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return

  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return

  if (!block.actions) {
    block.actions = []
  }

  if (actionGroupingState.value.mode === 'create') {
    if (actionGroupingState.value.pendingIds.length < 2) return

    const pendingIds = actionGroupingState.value.pendingIds

    // 1. Detect common parent object (for nested composite auto inheritance)
    let commonParentId: string | null = null
    let allSameParent = true
    for (const childId of pendingIds) {
      const childObj = sceneObjectStore.getObject(childId)
      const effectiveParentId = childObj?.parentId ?? null
      if (commonParentId === null && allSameParent) {
        commonParentId = effectiveParentId
      } else if (effectiveParentId !== commonParentId) {
        allSameParent = false
      }
    }

    const compositeParentId = allSameParent ? commonParentId : null
    const namespaceRootId = getNamespaceRootForParentId(compositeParentId)
    const placement = getGroupingCompositePlacement(pendingIds, compositeParentId)

    // 2. Create composite in sceneObjectStore + Setup (spawned: false)
    // Action Mode grouping is fixed to union mode
    const composite = sceneObjectStore.createCompositeObject('Composite', [], undefined, undefined, 'union', namespaceRootId)
    const compositeSetupObj = {
      id: composite.id,
      type: 'composite' as const,
      name: composite.name,
      alias: composite.alias,
      refId: '',
      childIds: [],
      compositeLocked: true,
      compositeMode: 'union' as const,
      x: placement.x,
      y: placement.y,
      width: 0,
      height: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      flipX: false,
      zIndex: composite.zIndex,
      visible: true,
      spawned: false,
      // Nested composite: If all candidate objects share parent, composite inherits directly
      ...(compositeParentId ? { parentId: compositeParentId } : {}),
    } as SceneObject
    // v24: addSetupObject automatically synced to episode
    sceneObjectStore.addSetupObject(compositeSetupObj)
    // 3. Update unique set_scene_structure of current slot: save user grouping operation
    upsertGroupSceneStructureOperation(block.actions, currentSlotIndex.value, composite.id, pendingIds, compositeParentId)

  } else if (actionGroupingState.value.mode === 'addTo') {
    if (actionGroupingState.value.pendingIds.length === 0) return

    appendReparentSceneStructureOperation(
      block.actions,
      currentSlotIndex.value,
      actionGroupingState.value.pendingIds,
      actionGroupingState.value.compositeId
    )
  }

  // Update Episode Store
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })

  // Refresh render (reload Setup to reflect new composite)
  loadSetupToSceneObjects(scene.setup)

  // Crucial: loadSetupToSceneObjects calls setActionMode(true), rebuilding runtimeObjects (without parentId).
  // Must synchronously compute slot states and write parentId before Vue reactive flush,
  // otherwise ActionSequencer.allTracks recalculates when parentId=undefined, failing to render tree structure correctly.
  const sceneGraph = renderer.value?.getSceneGraph()
  if (sceneGraph) {
    sceneGraph.updateSlotIndex(currentSlotIndex.value)
    const slotStates = sceneGraph.getGhostStates()
    if (slotStates) {
      sceneObjectStore.applySlotState(slotStates)
    }
  }

  void refreshGhostRealStates()
  markLocalChange()

  actionGroupingState.value = null
}

// P2: Cancel grouping
function handleGroupingCancel() {
  actionGroupingState.value = null
}

// P2: Handle composite action events from ObjectPropertiesPanel (Option B)
function handleCompositeAction(payload: { action: 'removeChild'; childId: string } | { action: 'ungroupAll'; compositeId: string } | { action: 'addMember'; compositeId: string } | { action: 'setCompositeLocked'; compositeId: string; locked: boolean } | { action: 'reorderRenderChain'; compositeId: string; renderChain: string[] }) {
  if (payload.action === 'addMember') {
    // P2: Enter addTo mode in Action Mode, add members via scene-level structure action
    actionGroupingState.value = {
      mode: 'addTo',
      compositeId: payload.compositeId,
      pendingIds: []
    }
    return
  }

  if (!props.sceneId || !props.blockId || !props.episode) return

  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return

  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return

  if (!block.actions) {
    block.actions = []
  }

  if (payload.action === 'removeChild') {
    const child = sceneObjectStore.getObject(payload.childId)
    const parent = child?.parentId ? sceneObjectStore.getObject(child.parentId) : undefined
    appendReparentSceneStructureOperation(block.actions, currentSlotIndex.value, [payload.childId], parent?.parentId ?? null)
  } else if (payload.action === 'ungroupAll') {
    const composite = sceneObjectStore.getObject(payload.compositeId)
    if (composite?.type !== 'composite') return

    const childIds = (composite as unknown as { childIds?: string[] }).childIds ?? []
    const nextParentId = composite.parentId ?? null
    appendUngroupSceneStructureOperation(block.actions, currentSlotIndex.value, payload.compositeId, childIds, nextParentId)
  } else if (payload.action === 'setCompositeLocked') {
    // compositeLocked is UI-only property, does not create Action
    // Dual-layer architecture: Write persistent and display layers simultaneously via updateSetupObject
    // v24: updateSetupObject automatically synced to episode
    sceneObjectStore.updateSetupObject(payload.compositeId, { compositeLocked: payload.locked } as Partial<SceneObject>)
    return  // No need to update block.actions
  } else if (payload.action === 'reorderRenderChain') {
    // P2: Upsert set_composite Action to modify renderChain ordering
    upsertSetCompositeAction(
      block.actions,
      payload.compositeId,
      currentSlotIndex.value,
      { renderChain: payload.renderChain }
    )
  }

  // Update Store
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })

  void refreshGhostRealStates()
  markLocalChange()
}

/**
 * Duplicate selected object (snapshot copy)
 * - Create a new Shadow Object in current Slot
 * - Use source object's full SceneObject state in current Slot
 * - Do not duplicate source object's Actions
 */
function cloneSceneObjectSnapshot<T extends SceneObject>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T
}

function isActionTargetForObject(action: Action, obj: SceneObject): boolean {
  return action.target === obj.id || (!!obj.alias && action.target === obj.alias)
}

function getCurrentSlotObjectSnapshot(
  objectId: string,
  prevContextObjects: SceneObject[],
  block: ScriptBlock,
  slots: ReturnType<typeof parseBlockToSlots>
): SceneObject | undefined {
  const runtimeObj = sceneObjectStore.getObject(objectId)
  const contextObj = prevContextObjects.find(o => o.id === objectId)
  if (runtimeObj) {
    return cloneSceneObjectSnapshot(runtimeObj)
  }

  if (!contextObj) {
    return undefined
  }

  const objectActions = (block.actions ?? []).filter((a: Action) => isActionTargetForObject(a, contextObj))
  const evalState = evaluateObjectStateBySlot(
    contextObj,
    objectActions,
    currentSlotIndex.value,
    slots,
    {
      getObjectState: (id: string) => {
        const o = prevContextObjects.find(obj => obj.id === id)
        return o ? (o as unknown as WriteableState) : undefined
      }
    }
  )

  return cloneSceneObjectSnapshot(evalState)
}

function handleCopyObject() {
  const selectedObj = sceneObjectStore.getSelectedObject()
  if (!selectedObj || selectedObj.type === 'camera') return
  if (!props.sceneId || !props.blockId || !props.episode) return

  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  const block = scene?.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!scene || !block) return

  // Get object structure from persistence layer (immutable fields like type, refId used for spread copy)
  const originalSetup = sceneObjectStore.getSetupObject(selectedObj.id)
  if (!originalSetup) return
  // Calculate original object runtime state at current Slot
  const prevContext = calculatePrevContext(scene, block.id)
  const slots = currentBlockSlots.value
  const currentSnapshot = getCurrentSlotObjectSnapshot(selectedObj.id, prevContext.objects, block, slots)
  if (!currentSnapshot) return

  // Generate new ID and alias
  const newId = generateId('sceneobject')
  const newAlias = sceneObjectStore.generateUniqueAlias(
    originalSetup.alias || selectedObj.name || 'Copy'
  )

  // composite duplicate: copy entire subtree via 'template instantiation' path (one-shot ID/childIds/renderChain remap)
  if (originalSetup.type === 'composite') {
    const originalCompositeMode = (originalSetup as unknown as { compositeMode?: 'entity' | 'union' }).compositeMode ?? 'entity'
    const snapshotObjects = scene.setup.objects.map(obj =>
      getCurrentSlotObjectSnapshot(obj.id, prevContext.objects, block, slots) ?? cloneSceneObjectSnapshot(obj)
    )
    const template = snapshotToTemplate(
      [currentSnapshot],
      snapshotObjects,
      `${originalSetup.name} Copy`
    )
    const result = instantiateTemplate(template, currentSnapshot.x + 50, currentSnapshot.y + 50,
      originalCompositeMode === 'union'
        ? { autoWrapComposite: true, wrapperCompositeMode: 'entity' }
        : { autoWrapComposite: false }
    )
    const copiedRoot = result.objects.find(o => !o.parentId)
    if (!copiedRoot) return

    // union duplicate wraps entity root automatically, runtime pose should apply to union itself rather than wrapper
    let poseTargetId = copiedRoot.id
    if (originalCompositeMode === 'union') {
      const copiedUnion = result.objects.find(o =>
        o.type === 'composite'
        && (o as unknown as { compositeMode?: 'entity' | 'union' }).compositeMode === 'union'
        && o.parentId === copiedRoot.id
      )
      if (copiedUnion) {
        poseTargetId = copiedUnion.id
      }
    }

    for (const obj of result.objects) {
      obj.spawned = false
      sceneObjectStore.addSetupObject(obj)
    }

    // Root object uses runtime pose at current Slot, maintaining 'snapshot copy' semantics.
    // Other fields already copied from current snapshot by snapshotToTemplate/instantiateTemplate.
    sceneObjectStore.updateSetupObject(poseTargetId, {
      alias: newAlias,
      x: currentSnapshot.x + 50,
      y: currentSnapshot.y + 50,
      scaleX: currentSnapshot.scaleX,
      scaleY: currentSnapshot.scaleY,
      rotation: currentSnapshot.rotation,
      alpha: currentSnapshot.alpha,
      spawned: false,
    } as Partial<SceneObject>)

    const spawnAction: SetLifecycleAction = {
      id: generateId(),
      type: 'set_lifecycle',
      category: 'point',
      target: copiedRoot.id,
      slotIndex: currentSlotIndex.value,
      params: {
        spawned: true,
        autoDespawnOnBlockEnd: true
      }
    }

    if (!block.actions) {
      block.actions = []
    }
    appendActionWithSlotOrder(block.actions, spawnAction as unknown as Action)

    const episodeId = route.params['id'] as string
    episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
      actions: block.actions
    })

    loadSetupToSceneObjects(scene.setup)
    void refreshGhostRealStates()
    sceneObjectStore.selectObject(poseTargetId)
    markLocalChange()
    return
  }

  // Construct new Setup object (spawned: false)
  const newSetupObject: SceneObject = {
    ...currentSnapshot,
    id: newId,
    alias: newAlias,
    x: currentSnapshot.x + 50,
    y: currentSnapshot.y + 50,
    spawned: false,

  }

  // Create spawn Action
  const spawnAction: SetLifecycleAction = {
    id: generateId(),
    type: 'set_lifecycle',
    category: 'point',
    target: newId,
    slotIndex: currentSlotIndex.value,
    params: {
      spawned: true,
      autoDespawnOnBlockEnd: true
    }
  }

  // Inject into scene (reuse existing logic)
  addShadowObjectToScene(newSetupObject, spawnAction)
}

// v9.1: Get camera center position
function getCameraCenterPosition(): { x: number; y: number } {
  const cameraObj = sceneObjectStore.objects.find(obj => obj.type === 'camera')
  if (cameraObj) {
    return { x: cameraObj.x, y: cameraObj.y }
  }
  // Default canvas center
  return { x: 960, y: 540 }
}

// v9.1: Add Shadow Object to scene
// v9.3: spawnAction type changed to SetLifecycleAction
function addShadowObjectToScene(
  setupObject: SceneObject,
  spawnAction: SetLifecycleAction
) {
  if (!props.sceneId || !props.blockId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return
  
  // 1. v24: addSetupObject automatically synced to episode
  sceneObjectStore.addSetupObject(setupObject)
  // v16: Inject frame animation definitions (symbols etc need auto discovery)
  useAnimationStore().hydrateObjectAnimations(setupObject)
  // v24 (Review F1): hydration modified setupObject.animations, write back to episode
  if (setupObject.animations && Object.keys(setupObject.animations).length > 0) {
    sceneObjectStore.updateSetupObject(setupObject.id, {
      animations: setupObject.animations,
    } as Partial<SceneObject>)
  }
  
  // 2. Add spawn Action to Block
  if (!block.actions) {
    block.actions = []
  }
  appendActionWithSlotOrder(block.actions, spawnAction as unknown as Action)
  
  // 3. Update Episode Store
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })
  
  // 4. Refresh scene objects and rendering
  loadSetupToSceneObjects(scene.setup)
  void refreshGhostRealStates()
  
  // 5. Select newly added object
  sceneObjectStore.selectObject(setupObject.id)
  
  markLocalChange()
}

// v24: syncEpisodeRenderChain migrated to sceneObjectStore.syncRegisteredEpisodeRenderChain

// v9.1: Handle background selection
async function handleBackgroundSelect(background: { id: string; name: string }) {
  showBackgroundPicker.value = false
  
  if (!props.sceneId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  const block = scene?.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!scene || !block) return
  
  const cameraCenter = getCameraCenterPosition()
  
  const { setupObject, spawnAction } = createShadowObject({
    scene,
    block,
    slotIndex: currentSlotIndex.value,
    objectType: 'background',
    resourceId: background.id,
    resourceName: background.name,
    cameraCenterX: cameraCenter.x,
    cameraCenterY: cameraCenter.y
  })
  await applyMeasuredDefaultSize(setupObject, (_id, updates) => {
    Object.assign(setupObject, updates)
  })
  
  addShadowObjectToScene(setupObject, spawnAction)
}

// v9.1: Handle prop selection
async function handlePropSelect(prop: { id: string; name?: string }) {
  showPropPicker.value = false
  
  if (!props.sceneId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  const block = scene?.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!scene || !block) return
  
  const cameraCenter = getCameraCenterPosition()
  
  const { setupObject, spawnAction } = createShadowObject({
    scene,
    block,
    slotIndex: currentSlotIndex.value,
    objectType: 'prop',
    resourceId: prop.id,
    resourceName: prop.name ?? '',
    cameraCenterX: cameraCenter.x,
    cameraCenterY: cameraCenter.y
  })
  await applyMeasuredDefaultSize(setupObject, (_id, updates) => {
    Object.assign(setupObject, updates)
  })
  
  addShadowObjectToScene(setupObject, spawnAction)
}

// v18: Handle expression selection — create Shadow Object
async function handleExpressionSelect(expressionId: string) {
  showExpressionPicker.value = false
  
  if (!props.sceneId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  const block = scene?.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!scene || !block) return
  
  const exprStore = useExpressionStore()
  const expr = exprStore.getExpression(expressionId)
  const exprName = expr?.name ?? 'Expression'
  
  const cameraCenter = getCameraCenterPosition()
  
  const { setupObject, spawnAction } = createShadowObject({
    scene,
    block,
    slotIndex: currentSlotIndex.value,
    objectType: 'expression',
    resourceId: expressionId,
    resourceName: exprName,
    cameraCenterX: cameraCenter.x,
    cameraCenterY: cameraCenter.y
  })
  await applyMeasuredDefaultSize(setupObject, (_id, updates) => {
    Object.assign(setupObject, updates)
  })
  
  addShadowObjectToScene(setupObject, spawnAction)
}

// v9.1: Handle audio selection
function handleSoundSelect(sound: { id: string; name: string }) {
  showSoundPicker.value = false
  
  if (!props.sceneId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  const block = scene?.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!scene || !block) return
  
  const cameraCenter = getCameraCenterPosition()
  
  const { setupObject, spawnAction } = createShadowObject({
    scene,
    block,
    slotIndex: currentSlotIndex.value,
    objectType: 'audio',
    resourceId: sound.id,
    resourceName: sound.name,
    cameraCenterX: cameraCenter.x,
    cameraCenterY: cameraCenter.y
  })
  
  addShadowObjectToScene(setupObject, spawnAction)
}

// Preview dialog
const showPreviewDialog = ref(false)

// Save toast state
const showSaveToast = ref(false)
const saveToastMessage = ref('')
const saveToastType = ref<'success' | 'error'>('success')

// Fullscreen state
const isFullscreen = ref(false)

// Sidebar state
// v8.6: leftPanelCollapsed and leftPanelWidth removed (left sidebar removed)
const rightPanelCollapsed = ref(false)
const rightPanelWidth = ref(320)


// Action-related state
const selectedAction = ref<Action | null>(null)
const currentSlotIndex = ref<number>(0)
// v7.55: Field to auto-focus when entering ActionInspector
const actionFocusField = ref<'pose' | 'layerPreset' | 'expression' | 'partAsset' | null>(null)
// const currentTime = ref(0) // v7.17: Removed, Action Mode depends on Slot only

// Page-level save state flag (tracks modifications in this session only)
const hasLocalChanges = ref(false)
function markLocalChange() {
  hasLocalChanges.value = true
  projectStore.markAsUnsaved()
}

// v6.5: Camera action recording mode (Cut: Instant, Move: Camera Movement)
const cameraRecordMode = ref<'camera_cut' | 'camera_move'>('camera_cut')

// v9.2: Object recording mode (Animation: tween_transform, Layout: set_transform)
const objectRecordMode = ref<'animation' | 'layout'>('layout')

// Timestamp


// Save confirmation dialog state
const showSaveConfirmDialog = ref(false)

// v8.3: Text editing dialog state
const showTextEditDialog = ref(false)
const editingText = ref('')

// Whether there are unsaved modifications


// v8.6: isResizingLeftPanel removed (left sidebar removed)
let isResizingRightPanel = false

// Current Block
const currentBlock = computed(() => {
  if (props.sceneId && props.blockId && props.episode) {
    const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
    if (scene) {
      return scene.script.find((b: ScriptBlock) => b.id === props.blockId) ?? null
    }
  }
  return null
})
const currentBlockDescription = computed(() => {
  if (props.sceneId && props.blockId && props.episode) {
    const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
    if (scene) {
      const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
      if (block) {
        if (block.type === 'dialogue') {
          const dialogueBlock = block
          const instanceId = dialogueBlock.instanceId
          const instance = sceneObjectStore.getObject(instanceId)
          
          let targetName = 'Unknown Character'
          if (instance) {
            // v7.57: Prefer alias, then actor name, finally ID
            // Use length check to avoid eslint prefer-nullish-coalescing warning and ensure fallback on empty string
            if (instance.type === 'background') {
               // Background object
               targetName = instance.alias ?? instance.name ?? instance.id
            } else {
               const alias = instance.alias
               const refId = instance.refId
               targetName = (alias && alias.length > 0) ? alias : ((refId && refId.length > 0) ? refId : instance.id)
            }
          }
          
          return `${targetName}: ${dialogueBlock.text}`
        } else if (block.type === 'narration') {
          return `Narrator: ${(block).text}`
        }
      }
    }
  }
  return 'Unknown Block'
})

// v8.3: Truncate displayed description (up to 10 chars + ellipsis)
const truncatedBlockDescription = computed(() => {
  const desc = currentBlockDescription.value
  if (desc.length > 10) {
    return desc.substring(0, 10) + '...'
  }
  return desc
})

const currentBlockDuration = computed(() => {
  if (!currentBlock.value) return 0
  if (currentBlock.value.type === 'action') {
    return currentBlock.value.duration
  }
  if (currentBlock.value.type === 'dialogue' || currentBlock.value.type === 'narration') {
    return (currentBlock.value).ttsConfig?.duration ?? 0
  }
  return 0
})

const currentBlockSlots = computed(() => {
  if (!currentBlock.value) return []
  return parseBlockToSlots(currentBlock.value)
})

const currentBlockActions = computed(() => {
  return currentBlock.value?.actions ?? []
})

// Dual-layer architecture: accumulatedParentIds removed
// parentId written directly to runtimeObjects by applySlotState(), all consumers read directly from store

// v12.7: Compute alive object ID list in current Slot (for ObjectPropertiesPanel filtering)
// Since sceneObjectStore.objects in Action Mode returns runtimeState.objects,
// they have been calculated by sceneStateCalculator based on actions (including set_lifecycle cascade),
// so true alive state can be iterated directly.
// Reactivity guarantee: handleSlotIndexChange synchronously calls applySlotState upon slot switch,
// runtimeState.objects updates within same call stack, lazy computed will not read stale data.
const aliveObjectIds = computed(() => {
  return sceneObjectStore.objects
    .filter(obj => obj.spawned !== false)
    .map(obj => obj.id)
})

// v17: Save as scene template
const showSaveTemplateDialog = ref(false)
const aliveNonCameraObjects = computed(() =>
  sceneObjectStore.objects.filter(o => o.type !== 'camera' && aliveObjectIds.value.includes(o.id))
)

function handleSaveTemplateSaved(_templateId: string) {
  showSaveTemplateDialog.value = false
}

// v9.3: Automatically deselect when slot switch causes selected object to lose life
watch(aliveObjectIds, (newAliveIds) => {
  const selectedId = sceneObjectStore.selectedObjectId
  if (!selectedId) return
  
  // Camera always remains selected (unaffected by spawned)
  const selectedObj = sceneObjectStore.getObject(selectedId)
  if (selectedObj?.type === 'camera') return
  
  // If selected object is not in alive list, cancel selection
  if (!newAliveIds.includes(selectedId)) {
    sceneObjectStore.selectObject(null)
  }
})

const currentSlotText = computed(() => {
  const slots = currentBlockSlots.value
  if (!slots || slots.length === 0) return ''
  return slots[currentSlotIndex.value]?.text ?? ''
})

function loadSetupToSceneObjects(setup: SceneSetup) {
  // Dual-layer architecture: Consistent with loadSetupToSceneObjects in sceneLoader.ts,
  // temporarily switch to Setup Mode to load in Action Mode (ensuring addObject writes to setupObjects),
  // restore Action Mode and rebuild runtimeObjects upon completion.
  const wasActionMode = sceneObjectStore.getIsActionMode()
  if (wasActionMode) {
    sceneObjectStore.setActionMode(false)
  }

  sceneObjectStore.clearObjects()
  

  // v7.56: Fix camera loss issue in Action Mode
  // ActionEditor previously only iterated objects, ignoring setup.camera field
  if (setup.camera) {
    const camera = setup.camera
    sceneObjectStore.createCameraObject('Camera', {
      x: camera.x,
      y: camera.y
    }, camera.zoom ?? 1.0, 'camera')
    
    // Ensure camera size is updated to match zoom
    const cameraObj = sceneObjectStore.objects.find(obj => obj.type === 'camera')
    if (cameraObj) {
      const zoom = camera.zoom ?? 1.0
      sceneObjectStore.updateObject(cameraObj.id, {
        width: CAMERA_BASE_WIDTH / zoom,
        height: CAMERA_BASE_HEIGHT / zoom
      })
      ;(cameraObj as CameraObject).zoom = zoom
    }
  }

  // P2: Delegate Store deserialization, eliminating shotgun type switch
  // Consistent with sceneLoader.ts, character name resolution injected via callback
  const resolveActorName = (refId: string, actorId?: string) => {
    const actor = actorId ? projectStore.getActor(actorId) : getActorByCharacterId(refId)
    if (!actor && !actorId) return null
    return {
      displayName: actor?.name ?? 'Unknown Character',
      resolvedActorId: actorId ?? (actor?.id ?? '')
    }
  }

  for (const objData of setup.objects) {
    sceneObjectStore.fromSetupObject(objData, resolveActorName)
  }

  // v16: animations persisted, no longer need runtime hydration

  // Dual-layer architecture: Restore Action Mode, rebuild runtimeObjects
  if (wasActionMode) {
    sceneObjectStore.setActionMode(true) // Deep copy setupObjects → runtimeObjects
  }


}


/* 
 * v7.17: Refactor: Remove BlockPlayer and playback logic
 * Scene edit page is no longer responsible for playback; all preview logic moved to preview dialog
function initBlockPlayer() {
  // ... removed code
  // currentTime.value = time // removed
}
*/

/**
 * v8.4: Unified refresh for Ghost/Real state
 * v8.8: Fix async timing issue - setActionModeContext must await completion
 * Call this function after Action create/update to ensure canvas correctly displays latest state
 */
async function refreshGhostRealStates() {
  if (!renderer.value) return
  
  const sceneGraph = renderer.value.getSceneGraph()
  if (sceneGraph && props.sceneId && props.episode) {
    // v8.4 Fix: Update context first to ensure sceneGraph gets latest block.actions
    const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
    const block = scene?.script?.find((b: ScriptBlock) => b.id === props.blockId)
    if (scene && block) {
      // v8.8 Fix: await async context update to ensure asset preloading completes
      await sceneGraph.setActionModeContext(scene, block)
      
      // v8.4 Fix: Simultaneously update renderer internal currentActions
      renderer.value.setActions(block.actions ?? [])
    }
    
    // Then recompute Slot state based on latest context
    sceneGraph.updateSlotIndex(currentSlotIndex.value)
    // v21: Always call applySlotState, but exclude interacting objects (partial apply).
    // Old logic skipped apply completely when interaction lock existed, causing non-interacting objects to stay on stale runtime.
    const slotStates = sceneGraph.getGhostStates()
    if (slotStates) {
      const excludeIds = renderer.value.getInteractionLockedIds()
      sceneObjectStore.applySlotState(slotStates, excludeIds.size > 0 ? excludeIds : undefined)
    }
  }
  
  // Re-render objects
  void renderer.value.renderObjects()
  renderer.value.updateSelectionBox()
}

async function refreshActionContextAndRender(scene: SceneContainer, block: ScriptBlock, updateSelectionBox = false) {
  if (!renderer.value) return

  const sceneGraph = renderer.value.getSceneGraph()
  await sceneGraph.setActionModeContext(scene, block)
  renderer.value.setActions(block.actions ?? [])
  sceneGraph.updateSlotIndex(currentSlotIndex.value)

  // v21: Always call applySlotState, excluding interacting objects (partial apply)
  const slotStates = sceneGraph.getGhostStates()
  if (slotStates) {
    const excludeIds = renderer.value.getInteractionLockedIds()
    sceneObjectStore.applySlotState(slotStates, excludeIds.size > 0 ? excludeIds : undefined)
  }

  void renderer.value.renderObjects()
  if (updateSelectionBox) {
    renderer.value.updateSelectionBox()
  }
}

// v7.25: Determine whether action is active at specified slot
// Logic: a. Action starts at slot; b. Action span passes through or reaches slot
function isActionActiveAtSlot(action: Action, slotIndex: number): boolean {
  // a) Action starts at slot
  if (action.slotIndex === slotIndex) return true
  
  // b) Duration action and span covers slot
  if (action.category === 'duration') {
    const span = (action as { slotSpan?: number }).slotSpan ?? 1
    return slotIndex > action.slotIndex && slotIndex < action.slotIndex + span
  }
  
  return false
}

function getEvaluatedTransformState(targetId: string): SceneObject | undefined {
  const slotState = renderer.value?.getSceneGraph().getGhostStates()?.objects.get(targetId)?.real
  return slotState ?? sceneObjectStore.getObject(targetId)
}

function normalizeTransformPositionParams(action: ActionUpdatePayload, params: Record<string, number>): void {
  const hasPosition = params['x'] !== undefined || params['y'] !== undefined
  if (!hasPosition) return

  const globalX = 'globalX' in action.params ? action.params.globalX : undefined
  const globalY = 'globalY' in action.params ? action.params.globalY : undefined
  if (typeof globalX === 'number' && typeof globalY === 'number') {
    if (params['x'] !== undefined) params['x'] = globalX
    if (params['y'] !== undefined) params['y'] = globalY
    return
  }

  const evaluatedObj = getEvaluatedTransformState(action.target)
  if (!evaluatedObj?.parentId) {
    return
  }

  const tempState: WriteableState = {
    ...(evaluatedObj as unknown as WriteableState),
    x: params['x'] ?? evaluatedObj.x ?? 0,
    y: params['y'] ?? evaluatedObj.y ?? 0,
  }
  const getObjState = (id: string): WriteableState | undefined => {
    if (id === action.target) return tempState
    const obj = getEvaluatedTransformState(id)
    return obj ? (obj as unknown as WriteableState) : undefined
  }
  const globalCoords = localToGlobal(tempState, getObjState)
  if (params['x'] !== undefined) params['x'] = globalCoords.x
  if (params['y'] !== undefined) params['y'] = globalCoords.y
}

/**
 * Handle Action update generated by drag/scale/rotate
 * v9.2: Support animation mode (tween_transform) and layout mode (set_transform)
 */
async function handleActionUpdate(action: ActionUpdatePayload): Promise<void> {
  if (!props.sceneId || !props.blockId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return

  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return

  // Special camera handling: use camera_move action
  if (action.target === 'camera') {
    await handleCameraActionUpdate(action, block)
    return
  }

  // v12.7: Check if object is despawned, despawned objects forbidden from creating Action
  // Directly get current environment object from store (in Action Mode it is fully resolved runtimeObj)
  const currentObj = sceneObjectStore.getObject(action.target)
  if (currentObj?.spawned === false) {
    console.warn('[ActionEditor] v12.7: Cannot create action for despawned object')
    return
  }

  // Transform Origin change always uses set_transform (instant Action),
  // cannot be erroneously written as duration action just because tween_transform is selected.
  if (action.type === 'set_origin') {
    handleSetTransformUpdate(action, block)
  // v14.1: If user selected transform action, prioritize updating that action (aligned with camera logic)
  } else if (selectedAction.value &&
      (selectedAction.value.type === 'set_transform' || selectedAction.value.type === 'tween_transform') &&
      selectedAction.value.target === action.target) {
    if (selectedAction.value.type === 'set_transform') {
      handleSetTransformUpdate(action, block)
    } else {
      handleTweenTransformUpdate(action, block)
    }
  } else if (objectRecordMode.value === 'layout') {
    // Instant mode - create/update set_transform
    handleSetTransformUpdate(action, block)
  } else {
    // Tween mode - create/update tween_transform
    handleTweenTransformUpdate(action, block)
  }
  
  // v8.4: Refresh Ghost/Real state
  await refreshGhostRealStates()
  markLocalChange()
}

/**
 * v9.2: Handle drag under layout mode - create/update set_transform (point action)
 */
function handleSetTransformUpdate(action: ActionUpdatePayload, block: ScriptBlock) {
  // Check if current slot already has set_transform action for this target (including geometry attributes)
  const existingActionIndex = block.actions.findIndex((a: Action) => {
    if (a.type !== 'set_transform' || a.target !== action.target) return false
    return a.slotIndex === currentSlotIndex.value
  })

  // Build params based on operation type
  let params: Record<string, number> = {}
  if (action.type === 'move') {
    params = { x: action.params.x, y: action.params.y }
  } else if (action.type === 'scale') {
    // v9.4: Save position compensation during scaling to ensure visual center stays fixed
    params = {
      scaleX: action.params.scaleX,
      scaleY: action.params.scaleY,
      ...(action.params.x !== undefined ? { x: action.params.x } : {}),
      ...(action.params.y !== undefined ? { y: action.params.y } : {})
    }
  } else if (action.type === 'rotate') {
    // Transform Origin compensation: rotation changes logic center, save x/y synchronously
    params = {
      rotation: action.params.rotation,
      ...(action.params.x !== undefined ? { x: action.params.x } : {}),
      ...(action.params.y !== undefined ? { y: action.params.y } : {})
    }
  } else if (action.type === 'set_origin') {
    params = {
      transformOriginX: action.params.transformOriginX,
      transformOriginY: action.params.transformOriginY
    }
  }

  // v17/v27:
  // - x/y stored as global coordinates
  // - rotation/scale/transformOrigin retain object's local values
  normalizeTransformPositionParams(action, params)

  if (existingActionIndex !== -1) {
    // Update existing set_transform action
    const existingAction = block.actions[existingActionIndex]! as SetTransformAction
    existingAction.params = { ...existingAction.params, ...params }
    
    const episodeId = route.params['id'] as string
    episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
      actions: block.actions
    })
    
    selectedAction.value = block.actions[existingActionIndex]!
  } else {
    // Create new set_transform action (point action)
    const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    const newAction: Action = {
      id: actionId,
      type: 'set_transform',
      category: 'point',
      target: action.target,
      slotIndex: currentSlotIndex.value,
      params
    } as unknown as Action
    
    if (!block.actions) {
      block.actions = []
    }
    
    appendActionWithSlotOrder(block.actions, newAction)
    
    const episodeId = route.params['id'] as string
    episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
      actions: block.actions
    })
    
    selectedAction.value = newAction
  }
}

/**
 * v9.2: Handle drag under animation mode - create/update tween_transform (duration action)
 * Logic is identical to original handleActionUpdate
 */
function handleTweenTransformUpdate(action: ActionUpdatePayload, block: ScriptBlock) {
  // Check if current slot already has tween_transform action for this target (or duration action covering slot)
  const existingActionIndex = block.actions.findIndex((a: Action) => {
      if (a.type !== 'tween_transform' || a.target !== action.target) return false
      // v7.25: Use isActionActiveAtSlot to check if action covers current slot
      return isActionActiveAtSlot(a as Action, currentSlotIndex.value)
    }
  )

  // Build params based on operation type (unified before update/create)
  let params: Record<string, number> = {}
  if (action.type === 'move') {
    params = { x: action.params.x, y: action.params.y }
  } else if (action.type === 'scale') {
    // v9.4: Save position compensation during scaling
    params = {
      scaleX: action.params.scaleX,
      scaleY: action.params.scaleY,
      ...(action.params.x !== undefined ? { x: action.params.x } : {}),
      ...(action.params.y !== undefined ? { y: action.params.y } : {})
    }
  } else if (action.type === 'rotate') {
    // Transform Origin compensation: rotation changes logic center, save x/y synchronously
    params = {
      rotation: action.params.rotation,
      ...(action.params.x !== undefined ? { x: action.params.x } : {}),
      ...(action.params.y !== undefined ? { y: action.params.y } : {})
    }
  } else if (action.type === 'set_origin') {
    params = {
      transformOriginX: action.params.transformOriginX,
      transformOriginY: action.params.transformOriginY
    }
  }

  // v17/v27:
  // - x/y stored as global coordinates
  // - rotation/scale/transformOrigin retain object's local values
  normalizeTransformPositionParams(action, params)

  if (existingActionIndex !== -1) {
    // Update existing action (params converted to global coordinates)
    const existingAction = block.actions[existingActionIndex]! as TweenTransformAction
    if (existingAction.params) {
      Object.assign(existingAction.params, params)
    }
    
    const episodeId = route.params['id'] as string
    episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
      actions: block.actions
    })
    
    selectedAction.value = block.actions[existingActionIndex]!
  } else {
    // Create new tween_transform action (params converted to global coordinates)
    const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    const newAction: Action = {
      id: actionId,
      type: 'tween_transform',
      category: 'duration',
      target: action.target,
      slotIndex: currentSlotIndex.value,
      slotSpan: 1,
      easing: 'linear',
      params
    } as unknown as Action

    if (!block.actions) {
      block.actions = []
    }
    
    appendActionWithSlotOrder(block.actions, newAction)
    
    const episodeId = route.params['id'] as string
    episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
      actions: block.actions
    })
    
    selectedAction.value = newAction
  }
}

/**
 * Handle camera Action update
 * v6.5: Support both camera_cut and camera_move modes
 * - If camera action is currently selected, update that action
 * - If not, create new action according to cameraRecordMode
 */
async function handleCameraActionUpdate(action: ActionUpdatePayload, block: ScriptBlock): Promise<void> {
  const slotIndex = currentSlotIndex.value
  
  // Determine target action type:
  // 1. If current selection is camera action, preserve its type
  // 2. Otherwise use cameraRecordMode (default camera_cut)
  let targetActionType: 'camera_cut' | 'camera_move' = cameraRecordMode.value
  if (selectedAction.value && 
      (selectedAction.value.type === 'camera_cut' || selectedAction.value.type === 'camera_move')) {
    targetActionType = selectedAction.value.type
  }
  
  // v21: camera_cut + camera_move allowed to coexist (analogous to set_transform + tween_transform)
  // camera_follow exclusive -> editing forbidden
  const hasFollow = block.actions.some((a: Action) =>
    a.type === 'camera_follow' && a.target === 'camera' && isActionActiveAtSlot(a, slotIndex)
  )
  if (hasFollow) return

  // Search cut and move respectively
  const existingCutIndex = block.actions.findIndex((a: Action) =>
    a.type === 'camera_cut' && a.target === 'camera' && isActionActiveAtSlot(a, slotIndex)
  )
  const existingMoveIndex = block.actions.findIndex((a: Action) =>
    a.type === 'camera_move' && a.target === 'camera' && isActionActiveAtSlot(a, slotIndex)
  )

  // Determine edit target: prioritize selectedAction > cut > move
  let editTargetIndex = -1
  if (selectedAction.value &&
      (selectedAction.value.type === 'camera_cut' || selectedAction.value.type === 'camera_move') &&
      selectedAction.value.target === 'camera' &&
      isActionActiveAtSlot(selectedAction.value, slotIndex)) {
    editTargetIndex = block.actions.indexOf(selectedAction.value)
  } else if (existingCutIndex !== -1) {
    editTargetIndex = existingCutIndex
  } else if (existingMoveIndex !== -1) {
    editTargetIndex = existingMoveIndex
  }
  
  // v6.5: Camera zoom inverse logic
  let zoomValue: number | undefined
  if (action.type === 'scale') {
    const inverseScale = 1 / action.params.scaleX
    zoomValue = Math.round(inverseScale * 10) / 10
    zoomValue = Math.max(0.1, Math.min(10, zoomValue))
  }
  
  if (editTargetIndex !== -1) {
    // Update existing camera action
    const existingAction = block.actions[editTargetIndex]! as CameraCutAction | CameraMoveAction
    if (!existingAction.params) existingAction.params = { x: 0, y: 0, zoom: 1 }
    
    if (action.type === 'move') {
      existingAction.params.x = Math.round(action.params.x)
      existingAction.params.y = Math.round(action.params.y)
    } else if (action.type === 'scale' && zoomValue !== undefined) {
      existingAction.params.zoom = zoomValue
    }
    
    const episodeId = route.params['id'] as string
    episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
      actions: block.actions
    })
    
    selectedAction.value = block.actions[editTargetIndex]!
  } else {
    // Create new camera action (default camera_cut)
    const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    let params: Record<string, number> = {}
    if (action.type === 'move') {
      // v21: Camera zoom already synchronized to runtimeObjects by applySlotState
      const cameraObj = sceneObjectStore.objects.find(o => o.type === 'camera') as import('@/stores/sceneObjectStore').CameraObject | undefined
      const evaluatedZoom = cameraObj?.zoom ?? 1.0
      
      params = {
        x: Math.round(action.params.x),
        y: Math.round(action.params.y),
        zoom: evaluatedZoom
      }
    } else if (action.type === 'scale' && zoomValue !== undefined) {
      params = { zoom: zoomValue }
    }
    
    const isPointAction = targetActionType === 'camera_cut'
    
    const newAction = {
      id: actionId,
      type: targetActionType,
      category: isPointAction ? 'point' : 'duration',
      target: 'camera',
      slotIndex,
      ...(isPointAction ? {} : { slotSpan: 1, easing: 'linear' }),
      params
    } as unknown as Action
    
    if (!block.actions) {
      block.actions = []
    }
    
    appendActionWithSlotOrder(block.actions, newAction)
    
    const episodeId = route.params['id'] as string
    episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
      actions: block.actions
    })
    
    selectedAction.value = newAction
  }
  
  // v8.4: Refresh Ghost/Real state
  await refreshGhostRealStates()
  markLocalChange()
}

onMounted(async () => {
  if (!canvasContainer.value) {
    console.error('[ActionEditor] Canvas container not found')
    return
  }

  const rendererInstance = useSceneRenderer({
    canvasContainer: canvasContainer.value,
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    mode: 'action',
    episodeId: route.params['id'] as string,
    sceneId: props.sceneId,
    blockId: props.blockId,
    onActionUpdate: handleActionUpdate
  })
  
  renderer.value = rendererInstance
  rendererInstance.setAutoRenderEnabled(false)
  await rendererInstance.initRenderer()
  
  // Initialize through-list defaults moved after loading scene state
  // Load initial state
  if (props.sceneId && props.blockId && props.episode) {
    const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
    if (scene) {
      // const prevContext... (removed)
      const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
      if (block) {
        // v24: Register episode auto-sync target
        sceneObjectStore.registerEpisodeSync(scene.setup)

        // v7.24: In Action Mode, sceneObjectStore should always store Scene Setup State (scene.setup)
        // rather than PrevContext or Final State, ensuring properties panel displays scene initial setup values
        loadSetupToSceneObjects(scene.setup)
        
        // Dual-layer architecture: When entering Action Mode initially, Action Mode must be explicitly activated.
        // loadSetupToSceneObjects loads data into setupObjects,
        // setActionMode(true) deep copies setupObjects -> runtimeObjects,
        // ensuring subsequent applySlotState can write calculated properties like parentId into runtimeObjects.
        sceneObjectStore.setActionMode(true)
        // currentTime.value = 0 // removed
        // v7.17: Refactor: Remove BlockPlayer and playback logic
      // initBlockPlayer() // Removed
      
      // Set Action Mode context
      const sceneGraph = rendererInstance.getSceneGraph()
      if (sceneGraph) {
        await sceneGraph.setActionModeContext(scene, block)
        
        // Synchronously compute and apply slot states to ensure parentId is written to runtimeObjects before Vue reactive flush
        sceneGraph.updateSlotIndex(0) // Initial state is slot 0
        const slotStates = sceneGraph.getGhostStates()
        if (slotStates) {
          sceneObjectStore.applySlotState(slotStates)
        }
      }
      }
    }
  }
  
  // Initialize through-list defaults (camera auto-added, must be after loadSetupToSceneObjects)
  rendererInstance.getSceneGraph().initPassThroughDefaults()
  await rendererInstance.renderObjects()

  // v7.10: Under initial state (Preroll), trigger one Target State calculation and log output
  // Ensure Preroll status log is visible upon entering page
  handleSceneUpdateBySlot()

  // Dual-layer architecture: parentId automatically synced by applySlotState() in updateActionModeObjects
  // No longer need to manually call setAccumulatedParentIds

  rendererInstance.setAutoRenderEnabled(true)
  setTimeout(() => {
    rendererInstance.scrollToCanvasCenter()
  }, 100)

  // Watch object changes
  watch(
    () => sceneObjectStore.objects.length,
    () => {
      if (renderer.value && !sceneObjectStore.getIsActionMode()) {
        void renderer.value.renderObjects()
      }
    }
  )

  watch(
    () => sceneObjectStore.objects.map(o => ({ 
      id: o.id, 
      expression: undefined,
      visible: o.visible 
    })),
    () => {
      if (renderer.value && !sceneObjectStore.getIsActionMode()) {
        void renderer.value.renderObjects()
      }
    },
    { deep: true }
  )

  document.addEventListener('keydown', handleKeyDown)
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('fullscreenchange', handleFullscreenChange)

  // v8.6: leftPanelCollapsed watcher removed (left sidebar removed)
  watch([rightPanelCollapsed], () => {
    setTimeout(() => {
      if (renderer.value) {
        renderer.value.updateTransformParams()
        // v7.23: Use handleSceneUpdateBySlot() to ensure Action Mode state
        handleSceneUpdateBySlot()
      }
    }, 300)
  })

  // v8.6: leftPanelWidth watcher removed (left sidebar removed)
  watch([rightPanelWidth], () => {
    requestAnimationFrame(() => {
      if (renderer.value) {
        renderer.value.updateTransformParams()
        // v7.23: Use handleSceneUpdateBySlot() to ensure Action Mode state
        handleSceneUpdateBySlot()
      }
    })
  })

  // P2: Grouping mode highlight — watch pendingIds changes, sync to renderer
  watch(
    () => actionGroupingState.value?.pendingIds.slice() ?? [],
    (ids) => {
      if (renderer.value) {
        renderer.value.setGroupingPendingIds(ids)
      }
    },
    { deep: true }
  )

  // Dual-layer architecture: accumulatedParentIds watcher removed
  // parentId automatically synced to runtimeObjects by applySlotState() on each updateActionModeObjects

  // Watch Block actions changes
  watch(
    () => {
      if (props.sceneId && props.blockId && props.episode) {
        const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
        const block = scene?.script.find((b: ScriptBlock) => b.id === props.blockId)
        return {
          blockActions: block?.actions ? JSON.stringify(block.actions) : null,
          blockId: props.blockId
        }
      }
      return null
    },
    (newVal, oldVal) => {
      if (!props.sceneId || !props.blockId || !props.episode) return
      if (newVal && oldVal && newVal.blockActions !== oldVal.blockActions) {
        const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
        if (scene && props.blockId) {
          const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
          if (block) {
            const prevContext = calculatePrevContext(scene, props.blockId)
            // v7.23: In Action Mode, renderer baseline state should be Setup State (prevContext)
            // avoid redundant action stacking
            
            if (renderer.value?.updateActionModeState) {
              renderer.value.updateActionModeState(prevContext)
            }
          }
        }
      }
    },
    { deep: true }
  )
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  
  
  if (renderer.value) {
    // Clear Action Mode context
    const sceneGraph = renderer.value.getSceneGraph()
    if (sceneGraph) {
      sceneGraph.clearActionModeContext()
    }
    renderer.value.destroyRenderer()
    renderer.value = null
  }
  // v24: Unregister episode sync target
  sceneObjectStore.registerEpisodeSync(null)
  sceneObjectStore.clearObjects()
})

// v24.1: Defensive watch — if parent component replaces episode object under same sceneId+blockId
// (e.g. episodeStore internal rebuild), re-register sync target to prevent writing detached stale objects.
watch(
  () => {
    if (!props.episode || !props.sceneId) return null
    const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
    return scene?.setup ?? null
  },
  (newSetup) => {
    if (newSetup && sceneObjectStore.getIsActionMode()) {
      sceneObjectStore.registerEpisodeSync(newSetup)
    }
  },
)

function handleFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
  setTimeout(() => {
    if (renderer.value) {
      renderer.value.updateTransformParams()
      // v7.23: Use handleSceneUpdateBySlot() to ensure Action Mode state
      handleSceneUpdateBySlot()
    }
  }, 100)
}

// v9.2: Click outside area to close add asset menu
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.add-menu-container')) {
    showAddMenu.value = false
  }
}

function handleKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return
  }

  // P2: ESC to exit grouping mode
  if (event.key === 'Escape' && actionGroupingState.value) {
    actionGroupingState.value = null
    event.preventDefault()
  }
}

function handleSelectObject(objectId: string | null) {
  sceneObjectStore.selectObject(objectId)
  if (objectId) {
    selectedAction.value = null
    // v14.1: Reset recording mode to instant when switching objects (User Rule 4)
    objectRecordMode.value = 'layout'
    
    // v6.9: When camera object selected, check if current slot has camera_cut/camera_move action
    // Only allow dragging camera if such action exists, otherwise disallow
    const selectedObj = sceneObjectStore.getObject(objectId)
    if (selectedObj?.type === 'camera' && renderer.value) {
      // Check if current slot has draggable camera action
      const currentCameraAction = currentSlotCameraAction.value
      const canDrag = currentCameraAction?.type === 'camera_cut' || currentCameraAction?.type === 'camera_move'
      renderer.value.setSelectedActionType(canDrag ? currentCameraAction.type : null)
    }
  }
}

// v6.5: Watch selected camera action type change, sync to cameraRecordMode
// v6.6: Simultaneously notify renderer of selected action type (used to constrain camera drag)
// v6.8: Extended logic: when camera object selected but no action selected, use cameraRecordMode
watch(selectedAction, (action) => {
  if (action && (action.type === 'camera_cut' || action.type === 'camera_move')) {
    cameraRecordMode.value = action.type
  }
  
  // v21: camera_follow dragging forbidden, allowed in other cases
  if (renderer.value) {
    if (action?.type === 'camera_follow') {
      renderer.value.setSelectedActionType('camera_follow')
    } else if (action?.type === 'camera_cut' || action?.type === 'camera_move') {
      renderer.value.setSelectedActionType(action.type)
    } else {
      // No camera action selected -> use cameraRecordMode (default camera_cut)
      renderer.value.setSelectedActionType(cameraRecordMode.value)
    }
  }
})

// Watch scene object selection change: deselect Action when user picks object on canvas
watch(
  () => sceneObjectStore.selectedObjectId,
  (newObjectId, oldObjectId) => {
    // Process only when object selection actually changes
    if (newObjectId !== oldObjectId && newObjectId) {
      const currentAction = selectedAction.value
      const shouldKeepAction =
        currentAction?.type === 'set_transform' &&
        findObjectIdByTarget(currentAction.target) === newObjectId

      if (!shouldKeepAction) {
        selectedAction.value = null
      }
      
      // v21: When camera object selected, camera_follow dragging forbidden, allowed in other cases
      const selectedObj = sceneObjectStore.getObject(newObjectId)
      if (selectedObj?.type === 'camera' && renderer.value) {
        const actions = currentBlock.value?.actions ?? []
        const hasFollow = actions.some((a: Action) =>
          a.type === 'camera_follow' && a.target === 'camera' && isActionActiveAtSlot(a, currentSlotIndex.value)
        )
        if (hasFollow) {
          renderer.value.setSelectedActionType('camera_follow')
        } else {
          // Use cut/move type if present, otherwise use cameraRecordMode (default camera_cut)
          const posAction = actions.find((a: Action) =>
            (a.type === 'camera_cut' || a.type === 'camera_move') && a.target === 'camera' && isActionActiveAtSlot(a, currentSlotIndex.value)
          )
          renderer.value.setSelectedActionType(posAction?.type ?? cameraRecordMode.value)
        }
      }
    }
  }
)

// v6.9: Watch cameraRecordMode change
// When camera selected and no action selected, decide whether drag allowed based on camera action type at current slot
watch(cameraRecordMode, () => {
  // v21: Sync drag permissions when switching cameraRecordMode
  if (renderer.value && !selectedAction.value) {
    const selectedObj = sceneObjectStore.getSelectedObject()
    if (selectedObj?.type === 'camera') {
      const actions = currentBlock.value?.actions ?? []
      const hasFollow = actions.some((a: Action) =>
        a.type === 'camera_follow' && a.target === 'camera' && isActionActiveAtSlot(a, currentSlotIndex.value)
      )
      renderer.value.setSelectedActionType(hasFollow ? 'camera_follow' : cameraRecordMode.value)
    }
  }
})

// DEBUG: Watch camera object in store, ensure Setup data not polluted
watch(() => {
  const camera = sceneObjectStore.objects.find(o => o.type === 'camera')
  return camera ? { zoom: (camera as { zoom?: number }).zoom, width: camera.width, height: camera.height } : null
}, (newVal, oldVal) => {
  if (newVal && oldVal && (newVal.zoom !== oldVal.zoom)) {
    logService.addLog(`[ActionEditor] Store Camera Zoom Changed: ${oldVal.zoom} -> ${newVal.zoom}`)
  }
}, { deep: true })

// v6.5: Handle camera recording mode switch
function handleCameraRecordModeChange(mode: 'camera_cut' | 'camera_move') {
  cameraRecordMode.value = mode
}

// v9.2: Handle object recording mode switch (Animation/Layout)
function handleObjectRecordModeChange(mode: 'animation' | 'layout') {
  objectRecordMode.value = mode
}

// v9.3: handleVisualActionUpdate moved to line 2547, supporting auto-selection

// v21: Camera action mutual exclusion strategy refactored
// camera_cut + camera_move allowed to coexist (analogous to set_transform + tween_transform)
// camera_follow exclusive (mutually exclusive with cut/move)
// camera_shake coexists with any action
// v6.5: Camera action at current slot
// v6.7: Prioritize returning mutually exclusive actions; shake can coexist
const currentSlotCameraAction = computed((): Action | null => {
  if (!currentBlock.value) return null
  const actions = currentBlock.value.actions ?? []
  
  // v21: Prioritize camera_follow (exclusive), then cut/move, finally shake
  const followAction = actions.find(
    (a: Action) => isCameraFollowAction(a.type) && a.target === 'camera' && isActionActiveAtSlot(a, currentSlotIndex.value)
  )
  if (followAction) return followAction
  
  const posAction = actions.find(
    (a: Action) => isCameraPositionAction(a.type) && a.target === 'camera' && isActionActiveAtSlot(a, currentSlotIndex.value)
  )
  if (posAction) return posAction
  
  return actions.find(
    (a: Action) => a.type === 'camera_shake' && a.target === 'camera' && isActionActiveAtSlot(a, currentSlotIndex.value)
  ) as Action | null
})

// v6.7: Whether shake action exists at current slot
const currentSlotHasShake = computed((): boolean => {
  if (!currentBlock.value) return false
  const actions = currentBlock.value.actions ?? []
  return actions.some(
    (a: Action) => a.type === 'camera_shake' && a.target === 'camera' && isActionActiveAtSlot(a, currentSlotIndex.value)
  )
})

function pruneCameraConflicts(actions: Action[], keeper: Action): Action[] {
  return actions.filter(action => (
    action.id === keeper.id
    || findCameraConflict([action], keeper) !== action
  ))
}

function upsertCameraAction(actions: Action[], candidate: Action): Action {
  const existing = findUpsertableCameraAction(actions, candidate)

  if (existing) {
    existing.params = { ...(existing.params ?? {}), ...(candidate.params ?? {}) }
    if (candidate.category === 'duration') {
      const existingDuration = existing as unknown as BaseDurationAction
      const candidateDuration = candidate as unknown as BaseDurationAction
      existingDuration.easing = candidateDuration.easing ?? existingDuration.easing ?? 'linear'
    }
    const pruned = pruneCameraConflicts(actions, existing)
    actions.splice(0, actions.length, ...pruned)
    return existing
  }

  const pruned = pruneCameraConflicts(actions, candidate)
  actions.splice(0, actions.length, ...pruned)
  appendActionWithSlotOrder(actions, candidate)
  return candidate
}

// v6.5: Handle action create/update from camera properties panel
// v6.7: Support mutual exclusion logic - camera_cut/camera_move/camera_follow mutually exclusive, camera_shake coexists
function handleCameraActionFromPanel(
  actionType: 'camera_cut' | 'camera_move' | 'camera_follow' | 'camera_shake',
  params: Record<string, unknown>
) {
  if (!props.sceneId || !props.blockId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return
  
  if (!block.actions) {
    block.actions = []
  }
  
  const slotIndex = currentSlotIndex.value

  const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const category = actionType === 'camera_cut' ? 'point' : 'duration'
  const actionParams = { ...params }
  const easing = (actionParams['easing'] as string | undefined) ?? 'linear'
  delete actionParams['easing']

  const newAction: Action = {
    id: actionId,
    type: actionType,
    category,
    target: 'camera',
    slotIndex,
    params: actionParams,
  } as Action

  if (category === 'duration') {
    ;(newAction as unknown as BaseDurationAction).slotSpan = 1
    ;(newAction as unknown as BaseDurationAction).easing = easing
  }

  selectedAction.value = upsertCameraAction(block.actions, newAction)
  
  // Refresh cameraRecordMode
  if (actionType === 'camera_cut' || actionType === 'camera_move') {
    cameraRecordMode.value = actionType
  }
  
  // Save to store
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })
  
  // v8.4: Use unified refresh function
  void refreshGhostRealStates()
  markLocalChange()
}

/**
 * v7.55: handleEnterSetCharacterAction removed - character type deleted
 */

/**
 * Handle object property updates under Action Mode
 * Automatically generate Point Action
 */
function handleObjectUpdateInActionMode(updatedObject: SceneObject) {
  if (!props.sceneId || !props.blockId || !props.episode) return
  
  const selected = sceneObjectStore.getSelectedObject()
  if (!selected) return
  
  // Get target alias
  const targetAlias = getTargetAliasFromObject(selected)
  if (!targetAlias) {
    // Unsupported object type, update display only
    // v7.20: In Action Mode Store should not be modified; if action generation unsupported, return directly
    // Considering unsupported objects (like BGM) usually have no visual properties, return directly to avoid polluting Store
    // sceneObjectStore.updateObject(selected.id, updatedObject)
    return
  }
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return
  
  if (!block.actions) {
    block.actions = []
  }
  
  // v7.22: Use Setup State as baseline for Diff
  // User requirement: properties panel displays Setup state only, so changes here are based on Setup values
  // No longer use selectedObjectRuntimeState
  const updatedState = getObjectRuntimeState(updatedObject)
  const originalState = getObjectRuntimeState(selected)
  
  if (!originalState || !updatedState) {
    // sceneObjectStore.updateObject(selected.id, updatedObject)
    return
  }
  
  // v7.20: Modifying Store forbidden in Action Mode, driven by Action only
  // sceneObjectStore.updateObject(selected.id, updatedObject)
  
  // Determine whether it is a character object
  // character type removed
  
  // v7.26: Audio object handling
  if (selected.type === 'audio') {
    type LegacyAudioObject = AudioObject & { autoPlay?: boolean }
    const audioObj = selected as unknown as LegacyAudioObject
    const updatedAudio = updatedObject as unknown as LegacyAudioObject
    const diff: Record<string, unknown> = {}
    
    if (audioObj.volume !== updatedAudio.volume) diff['volume'] = updatedAudio.volume
    if (audioObj.loop !== updatedAudio.loop) diff['loop'] = updatedAudio.loop
    
    // autoPlay mapped to action: play/stop
    if (audioObj.autoPlay !== updatedAudio.autoPlay) {
      diff['action'] = updatedAudio.autoPlay ? 'play' : 'stop'
    }
    
    if (Object.keys(diff).length > 0) {
      // If no explicit action change, supply default action to ensure action validity
      diff['action'] ??= updatedAudio.autoPlay ? 'play' : 'stop'
      upsertPointAction('set_audio', targetAlias, currentSlotIndex.value, { params: diff })
    }
    return
  }

  // Text object handling: calculate text params diff, create/update set_text
  if (selected.type === 'text') {
    const textObj = selected as TextObject
    const updatedText = updatedObject as TextObject
    const textDiff: Record<string, unknown> = {}

    const textKeys: (keyof TextObject)[] = [
      'content', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle',
      'color', 'align', 'wordWrap', 'wordWrapWidth',
      'stroke', 'strokeThickness',
      'dropShadow', 'dropShadowColor', 'dropShadowBlur', 'dropShadowAngle', 'dropShadowDistance',
      'letterSpacing', 'lineHeight', 'textBoxMode', 'writingMode',
      'revealSpeed', 'fillType', 'gradientStops', 'gradientAngle',
      'textBackgroundEnabled', 'textBackgroundColor', 'textBackgroundAlpha',
      'textBackgroundPaddingX', 'textBackgroundPaddingY', 'textBackgroundRadius',
    ]

    for (const key of textKeys) {
      const oldVal = textObj[key]
      const newVal = updatedText[key]
      const changed = Array.isArray(oldVal) || Array.isArray(newVal)
        ? JSON.stringify(oldVal) !== JSON.stringify(newVal)
        : oldVal !== newVal
      if (changed && newVal !== undefined) {
        textDiff[key as string] = newVal
      }
    }

    if (Object.keys(textDiff).length > 0) {
      upsertPointAction('set_text', targetAlias, currentSlotIndex.value, { params: textDiff })
    }
    // Do not return, fall through to generic transform diff (handles alpha/visible/flipX/zIndex)
  }
  
  // Light object handling: calculate light params diff, create set_light or tween_light based on recording mode
  // Note: Do not return; let subsequent code continue processing transform properties (alpha/visible/flipX/zIndex)
  if (selected.type === 'light') {
    const lightObj = selected as LightObject
    const updatedLight = updatedObject as LightObject
    const lightDiff: Record<string, unknown> = {}
    
    if (lightObj.lightColor !== updatedLight.lightColor) lightDiff['lightColor'] = updatedLight.lightColor
    if (lightObj.lightIntensity !== updatedLight.lightIntensity) lightDiff['lightIntensity'] = updatedLight.lightIntensity
    if (lightObj.lightRadius !== updatedLight.lightRadius) lightDiff['lightRadius'] = updatedLight.lightRadius
    // Phase 1: Flickering and directivity
    if (lightObj.flicker !== updatedLight.flicker) lightDiff['flicker'] = updatedLight.flicker
    if (lightObj.flickerSpeed !== updatedLight.flickerSpeed) lightDiff['flickerSpeed'] = updatedLight.flickerSpeed
    if (lightObj.directionMode !== updatedLight.directionMode) lightDiff['directionMode'] = updatedLight.directionMode
    if (lightObj.directionAngle !== updatedLight.directionAngle) lightDiff['directionAngle'] = updatedLight.directionAngle
    if (lightObj.coneAngle !== updatedLight.coneAngle) lightDiff['coneAngle'] = updatedLight.coneAngle
    
    if (Object.keys(lightDiff).length > 0) {
      if (objectRecordMode.value === 'animation') {
        upsertDurationAction(targetAlias, currentSlotIndex.value, lightDiff, 'tween_light')
      } else {
        upsertPointAction('set_light', targetAlias, currentSlotIndex.value, { params: lightDiff })
      }
    }
    // Do not return, fall through to generic transform diff (handles alpha/visible etc)
  }
  
  // Screen effect object handling: calculate params diff, create set_screen_effect or tween_screen_effect based on recording mode
  // Note: Do not return; let subsequent code continue processing transform properties (x/y/scaleX/scaleY/rotation/alpha/visible/flipX/zIndex)
  if (selected.type === 'screen_effect') {
    const effectObj = selected
    const updatedEffect = updatedObject as ScreenEffectObject
    const paramsDiff: Record<string, unknown> = {}
    
    // Compare params field by field
    const paramKeys = [
      'baseColor',
      'holeShape', 'holeCenterX', 'holeCenterY', 'holeWidth', 'holeHeight',
      'openRatio', 'feather',
      'targetId', 'offsetX', 'offsetY'
    ] as const
    
    for (const key of paramKeys) {
      const effectParams = (effectObj as ScreenEffectObject).params
      if (!effectParams) throw new Error(`Screen effect object ${effectObj.id} has no params`)
      const oldVal = effectParams[key]
      const newVal = updatedEffect.params[key]
      if (oldVal !== newVal && newVal !== undefined) {
        paramsDiff[key] = newVal
      }
    }
    
    if (Object.keys(paramsDiff).length > 0) {
      if (objectRecordMode.value === 'animation') {
        // Tween mode: create tween_screen_effect
        upsertDurationAction(targetAlias, currentSlotIndex.value, paramsDiff, 'tween_screen_effect')
      } else {
        // Instant mode: create set_screen_effect
        upsertPointAction('set_screen_effect', targetAlias, currentSlotIndex.value, { params: paramsDiff })
      }
    }
    // Do not return, continue falling through to generic transform diff logic below
  }
  
  // Clip-Mask Phase 1 D2: Mask exclusive field diff (targetIds / shape / width / height) -> set_mask
  // Note: mask transform fields (x/y/scaleX/scaleY/rotation/alpha/visible/flipX/zIndex)
  // still follow generic transform diff below.
  if (selected.type === 'mask') {
    const maskObj = selected as MaskObject
    const updatedMask = updatedObject as MaskObject
    const maskDiff: { targetIds?: string[]; shape?: 'rectangle' | 'ellipse'; width?: number; height?: number } = {}
    
    const oldTargets = maskObj.targetIds ?? []
    const newTargets = updatedMask.targetIds ?? []
    if (JSON.stringify(oldTargets) !== JSON.stringify(newTargets)) {
      maskDiff.targetIds = [...newTargets]
    }
    if (maskObj.shape !== updatedMask.shape) {
      maskDiff.shape = updatedMask.shape
    }
    if (maskObj.width !== updatedMask.width && Number.isFinite(updatedMask.width) && updatedMask.width > 0) {
      maskDiff.width = updatedMask.width
    }
    if (maskObj.height !== updatedMask.height && Number.isFinite(updatedMask.height) && updatedMask.height > 0) {
      maskDiff.height = updatedMask.height
    }
    
    if (Object.keys(maskDiff).length > 0) {
      upsertSetMaskAction(block.actions, targetAlias, currentSlotIndex.value, maskDiff)
    }
    // Do not return, fall through to handle transform properties
  }
  
  // character type removed, isCharacter always false - enters else branch directly
  {
    // Non-character objects: handle properties based on recording mode
    // v9.4: alpha creates tween_transform under tween mode; other visual properties always use set_transform
    const alphaChanged = originalState.alpha !== updatedState.alpha
    
    // alpha change in tween mode -> tween_transform
    if (alphaChanged && objectRecordMode.value === 'animation') {
      upsertDurationAction(targetAlias, currentSlotIndex.value, { alpha: updatedState.alpha })
    }
    
    // Instant properties (alpha instant mode + visible/flipX/zIndex) -> set_transform
    const visualDiff: Record<string, unknown> = {}
    if (alphaChanged && objectRecordMode.value !== 'animation') {
      visualDiff['alpha'] = updatedState.alpha
    }
    if (originalState.visible !== updatedState.visible) {
      visualDiff['visible'] = updatedState.visible
    }
    if (originalState.flipX !== updatedState.flipX) {
      visualDiff['flipX'] = updatedState.flipX
    }
    if (originalState.zIndex !== updatedState.zIndex) {
      visualDiff['zIndex'] = updatedState.zIndex
    }
    
    if (Object.keys(visualDiff).length > 0) {
      upsertPointAction('set_transform', targetAlias, currentSlotIndex.value, { params: visualDiff })
    }
  }
  
  // v8.4: Use unified refresh function
  void refreshGhostRealStates()
}

/**
 * Create or update Point Action
 * Actions of same slot, same object, and same type will be merged
 */
function upsertPointAction(
  type: 'set_transform' | 'set_active' | 'set_anim' | 'camera_cut' | 'set_audio' | 'set_screen_effect' | 'set_light' | 'set_text' | 'set_text_reveal',
  target: string,
  slotIndex: number,
  data: Partial<Action>
) {
  if (!props.sceneId || !props.blockId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return
  
  if (!block.actions) {
    block.actions = []
  }
  
  // v6.4: trigger_anim matches by target + slotIndex, merges animStates
  const existingIndex = block.actions.findIndex(
    (a: Action) => a.type === type && a.target === target && isActionActiveAtSlot(a, slotIndex)
  )
  
  if (existingIndex !== -1) {
    // Merge properties
    const existing = block.actions[existingIndex]!
    if (type === 'set_anim') {
      // v14.2: Merge animations array by animName, avoiding replacing whole array and losing entries
      const existingParams = (existing.params ?? {}) as Record<string, unknown>
      const newParams = (data.params ?? {}) as Record<string, unknown>
      const existingAnims = (existingParams['animations'] ?? []) as {animName: string; [key: string]: unknown}[]
      const newAnims = (newParams['animations'] ?? []) as {animName: string; [key: string]: unknown}[]
      for (const newAnim of newAnims) {
        const idx = existingAnims.findIndex(a => a.animName === newAnim.animName)
        if (idx !== -1) {
          existingAnims[idx] = { ...existingAnims[idx], ...newAnim }
        } else {
          existingAnims.push(newAnim)
        }
      }
      existing.params = {
        ...existingParams,
        ...newParams,
        animations: existingAnims
      } as typeof existing.params
    } else if (type === 'set_transform') {
      existing.params = { ...(existing.params ?? {}), ...(data.params ?? {}) }
    } else if (type === 'set_active') {
      (existing as unknown as { visible?: boolean }).visible = (data as unknown as { visible?: boolean }).visible ?? true
    } else if (type === 'camera_cut') {
      // Camera cut: merge x, y, zoom params
      existing.params = { ...(existing.params ?? {}), ...(data.params ?? {}) }
    } else if (type === 'set_audio') {
      // Audio trigger: merge action, volume, loop params
      existing.params = { ...(existing.params ?? {}), ...(data.params ?? {}) }
    } else if (type === 'set_screen_effect') {
      // Screen effect: merge effect params
      existing.params = { ...(existing.params ?? {}), ...(data.params ?? {}) }
    } else if (type === 'set_light') {
      // Light: merge light params
      existing.params = { ...(existing.params ?? {}), ...(data.params ?? {}) }
    } else if (type === 'set_text') {
      // Text: merge text property params
      existing.params = { ...(existing.params ?? {}), ...(data.params ?? {}) }
    } else if (type === 'set_text_reveal') {
      // Text reveal: merge play/stop params
      existing.params = { ...(existing.params ?? {}), ...(data.params ?? {}) }
    }
    
    // Select updated action
    selectedAction.value = block.actions[existingIndex]!
  } else {
    // Create new action
    const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const newAction = {
      id: actionId,
      type,
      category: 'point',
      target,
      slotIndex,
      ...data
    } as unknown as Action
    appendActionWithSlotOrder(block.actions, newAction)
    
    // Select newly created action
    selectedAction.value = newAction
  }
  
  // Save to store
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })
  
  // v8.4: Use unified refresh function
  void refreshGhostRealStates()
  
  markLocalChange()
}

/**
 * v9.4: Create or update tween_transform Duration Action
 * Used to create tween action from properties panel (e.g. opacity gradient)
 */
function upsertDurationAction(
  target: string,
  slotIndex: number,
  params: Record<string, unknown>,
  actionType: 'tween_transform' | 'tween_screen_effect' | 'tween_light' = 'tween_transform'
) {
  if (!props.sceneId || !props.blockId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return
  
  if (!block.actions) {
    block.actions = []
  }
  
  // Check if current slot already has same type action for this target
  const existingIndex = block.actions.findIndex((a: Action) => {
    if (a.type !== actionType || a.target !== target) return false
    return isActionActiveAtSlot(a, slotIndex)
  })
  
  if (existingIndex !== -1) {
    // Merge into existing action
    const existing = block.actions[existingIndex]!
    existing.params = { ...(existing.params ?? {}), ...params }
    selectedAction.value = existing
  } else {
    // Create new tween action
    const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const newAction = {
      id: actionId,
      type: actionType,
      category: 'duration',
      target,
      slotIndex,
      slotSpan: 1,
      easing: 'linear',
      params
    } as unknown as Action
    appendActionWithSlotOrder(block.actions, newAction)
    selectedAction.value = newAction
  }
  
  // Save to store
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })
  
  // Refresh state
  void refreshGhostRealStates()
  markLocalChange()
}

/**
 * Insert or update camera duration action (camera_move, camera_shake)
 */
// function upsertCameraDurationAction... (removed)

// v8.6: handleDeleteObject removed (left sidebar removed, deleting objects forbidden in Action mode)

function handleSaveAction() {
  if (!props.sceneId || !props.blockId || !props.episode) {
    console.error('[ActionEditor] Saving requires sceneId and blockId')
    return
  }

  const episodeId = route.params['id'] as string
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return

  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return

  if (!block.actions) {
    block.actions = []
  }

  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })

  projectStore.saveProject().then(() => {
    hasLocalChanges.value = false

    saveToastMessage.value = 'Saved successfully'
    saveToastType.value = 'success'
    showSaveToast.value = true
    setTimeout(() => {
      showSaveToast.value = false
    }, 2000)
  }).catch((err: unknown) => {
    console.error('[ActionEditor] Save failed:', err)
    saveToastMessage.value = 'Save failed, please try again'
    saveToastType.value = 'error'
    showSaveToast.value = true
    setTimeout(() => {
      showSaveToast.value = false
    }, 3000)
  })
}

function handlePreview() {
  showPreviewDialog.value = true
}

function handleReturn() {
  if (hasLocalChanges.value) {
    showSaveConfirmDialog.value = true
  } else {
    emit('exitSceneEdit')
  }
}

// Save and return
async function handleSaveAndExit() {
  showSaveConfirmDialog.value = false
  await handleSaveActionAsync()
  emit('exitSceneEdit')
}

// Discard modifications and return
function handleDiscardAndExit() {
  showSaveConfirmDialog.value = false
  emit('exitSceneEdit')
}

// v8.3: Open text editing dialog
function openTextEditDialog() {
  const block = currentBlock.value
  if (block && (block.type === 'dialogue' || block.type === 'narration')) {
    editingText.value = block.text ?? ''
    showTextEditDialog.value = true
  }
}

// v8.3: Save edited text
function saveEditedText() {

  const block = currentBlock.value

  if (block && props.episode && props.sceneId && props.blockId) {
    // v9.3: Use props.episode.id instead of route.params['id']
    const episodeId = props.episode.id
    const actions = block.actions ?? []

    // ① Save old slots snapshot (before updating text)
    const oldSlots = parseBlockToSlots(block)

    // ② Update text
    episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
      text: editingText.value
    })
    
    // ③ Parse new slots
    const newSlots = parseBlockToSlots({ ...block, text: editingText.value } as ScriptBlock)
    const maxSlotIndex = Math.max(0, newSlots.length - 1)

    // ④ Detect slot changes and execute precise migration
    let actionsModified = false
    const change = detectSlotTextChanges(oldSlots, newSlots)

    if (change?.type === 'insert') {
      migrateActionsOnSlotInsert(actions, change.index, change.count)
      actionsModified = true
    } else if (change?.type === 'delete') {
      migrateActionsOnSlotDelete(actions, change.index, change.count)
      actionsModified = true
    }

    // ⑤ Fallback: Cap and Clamp (handles complex changes or any missed out-of-bound cases)
    for (const action of actions) {
      if (action.slotIndex > maxSlotIndex) {
        action.slotIndex = maxSlotIndex
        actionsModified = true
      }
      // Duration slotSpan out-of-bounds correction
      if (action.category === 'duration') {
        const dAction = action as BaseDurationAction
        const maxSpan = maxSlotIndex - action.slotIndex + 1
        if ((dAction.slotSpan ?? 1) > maxSpan) {
          dAction.slotSpan = Math.max(1, maxSpan)
          actionsModified = true
        }
      }
    }
    
    // ⑥ If any Action was corrected, update store
    if (actionsModified) {
      episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
        actions: actions
      })
    }
    
    // ⑦ Check and correct currentSlotIndex
    if (currentSlotIndex.value > maxSlotIndex) {
      currentSlotIndex.value = maxSlotIndex
    }
    
    showTextEditDialog.value = false
    markLocalChange()
    
    // v9.2: After text modification, reparse slots and refresh action editor
    void refreshGhostRealStates()
  }
}

// Async save function
async function handleSaveActionAsync() {
  if (!props.sceneId || !props.blockId || !props.episode) {
    console.error('[ActionEditor] Saving requires sceneId and blockId')
    return
  }

  const episodeId = route.params['id'] as string
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return

  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return

  if (!block.actions) {
    block.actions = []
  }

  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })

  try {
    await projectStore.saveProject()
    hasLocalChanges.value = false

  } catch (error) {
    console.error('[ActionEditor] Save failed:', error)
  }
}

function handleSelectAction(action: Action | null) {
  selectedAction.value = action
  
  if (action) {
    currentSlotIndex.value = action.slotIndex
    
    // v6.8: When action selected, simultaneously select corresponding scene object
    const targetObjectId = findObjectIdByTarget(action.target)
    if (targetObjectId) {
      sceneObjectStore.selectObject(targetObjectId)
      
      // If camera action, synchronize drag state to renderer
      if (action.target === 'camera' && renderer.value) {
        const canDrag = action.type === 'camera_cut' || action.type === 'camera_move'
        renderer.value.setSelectedActionType(canDrag ? action.type : null)
      }
    }
  }
}

/**
 * v7.0: Find corresponding scene object ID by action target
 * target is now instance ID, may be: 'camera' or object ID
 */
function findObjectIdByTarget(target: string): string | null {
  // 1. Camera
  if (target === 'camera') {
    const cameraObj = sceneObjectStore.objects.find(obj => obj.type === 'camera')
    return cameraObj?.id ?? null
  }
  
  // 2. v7.0: Look up directly by instance ID
  const directObj = sceneObjectStore.getObject(target)
  if (directObj) {
    return directObj.id
  }

  const aliasObj = sceneObjectStore.objects.find(obj => obj.type !== 'camera' && obj.alias === target)
  if (aliasObj) {
    return aliasObj.id
  }
  
  return null
}

// ActionSequencer event handling
function handleSlotIndexChange(index: number) {
  currentSlotIndex.value = index
  selectedAction.value = null
  handleSceneUpdateBySlot()
}


function handleUpdateActionFromSequencer(action: Action, updates: Partial<Action>) {
  if (!props.sceneId || !props.blockId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block?.actions) return
  
  const index = block.actions.findIndex((a: Action) => a.id === action.id)
  if (index === -1) return
  
  const targetAction = block.actions[index]
  if (targetAction) {
    const previousSlotIndex = targetAction.slotIndex
    const nextSlotIndex = updates.slotIndex ?? previousSlotIndex
    const isMovingSlot = nextSlotIndex !== previousSlotIndex
    const nextUpdates = { ...updates }
    if (isMovingSlot) {
      delete nextUpdates.order
    }

    if (targetAction.target === 'camera' && isCameraActionType(targetAction.type)) {
      const candidate = { ...targetAction, ...nextUpdates } as Action
      const conflict = findCameraConflict(block.actions, candidate, { excludeId: targetAction.id })
      if (conflict) {
        saveToastMessage.value = 'Camera action conflict: Another camera action already exists in this time range'
        saveToastType.value = 'error'
        showSaveToast.value = true
        setTimeout(() => {
          showSaveToast.value = false
        }, 3000)
        return
      }
    }

    Object.assign(targetAction, nextUpdates)
    if (isMovingSlot) {
      applyActionSlotMoveOrderPolicy(block.actions, targetAction, previousSlotIndex, targetAction.slotIndex)
    }
  }
  
  if (selectedAction.value?.id === action.id) {
    selectedAction.value = { ...selectedAction.value, ...targetAction } as Action
  }
  
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })
  
  // Action Mode: Update scene graph context and re-render
  const sceneGraph3 = renderer.value?.getSceneGraph()
  if (renderer.value && sceneGraph3) {
    void refreshActionContextAndRender(scene, block)
  }
  
  markLocalChange()
}

function getActionObjectIndexMap(): Map<string, number> {
  const map = new Map<string, number>()
  sceneObjectStore.objects.forEach((obj, index) => {
    map.set(obj.id, index)
  })
  return map
}

function applyActionSlotMoveOrderPolicy(
  actions: Action[],
  action: Action,
  previousSlotIndex: number,
  nextSlotIndex: number
): void {
  if (nextSlotIndex === previousSlotIndex) return

  const sourceSlotWasCustom = hasCustomActionOrderForSlot(actions, previousSlotIndex)
  const targetSlotWasCustom = hasCustomActionOrderForSlot(
    actions.filter((existing: Action) => existing.id !== action.id),
    nextSlotIndex,
  )
  const objectIndexMap = getActionObjectIndexMap()

  if (sourceSlotWasCustom) {
    reconcileActionOrderForSlot(actions, previousSlotIndex, { mode: 'custom', objectIndexMap })
  }

  if (targetSlotWasCustom) {
    reconcileActionOrderForSlot(actions, nextSlotIndex, {
      mode: 'custom',
      appendActionId: action.id,
      objectIndexMap,
    })
  } else {
    delete action.order
  }
}

function handleReorderActionsInSlot(slotIndex: number, actionIds: string[]) {
  if (!props.sceneId || !props.blockId || !props.episode) return

  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return

  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block?.actions) return

  reconcileActionOrderForSlot(block.actions, slotIndex, {
    mode: 'custom',
    actionIds,
    objectIndexMap: getActionObjectIndexMap(),
  })

  if (selectedAction.value) {
    const latestSelected = block.actions.find((action: Action) => action.id === selectedAction.value?.id)
    if (latestSelected) {
      selectedAction.value = { ...latestSelected } as Action
    }
  }

  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })

  const sceneGraph = renderer.value?.getSceneGraph()
  if (renderer.value && sceneGraph) {
    void refreshActionContextAndRender(scene, block)
  }

  markLocalChange()
}

function handleResetActionOrderInSlot(slotIndex: number) {
  if (!props.sceneId || !props.blockId || !props.episode) return

  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return

  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block?.actions) return

  const changed = reconcileActionOrderForSlot(block.actions, slotIndex, { mode: 'default' })
  if (!changed) return

  if (selectedAction.value) {
    const latestSelected = block.actions.find((action: Action) => action.id === selectedAction.value?.id)
    if (latestSelected) {
      selectedAction.value = { ...latestSelected } as Action
    }
  }

  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })

  const sceneGraph = renderer.value?.getSceneGraph()
  if (renderer.value && sceneGraph) {
    void refreshActionContextAndRender(scene, block)
  }

  markLocalChange()
}


/**
 * P2: Unified object deletion (supports multiple IDs) — PIXI detach + Store/Episode removal + Actions filter + persistence + re-render
 */
function deleteCompositeObjects(idsToDelete: string[], compositeId?: string): void {
  const episode = props.episode
  if (!episode) return
  const scene = episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return

  // 1. PIXI hierarchy cleanup: child containers of composite container must be detached first
  const sceneGraphCleanup = renderer.value?.getSceneGraph()
  if (sceneGraphCleanup && compositeId) {
    const compositeContainer = sceneGraphCleanup.getContainer(compositeId)
    if (compositeContainer) {
      compositeContainer.removeChildren()
    }
  }

  // 2. Delete Store + Episode persistent data
  const allDeletedIds = new Set(idsToDelete)
  for (const id of idsToDelete) {
    sceneObjectStore.removeSetupObject(id)
  }
  // v24: removeSetupObject automatically overwrites episode internally (including onBeforeDelete cascade modifications + renderChain)

  // 3. Filter actions (target object)
  block.actions = (block.actions ?? []).filter((a: Action) => !allDeletedIds.has(a.target))

  // 4. Persistence + re-render
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })
  if (renderer.value && sceneGraphCleanup) {
    void refreshActionContextAndRender(scene, block)
  }
  markLocalChange()
}



function handleDeleteActionFromSequencer(action: Action) {
  if (!props.sceneId || !props.blockId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block?.actions) return
  
  const index = block.actions.findIndex((a: Action) => a.id === action.id)
  if (index === -1) return
  
  // v9.3: Check if spawn action, cascade delete if so
  if (isBirthAction(action)) {
    const targetId = action.target
    
    // Dual-layer architecture: Check from persistence layer if deleted object is composite
    const setupObj = sceneObjectStore.getSetupObject(targetId)
    const isComposite = setupObj?.type === 'composite'
    
    // P2: composite cascade handling — must collect info before filtering actions
    if (isComposite) {
      // Recursively collect all descendant IDs
      function collectAllDescendantIds(parentId: string): string[] {
        const parentSetup = sceneObjectStore.getSetupObject(parentId)
        let directChildIds: string[] = []
        if (parentSetup?.type === 'composite') {
          directChildIds = [...((parentSetup as unknown as { childIds: string[] }).childIds || [])]
        }
        const allIds = [...directChildIds]
        for (const childId of directChildIds) {
          const childObj = sceneObjectStore.getSetupObject(childId)
          if (childObj?.type === 'composite') {
            allIds.push(...collectAllDescendantIds(childId))
          }
        }
        return allIds
      }
      const affectedChildIds = collectAllDescendantIds(targetId)
      
      if (affectedChildIds.length > 0) {
        const compositeMode = (setupObj as unknown as { compositeMode?: string }).compositeMode ?? 'entity'
        if (compositeMode === 'entity') {
          // entity: Direct cascade deletion (no three-option dialog prompt)
          deleteCompositeObjects([targetId, ...affectedChildIds], targetId)
          console.log(`[ActionEditor] Cascade deleting entity composite ${targetId} + ${affectedChildIds.length} descendants`)
        } else {
          // union: Delete composite only (child objects bubble automatically via onBeforeDelete)
          deleteCompositeObjects([targetId], targetId)
          console.log(`[ActionEditor] Deleting only union composite ${targetId}, unbinding ${affectedChildIds.length} child objects`)
        }
      } else {
        // No child objects: delete directly
        deleteCompositeObjects([targetId], targetId)
        console.log(`[ActionEditor] Deleting composite ${targetId} (no children)`)
      }
    } else {
      // Non-composite: delete object directly
      deleteCompositeObjects([targetId])
      console.log(`[ActionEditor] Deleting dynamic object ${targetId} and all its actions`)
    }
    // deleteCompositeObjects already handled persistence + re-render, clean selection state and return
    if (selectedAction.value?.id === action.id) {
      selectedAction.value = null
    }
    return
  } else {
    // Normal action: delete action only
    block.actions.splice(index, 1)
  }
  
  if (selectedAction.value?.id === action.id) {
    selectedAction.value = null
  }
  
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })
  
  // Action Mode: Update scene graph context and re-render
  const sceneGraph4 = renderer.value?.getSceneGraph()
  if (renderer.value && sceneGraph4) {
    void refreshActionContextAndRender(scene, block)
  }
  
  markLocalChange()
}

function handleAddActionFromSequencer(type: string, target: string, slotIndex: number) {
  if (!props.sceneId || !props.blockId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return
  
  if (!block.actions) {
    block.actions = []
  }

  if (isCameraActionType(type)) {
    const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const category = type === 'camera_cut' ? 'point' : 'duration'
    const params = type === 'camera_follow'
      ? { followTarget: '', damping: 0, offsetX: 0, offsetY: -50, zoom: 1, constrainBounds: true }
      : type === 'camera_shake'
        ? { intensity: 10, decay: true, frequency: 30 }
        : { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y, zoom: 1 }

    const newAction: Action = {
      id: actionId,
      type,
      category,
      target: 'camera',
      slotIndex,
      params,
    } as Action

    if (category === 'duration') {
      ;(newAction as unknown as BaseDurationAction).slotSpan = 1
      ;(newAction as unknown as BaseDurationAction).easing = 'linear'
    }

    selectedAction.value = upsertCameraAction(block.actions, newAction)

    const episodeId = route.params['id'] as string
    episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
      actions: block.actions
    })

    markLocalChange()
    return
  }
  
  const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  
  let newAction: Action
  if (type === 'set_transform') {
    // Visual property action (replaces original set_active)
    newAction = {
      id: actionId,
      type: 'set_transform',
      category: 'point',
      target,
      slotIndex,
      params: { visible: true }
    } as Action
  } else if (type === 'camera_cut') {
    // Camera cut (instant action)
    newAction = {
      id: actionId,
      type: 'camera_cut',
      category: 'point',
      target: 'camera',
      slotIndex,
      params: { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y, zoom: 1 }  // Default canvas center
    } as Action
  } else if (type === 'camera_move') {
    // Camera move (duration action)
    newAction = {
      id: actionId,
      type: 'camera_move',
      category: 'duration',
      target: 'camera',
      slotIndex,
      slotSpan: 1,
      easing: 'linear',
      params: { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y, zoom: 1 }
    } as Action
  } else if (type === 'camera_shake') {
    // Camera shake (duration action)
    newAction = {
      id: actionId,
      type: 'camera_shake',
      category: 'duration',
      target: 'camera',
      slotIndex,
      slotSpan: 1,
      easing: 'linear',
      params: { intensity: 10, decay: true, frequency: 30 }
    } as Action
  } else if (type === 'set_material') {
    // v16: Switch symbol asset / v18: Switch expression reference
    const symbolObj = sceneObjectStore.getObject(target)
    let currentMaterialId = ''
    if (symbolObj?.type === 'symbol') {
      currentMaterialId = (symbolObj as unknown as { currentMaterialId?: string }).currentMaterialId ?? ''
    } else if (symbolObj?.type === 'expression') {
      currentMaterialId = symbolObj.refId ?? ''
    }
    newAction = {
      id: actionId,
      type: 'set_material',
      category: 'point',
      target,
      slotIndex,
      params: { materialId: currentMaterialId }
    } as Action
  } else {
    return
  }
  
  appendActionWithSlotOrder(block.actions, newAction)
  
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })
  
  selectedAction.value = newAction
  markLocalChange()
}

/* 
 * v7.17: Refactor: Remove playback control functions
 * Play/pause logic completely moved to preview dialog
function handlePlay() { ... }
function handlePause() { ... }
function handleStopPlayback() { ... }
*/

// v8.6: handleHoverAction removed (left sidebar removed)

// v8.6: handleRequestDeleteActionConfirm removed (ActionListPanel removed, but other deletion logic kept in ActionSequencer)

// v9.3: Handle visual property change (create or update set_visual action)
function handleVisualActionUpdate(params: { visible?: boolean; flipX?: boolean; zIndex?: number; receiveLighting?: boolean; castShadow?: boolean }) {
  if (!props.sceneId || !props.blockId || !props.episode) return
  
  const targetObject = sceneObjectStore.getSelectedObject()
  if (!targetObject) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return
  
  if (!block.actions) {
    block.actions = []
  }
  
  // Check if current slot already has set_visual action for this object
  const existingAction = block.actions.find((a: Action) => 
    a.type === 'set_visual' && 
    a.target === targetObject.id && 
    a.slotIndex === currentSlotIndex.value
  )
  
  if (existingAction) {
    // Update existing set_visual action
    const visualAction = existingAction as SetVisualAction
    visualAction.params = { ...visualAction.params, ...params }
    
    // Select this action
    selectedAction.value = visualAction
    
    console.log(`[ActionEditor] Update set_visual action: ${visualAction.id}`, params)
  } else {
    // Create new set_visual action
    const actionId = generateId('action')
    const newAction: SetVisualAction = {
      id: actionId,
      type: 'set_visual',
      category: 'point',
      target: targetObject.id,
      slotIndex: currentSlotIndex.value,
      params: { ...params }
    }
    
    appendActionWithSlotOrder(block.actions, newAction)
    
    // Auto-select newly created action
    selectedAction.value = newAction
    
    console.log(`[ActionEditor] Create set_visual action: ${actionId}`, params)
  }
  
  // Update store
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })
  
  // Refresh scene graph context
  const sceneGraph = renderer.value?.getSceneGraph()
  if (renderer.value && sceneGraph) {
    void refreshActionContextAndRender(scene, block)
  }
  
  markLocalChange()
}

// v16: Handle symbol asset switch (create or update set_material Action)
function handleMaterialActionUpdate(materialId: string) {
  if (!props.sceneId || !props.blockId || !props.episode) return
  
  const targetObject = sceneObjectStore.getSelectedObject()
  // v18: Supports both symbol and expression types
  if (!targetObject || (targetObject.type !== 'symbol' && targetObject.type !== 'expression')) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return
  
  if (!block.actions) {
    block.actions = []
  }
  
  // Check if current Slot already has set_material Action for this object
  const existingAction = block.actions.find((a: Action) => 
    a.type === 'set_material' && 
    a.target === targetObject.id && 
    a.slotIndex === currentSlotIndex.value
  )
  
  if (existingAction) {
    const materialAction = existingAction as SetMaterialAction
    materialAction.params = { materialId }
    selectedAction.value = materialAction
  } else {
    const actionId = generateId('action')
    const newAction: SetMaterialAction = {
      id: actionId,
      type: 'set_material',
      category: 'point',
      target: targetObject.id,
      slotIndex: currentSlotIndex.value,
      params: { materialId }
    }
    appendActionWithSlotOrder(block.actions, newAction)
    selectedAction.value = newAction
  }
  
  // Update store
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })
  
  // Refresh scene graph context
  const sceneGraph = renderer.value?.getSceneGraph()
  if (renderer.value && sceneGraph) {
    void refreshActionContextAndRender(scene, block)
  }
  
  markLocalChange()
}

// v16: Handle symbol asset list save (sync to Setup persistent layer)
function handleMaterialSave(materials: SymbolMaterial[], _currentMaterialId: string | undefined) {
  if (!props.sceneId || !props.episode) return
  
  const targetObject = sceneObjectStore.getSelectedObject()
  if (targetObject?.type !== 'symbol') return
  
  // v24: updateSetupObject automatically synced to episode
  sceneObjectStore.updateSetupObject(targetObject.id, { materials } as Partial<SceneObject>)
  
  markLocalChange()
}

// v24: Handle animation update (fix bug: previously only wrote episode, not store)
function handleAnimationsUpdated(objectId: string, animations: Record<string, import('@/types/animation').AnimationDefinition>) {
  // v24: updateSetupObject writes setupState + runtimeState + episode simultaneously
  sceneObjectStore.updateSetupObject(objectId, { animations } as Partial<SceneObject>)
  markLocalChange()
}

async function handleActionInspectorUpdate(updates: Partial<Action>) {
  if (!selectedAction.value || !props.sceneId || !props.blockId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block?.actions) return
  
  const index = block.actions.findIndex((a: Action) => a.id === selectedAction.value?.id)
  if (index === -1) return

  if ((updates.slotIndex !== undefined || (updates as { slotSpan?: number }).slotSpan !== undefined) &&
      selectedAction.value?.target === 'camera' &&
      isCameraActionType(selectedAction.value.type)) {
    const candidate = { ...selectedAction.value, ...updates } as Action
    const conflict = findCameraConflict(block.actions, candidate, { excludeId: selectedAction.value.id })

    if (conflict) {
      console.warn('[ActionEditor] Camera action conflict detected, update ignored')
      
      saveToastMessage.value = 'Camera action conflict: Another camera action already exists in this time range'
      saveToastType.value = 'error'
      showSaveToast.value = true
      setTimeout(() => {
        showSaveToast.value = false
      }, 3000)
      
      // Force refresh Inspector to rollback value (via reassigning selectedAction)
      selectedAction.value = { ...selectedAction.value } as Action
      return
    }
  }

  // v6.12: Generic duration action mutual exclusion check (for non-camera objects, like tween_transform)
  // Ensure duration actions like tween_transform do not overlap
  if ((updates.slotIndex !== undefined || (updates as { slotSpan?: number }).slotSpan !== undefined) && 
      selectedAction.value?.target !== 'camera' &&
      selectedAction.value.category === 'duration') {
      
      const newSlotIndex = updates.slotIndex ?? selectedAction.value.slotIndex
      const newSlotSpan = (updates as { slotSpan?: number }).slotSpan ?? ((selectedAction.value as { slotSpan?: number }).slotSpan ?? 1)
      
      const hasConflict = block.actions.some((a: Action) => {
          if (a.id === selectedAction.value?.id) return false
          if (a.target !== selectedAction.value?.target) return false
          if (a.category !== 'duration') return false
          
          const aSpan = (a as { slotSpan?: number }).slotSpan ?? 1
          const aStart = a.slotIndex
          const aEnd = aStart + aSpan - 1
          
          const newStart = newSlotIndex
          const newEnd = newStart + newSlotSpan - 1
          
          return !(newEnd < aStart || newStart > aEnd)
      })
      
      if (hasConflict) {
          console.warn('[ActionEditor] Duration action overlap detected, update ignored')
          
          saveToastMessage.value = 'Action conflict: This object already has another duration action in this time range'
          saveToastType.value = 'error'
          showSaveToast.value = true
          setTimeout(() => {
              showSaveToast.value = false
          }, 3000)
          
          selectedAction.value = { ...selectedAction.value } as Action
          return
      }
  }
  const targetAction = block.actions[index]
  if (targetAction) {
      const previousSlotIndex = targetAction.slotIndex
      const nextSlotIndex = updates.slotIndex ?? previousSlotIndex
      const nextUpdates = { ...updates }
      if (nextSlotIndex !== previousSlotIndex) {
        delete nextUpdates.order
      }

      Object.assign(targetAction, nextUpdates)
      applyActionSlotMoveOrderPolicy(block.actions, targetAction, previousSlotIndex, targetAction.slotIndex)
      selectedAction.value = { ...selectedAction.value, ...targetAction } as Action
  }
  
  const episodeId = route.params['id'] as string
  episodeStore.updateBlockInScene(episodeId, props.sceneId, props.blockId, {
    actions: block.actions
  })
  
  // Action Mode: Update scene graph context and re-render
  // Must await setActionModeContext first (clearing state cache), then renderObjects
  const sceneGraph6 = renderer.value?.getSceneGraph()
  if (renderer.value && sceneGraph6) {
    await refreshActionContextAndRender(scene, block)
  }
  
  markLocalChange()
}

function handleActionInspectorDelete() {
  if (!selectedAction.value) return
  handleDeleteActionFromSequencer(selectedAction.value)
}

// v7.17: Refactor: Changed from handleTimeUpdate to handleSceneUpdateBySlot
// Remove time parameter, driven entirely by currentSlotIndex
function handleSceneUpdateBySlot() {
  if (!renderer.value || !currentBlock.value) return
  
  // Update global currentTime (used only for UI display of total duration etc)
  const slots = currentBlockSlots.value
  // const currentSlot = slots.find(s => s.index === currentSlotIndex.value)
  // if (currentSlot) {
  //    currentTime.value = currentSlot.startTime
  // }
  
  if (!props.sceneId || !props.blockId || !props.episode) return
  
  const scene = props.episode.scenes.find((s: SceneContainer) => s.id === props.sceneId)
  if (!scene) return
  
  const block = scene.script.find((b: ScriptBlock) => b.id === props.blockId)
  if (!block) return
  
  const sceneGraph = renderer.value.getSceneGraph()
  const prevContext = sceneGraph.getActionModePrevContext?.() ?? calculatePrevContext(scene, props.blockId)
  
  if (renderer.value.updateSceneStateBySlot) {
    // v7.17: Use pure Slot-driven mode
    // Note: ActionSequencer might provide currentSlotIndex
    
    // v8.3: Use currently selected Slot index for rendering
    // According to Ghost Mode PRD specification:
    // - Case C (no action): Real displays cumulative state before Slot S (State at Slot Start)
    // therefore currentSlotIndex must be used instead of finalSlotIndex
    
    // Drive renderer to update state (Slot-based)
    renderer.value.updateSceneStateBySlot(
      currentSlotIndex.value, // v8.3: Use currently selected Slot index
      block.actions ?? [],
      prevContext,
      slots
    )
    
    // v7.17: Logging logic
    // To maintain completeness of debug info, temporarily retain logTargetStates
    // Compute Target State for logging only
    // Note: renderer already computed and applied internally, this is for logging only
    
    // const slots = currentBlockSlots.value // defined above
    // Pass 0 as duration, since BySlot function does not use duration
    
    const targetStates = new Map<string, ActionRuntimeState>()
    // 1. Compute object Target States
    // v7.18: Change log to print Block Final State

    for (const obj of prevContext.objects) {
      const targetId = obj.id
      // Phase 4e: obj is already SceneObject, pass directly
      const objectActions = (block.actions ?? []).filter((a: Action) => a.target === targetId)
      
      const targetState = evaluateObjectStateBySlot(
          obj, 
          objectActions, 
          currentSlotIndex.value, 
          slots,
          {
            getObjectState: (id: string) => {
              const o = prevContext.objects.find(ob => ob.id === id)
              return o ? (o as unknown as WriteableState) : undefined
            }
          }
      )
      
      if (targetState) targetStates.set(targetId, targetState)
    }
    
    // 2. Compute camera Target State
    const visualCenters = new Map<string, { x: number, y: number }>()
    for (const obj of prevContext.objects) {
      if (targetStates.has(obj.id)) {
          const s = targetStates.get(obj.id)!
          visualCenters.set(obj.id, { x: s.x, y: s.y })
      } else {
          visualCenters.set(obj.id, { x: obj.x, y: obj.y })
      }
    }
    
    const cameraActions = (block.actions ?? []).filter((a: Action) => a.target === 'camera')
    const startCameraState: RuntimeCameraState = {
        x: prevContext.camera.x, y: prevContext.camera.y, zoom: prevContext.camera.zoom,
        shakeOffsetX: 0, shakeOffsetY: 0
    }
    
    // Compute camera state using BySlot function as well
    const cameraTargetState = evaluateCameraStateBySlot(
        startCameraState, 
        cameraActions, 
        currentSlotIndex.value, 
        slots, 
        visualCenters, 
        null
    )
    
    if (cameraTargetState) targetStates.set('camera', cameraTargetState as unknown as ActionRuntimeState)
    
  } else if (renderer.value.updateTime) {
    // Compatibility old mode (Fallback - should not reach here now)
    let blockDuration = 0
    if (block.type === 'dialogue' || block.type === 'narration') {
        blockDuration = block.ttsConfig?.duration ?? 0
    } else if ((block as { type: string }).type === 'action') {
        blockDuration = (block as { duration: number }).duration ?? 0
    }

    // Attempt to simulate updateTime with Slot time
    const slots = currentBlockSlots.value
    const currentSlot = slots.find(s => s.index === currentSlotIndex.value)
    const time = currentSlot ? currentSlot.startTime : 0

    renderer.value.updateTime(
      time, 
      blockDuration, 
      block.actions ?? [], 
      prevContext,
      currentBlockSlots.value // Pass slots
    )
  }
}

function handleZIndexChanged() {
  if (renderer.value) {
    void renderer.value.renderObjects()
  }
}

function handleInitialStateUpdate(_pose?: string, _expression?: string) {
  // Do not update initial state in Action mode
}

function handleMoveUp() {
  const selected = sceneObjectStore.getSelectedObject()
  if (!selected) return
  
  const newZIndex = selected.zIndex + 1
  // v7.20: Modifying Store forbidden in Action Mode
  // sceneObjectStore.updateObject(selected.id, { zIndex: newZIndex })
  
  // In Action Mode, merge z-index changes into instant action
  const targetAlias = getTargetAliasFromObject(selected)
  if (targetAlias) {
    // All objects uniformly use set_transform
    const actionType = 'set_transform' as const
    upsertPointAction(actionType, targetAlias, currentSlotIndex.value, { params: { zIndex: newZIndex } })
  }
  
  handleZIndexChanged()
}

function handleMoveDown() {
  const selected = sceneObjectStore.getSelectedObject()
  if (!selected) return
  
  const newZIndex = Math.max(-10, selected.zIndex - 1)
  // v7.20: Modifying Store forbidden in Action Mode
  // sceneObjectStore.updateObject(selected.id, { zIndex: newZIndex })
  
  // In Action Mode, merge z-index changes into instant action
  const targetAlias = getTargetAliasFromObject(selected)
  if (targetAlias) {
    // All objects uniformly use set_transform
    const actionType = 'set_transform' as const
    upsertPointAction(actionType, targetAlias, currentSlotIndex.value, { params: { zIndex: newZIndex } })
  }
  
  handleZIndexChanged()
}

function handleTriggerAnim(payload: { action: 'play'|'stop', animName: string, loop?: boolean, speed?: number, timingMode?: AnimationTimingMode }) {
  const selected = sceneObjectStore.getSelectedObject()
  if (!selected) return
  if (!payload.animName) return

  const targetAlias = getTargetAliasFromObject(selected)
  if (!targetAlias) return

  const animItem: SetAnimAction['params']['animations'][number] = {
    animName: payload.animName,
    action: payload.action,
    autoStopOnBlockEnd: true
  }
  if (payload.loop !== undefined) {
    animItem.loop = payload.loop
  }
  if (payload.action === 'play' && payload.timingMode !== undefined) {
    animItem.timingMode = payload.timingMode
  }

  // v11.88: Use animations array format
  const params: SetAnimAction['params'] = {
    animations: [animItem],
    ...(payload.speed !== undefined ? { speed: payload.speed } : {})
  }

  upsertPointAction('set_anim', targetAlias, currentSlotIndex.value, { params })
}

function handleTriggerAudio(payload: { action: 'play'|'stop', volume?: number, loop?: boolean, fadeIn?: number, fadeOut?: number }) {
  const selected = sceneObjectStore.getSelectedObject()
  if (!selected) return

  const targetAlias = getTargetAliasFromObject(selected)
  if (!targetAlias) return

  upsertPointAction('set_audio', targetAlias, currentSlotIndex.value, { params: payload })
}

function handleTriggerTextReveal(payload: { action: 'play'|'stop', mode?: 'typewriter' }) {
  const selected = sceneObjectStore.getSelectedObject()
  if (selected?.type !== 'text') return

  const targetAlias = getTargetAliasFromObject(selected)
  if (!targetAlias) return

  upsertPointAction('set_text_reveal', targetAlias, currentSlotIndex.value, { params: payload })
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    const container = actionEditorContainer.value
    if (container) {
      container.requestFullscreen().then(() => {
        isFullscreen.value = true
      }).catch((err) => {
        console.error('[ActionEditor] Failed to enter fullscreen:', err)
      })
    }
  } else {
    document.exitFullscreen().then(() => {
      isFullscreen.value = false
    }).catch((err) => {
      console.error('[ActionEditor] Failed to exit fullscreen:', err)
    })
  }
}

// Handle bottom action editor collapse/expand state change
function handleSequencerCollapseChange(_collapsed: boolean) {
  // Wait for DOM update and CSS transition animation to complete, then recompute viewport size
  setTimeout(() => {
    if (renderer.value) {
      renderer.value.updateTransformParams()
      // v7.23: Use handleSceneUpdateBySlot() instead of renderObjects()
      // Ensure Action Mode state correctly reapplied
      handleSceneUpdateBySlot()
    }
  }, 300)
}

// v8.6: startResizeLeftPanel removed (left sidebar removed)

function startResizeRightPanel(event: MouseEvent) {
  isResizingRightPanel = true
  event.preventDefault()
  
  const handleMouseMove = (e: MouseEvent) => {
    if (isResizingRightPanel) {
      const newWidth = Math.max(250, Math.min(600, window.innerWidth - e.clientX))
      rightPanelWidth.value = newWidth
    }
  }
  
  const handleMouseUp = () => {
    isResizingRightPanel = false
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    
    if (renderer.value) {
      renderer.value.updateTransformParams()
      // v7.23: Use handleSceneUpdateBySlot() to ensure Action Mode state
      handleSceneUpdateBySlot()
    }
  }
  
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

// Reset Action Mode flag on component unmount to prevent leaking into Setup Mode
onBeforeUnmount(() => {
  sceneObjectStore.setActionMode(false)
})
</script>

<style scoped>
.action-editor {
  display: flex;
  height: 100%;  /* v6.10: Fill parent container in overlay mode */
  background: #f9fafb;
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

.panel-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-bottom: 1px solid #e5e7eb;
}

.panel-section:last-child {
  border-bottom: none;
}

.section-header {
  padding: 8px 12px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.section-header h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #374151;
}

.panel-section > :not(.section-header) {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
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

.canvas-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
  min-width: 0;
}

.action-toolbar {
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

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
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

.block-description {
  font-weight: 500;
  color: #111827;
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

.toolbar-btn.preview-btn {
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  border-color: #8b5cf6;
  color: white;
  font-weight: 500;
}

.toolbar-btn.preview-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #7c3aed, #4f46e5);
  border-color: #7c3aed;
  box-shadow: 0 2px 8px rgba(139, 92, 246, 0.4);
}

.canvas-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #1a1a1a;
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
  min-height: 0;
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

/* v11.0: Tab switch styles */
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

.action-editor:fullscreen {
  height: 100vh;
}

.action-editor:fullscreen .canvas-area {
  height: 100%;
}

:deep(canvas) {
  display: block;
  flex-shrink: 0;
  margin: 0 auto;
}

/* v8.3: Text edit button styles */
.edit-text-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  font-size: 14px;
  opacity: 0.6;
  transition: opacity 0.2s;
  margin-left: 4px;
}

.edit-text-btn:hover {
  opacity: 1;
}

/* v8.3: Text edit dialog styles */
.text-edit-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.text-edit-dialog {
  background: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  width: 500px;
  max-width: 90vw;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.text-edit-dialog .dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
  font-weight: 500;
  color: #333;
}

.text-edit-dialog .close-btn {
  background: none;
  border: none;
  font-size: 20px;
  color: #666;
  cursor: pointer;
  padding: 0 4px;
}

.text-edit-dialog .close-btn:hover {
  color: #333;
}

.text-edit-dialog .dialog-body {
  padding: 16px;
}

.text-edit-textarea {
  width: 100%;
  background: #f8f9fa;
  border: 1px solid #ced4da;
  border-radius: 4px;
  color: #333;
  font-size: 14px;
  padding: 10px;
  resize: vertical;
  min-height: 100px;
}

.text-edit-textarea:focus {
  outline: none;
  border-color: #0d6efd;
  box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.15);
}

.text-edit-dialog .dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #e0e0e0;
}

.text-edit-dialog .cancel-btn,
.text-edit-dialog .confirm-btn {
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.text-edit-dialog .cancel-btn {
  background: #f8f9fa;
  border: 1px solid #ced4da;
  color: #333;
}

.text-edit-dialog .cancel-btn:hover {
  background: #e9ecef;
}

.text-edit-dialog .confirm-btn {
  background: #0d6efd;
  border: none;
  color: #fff;
}

.text-edit-dialog .confirm-btn:hover {
  background: #0b5ed7;
}

/* v9.2: Add asset button styles (consistent with Setup Mode) */
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

.btn-icon {
  font-size: 16px;
  font-weight: bold;
  line-height: 1;
}

.btn-text {
  font-size: 13px;
  font-weight: 500;
}

/* Grouping mode CSS moved to GroupingModePanel.vue */

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

</style>
