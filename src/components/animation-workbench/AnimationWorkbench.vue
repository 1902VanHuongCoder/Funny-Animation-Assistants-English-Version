<!--
  AnimationWorkbench.vue — Animation WYSIWYG editor (fullscreen overlay)
  
  Architecture: reuses useSceneRenderer setup mode interaction + useAnimationEdit keyframe engine
  Data isolation: isolated via AnimationSceneObjectStore during editing, does not affect global scene data
  Entry: ObjectPropertiesPanel / PropEditorModal -> opens this component
  Left panel: animation list + action library (in list mode)
-->
<template>
  <Teleport to="body">
    <div v-if="visible" ref="overlayRef" class="animation-workbench-overlay" tabindex="0" @keydown="onKeydown">
      <!-- Toolbar -->
      <div class="workbench-toolbar">
        <div class="toolbar-left">
          <input
            v-if="hasActiveAnimation"
            v-model="animationDef.name"
            class="anim-name-input"
            placeholder="Animation Name"
            maxlength="50"
            @keydown.stop
          >
          <span v-else class="empty-toolbar-hint">Please click "+ New" on the left to create an animation first</span>
        </div>

        <div class="toolbar-right">
          <div class="toolbar-popover" @pointerdown.stop>
            <button
              class="btn-toolbar object-tree-trigger"
              :class="{ active: showSceneObjectPanel }"
              title="Scene object list"
              @click="toggleSceneObjectPanel"
            >
              <span class="object-tree-trigger-label">{{ selectedWorkbenchObjectLabel }}</span>
              <span class="object-tree-trigger-arrow">{{ showSceneObjectPanel ? '▲' : '▼' }}</span>
            </button>
            <div v-if="showSceneObjectPanel" class="workbench-popover object-list-popover">
              <div class="popover-header">
                <span>Scene Objects</span>
              </div>
              <div class="popover-content">
                <div v-if="flatSceneObjectNodes.length === 0" class="popover-empty">No objects</div>
                <button
                  v-for="node in flatSceneObjectNodes"
                  :key="node.id"
                  class="object-list-row"
                  :class="{ selected: node.id === selectedWorkbenchObjectId }"
                  :style="node.depth > 0 ? { paddingLeft: (10 + node.depth * 18) + 'px' } : {}"
                  @click="selectWorkbenchObject(node.id)"
                >
                  <span
                    v-if="node.hasChildren"
                    class="tree-toggle"
                    @click.stop="toggleObjectExpanded(node.id)"
                  >
                    {{ expandedObjectIds.has(node.id) ? '▼' : '▶' }}
                  </span>
                  <span v-else class="tree-spacer" />
                  <span class="object-icon">{{ node.icon }}</span>
                  <span class="object-name">{{ node.name }}</span>
                  <span v-if="passThroughIds.includes(node.id)" class="object-badge">Pass-Through</span>
                </button>
              </div>
            </div>
          </div>
          <button
            v-if="selectedWorkbenchObjectId"
            class="btn-toolbar pass-through-set-btn"
            :class="{ active: selectedObjectIsPassThrough }"
            :disabled="selectedObjectIsPassThrough"
            :title="selectedObjectIsPassThrough ? 'Current object is already in pass-through list' : 'Set selected object to pass-through'"
            @click="addSelectedObjectToPassThrough"
          >
            Set to Pass-Through
          </button>
          <div class="toolbar-popover" @pointerdown.stop>
            <button
              class="btn-toolbar icon-toolbar-btn"
              :class="{ active: showPassThroughPanel }"
              :title="`Pass-through list: ${passThroughEntries.length} object(s)`"
              @click="togglePassThroughPanel"
            >
              👻<span v-if="passThroughEntries.length > 0" class="icon-count">{{ passThroughEntries.length }}</span>
            </button>
            <div v-if="showPassThroughPanel" class="workbench-popover pass-through-popover">
              <div class="popover-header">
                <span>Pass-Through List</span>
              </div>
              <div class="popover-content">
                <div v-if="passThroughEntries.length === 0" class="popover-empty">
                  Select an object and click "Set to Pass-Through"
                </div>
                <button
                  v-for="entry in passThroughEntries"
                  :key="entry.objectId"
                  class="object-list-row"
                  :class="{ selected: entry.objectId === selectedWorkbenchObjectId }"
                  @click="selectWorkbenchObject(entry.objectId)"
                >
                  <span class="object-icon">{{ entry.icon }}</span>
                  <span class="object-name">{{ entry.name }}</span>
                  <span class="pass-through-actions">
                    <button
                      class="mini-icon-btn"
                      :class="{ muted: !entry.visible }"
                      :title="entry.visible ? 'Hide pass-through object' : 'Show pass-through object'"
                      @click.stop="togglePassThroughVisible(entry.objectId)"
                    >
                      {{ entry.visible ? '👁' : '🚫' }}
                    </button>
                    <button
                      class="mini-icon-btn danger"
                      title="Remove from pass-through list"
                      @click.stop="removeFromPassThrough(entry.objectId)"
                    >
                      ×
                    </button>
                  </span>
                </button>
              </div>
            </div>
          </div>
          <span class="toolbar-divider" />
          <button class="btn-toolbar" @click="handleClose">Back</button>
          <button class="btn-save" :disabled="(!hasActiveAnimation && !hasPendingProjectChanges) || isSavingProject" @click="handleSave">
            {{ isSavingProject ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>

      <!-- Main area -->
      <div class="workbench-body">
        <!-- Left animation list panel (list mode) -->
        <aside
          v-if="listMode"
          v-show="!leftPanelCollapsed"
          class="left-panel"
          :style="{ width: leftPanelWidth + 'px' }"
        >
          <div class="panel-header left-panel-header">
            <h3>Animation List</h3>
            <button
              class="collapse-btn"
              title="Collapse panel"
              @click="leftPanelCollapsed = true"
            >
              ◀
            </button>
          </div>
          <AnimationListPanel
            :animations="allAnimationsList"
            :current-animation-id="hasActiveAnimation ? animationDef.id : null"
            :is-object-mode="isObjectMode"
            :is-composite-mode="isCompositeMode"
            v-bind="listPanelOptionalProps"
            @select="handleListSelect"
            @edit="handleListEdit"
            @delete="handleListDelete"
            @create="handleListCreate"
            @copy-from-self="handleCopyFromSelf"
            @save-as-preset="handleSaveAsPreset"
            @preset-applied="handlePresetApplied"
            @update:animations="handleAnimationsUpdate"
          />
        </aside>

        <!-- Left splitter -->
        <div
          v-if="listMode && !leftPanelCollapsed"
          class="resizer left-resizer"
          @mousedown="startResizeLeftPanel"
        />

        <!-- Left collapse button -->
        <button
          v-if="listMode && leftPanelCollapsed"
          class="expand-left-btn"
          title="Expand animation list"
          @click="leftPanelCollapsed = false"
        >
          ▶
        </button>

        <!-- Canvas -->
        <div class="canvas-area">
          <LightweightCanvas
            ref="canvasRef"
            :resource-type="resourceType"
            :resource-id="resourceId"
            origin-handle-mode="readonly"
            v-bind="canvasOptionalProps"
            @container-ready="onContainerReady"
            @canvas-app-ready="onCanvasAppReady"
            @setup-change="onSetupChange"
          />
          <ZoomControls
            v-if="canvasRef?.renderer"
            :current-zoom="canvasZoom"
            @zoom-change="(z: number) => canvasRef?.renderer?.setZoomLevel(z)"
            @fit="() => canvasRef?.renderer?.resetView()"
            @fit-all="() => canvasRef?.renderer?.fitAll()"
            @zoom-100="() => canvasRef?.renderer?.zoomTo100()"
          />
        </div>

        <!-- Right splitter -->
        <div
          v-show="!rightPanelCollapsed"
          class="resizer right-resizer"
          @mousedown="startResizeRightPanel"
        />

        <!-- Right collapse button (shown when panel collapsed) -->
        <button
          v-show="rightPanelCollapsed"
          class="expand-btn"
          title="Expand panel"
          @click="rightPanelCollapsed = false"
        >
          ◀
        </button>

        <!-- Right property panel -->
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
            <h3>{{ rightPanelTitle }}</h3>
          </div>
          <div v-if="!hasActiveAnimation" class="panel-empty-state">
            Create or select an animation from the left list to edit keyframes and track properties.
          </div>
          <KeyframePropertyPanel
            v-else
            :ctx="ctx"
            :scene-object="sceneObject"
            :scene-objects="propertyPanelSceneObjects"
            :target-options="trackTargetOptions"
            :target-tree-nodes="trackTargetTreeNodes"
            :get-default-pivot="getDefaultTrackPivot"
            @pivot-change="onPropertyPanelPivotChange"
            @pivot-reset="onPropertyPanelPivotReset"
          />
        </aside>
      </div>

      <!-- Bottom timeline (draggable height / collapsible) -->
      <div
        v-if="hasActiveAnimation"
        class="timeline-section"
        :style="{ height: timelineCollapsed ? '32px' : timelineHeight + 'px' }"
      >
        <div
          v-show="!timelineCollapsed"
          class="timeline-resizer"
          @mousedown="startResizeTimeline"
        />
        <AnimationTimeline
          v-show="!timelineCollapsed"
          :ctx="ctx"
          :scene-object="sceneObject"
          :preview-mode="previewMode"
          :preview-track-indexes="activePreviewTrackIndexes"
          style="flex:1;min-height:0"
          @collapse="timelineCollapsed = true"
          @update:preview-mode="previewMode = $event"
          @update:preview-track-indexes="customPreviewTrackIndexes = $event"
          @add-track="addTrackByType"
          @duplicate-track="duplicateTrack"
          @delete-track="deleteTrack"
          @focus-track="handleFocusTrack"
                    @track-selected="locateTrackTarget"
        />
        <div v-if="timelineCollapsed" class="timeline-collapsed-bar" @click="timelineCollapsed = false">
          🎬 {{ animationDef.tracks.length }} tracks
          <button class="expand-timeline-btn">▲</button>
        </div>
      </div>
      <div v-else class="timeline-empty-state">No animation timeline</div>

      <!-- Exit confirmation dialog (shown when unsaved changes exist) -->
      <div v-if="showCloseConfirm" class="close-confirm-overlay" @click.self="showCloseConfirm = false">
        <div class="close-confirm-dialog">
          <p class="close-confirm-msg">Animation has been modified, please choose how to exit:</p>
          <div class="close-confirm-actions">
            <button class="btn-cancel-close" @click="showCloseConfirm = false">Continue Editing</button>
            <button class="btn-discard" @click="handleConfirmDiscard">Discard Changes</button>
            <button class="btn-save-exit" @click="handleSaveAndExit">Save and Exit</button>
          </div>
        </div>
      </div>

      <!-- Delete track confirmation dialog -->
      <div v-if="trackDeleteDialog" class="close-confirm-overlay" @click.self="cancelDeleteTrack">
        <div class="close-confirm-dialog">
          <p class="close-confirm-title">{{ trackDeleteDialog.title }}</p>
          <p class="close-confirm-msg">{{ trackDeleteDialog.message }}</p>
          <div class="close-confirm-actions">
            <button class="btn-cancel-close" @click="cancelDeleteTrack">Cancel</button>
            <button class="btn-discard" @click="confirmDeleteTrack">Delete</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import * as PIXI from 'pixi.js'
import { GlowFilter, MotionBlurFilter } from 'pixi-filters'
import { computed, isRef, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import ZoomControls from '@/components/ZoomControls.vue'
import { type AnimationEditContext,useAnimationEdit } from '@/composables/useAnimationEdit'
import { runPreviewTracksOnCanvas } from '@/composables/useAnimationWorkbenchRenderer'
import { useAssetLoader } from '@/composables/useAssetLoader'
import type { SetupChangePayload } from '@/composables/useSceneRenderer'
import { useToast } from '@/composables/useToast'
import { DynamicEffectManager } from '@/core/animation/DynamicEffectManager'
import {
    accumulateEffectDelta,
    applyComposedTransformToContainer,
    createEmptyComposedTransform,
} from '@/core/AnimationComposition'
import { AnimationTrackEvaluator, AUTO_DURATION_MARKER } from '@/core/AnimationTrackEvaluator'
import { getTypeIcon } from '@/core/sceneObjectProviders/metadata'
import { applyContainerBaseTransform, captureContainerBaseState, type ContainerBaseState } from '@/core/WorkbenchBaseTransformSnapshot'
import { useBackgroundStore } from '@/stores/backgroundStore'
import { useExpressionStore } from '@/stores/expressionStore'
import { useProjectStore } from '@/stores/projectStore'
import { usePropStore } from '@/stores/propStore'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { AnimationDefinition, TransformTrackOutput, VisibilityTrackOutput } from '@/types/animation'
import type { AnimationTrack, AnimationTrackType, EffectParams } from '@/types/animation'
import { TARGET_SELF } from '@/types/animation'
import type { CompositeObject, SceneObject, SymbolObject } from '@/types/sceneObject'
import type { WorkbenchPreviewStore } from '@/types/WorkbenchPreviewStore'
import { restoreAnimatedSpriteStillFrame } from '@/utils/animationUtils'
import { extractPresetTargetsFromAnimation } from '@/utils/presetAnimationMapper'

import AnimationListPanel from './AnimationListPanel.vue'
import AnimationTimeline from './AnimationTimeline.vue'
import KeyframePropertyPanel from './KeyframePropertyPanel.vue'
import LightweightCanvas from './LightweightCanvas.vue'

// ===== Props & Emits =====

const props = defineProps<{
  visible: boolean
  animation?: AnimationDefinition | undefined
  resourceType: 'prop' | 'background' | 'symbol' | 'composite'
  resourceId: string
  sceneObjectId?: string
  targetObjectId?: string
  /** Existing animation names list (for duplicate prevention) */
  existingNames?: string[]
  /** Original animation name (edit mode allows keeping original name) */
  originalName?: string | undefined
  // === List Mode (Phase 3) ===
  /** All animations list (list mode) */
  animations?: AnimationDefinition[]
  /** Object mode */
  isObjectMode?: boolean
  /** Scene object */
  sceneObject?: SceneObject
  /** Root Composite ID */
  rootCompositeId?: string
  /** Upper editor persistence flow (e.g. character editor aggregates objects before saving) */
  persistChanges?: (() => Promise<void>) | undefined
}>()

const emit = defineEmits<{
  save: [animation: AnimationDefinition]
  close: []
  // List mode events
  'animation-saved': [animation: AnimationDefinition]
  'animation-deleted': [animationId: string]
  'animation-created': [animation: AnimationDefinition]
  'copy-from-self': []
  'preset-applied': []
  'update:animations': [animations: Record<string, AnimationDefinition>]
}>()

// ===== Refs =====

const overlayRef = ref<HTMLElement | null>(null)
const canvasRef = ref<InstanceType<typeof LightweightCanvas> | null>(null)
const projectStore = useProjectStore()
const toast = useToast()
const isSavingProject = ref(false)

// Right panel collapse / resize
const rightPanelCollapsed = ref(false)
const rightPanelWidth = ref(360)

// Left panel collapse / resize (list mode)
const leftPanelCollapsed = ref(false)
const leftPanelWidth = ref(320)

// Bottom timeline collapse / resize
const timelineCollapsed = ref(false)
const timelineHeight = ref(300)
const hasPendingProjectChanges = ref(false)

// Canvas toolbar: scene objects / pass-through list
const showSceneObjectPanel = ref(false)
const showPassThroughPanel = ref(false)
const expandedObjectIds = ref(new Set<string>())
const passThroughRevision = ref(0)
const workbenchStoreRevision = ref(0)

interface WorkbenchObjectNode {
    id: string
    name: string
    icon: string
    depth: number
    parentId?: string
    children: WorkbenchObjectNode[]
}

interface FlatWorkbenchObjectNode {
    id: string
    name: string
    icon: string
    depth: number
    hasChildren: boolean
}

interface PassThroughEntry {
    visible: boolean
}

interface WorkbenchSceneGraph {
    addPassThrough(objectId: string, visible?: boolean): void
    removePassThrough(objectId: string): void
    setPassThroughVisible(objectId: string, visible: boolean): void
    getPassThroughEntry(objectId: string): PassThroughEntry | undefined
    getPassThroughEntries(): ReadonlyMap<string, PassThroughEntry>
    getContainer(objectId: string): PIXI.Container | undefined
    getGenericAnimationPlayer(objectId: string): WorkbenchAnimationPlayer | undefined
    getGenericAnimationPlayers(): Map<string, WorkbenchAnimationPlayer>
}

interface WorkbenchRenderer {
    renderObjects(): Promise<void>
    syncObjectFromStore(objectId: string): void
    updateSelectionBox(): void
    setAutoRenderEnabled(enabled: boolean): void
    getSceneGraph(): WorkbenchSceneGraph
}

interface WorkbenchAnimationPlayer {
    playAnimation(name: string, definition: AnimationDefinition, params?: {
        loop?: boolean
        speed?: number
        reset?: boolean
        runtimeDuration?: number
    }): void
    stopAnimation(name: string): void
    cacheBaseTransform(): void
}

interface TrackDeleteDialogState {
    trackIndex: number
    title: string
    message: string
}

// === List mode determination ===
const listMode = computed(() => !!props.animations)
const isObjectMode = computed(() => props.isObjectMode ?? false)
const isCompositeMode = computed(() =>
  isObjectMode.value && props.sceneObject?.type === 'composite'
)
const allAnimationsList = computed(() => props.animations ?? [])
const hasActiveAnimation = ref(!!props.animation)
const rightPanelTitle = computed(() => {
    if (!hasActiveAnimation.value) return 'No Animation Selected'
    if (ctx.selectionMode.value === 'keyframe') return 'Keyframe Properties'
    if (ctx.selectionMode.value === 'track') return 'Track Properties'
    return 'Animation Overview'
})

const listPanelOptionalProps = computed(() => {
    const p: Record<string, unknown> = {}
    if (props.sceneObject) p['sceneObject'] = props.sceneObject
    if (props.rootCompositeId) p['rootCompositeId'] = props.rootCompositeId
    return p
})

function startResizeTimeline(event: MouseEvent) {
    event.preventDefault()
    const startY = event.clientY
    const startH = timelineHeight.value
    const onMove = (e: MouseEvent) => {
        timelineHeight.value = Math.max(160, Math.min(520, startH - (e.clientY - startY)))
    }
    const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
}

function startResizeRightPanel(event: MouseEvent) {
    event.preventDefault()
    const onMove = (e: MouseEvent) => {
        rightPanelWidth.value = Math.max(320, Math.min(620, window.innerWidth - e.clientX))
    }
    const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
}

function startResizeLeftPanel(event: MouseEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startW = leftPanelWidth.value
    const onMove = (e: MouseEvent) => {
        leftPanelWidth.value = Math.max(240, Math.min(480, startW + (e.clientX - startX)))
    }
    const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
}

const targetContainer = shallowRef<PIXI.Container | null>(null)
const rootContainer = shallowRef<PIXI.Container | null>(null)
const allPartContainers = shallowRef<Map<string, PIXI.Container> | null>(null)
const objectBounds = ref({ width: 200, height: 200 })

// Base transform (object's scene-level transform, used to compute keyframe deltas)
const basePosition = ref({ x: 0, y: 0 })
const baseScale = ref({ x: 1, y: 1 })
const baseRotation = ref(0)
const baseAlpha = ref(1)
const baseObjectPosition = ref({ x: 0, y: 0 })
const baseObjectScale = ref({ x: 1, y: 1 })
const baseObjectRotation = ref(0)
const baseObjectFlipX = ref(false)
const baseBounds = ref({ width: 0, height: 0, x: 0, y: 0 })

interface ObjectTransformBaseState {
    x: number
    y: number
    scaleX: number
    scaleY: number
    rotation: number
    alpha: number
    flipX: boolean
    transformOriginX: number
    transformOriginY: number
    visible: boolean
}

const baseStateCache = new Map<string, ContainerBaseState>()
const initialContainerBaseStateCache = new Map<string, ContainerBaseState>()
const objectBaseStateCache = new Map<string, ObjectTransformBaseState>()

/** ID of currently edited object in isolated store */
let currentTargetObjectId: string | null = null
let pivotPreviewObjectId: string | null = null
const WORKBENCH_STANDARD_PREVIEW_NAME = '__workbench_standard_preview__'
const isStandardPlaybackActive = ref(false)
let standardPlaybackRootObjectId: string | null = null
let standardPlaybackStartVersion = 0

const propStore = usePropStore()
const backgroundStore = useBackgroundStore()
const expressionStore = useExpressionStore()
const sceneObjectStore = useSceneObjectStore()
const { getTexture, loadAssets } = useAssetLoader()

// ===== Effect preview filter state (for effect track WYSIWYG preview) =====
// v24: Cached by target objectId to avoid multi-part preview overwriting
interface PreviewFilterBundle {
    glow: GlowFilter | null
    motionBlur: MotionBlurFilter | null
    colorMatrix: PIXI.ColorMatrixFilter | null
}

const previewFilterBundles = new Map<string, PreviewFilterBundle>()

function getOrCreateFilterBundle(key: string): PreviewFilterBundle {
    let bundle = previewFilterBundles.get(key)
    if (!bundle) {
        bundle = { glow: null, motionBlur: null, colorMatrix: null }
        previewFilterBundles.set(key, bundle)
    }
    return bundle
}

function clearEffectPreviewFiltersForKey(container: PIXI.Container, key: string) {
    const bundle = previewFilterBundles.get(key)
    if (!bundle) return
    const filtersToRemove = [bundle.glow, bundle.motionBlur, bundle.colorMatrix].filter(Boolean) as PIXI.Filter[]
    if (filtersToRemove.length > 0) {
        container.filters = (container.filters ?? []).filter(f => !filtersToRemove.includes(f))
    }
    bundle.glow = null
    bundle.motionBlur = null
    bundle.colorMatrix = null
}

/**
 * Filter cleanup helper for single-container preview (previewMode === 'current' etc).
 * Uses key of current edit target as cache key.
 */
function clearEffectPreviewFilters(container: PIXI.Container) {
    clearEffectPreviewFiltersForKey(container, currentTargetObjectId ?? TARGET_SELF)
}

function resetContainerPreviewState(container: PIXI.Container, objectId: string | null) {
    const key = getContainerBaseKey(objectId)
    const state = initialContainerBaseStateCache.get(key) ?? baseStateCache.get(key)
    if (state) {
        resetContainerToBaseStateWithKey(container, state, key)
        return
    }

    clearEffectPreviewFilters(container)
    container.position.set(basePosition.value.x, basePosition.value.y)
    container.scale.set(baseScale.value.x, baseScale.value.y)
    container.rotation = baseRotation.value
    container.alpha = baseAlpha.value
    restoreAnimatedSpriteBaseFrame(container, objectId)
}

// ===== Animation Edit Context =====

function createPlaceholderAnimation(): AnimationDefinition {
    const now = Date.now()
    return {
        type: 'track',
        id: '__placeholder_animation__',
        name: '',
        loop: false,
        tracks: [],
        createdAt: now,
        updatedAt: now,
    }
}

const ctx: AnimationEditContext = useAnimationEdit({
    animation: props.animation ?? createPlaceholderAnimation(),
})
ctx.deselectAll()

const animationDef = ctx.animationDef
const hasUnsavedWorkbenchChanges = computed(() =>
    ctx.hasUnsavedChanges.value || hasPendingProjectChanges.value
)

/** 'Original name' of currently edited animation for duplicate check, synced on animation switch */
const currentOriginalName = ref<string>(props.originalName ?? props.animation?.name ?? '')

type PreviewMode = 'current' | 'all' | 'custom'

const previewMode = ref<PreviewMode>('all')
const customPreviewTrackIndexes = ref<number[]>([])
const activePreviewTrackIndexes = computed(() => {
    if (!hasActiveAnimation.value) return []
    const indexes = ctx.allTracks.value.map(item => item.index)
    if (previewMode.value === 'all') return indexes
    if (previewMode.value === 'current') {
        const idx = ctx.currentTrackIndex.value
        return idx >= 0 ? [idx] : []
    }
    return customPreviewTrackIndexes.value.filter(index => indexes.includes(index))
})



watch(
    () => animationDef.loop,
    (loop) => {
        ctx.loopPlayback.value = loop
    },
    { immediate: true }
)

const trackTargetOptions = computed(() => {
    const options: { id: string; label: string }[] = [{ id: TARGET_SELF, label: 'Self' }]
    const seen = new Set<string>([TARGET_SELF])

    // Uniformly build hierarchical list via tree traversal
    if (props.sceneObject?.type === 'composite') {
        buildTargetHierarchy(props.sceneObject as CompositeObject, 1, seen, options)
    }

    return options
})

/**
 * Recursively build composite child object hierarchy tree, expressing relations via indent prefixes.
 */
function buildTargetHierarchy(
    composite: CompositeObject,
    depth: number,
    seen: Set<string>,
    options: { id: string; label: string }[],
) {
    const childIds = composite.childIds ?? []
    for (const childId of childIds) {
        if (seen.has(childId)) continue
        seen.add(childId)
        const child = sceneObjectStore.getObject(childId)
        const name = child?.alias?.trim() || child?.name?.trim() || childId
        const indent = '　'.repeat(depth - 1) + (depth > 0 ? '└ ' : '')
        options.push({ id: childId, label: `${indent}${name}` })

        if (child?.type === 'composite') {
            buildTargetHierarchy(child as CompositeObject, depth + 1, seen, options)
        }
    }
}

function getTrackTargetLabel(targetObjectId: string | undefined): string {
    return trackTargetOptions.value.find(option => option.id === (targetObjectId ?? TARGET_SELF))?.label ?? 'Self'
}

// Optional props for LightweightCanvas (avoid passing undefined with exactOptionalPropertyTypes)
const canvasOptionalProps = computed(() => {
    const p: Record<string, string> = {}
    if (props.sceneObjectId) p['scene-object-id'] = props.sceneObjectId
    if (props.targetObjectId) p['target-object-id'] = props.targetObjectId
    return p
})

// Zoom value (unwrap Ref from renderer exposed via defineExpose)
const canvasZoom = computed(() => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const zoom = canvasRef.value?.renderer?.userZoom
    if (zoom == null) return 1
    return isRef(zoom) ? (zoom.value as number) : (zoom as number)
})

const workbenchAnimStore = computed<WorkbenchPreviewStore | null>(() => {
    void workbenchStoreRevision.value
    return (canvasRef.value?.previewStore as WorkbenchPreviewStore | null) ?? null
})

const propertyPanelSceneObjects = computed(() => {
    const store = workbenchAnimStore.value
    if (store?.objects.length) return store.objects
    return props.sceneObject ? [props.sceneObject] : []
})

const selectedWorkbenchObjectId = computed(() => {
    void workbenchStoreRevision.value
    return workbenchAnimStore.value?.selectedObjectId ?? null
})

const selectedWorkbenchObjectLabel = computed(() => {
    const selectedId = selectedWorkbenchObjectId.value
    const selected = selectedId ? workbenchAnimStore.value?.getObject(selectedId) : null
    if (!selected) return 'Select scene object'
    return `${getTypeIcon(selected.type)} ${getObjectDisplayName(selected)}`
})

const sceneObjectTreeNodes = computed<WorkbenchObjectNode[]>(() => {
    void workbenchStoreRevision.value
    const store = workbenchAnimStore.value
    const objects = store?.objects ?? []
    const objectMap = new Map(objects.map(obj => [obj.id, obj]))
    const roots = objects.filter(obj => !obj.parentId || !objectMap.has(obj.parentId))
    const sceneOrder = new Map<string, number>()
    store?.getSceneRenderChain().forEach((id, index) => sceneOrder.set(id, index))

    function getObjectOrder(obj: SceneObject): number {
        if (sceneOrder.has(obj.id)) return sceneOrder.get(obj.id)!
        if (obj.parentId) {
            const parent = objectMap.get(obj.parentId)
            if (parent?.type === 'composite') {
                const parentComp = parent as CompositeObject
                const renderIndex = parentComp.renderChain?.indexOf(obj.id) ?? -1
                if (renderIndex >= 0) return renderIndex
                const childIndex = parentComp.childIds?.indexOf(obj.id) ?? -1
                if (childIndex >= 0) return childIndex
            }
        }
        return obj.zIndex
    }

    function buildNode(obj: SceneObject, depth: number): WorkbenchObjectNode {
        const comp = obj.type === 'composite' ? obj as CompositeObject : null
        const childIds = comp
            ? (comp.childIds ?? [])
            : objects.filter(child => child.parentId === obj.id).map(child => child.id)

        const children = childIds
            .map(childId => objectMap.get(childId))
            .filter((child): child is SceneObject => Boolean(child))
            .sort((a, b) => getObjectOrder(a) - getObjectOrder(b))
            .map(child => buildNode(child, depth + 1))

        return {
            id: obj.id,
            name: getObjectDisplayName(obj),
            icon: getTypeIcon(obj.type),
            depth,
            ...(obj.parentId ? { parentId: obj.parentId } : {}),
            children,
        }
    }

    return roots
        .sort((a, b) => getObjectOrder(a) - getObjectOrder(b))
        .map(obj => buildNode(obj, 0))
})

const trackTargetTreeNodes = computed<WorkbenchObjectNode[]>(() => {
    const rootId = getRootPreviewObjectId()
    const roots = sceneObjectTreeNodes.value
    const rootNode = roots.find(node => node.id === rootId)
    const targetRoots = rootNode ? rootNode.children : roots
    return targetRoots
})

const flatSceneObjectNodes = computed<FlatWorkbenchObjectNode[]>(() => {
    const result: FlatWorkbenchObjectNode[] = []

    function walk(nodes: WorkbenchObjectNode[]): void {
        for (const node of nodes) {
            result.push({
                id: node.id,
                name: node.name,
                icon: node.icon,
                depth: node.depth,
                hasChildren: node.children.length > 0,
            })
            if (node.children.length > 0 && expandedObjectIds.value.has(node.id)) {
                walk(node.children)
            }
        }
    }

    walk(sceneObjectTreeNodes.value)
    return result
})

const passThroughIds = computed(() => {
    void passThroughRevision.value
    const sceneGraph = getWorkbenchSceneGraph()
    if (!sceneGraph) return []
    return [...sceneGraph.getPassThroughEntries().keys()]
})

const passThroughEntries = computed(() => {
    void passThroughRevision.value
    const sceneGraph = getWorkbenchSceneGraph()
    const store = workbenchAnimStore.value
    if (!sceneGraph || !store) return []

    return [...sceneGraph.getPassThroughEntries()].flatMap(([objectId, entry]) => {
        const obj = store.getObject(objectId)
        if (!obj) return []
        return [{
            objectId,
            name: getObjectDisplayName(obj),
            icon: getTypeIcon(obj.type),
            visible: entry.visible,
        }]
    })
})

const selectedObjectIsPassThrough = computed(() => {
    const selectedId = selectedWorkbenchObjectId.value
    if (!selectedId) return false
    return passThroughIds.value.includes(selectedId)
})

function getObjectDisplayName(obj: SceneObject): string {
    return obj.alias?.trim() || obj.name?.trim() || obj.id
}

function toggleSceneObjectPanel(): void {
    showSceneObjectPanel.value = !showSceneObjectPanel.value
    if (showSceneObjectPanel.value) showPassThroughPanel.value = false
}

function togglePassThroughPanel(): void {
    showPassThroughPanel.value = !showPassThroughPanel.value
    if (showPassThroughPanel.value) showSceneObjectPanel.value = false
}

function toggleObjectExpanded(objectId: string): void {
    const next = new Set(expandedObjectIds.value)
    if (next.has(objectId)) {
        next.delete(objectId)
    } else {
        next.add(objectId)
    }
    expandedObjectIds.value = next
}

function selectWorkbenchObject(objectId: string): void {
    workbenchAnimStore.value?.selectObject(objectId)
    workbenchStoreRevision.value++
    showSceneObjectPanel.value = false
    void getWorkbenchRenderer()?.renderObjects()
}

function addSelectedObjectToPassThrough(): void {
    const selectedId = selectedWorkbenchObjectId.value
    if (!selectedId || selectedObjectIsPassThrough.value) return
    addToPassThrough(selectedId)
}

function addToPassThrough(objectId: string): void {
    const renderer = getWorkbenchRenderer()
    const sceneGraph = renderer?.getSceneGraph()
    if (!renderer || !sceneGraph) return
    sceneGraph.addPassThrough(objectId)
    passThroughRevision.value++
    void renderer.renderObjects()
}

function removeFromPassThrough(objectId: string): void {
    const renderer = getWorkbenchRenderer()
    const sceneGraph = renderer?.getSceneGraph()
    if (!renderer || !sceneGraph) return
    sceneGraph.removePassThrough(objectId)
    passThroughRevision.value++
    void renderer.renderObjects()
}

function togglePassThroughVisible(objectId: string): void {
    const renderer = getWorkbenchRenderer()
    const sceneGraph = renderer?.getSceneGraph()
    const entry = sceneGraph?.getPassThroughEntry(objectId)
    if (!renderer || !sceneGraph || !entry) return
    sceneGraph.setPassThroughVisible(objectId, !entry.visible)
    passThroughRevision.value++
    void renderer.renderObjects()
}

function closeToolbarPopovers(): void {
    showSceneObjectPanel.value = false
    showPassThroughPanel.value = false
}

function getWorkbenchRenderer(): WorkbenchRenderer | null {
    return canvasRef.value?.renderer as unknown as WorkbenchRenderer | null
}

function getWorkbenchSceneGraph(): WorkbenchSceneGraph | null {
    return getWorkbenchRenderer()?.getSceneGraph() ?? null
}

function resetRuntimeStoreFromBase(): void {
    canvasRef.value?.resetRuntimeFromBase?.()
    const renderer = getWorkbenchRenderer()
    const store = workbenchAnimStore.value
    if (!renderer || !store) return
    for (const obj of store.objects) {
        renderer.syncObjectFromStore(obj.id)
    }
}

// ===== Canvas Ready =====

function onCanvasAppReady(_app: PIXI.Application) {
    void nextTick(() => overlayRef.value?.focus())
}

function onContainerReady(payload: {
    container: PIXI.Container
    partContainers?: Map<string, PIXI.Container>
    objectBounds: { width: number; height: number }
}) {
    workbenchStoreRevision.value++
    passThroughRevision.value++
    rootContainer.value = payload.container
    allPartContainers.value = payload.partContainers ?? null
    objectBounds.value = payload.objectBounds

    const resolved = resolveTargetContainer()
    targetContainer.value = resolved

    // Record current target object ID (used to read dragged values from store)
    resolveCurrentTargetObjectId()

    captureObjectBaseStateCache()
    captureInitialContainerBaseStateCache()
    syncCurrentTrackPivotPreview()
    captureBaseTransform(resolved)
    warmPreviewBaseStateCache()
    syncRuntimeTrackDuration()
    expandRootObjectNodes()

    // Apply initial keyframe state
    if (hasActiveAnimation.value) {
        applyTimeToCanvas(ctx.playheadPosition.value)
    }
}

function expandRootObjectNodes(): void {
    if (expandedObjectIds.value.size > 0) return
    const rootIds = sceneObjectTreeNodes.value
        .filter(node => node.children.length > 0)
        .map(node => node.id)
    if (rootIds.length === 0) return
    expandedObjectIds.value = new Set(rootIds)
}

// ===== Multi-track target resolution =====

function resolveTargetContainer(): PIXI.Container {
    const track = ctx.currentTrackAny.value
    return resolveTargetContainerForTrack(track)
}

function resolveTargetContainerForTrack(track: AnimationTrack | null | undefined): PIXI.Container {
    const targetId = track?.targetObjectId
    const parts = allPartContainers.value
    const root = rootContainer.value!

    if (targetId && targetId !== TARGET_SELF && parts?.has(targetId)) {
        return parts.get(targetId)!
    }
    return root
}

/** Resolve current target object ID in isolated store */
function resolveCurrentTargetObjectId() {
    const track = ctx.currentTrackAny.value
    currentTargetObjectId = resolveTargetObjectIdForTrack(track)
}

function resolveTargetObjectIdForTrack(track: AnimationTrack | null | undefined): string | null {
    const targetId = track?.targetObjectId

    if (targetId && targetId !== TARGET_SELF) {
        return targetId
    }

    let objectId = props.sceneObjectId ?? null
    if (!objectId) {
        const store = (canvasRef.value?.previewStore as WorkbenchPreviewStore | null)
        if (store) {
            objectId = store.selectedObjectId
        }
    }
    return objectId
}

function getRootPreviewObjectId(): string | null {
    return props.sceneObjectId ?? props.sceneObject?.id ?? null
}

function getContainerBaseKey(objectId: string | null): string {
    return objectId ?? TARGET_SELF
}

function captureInitialContainerBaseStateCache() {
    initialContainerBaseStateCache.clear()

    const root = rootContainer.value
    if (root) {
        const rootObjectId = getRootPreviewObjectId()
        const state = captureContainerBaseState(root, rootObjectId)
        initialContainerBaseStateCache.set(getContainerBaseKey(rootObjectId), state)
        initialContainerBaseStateCache.set(TARGET_SELF, state)
    }

    for (const [objectId, container] of allPartContainers.value ?? []) {
        initialContainerBaseStateCache.set(objectId, captureContainerBaseState(container, objectId))
    }
}

function getInitialContainerBaseState(key: string, container?: PIXI.Container | null, objectId?: string | null): ContainerBaseState | null {
    const cached = initialContainerBaseStateCache.get(key)
    if (cached) return cached
    if (!container) return null

    const state = captureContainerBaseState(container, objectId ?? (key === TARGET_SELF ? getRootPreviewObjectId() : key))
    initialContainerBaseStateCache.set(key, state)
    return state
}

function captureObjectBaseStateCache() {
    objectBaseStateCache.clear()
    const store = (canvasRef.value?.previewStore as WorkbenchPreviewStore | null)
    if (!store) return

    for (const obj of store.objects) {
        objectBaseStateCache.set(obj.id, {
            x: obj.x,
            y: obj.y,
            scaleX: obj.scaleX,
            scaleY: obj.scaleY,
            rotation: obj.rotation,
            alpha: obj.alpha,
            flipX: obj.flipX,
            transformOriginX: obj.transformOriginX ?? 0,
            transformOriginY: obj.transformOriginY ?? 0,
            visible: obj.visible,
        })
    }

}

function getObjectBaseState(objectId: string | null): ObjectTransformBaseState | null {
    if (!objectId) return null
    const cached = objectBaseStateCache.get(objectId)
    if (cached) return cached

    const obj = getSceneObjectById(objectId)
    if (!obj) return null
    const state: ObjectTransformBaseState = {
        x: obj.x,
        y: obj.y,
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
        rotation: obj.rotation,
        alpha: obj.alpha,
        flipX: obj.flipX,
        transformOriginX: obj.transformOriginX ?? 0,
        transformOriginY: obj.transformOriginY ?? 0,
        visible: obj.visible,
    }
    objectBaseStateCache.set(objectId, state)
    return state
}

function resolveObjectIdForPreviewKey(key: string): string | null {
    if (key !== TARGET_SELF) return key
    return getRootPreviewObjectId() ?? currentTargetObjectId
}

function restoreStoreObjectToBase(objectId: string | null) {
    if (!objectId) return
    const state = objectBaseStateCache.get(objectId)
    const store = (canvasRef.value?.previewStore as WorkbenchPreviewStore | null)
    if (!state || !store) return
    store.updateObject(objectId, {
        x: state.x,
        y: state.y,
        scaleX: state.scaleX,
        scaleY: state.scaleY,
        rotation: state.rotation,
        alpha: state.alpha,
        flipX: state.flipX,
        transformOriginX: state.transformOriginX,
        transformOriginY: state.transformOriginY,
        visible: state.visible,
    })
}

function syncObjectOriginPreview(objectId: string, transformOriginX: number, transformOriginY: number): boolean {
    const renderer = getWorkbenchRenderer()
    const store = (canvasRef.value?.previewStore as WorkbenchPreviewStore | null)
    if (!renderer || !store) return false

    const obj = store.getObject(objectId)
    if (!obj) return false

    const containerKey = getContainerBaseKey(objectId)
    const baseContainer = getInitialContainerBaseState(containerKey, resolveContainerForKey(containerKey), objectId)
    const container = resolveContainerForKey(containerKey)
    const baseObj = getObjectBaseState(objectId)
    if (!baseContainer || !container || container.destroyed || !baseObj) return false

    const pivotBaseX = baseContainer.pivot.x - baseObj.transformOriginX
    const pivotBaseY = baseContainer.pivot.y - baseObj.transformOriginY
    const expectedPivotX = pivotBaseX + transformOriginX
    const expectedPivotY = pivotBaseY + transformOriginY
    const dOX = transformOriginX - baseObj.transformOriginX
    const dOY = transformOriginY - baseObj.transformOriginY
    const flipSign = baseObj.flipX ? -1 : 1
    const expectedPositionX = baseContainer.position.x + flipSign * dOX
    const expectedPositionY = baseContainer.position.y + dOY

    const visualMatches =
        Math.abs(container.pivot.x - expectedPivotX) < 0.001 &&
        Math.abs(container.pivot.y - expectedPivotY) < 0.001 &&
        Math.abs(container.position.x - expectedPositionX) < 0.001 &&
        Math.abs(container.position.y - expectedPositionY) < 0.001

    if (visualMatches) {
        return false
    }

    // Track pivot is track-level state, should not be written to preview store transformOrigin.
    // Otherwise preview composition treats track.pivot as base pivot, making pivot delta 0.
    container.pivot.set(expectedPivotX, expectedPivotY)
    container.position.set(expectedPositionX, expectedPositionY)
    return true
}

function restoreObjectPivotPreview(objectId: string | null): boolean {
    if (!objectId) return false
    const base = getObjectBaseState(objectId)
    if (!base) return false
    return syncObjectOriginPreview(objectId, base.transformOriginX, base.transformOriginY)
}

function getDefaultTrackPivot(objectId: string | null): { x: number; y: number } | null {
    const resolvedObjectId = objectId && objectId !== TARGET_SELF ? objectId : getRootPreviewObjectId()
    const key = getContainerBaseKey(resolvedObjectId)
    const baseContainer = initialContainerBaseStateCache.get(key) ?? baseStateCache.get(key)
    if (!baseContainer) return null
    return { x: baseContainer.pivot.x, y: baseContainer.pivot.y }
}

function applyTrackPivotPreview(objectId: string, pivot: { x: number; y: number }): boolean {
    const baseObject = getObjectBaseState(objectId)
    const containerKey = getContainerBaseKey(objectId)
    const baseContainer = getInitialContainerBaseState(containerKey, resolveContainerForKey(containerKey), objectId)
    if (!baseObject || !baseContainer) return false

    const pivotBaseX = baseContainer.pivot.x - baseObject.transformOriginX
    const pivotBaseY = baseContainer.pivot.y - baseObject.transformOriginY
    return syncObjectOriginPreview(
        objectId,
        pivot.x - pivotBaseX,
        pivot.y - pivotBaseY,
    )
}

function syncCurrentTrackPivotPreview(): void {
    const renderer = getWorkbenchRenderer()
    if (!renderer) return

    const activeTrack = ctx.currentTrack.value
    const activeObjectId = resolveTargetObjectIdForTrack(activeTrack)
    const activePivot = activeTrack?.pivot
    let selectionChanged = false

    if (pivotPreviewObjectId && (pivotPreviewObjectId !== activeObjectId || !activePivot)) {
        selectionChanged = restoreObjectPivotPreview(pivotPreviewObjectId) || selectionChanged
    }

    if (activeTrack && activeObjectId && activePivot) {
        selectionChanged = applyTrackPivotPreview(activeObjectId, activePivot) || selectionChanged
        pivotPreviewObjectId = activeObjectId
    } else {
        pivotPreviewObjectId = null
    }

    if (selectionChanged) {
        renderer.updateSelectionBox()
    }
}

function captureBaseTransform(container: PIXI.Container) {
    const baseObjectFromCache = getObjectBaseState(currentTargetObjectId)
    const baseObjectFromStore = getSceneObjectById(currentTargetObjectId)
    const cacheKey = getContainerBaseKey(currentTargetObjectId)
    const initialContainerBase = getInitialContainerBaseState(cacheKey, container, currentTargetObjectId)
    const transformBase = initialContainerBase ?? captureContainerBaseState(container, currentTargetObjectId)

    basePosition.value = {
        x: transformBase.position.x,
        y: transformBase.position.y,
    }
    baseScale.value = {
        x: transformBase.scale.x,
        y: transformBase.scale.y,
    }
    baseRotation.value = transformBase.rotation
    baseAlpha.value = transformBase.alpha
    const localBounds = transformBase.bounds
    baseBounds.value = {
        width: localBounds.width,
        height: localBounds.height,
        x: localBounds.x,
        y: localBounds.y,
    }

    const baseObject = baseObjectFromCache ?? baseObjectFromStore
    if (baseObject) {
        baseObjectPosition.value = {
            x: baseObject.x,
            y: baseObject.y,
        }
        baseObjectScale.value = {
            x: baseObject.scaleX,
            y: baseObject.scaleY,
        }
        baseObjectRotation.value = baseObject.rotation
        baseObjectFlipX.value = baseObject.flipX ?? false
    } else {
        baseObjectPosition.value = { x: container.position.x, y: container.position.y }
        baseObjectScale.value = { x: Math.abs(container.scale.x), y: container.scale.y }
        baseObjectRotation.value = container.rotation
        baseObjectFlipX.value = container.scale.x < 0
    }

    baseStateCache.set(cacheKey, transformBase)
}

function warmPreviewBaseStateCache() {
    baseStateCache.clear()
    for (const { track } of ctx.allTracks.value) {
        const container = resolveTargetContainerForTrack(track)
        const objectId = resolveTargetObjectIdForTrack(track)
        const key = getContainerBaseKey(objectId)
        const state = getInitialContainerBaseState(key, container, objectId)
        if (state) baseStateCache.set(key, state)
    }
}

function getBaseStateForTrack(track: AnimationTrack): ContainerBaseState {
    const objectId = resolveTargetObjectIdForTrack(track)
    const key = getContainerBaseKey(objectId)
    const cached = baseStateCache.get(key)
    if (cached) return cached

    const container = resolveTargetContainerForTrack(track)
    const state = getInitialContainerBaseState(key, container, objectId) ?? captureContainerBaseState(container, objectId)
    baseStateCache.set(key, state)
    return state
}

function getSceneObjectById(objectId: string | null): SceneObject | null {
    if (!objectId) return props.sceneObject ?? null
    const store = (canvasRef.value?.previewStore as WorkbenchPreviewStore | null)
    if (!store) return props.sceneObject ?? null
    const obj = store.getObject(objectId)
    return obj ?? props.sceneObject ?? null
}

function restoreAnimatedSpriteBaseFrame(container: PIXI.Container, objectId: string | null) {
    const sprite = findAnimatedSprite(container)
    if (!sprite) return

    const obj = getSceneObjectById(objectId)
    if (!obj) {
        sprite.gotoAndStop(0)
        return
    }

    if (obj.type === 'prop') {
        const prop = propStore.getProp(obj.refId)
        if (prop?.type === 'animation') {
            restoreAnimatedSpriteStillFrame(sprite, {
                stillFrameSource: prop.stillFrameSource,
                stillFrameIndex: prop.stillFrameIndex,
                url: prop.stillFrameCustomUrl,
            }, getTexture)
            return
        }
    }

    if (obj.type === 'background') {
        const background = backgroundStore.getBackground(obj.refId)
        if (background?.type === 'animation') {
            restoreAnimatedSpriteStillFrame(sprite, {
                stillFrameSource: background.stillFrameSource,
                stillFrameIndex: background.stillFrameIndex,
                url: background.stillFrameCustomUrl,
            }, getTexture)
            return
        }
    }

    if (obj.type === 'symbol') {
        const symbol = obj as SymbolObject
        const materialId = symbol.currentMaterialId
        const material = materialId
            ? symbol.materials.find(m => m.id === materialId)
            : symbol.materials[0]
        if (material?.type === 'animation') {
            restoreAnimatedSpriteStillFrame(sprite, {
                stillFrameSource: material.stillFrameSource,
                stillFrameIndex: material.stillFrameIndex,
                url: material.url,
            }, getTexture)
            return
        }
    }

    if (obj.type === 'expression') {
        const expression = expressionStore.getExpression(obj.refId)
        const defaultFrameUrl = expression?.defaultFrame?.url
        if (defaultFrameUrl) {
            const defaultTexture = getTexture(defaultFrameUrl)
            if (defaultTexture && defaultTexture !== PIXI.Texture.EMPTY) {
                sprite.texture = defaultTexture
                return
            }
        }
    }

    sprite.gotoAndStop(0)
}

function getFrameSequencePreviewDurationMs(
    track: AnimationTrack & { trackType: 'frame_sequence' },
    container: PIXI.Container | null,
): number | null {
    if (!track || !container) return null
    const sprite = findAnimatedSprite(container)
    if (!sprite || sprite.totalFrames <= 0) return null
    // track.fps preferred, otherwise derive resource FPS from sprite animationSpeed
    const resolvedFps = track.fps ?? (sprite.animationSpeed > 0 ? sprite.animationSpeed * 60 : 25)
    if (resolvedFps <= 0) return null
    return (sprite.totalFrames / resolvedFps) * 1000
}

function findAnimatedSprite(container: PIXI.Container): PIXI.AnimatedSprite | null {
    const names = ['prop_animation', 'bg_animation', 'background_animation', 'symbol_animation', 'expression_animation', 'animation']
    for (const name of names) {
        const child = container.getChildByName(name)
        if (child instanceof PIXI.AnimatedSprite) return child
    }
    return null
}

interface FrameSequencePreviewSource {
    spriteName: string
    frameUrls: string[]
    stillFrameSource: 'frame' | 'custom' | undefined
    stillFrameIndex: number | undefined
    stillFrameUrl: string | undefined
    fps: number
    loop: boolean
    anchor: [number, number]
    width?: number
    height?: number
}

function collectNonEmptyTextures(urls: string[]): PIXI.Texture[] {
    const textures: PIXI.Texture[] = []
    for (const url of urls) {
        const texture = getTexture(url)
        if (texture && texture !== PIXI.Texture.EMPTY) {
            textures.push(texture)
        }
    }
    return textures
}

function resolveFrameSequencePreviewSource(
    track: AnimationTrack & { trackType: 'frame_sequence' },
): FrameSequencePreviewSource | null {
    const objectId = resolveTargetObjectIdForTrack(track)
    const obj = getSceneObjectById(objectId)
    if (!obj) return null

    if (obj.type === 'prop') {
        const prop = propStore.getProp(obj.refId)
        if (prop?.type !== 'animation' || !prop.frames?.length) return null
        return {
            spriteName: 'prop_animation',
            frameUrls: prop.frames.map(frame => frame.url).filter(Boolean),
            stillFrameSource: prop.stillFrameSource,
            stillFrameIndex: prop.stillFrameIndex,
            stillFrameUrl: prop.stillFrameCustomUrl,
            fps: track.fps ?? prop.fps ?? 25,
            loop: track.loop ?? prop.loop ?? true,
            anchor: [0.5, 0.5],
        }
    }

    if (obj.type === 'background') {
        const background = backgroundStore.getBackground(obj.refId)
        if (background?.type !== 'animation' || !background.frames?.length) return null
        return {
            spriteName: 'bg_animation',
            frameUrls: background.frames.map(frame => frame.url).filter(Boolean),
            stillFrameSource: background.stillFrameSource,
            stillFrameIndex: background.stillFrameIndex,
            stillFrameUrl: background.stillFrameCustomUrl,
            fps: track.fps ?? background.fps ?? 25,
            loop: track.loop ?? background.loop ?? true,
            anchor: [0, 0],
            width: obj.width,
            height: obj.height,
        }
    }

    if (obj.type === 'symbol') {
        const symbol = obj as SymbolObject
        const materialId = symbol.currentMaterialId
        const material = materialId
            ? symbol.materials.find(item => item.id === materialId)
            : symbol.materials[0]
        if (material?.type !== 'animation' || !material.frames?.length) return null
        return {
            spriteName: 'symbol_animation',
            frameUrls: material.frames.map(frame => frame.url).filter(Boolean),
            stillFrameSource: material.stillFrameSource,
            stillFrameIndex: material.stillFrameIndex,
            stillFrameUrl: material.url,
            fps: track.fps ?? material.fps ?? 12,
            loop: track.loop ?? material.loop ?? true,
            anchor: [0.5, 0.5],
        }
    }

    return null
}

async function ensureFrameSequencePreviewSprite(
    track: AnimationTrack & { trackType: 'frame_sequence' },
    container: PIXI.Container,
): Promise<void> {
    if (findAnimatedSprite(container)) return

    const stillSprite = container.getChildByName('editor_still_sprite')
    if (!stillSprite) return

    const source = resolveFrameSequencePreviewSource(track)
    if (!source || source.frameUrls.length <= 1) return

    const urlsToLoad = new Set<string>(source.frameUrls)
    if (source.stillFrameUrl) urlsToLoad.add(source.stillFrameUrl)
    await loadAssets(urlsToLoad, new Set(), 'AnimationWorkbench.frameSequencePreview')

    const textures = collectNonEmptyTextures(source.frameUrls)
    if (textures.length <= 1) return

    container.removeChild(stillSprite)
    stillSprite.destroy()

    const animatedSprite = new PIXI.AnimatedSprite(textures)
    animatedSprite.name = source.spriteName
    animatedSprite.anchor.set(source.anchor[0], source.anchor[1])
    animatedSprite.animationSpeed = source.fps / 60
    animatedSprite.loop = source.loop
    animatedSprite.autoUpdate = false
    if (source.width !== undefined && source.width > 0) animatedSprite.width = source.width
    if (source.height !== undefined && source.height > 0) animatedSprite.height = source.height
    restoreAnimatedSpriteStillFrame(animatedSprite, {
        stillFrameSource: source.stillFrameSource,
        stillFrameIndex: source.stillFrameIndex,
        url: source.stillFrameUrl,
    }, getTexture)
    container.addChild(animatedSprite)
}

async function prepareFrameSequencePreviewSprites(definition: AnimationDefinition): Promise<void> {
    if (definition.type !== 'track') return
    for (const track of definition.tracks) {
        if (track.trackType !== 'frame_sequence') continue
        const container = resolveTargetContainerForTrack(track)
        await ensureFrameSequencePreviewSprite(track, container)
    }
}

function syncRuntimeTrackDuration() {
    if (previewMode.value !== 'current') {
        const durations = activePreviewTrackIndexes.value
            .map(index => animationDef.tracks[index])
            .filter((track): track is AnimationTrack => !!track)
            .map(track => getTrackDurationMs(track))
            .filter(duration => Number.isFinite(duration) && duration > 0)
        ctx.setTrackDurationOverride(durations.length > 0 ? Math.max(...durations) : 1000)
        return
    }
    const track = ctx.currentTrackAny.value
    if (track?.trackType === 'frame_sequence') {
        ctx.setTrackDurationOverride(getFrameSequencePreviewDurationMs(track, targetContainer.value))
    } else if (track?.trackType === 'effect') {
        const duration = getTrackDurationMs(track)
        ctx.setTrackDurationOverride(Number.isFinite(duration) && duration > 0 ? duration : 1000)
    } else {
        ctx.setTrackDurationOverride(null)
    }
}

const trackDurationSignature = computed(() => animationDef.tracks.map(track => {
    if (track.trackType === 'transform' || track.trackType === 'visibility') {
        return `${track.trackType}:${track.duration ?? 'default'}`
    }
    if (track.trackType === 'frame_sequence') {
        return `${track.trackType}:${track.targetObjectId ?? TARGET_SELF}:${track.assetId ?? ''}:${track.fps ?? 25}`
    }
    return `${track.trackType}:${track.targetObjectId ?? TARGET_SELF}:${getTrackDurationMs(track)}`
}).join('|'))

// Watch for track switches → rebind to correct container
watch(() => ctx.currentTrackIndex.value, () => {
    if (!hasActiveAnimation.value) return
    if (!rootContainer.value) return

    const newTarget = resolveTargetContainer()
    const prevTarget = targetContainer.value
    const prevTargetObjectId = currentTargetObjectId

    // Always clear current preview state to avoid leftovers from previous track
    if (prevTarget) {
        resetContainerPreviewState(prevTarget, prevTargetObjectId)
    }

    targetContainer.value = newTarget
    resolveCurrentTargetObjectId()
    syncCurrentTrackPivotPreview()
    captureBaseTransform(newTarget)
    syncRuntimeTrackDuration()

    applyTimeToCanvas(ctx.playheadPosition.value)
    locateTrackTarget(ctx.currentTrackIndex.value)
})

watch(() => ctx.currentFrameSequenceTrack.value?.fps, () => {
    syncRuntimeTrackDuration()
})

watch(trackDurationSignature, () => {
    if (!hasActiveAnimation.value) return
    syncRuntimeTrackDuration()
    if (ctx.isPlaying.value && isStandardPlaybackActive.value) {
        restartStandardWorkbenchPlayback()
        return
    }
    applyTimeToCanvas(ctx.playheadPosition.value)
})

watch(() => ctx.currentTrackAny.value?.targetObjectId, () => {
    if (!hasActiveAnimation.value) return
    if (!rootContainer.value) return
    const newTarget = resolveTargetContainer()
    targetContainer.value = newTarget
    resolveCurrentTargetObjectId()
    syncCurrentTrackPivotPreview()
    captureBaseTransform(newTarget)
    warmPreviewBaseStateCache()
    applyTimeToCanvas(ctx.playheadPosition.value)
    locateTrackTarget(ctx.currentTrackIndex.value)
})

watch(
    () => {
        const track = ctx.currentTrack.value
        const pivot = track?.pivot
        const objectId = resolveTargetObjectIdForTrack(track)
        return pivot ? `${objectId ?? TARGET_SELF}:${pivot.x}:${pivot.y}` : 'none'
    },
    () => {
        if (!hasActiveAnimation.value) return
        if (!rootContainer.value) return
        syncCurrentTrackPivotPreview()
        const container = resolveTargetContainer()
        targetContainer.value = container
        captureBaseTransform(container)
        applyTimeToCanvas(ctx.playheadPosition.value)
    },
)

watch([previewMode, activePreviewTrackIndexes], () => {
    if (!hasActiveAnimation.value) return
    syncRuntimeTrackDuration()
    if (ctx.isPlaying.value && isStandardPlaybackActive.value) {
        restartStandardWorkbenchPlayback()
        return
    }
    applyTimeToCanvas(ctx.playheadPosition.value)
})

// ===== Store Change → Keyframe =====

/**
 * Unified pivot submission entry point. Called from three places:
 * 1. Main canvas onSetupChange('origin') (backward compatibility, main canvas is read-only gizmo)
 * 2. KeyframePropertyPanel numeric input
 * 3. PivotEditorPanel visual dragging
 *
 * Only updates transform track's own pivot. This pivot is the benchmark for animation evaluation,
 * no reverse keyframe compensation; current frame recalculates from base pose with new pivot.
 */
function commitTrackPivotChange(targetObjectId: string, newPivot: { x: number; y: number }) {
    const activeTrack = ctx.currentTrack.value
    const activeTargetObjectId = resolveTargetObjectIdForTrack(activeTrack)

    if (!activeTrack || activeTargetObjectId !== targetObjectId) {
        restoreObjectPivotPreview(targetObjectId)
        syncCurrentTrackPivotPreview()
        applyTimeToCanvas(ctx.playheadPosition.value)
        toast.info('Pivot can only be edited on the corresponding transform track.')
        return
    }

    ctx.updatePivot(newPivot)
    currentTargetObjectId = activeTargetObjectId
    targetContainer.value = resolveTargetContainerForTrack(activeTrack)
    applyTimeToCanvas(ctx.playheadPosition.value)
    if (previewMode.value === 'current') {
        syncTrackPivotToRuntimeTarget(activeTargetObjectId)
    }
}

/**
 * Property panel (KeyframePropertyPanel) event callback.
 * Track target determined by active track, no explicit targetObjectId needed.
 */
function onPropertyPanelPivotChange(pivot: { x: number; y: number }) {
    const activeTargetObjectId = resolveTargetObjectIdForTrack(ctx.currentTrack.value)
    if (!activeTargetObjectId) return
    commitTrackPivotChange(activeTargetObjectId, pivot)
}

function onPropertyPanelPivotReset() {
    const activeTrack = ctx.currentTrack.value
    const activeTargetObjectId = resolveTargetObjectIdForTrack(activeTrack)
    if (!activeTrack || !activeTargetObjectId) return

    ctx.clearPivot()
    applyTimeToCanvas(ctx.playheadPosition.value)
}

/**
 * After drag/scale/rotate ends on canvas, read latest object state from isolated store,
 * compute delta against base pose, and write to keyframe at current playhead position.
 */
function onSetupChange(change: SetupChangePayload) {
    if (change.type === 'origin') {
        // v26: Pivot handle on main canvas is now read-only gizmo, should no longer trigger origin events.
        // If received (legacy compatibility), uniformly route to commitTrackPivotChange.
        commitTrackPivotChange(change.objectId, change.pivot)
        return
    }

    // Read actual dragged object ID from isolated store, higher priority than currentTargetObjectId
    const store = (canvasRef.value?.previewStore as WorkbenchPreviewStore | null)
    const draggedObjectId = change.objectId || store?.selectedObjectId || currentTargetObjectId
    if (!draggedObjectId) return

    // Normalize root object ID: unify comparison semantics for TARGET_SELF / sceneObjectId / sceneObject.id
    const rootId = getRootPreviewObjectId()
    const isRootDrag = draggedObjectId === rootId ||
        (rootId === null && draggedObjectId === currentTargetObjectId)

    // Auto-Key: if no matching transform track exists, automatically create/select one
    const currentResolvedTarget = ctx.currentTrack.value
        ? resolveTargetObjectIdForTrack(ctx.currentTrack.value)
        : null
    const needsTrackSwitch = !ctx.currentTrack.value ||
        (currentResolvedTarget !== draggedObjectId && !(isRootDrag && currentResolvedTarget === rootId))

    if (needsTrackSwitch) {
        const savedPlayhead = ctx.playheadPosition.value

        // Find matching track: normalize equivalence between TARGET_SELF and root object ID
        const existingTransformTrack = animationDef.tracks.find(t => {
            if (t.trackType !== 'transform') return false
            // Track TARGET_SELF is equivalent to root object ID
            if (t.targetObjectId === TARGET_SELF || !t.targetObjectId) {
                return isRootDrag
            }
            return t.targetObjectId === draggedObjectId
        })

        if (!existingTransformTrack) {
            // Use TARGET_SELF only when dragging root object, otherwise use specific ID
            const trackTargetId = isRootDrag ? TARGET_SELF : draggedObjectId
            const track = buildDefaultTrack('transform', trackTargetId)
            const idx = ctx.addTrack(track)
            ctx.selectTrackOnly(idx)
        } else {
            // Found matching transform track but unselected, auto-select (without resetting playhead)
            const matchIdx = animationDef.tracks.indexOf(existingTransformTrack)
            if (matchIdx >= 0) ctx.selectTrackOnly(matchIdx)
        }

        // Synchronously refresh target object ID and base transform (do not wait for async watcher)
        currentTargetObjectId = draggedObjectId
        const newContainer = resolveTargetContainerForTrack(ctx.currentTrackAny.value)
        targetContainer.value = newContainer
        captureBaseTransform(newContainer)
        warmPreviewBaseStateCache()
        syncRuntimeTrackDuration()

        // Restore playhead to user actual operation position
        ctx.playheadPosition.value = savedPlayhead
    }
    const obj = store?.getObject(draggedObjectId)
    if (!obj) return

    // Calculate delta (keyframes store offset relative to base pose)
    const deltaX = obj.x - baseObjectPosition.value.x
    const deltaY = obj.y - baseObjectPosition.value.y
    const deltaScaleX = obj.scaleX / baseObjectScale.value.x
    const deltaScaleY = obj.scaleY / baseObjectScale.value.y
    const deltaRotation = obj.rotation - baseObjectRotation.value

    const result = ctx.commitTransformAtPlayhead({
        x: deltaX,
        y: deltaY,
        scaleX: deltaScaleX,
        scaleY: deltaScaleY,
        rotation: deltaRotation,
    })

    // If playhead not on any existing keyframe, do not auto create: revert canvas to interpolated pose and notify user.
    if (result.status === 'skipped-no-keyframe-at-playhead') {
        applyTimeToCanvas(ctx.playheadPosition.value)
        toast.info('No keyframe at current playhead position, transform reverted. Please add a keyframe on timeline before editing.')
    }
}

// ===== Playhead → Canvas Sync =====

watch(() => ctx.playheadPosition.value, (time) => {
    if (!hasActiveAnimation.value) return
    if (isStandardPlaybackActive.value) return
    applyTimeToCanvas(time)
})

watch(() => ctx.selectedKeyframeIndex.value, () => {
    if (!hasActiveAnimation.value) return
    const idx = ctx.selectedKeyframeIndex.value
    const kf = idx >= 0 ? ctx.activeKeyframes.value[idx] : null
    if (kf) {
        ctx.playheadPosition.value = kf.time
    }
})

function applyTimeToCanvas(time: number) {
    if (isStandardPlaybackActive.value) return

    const container = targetContainer.value
    if (!container) return

    resetRuntimeStoreFromBase()

    if (previewMode.value !== 'current') {
        applyPreviewTracksToCanvas(time)
        syncRuntimeStoreFromRenderedContainers()
        getWorkbenchRenderer()?.updateSelectionBox()
        return
    }

    const trackType = ctx.currentTrackAny.value?.trackType

    if (trackType === 'transform' || trackType === undefined) {
        clearEffectPreviewFilters(container)
        const output = ctx.evaluateAtTime(time)
        if (!output) return
        applyOutputToContainer(container, output)
        // Sync isolated store (keep selection box aligned with container)
        syncRuntimeStoreFromRenderedContainer(currentTargetObjectId, container)
        getWorkbenchRenderer()?.updateSelectionBox()
    } else if (trackType === 'visibility') {
        clearEffectPreviewFilters(container)
        const output = ctx.evaluateVisibilityAtTime(time)
        if (!output) return
        applyVisibilityToContainer(container, output)
        syncRuntimeStoreFromRenderedContainer(currentTargetObjectId, container)
        getWorkbenchRenderer()?.updateSelectionBox()
    } else if (trackType === 'effect') {
        const track = ctx.currentEffectTrack.value
        if (track) {
            const globalDurationMs = ctx.trackDuration.value
            const trackDurationMs = getTrackDurationMs(track)
            const normalizedTrackProgress = computeTrackProgress(time * globalDurationMs, trackDurationMs, globalDurationMs, animationDef.loop === true)
            const effectDurationMs = Number.isFinite(trackDurationMs) && trackDurationMs > 0 ? trackDurationMs : globalDurationMs
            if (ctx.isPlaying.value) {
                const effectOutput = DynamicEffectManager.calculateWithProgress(track.effectParams, normalizedTrackProgress, effectDurationMs)
                applyEffectDeltaToContainer(container, effectOutput)
                syncRuntimeStoreFromRenderedContainer(currentTargetObjectId, container)
            } else {
                clearEffectPreviewFilters(container)
                syncRuntimeStoreFromRenderedContainer(currentTargetObjectId, container)
            }
            getWorkbenchRenderer()?.updateSelectionBox()
        }
    } else if (trackType === 'frame_sequence') {
        clearEffectPreviewFilters(container)
        if (ctx.isPlaying.value) applyFrameSequenceToContainer(container, time)
        syncRuntimeStoreFromRenderedContainer(currentTargetObjectId, container)
        getWorkbenchRenderer()?.updateSelectionBox()
    }
}

/**
 * Target keys involved in previous preview round, used when preview scope narrows to revert
 * targets no longer covered back to base state, avoiding leftover transforms.
 */
const previouslyAffectedKeys = new Set<string>()

function restoreAllPreviewTargetsToBase() {
    if (!rootContainer.value) return

    const keys = new Set<string>([
        ...objectBaseStateCache.keys(),
        ...initialContainerBaseStateCache.keys(),
        ...baseStateCache.keys(),
        ...previouslyAffectedKeys,
        getContainerBaseKey(currentTargetObjectId),
    ])

    for (const key of keys) {
        const objectId = resolveObjectIdForPreviewKey(key)
        const container = resolveContainerForKey(key)
        const state = initialContainerBaseStateCache.get(key) ?? baseStateCache.get(key)
        restoreStoreObjectToBase(resolveObjectIdForPreviewKey(key))
        if (!state || !container) continue
        resetContainerToBaseStateWithKey(container, state, key)
        void objectId
    }

    previouslyAffectedKeys.clear()
}

function applyPreviewTracksToCanvas(time: number) {
    // Phase 2b: Actual composition logic migrated to useAnimationWorkbenchRenderer.ts.
    // This function only bundles local state / parsers / callbacks into deps and calls imperative helper.
    runPreviewTracksOnCanvas({
        rootContainer: rootContainer.value,
        activePreviewTrackIndexes: activePreviewTrackIndexes.value,
        animationDef,
        globalDurationMs: ctx.trackDuration.value,
        includeTemporalTracks: ctx.isPlaying.value,

        previouslyAffectedKeys,
        baseStateCache,
        initialContainerBaseStateCache,
        objectBaseStateCache,

        resolveTargetObjectIdForTrack,
        resolveTargetContainerForTrack,
        resolveContainerForKey,
        resolveObjectIdForPreviewKey,
        getBaseStateForTrack,
        getSceneObjectById,

        resetContainerToBaseStateWithKey,
        applyFrameSequenceTrackToContainer,
        applyEffectFiltersForKey,
        getTrackDurationMs,
    }, time)
}

/**
 * Calculate normalized progress (0..1) for single track per AnimationPlayer rules.
 * - Track duration >= animation duration: use global progress
 * - Track duration < animation duration and loop: cycle per track duration
 * - Track duration < animation duration and no loop: clamp at 1 after last frame
 */
function computeTrackProgress(
    elapsedMs: number,
    trackDurationMs: number,
    globalDurationMs: number,
    loop: boolean,
): number {
    if (trackDurationMs <= 0) return 0
    if (globalDurationMs <= 0) return 0
    if (!Number.isFinite(trackDurationMs)) return Math.min(1, Math.max(0, elapsedMs / globalDurationMs))
    if (trackDurationMs >= globalDurationMs) {
        return Math.min(1, Math.max(0, elapsedMs / globalDurationMs))
    }
    if (loop) {
        return (elapsedMs % trackDurationMs) / trackDurationMs
    }
    return Math.min(1, elapsedMs / trackDurationMs)
}

/** Find corresponding container by target key (cross-target or self) */
function resolveContainerForKey(key: string): PIXI.Container | null {
    if (key !== TARGET_SELF && allPartContainers.value?.has(key)) {
        return allPartContainers.value.get(key) ?? null
    }
    return rootContainer.value ?? null
}

function resetContainerToBaseStateWithKey(container: PIXI.Container, state: ContainerBaseState, key: string) {
    clearEffectPreviewFiltersForKey(container, key)
    // Phase 1b: Geometries (position/scale/rotation/alpha/pivot) restored uniformly by WorkbenchBaseTransformSnapshot,
    // pivot must be restored — otherwise track.pivot leaks on switching animations, causing offset.
    applyContainerBaseTransform(container, state)
    restoreAnimatedSpriteBaseFrame(container, state.objectId)
}

/**
 * Install/update/clean effect filters (glow / motion blur / petrify colorMatrix) by target key.
 * Merge filter fields from all effect deltas in current round.
 */
function applyEffectFiltersForKey(
    container: PIXI.Container,
    key: string,
    deltas: {
        glowColor?: string; glowIntensity?: number; glowSize?: number
        motionBlurVelocity?: [number, number]; motionBlurKernelSize?: number
        petrifyProgress?: number; petrifyGrayScale?: boolean
    }[],
) {
    const bundle = getOrCreateFilterBundle(key)

    // Merge fields (latter overwrites former, consistent with single-track behavior)
    let glowColor: string | undefined
    let glowIntensity: number | undefined
    let glowSize: number | undefined
    let motionBlurVelocity: [number, number] | undefined
    let motionBlurKernelSize: number | undefined
    let petrifyProgress: number | undefined
    let petrifyGrayScale: boolean | undefined

    for (const d of deltas) {
        if (d.glowColor !== undefined) glowColor = d.glowColor
        if (d.glowIntensity !== undefined) glowIntensity = d.glowIntensity
        if (d.glowSize !== undefined) glowSize = d.glowSize
        if (d.motionBlurVelocity !== undefined) motionBlurVelocity = d.motionBlurVelocity
        if (d.motionBlurKernelSize !== undefined) motionBlurKernelSize = d.motionBlurKernelSize
        if (d.petrifyProgress !== undefined) petrifyProgress = d.petrifyProgress
        if (d.petrifyGrayScale !== undefined) petrifyGrayScale = d.petrifyGrayScale
    }

    // Glow
    if (glowColor !== undefined || glowIntensity !== undefined || glowSize !== undefined) {
        if (!bundle.glow) {
            bundle.glow = new GlowFilter()
            container.filters = [...(container.filters ?? []), bundle.glow]
        }
        if (glowColor !== undefined) bundle.glow.color = parseInt(glowColor.replace('#', ''), 16)
        if (glowIntensity !== undefined) bundle.glow.outerStrength = glowIntensity
        if (glowSize !== undefined) (bundle.glow as GlowFilter & { distance?: number }).distance = glowSize
    } else if (bundle.glow) {
        container.filters = (container.filters ?? []).filter(f => f !== bundle.glow)
        bundle.glow = null
    }

    // Motion blur
    if (motionBlurVelocity !== undefined) {
        if (!bundle.motionBlur) {
            bundle.motionBlur = new MotionBlurFilter()
            container.filters = [...(container.filters ?? []), bundle.motionBlur]
        }
        bundle.motionBlur.velocity = new PIXI.Point(...motionBlurVelocity)
        if (motionBlurKernelSize !== undefined) bundle.motionBlur.kernelSize = motionBlurKernelSize
    } else if (bundle.motionBlur) {
        container.filters = (container.filters ?? []).filter(f => f !== bundle.motionBlur)
        bundle.motionBlur = null
    }

    // Petrify (grayscale)
    if (petrifyProgress !== undefined && petrifyProgress > 0) {
        if (!bundle.colorMatrix) {
            bundle.colorMatrix = new PIXI.ColorMatrixFilter()
            container.filters = [...(container.filters ?? []), bundle.colorMatrix]
        }
        if (petrifyGrayScale) {
            bundle.colorMatrix.reset()
            bundle.colorMatrix.saturate(-petrifyProgress, false)
        }
    } else if (bundle.colorMatrix) {
        container.filters = (container.filters ?? []).filter(f => f !== bundle.colorMatrix)
        bundle.colorMatrix = null
    }
}

function getTrackDurationMs(track: AnimationTrack): number {
    if (track.trackType === 'frame_sequence') {
        const duration = getFrameSequencePreviewDurationMs(track, resolveTargetContainerForTrack(track))
        if (duration) return duration
    }
    const duration = AnimationTrackEvaluator.getTrackDuration(track)
    if (duration === AUTO_DURATION_MARKER) return 1000
    return duration
}

function applyVisibilityToContainer(container: PIXI.Container, output: VisibilityTrackOutput) {
    container.alpha = baseAlpha.value * output.alpha
}

/**
 * v24: Application entry for single-track effect preview (previewMode === 'current').
 * Internally uses shared ComposedTransform + per-target filter cache, consistent with multi-track.
 */
function applyEffectDeltaToContainer(container: PIXI.Container, delta: {
    deltaX?: number; deltaY?: number
    deltaScaleX?: number; deltaScaleY?: number
    deltaRotation?: number; deltaAlpha?: number
    glowColor?: string; glowIntensity?: number; glowSize?: number
    motionBlurVelocity?: [number, number]; motionBlurKernelSize?: number
    petrifyProgress?: number; petrifyGrayScale?: boolean
    shatterProgress?: number; shatterAlpha?: number
}) {
    const key = currentTargetObjectId ?? TARGET_SELF
    const base: ContainerBaseState = {
        objectId: currentTargetObjectId,
        position: basePosition.value,
        scale: baseScale.value,
        pivot: targetContainer.value
            ? { x: targetContainer.value.pivot.x, y: targetContainer.value.pivot.y }
            : { x: 0, y: 0 },
        rotation: baseRotation.value,
        alpha: baseAlpha.value,
        bounds: baseBounds.value,
    }

    // 1) Transform + alpha: shared composition (equivalent to base + effect delta)
    const composed = createEmptyComposedTransform()
    accumulateEffectDelta(composed, delta)
    if (delta.shatterAlpha !== undefined) {
        composed.alphaProduct *= Math.max(0, delta.shatterAlpha)
    } else if (delta.shatterProgress !== undefined) {
        composed.alphaProduct *= Math.max(0, 1 - delta.shatterProgress)
    }
    applyComposedTransformToContainer(container, {
        x: base.position.x,
        y: base.position.y,
        scaleX: base.scale.x,
        scaleY: base.scale.y,
        rotation: base.rotation,
        alpha: base.alpha,
    }, composed)

    // 2) Filters: reuse per-target cache
    applyEffectFiltersForKey(container, key, [delta])
}

function applyFrameSequenceToContainer(container: PIXI.Container, time: number) {
    const track = ctx.currentFrameSequenceTrack.value
    if (!track) return
    applyFrameSequenceTrackToContainer(track, container, time)
}

function applyFrameSequenceTrackToContainer(track: AnimationTrack & { trackType: 'frame_sequence' }, container: PIXI.Container, time: number) {
    const sprite = findAnimatedSprite(container)
    if (!sprite || sprite.totalFrames <= 1) return
    // time is normalized progress (0-1), map directly to frame index
    // No need to derive via getTrackDurationMs() + fps — that path degenerates to
    // fixed 1000ms when container not ready, causing frame index to run too fast
    const frameIndex = Math.min(sprite.totalFrames - 1, Math.floor(time * sprite.totalFrames))
    sprite.gotoAndStop(frameIndex)
    void track // track.fps already implicit in getTrackDurationMs for computeTrackProgress
}

function applyOutputToContainer(container: PIXI.Container, output: TransformTrackOutput) {
    applyOutputToContainerForObject(currentTargetObjectId, container, output)
}

function applyOutputToContainerForObject(objectId: string | null, container: PIXI.Container, output: TransformTrackOutput) {
    const key = getContainerBaseKey(objectId)
    const cachedBase = initialContainerBaseStateCache.get(key) ?? baseStateCache.get(key)
    applyOutputToContainerWithBase(container, output, {
        objectId,
        position: cachedBase?.position ?? basePosition.value,
        scale: cachedBase?.scale ?? baseScale.value,
        pivot: cachedBase?.pivot ?? { x: container.pivot.x, y: container.pivot.y },
        rotation: cachedBase?.rotation ?? baseRotation.value,
        alpha: cachedBase?.alpha ?? baseAlpha.value,
        bounds: cachedBase?.bounds ?? baseBounds.value,
    })
}

function applyOutputToContainerWithBase(container: PIXI.Container, output: TransformTrackOutput, base: ContainerBaseState) {
    const flipFactor = output.flipX ? -1 : 1
    const sx = (output.scaleX ?? 1) * flipFactor
    const sy = output.scaleY ?? 1
    const rot = output.rotation ?? 0

    let basePositionX = base.position.x
    let basePositionY = base.position.y

    const pivot = output.pivot
    if (pivot) {
        const dx = pivot.x - base.pivot.x
        const dy = pivot.y - base.pivot.y
        const baseFlipSign = base.scale.x < 0 ? -1 : 1
        basePositionX += baseFlipSign * dx
        basePositionY += dy
        container.pivot.set(pivot.x, pivot.y)
    } else {
        container.pivot.set(base.pivot.x, base.pivot.y)
    }

    container.position.set(
        basePositionX + (output.x ?? 0),
        basePositionY + (output.y ?? 0),
    )
    container.scale.set(
        base.scale.x * sx,
        base.scale.y * sy,
    )
    container.rotation = base.rotation + rot
}

function syncRuntimeStoreFromRenderedContainers(): void {
    const store = (canvasRef.value?.previewStore as WorkbenchPreviewStore | null)
    if (!store) return
    for (const obj of store.objects) {
        const key = getContainerBaseKey(obj.id)
        const container = resolveContainerForKey(key)
        if (container) syncRuntimeStoreFromRenderedContainer(obj.id, container)
    }
}

function syncRuntimeStoreFromRenderedContainer(objectId: string | null, container: PIXI.Container): void {
    if (!objectId || container.destroyed) return
    const store = (canvasRef.value?.previewStore as WorkbenchPreviewStore | null)
    if (!store) return

    const baseObj = getObjectBaseState(objectId)
    if (!baseObj) return

    const flipX = container.scale.x < 0

    // Derive transformOrigin to write back to store from container.pivot:
    //   pivotBase = baseContainer.pivot - baseObj.transformOrigin (object geometric center)
    //   newOrigin = container.pivot − pivotBase
    // Without track.pivot, container.pivot remains baseContainer.pivot, newOrigin falls back to baseObj.transformOrigin,
    // write is no-op; when track.pivot exists (or user adjusted pivot in PivotEditorPanel),
    // newOrigin updates synchronously with container.pivot — so renderObjects triggered by deep watch
    // reapplies store state via applyObjectState, and container.pivot lands stably on track.pivot,
    // and main canvas read-only pivot handle will draw at correct position on next updateSelectionBox.
    const containerKey = getContainerBaseKey(objectId)
    const baseContainer = initialContainerBaseStateCache.get(containerKey) ?? baseStateCache.get(containerKey)
    const baseOriginX = baseObj.transformOriginX ?? 0
    const baseOriginY = baseObj.transformOriginY ?? 0
    let newOriginX = baseOriginX
    let newOriginY = baseOriginY
    if (baseContainer) {
        const pivotBaseX = baseContainer.pivot.x - baseOriginX
        const pivotBaseY = baseContainer.pivot.y - baseOriginY
        newOriginX = container.pivot.x - pivotBaseX
        newOriginY = container.pivot.y - pivotBaseY
    }

    // Recalculate store.x/y: renderObjects will replay container.position = store.x + flipSign*newOrigin,
    // so newOrigin must be used to ensure the feedback loop does not drift.
    const cx = flipX ? -newOriginX : newOriginX

    store.updateObject(objectId, {
        x: container.position.x - cx,
        y: container.position.y - newOriginY,
        scaleX: Math.abs(container.scale.x),
        scaleY: container.scale.y,
        rotation: container.rotation,
        alpha: container.alpha,
        flipX,
        transformOriginX: newOriginX,
        transformOriginY: newOriginY,
    })
}

function syncTrackPivotToRuntimeTarget(objectId: string | null): void {
    if (!objectId) return
    const store = (canvasRef.value?.previewStore as WorkbenchPreviewStore | null)
    const renderer = getWorkbenchRenderer()
    if (!store || !renderer) return

    const container = resolveContainerForKey(getContainerBaseKey(objectId))
    if (!container || container.destroyed) return

    const track = ctx.currentTrack.value
    const trackTargetObjectId = resolveTargetObjectIdForTrack(track)
    if (track?.pivot && trackTargetObjectId === objectId) {
        const output = ctx.evaluateAtTime(ctx.playheadPosition.value)
        if (output) {
            applyOutputToContainerForObject(objectId, container, { ...output, pivot: track.pivot })
        }
    }

    syncRuntimeStoreFromRenderedContainer(objectId, container)
    renderer.syncObjectFromStore(objectId)
    store.selectObject(objectId)
    workbenchStoreRevision.value++
    renderer.updateSelectionBox()
}

function buildStandardPlaybackDefinition(): AnimationDefinition | null {
    const tracks = activePreviewTrackIndexes.value
        .map(index => animationDef.tracks[index])
        .filter((track): track is AnimationTrack => !!track)

    if (tracks.length === 0) return null

    return {
        ...JSON.parse(JSON.stringify(animationDef)) as AnimationDefinition,
        id: WORKBENCH_STANDARD_PREVIEW_NAME,
        name: WORKBENCH_STANDARD_PREVIEW_NAME,
        tracks: JSON.parse(JSON.stringify(tracks)) as AnimationTrack[],
    }
}

function getStandardPlaybackRootObjectId(): string | null {
    const explicitRootId = getRootPreviewObjectId()
    if (explicitRootId) return explicitRootId

    const store = (canvasRef.value?.previewStore as WorkbenchPreviewStore | null)
    const rootObj = store?.objects.find(obj => !obj.parentId)
    return rootObj?.id ?? currentTargetObjectId
}

function getStandardPlaybackRootPlayer(): WorkbenchAnimationPlayer | null {
    const sceneGraph = getWorkbenchSceneGraph()
    if (!sceneGraph) return null

    const rootId = getStandardPlaybackRootObjectId()
    if (!rootId) return null

    const player = sceneGraph.getGenericAnimationPlayer(rootId)
    if (!player) return null

    standardPlaybackRootObjectId = rootId
    return player
}

function cacheStandardPlaybackBaseTransforms(): void {
    const sceneGraph = getWorkbenchSceneGraph()
    if (!sceneGraph) return
    for (const player of sceneGraph.getGenericAnimationPlayers().values()) {
        player.cacheBaseTransform()
    }
}

function stopStandardWorkbenchPlayback(restoreEditFrame: boolean): void {
    if (!isStandardPlaybackActive.value && !standardPlaybackRootObjectId) return

    const sceneGraph = getWorkbenchSceneGraph()
    const rootPlayer = standardPlaybackRootObjectId
        ? sceneGraph?.getGenericAnimationPlayer(standardPlaybackRootObjectId)
        : null

    rootPlayer?.stopAnimation(WORKBENCH_STANDARD_PREVIEW_NAME)
    isStandardPlaybackActive.value = false
    standardPlaybackRootObjectId = null

    restoreAllPreviewTargetsToBase()
    resetRuntimeStoreFromBase()

    if (restoreEditFrame && hasActiveAnimation.value) {
        applyTimeToCanvas(ctx.playheadPosition.value)
    }
}

async function startStandardWorkbenchPlayback(startVersion: number): Promise<boolean> {
    const renderer = getWorkbenchRenderer()
    const definition = buildStandardPlaybackDefinition()
    const player = getStandardPlaybackRootPlayer()

    if (!renderer || !definition || !player) {
        isStandardPlaybackActive.value = false
        standardPlaybackRootObjectId = null
        return false
    }

    renderer.setAutoRenderEnabled(true)
    restoreAllPreviewTargetsToBase()
    resetRuntimeStoreFromBase()
    await prepareFrameSequencePreviewSprites(definition)
    if (startVersion !== standardPlaybackStartVersion || !ctx.isPlaying.value) {
        return false
    }
    syncRuntimeTrackDuration()
    cacheStandardPlaybackBaseTransforms()

    player.playAnimation(WORKBENCH_STANDARD_PREVIEW_NAME, definition, {
        loop: ctx.loopPlayback.value,
        reset: true,
        runtimeDuration: ctx.trackDuration.value,
    })
    isStandardPlaybackActive.value = true
    return true
}

function restartStandardWorkbenchPlayback(): void {
    stopStandardWorkbenchPlayback(false)
    const renderer = getWorkbenchRenderer()
    const startVersion = ++standardPlaybackStartVersion
    void startStandardWorkbenchPlayback(startVersion).then(started => {
        if (!started && startVersion === standardPlaybackStartVersion && ctx.isPlaying.value) {
            renderer?.setAutoRenderEnabled(false)
        }
    })
}

// ===== Playback: hide selection box =====

watch(() => ctx.isPlaying.value, (playing) => {
    const renderer = getWorkbenchRenderer()
    if (playing) {
        const startVersion = ++standardPlaybackStartVersion
        void startStandardWorkbenchPlayback(startVersion).then(started => {
            if (!started && startVersion === standardPlaybackStartVersion && ctx.isPlaying.value) {
                renderer?.setAutoRenderEnabled(false)
            }
        })
    } else {
        standardPlaybackStartVersion++
        stopStandardWorkbenchPlayback(true)
        renderer?.setAutoRenderEnabled(true)
    }
})

// ===== Keyboard Shortcuts =====

function onKeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return

    switch (e.key) {
        case ' ':
            e.preventDefault()
            ctx.togglePlay()
            break
        case 'k':
        case 'K':
            e.preventDefault()
            ctx.addKeyframeAtPlayhead()
            break
        case 'Delete':
            ctx.removeKeyframe(ctx.selectedKeyframeIndex.value)
            break
        case 'ArrowLeft':
            e.preventDefault()
            ctx.seekPrevKeyframe()
            break
        case 'ArrowRight':
            e.preventDefault()
            ctx.seekNextKeyframe()
            break
        case 'Home':
            e.preventDefault()
            ctx.seekTo(0)
            break
        case 'End':
            e.preventDefault()
            ctx.seekTo(1)
            break
        case 'Escape':
            if (trackDeleteDialog.value) {
                cancelDeleteTrack()
                break
            }
            if (showCloseConfirm.value) {
                showCloseConfirm.value = false
                break
            }
            handleClose()
            break
        case 'c':
        case 'C':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault()
                ctx.copyKeyframe()
            }
            break
        case 'v':
        case 'V':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault()
                if (ctx.canPasteKeyframeToCurrentTrack()) {
                    ctx.pasteKeyframe()
                }
            }
            break
    }
}

