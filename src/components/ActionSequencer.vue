<template>
  <div 
    class="action-sequencer" 
    :class="{ collapsed: isCollapsed }"
    :style="containerStyle"
  >
    <!-- Top Resizer Handle -->
    <div 
      class="resizer-handle"
      @mousedown="startResize"
    >
      <div class="resizer-grip" />
    </div>

    <!-- Top Toolbar -->
    <div
      v-show="!isCollapsed"
      class="sequencer-toolbar"
    >
      <div class="toolbar-left">
        <!-- Filter -->
        <label class="filter-label">Filter:</label>
        <div
          ref="filterWrapperRef"
          class="filter-wrapper"
        >
          <select
            v-model="filterMode"
            class="filter-select"
            @change="handleFilterChange"
          >
            <option value="active">
              👁️ Active only
            </option>
            <option value="all">
              📦 Show all
            </option>
            <option value="selected">
              ✓ Selected only
            </option>
            <option value="custom">
              ⚙️ Custom...
            </option>
          </select>
        </div>
        <!-- Collapse composites button -->
        <button
          class="toolbar-btn"
          title="Collapse all composite objects"
          @click="collapseAllTracks"
        >
          📂 Collapse composites
        </button>
        <button
          class="toolbar-btn"
          :class="{ active: showActionOrder }"
          title="Display and adjust action execution order within same slot"
          @click="showActionOrder = !showActionOrder"
        >
          Action Order
        </button>
        <div
          v-if="showActionOrder && currentSlotOrderActionCount > 1"
          class="order-controls"
        >
          <span
            v-if="selectedActionOrderInfo"
            class="order-label"
          >
            Order {{ selectedActionOrderInfo.index + 1 }}/{{ selectedActionOrderInfo.total }}
          </span>
          <button
            class="order-btn"
            title="Move Earlier"
            :disabled="!selectedActionOrderInfo || selectedActionOrderInfo.index === 0"
            @click="handleMoveSelectedActionOrder(-1)"
          >
            ↑
          </button>
          <button
            class="order-btn"
            title="Move Later"
            :disabled="!selectedActionOrderInfo || selectedActionOrderInfo.index === selectedActionOrderInfo.total - 1"
            @click="handleMoveSelectedActionOrder(1)"
          >
            ↓
          </button>
          <button
            class="order-btn order-default-btn"
            title="Clear custom execution order for current slot and restore system default order"
            @click="handleResetCurrentSlotActionOrder"
          >
            Reset Default
          </button>
        </div>
      </div>

      <div class="toolbar-spacer" />

      <div class="toolbar-right">
        <!-- Zoom controls -->
        <span class="zoom-label">🔍</span>
        <button
          class="zoom-btn"
          :disabled="zoomLevel <= 0.5"
          @click="handleZoomOut"
        >
          -
        </button>
        <input 
          v-model.number="zoomLevel" 
          type="range" 
          class="zoom-slider" 
          min="0.5" 
          max="2" 
          step="0.1"
        >
        <button
          class="zoom-btn"
          :disabled="zoomLevel >= 2"
          @click="handleZoomIn"
        >
          +
        </button>
        <span class="zoom-value">{{ Math.round(zoomLevel * 100) }}%</span>
      </div>

      <!-- Collapse button - far right -->
      <button 
        class="collapse-btn" 
        :title="isCollapsed ? 'Expand' : 'Collapse'"
        @click="toggleCollapse"
      >
        ▼
      </button>
    </div>

    <!-- Collapsed header bar -->
    <div
      v-show="isCollapsed"
      class="collapsed-header"
      @click="toggleCollapse"
    >
      <span class="collapsed-title">🎬 Action Sequencer</span>
      <span class="collapsed-info">{{ actions.length }} actions</span>
      <div class="collapsed-spacer" />
      <button class="collapse-btn expand">
        ▲
      </button>
    </div>

    <!-- Main content area - Unified scroll container -->
    <div
      v-show="!isCollapsed"
      ref="scrollContainer"
      class="sequencer-content"
      @scroll="handleContainerScroll"
    >
      <!-- Subtitle track row -->
      <div class="track-row subtitle-row">
        <div class="track-header subtitle-header">
          <span class="header-icon">🗣️</span>
          <span class="header-label">Reference Script</span>
        </div>
        <div class="track-content">
          <div class="subtitle-track">
            <div 
              v-for="slot in slots" 
              :key="slot.index"
              class="slot-card"
              :class="{ 
                active: currentSlotIndex === slot.index,
                merged: slot.isMerged,
                preroll: slot.type === 'preroll',
                postroll: slot.type === 'postroll'
              }"
              :style="getSlotStyle(slot)"
              @click="handleSelectSlot(slot.index)"
            >
              <div class="slot-index">
                {{ getSlotIndexLabel(slot) }}
              </div>
              <div class="slot-text">
                {{ getSlotDisplayText(slot) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Object action track row -->
      <div 
        v-for="track in sortedFilteredTracks" 
        v-show="isTrackVisible(track)"
        :key="track.targetId"
        class="track-row"
        :class="{ selected: selectedObjectId === track.targetId, 'child-track': !!track.parentId }"
      >
        <div 
          class="track-header"
          :class="{ selected: selectedObjectId === track.targetId }"
          :style="{ paddingLeft: (getTrackDepth(track) * 16 + 8) + 'px' }"
          @click="handleSelectTrack(track)"
          @contextmenu.prevent="handleTrackHeaderContextMenu($event, track)"
        >
          <button
            v-if="hasChildTracks(track.targetId)"
            class="track-collapse-btn"
            @click.stop="toggleTrackCollapse(track.targetId)"
          >
            {{ collapsedComposites.has(track.targetId) ? '▶' : '▼' }}
          </button>
          <span v-else-if="track.parentId" class="track-indent">└</span>
          <span class="header-icon">{{ getTrackIcon(track.type) }}</span>
          <span class="header-label">{{ track.targetName }}</span>
        </div>
        <div class="track-content">
          <div class="action-track">
            <!-- Grid background -->
            <div class="track-grid">
              <div 
                v-for="slot in slots" 
                :key="slot.index"
                class="grid-cell"
                :class="{ active: currentSlotIndex === slot.index }"
                :style="getSlotStyle(slot)"
              />
            </div>

            <!-- Action rendering -->
            <div class="track-actions">
              <!-- Duration Actions (bars) -->
              <div 
                v-for="action in getDurationActionsForTrack(track.targetId)" 
                :key="action.id"
                class="action-bar"
                :class="[
                  getActionColorClass(action.type),
                  { selected: selectedActionId === action.id }
                ]"
                :style="getActionBarStyle(action)"
                @click.stop="handleSelectAction(action)"
                @mousedown="handleActionDragStart($event, action)"
              >
                <span
                  v-if="isActionOrderVisible(action)"
                  class="action-order-badge action-order-badge-bar"
                >{{ getActionOrderLabel(action) }}</span>
                <span class="action-bar-label">{{ getActionLabel(action) }}</span>
                <!-- Right resize handle -->
                <div 
                  class="resize-handle"
                  @mousedown.stop="handleActionResizeStart($event, action)"
                />
              </div>

              <!-- Point Actions (icons) -->
              <div 
                v-for="action in getPointActionsForTrack(track.targetId)" 
                :key="action.id"
                class="action-icon"
                :class="{ 
                  selected: selectedActionId === action.id,
                  locked: isBirthAction(action)
                }"
                :style="getActionIconStyle(action)"
                :draggable="!isBirthAction(action)"
                :title="isBirthAction(action) ? 'Spawn action cannot be dragged' : ''"
                @click.stop="handleSelectAction(action)"
                @dragstart="handleActionDragStart($event, action)"
              >
                <span
                  v-if="isActionOrderVisible(action)"
                  class="action-order-badge"
                >{{ getActionOrderLabel(action) }}</span>
                {{ getPointActionIcon(action) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div 
        v-if="contextMenu.visible" 
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      >
        <button
          class="menu-item danger"
          @click="handleDeleteTrackActions"
        >
          🗑️ Delete all actions for this object
        </button>
      </div>
    </Teleport>

    <!-- Custom filter dialog -->
    <Teleport to="body">
      <div
        v-if="customFilterPopover.visible"
        class="custom-filter-overlay"
        @click="closeCustomFilterPopover"
      >
        <div
          class="custom-filter-dialog"
          @click.stop
        >
          <div class="dialog-header">
            <span class="dialog-title">⚙️ Custom Filter</span>
            <button
              class="dialog-close"
              @click="closeCustomFilterPopover"
            >
              ✕
            </button>
          </div>
          <div class="dialog-search">
            <input 
              v-model="customFilterPopover.searchText" 
              type="text" 
              placeholder="🔍 Search object name..." 
              class="search-input"
            >
          </div>
          <div class="dialog-content">
            <!-- Group by type -->
            <div 
              v-for="group in groupedTracks" 
              :key="group.type" 
              class="track-group"
            >
              <div 
                class="group-header" 
                @click="toggleGroupCollapse(group.type)"
              >
                <span class="group-icon">{{ group.collapsed ? '▶' : '▼' }}</span>
                <span class="group-type-icon">{{ group.icon }}</span>
                <span class="group-label">{{ group.label }}</span>
                <span class="group-count">{{ group.tracks.length }}</span>
                <label
                  class="group-checkbox"
                  @click.stop
                >
                  <input 
                    type="checkbox" 
                    :checked="isGroupAllSelected(group.type)"
                    :indeterminate="isGroupPartialSelected(group.type)"
                    @change="toggleGroupSelection(group.type)"
                  >
                  <span class="checkbox-label">Select All</span>
                </label>
              </div>
              <div
                v-show="!group.collapsed"
                class="group-tracks"
              >
                <label 
                  v-for="track in getFilteredGroupTracks(group)" 
                  :key="track.targetId" 
                  class="track-item"
                  :class="{ selected: customFilterPopover.selectedTrackIds.includes(track.targetId) }"
                >
                  <input 
                    v-model="customFilterPopover.selectedTrackIds" 
                    type="checkbox"
                    :value="track.targetId"
                  >
                  <span class="track-icon">{{ track.icon }}</span>
                  <span class="track-name">{{ track.targetName }}</span>
                  <span
                    v-if="track.actions.length > 0"
                    class="track-actions-count"
                  >
                    {{ track.actions.length }} actions
                  </span>
                </label>
              </div>
            </div>
            <div
              v-if="groupedTracks.length === 0"
              class="empty-state"
            >
              <span>No objects to filter</span>
            </div>
          </div>
          <div class="dialog-footer">
            <div class="footer-info">
              Selected <strong>{{ customFilterPopover.selectedTrackIds.length }}</strong> / {{ allTracks.length }} objects
            </div>
            <div class="footer-actions">
              <button
                class="btn-secondary"
                @click="selectAllTracks"
              >
                Select All
              </button>
              <button
                class="btn-secondary"
                @click="clearSelection"
              >
                Clear
              </button>
              <button
                class="btn-primary"
                @click="applyCustomFilter"
              >
                Apply Filter
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount,onMounted, reactive, ref, watch } from 'vue'

import { getTypeIcon } from '@/core/sceneObjectProviders/metadata'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { CompositeObject } from '@/types/sceneObject'
import type { Action, DurationAction, RuntimeSlot, SceneObject, ScriptBlock } from '@/types/screenplay'
import { BIRTH_ACTION_ICON, DEATH_ACTION_ICON,isBirthAction, isDeathAction } from '@/utils/actionHelpers'
import { sortActionsForEvaluation } from '@/utils/actionOrder'
import { findCameraConflict, isCameraActionType } from '@/utils/cameraActionRules'
import { parseBlockToSlots } from '@/utils/slotUtils'

// ==================== Props & Emits ====================

interface Props {
  block: ScriptBlock | null
  actions: Action[]
  currentSlotIndex: number
  selectedActionId: string | null
  selectedObjectId: string | null
  isPlaying?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isPlaying: false
})

