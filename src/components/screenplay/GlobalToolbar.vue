<template>
  <div class="global-toolbar">
    <!-- Left: Title + Add button -->
    <div class="toolbar-left">
      <h2 class="page-title">
        Script Editor
      </h2>
      
      <div class="toolbar-divider" />
      
      <button
        class="toolbar-btn"
        title="Add Scene"
        @click="$emit('addScene')"
      >
        ➕ Scene
      </button>
      <button
        class="toolbar-btn"
        title="Add Dialogue"
        @click="$emit('addDialogue')"
      >
        ➕ Dialogue
      </button>
      <button
        class="toolbar-btn"
        title="Add Narration"
        @click="$emit('addNarration')"
      >
        ➕ Narration
      </button>
      
      <div class="toolbar-divider" />
      
      <button
        class="toolbar-btn"
        title="Narrator Settings"
        @click="$emit('editNarrator')"
      >
        👤 Narrator
      </button>
      <button
        class="toolbar-btn"
        title="Actor Settings"
        @click="$emit('manageActors')"
      >
        👥 Actors
      </button>
      
      <div class="toolbar-divider" />
      
      <!-- Animation name editing -->
      <div class="episode-name-editor">
        <label class="name-label">Episode Name:</label>
        <input 
          type="text" 
          :value="episodeName" 
          class="name-input"
          placeholder="Enter episode name"
          @input="$emit('update:episodeName', ($event.target as HTMLInputElement).value)"
        >
      </div>
    </div>

    <!-- Right: Action buttons -->
    <div class="toolbar-right">
      <button
        class="toolbar-btn"
        title="Save (Ctrl+S)"
        @click="$emit('save')"
      >
        💾 Save
      </button>
      <button
        class="toolbar-btn"
        title="Preview"
        @click="$emit('preview')"
      >
        🎬 Preview
      </button>
      <button
        class="toolbar-btn btn-primary"
        title="Export"
        @click="$emit('export')"
      >
        📤 Export
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  episodeName?: string
}>()

defineEmits<{
  addScene: []
  addDialogue: []
  addNarration: []
  editNarrator: []
  manageActors: []
  'update:episodeName': [value: string]
  save: []
  preview: []
  export: []
}>()
</script>

<style scoped>
.global-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: white;
  border-bottom: 2px solid #e5e7eb;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toolbar-divider {
  width: 1px;
  height: 24px;
  background: #d1d5db;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.toolbar-right {
  display: flex;
  gap: 12px;
}

.toolbar-btn {
  padding: 8px 16px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.toolbar-btn:hover {
  background: #f9fafb;
  border-color: #9ca3af;
}

.toolbar-btn.btn-primary {
  background: #3b82f6;
  border-color: #3b82f6;
  color: white;
}

.toolbar-btn.btn-primary:hover {
  background: #2563eb;
  border-color: #2563eb;
}

.episode-name-editor {
  display: flex;
  align-items: center;
  gap: 8px;
}

.name-label {
  font-size: 14px;
  color: #6b7280;
  white-space: nowrap;
}

.name-input {
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  color: #1f2937;
  width: 200px;
  transition: all 0.2s;
}

.name-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.name-input::placeholder {
  color: #9ca3af;
}
</style>