// ===== Save / Close =====

/**
 * Execute name validation + keyframe cleanup + emit save.
 * Returns true on save success, false on validation failure (alert shown to user).
 */
function trySave(): boolean {
    if (!hasActiveAnimation.value) return false
    const trimmedName = animationDef.name.trim()
    if (!trimmedName) {
        alert('Please enter an animation name')
        return false
    }
    if (props.existingNames && currentOriginalName.value !== undefined) {
        if (trimmedName !== currentOriginalName.value && props.existingNames.includes(trimmedName)) {
            alert(`Animation name "${trimmedName}" already exists, please use another name`)
            return false
        }
    }
    animationDef.name = trimmedName

    // Keyframe cleanup before save: sort + filter NaN/out-of-range frames
    for (const track of animationDef.tracks) {
        if (track.trackType === 'transform' || track.trackType === 'visibility') {
            const kfs = (track as { keyframes: { time: number }[] }).keyframes
            if (kfs && kfs.length > 0) {
                const validKfs = kfs.filter(kf => !isNaN(kf.time) && kf.time >= 0 && kf.time <= 1)
                validKfs.sort((a, b) => a.time - b.time)
                ;(track as { keyframes: typeof validKfs }).keyframes = validKfs
            }
        }
    }

    animationDef.updatedAt = Date.now()
    currentOriginalName.value = trimmedName
    emit('save', JSON.parse(JSON.stringify(animationDef)) as AnimationDefinition)
    markPendingProjectChange()
    return true
}