const emit = defineEmits<{
  'update:currentSlotIndex': [index: number]
  'select-slot': [index: number]
  'select-action': [action: Action | null]
  'select-object': [objectId: string | null]
  'update-action': [action: Action, updates: Partial<Action>]
  'delete-action': [action: Action]
  'reorder-actions': [slotIndex: number, actionIds: string[]]
  'reset-action-order': [slotIndex: number]
  'add-action': [type: string, target: string, slotIndex: number]
  'play': []
  'pause': []
  'stop': []
  'collapse-change': [collapsed: boolean]
}>()

// ==================== Stores ====================

const sceneObjectStore = useSceneObjectStore()

// ==================== State ====================

// Container state
const isCollapsed = ref(false)
const panelHeight = ref(250)
const minHeight = 150
const maxHeight = 600

// Toolbar state
const filterMode = ref<'active' | 'all' | 'selected' | 'custom'>('active')
const zoomLevel = ref(1)
const showActionOrder = ref(false)

// Custom filter state
const filterWrapperRef = ref<HTMLElement>()
const customFilterPopover = ref({
  visible: false,
  searchText: '',
  selectedTrackIds: [] as string[],
  collapsedGroups: new Set<string>()
})

// P2: Composite track collapsed state
const collapsedComposites = reactive(new Set<string>())

// Context menu
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  track: null as TrackData | null,
  slotIndex: 0
})

// Drag state
const isDragging = ref(false)
const isResizing = ref(false)
const dragAction = ref<Action | null>(null)
const dragStartX = ref(0)
const dragStartSlotIndex = ref(0)

// Scroll container ref
const scrollContainer = ref<HTMLElement>()

const objectIndexMap = computed(() => {
  const map = new Map<string, number>()
  sceneObjectStore.objects.forEach((obj, index) => {
    map.set(obj.id, index)
  })
  return map
})

// ==================== Computed ====================

// Container style
const containerStyle = computed(() => ({
  height: isCollapsed.value ? '36px' : `${panelHeight.value}px`
}))

// Parse slots
const slots = computed<RuntimeSlot[]>(() => {
  if (!props.block) return []
  return parseBlockToSlots(props.block)
})

// Track data interface
interface TrackData {
  targetId: string
  targetName: string
  type: SceneObject['type']
  icon: string
  actions: Action[]
  parentId?: string  // P2: composite grouping
  compositeMode?: 'entity' | 'union'  // P2: Composite mode (used for default collapse determination)
}

