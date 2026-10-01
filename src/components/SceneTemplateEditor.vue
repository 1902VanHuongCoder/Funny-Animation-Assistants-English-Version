<template>
  <!-- Overlay dialog container -->
  <div
    class="editor-overlay"
    @click.self="handleReturn"
  >
    <div
      ref="templateEditorContainer"
      class="editor-dialog"
    >
      <!-- P1: Page-level toolbar — Document metadata & global actions -->
      <div class="editor-toolbar">
        <div class="toolbar-left-page">
          <button
            class="cancel-btn"
            @click="handleReturn"
          >
            ← Back
          </button>
          <div class="template-title">
            <span class="mode-icon">🧩</span>
            <input
              v-model="templateName"
              class="title-input"
              placeholder="Enter template name"
              @blur="handleNameCommit"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            >
          </div>

          <!-- Tag edit area -->
          <div class="tag-editor-container">
            <span
              v-for="tag in selectedTags.slice(0, 1)"
              :key="tag"
              class="inline-tag"
            >
              {{ tag }}
              <button
                class="tag-remove-inline"
                @click="removeTag(tag)"
              >
                ×
              </button>
            </span>
            <span
              v-if="selectedTags.length > 1"
              class="more-tags-hint"
            >
              +{{ selectedTags.length - 1 }}
            </span>

            <button
              class="toolbar-btn icon-only"
              title="Edit Tags"
              @click="showTagEditor = !showTagEditor"
            >
              🏷️
            </button>

            <!-- Tag editor popover panel -->
            <div
              v-if="showTagEditor"
              class="tag-editor-popover"
              @click.stop
            >
              <div class="popover-header">
                Edit Tags
              </div>
              <div class="popover-body">
                <div class="popover-tags-display">
                  <span
                    v-for="tag in selectedTags"
                    :key="tag"
                    class="popover-tag-chip"
                  >
                    {{ tag }}
                    <button
                      class="popover-tag-remove"
                      @click="removeTag(tag)"
                    >
                      ×
                    </button>
                  </span>
                  <span
                    v-if="selectedTags.length === 0"
                    class="no-tags-hint"
                  >
                    No tags
                  </span>
                </div>
                <input
                  v-model="newTagInput"
                  class="popover-tag-input"
                  placeholder="Type tag and press Enter"
                  @keydown.enter="addTag"
                >
                <div
                  v-if="recommendedTags.length > 0"
                  class="popover-recommended-tags"
                >
                  <span class="recommend-label">Suggested:</span>
                  <span
                    v-for="tag in recommendedTags"
                    :key="tag"
                    class="popover-recommend-tag"
                    @click="addTagDirectly(tag)"
                  >
                    {{ tag }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="toolbar-right-page">
          <button
            class="action-btn"
            title="Generate Thumbnail"
            @click="handleGenerateThumbnail"
          >
            📷 Thumbnail
          </button>
          <button
            class="action-btn"
            title="Import Template (Coming Soon)"
            @click="handleImportTemplate"
          >
            📥 Import
          </button>
          <button
            class="save-btn"
            @click="handleSaveTemplate"
          >
            Save
          </button>
        </div>
      </div>

      <!-- Main Content: Shared workspace layout with SetupEditor -->
      <div class="editor-body">
        <main class="canvas-area">
          <!-- P2: Canvas toolbar — Object actions & view controls -->
          <div class="setup-toolbar">
            <div class="toolbar-left">
              <span
                class="save-status"
                :class="{ unsaved: hasLocalChanges }"
              >
                {{ hasLocalChanges ? '● Unsaved' : '✓ Saved' }}
              </span>
              <span class="mouse-position">
                ({{ renderer?.mousePosition?.x || 0 }}, {{ renderer?.mousePosition?.y || 0 }})
              </span>
            </div>
            <div class="toolbar-right">
              <button
                class="toolbar-btn preview-btn"
                title="Preview Template"
                @click="showPreview = true"
              >
                <span class="btn-icon">🔍</span>
                <span class="btn-text">Preview</span>
              </button>
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
                    <span>Screen Effect</span>
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
                class="toolbar-btn danger icon-only"
                title="Delete selected object"
                :disabled="sceneObjectStore.getSelectedObject()?.type === 'camera'"
                @click="handleDeleteObject()"
              >
                🗑️
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
                  Camera set to pass-through mode, click to manage
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

          <!-- P2: Grouping mode bar -->
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
            <!-- Import source path tag -->
            <div
              v-if="templateImportSourcePath"
              class="import-source-tag"
              :title="templateImportSourcePath"
            >
              📂 {{ templateImportSourcePath }}
            </div>
          </div>
        </main>

        <!-- Right splitter -->
        <div
          v-show="!rightPanelCollapsed"
          class="resizer right-resizer"
          @mousedown="startResizeRightPanel"
        />

        <!-- Right collapse button -->
        <button
          v-show="rightPanelCollapsed"
          class="expand-btn right"
          title="Expand panel"
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
              title="Collapse panel"
              @click="rightPanelCollapsed = true"
            >
              ▶
            </button>
            <span class="panel-title">📋 Properties</span>
          </div>

          <!-- Properties panel -->
          <ObjectPropertiesPanel
            :selected-object="sceneObjectStore?.getSelectedObject()"
            :canvas-width="renderer?.canvasSize?.width || 1920"
            :canvas-height="renderer?.canvasSize?.height || 1080"
            :is-pass-through="selectedObjectIsPassThrough"
            :pass-through-visible="selectedObjectPassThroughVisible"
            :persist-changes="handleSaveTemplate"
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
      </div>

      <!-- Asset Picker Dialogs -->

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
        @close="showScreenEffectPicker = false"
      />
      <SceneTemplatePickerDialog
        v-if="showTemplatePicker"
        @select="handleTemplateSelect"
        @close="showTemplatePicker = false"
      />

      <!-- v18: Expression Picker Dialog -->
      <ExpressionSelectorDialog
        v-if="showExpressionPicker"
        @select="handleExpressionSelect"
        @close="showExpressionPicker = false"
      />

      <!-- v19: Character Picker Dialog -->
      <CompositeCharacterPickerDialog
        v-if="showCharacterPicker"
        @select="handleCompositeCharacterSelect"
        @close="showCharacterPicker = false"
      />

      <!-- Import File Browser -->
      <FileBrowserDialog
        v-if="showImportBrowser"
        title="Select config.json file"
        :file-filter="importFileFilter"
        :multiple="false"
        @select="handleImportFileSelect"
        @close="showImportBrowser = false"
      />

      <!-- Confirm Dialog -->
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

      <!-- Save Confirm Dialog -->
      <SaveConfirmDialog
        v-if="showSaveConfirmDialog"
        title="Save Changes"
        message="There are unsaved changes. What would you like to do?"
        @save-and-exit="handleSaveAndExit"
        @discard="handleDiscardAndExit"
        @cancel="showSaveConfirmDialog = false"
      />

      <!-- Instance Alias Dialog -->
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

      <!-- Scene Render Chain Dialog -->
      <SceneRenderChainDialog
        v-if="showRenderChainDialog"
        mode-description="Template Editor objects"
        @close="showRenderChainDialog = false"
      />
    </div>
  </div>

  <!-- Preview dialog -->
  <ObjectCollectionPreviewDialog
    v-if="showPreview && originalTemplate"
    :title="`Preview: ${templateName}`"
    :objects="originalTemplate.objects"
    :editor-anchor="originalTemplate.editorAnchor"
    :render-chain="sceneObjectStore.getSceneRenderChain()"
    :info="{ name: templateName, createdAt: originalTemplate.createdAt, tags: selectedTags }"
    @close="showPreview = false"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useAssetLoader } from '@/composables/useAssetLoader'