async function saveCurrentAnimationToProject(): Promise<boolean> {
    if (isSavingProject.value) return false
    if (!hasActiveAnimation.value && !hasPendingProjectChanges.value) return false

    if (hasActiveAnimation.value && !trySave()) return false

    isSavingProject.value = true
    try {
        if (props.persistChanges) {
            await props.persistChanges()
        } else {
            await projectStore.saveProject()
        }
        ctx.markSaved()
        hasPendingProjectChanges.value = false
        return true
    } catch (error) {
        console.error('[AnimationWorkbench] Failed to save project:', error)
        alert(`Failed to save project: ${error instanceof Error ? error.message : String(error)}`)
        return false
    } finally {
        isSavingProject.value = false
    }
}

async function handleSave() {
    await saveCurrentAnimationToProject()
}

function handleSaveAsPreset(): void {
    if (!hasActiveAnimation.value) return
    // Need a SceneObject Map to lookup alias/name by targetObjectId
    const sceneObjectsMap = new Map<string, SceneObject>()
    for (const obj of sceneObjectStore.objects) sceneObjectsMap.set(obj.id, obj)

    const extract = extractPresetTargetsFromAnimation(animationDef, sceneObjectsMap)
    if (extract.expectedTargets.length === 0) {
        toast.error('Current animation has no exportable tracks (all tracks point to _self or lack alias/name)')
        return
    }

    const defaultName = animationDef.name || 'Untitled Action'
    const userName = window.prompt('Please enter preset action name:', defaultName)
    const trimmedName = userName?.trim()
    if (!trimmedName) return

    const template = {
        id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: trimmedName,
        category: 'custom' as const,
        origin: 'user' as const,
        loop: animationDef.loop === true,
        ...(animationDef.duration !== undefined ? { duration: animationDef.duration } : {}),
        ...(animationDef.fillMode !== undefined ? { fillMode: animationDef.fillMode } : {}),
        expectedTargets: extract.expectedTargets,
        targetTracks: extract.targetTracks,
    }

    projectStore.addCustomPreset(template)

    if (extract.warnings.length > 0) {
        toast.info(`Saved preset action "${trimmedName}" (${extract.warnings.length} warning(s), see console)`)
        console.warn('[AnimationWorkbench] Export preset action warnings:', extract.warnings)
    } else {
        toast.success(`Saved preset action "${trimmedName}"`)
    }
}

