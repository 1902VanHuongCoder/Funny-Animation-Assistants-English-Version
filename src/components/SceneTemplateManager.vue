<template>
  <div class="scene-template-manager">
    <!-- Toolbar -->
    <div class="toolbar">
      <div class="toolbar-left">
        <h2 class="page-title">
          Scene Templates
        </h2>
        <div class="filter-controls">
          <button
            class="btn-filter"
            :class="{ active: selectedTags.length > 0 }"
            @click="showFilterModal = true"
          >
            Filter <span v-if="selectedTags.length > 0">({{ selectedTags.length }})</span>
            <span class="icon">▼</span>
          </button>
        </div>
      </div>

      <div class="toolbar-right">
        <div class="sort-box">
          <select
            v-model="sortOrder"
            class="sort-select"
          >
            <option value="newest">
              📅 Newest First
            </option>
            <option value="oldest">
              📅 Oldest First
            </option>
          </select>
        </div>

        <div class="search-box">
          <input
            v-model="searchKeyword"
            type="text"
            placeholder="Search templates..."
            class="search-input"
          >
        </div>

        <button
          class="btn-batch"
          @click="toggleBatchMode"
        >
          {{ isBatchMode ? 'Exit Batch' : '⚙️ Batch Manage' }}
        </button>

        <template v-if="isBatchMode">
          <button
            class="btn-secondary"
            @click="selectAll"
          >
            Select All
          </button>
          <button
            class="btn-secondary"
            @click="deselectAll"
          >
            Deselect All
          </button>
          <button
            class="btn-delete-batch"
            :disabled="selectedIds.size === 0"
            @click="batchDelete"
          >
            Delete ({{ selectedIds.size }})
          </button>
        </template>

        <button
          v-if="!isBatchMode"
          class="btn-create"
          @click="handleCreateTemplate"
        >
          ➕ New Template
        </button>
      </div>
    </div>

    <!-- Main Content -->
    <div class="main-content">
      <!-- Gallery -->
      <div class="gallery-container">
        <div
          v-if="filteredTemplates.length === 0"
          class="empty-state"
        >
          <p>📭 No scene templates</p>
          <p class="hint">
            Click "New Template" to create, or save combined objects as template in the scene editor
          </p>
        </div>

        <div
          v-else
          class="gallery-grid"
        >
          <div
            v-for="tpl in filteredTemplates"
            :key="tpl.id"
            class="template-card"
            :class="{ selected: isBatchMode && selectedIds.has(tpl.id) }"
            @click="handleCardClick(tpl)"
          >
            <!-- Batch Checkbox -->
            <div
              v-if="isBatchMode"
              class="card-checkbox"
            >
              <input
                type="checkbox"
                :checked="selectedIds.has(tpl.id)"
                @click.stop="toggleSelect(tpl.id)"
              >
            </div>

            <!-- Preview -->
            <div class="card-preview">
              <img
                v-if="tpl._runtimeThumbnailUrl"
                :src="tpl._runtimeThumbnailUrl"
                @error="handleImageError"
              >
              <div
                v-else
                class="no-preview"
              >
                🧩
              </div>
              <div class="object-count-badge">
                {{ tpl.objects.length }} objects
              </div>
            </div>

            <!-- Info -->
            <div class="card-info">
              <div
                class="template-name"
                :title="tpl.name"
              >
                {{ tpl.name }}
              </div>
              <div class="template-meta">
                <div class="tags-row">
                  <span
                    v-for="tag in (tpl.tags || []).slice(0, 2)"
                    :key="tag"
                    class="mini-tag"
                  >
                    {{ tag }}
                  </span>
                  <span
                    v-if="(tpl.tags || []).length > 2"
                    class="more-tags"
                  >...</span>
                </div>
                <span class="time-ago">{{ formatTimeAgo(tpl.createdAt) }}</span>
              </div>
            </div>

            <!-- Hover Actions (only edit + delete) -->
            <div
              v-if="!isBatchMode"
              class="card-actions"
            >
              <button
                class="btn-icon edit"
                title="Edit"
                @click.stop="editingTemplateId = tpl.id"
              >
                ✏️
              </button>
              <button
                class="btn-icon delete"
                title="Delete"
                @click.stop="deleteTemplate(tpl.id)"
              >
                🗑️
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tag Select Dialog -->
    <TagSelectDialog
      v-model:visible="showFilterModal"
      :available-tags="allTags"
      :selected-tags="selectedTags"
      @confirm="handleTagsConfirm"
    />

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      v-if="showDeleteConfirm"
      :title="deleteConfirmTitle"
      :message="deleteConfirmMessage"
      :is-danger="true"
      @confirm="confirmDelete"
      @cancel="showDeleteConfirm = false"
    />

    <!-- Editor (overlay dialog mode) -->
    <SceneTemplateEditor
      v-if="editingTemplateId"
      v-bind="editingTemplateId !== '__new__' ? { 'template-id': editingTemplateId } : {}"
      @close="editingTemplateId = null"
      @saved="handleEditorSaved"
      @created="handleEditorCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useSceneTemplateStore } from '@/stores/sceneTemplateStore'
import type { SceneTemplate } from '@/types/sceneTemplate'

import TagSelectDialog from './common/TagSelectDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import SceneTemplateEditor from './SceneTemplateEditor.vue'