import { useSetupWorkspace } from '@/composables/useSetupWorkspace'
import { useToast } from '@/composables/useToast'
import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from '@/constants/canvas'
import { getTypeIcon } from '@/core/sceneObjectProviders/metadata'
import { useProjectStore } from '@/stores/projectStore'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import { useSceneTemplateStore } from '@/stores/sceneTemplateStore'
import type { SelectedFile } from '@/types/fileBrowser'
import type { SceneObject } from '@/types/sceneObject'
import type { SceneTemplate } from '@/types/sceneTemplate'
import type { SceneSetup } from '@/types/screenplay'
import {
  collectAllFramePaths,
  convertConfigToSceneObjects,
  parseConfigJson,
  validateConfigResources,
} from '@/utils/configImporter'
import { getDirectoryHandleSafe } from '@/utils/fileSystem'
import { loadSetupToSceneObjects } from '@/utils/sceneLoader'
import { buildTemplateFromObjects } from '@/utils/sceneTemplateEngine'

import BackgroundPickerDialog from './BackgroundPickerDialog.vue'
import CanvasScrollbars from './CanvasScrollbars.vue'
import CompositeCharacterPickerDialog from './CompositeCharacterPickerDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import FileBrowserDialog from './FileBrowserDialog.vue'
import GroupingModePanel from './GroupingModePanel.vue'
import InstanceAliasDialog from './InstanceAliasDialog.vue'
import ObjectCollectionPreviewDialog from './ObjectCollectionPreviewDialog.vue'
import ObjectPropertiesPanel from './ObjectPropertiesPanel.vue'
import PassThroughPanel from './PassThroughPanel.vue'
import PropPickerDialog from './PropPickerDialog.vue'
import SaveConfirmDialog from './SaveConfirmDialog.vue'
import SceneRenderChainDialog from './SceneRenderChainDialog.vue'
import SceneTemplatePickerDialog from './SceneTemplatePickerDialog.vue'
import ScreenEffectPickerDialog from './ScreenEffectPickerDialog.vue'
import ExpressionSelectorDialog from './screenplay/ExpressionSelectorDialog.vue'
import SoundPickerDialog from './SoundPickerDialog.vue'
import ZoomControls from './ZoomControls.vue'