/** Control exit confirmation dialog visibility */
const showCloseConfirm = ref(false)
const trackDeleteDialog = ref<TrackDeleteDialogState | null>(null)

function handleClose() {
    if (hasUnsavedWorkbenchChanges.value) {
        showCloseConfirm.value = true
        return
    }
    stopStandardWorkbenchPlayback(false)
    restoreAllPreviewTargetsToBase()
    ctx.dispose()
    emit('close')
}

function handleConfirmDiscard() {
    showCloseConfirm.value = false
    stopStandardWorkbenchPlayback(false)
    restoreAllPreviewTargetsToBase()
    ctx.dispose()
    emit('close')
}

async function handleSaveAndExit() {
    showCloseConfirm.value = false
    if (await saveCurrentAnimationToProject()) {
        stopStandardWorkbenchPlayback(false)
        restoreAllPreviewTargetsToBase()
        ctx.dispose()
        emit('close')
    }
}

function markPendingProjectChange(): void {
    hasPendingProjectChanges.value = true
}

// ===== Track Management =====

function buildDefaultTrack(trackType: AnimationTrackType, targetObjectId: string): AnimationTrack {
    const target = targetObjectId === TARGET_SELF ? TARGET_SELF : targetObjectId

    if (trackType === 'visibility') {
        return {
            trackType,
            targetObjectId: target,
            duration: 1000,
            easing: 'linear',
            keyframes: [
                { time: 0, alpha: 1 },
                { time: 1, alpha: 1 },
            ],
        }
    }

    if (trackType === 'effect') {
        const effectParams: EffectParams = { type: 'float', amplitude: 5, speed: 1 }
        return {
            trackType,
            targetObjectId: target,
            effectParams,
        }
    }

    if (trackType === 'frame_sequence') {
        return {
            trackType,
            targetObjectId: target,
        }
    }

    return {
        trackType: 'transform',
        targetObjectId: target,
        duration: 1000,
        easing: 'linear',
        keyframes: [
            { time: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
            { time: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        ],
    }
}

function addTrackByType(trackType: AnimationTrackType) {
    const track = buildDefaultTrack(trackType, TARGET_SELF)
    const idx = ctx.addTrack(track)
    ctx.selectTrackOnly(idx)
}

function duplicateTrack(trackIndex: number) {
    const source = animationDef.tracks[trackIndex]
    if (!source) return
    const cloned = JSON.parse(JSON.stringify(source)) as AnimationTrack
    if (cloned.displayName) cloned.displayName = `${cloned.displayName} Copy`
    const idx = ctx.addTrack(cloned)
    ctx.selectTrackOnly(idx)
}

function deleteTrack(trackIndex: number) {
    const track = animationDef.tracks[trackIndex]
    if (!track) return
    const keyframeCount = track.trackType === 'transform' || track.trackType === 'visibility' ? track.keyframes.length : 0
    const label = track.displayName?.trim() || getTrackTargetLabel(track.targetObjectId)
    trackDeleteDialog.value = {
        trackIndex,
        title: `Delete Track "${label}"`, 
        message: keyframeCount > 0
            ? `This track contains ${keyframeCount} keyframe(s); deletion cannot be undone.`
            : 'Track deletion cannot be undone.',
    }
}

function cancelDeleteTrack(): void {
    trackDeleteDialog.value = null
}

function confirmDeleteTrack(): void {
    const target = trackDeleteDialog.value
    trackDeleteDialog.value = null
    if (!target) return
    if (!animationDef.tracks[target.trackIndex]) return
    ctx.removeTrack(target.trackIndex)
}

function handleFocusTrack(trackIndex: number) {
    ctx.selectTrackOnly(trackIndex)
    locateTrackTarget(trackIndex)
}

function locateTrackTarget(trackIndex: number) {
    const track = animationDef.tracks[trackIndex]
    if (!track) return
    const targetId = resolveTargetObjectIdForTrack(track)
    const store = (canvasRef.value?.previewStore as WorkbenchPreviewStore | null)
    store?.selectObject(targetId)
    workbenchStoreRevision.value++
    getWorkbenchRenderer()?.updateSelectionBox()
}

// ===== List Mode Events =====

function handleListSelect(animationId: string) {
    // Click: validate and clean keyframes fully before switching animation
    const target = props.animations?.find(a => a.id === animationId)
    if (!target) return
    if (target.id === animationDef.id) {
        ctx.deselectAll()
        return
    }
    // If validation fails (empty/duplicate name), abort switch
    if (hasActiveAnimation.value && ctx.hasUnsavedChanges.value && !trySave()) return
    restoreAllPreviewTargetsToBase()
    // Update duplicate check baseline
    currentOriginalName.value = target.name
    hasActiveAnimation.value = true
    // Reset edit context to target animation
    ctx.resetAnimation(target)
    ctx.deselectAll()
    warmPreviewBaseStateCache()
    syncRuntimeTrackDuration()
    applyTimeToCanvas(ctx.playheadPosition.value)
}

function handleListEdit(animationId: string) {
    // Double click: equivalent to single click (already switched in select)
    void animationId
}

function handleCopyFromSelf(): void {
    emit('copy-from-self')
    markPendingProjectChange()
}

function handleAnimationsUpdate(animations: Record<string, AnimationDefinition>) {
    emit('update:animations', animations)
    markPendingProjectChange()
    if (!hasActiveAnimation.value) return

    const updatedCurrent = animations[animationDef.id]
    if (!updatedCurrent) return

    animationDef.name = updatedCurrent.name
    animationDef.loop = updatedCurrent.loop
    if (updatedCurrent.fillMode !== undefined) {
        animationDef.fillMode = updatedCurrent.fillMode
    } else {
        delete animationDef.fillMode
    }
    animationDef.updatedAt = updatedCurrent.updatedAt
    currentOriginalName.value = updatedCurrent.name
}

function handleListDelete(animationId: string) {
    const animations = props.animations ?? []
    const remaining = animations.filter(item => item.id !== animationId)
    emit('update:animations', Object.fromEntries(remaining.map(item => [item.id, item])) as Record<string, AnimationDefinition>)
    emit('animation-deleted', animationId)
    markPendingProjectChange()

    if (animationDef.id !== animationId) return
    restoreAllPreviewTargetsToBase()

    const fallback = remaining[0]
    if (fallback) {
        currentOriginalName.value = fallback.name
        hasActiveAnimation.value = true
        ctx.resetAnimation(fallback)
        ctx.deselectAll()
        warmPreviewBaseStateCache()
        syncRuntimeTrackDuration()
        applyTimeToCanvas(ctx.playheadPosition.value)
    } else {
        hasActiveAnimation.value = false
        currentOriginalName.value = ''
        ctx.resetAnimation(createPlaceholderAnimation())
        warmPreviewBaseStateCache()
    }
}

function handleListCreate(animation: AnimationDefinition) {
    restoreAllPreviewTargetsToBase()
    currentOriginalName.value = animation.name
    hasActiveAnimation.value = true
    ctx.resetAnimation(animation)
    ctx.deselectAll()
    warmPreviewBaseStateCache()
    syncRuntimeTrackDuration()
    applyTimeToCanvas(ctx.playheadPosition.value)
    emit('animation-created', animation)
    markPendingProjectChange()
}

function handlePresetApplied(animation: AnimationDefinition) {
    restoreAllPreviewTargetsToBase()
    currentOriginalName.value = animation.name
    hasActiveAnimation.value = true
    ctx.resetAnimation(animation)
    ctx.deselectAll()
    warmPreviewBaseStateCache()
    syncRuntimeTrackDuration()
    applyTimeToCanvas(ctx.playheadPosition.value)
    emit('preset-applied')
    markPendingProjectChange()
}

// ===== Cleanup =====

onMounted(() => {
    document.addEventListener('pointerdown', closeToolbarPopovers)
})

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', closeToolbarPopovers)
    stopStandardWorkbenchPlayback(false)
    restoreAllPreviewTargetsToBase()
    ctx.dispose()
})
</script>