const templateStore = useSceneTemplateStore()

// State
const selectedTags = ref<string[]>([])
const searchKeyword = ref('')
const sortOrder = ref<'newest' | 'oldest'>('newest')
const isBatchMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const showFilterModal = ref(false)

// Editor state (overlay mode, does not replace list)
const editingTemplateId = ref<string | null>(null)

const allTags = computed(() => templateStore.allTags)

function handleTagsConfirm(tags: string[]) {
  selectedTags.value = tags
}

const filteredTemplates = computed(() => {
  let list = templateStore.templates

  if (selectedTags.value.length > 0) {
    list = list.filter(t => t.tags?.some(tag => selectedTags.value.includes(tag)))
  }

  if (searchKeyword.value.trim()) {
    const kw = searchKeyword.value.toLowerCase()
    list = list.filter(t => t.name.toLowerCase().includes(kw))
  }

  return [...list].sort((a, b) => {
    if (sortOrder.value === 'newest') {
      return b.createdAt - a.createdAt
    } else {
      return a.createdAt - b.createdAt
    }
  })
})

// Methods
function handleImageError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none'
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function handleCardClick(tpl: SceneTemplate) {
  if (isBatchMode.value) {
    toggleSelect(tpl.id)
  } else {
    // Click to edit
    editingTemplateId.value = tpl.id
  }
}

function handleEditorSaved() {
  editingTemplateId.value = null
}

/**
 * Create new template: open empty scene template editor
 */
function handleCreateTemplate() {
  editingTemplateId.value = '__new__'
}

function handleEditorCreated(newTemplateId: string) {
  // Update editingTemplateId after first save
  editingTemplateId.value = newTemplateId
}

function deleteTemplate(id: string) {
  pendingDeleteIds.value = [id]
  deleteConfirmTitle.value = 'Delete Template'
  deleteConfirmMessage.value = 'Are you sure you want to delete this scene template? This action cannot be undone.'
  showDeleteConfirm.value = true
}

// Delete Confirmation State
const showDeleteConfirm = ref(false)
const deleteConfirmTitle = ref('')
const deleteConfirmMessage = ref('')
const pendingDeleteIds = ref<string[]>([])

function confirmDelete() {
  pendingDeleteIds.value.forEach(id => templateStore.deleteTemplate(id))
  if (pendingDeleteIds.value.length > 1) {
    selectedIds.value.clear()
    isBatchMode.value = false
  }
  pendingDeleteIds.value = []
  showDeleteConfirm.value = false
}

// Batch Logic
function toggleBatchMode() {
  isBatchMode.value = !isBatchMode.value
  selectedIds.value.clear()
}

function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id)
  else selectedIds.value.add(id)
}

function batchDelete() {
  pendingDeleteIds.value = Array.from(selectedIds.value)
  deleteConfirmTitle.value = 'Batch Delete Templates'
  deleteConfirmMessage.value = `Are you sure you want to delete ${selectedIds.value.size} scene templates? This action cannot be undone.`
  showDeleteConfirm.value = true
}

function selectAll() {
  filteredTemplates.value.forEach(t => selectedIds.value.add(t.id))
}

function deselectAll() {
  selectedIds.value.clear()
}
</script>

<style scoped>
.scene-template-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f9fafb;
}

.toolbar {
  padding: 16px 24px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 24px;
}

.page-title {
  margin: 0;
  font-size: 18px;
  color: #111827;
}

.filter-controls { display: flex; gap: 8px; }

.btn-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid #d1d5db;
  background: white;
  border-radius: 6px;
  color: #374151;
  cursor: pointer;
  font-size: 14px;
}
.btn-filter.active { border-color: #3b82f6; color: #3b82f6; background: #eff6ff; }

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-create {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.2s;
}

.btn-create:hover {
  background: #2563eb;
}

.search-input {
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  width: 200px;
}

.sort-select {
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
  color: #374151;
  font-size: 14px;
  cursor: pointer;
  outline: none;
}

.btn-batch, .btn-secondary {
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  background: white;
  border-radius: 6px;
  cursor: pointer;
}

.btn-delete-batch {
  padding: 8px 16px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.gallery-container {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 20px;
}

.template-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  position: relative;
  transition: all 0.2s;
}

.template-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
}

.template-card.selected {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.card-checkbox {
  position: absolute;
  top: 8px; left: 8px;
  z-index: 10;
}

.card-preview {
  height: 140px;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 10px;
}

.card-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.no-preview {
  font-size: 48px;
  opacity: 0.3;
}

.object-count-badge {
  position: absolute;
  bottom: 4px; right: 4px;
  background: rgba(0,0,0,0.6);
  color: white;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
}

.card-info { padding: 10px; }

.template-name {
  font-weight: 500;
  font-size: 14px;
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.template-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.tags-row { display: flex; gap: 4px; }

.mini-tag {
  background: #f3f4f6;
  color: #6b7280;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
}

.more-tags {
  color: #9ca3af;
  font-size: 10px;
}

.time-ago {
  color: #9ca3af;
  font-size: 10px;
}

.card-actions {
  position: absolute;
  top: 8px; right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.template-card:hover .card-actions { opacity: 1; }

.btn-icon {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: rgba(255,255,255,0.9);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
</style>