// Generate track data from scene objects and actions
const allTracks = computed<TrackData[]>(() => {
  const tracks: TrackData[] = []
  const targetSet = new Set<string>()
  
  // 1. Collect targets from actions
  for (const action of props.actions) {
    if (!targetSet.has(action.target)) {
      targetSet.add(action.target)
      tracks.push(createTrackFromTarget(action.target))
    }
  }
  
  // 2. Complement from scene objects (ensure camera is always shown)
  for (const obj of sceneObjectStore.objects) {
    let targetId = ''
    if (obj.type === 'camera') {
      targetId = 'camera'
    } else {
      // v7.0: Other objects (character, prop, background, audio, etc.) all use instance ID
      targetId = obj.id
    }
    
    if (targetId && !targetSet.has(targetId)) {
      targetSet.add(targetId)
      tracks.push(createTrackFromTarget(targetId))
    }
  }
  
  // Assign actions to each track
  for (const track of tracks) {
    track.actions = props.actions.filter(a => a.target === track.targetId)
  }
  
  // Two-layer architecture: parentId is already written to runtimeObjects by applySlotState()
  // No longer need accumulatedParentIds override
  
  return tracks
})

// Filter tracks according to filter mode
const filteredTracks = computed<TrackData[]>(() => {
  switch (filterMode.value) {
    case 'active': {
      // Only show tracks with actions + camera
      // P2: When descendant is active, ancestor composite is also included
      const activeTracks = allTracks.value.filter(t => t.actions.length > 0 || t.type === 'camera')
      const activeIds = new Set(activeTracks.map(t => t.targetId))
      // Collect all ancestors along the parentId chain
      for (const t of activeTracks) {
        let pid = t.parentId
        while (pid && !activeIds.has(pid)) {
          activeIds.add(pid)
          const parentTrack = allTracks.value.find(pt => pt.targetId === pid)
          pid = parentTrack?.parentId
        }
      }
      return allTracks.value.filter(t => activeIds.has(t.targetId))
    }
    case 'selected': {
      // Only show selected object - need to convert selectedObjectId to targetId
      if (!props.selectedObjectId) {
        return [] // Empty when no object is selected
      }
      const selectedObj = sceneObjectStore.getObject(props.selectedObjectId)
      if (!selectedObj) return []
      
      let matchTargetId = ''
      if (selectedObj.type === 'camera') {
        matchTargetId = 'camera'
      } else {
        // v7.0: Other objects all use instance ID
        matchTargetId = selectedObj.id
      }
      
      if (matchTargetId) {
        return allTracks.value.filter(t => t.targetId === matchTargetId)
      }
      return []
    }
    case 'custom':
      // Custom filter - filter by user-selected track IDs
      if (customFilterPopover.value.selectedTrackIds.length === 0) {
        return allTracks.value // Show all if none selected
      }
      return allTracks.value.filter(t => 
        customFilterPopover.value.selectedTrackIds.includes(t.targetId)
      )
    case 'all':
    default:
      return allTracks.value
  }
})

// P2: Sorted track list by composite parent→children (recursive depth-first)
const sortedFilteredTracks = computed<TrackData[]>(() => {
  const tracks = filteredTracks.value
  const result: TrackData[] = []
  const childMap = new Map<string, TrackData[]>() // parentId → children
  const rootTracks: TrackData[] = []
  const inserted = new Set<string>()

  // Classify: root vs child
  for (const t of tracks) {
    if (t.parentId) {
      const children = childMap.get(t.parentId) ?? []
      children.push(t)
      childMap.set(t.parentId, children)
    } else {
      rootTracks.push(t)
    }
  }

  // Recursive depth-first flattening
  function flattenTrack(track: TrackData): void {
    if (inserted.has(track.targetId)) return
    inserted.add(track.targetId)
    result.push(track)
    const children = childMap.get(track.targetId)
    if (children) {
      for (const child of children) {
        flattenTrack(child)
      }
    }
  }

  for (const track of rootTracks) {
    flattenTrack(track)
  }

  // Orphan children (parent not in current filter)
  for (const [, children] of childMap) {
    for (const child of children) {
      if (!inserted.has(child.targetId)) {
        flattenTrack(child)
      }
    }
  }

  return result
})

// Track group interface
interface TrackGroup {
  type: string
  label: string
  icon: string
  collapsed: boolean
  tracks: TrackData[]
}

// Tracks grouped by type
const groupedTracks = computed<TrackGroup[]>(() => {
  const groups: Record<string, TrackGroup> = {
    camera: { type: 'camera', label: 'Camera', icon: '🎥', collapsed: false, tracks: [] },
    character: { type: 'character', label: 'Character', icon: '👤', collapsed: false, tracks: [] },
    prop: { type: 'prop', label: 'Prop', icon: '📦', collapsed: false, tracks: [] },
    background: { type: 'background', label: 'Background', icon: '🖼️', collapsed: false, tracks: [] },
    audio: { type: 'audio', label: 'Audio', icon: '🎵', collapsed: false, tracks: [] },
    screen_effect: { type: 'screen_effect', label: 'Screen Effect', icon: '🌟', collapsed: false, tracks: [] },
    light: { type: 'light', label: 'Light', icon: '💡', collapsed: false, tracks: [] },
    composite: { type: 'composite', label: 'Composite', icon: '🧩', collapsed: false, tracks: [] }
  }
  
  for (const track of allTracks.value) {
    const group = groups[track.type]
    if (group) {
      group.tracks.push(track)
    } else {
      // Unknown types go into prop group
      groups['prop']!.tracks.push(track)
    }
  }
  
  // Apply collapsed state
  for (const group of Object.values(groups)) {
    group.collapsed = customFilterPopover.value.collapsedGroups.has(group.type)
  }
  
  // Return groups that have tracks
  return Object.values(groups).filter(g => g.tracks.length > 0)
})

const selectedActionOrderInfo = computed(() => {
  if (!props.selectedActionId) return null
  const selectedAction = props.actions.find(action => action.id === props.selectedActionId)
  if (!selectedAction) return null
  const slotActions = getOrderedActionsForSlot(selectedAction.slotIndex)
  const index = slotActions.findIndex(action => action.id === selectedAction.id)
  if (index === -1 || slotActions.length <= 1) return null
  return {
    action: selectedAction,
    index,
    total: slotActions.length,
  }
})

const currentSlotOrderActionCount = computed(() =>
  props.actions.filter(action => action.slotIndex === props.currentSlotIndex).length
)

// ==================== P2: Track Collapsing/Expanding ====================

// Check whether a track has child tracks
function hasChildTracks(targetId: string): boolean {
  return sortedFilteredTracks.value.some(t => t.parentId === targetId)
}

// P2: Manually toggled composites — skip automatic collapse/expand
const manuallyToggledComposites = new Set<string>()

// P2: Automatically set default collapse state according to compositeMode
// union -> expanded by default, entity -> collapsed by default
// v19.x: If descendant of entity has actions, automatically expand
watch(
  () => allTracks.value
    .filter(t => t.type === 'composite' && hasChildTracks(t.targetId))
    .map(t => ({ id: t.targetId, mode: t.compositeMode ?? 'union' as const })),
  (composites) => {
    for (const { id, mode } of composites) {
      if (manuallyToggledComposites.has(id)) continue
      if (mode === 'entity') {
        // Check if any descendant has actions
        const hasActiveDescendant = allTracks.value.some(t => {
          if (t.actions.length === 0) return false
          // Trace up parentId to see if it belongs to current composite
          let currentParent = t.parentId
          while (currentParent) {
            if (currentParent === id) return true
            const parentTrack = allTracks.value.find(pt => pt.targetId === currentParent)
            currentParent = parentTrack?.parentId
          }
          return false
        })
        
        if (hasActiveDescendant) {
          collapsedComposites.delete(id)
        } else {
          collapsedComposites.add(id)
        }
      } else {
        collapsedComposites.delete(id)
      }
    }
  },
  { immediate: true }
)