<style scoped>
.animation-workbench-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1100;
  background: #f5f6f8;
  display: flex;
  flex-direction: column;
  outline: none;
}

/* Toolbar */
.workbench-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 12px;
  background: #ffffff;
  border-bottom: 1px solid #e0e3e8;
  flex-shrink: 0;
}

.toolbar-left,
.toolbar-center,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: #e0e3e8;
}

.anim-name-input {
  color: #222;
  font-size: 13px;
  font-weight: 500;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 6px;
  outline: none;
  max-width: 200px;
  transition: border-color 0.2s;
}

.anim-name-input:hover {
  border-color: #d0d3d9;
}

.anim-name-input:focus {
  border-color: #3b82f6;
  background: #fff;
}

.btn-toolbar {
  background: #f0f1f3;
  border: 1px solid #d0d3d9;
  color: #444;
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}

.btn-toolbar:hover {
  background: #e4e6ea;
}

.btn-toolbar.active {
  color: #2563eb;
  background: #eff6ff;
  border-color: #93c5fd;
}

.btn-toolbar:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.object-tree-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  width: 190px;
  padding: 4px 8px 4px 10px;
}

.object-tree-trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.object-tree-trigger-arrow {
  flex-shrink: 0;
  margin-left: 8px;
  color: #6b7280;
  font-size: 10px;
}