const props = defineProps<{
  templateId?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
  (e: 'created', templateId: string): void
}>()

const projectStore = useProjectStore()
const templateStore = useSceneTemplateStore()
const sceneObjectStore = useSceneObjectStore()
const isDev = import.meta.env.DEV

const toast = useToast()

// Canvas container element
const canvasContainer = ref<HTMLElement>()
const templateEditorContainer = ref<HTMLElement>()

// Template-specific state
const templateName = ref('')
const showPreview = ref(false)
const originalTemplate = ref<SceneTemplate | null>(null)

// Import source directory path
const templateImportSourcePath = ref('')

// Tag editing state
const selectedTags = ref<string[]>([])
const newTagInput = ref('')
const showTagEditor = ref(false)

const recommendedTags = computed(() =>
  templateStore.allTags.filter(t => !selectedTags.value.includes(t))
)

function addTag(): void {
  const tag = newTagInput.value.trim()
  if (tag && !selectedTags.value.includes(tag)) {
    selectedTags.value.push(tag)
    workspace.markLocalChange()
  }
  newTagInput.value = ''
}

function addTagDirectly(tag: string): void {
  if (!selectedTags.value.includes(tag)) {
    selectedTags.value.push(tag)
    workspace.markLocalChange()
  }
}

function removeTag(tag: string): void {
  selectedTags.value = selectedTags.value.filter(t => t !== tag)
  workspace.markLocalChange()
}

