<template>
  <div
    class="scene-creation-overlay"
    @click.self="$emit('close')"
  >
    <div class="scene-creation-dialog">
      <div class="dialog-header">
        <h3 class="dialog-title">
          New Scene
        </h3>
        <button
          class="btn-close"
          @click="$emit('close')"
        >
          ✕
        </button>
      </div>

      <div class="dialog-body">
        <div class="creation-mode-group">
          <label
            class="mode-option"
            :class="{ active: mode === 'inherit' }"
          >
            <div class="radio-wrapper">
              <input
                v-model="mode"
                type="radio"
                value="inherit"
                name="creation-mode"
              >
              <span class="mode-title">Continue from Previous Scene (Recommended)</span>
            </div>
            <div
              v-if="mode === 'inherit'"
              class="mode-content"
            >
              <p class="mode-desc">Inherit final state from previous scene (positions, action results), removing exited objects</p>
              <select
                v-model="selectedSourceId"
                class="form-select"
              >
                <option
                  v-for="(scene, index) in scenes"
                  :key="scene.id"
                  :value="scene.id"
                >
                  {{ index + 1 }}. {{ scene.title }}
                </option>
              </select>
            </div>
          </label>

          <label
            class="mode-option"
            :class="{ active: mode === 'copy' }"
          >
            <div class="radio-wrapper">
              <input
                v-model="mode"
                type="radio"
                value="copy"
                name="creation-mode"
              >
              <span class="mode-title">Duplicate Scene Setup</span>
            </div>
            <div
              v-if="mode === 'copy'"
              class="mode-content"
            >
              <p class="mode-desc">Duplicate initial setup of the scene without subsequent action changes</p>
              <select
                v-model="selectedSourceId"
                class="form-select"
              >
                <option
                  v-for="(scene, index) in scenes"
                  :key="scene.id"
                  :value="scene.id"
                >
                  {{ index + 1 }}. {{ scene.title }}
                </option>
              </select>
            </div>
          </label>

          <label
            class="mode-option"
            :class="{ active: mode === 'empty' }"
          >
            <div class="radio-wrapper">
              <input
                v-model="mode"
                type="radio"
                value="empty"
                name="creation-mode"
              >
              <span class="mode-title">Create Blank Scene</span>
            </div>
            <div
              v-if="mode === 'empty'"
              class="mode-content"
            >
              <p class="mode-desc">Create a blank scene without background or characters</p>
            </div>
          </label>
        </div>
      </div>

      <div class="dialog-footer">
        <button
          class="btn-cancel"
          @click="$emit('close')"
        >
          Cancel
        </button>
        <button
          class="btn-confirm"
          @click="handleConfirm"
        >
          Create
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import type { SceneContainer } from '@/types/screenplay'

const props = defineProps<{
  scenes: SceneContainer[]
  defaultSourceId?: string
}>()

const emit = defineEmits<{
  close: []
  confirm: [payload: { mode: 'copy' | 'empty' | 'inherit', sourceId?: string }]
}>()

const mode = ref<'copy' | 'empty' | 'inherit'>('inherit')
const selectedSourceId = ref<string>('')

// Initialize default selected item
watch(() => props.defaultSourceId, (newId) => {
  if (newId) {
    selectedSourceId.value = newId
    mode.value = 'inherit' // Recommend inherit mode by default
  } else if (props.scenes.length > 0) {
    // If no default ID specified but scenes exist, select last by default
    const lastScene = props.scenes[props.scenes.length - 1]
    if (lastScene) {
      selectedSourceId.value = lastScene.id
      mode.value = 'inherit'
    }
  } else {
    // If no scenes exist, can only create empty
    mode.value = 'empty'
  }
}, { immediate: true })

function handleConfirm() {
  if ((mode.value === 'copy' || mode.value === 'inherit') && !selectedSourceId.value) {
    // Fallback to empty mode if copy/inherit mode but no scene selected
    emit('confirm', { mode: 'empty' })
    return
  }
  
  const payload: { mode: 'copy' | 'empty' | 'inherit'; sourceId?: string } = {
    mode: mode.value
  }

  if (mode.value === 'copy' || mode.value === 'inherit') {
    payload.sourceId = selectedSourceId.value
  }

  emit('confirm', payload)
}
</script>

<style scoped>
.scene-creation-overlay {
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

.scene-creation-dialog {
  width: 90%;
  max-width: 480px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid #e5e7eb;
}

.dialog-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.btn-close {
  width: 32px;
  height: 32px;
  border: none;
  background: #f3f4f6;
  font-size: 20px;
  color: #6b7280;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
}

.btn-close:hover {
  background: #e5e7eb;
  color: #1f2937;
}

.dialog-body {
  padding: 24px;
}

.creation-mode-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mode-option {
  display: block;
  padding: 16px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-option:hover {
  border-color: #bfdbfe;
  background: #f9fafb;
}

.mode-option.active {
  border-color: #3b82f6;
  background: #eff6ff;
}

.radio-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}

.radio-wrapper input[type="radio"] {
  width: 18px;
  height: 18px;
  margin: 0;
  cursor: pointer;
}

.mode-title {
  font-size: 16px;
  font-weight: 500;
  color: #1f2937;
}

.mode-content {
  padding-left: 30px;
  margin-top: 8px;
}

.mode-desc {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: #6b7280;
}

.form-select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  color: #1f2937;
  background: white;
}

.form-select:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 24px;
  border-top: 1px solid #e5e7eb;
}

.btn-cancel {
  padding: 10px 20px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  color: #6b7280;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel:hover {
  background: #f9fafb;
}

.btn-confirm {
  padding: 10px 20px;
  background: #3b82f6;
  border: 1px solid #3b82f6;
  border-radius: 6px;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-confirm:hover {
  background: #2563eb;
}
</style>