.object-list-popover {
  left: 0;
  right: auto;
}

.pass-through-set-btn {
  color: #2563eb;
}

.icon-toolbar-btn {
  position: relative;
  width: 34px;
  height: 30px;
  padding: 0;
  font-size: 15px;
}

.icon-count {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  background: #2563eb;
  border-radius: 999px;
}

.toolbar-popover {
  position: relative;
  display: flex;
  align-items: center;
}

.workbench-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 300px;
  max-width: min(360px, calc(100vw - 24px));
  overflow: hidden;
  background: #fff;
  border: 1px solid #e0e3e8;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  z-index: 40;
}

.popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
}

.popover-content {
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
}

.popover-empty {
  padding: 18px 12px;
  color: #9ca3af;
  font-size: 12px;
  text-align: center;
}

.object-list-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 30px;
  padding: 5px 8px;
  color: #374151;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
}

.object-list-row:hover {
  background: #f3f4f6;
}

.object-list-row.selected {
  color: #1d4ed8;
  font-weight: 600;
  background: #eff6ff;
}

.tree-toggle,
.tree-spacer {
  width: 16px;
  flex-shrink: 0;
  color: #6b7280;
  font-size: 10px;
  text-align: center;
}

.tree-toggle:hover {
  color: #2563eb;
}