// Toggle track collapsed state
function toggleTrackCollapse(targetId: string): void {
  manuallyToggledComposites.add(targetId)
  if (collapsedComposites.has(targetId)) {
    collapsedComposites.delete(targetId)
  } else {
    collapsedComposites.add(targetId)
  }
}

// Collapse all composite tracks
function collapseAllTracks(): void {
  for (const t of allTracks.value) {
    if (hasChildTracks(t.targetId)) {
      collapsedComposites.add(t.targetId)
      manuallyToggledComposites.add(t.targetId)
    }
  }
}

// Calculate track nesting depth (for multi-level indent)
function getTrackDepth(track: TrackData): number {
  let depth = 0
  let pid = track.parentId
  while (pid) {
    depth++
    const parentTrack = allTracks.value.find(t => t.targetId === pid)
    pid = parentTrack?.parentId
  }
  return depth
}

// Whether child track is visible (check if entire ancestor chain is expanded)
function isTrackVisible(track: TrackData): boolean {
  if (!track.parentId) return true
  // Direct parent collapsed -> not visible
  if (collapsedComposites.has(track.parentId)) return false
  // Recursively check ancestors
  const parentTrack = sortedFilteredTracks.value.find(t => t.targetId === track.parentId)
  if (parentTrack) return isTrackVisible(parentTrack)
  return true
}

// ==================== Helper Functions ====================

function createTrackFromTarget(target: string): TrackData {
  if (target === 'camera') {
    return {
      targetId: 'camera',
      targetName: 'Camera',
      type: 'camera',
      icon: '🎥',
      actions: []
    }
  }

  if (target === '_scene_') {
    return {
      targetId: '_scene_',
      targetName: 'Current Scene',
      type: 'prop',
      icon: '🎬',
      actions: []
    }
  }
  
  // v11.1: Handle special scene animation target
  if (target === '__scene_animation__') {
    return {
      targetId: '__scene_animation__',
      targetName: 'Scene Animation',
      type: 'prop', // Use prop type icon
      icon: '🎬',
      actions: []
    }
  }
  
  // v7.0: target is now instance ID, look up directly from scene objects
  const obj = sceneObjectStore.getObject(target)
  if (obj) {
    // v7.1: Prefer alias (ensure non-empty string)
    const alias = obj.alias
    let displayName = target
    if (alias?.trim()) {
      displayName = alias
    } else if (obj.name?.trim()) {
      displayName = obj.name
    }
    
    // Two-layer architecture: directly read obj.parentId from runtimeObjects (written by applySlotState)
    const effectiveParentId = obj.parentId
    // P2: Attach compositeMode for composite type object
    const compositeMode = obj.type === 'composite'
      ? (obj as CompositeObject).compositeMode
      : undefined
    return {
      targetId: target,
      targetName: displayName,
      type: obj.type,
      icon: getTrackIcon(obj.type),
      actions: [],
      ...(effectiveParentId ? { parentId: effectiveParentId } : {}),
      ...(compositeMode ? { compositeMode } : {})
    }
  }
  
  // v7.1: If object not found, provide user-friendly display
  let fallbackName = target
  let fallbackType: SceneObject['type'] = 'prop'
  if (target.startsWith('char_')) {
    fallbackName = 'Character ' + target.substring(5, 13) + '...'
  } else if (target.startsWith('bg_')) {
    fallbackName = 'Background ' + target.substring(3, 11) + '...'
    fallbackType = 'background'
  }
  
  return {
    targetId: target,
    targetName: fallbackName,
    type: fallbackType,
    icon: '❓',
    actions: []
  }
}

// P1: Delegate to metadata registry, camera uses 🎥 in track view
function getTrackIcon(type: string): string {
  if (type === 'camera') return '🎥'
  return getTypeIcon(type)
}

function getSlotStyle(slot: RuntimeSlot) {
  // PRD v6.10: preroll/postroll calculate width based on duration, subtitle based on character count
  let width: number
  
  if (slot.type === 'preroll' || slot.type === 'postroll') {
    // Pre/post slot: calculate width based on duration
    // Min width 80px, +10px per 100ms
    const minWidth = 80
    const durationFactor = 0.1  // 1ms = 0.1px
    width = (minWidth + slot.duration * durationFactor) * zoomLevel.value
    // Clamp max width
    width = Math.min(width, 200 * zoomLevel.value)
  } else {
    // Subtitle slot: calculate width based on character count
    const basePadding = 60  // Base padding to ensure click area for short sentences
    const charFactor = 12   // Pixels per char
    const charCount = slot.text?.length ?? 1
    width = (basePadding + charCount * charFactor) * zoomLevel.value
  }
  
  return {
    width: `${width}px`,
    minWidth: `${width}px`
  }
}

// Calculate slot pixel width (v6.10: preroll/postroll based on duration, subtitle based on character count)
function getSlotPixelWidth(slot: RuntimeSlot): number {
  if (slot.type === 'preroll' || slot.type === 'postroll') {
    // Pre/post slot: calculate width based on duration
    const minWidth = 80
    const durationFactor = 0.1
    const width = (minWidth + slot.duration * durationFactor) * zoomLevel.value
    return Math.min(width, 200 * zoomLevel.value)
  } else {
    // Subtitle slot: calculate width based on character count
    const basePadding = 60
    const charFactor = 12
    const charCount = slot.text?.length ?? 1
    return (basePadding + charCount * charFactor) * zoomLevel.value
  }
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.substring(0, maxLen) + '...'
}

// Format slot duration display (v6.10)
function formatSlotDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  return `${(ms / 1000).toFixed(1)}s`
}

// Get slot display index (v6.10: adjust index after preroll)
function getSlotIndexLabel(slot: RuntimeSlot): string {
  if (slot.type === 'preroll') return '◀ Pre'
  if (slot.type === 'postroll') return 'Post ▶'
  
  // Calculate offset: if preroll exists, subtract 1
  const hasPreroll = slots.value.length > 0 && slots.value[0]?.type === 'preroll'
  const displayIndex = slot.index + 1 - (hasPreroll ? 1 : 0)
  
  return '#' + displayIndex
}

// Get slot display text (v6.10: do not show time when estimated)
function getSlotDisplayText(slot: RuntimeSlot): string {
  if (slot.type === 'preroll') {
    // preroll: do not show time if estimated
    return slot.isEstimated ? 'Pre-roll' : formatSlotDuration(slot.duration)
  } else if (slot.type === 'postroll') {
    // postroll: do not show time if estimated
    return slot.isEstimated ? 'Post-roll' : formatSlotDuration(slot.duration)
  }
  // subtitle: show text
  return truncateText(slot.text ?? '', 30)
}

