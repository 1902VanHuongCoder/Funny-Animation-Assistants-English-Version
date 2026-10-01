<template>
  <div class="scene-object-list">
    <div class="object-list">
      <div
        v-for="obj in sortedObjects"
        :key="obj.id"
        class="object-item"
        :class="{ selected: obj.id === selectedObjectId, dragging: dragState?.draggedId === obj.id }"
        :draggable="enableDrag && obj.type !== 'camera' && !(obj.type === 'light' && (obj as any).lightType === 'ambient')"
        @click="$emit('selectObject', obj.id)"
        @dragstart="handleDragStart($event, obj.id)"
        @dragover.prevent="handleDragOver($event, obj.id)"
        @drop="handleDrop($event, obj.id)"
        @dragend="handleDragEnd"
      >
        <div class="object-info">
          <span class="object-icon">{{ getObjectIcon(obj) }}</span>
          <!-- v7.1: All objects display alias, camera has no alias so displays name -->
          <span class="object-name">{{ getDisplayName(obj) }}</span>
          <!-- Clip-Mask Phase 1: Visual indicator for objects clipped by mask -->
          <span
            v-if="getClippingMaskAlias(obj.id)"
            class="object-clipped-indicator"
            :title="`Clipped by mask &quot;${getClippingMaskAlias(obj.id)}&quot;`"
          >
            ✂
          </span>
        </div>

        <div class="object-actions">
          <!-- v7.1: All non-camera objects can edit alias -->
          <button
            v-if="obj.type !== 'camera' && obj.type !== 'light'"
            class="action-btn"
            title="Edit Alias"
            @click.stop="$emit('editAlias', obj.id)"
          >
            ✏️
          </button>

          <button
            class="action-btn"
            title="Show/Hide"
            @click.stop="handleToggleVisible(obj.id)"
          >
            {{ obj.visible ? '👁️' : '🚫' }}
          </button>
          <button
            v-if="obj.type !== 'camera' && !(obj.type === 'light' && (obj as any).lightType === 'ambient') && !hideDelete"
            class="action-btn danger"
            title="Delete"
            @click.stop="$emit('deleteObject', obj.id)"
          >
            🗑️
          </button>
        </div>
      </div>

      <div
        v-if="objectStore.objects.length === 0"
        class="empty-state"
      >
        <p>No objects</p>
        <p class="hint">
          Click toolbar buttons to add objects
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { type SceneObject, useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { LightObject, MaskObject } from '@/types/sceneObject'
import type { SceneObjectType } from '@/types/sceneObject'

const props = defineProps<{
  selectedObjectId: string | null
  enableDrag?: boolean // Enable drag-and-drop sorting (Setup mode only)
  hideDelete?: boolean // Hide delete button (Action Mode)
}>()

const emit = defineEmits<{
  selectObject: [objectId: string]
  deleteObject: [objectId: string]
  zIndexChanged: [] // Triggered when zIndex changes
  editAlias: [objectId: string] // v7.0: Edit instance alias
}>()

const objectStore = useSceneObjectStore()
const enableDrag = computed(() => props.enableDrag !== false) // Enabled by default

// Dragging state
const dragState = ref<{
  draggedId: string | null
  targetId: string | null
} | null>(null)

// Sort by zIndex descending (displayed from top to bottom)
const sortedObjects = computed(() => {
  return [...objectStore.objects].sort((a, b) => b.zIndex - a.zIndex)
})

/**
 * Get object type icon
 */
function getObjectIcon(obj: SceneObject): string {
  if (obj.type === 'light') {
    const lightType = (obj as LightObject).lightType
    if (lightType === 'ambient') return '🌍'
    if (lightType === 'spot') return '🔦'
  }
  if (obj.type === 'mask') {
    const shape = (obj as unknown as { shape?: string }).shape
    return shape === 'ellipse' ? '⬭' : '▭'
  }
  const icons: Record<SceneObjectType, string> = {
    background: '🖼️',

    camera: '📷',
    text: '📝',
    prop: '🎨',
    audio: '🔊',
    screen_effect: '🌟',
    composite: '🧩',
    symbol: '🧱',
    expression: '😀',
    light: '💡',
    mask: '▭',
  }
  return icons[obj.type] || '❓'
}

/**
 * v7.1: Get object display name (prioritizes alias)
 */
function getDisplayName(obj: SceneObject): string {
  // Camera has no alias, display name directly
  if (obj.type === 'camera') {
    return obj.name || 'Camera'
  }
  if (obj.type === 'light' && (obj as LightObject).lightType === 'ambient') {
    return 'Ambient Light'
  }
  if (obj.type === 'light' && (obj as LightObject).lightType === 'spot') {
    return obj.alias || obj.name || 'Spotlight'
  }
  // Other objects prioritize alias
  const objWithAlias = obj as { alias?: string; name?: string }
  return objWithAlias.alias || obj.name || 'Untitled'
}

/**
 * Clip-Mask Phase 1: Returns which mask clips this object (if any), otherwise empty string.
 * Exclusive single-mask (FCFS), matches at most one.
 */
function getClippingMaskAlias(objectId: string): string {
  for (const o of objectStore.objects) {
    if (o.type !== 'mask') continue
    const mask = o as unknown as MaskObject
    if (mask.targetIds.includes(objectId)) {
      return mask.alias || mask.name || ''
    }
  }
  return ''
}



/**
 * Toggle visibility
 */
function handleToggleVisible(objectId: string) {
  const obj = objectStore.getObject(objectId)
  if (obj) {
    objectStore.updateObject(objectId, { visible: !obj.visible })
  }
}

/**
 * Drag start
 */
function handleDragStart(event: DragEvent, objectId: string) {
  if (!enableDrag.value) return
  
  const obj = objectStore.getObject(objectId)
  if (!obj || obj.type === 'camera') {
    event.preventDefault()
    return
  }
  
  dragState.value = {
    draggedId: objectId,
    targetId: null
  }
  
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', objectId)
  }
}

