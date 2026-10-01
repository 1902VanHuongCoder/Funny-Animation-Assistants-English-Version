<template>
  <div
    class="instance-alias-overlay"
    @click.self="handleCancel"
  >
    <div class="instance-alias-dialog">
      <div class="dialog-header">
        <h3 class="dialog-title">
          Set {{ objectTypeLabel }} Name
        </h3>
        <button
          class="btn-close"
          @click="handleCancel"
        >
          ✕
        </button>
      </div>

      <div class="dialog-body">
        <div class="actor-info">
          <div class="actor-avatar">
            <span class="avatar-icon">{{ objectTypeIcon }}</span>
          </div>
          <div class="actor-details">
            <div class="actor-name">
              {{ actorName }}
            </div>
            <div class="actor-hint">
              {{ isEditMode ? `Edit ${objectTypeLabel} name` : `Adding this ${objectTypeLabel} to scene` }}
            </div>
          </div>
        </div>

        <div class="form-group">
          <label>{{ objectTypeLabel }} Name</label>
          <input
            ref="aliasInput"
            v-model="aliasValue"
            type="text"
            :placeholder="`Enter ${objectTypeLabel} name in scene`"
            @input="validateAlias"
            @keyup.enter="handleConfirm"
          >
          <div
            v-if="errorMessage"
            class="error-message"
          >
            {{ errorMessage }}
          </div>
          <div class="hint-text">
            Names are used to identify objects in the scene and must be unique within the same scene
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button
          class="btn-cancel"
          @click="handleCancel"
        >
          Cancel
        </button>
        <button
          class="btn-confirm"
          :disabled="!!errorMessage || !aliasValue.trim()"
          @click="handleConfirm"
        >
          Confirm
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed,onMounted, ref, watch } from 'vue'

const props = defineProps<{
  actorName: string
  suggestedAlias: string
  existingAliases: string[]
  currentAlias?: string  // v7.0: Current alias in edit mode
  objectType?: 'character' | 'background' | 'bgm' | 'prop' | 'text'  // v7.1: Object type
}>()

const emit = defineEmits<{
  confirm: [alias: string]
  cancel: []
}>()

const aliasInput = ref<HTMLInputElement>()
const aliasValue = ref('')
const errorMessage = ref('')

// v7.0: Determine if in edit mode
const isEditMode = computed(() => !!props.currentAlias)

// v7.1: Get label and icon based on object type
const objectTypeLabel = computed(() => {
  const labels: Record<string, string> = {
    character: 'Character',
    background: 'Background',
    bgm: 'Background Music',
    prop: 'Prop',
    text: 'Text'
  }
  return labels[props.objectType ?? 'character'] ?? 'Object'
})

const objectTypeIcon = computed(() => {
  const icons: Record<string, string> = {
    character: '👤',
    background: '🖼️',
    bgm: '🎵',
    prop: '🎨',
    text: '📝'
  }
  return icons[props.objectType ?? 'character'] ?? '❓'
})

onMounted(() => {
  aliasValue.value = props.suggestedAlias
  // Auto focus and select
  setTimeout(() => {
    aliasInput.value?.focus()
    aliasInput.value?.select()
  }, 100)
})

watch(() => props.suggestedAlias, (newVal) => {
  aliasValue.value = newVal
})

function validateAlias() {
  const trimmed = aliasValue.value.trim()
  
  if (!trimmed) {
    errorMessage.value = 'Name cannot be empty'
    return false
  }
  
  // v7.0: Check if duplicate with existing aliases (exclude current alias in edit mode)
  const aliasesToCheck = isEditMode.value 
    ? props.existingAliases.filter(a => a !== props.currentAlias)
    : props.existingAliases
  
  if (aliasesToCheck.includes(trimmed)) {
    errorMessage.value = `Name "${trimmed}" is already in use, please choose another`
    return false
  }
  
  errorMessage.value = ''
  return true
}

function handleConfirm() {
  if (validateAlias()) {
    emit('confirm', aliasValue.value.trim())
  }
}

function handleCancel() {
  emit('cancel')
}
</script>

<style scoped>
.instance-alias-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.instance-alias-dialog {
  background: white;
  border-radius: 12px;
  width: 400px;
  max-width: 90%;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e7eb;
}

.dialog-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.btn-close {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #6b7280;
  padding: 4px 8px;
  border-radius: 4px;
}

.btn-close:hover {
  background: #f3f4f6;
  color: #374151;
}

.dialog-body {
  padding: 20px;
}

.actor-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #f9fafb;
  border-radius: 8px;
  margin-bottom: 20px;
}

.actor-avatar {
  width: 48px;
  height: 48px;
  background: #e5e7eb;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-icon {
  font-size: 24px;
}

.actor-details {
  flex: 1;
}

.actor-name {
  font-weight: 600;
  color: #1f2937;
  font-size: 14px;
}

.actor-hint {
  color: #6b7280;
  font-size: 12px;
  margin-top: 2px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: #374151;
  font-size: 14px;
}

.form-group input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}

.form-group input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.error-message {
  color: #dc2626;
  font-size: 12px;
  margin-top: 6px;
}

.hint-text {
  color: #6b7280;
  font-size: 12px;
  margin-top: 6px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid #e5e7eb;
}

.btn-cancel,
.btn-confirm {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-cancel {
  background: white;
  border: 1px solid #d1d5db;
  color: #374151;
}

.btn-cancel:hover {
  background: #f9fafb;
}

.btn-confirm {
  background: #3b82f6;
  border: 1px solid #3b82f6;
  color: white;
}

.btn-confirm:hover:not(:disabled) {
  background: #2563eb;
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