// ===== Template-specific: Save logic =====
async function handleSaveTemplate(): Promise<void> {
  // Collect all objects from scene objects collection
  const objects = sceneObjectStore.objects.filter(o => o.type !== 'camera')

  const tags = selectedTags.value.length > 0 ? [...selectedTags.value] : undefined

  if (!originalTemplate.value) {
    // ===== Create mode: First save, create template record =====
    const newTemplate = buildTemplateFromObjects(
      objects,
      sceneObjectStore.objects,
      templateName.value,
      tags,
      sceneObjectStore.getSceneRenderChain(),
    )
    if (templateImportSourcePath.value) {
      newTemplate.importSourcePath = templateImportSourcePath.value
    }
    templateStore.addTemplate(newTemplate)
    originalTemplate.value = newTemplate

    try {
      await projectStore.saveProject()
      workspace.resetLocalChanges()
      toast.success('Template created successfully')
      // Notify Manager to update editingTemplateId
      emit('created', newTemplate.id)
    } catch (error) {
      console.error('[SceneTemplateEditor] Save failed:', error)
      toast.error('Failed to save: ' + ((error as Error).message || 'Unknown error'))
    }
  } else {
    // ===== Edit mode: Update existing template =====
    const updatedTemplate = buildTemplateFromObjects(
      objects,
      sceneObjectStore.objects,
      templateName.value,
      tags,
      sceneObjectStore.getSceneRenderChain(),
    )

    const updatePayload: Partial<SceneTemplate> = {
      name: updatedTemplate.name,
      objects: updatedTemplate.objects,
      ...(updatedTemplate.editorAnchor ? { editorAnchor: updatedTemplate.editorAnchor } : {}),
    }
    if (updatedTemplate.renderChain) {
      updatePayload.renderChain = updatedTemplate.renderChain
    }
    if (updatedTemplate.tags) {
      updatePayload.tags = updatedTemplate.tags
    }
    if (templateImportSourcePath.value) {
      updatePayload.importSourcePath = templateImportSourcePath.value
    }
    templateStore.updateTemplate(originalTemplate.value.id, updatePayload)

    try {
      await projectStore.saveProject()
      workspace.resetLocalChanges()
      toast.success('Template saved successfully')
    } catch (error) {
      console.error('[SceneTemplateEditor] Save failed:', error)
      toast.error('Failed to save: ' + ((error as Error).message || 'Unknown error'))
    }
  }
}

function handleNameCommit(): void {
  // Mark local changes when name is modified
  if (templateName.value !== originalTemplate.value?.name) {
    workspace.markLocalChange()
  }
}

// ===== Template-specific: Thumbnail generation =====
async function handleGenerateThumbnail(): Promise<void> {
  const pixiApp = renderer.value?.getPixiApp()
  const app = pixiApp?.app
  const pixiCtx = pixiApp?.getContext()
  const contentLayer = pixiCtx?.contentLayer
  if (!app || !contentLayer || !originalTemplate.value) {
    toast.error('Canvas not initialized')
    return
  }

  try {
    // Use contentLayer instead of stage:
    // - Exclude lighting_bounds_anchor (located in activeLayer, covers whole canvas causing oversized bounds)
    // - renderer.render(contentLayer, ...) treats contentLayer as root node, automatically excluding viewportLayer zoom/pan transformations
    const bounds = contentLayer.getLocalBounds()
    if (bounds.width <= 0 || bounds.height <= 0) {
      toast.error('No renderable objects in canvas')
      return
    }

    // Limit maximum size to avoid WebGL texture overflow
    const THUMB_MAX = 512
    const scale = Math.min(1, THUMB_MAX / Math.max(bounds.width, bounds.height))
    const texWidth = Math.ceil(bounds.width * scale)
    const texHeight = Math.ceil(bounds.height * scale)

    // Create RenderTexture, render only the object bounds
    const PIXI = await import('pixi.js')
    const renderTexture = PIXI.RenderTexture.create({ width: texWidth, height: texHeight })

    // Temporarily adjust contentLayer translation and scale so object bounds fill RenderTexture
    const origX = contentLayer.x
    const origY = contentLayer.y
    const origSX = contentLayer.scale.x
    const origSY = contentLayer.scale.y

    contentLayer.x = -bounds.x * scale
    contentLayer.y = -bounds.y * scale
    contentLayer.scale.set(scale, scale)

    app.renderer.render(contentLayer, { renderTexture })

    // Restore contentLayer state
    contentLayer.x = origX
    contentLayer.y = origY
    contentLayer.scale.set(origSX, origSY)

    // Extract to Canvas
    const sourceCanvas = app.renderer.extract.canvas(renderTexture) as HTMLCanvasElement
    renderTexture.destroy(true)

    // Convert to JPEG DataURL
    const canvas = document.createElement('canvas')
    canvas.width = texWidth
    canvas.height = texHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get canvas context')

    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, texWidth, texHeight)
    ctx.drawImage(sourceCanvas, 0, 0)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)

    templateStore.updateTemplate(originalTemplate.value.id, {
      _runtimeThumbnailUrl: dataUrl,
    })
    workspace.markLocalChange()
    toast.success('Thumbnail generated')
  } catch (error) {
    console.error('[SceneTemplateEditor] Thumbnail generation failed:', error)
    toast.error('Failed to generate thumbnail: ' + ((error as Error).message || 'Unknown error'))
  }
}