/**
 * Drag over
 */
function handleDragOver(event: DragEvent, objectId: string) {
  if (!enableDrag.value || !dragState.value) return
  
  const obj = objectStore.getObject(objectId)
  if (!obj || obj.type === 'camera') return
  
  if (dragState.value.draggedId !== objectId) {
    dragState.value.targetId = objectId
    event.dataTransfer!.dropEffect = 'move'
  }
}

/**
 * Drag drop
 */
function handleDrop(event: DragEvent, targetId: string) {
  if (!enableDrag.value || !dragState.value) return
  
  event.preventDefault()
  
  const draggedId = dragState.value.draggedId
  if (!draggedId || draggedId === targetId) return
  
  // 1. Move element position in local array (sorted by zIndex descending)
  const list = [...sortedObjects.value]
  const draggedIndex = list.findIndex(o => o.id === draggedId)
  const targetIndex = list.findIndex(o => o.id === targetId)
  
  if (draggedIndex === -1 || targetIndex === -1) {
    dragState.value = null
    return
  }
  
  // Remove from original position
  const [movedItem] = list.splice(draggedIndex, 1)
  if (movedItem) {
    // Insert into target position
    list.splice(targetIndex, 0, movedItem)
  }
  
  // 2. Reassign zIndex (reverse order: top element obscures bottom, index 0 is top layer)
  // E.g.: total 10, first element zIndex=10, last zIndex=1
  list.forEach((obj, index) => {
    const newZIndex = list.length - index
    if (obj.zIndex !== newZIndex) {
      objectStore.updateObject(obj.id, { zIndex: newZIndex })
    }
  })
  
  emit('zIndexChanged')
  
  dragState.value = null
}

/**
 * Drag end
 */
function handleDragEnd() {
  dragState.value = null
}
</script>

<style scoped>
.scene-object-list {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.panel-header {
  padding: 16px;
  border-bottom: 1px solid #e5e7eb;
}

.panel-header h3 {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
  color: #111827;
}

.object-count {
  font-size: 12px;
  color: #6b7280;
}

.object-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.object-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin-bottom: 4px;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}

.object-item:hover {
  background: #f3f4f6;
  border-color: #d1d5db;
}

.object-item.selected {
  background: #eff6ff;
  border-color: #3b82f6;
}



.object-item.dragging {
  opacity: 0.5;
}

.object-item[draggable="true"] {
  cursor: move;
}

.object-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.object-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.object-name {
  font-size: 13px;
  color: #374151;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.object-clipped-indicator {
  font-size: 12px;
  color: #c97a1f;
  flex-shrink: 0;
  margin-left: 2px;
  cursor: help;
}

.lock-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.object-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.action-btn {
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.action-btn.danger:hover {
  background: #fef2f2;
  border-color: #fca5a5;
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
