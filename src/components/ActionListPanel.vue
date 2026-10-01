<template>
  <div class="action-list-panel">
    <!-- Action list -->
    <div class="action-list">
      <div
        v-for="(action, index) in sortedActions"
        :key="action.id || index"
        :data-action-id="action.id"
        class="action-item"
        :class="{ selected: action.id === selectedActionId }"
        @click="handleSelectAction(action)"
        @mouseenter="handleHoverAction(action)"
      >
        <!-- Action icon -->
        <div
          class="action-icon"
          :class="getActionIconClass(action.type)"
        >
          <span v-if="isPointAction(action)">◆</span>
          <span
            v-else
            class="duration-bar"
          >|</span>
        </div>

        <!-- Action info -->
        <div class="action-info">
          <div class="action-time">
            #{{ action.slotIndex + 1 }}
          </div>
          <div class="action-target">
            {{ getTargetName(action.target) }}
          </div>
          <div class="action-description">
            {{ getActionDescription(action) }}
          </div>
        </div>

        <!-- Delete button -->
        <button
          class="delete-btn"
          title="Delete action"
          @click.stop="handleDeleteAction(action, index)"
        >
          ×
        </button>
      </div>

      <div
        v-if="sortedActions.length === 0"
        class="empty-state"
      >
        <p>No actions</p>
        <p class="hint">
          Operating objects on the canvas will automatically record as actions
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { Action } from '@/types/screenplay'
import { SCENE_ACTION_TARGET } from '@/types/screenplay'

interface LegacySetTransformParams {
  alpha?: number
  visible?: boolean
  flipX?: boolean
  zIndex?: number
}

interface LegacyTriggerAnimParams {
  action?: string
  partId?: string
}

const props = defineProps<{
  actions: Action[]
  blockDuration: number // Block total duration (ms)
  selectedActionId?: string | null
}>()

const emit = defineEmits<{
  selectAction: [action: Action | null]
  deleteAction: [action: Action, index: number]
  hoverAction: [action: Action | null]
  requestDeleteConfirm: [action: Action, index: number]
}>()

const sceneObjectStore = useSceneObjectStore()


// Action list sorted by slot index
const sortedActions = computed(() => {
  return [...props.actions].sort((a, b) => a.slotIndex - b.slotIndex)
})

// Check if point action
function isPointAction(action: Action): boolean {
  return action.category === 'point'
}

// Get action icon style class
function getActionIconClass(type: string): string {
  return `action-icon-${type}`
}

// Get target object name
function getTargetName(target: string): string {
  // If camera
  if (target === 'camera') {
    return 'Camera'
  }
  if (target === SCENE_ACTION_TARGET) {
    return 'Current Scene'
  }

  // v7.0: target is instance ID, query directly through sceneObjectStore
  const obj = sceneObjectStore.getObject(target)
  if (obj) {
    // v7.1: Prioritize instance alias (ensure non-empty string)
    const alias = obj.alias
    if (alias?.trim()) {
      return alias
    }
    if (obj.name?.trim()) {
      return obj.name
    }
  }

  // If object not found, extract readable display name from target
  // target may be in "char_xxx" format, show friendly text
  if (target.startsWith('char_')) {
    return 'Character ' + target.substring(5, 13) + '...'
  }
  if (target.startsWith('bg_')) {
    return 'Background ' + target.substring(3, 11) + '...'
  }
  
  return target
}

// Get action description (v6.3)
function getActionDescription(action: Action): string {
  switch (action.type) {
    case 'set_transform': {
      const params = action.params as LegacySetTransformParams
      const transformParts: string[] = []
      if (params.alpha !== undefined) transformParts.push('Opacity')
      if (params.visible !== undefined) transformParts.push(params.visible ? 'Show' : 'Hide')
      if (params.flipX !== undefined) transformParts.push('Flip')
      if (params.zIndex !== undefined) transformParts.push('Layer')
      return transformParts.length > 0 ? transformParts.join('/') : 'Visual Transform'
    }

    case 'camera_cut':
      return 'Camera Cut'
    case 'set_scene_structure':
      return 'Structure Change'
    case 'tween_transform': {
      const tweenAction = action
      const tweenParts: string[] = []
      if (tweenAction.params?.x !== undefined || tweenAction.params?.y !== undefined) {
        tweenParts.push('Move')
      }
      if (tweenAction.params?.scaleX !== undefined || tweenAction.params?.scaleY !== undefined) {
        tweenParts.push('Scale')
      }
      if (tweenAction.params?.rotation !== undefined) {
        tweenParts.push('Rotate')
      }
      return tweenParts.length > 0 ? `Tween: ${tweenParts.join('/')}` : 'Tween Transform'
    }
    case 'camera_move':
      return 'Camera Move'
    case 'camera_shake': {
      const shakeAction = action
      return `Shake: ${shakeAction.params?.intensity || 0}px`
    }
    case 'camera_follow': {
      const followAction = action
      const followTargetId = followAction.params?.followTarget || ''
      // v7.0: Use getTargetName for alias
      const followTargetName = followTargetId ? getTargetName(followTargetId) : 'Not set'
      return `Follow: ${followTargetName}`
    }
    case 'set_anim': {
      const params = action.params as unknown as LegacyTriggerAnimParams
      const animCmd = params.action ?? 'play'
      const animPartId = params.partId ?? (params.partId === '' ? 'All' : 'Default')
      // Try to find part name if possible, otherwise use ID
      // But here we rely on what's stored. 
      // Ideally we would look up part name but ID is acceptable for now.
      return `Animation: ${animCmd} (${animPartId})`
    }
    default:
      return 'Unknown Action'
  }
}


// Handle select action
function handleSelectAction(action: Action) {
  emit('selectAction', action)
}

// Handle hover action
function handleHoverAction(action: Action) {
  emit('hoverAction', action)
}

// Handle delete action
function handleDeleteAction(action: Action, index: number) {
  // Emit request confirm event to let parent component display confirm dialog
  emit('requestDeleteConfirm', action, index)
}
</script>

<style scoped>
.action-list-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.action-list-header {
  position: relative;
  padding: 12px;
  border-bottom: 1px solid #e5e7eb;
}

.add-action-btn {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 500;
  color: white;
  background: #3b82f6;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.add-action-btn:hover {
  background: #2563eb;
}

.add-action-menu {
  position: absolute;
  top: 100%;
  left: 12px;
  right: 12px;
  margin-top: 4px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
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

.action-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.action-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 4px;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}

.action-item:hover {
  background: #f3f4f6;
  border-color: #d1d5db;
}

.action-item.selected {
  background: #eff6ff;
  border-color: #3b82f6;
}

.action-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #6b7280;
}

.action-icon .duration-bar {
  width: 2px;
  height: 16px;
  background: currentColor;
  border-radius: 1px;
}

.action-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.action-time {
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  font-family: 'Courier New', monospace;
}

.action-target {
  font-size: 12px;
  font-weight: 500;
  color: #374151;
}

.action-description {
  font-size: 11px;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.delete-btn {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 18px;
  line-height: 1;
  color: #9ca3af;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.delete-btn:hover {
  color: #ef4444;
  background: #fef2f2;
}

.empty-state {
  padding: 32px 16px;
  text-align: center;
  color: #9ca3af;
}

.empty-state p {
  margin: 0 0 8px 0;
}

.empty-state .hint {
  font-size: 12px;
  color: #d1d5db;
}
</style>