function getActionColorClass(type: string): string {
  if (type.startsWith('camera')) return 'color-camera'
  // screen_effect check must be before startsWith('tween'), otherwise tween_screen_effect matches color-transform
  if (type === 'set_screen_effect' || type === 'tween_screen_effect') return 'color-vfx'
  if (type === 'set_light' || type === 'tween_light') return 'color-light'
  if (type === 'set_text' || type === 'tween_text' || type === 'set_text_reveal') return 'color-text'
  if (type.startsWith('tween') || type === 'set_transform') return 'color-transform'
  if (type.startsWith('vfx')) return 'color-vfx'
  return 'color-default'
}

function getActionLabel(action: Action): string {
  switch (action.type) {
    case 'tween_transform': {
      const p = action.params
      if (p?.x !== undefined || p?.y !== undefined) return 'Move'
      if (p?.scaleX !== undefined) return 'Scale'
      if (p?.rotation !== undefined) return 'Rotate'
      if (p?.alpha !== undefined) return 'Opacity'
      return 'Transform'
    }
    case 'camera_move': return 'Camera Move'
    case 'camera_shake': return 'Shake'
    case 'camera_follow': return 'Follow'
    case 'set_screen_effect': return '🌟Effect'
    case 'tween_screen_effect': return '🌟Fade'
    case 'set_light': return '💡Light'
    case 'tween_light': return '💡Fade'
    case 'set_material': return '🎨Material'
    case 'set_text': return '📝Text'
    case 'set_text_reveal': {
      return action.params.action === 'stop' ? '⌨Full Text' : '⌨Typewriter'
    }
    case 'tween_text': return '📝Fade'
    case 'set_mask': return '✂Mask'
    default: return action.type
  }
}

function getPointActionIcon(action: Action): string {
  switch (action.type) {

    case 'set_lifecycle': {
      // v9.3: Lifecycle Action uses dedicated icon
      if (isBirthAction(action)) return BIRTH_ACTION_ICON  // 🌱 Spawn
      if (isDeathAction(action)) return DEATH_ACTION_ICON  // 🍂 Despawn
      return '◆'
    }
    case 'set_transform': {
      // v9.3: set_transform only handles geometry + opacity, no longer includes spawned
      return '◆'
    }
    case 'set_visual': {
      // v9.3: Visual property Action
      return '👁'
    }
    case 'camera_cut': return '🎥'
    // v6.4: set_anim icon
    case 'set_anim': return '🎬'
    case 'set_audio': {
      const p = action.params
      if (p?.action === 'stop') return '🔇'
      return '🔊'
    }
    case 'set_screen_effect': return '🌟'
    case 'tween_screen_effect': return '🌟'
    case 'set_light': return '💡'
    case 'tween_light': return '💡'
    case 'set_scene_structure': return '🧭'   // Scene structure change
    case 'set_composite': return '🧩'   // P2: Composite property change
    case 'set_mask': return '✂'         // Clip-Mask Phase 1: Mask property change
    case 'set_material': return '🎨'    // v16: Symbol material switch
    case 'set_text': return '📝'         // Text PRD: Text property
    case 'set_text_reveal': return '⌨'
    case 'tween_text': return '📝'       // Text PRD: Text fade
    default: return '◆'
  }
}

// Note: isBirthAction and isDeathAction are imported from @/utils/actionHelpers

function getActionBarStyle(action: Action) {
  const startSlot = slots.value.find(s => s.index === action.slotIndex)
  if (!startSlot) return { display: 'none' }

  const span = 'slotSpan' in action ? action.slotSpan : 1
  let left = 0
  
  // Calculate left position (based on character count)
  for (let i = 0; i < action.slotIndex; i++) {
    const s = slots.value[i]
    if (s) {
      left += getSlotPixelWidth(s)
    }
  }
  
  // Calculate width (based on character count)
  let width = 0
  for (let i = 0; i < span; i++) {
    const s = slots.value[action.slotIndex + i]
    if (s) {
      width += getSlotPixelWidth(s)
    }
  }
  
  return {
    left: `${left + 4}px`,
    width: `${width - 8}px`
  }
}

function getActionIconStyle(action: Action) {
  let left = 0
  
  // Calculate left position (based on character count)
  for (let i = 0; i < action.slotIndex; i++) {
    const s = slots.value[i]
    if (s) {
      left += getSlotPixelWidth(s)
    }
  }
  
  // Center display
  const currentSlot = slots.value[action.slotIndex]
  const slotWidth = currentSlot ? getSlotPixelWidth(currentSlot) : 80
  
  // v6.4: Multiple point actions of same object in same slot displayed side by side
  const sameSlotActions = props.actions.filter(
    a => a.target === action.target && a.slotIndex === action.slotIndex && a.category === 'point'
  )
  const orderedSameSlotActions = sortActionsForEvaluation(sameSlotActions, objectIndexMap.value)
  
  const iconWidth = 24
  const totalWidth = orderedSameSlotActions.length * iconWidth
  const startOffset = (slotWidth - totalWidth) / 2
  const actionIndex = orderedSameSlotActions.findIndex(a => a.id === action.id)
  const offset = startOffset + actionIndex * iconWidth
  
  return {
    left: `${left + offset}px`
  }
}

function getDurationActionsForTrack(targetId: string): Action[] {
  return sortActionsForEvaluation(
    props.actions.filter(a => a.target === targetId && a.category === 'duration'),
    objectIndexMap.value,
  )
}

function getPointActionsForTrack(targetId: string): Action[] {
  return sortActionsForEvaluation(
    props.actions.filter(a => a.target === targetId && a.category === 'point'),
    objectIndexMap.value,
  )
}

function getOrderedActionsForSlot(slotIndex: number): Action[] {
  return sortActionsForEvaluation(
    props.actions.filter(action => action.slotIndex === slotIndex),
    objectIndexMap.value,
  )
}

function getActionOrderLabel(action: Action): number {
  const slotActions = getOrderedActionsForSlot(action.slotIndex)
  const index = slotActions.findIndex(item => item.id === action.id)
  return index === -1 ? 1 : index + 1
}

function isActionOrderVisible(action: Action): boolean {
  return showActionOrder.value && action.slotIndex === props.currentSlotIndex
}

function handleMoveSelectedActionOrder(direction: -1 | 1): void {
  const info = selectedActionOrderInfo.value
  if (!info) return
  
  const slotActions = getOrderedActionsForSlot(info.action.slotIndex)
  const nextIndex = info.index + direction
  if (nextIndex < 0 || nextIndex >= slotActions.length) return

  const nextActions = [...slotActions]
  const current = nextActions[info.index]
  const next = nextActions[nextIndex]
  if (!current || !next) return

  nextActions[info.index] = next
  nextActions[nextIndex] = current
  emit('reorder-actions', info.action.slotIndex, nextActions.map(action => action.id))
}

function handleResetCurrentSlotActionOrder(): void {
  emit('reset-action-order', props.currentSlotIndex)
}

// ==================== Event Handlers ====================

// ==================== Custom Filter Functions ====================

function handleFilterChange() {
  if (filterMode.value === 'custom') {
    // Open custom filter panel
    customFilterPopover.value.visible = true
    // Initialize selected state (select all by default if none selected)
    if (customFilterPopover.value.selectedTrackIds.length === 0) {
      customFilterPopover.value.selectedTrackIds = allTracks.value.map(t => t.targetId)
    }
  }
}

