<template>
  <div
    class="scene-container-header"
    :class="{ selected: isSelected }"
    @click="handleClick"
  >
    <div class="header-content">
      <!-- Expand/Collapse icon -->
      <span 
        class="toggle-icon" 
        :title="isExpanded ? 'Collapse' : 'Expand'"
      >
        {{ isExpanded ? '▼' : '▶' }}
      </span>
      
      <span class="scene-icon">🎬</span>
      <input
        v-model="localTitle"
        class="scene-title-input"
        placeholder="Scene title..."
        @blur="handleTitleBlur"
        @click.stop
      >
      
      <!-- Display block count -->
      <span
        v-if="blockCount && blockCount > 0"
        class="block-count"
      >
        {{ blockCount }} block(s)
      </span>
      
      <!-- Spacer to push buttons to right -->
      <div style="flex: 1;" />
      
      <!-- Move up/down button group -->
      <div class="move-buttons" @click.stop>
        <button
          class="btn-move"
          title="Move scene up"
          :disabled="!canMoveUp"
          @click="$emit('move-up')"
        >
          ↑
        </button>
        <button
          class="btn-move"
          title="Move scene down"
          :disabled="!canMoveDown"
          @click="$emit('move-down')"
        >
          ↓
        </button>
      </div>
      
      <button
        class="btn-preview"
        title="Preview Scene"
        @click.stop="handlePreviewScene"
      >
        ▶️ Preview Scene
      </button>
      <button
        class="btn-setup"
        title="Edit Scene Setup"
        @click.stop="handleEnterSetupMode"
      >
        🏗️ Edit Scene Setup
      </button>
      <button
        class="btn-delete"
        title="Delete Scene"
        @click.stop="$emit('delete')"
      >
        🗑️
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import type { SceneContainer } from '@/types/screenplay'

const props = defineProps<{
  scene: SceneContainer
  isSelected?: boolean
  isExpanded?: boolean
  blockCount?: number
  canMoveUp?: boolean
  canMoveDown?: boolean
}>()

const emit = defineEmits<{
  select: []
  delete: []
  'toggle-expand': []
  'enter-setup-mode': []
  'preview-scene': []
  'update-title': [title: string]
  'move-up': []
  'move-down': []
}>()

const localTitle = ref(props.scene.title)

watch(() => props.scene.title, (newTitle) => {
  localTitle.value = newTitle
})

function handleClick() {
  // Toggle expand/collapse state when clicking scene container
  emit('toggle-expand')
  // Simultaneously select scene
  emit('select')
}

function handleTitleBlur() {
  if (localTitle.value !== props.scene.title) {
    emit('update-title', localTitle.value)
  }
}

function handleEnterSetupMode() {
  emit('enter-setup-mode')
}

function handlePreviewScene() {
  emit('preview-scene')
}
</script>

<style scoped>
.scene-container-header {
  background: #ffffff;
  /* 1. Change default border to gray */
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  /* Subtle default shadow */
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  cursor: pointer;
  transition: all 0.2s;
}

.scene-container-header:hover {
  /* Slightly darker border on hover for interactivity hint */
  border-color: #9ca3af;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.1);
}

.scene-container-header.selected {
  /* 2. Blue border when selected */
  border-color: #3b82f6;
  /* 3. Light blue background when selected */
  background-color: #eff6ff;
  /* Enhanced shadow */
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
}

.header-content {
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
}

.toggle-icon {
  width: 20px;
  height: 20px;
  font-size: 12px;
  color: #6b7280;
  transition: color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  user-select: none;
}

.scene-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.scene-title-input {
  flex: 0.5;
  max-width: 200px;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 14px;
  font-weight: 600;
  background: #f9fafb;
  transition: all 0.2s;
}

.block-count {
  padding: 4px 8px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 4px;
  font-size: 12px;
  color: #1e40af;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.scene-title-input:focus {
  outline: none;
  border-color: #3b82f6;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

/* Move up/down button group */
.move-buttons {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.btn-move {
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #6b7280;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  color: #ffffff;
  transition: all 0.2s;
  line-height: 1;
}

.btn-move:hover:not(:disabled) {
  background: #4b5563;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(107, 114, 128, 0.3);
}

.btn-move:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.btn-preview {
  padding: 6px 12px;
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-preview:hover {
  background: linear-gradient(135deg, #7c3aed, #4f46e5);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(139, 92, 246, 0.4);
}

.btn-setup {
  padding: 6px 12px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-setup:hover {
  background: #2563eb;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
}

.btn-delete {
  padding: 6px 10px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-delete:hover {
  background: #dc2626;
  transform: translateY(-1px);
}
</style>