// ===== Template-specific: Import config.json =====
const selectedCompositeMode = ref<'entity' | 'union'>('union')

const showImportBrowser = ref(false)

/** File filter: show config.json and image files */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
function importFileFilter(file: FileSystemFileHandle): boolean {
  const name = file.name.toLowerCase()
  if (name === 'config.json') return true
  const ext = name.split('.').pop() || ''
  return IMAGE_EXTENSIONS.includes(ext)
}

function handleImportTemplate(): void {
  if (!projectStore.projectHandle) {
    toast.error('Please open a project first')
    return
  }
  showImportBrowser.value = true
}

/** Handle import file selection */
async function handleImportFileSelect(files: SelectedFile[]): Promise<void> {
  const file = files[0]
  if (!file) return

  if (file.name !== 'config.json') {
    toast.error('Please select config.json file')
    return
  }

  try {
    // 1. Derive directory handle from file path
    const pathParts = file.path.split('/').slice(0, -1) // remove 'config.json'
    let dirHandle = projectStore.projectHandle!
    for (const part of pathParts) {
      if (!part) continue
      dirHandle = await getDirectoryHandleSafe(dirHandle, part)
    }
    const importDirPath = pathParts.join('/')

    // 2. Read and parse config.json
    const configFile = await file.handle.getFile()
    const config = parseConfigJson(await configFile.text())

    // 3. Collect frame paths -> resource validation
    const allPaths = collectAllFramePaths(config)
    const validation = await validateConfigResources(allPaths, dirHandle)

    if (!validation.valid) {
      console.warn('[SceneTemplateEditor] Partial resources missing:', validation.missingFiles)
    }

    // 4. Convert to scene objects
    const objects = await convertConfigToSceneObjects(
      config, CANVAS_CENTER_X, CANVAS_CENTER_Y,
      validation.foundFiles, validation.resolvedRelativePaths,
      importDirPath, 'entity'
    )

    // 5. Preload texture resources for imported objects
    //    The render pipeline looks up textures via material.url (persisted path),
    //    which must be loaded into textureCache before adding to Store,
    //    otherwise the watcher triggering renderObjects finds textures unready, rendering blank sprites.
    {
      const { loadAssets } = useAssetLoader()
      const imageUrls = new Set<string>()
      for (const obj of objects) {
        if (obj.type === 'symbol') {
          const symbolObj = obj as import('@/types/sceneObject').SymbolObject
          for (const material of (symbolObj.materials ?? [])) {
            if (material.type === 'static' && material.url) {
              imageUrls.add(material.url)
            } else if (material.type === 'animation' && material.frames) {
              for (const frame of material.frames) {
                if (frame.url) imageUrls.add(frame.url)
              }
              // Still frame
              if (material.url) imageUrls.add(material.url)
            }
          }
        }
      }
      if (imageUrls.size > 0) {
        await loadAssets(imageUrls, new Set(), 'SceneTemplateEditor.configImport')
      }
    }

    // 6. Add to Store
    for (const obj of objects) {
      sceneObjectStore.addObject(obj)
    }

    // v19: Rebuild entity renderChain and scene render chain after loading
    sceneObjectStore.rebuildEntityRenderChains()
    sceneObjectStore.rebuildSceneRenderChain()

    // 7. Select first object
    if (objects.length > 0 && objects[0]) {
      sceneObjectStore.selectObject(objects[0].id)
    }

    workspace.markLocalChange()

    // Record import source path
    if (importDirPath) {
      templateImportSourcePath.value = importDirPath
    }

    // 8. Explicitly trigger re-render (ensuring complete render once textures are loaded)
    if (renderer.value) {
      await renderer.value.renderObjects()
    }

    toast.success(`Imported successfully: ${objects.length} objects`)
  } catch (e) {
    console.error('[SceneTemplateEditor] Import failed:', e)
    toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  showImportBrowser.value = false
}

// ===== Initialize composable =====
const workspace = useSetupWorkspace({
  canvasContainer,
  editorContainer: templateEditorContainer,
  // Template editor does not require episodeId/sceneId
  rendererExtras: {},
  onDataChange: () => projectStore.markAsUnsaved(),
  onSave: handleSaveTemplate,
  onExit: () => emit('close'),
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
  showAddMenu,
  toggleAddMenu,
  handleMenuItemClick,
  handleBackgroundSelect,
  handlePropSelect,
  handleSoundSelect,
  handleScreenEffectSelect,
  handleTemplateSelect,
  handleExpressionSelect,
  showExpressionPicker,
  showCharacterPicker,
  handleCompositeCharacterSelect,
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

// Template editor has no camera object, no need to show pass-through camera tip
showPassThroughTip.value = false

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

// ===== Lifecycle =====

onMounted(async () => {
  sceneObjectStore.setActionMode(false)
  sceneObjectStore.clearObjects()
  let initialSetup: SceneSetup | null = null

  if (props.templateId) {
    // ===== Edit mode: Load existing template =====
    const template = templateStore.getTemplate(props.templateId)
    if (!template) {
      throw new Error(`[SceneTemplateEditor] Template ${props.templateId} does not exist`)
    }

    originalTemplate.value = template
    templateName.value = template.name
    selectedTags.value = [...(template.tags ?? [])]
    templateImportSourcePath.value = template.importSourcePath ?? ''

    // v19: Use loadSetupToSceneObjects instead of instantiateTemplate,
    // avoiding broken references in renderChain caused by ID remapping
    // Note: Coordinates were normalized to 0 on save (minus editorAnchor), offset must be restored on load
    const anchor = template.editorAnchor ?? { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y }
    const restoredObjects = JSON.parse(JSON.stringify(template.objects)) as SceneObject[]
    for (const obj of restoredObjects) {
      if (!obj.parentId) {
        obj.x += anchor.x
        obj.y += anchor.y
      }
    }
    const setup: SceneSetup = {
      camera: { x: 0, y: 0, width: 0, height: 0, zoom: 1.0 },
      objects: restoredObjects,
      renderChain: template.renderChain ?? [],  // v19: Use saved render chain from template (auto rebuild if legacy template lacks this field)
    }
    initialSetup = setup
    loadSetupToSceneObjects(setup, { skipCamera: true, skipAmbientLight: true })

    // Select first non-camera object
    const firstObj = sceneObjectStore.objects.find(o => o.type !== 'camera')
    if (firstObj) {
      sceneObjectStore.selectObject(firstObj.id)
    }
  } else {
    // ===== Create mode: Blank canvas =====
    originalTemplate.value = null
    // Auto-generate unique name
    const baseName = 'New Template'
    const existingNames = new Set(templateStore.templates.map(t => t.name))
    let name = baseName
    let counter = 2
    while (existingNames.has(name)) {
      name = `${baseName} ${counter}`
      counter++
    }
    templateName.value = name
    selectedTags.value = []
  }

  // Initialize canvas (handled by composable)
  await initCanvas()

  if (initialSetup) {
    const { collectEditorFirstPaintAssets, loadAssets } = useAssetLoader()
    const { imageUrls, audioUrls } = collectEditorFirstPaintAssets(initialSetup, null)
    if (imageUrls.size > 0 || audioUrls.size > 0) {
      await loadAssets(
        imageUrls,
        audioUrls,
        `SceneTemplateEditor.sceneAssets(${props.templateId ?? 'new'})`
      )
    }
  }

  if (renderer.value) {
    await renderer.value.renderObjects()
  }

  // Setup watchers and event listeners
  setupWatchers()
  setupEventListeners()
})

onBeforeUnmount(() => {
  cleanupEventListeners()
  destroyCanvas()
  sceneObjectStore.clearObjects()
})
// Tag popup panel: click outside to close
function handleTagEditorClickOutside(event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (showTagEditor.value && !target.closest('.tag-editor-container')) {
    showTagEditor.value = false
  }
}

// Register/cleanup tag panel outside click listeners
onMounted(() => {
  document.addEventListener('click', handleTagEditorClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleTagEditorClickOutside)
})
</script>

<style scoped>
/* ===== Fullscreen Overlay styles (consistent with Setup mode) ===== */
.editor-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 1000;
  background: #1a1a1a;
}

.editor-dialog {
  background: #ffffff;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* ===== Page-level toolbar (consistent with CharacterEditorModal style) ===== */
.editor-toolbar {
  height: 48px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  flex-shrink: 0;
}

.toolbar-left-page,
.toolbar-right-page {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cancel-btn {
  background: white;
  border: 1px solid #d1d5db;
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 14px;
  color: #374151;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.cancel-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.action-btn {
  background: white;
  border: 1px solid #d1d5db;
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 14px;
  color: #374151;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.action-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.save-btn {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 6px 24px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
}

.save-btn:hover {
  background: #2563eb;
}

/* Template name editor (inline toolbar) */
.template-title {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.template-title .mode-icon {
  flex-shrink: 0;
  font-size: 14px;
}

.title-input {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 8px;
  background: transparent;
  width: 160px;
  outline: none;
  transition: all 0.2s;
}

.title-input:hover {
  border-color: #cbd5e1;
  background: #f1f5f9;
}

.title-input:focus {
  border-color: #3b82f6;
  background: white;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.editor-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ===== Reused SetupEditor workspace styles ===== */

.canvas-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
  min-width: 0;
  position: relative;
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

.toolbar-btn.danger:hover:not(:disabled) {
  background: #fef2f2;
  border-color: #fca5a5;
  color: #dc2626;
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

.preview-btn {
  background: #8b5cf6;
  border-color: #8b5cf6;
  color: white;
}

.preview-btn:hover {
  background: #7c3aed;
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

.canvas-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #1a1a1a;
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
}

:deep(canvas) {
  display: block;
  flex-shrink: 0;
  margin: 0 auto;
}

/* Right panel */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  background: #f9fafb;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-left: 8px;
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

.right-resizer::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  left: -2px;
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

/* Fullscreen */
.editor-dialog:fullscreen {
  height: 100vh;
  width: 100vw;
  max-width: none;
  border-radius: 0;
}

/* Grouping mode CSS moved to GroupingModePanel.vue */

/* ===== Tag editing area ===== */
.tag-editor-container {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
}

.inline-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  background: #eff6ff;
  color: #3b82f6;
  border-radius: 12px;
  font-size: 11px;
  white-space: nowrap;
}

.tag-remove-inline {
  background: none;
  border: none;
  color: #3b82f6;
  cursor: pointer;
  font-size: 13px;
  padding: 0 1px;
  line-height: 1;
}

.tag-remove-inline:hover {
  color: #1d4ed8;
}

.more-tags-hint {
  font-size: 11px;
  color: #6b7280;
  white-space: nowrap;
}

/* Tag editing popover panel */
.tag-editor-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 320px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
}

.popover-header {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  border-bottom: 1px solid #f3f4f6;
  background: #f9fafb;
}

.popover-body {
  padding: 12px 14px;
}

.popover-tags-display {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
  min-height: 28px;
}

.popover-tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  background: #eff6ff;
  color: #3b82f6;
  border-radius: 14px;
  font-size: 12px;
}

.popover-tag-remove {
  background: none;
  border: none;
  color: #3b82f6;
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  line-height: 1;
}

.popover-tag-remove:hover {
  color: #1d4ed8;
}

.no-tags-hint {
  font-size: 12px;
  color: #9ca3af;
}

.popover-tag-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}

.popover-tag-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.popover-recommended-tags {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.recommend-label {
  font-size: 11px;
  color: #9ca3af;
}

.popover-recommend-tag {
  padding: 2px 8px;
  background: #f3f4f6;
  color: #4b5563;
  border-radius: 12px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.popover-recommend-tag:hover {
  background: #e5e7eb;
  color: #374151;
}

/* Import source path floating tag */
.import-source-tag {
  position: absolute;
  bottom: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: #e0e0e0;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  pointer-events: none;
  z-index: 10;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== Pass-through tip bubble ===== */
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