function closeCustomFilterPopover() {
  customFilterPopover.value.visible = false
}

function toggleGroupCollapse(type: string) {
  if (customFilterPopover.value.collapsedGroups.has(type)) {
    customFilterPopover.value.collapsedGroups.delete(type)
  } else {
    customFilterPopover.value.collapsedGroups.add(type)
  }
}

function isGroupAllSelected(type: string): boolean {
  const group = groupedTracks.value.find(g => g.type === type)
  if (!group) return false
  return group.tracks.every(t => 
    customFilterPopover.value.selectedTrackIds.includes(t.targetId)
  )
}

function isGroupPartialSelected(type: string): boolean {
  const group = groupedTracks.value.find(g => g.type === type)
  if (!group) return false
  const selectedCount = group.tracks.filter(t => 
    customFilterPopover.value.selectedTrackIds.includes(t.targetId)
  ).length
  return selectedCount > 0 && selectedCount < group.tracks.length
}

function toggleGroupSelection(type: string) {
  const group = groupedTracks.value.find(g => g.type === type)
  if (!group) return
  
  const allSelected = isGroupAllSelected(type)
  if (allSelected) {
    // Deselect all
    for (const track of group.tracks) {
      const idx = customFilterPopover.value.selectedTrackIds.indexOf(track.targetId)
      if (idx !== -1) {
        customFilterPopover.value.selectedTrackIds.splice(idx, 1)
      }
    }
  } else {
    // Select all
    for (const track of group.tracks) {
      if (!customFilterPopover.value.selectedTrackIds.includes(track.targetId)) {
        customFilterPopover.value.selectedTrackIds.push(track.targetId)
      }
    }
  }
}

function getFilteredGroupTracks(group: TrackGroup): TrackData[] {
  const searchText = customFilterPopover.value.searchText.toLowerCase().trim()
  if (!searchText) return group.tracks
  return group.tracks.filter(t => 
    t.targetName.toLowerCase().includes(searchText) ||
    t.targetId.toLowerCase().includes(searchText)
  )
}

function selectAllTracks() {
  customFilterPopover.value.selectedTrackIds = allTracks.value.map(t => t.targetId)
}

function clearSelection() {
  customFilterPopover.value.selectedTrackIds = []
}

function applyCustomFilter() {
  customFilterPopover.value.visible = false
}

// Close popover when clicking outside
function handleClickOutside(event: MouseEvent) {
  if (
    customFilterPopover.value.visible &&
    filterWrapperRef.value &&
    !filterWrapperRef.value.contains(event.target as Node)
  ) {
    customFilterPopover.value.visible = false
  }
}

// Height resize
let isResizingPanel = false
let resizeStartY = 0
let resizeStartHeight = 0

function startResize(e: MouseEvent) {
  if (isCollapsed.value) return
  
  isResizingPanel = true
  resizeStartY = e.clientY
  resizeStartHeight = panelHeight.value
  
  document.addEventListener('mousemove', handleResizeMove)
  document.addEventListener('mouseup', handleResizeEnd)
  document.body.style.cursor = 'row-resize'
  e.preventDefault()
}

function handleResizeMove(e: MouseEvent) {
  if (!isResizingPanel) return
  
  const delta = resizeStartY - e.clientY
  const newHeight = Math.max(minHeight, Math.min(maxHeight, resizeStartHeight + delta))
  panelHeight.value = newHeight
}

function handleResizeEnd() {
  isResizingPanel = false
  document.removeEventListener('mousemove', handleResizeMove)
  document.removeEventListener('mouseup', handleResizeEnd)
  document.body.style.cursor = ''
}

// Collapse/Expand
function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
  // Notify parent component of collapse state change to refresh canvas
  emit('collapse-change', isCollapsed.value)
}

// Zoom
function handleZoomIn() {
  if (zoomLevel.value < 2) {
    zoomLevel.value = Math.min(2, zoomLevel.value + 0.1)
  }
}

function handleZoomOut() {
  if (zoomLevel.value > 0.5) {
    zoomLevel.value = Math.max(0.5, zoomLevel.value - 0.1)
  }
}

// Slot selection
function handleSelectSlot(index: number) {
  emit('update:currentSlotIndex', index)
  emit('select-slot', index)
}

// Track selection
function handleSelectTrack(track: TrackData) {
  // Find corresponding scene object
  let objectId: string | null = null
  
  if (track.type === 'camera') {
    const cameraObj = sceneObjectStore.objects.find(o => o.type === 'camera')
    objectId = cameraObj?.id ?? null
  } else {
    // v7.0: targetId is now instance ID, look up directly
    const obj = sceneObjectStore.getObject(track.targetId)
    objectId = obj?.id ?? null
  }
  
  emit('select-object', objectId)
}

// Action selection
// v8.8: When selecting an action, automatically select its slot
function handleSelectAction(action: Action) {
  // Update slot index to action's start slot
  // Point action: slotIndex is its slot
  // Duration action: slotIndex is its start slot
  if (action.slotIndex !== props.currentSlotIndex) {
    emit('update:currentSlotIndex', action.slotIndex)
  }
  emit('select-action', action)
}

// Container scroll handling
function handleContainerScroll(_e: Event) {
  // Unified scroll container, no need for extra synchronization
}

// Context menu - for track header
function handleTrackHeaderContextMenu(e: MouseEvent, track: TrackData) {
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    track,
    slotIndex: 0
  }
}

function closeContextMenu() {
  contextMenu.value.visible = false
}

// Delete all actions for this object
function handleDeleteTrackActions() {
  if (contextMenu.value.track) {
    const targetId = contextMenu.value.track.targetId
    // Delete all actions for this target
    const actionsToDelete = props.actions.filter(a => a.target === targetId)
    for (const action of actionsToDelete) {
      emit('delete-action', action)
    }
  }
  closeContextMenu()
}

// Action drag (move)
function handleActionDragStart(e: MouseEvent, action: Action) {
  isDragging.value = true
  dragAction.value = action
  dragStartX.value = e.clientX
  dragStartSlotIndex.value = action.slotIndex
  
  document.addEventListener('mousemove', handleActionDragMove)
  document.addEventListener('mouseup', handleActionDragEnd)
}

function handleActionDragMove(e: MouseEvent) {
  if (!isDragging.value || !dragAction.value) return
  
  // Calculate new slot index
  const baseWidth = 80 * zoomLevel.value
  const deltaX = e.clientX - dragStartX.value
  const deltaSlots = Math.round(deltaX / baseWidth)
  const newSlotIndex = Math.max(0, Math.min(slots.value.length - 1, dragStartSlotIndex.value + deltaSlots))
  
  if (newSlotIndex !== dragAction.value.slotIndex) {
    const action = dragAction.value
    const span = action.category === 'duration' ? (action as DurationAction).slotSpan : 1
    const endSlotIndex = newSlotIndex + span - 1
    
    if (action.target === 'camera' && isCameraActionType(action.type)) {
      const candidate = { ...action, slotIndex: newSlotIndex } as Action
      const conflict = findCameraConflict(props.actions, candidate, { excludeId: action.id })
      if (conflict) return
    }
    
    if (action.target === 'camera' && isCameraActionType(action.type)) {
      emit('update-action', dragAction.value, { slotIndex: newSlotIndex })
      return
    }

    // Get same-category actions of same target (excluding currently dragged action)
    const sameTargetActions = props.actions.filter(a =>
      a.target === action.target &&
      a.id !== action.id &&
      a.category === action.category  // Same category: tween with tween, point with point
    )

    // Check overlap
    let hasOverlap = false
    for (const otherAction of sameTargetActions) {
      const otherSpan = otherAction.category === 'duration' ? (otherAction as DurationAction).slotSpan : 1
      const otherStart = otherAction.slotIndex
      const otherEnd = otherStart + otherSpan - 1

      // Check whether range overlaps
      if (!(endSlotIndex < otherStart || newSlotIndex > otherEnd)) {
        hasOverlap = true
        break
      }
    }

    // Update position if no overlap
    if (!hasOverlap) {
      emit('update-action', dragAction.value, { slotIndex: newSlotIndex })
    }
  }
}