.object-icon {
  width: 18px;
  flex-shrink: 0;
  font-size: 14px;
  text-align: center;
}

.object-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.object-badge {
  flex-shrink: 0;
  padding: 1px 5px;
  color: #2563eb;
  font-size: 10px;
  font-weight: 500;
  background: #dbeafe;
  border-radius: 4px;
}

.pass-through-actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}

.mini-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: #4b5563;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.mini-icon-btn:hover {
  background: #e5e7eb;
}

.mini-icon-btn.muted {
  opacity: 0.5;
}

.mini-icon-btn.danger:hover {
  color: #dc2626;
  background: #fee2e2;
}

.empty-toolbar-hint {
  font-size: 12px;
  color: #888;
}

/* Body */
.workbench-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* Left panel (list mode) */
.left-panel {
  background: #f9fafb;
  border-right: 1px solid #e0e3e8;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

.left-panel-header {
  justify-content: space-between;
}

.resizer.left-resizer {
  width: 4px;
  background: transparent;
  cursor: col-resize;
  flex-shrink: 0;
  position: relative;
  transition: background 0.2s;
}

.resizer.left-resizer:hover {
  background: #3b82f6;
}

.expand-left-btn {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: #fff;
  border: 1px solid #d0d3d9;
  border-radius: 4px;
  width: 24px;
  height: 48px;
  cursor: pointer;
  font-size: 12px;
  color: #888;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}

.expand-left-btn:hover {
  background: #f0f1f3;
  color: #444;
}

.canvas-area {
  flex: 1;
  position: relative;
  overflow: hidden;
}

/* Right panel resize / collapse */
.resizer.right-resizer {
  width: 4px;
  background: transparent;
  cursor: col-resize;
  flex-shrink: 0;
  position: relative;
  transition: background 0.2s;
}

.resizer.right-resizer:hover {
  background: #3b82f6;
}

.resizer.right-resizer::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  left: -2px;
}

.expand-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: #fff;
  border: 1px solid #d0d3d9;
  border-radius: 4px;
  width: 24px;
  height: 48px;
  cursor: pointer;
  font-size: 12px;
  color: #888;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}

.expand-btn:hover {
  background: #f0f1f3;
  color: #444;
}

.right-panel {
  background: #ffffff;
  border-left: 1px solid #e0e3e8;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

.panel-empty-state,
.timeline-empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a94a6;
  font-size: 12px;
  padding: 20px;
  text-align: center;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid #e0e3e8;
  flex-shrink: 0;
}

.panel-header h3 {
  font-size: 12px;
  font-weight: 600;
  color: #555;
  margin: 0;
}

.collapse-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: #888;
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 3px;
}

