<!--
  PassThroughPanel.vue - Pass-through management popup panel
  
  Displays all objects in the current pass-through list, supports:
  - Toggle object visible (pass-through + visible / pass-through + hidden)
  - Remove from pass-through list (restore pickable)
  - Click object to select
-->
<template>
  <div ref="panelRef" class="pass-through-panel" @click.stop>
    <div class="panel-header">
      <span class="panel-title">👻 Pass-through Management</span>
    </div>
    <div class="panel-content">
      <div v-if="entries.length === 0" class="empty-hint">
        <span class="hint-icon">💡</span>
        <span class="hint-text">No pass-through objects<br>Select an object in Properties panel, then click "Set Pass-through" to add</span>
      </div>
      <div
        v-for="entry in entries"
        :key="entry.objectId"
        class="pass-through-item"
        @click="emit('selectObject', entry.objectId)"
      >
        <span class="item-icon">{{ entry.icon }}</span>
        <span class="item-name">{{ entry.name }}</span>
        <span v-if="entry.isDefault" class="item-default-badge">Default</span>
        <div class="item-actions">
          <button
            class="item-btn"
            :class="{ 'is-hidden': !entry.visible }"
            :title="entry.visible ? 'Click to hide' : 'Click to show'"
            @click.stop="emit('toggleVisible', entry.objectId)"
          >
            {{ entry.visible ? '👁️' : '🚫' }}
          </button>
          <button
            class="item-btn remove"
            title="Remove pass-through"
            @click.stop="emit('remove', entry.objectId)"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

interface PassThroughPanelEntry {
  objectId: string
  name: string
  icon: string
  visible: boolean
  isDefault: boolean
}

defineProps<{
  entries: PassThroughPanelEntry[]
}>()

const emit = defineEmits<{
  remove: [objectId: string]
  toggleVisible: [objectId: string]
  selectObject: [objectId: string]
  close: []
}>()

const panelRef = ref<HTMLElement | null>(null)

function handleDocumentPointerDown(event: PointerEvent) {
  const panel = panelRef.value
  const target = event.target
  if (!panel || !(target instanceof Node)) return
  if (panel.contains(target)) return
  emit('close')
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
})
</script>

<style scoped>
.pass-through-panel {
  position: absolute;
  top: 125%;
  right: 0;
  min-width: 240px;
  max-width: 320px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 200;
  overflow: hidden;
}

.panel-header {
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
  background: #f9fafb;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.panel-content {
  max-height: 280px;
  overflow-y: auto;
}

.empty-hint {
  padding: 16px 12px;
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
  line-height: 1.6;
}

.empty-hint .hint-icon {
  display: block;
  font-size: 20px;
  margin-bottom: 6px;
}

.pass-through-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  cursor: pointer;
  transition: background-color 0.15s;
  border-bottom: 1px solid #f3f4f6;
}

.pass-through-item:last-child {
  border-bottom: none;
}

.pass-through-item:hover {
  background: #f0f5ff;
}

.item-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.item-name {
  flex: 1;
  font-size: 12px;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-default-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #dbeafe;
  color: #2563eb;
  flex-shrink: 0;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.item-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s;
}

.item-btn:hover {
  background: #e5e7eb;
}

.item-btn.is-hidden {
  opacity: 0.5;
}

.item-btn.remove {
  color: #6b7280;
  font-size: 11px;
}

.item-btn.remove:hover {
  background: #fee2e2;
  color: #dc2626;
}
</style>