function handleActionDragEnd() {
  isDragging.value = false
  dragAction.value = null
  document.removeEventListener('mousemove', handleActionDragMove)
  document.removeEventListener('mouseup', handleActionDragEnd)
}

// Action resize (slotSpan for Duration Action)
function handleActionResizeStart(e: MouseEvent, action: Action) {
  if (action.category !== 'duration') return
  
  isResizing.value = true
  dragAction.value = action
  dragStartX.value = e.clientX
  
  document.addEventListener('mousemove', handleActionResizeMove)
  document.addEventListener('mouseup', handleActionResizeEnd)
  document.body.style.cursor = 'col-resize'
}

function handleActionResizeMove(e: MouseEvent) {
  if (!isResizing.value || !dragAction.value) return
  
  const baseWidth = 80 * zoomLevel.value
  const deltaX = e.clientX - dragStartX.value
  const currentSpan = dragAction.value.category === 'duration' ? (dragAction.value as DurationAction).slotSpan : 1
  const deltaSpan = Math.round(deltaX / baseWidth)
  const maxSpan = slots.value.length - dragAction.value.slotIndex
  const newSpan = Math.max(1, Math.min(maxSpan, currentSpan + deltaSpan))
  
  if (newSpan !== currentSpan) {
    if (dragAction.value.target === 'camera' && isCameraActionType(dragAction.value.type)) {
      const candidate = { ...dragAction.value, slotSpan: newSpan } as Action
      const conflict = findCameraConflict(props.actions, candidate, { excludeId: dragAction.value.id })
      if (conflict) return
    }

    dragStartX.value = e.clientX
    emit('update-action', dragAction.value, { slotSpan: newSpan })
  }
}

function handleActionResizeEnd() {
  isResizing.value = false
  dragAction.value = null
  document.removeEventListener('mousemove', handleActionResizeMove)
  document.removeEventListener('mouseup', handleActionResizeEnd)
  document.body.style.cursor = ''
}

// ==================== Lifecycle ====================

onMounted(() => {
  // Access scrollContainer to satisfy unused variable check
  if (scrollContainer.value) {
    // nothing to do
  }

  document.addEventListener('click', closeContextMenu)
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeContextMenu)
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('mousemove', handleResizeMove)
  document.removeEventListener('mouseup', handleResizeEnd)
})
</script>

<style scoped>
.action-sequencer {
  position: relative;
  display: flex;
  flex-direction: column;
  background: white;
  border-top: 1px solid #e5e7eb;
  transition: height 0.2s ease;
  overflow: hidden;
}

.action-sequencer.collapsed {
  height: 36px !important;
}

/* Resizer */
.resizer-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 5px;
  cursor: row-resize;
  z-index: 10;
}

.resizer-handle:hover {
  background: rgba(59, 130, 246, 0.3);
}

.resizer-grip {
  position: absolute;
  left: 50%;
  top: 1px;
  transform: translateX(-50%);
  width: 40px;
  height: 3px;
  background: #d1d5db;
  border-radius: 2px;
}

/* Toolbar */
.sequencer-toolbar {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 12px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  gap: 16px;
}

.toolbar-left, .toolbar-center, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-spacer {
  flex: 1;
}

.toolbar-center {
  flex: 1;
}

.toolbar-btn {
  padding: 4px 8px;
  font-size: 12px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  color: #374151;
  cursor: pointer;
  transition: all 0.2s;
}

.toolbar-btn:hover:not(:disabled) {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.toolbar-btn.active {
  color: #1d4ed8;
  background: #eff6ff;
  border-color: #60a5fa;
}

.toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.order-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 8px;
  border-left: 1px solid #e5e7eb;
}

.order-label {
  font-size: 12px;
  color: #4b5563;
}

.order-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 13px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  color: #374151;
  cursor: pointer;
}

.order-btn:hover:not(:disabled) {
  background: #eff6ff;
  border-color: #60a5fa;
}

.order-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.order-default-btn {
  width: auto;
  padding: 0 8px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

.play-btn.playing {
  background: #3b82f6;
  border-color: #3b82f6;
  color: white;
}

.filter-label {
  font-size: 12px;
  color: #6b7280;
}

.filter-select {
  padding: 4px 8px;
  font-size: 12px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  color: #374151;
  cursor: pointer;
}

/* Custom filter dialog */
.filter-wrapper {
  position: relative;
}

.custom-filter-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.custom-filter-dialog {
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  background: white;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
}

.dialog-close {
  width: 28px;
  height: 28px;
  padding: 0;
  background: rgba(255, 255, 255, 0.2);
  border: none;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition: background 0.2s;
}

.dialog-close:hover {
  background: rgba(255, 255, 255, 0.3);
}

.dialog-search {
  padding: 16px 20px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
}

.dialog-search .search-input {
  width: 100%;
  padding: 10px 14px;
  font-size: 14px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  outline: none;
  transition: all 0.2s;
}

.dialog-search .search-input:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.dialog-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
  min-height: 200px;
  max-height: 400px;
}

.track-group {
  margin-bottom: 8px;
}