.collapse-btn:hover {
  background: #f0f1f3;
  color: #444;
}

/* Save button (in toolbar) */
.btn-save {
  background: #2563eb;
  border: 1px solid #3b82f6;
  color: #fff;
  border-radius: 4px;
  padding: 4px 14px;
  cursor: pointer;
  font-size: 12px;
}

.btn-save:hover {
  background: #1d4ed8;
}

/* Timeline section: collapse / resize */
.timeline-section {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
  border-top: 1px solid #e0e3e8;
  overflow: hidden;
}

.timeline-empty-state {
  height: 44px;
  border-top: 1px solid #e0e3e8;
  background: #fff;
}



.timeline-resizer {
  height: 4px;
  background: transparent;
  cursor: row-resize;
  flex-shrink: 0;
  transition: background 0.2s;
}

.timeline-resizer:hover {
  background: #3b82f6;
}

.timeline-collapsed-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 32px;
  background: #fff;
  color: #888;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.timeline-collapsed-bar:hover {
  background: #f0f1f3;
}

.expand-timeline-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: #888;
  font-size: 10px;
}

/* ===== Exit Confirmation Dialog ===== */
.close-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.close-confirm-dialog {
  background: #fff;
  border-radius: 8px;
  padding: 24px 28px;
  min-width: 280px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.close-confirm-msg {
  margin: 0;
  font-size: 14px;
  color: #333;
  text-align: center;
}

.close-confirm-title {
  margin: 0 0 -8px 0;
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  text-align: center;
}

.close-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.close-confirm-actions button {
  padding: 6px 16px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  transition: opacity 0.15s;
}

.btn-cancel-close {
  background: #f0f1f3;
  color: #555;
}

.btn-discard {
  background: #ff4d4f;
  color: #fff;
}

.btn-save-exit {
  background: #1677ff;
  color: #fff;
}

.close-confirm-actions button:hover {
  opacity: 0.85;
}
</style>