.group-header {
  display: flex;
  align-items: center;
  padding: 10px 20px;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.group-header:hover {
  background: #f3f4f6;
}

.group-icon {
  font-size: 12px;
  color: #6b7280;
  width: 16px;
  text-align: center;
  transition: transform 0.2s;
}

.group-type-icon {
  font-size: 18px;
}

.group-label {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}

.group-count {
  font-size: 12px;
  color: #9ca3af;
  background: #f3f4f6;
  padding: 2px 8px;
  border-radius: 10px;
}

.group-checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.group-checkbox:hover {
  background: #e5e7eb;
}

.group-checkbox input {
  cursor: pointer;
  width: 16px;
  height: 16px;
}

.checkbox-label {
  font-size: 12px;
  color: #6b7280;
}

.group-tracks {
  padding-left: 44px;
  background: #fafafa;
}

.track-item {
  display: flex;
  align-items: center;
  padding: 8px 20px;
  gap: 10px;
  cursor: pointer;
  transition: background 0.2s;
  border-left: 3px solid transparent;
}

.track-item:hover {
  background: #f3f4f6;
}

.track-item.selected {
  background: #eff6ff;
  border-left-color: #3b82f6;
}

.track-item input {
  cursor: pointer;
  width: 16px;
  height: 16px;
}

.track-icon {
  font-size: 16px;
}

.track-name {
  flex: 1;
  font-size: 13px;
  color: #374151;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-actions-count {
  font-size: 11px;
  color: #9ca3af;
  background: #e5e7eb;
  padding: 2px 6px;
  border-radius: 4px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: #9ca3af;
  font-size: 14px;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
}

.footer-info {
  font-size: 13px;
  color: #6b7280;
}

.footer-info strong {
  color: #3b82f6;
  font-weight: 600;
}

.footer-actions {
  display: flex;
  gap: 10px;
}

.btn-secondary {
  padding: 8px 16px;
  font-size: 13px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  color: #374151;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.btn-primary {
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 500;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

.zoom-label {
  font-size: 14px;
}

.zoom-slider {
  width: 80px;
  height: 4px;
  cursor: pointer;
}

.zoom-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 14px;
  font-weight: bold;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  color: #374151;
  cursor: pointer;
}

.zoom-btn:hover:not(:disabled) {
  background: #f3f4f6;
}

.zoom-value {
  font-size: 11px;
  color: #6b7280;
  min-width: 36px;
  text-align: right;
}

.collapse-btn {
  padding: 4px 8px;
  font-size: 10px;
  background: transparent;
  border: none;
  color: #6b7280;
  cursor: pointer;
}

.collapse-btn:hover {
  color: #374151;
}

/* Collapsed Header */
.collapsed-header {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 12px;
  background: #f9fafb;
  cursor: pointer;
  gap: 12px;
}

.collapsed-header:hover {
  background: #f3f4f6;
}

.collapsed-title {
  font-size: 12px;
  font-weight: 500;
  color: #374151;
}

.collapsed-info {
  font-size: 11px;
  color: #9ca3af;
}

.collapsed-spacer {
  flex: 1;
}

/* Content Area - Unified scroll container */
.sequencer-content {
  flex: 1;
  overflow: auto;
  background: #fafafa;
}

/* Track row - Contains left header and right content */
.track-row {
  display: flex;
  min-width: fit-content;
}

.track-row.subtitle-row {
  position: sticky;
  top: 0;
  z-index: 5;
  background: #f3f4f6;
}

.track-row.selected {
  background: rgba(59, 130, 246, 0.05);
}

/* Left object header - Sticky positioning */
.track-header {
  position: sticky;
  left: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  width: 160px;
  min-width: 160px;
  height: 40px;
  padding: 0 12px;
  background: #f9fafb;
  border-right: 1px solid #e5e7eb;
  border-bottom: 1px solid #e5e7eb;
  cursor: pointer;
  gap: 8px;
  flex-shrink: 0;
}

.track-header:hover {
  background: #f3f4f6;
}

.track-header.selected {
  background: #eff6ff;
}

.track-header.subtitle-header {
  background: #f3f4f6;
  cursor: default;
  z-index: 6;
}

/* Right track content */
.track-content {
  flex: 1;
  min-width: 0;
}

.header-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.header-label {
  flex: 1;
  font-size: 12px;
  color: #374151;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Subtitle Track */
.subtitle-track {
  display: flex;
  height: 40px;
  background: #f3f4f6;
}

.slot-card {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 4px 8px;
  border-right: 1px solid #e5e7eb;
  cursor: pointer;
  transition: background 0.2s;
}

.slot-card:hover {
  background: #e5e7eb;
}

.slot-card.active {
  background: #dbeafe;
  border-color: #3b82f6;
}

/* Preroll slot */
.slot-card.preroll {
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border-color: #f59e0b;
}

.slot-card.preroll .slot-index {
  color: #d97706;
}

.slot-card.preroll.active {
  background: linear-gradient(135deg, #fde68a, #fcd34d);
  border-color: #f59e0b;
}

/* Postroll slot */
.slot-card.postroll {
  background: linear-gradient(135deg, #e0e7ff, #c7d2fe);
  border-color: #6366f1;
}

.slot-card.postroll .slot-index {
  color: #4f46e5;
}

.slot-card.postroll.active {
  background: linear-gradient(135deg, #c7d2fe, #a5b4fc);
  border-color: #6366f1;
}

.slot-index {
  font-size: 10px;
  font-weight: 600;
  color: #3b82f6;
  margin-bottom: 2px;
}

.slot-text {
  font-size: 11px;
  color: #374151;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Action Track */
.action-track {
  position: relative;
  height: 40px;
  border-bottom: 1px solid #e5e7eb;
}

.action-track.selected {
  background: rgba(59, 130, 246, 0.08);
}

/* Track Grid */
.track-grid {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  pointer-events: none;
}

.grid-cell {
  flex-shrink: 0;
  border-right: 1px dashed #e5e7eb;
}

.grid-cell.active {
  background: rgba(59, 130, 246, 0.08);
}

/* Track Actions */
.track-actions {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

/* Action Bar (Duration) */
.action-bar {
  position: absolute;
  top: 6px;
  height: 28px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 4px;
  cursor: move;
  font-size: 11px;
  color: white;
  overflow: visible;
  transition: box-shadow 0.2s;
}

.action-bar:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.action-bar.selected {
  box-shadow: 0 0 0 2px #3b82f6;
}

.action-bar.color-transform {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
}

.action-bar.color-camera {
  background: linear-gradient(135deg, #22c55e, #16a34a);
}

.action-bar.color-vfx {
  background: linear-gradient(135deg, #a855f7, #7c3aed);
}

.action-bar.color-default {
  background: linear-gradient(135deg, #6b7280, #4b5563);
}

.action-bar.color-light {
  background: linear-gradient(135deg, #ffb347, #ff9500);
}

.action-bar.color-text {
  background: linear-gradient(135deg, #38bdf8, #0ea5e9);
}

.action-bar-label {
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.resize-handle {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
}

.resize-handle:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* Action Icon (Point) */
.action-icon {
  position: absolute;
  top: 10px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: move;
  transition: all 0.2s;
}

.action-icon:hover {
  background: #f3f4f6;
  transform: scale(1.1);
}

.action-icon.selected {
  background: #3b82f6;
  border-color: #3b82f6;
  color: white;
}

.action-order-badge {
  position: absolute;
  top: -8px;
  right: -8px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  font-size: 10px;
  line-height: 14px;
  text-align: center;
  color: white;
  background: #111827;
  border-radius: 999px;
  pointer-events: none;
}

.action-order-badge-bar {
  left: -8px;
  right: auto;
}

/* Context Menu */
.context-menu {
  position: fixed;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10000;
  overflow: hidden;
  min-width: 160px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 16px;
  font-size: 12px;
  background: transparent;
  border: none;
  color: #374151;
  cursor: pointer;
  text-align: left;
}

.menu-item:hover:not(:disabled) {
  background: #f3f4f6;
}

.menu-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.menu-divider {
  height: 1px;
  background: #e5e7eb;
  margin: 4px 0;
}

/* P2: composite child object track indent (padding-left dynamically calculated by :style) */
.track-row.child-track .track-header {
  border-left: 2px solid #93c5fd;
  font-size: 11px;
}

/* P2: Track collapse button */
.track-collapse-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 2px;
  font-size: 10px;
  color: #9ca3af;
  line-height: 1;
  flex-shrink: 0;
}

.track-collapse-btn:hover {
  color: #6366f1;
}

.track-indent {
  color: #d1d5db;
  font-size: 10px;
  padding: 0 2px;
  flex-shrink: 0;
}
</style>
