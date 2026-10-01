<template>
  <div class="expression-manager">
    <!-- Top toolbar -->
    <div class="toolbar">
      <div class="toolbar-left">
        <h2 class="page-title">
          Expression Management
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

        <div class="type-filters">
          <button 
            v-for="opt in genderOptions"
            :key="opt"
            class="btn-filter-type"
            :class="{ active: currentGenderTag === opt }"
            @click="currentGenderTag = opt"
          >
            {{ opt }}
          </button>
        </div>
      </div>

      <div class="toolbar-right">
        <!-- Sort -->
        <div class="sort-box">
          <select
            v-model="sortOrder"
            class="sort-select"
          >
            <option value="newest">
              📅 Newest
            </option>
            <option value="oldest">
              📅 Oldest
            </option>
          </select>
        </div>

        <!-- Search Box -->
        <div class="search-box">
          <input
            v-model="searchKeyword"
            type="text"
            placeholder="Search expressions..."
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
            class="btn-secondary"
            @click="invertSelection"
          >
            Invert Selection
          </button>
          <button
            class="btn-delete-batch"
            :disabled="selectedIds.size === 0"
            @click="batchDelete"
          >
            🗑️ Delete ({{ selectedIds.size }})
          </button>
        </template>
        <template v-else>
          <button
            class="btn-new"
            @click="openCreateModal"
          >
            + New Expression
          </button>
          <button
            class="btn-import"
            @click="showImportDialog = true"
          >
            📁 Import Expressions
          </button>
        </template>
      </div>
    </div>

    <!-- Expression gallery -->
    <div class="gallery-container">
      <div
        v-if="filteredExpressions.length === 0"
        class="empty-state"
      >
        <p>📭 No expressions yet</p>
        <p class="hint">
          Click "New Expression" to get started
        </p>
      </div>

      <div
        v-else
        class="gallery-grid"
      >
        <div
          v-for="expr in filteredExpressions"
          :key="expr.id"
          class="expression-card"
          :class="{ selected: isBatchMode && selectedIds.has(expr.id) }"
          @click="handleCardClick(expr)"
        >
          <!-- Batch mode checkbox -->
          <div
            v-if="isBatchMode"
            class="card-checkbox"
          >
            <input
              type="checkbox"
              :checked="selectedIds.has(expr.id)"
              @click.stop="toggleSelect(expr.id)"
            >
          </div>

          <!-- Image preview -->
          <div class="card-image">
            <img 
              :src="getImageUrlSync(expr)" 
              :alt="expr.name"
              :style="{ transform: expr.flipHorizontal ? 'scaleX(-1)' : 'none' }"
              @error="handleImageError"
            >
          </div>

          <!-- Card info -->
          <div class="card-info">
            <div class="card-name">
              {{ expr.name }}
            </div>
            <div class="card-meta">
              <span class="card-time">{{ formatTime(expr.createdAt) }}</span>
              <span
                v-if="expr.speakingFrames.length > 0"
                class="card-badge"
              >
                Animated ({{ expr.speakingFrames.length }} frames)
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div
            v-if="!isBatchMode"
            class="card-actions"
          >
            <button
              class="btn-edit"
              title="Edit"
              @click.stop="openEditModal(expr)"
            >
              ✏️
            </button>
            <button
              class="btn-delete"
              title="Delete"
              @click.stop="deleteExpression(expr.id)"
            >
              🗑️
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Batch Footer Removed -->

    <!-- Edit / Create Modal -->
    <ExpressionEditorModal
      v-if="editorModalVisible"
      :visible="editorModalVisible"
      :expression="editingExpression"
      @close="closeEditorModal"
      @saved="handleExpressionSaved"
      @deleted="handleExpressionDeleted"
    />
    <TagSelectDialog
      v-model:visible="showFilterModal"
      :available-tags="availableTags"
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

    <!-- Import Dialog -->
    <ExpressionImportDialog
      v-if="showImportDialog"
      @close="showImportDialog = false"
      @imported="handleImported"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { useAssetImage } from '@/composables/useAssetImage'
import { useExpressionStore } from '@/stores/expressionStore'
import type { Expression } from '@/types/project'

import TagSelectDialog from './common/TagSelectDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import ExpressionEditorModal from './ExpressionEditorModal.vue'
import ExpressionImportDialog from './ExpressionImportDialog.vue'

const expressionStore = useExpressionStore()
const { getImageUrl, preloadImages, clearCache } = useAssetImage()

// Options
const genderOptions = ['All', 'Male', 'Female', 'Other']

// Filter state
const currentGenderTag = ref('All')
const selectedTags = ref<string[]>([])
const searchKeyword = ref('')
const sortOrder = ref<'newest' | 'oldest'>('newest')
const showFilterModal = ref(false)

// Batch management mode
const isBatchMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

// Edit modal
const editorModalVisible = ref(false)
const editingExpression = ref<Expression | null>(null)

// Import dialog
const showImportDialog = ref(false)

// Calculate all available tags (exclude gender tags)
const availableTags = computed(() => {
  const tags = new Set<string>()
  // Include unicode escapes for legacy Chinese tags: \u5168\u90e8, \u7537, \u5973, \u5176\u4ed6
  const genderTags = new Set(['All', 'Male', 'Female', 'Other', '\u5168\u90e8', '\u7537', '\u5973', '\u5176\u4ed6'])
  
  expressionStore.expressionList.forEach(expr => {
    expr.tags.forEach(t => {
      if (!genderTags.has(t)) {
        tags.add(t)
      }
    })
  })
  return Array.from(tags).sort()
})

// Filtered expression list
const filteredExpressions = computed(() => {
  let expressions = expressionStore.expressionList

  // Gender filter
  if (currentGenderTag.value !== 'All' && currentGenderTag.value !== '\u5168\u90e8') {
    const targetGender = currentGenderTag.value
    let mappedGender: 'male' | 'female' | 'other' | undefined
    if (targetGender === 'Male' || targetGender === '\u7537') mappedGender = 'male'
    else if (targetGender === 'Female' || targetGender === '\u5973') mappedGender = 'female'
    else if (targetGender === 'Other' || targetGender === '\u5176\u4ed6') mappedGender = 'other'

    expressions = expressions.filter(expr => {
      const hasTag = expr.tags.includes(targetGender) ||
        (mappedGender === 'male' && expr.tags.includes('\u7537')) ||
        (mappedGender === 'female' && expr.tags.includes('\u5973')) ||
        (mappedGender === 'other' && expr.tags.includes('\u5176\u4ed6'))
      const hasGender = mappedGender && expr.gender === mappedGender
      return hasTag || hasGender
    })
  }

  // Tag filter: Match any selected tag
  if (selectedTags.value.length > 0) {
    expressions = expressions.filter(expr => expr.tags.some(t => selectedTags.value.includes(t)))
  }

  // Search filter
  if (searchKeyword.value.trim()) {
    const keyword = searchKeyword.value.toLowerCase()
    expressions = expressions.filter(expr =>
      expr.name.toLowerCase().includes(keyword)
    )
  }

  // Sort
  return [...expressions].sort((a, b) => {
    if (sortOrder.value === 'newest') {
      return (b.createdAt || 0) - (a.createdAt || 0)
    } else {
      return (a.createdAt || 0) - (b.createdAt || 0)
    }
  })
})

function handleTagsConfirm(tags: string[]) {
  selectedTags.value = tags
}

// Get image URL (synchronous version for template)
function getImageUrlSync(expr: Expression): string {
  return getImageUrl(expr.defaultFrame.url)
}

// Preload images for all expressions
function preloadExpressionImages() {
  const paths = filteredExpressions.value
    .map(expr => expr.defaultFrame.url)
    .filter(url => url && !url.startsWith('blob:') && !url.startsWith('data:'))
  void preloadImages(paths)
}

// Handle image load error
function handleImageError(event: Event) {
  const img = event.target as HTMLImageElement
  if (img) {
    console.warn('[ExpressionManager] Image failed to load:', img.src)
  }
}

// Format time
function formatTime(timestamp?: number): string {
  if (!timestamp) return 'Unknown'
  
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  
  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60))
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60))
      return minutes <= 0 ? 'Just now' : `${minutes}m ago`
    }
    return `${hours}h ago`
  } else if (days === 1) {
    return 'Yesterday ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  } else if (days < 7) {
    return `${days}d ago`
  } else {
    return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })
  }
}

// Batch management mode
function toggleBatchMode() {
  isBatchMode.value = !isBatchMode.value
  selectedIds.value.clear()
}

function selectAll() {
  filteredExpressions.value.forEach(expr => selectedIds.value.add(expr.id))
}

function deselectAll() {
  selectedIds.value.clear()
}

function invertSelection() {
  const currentSet = new Set(selectedIds.value)
  selectedIds.value.clear()
  filteredExpressions.value.forEach(expr => {
    if (!currentSet.has(expr.id)) {
      selectedIds.value.add(expr.id)
    }
  })
}

function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
}

function handleCardClick(expr: Expression) {
  if (isBatchMode.value) {
    toggleSelect(expr.id)
  } else {
    openEditModal(expr)
  }
}

function batchDelete() {
  if (selectedIds.value.size === 0) return
  pendingDeleteIds.value = Array.from(selectedIds.value)
  deleteConfirmTitle.value = 'Batch Delete Expressions'
  deleteConfirmMessage.value = `Are you sure you want to delete the selected ${selectedIds.value.size} expressions? This action cannot be undone!`
  showDeleteConfirm.value = true
}

// Delete Confirmation State
const showDeleteConfirm = ref(false)
const deleteConfirmTitle = ref('')
const deleteConfirmMessage = ref('')
const pendingDeleteIds = ref<string[]>([])

function confirmDelete() {
  if (pendingDeleteIds.value.length > 0) {
    void expressionStore.deleteExpressions(pendingDeleteIds.value)
    if (pendingDeleteIds.value.length > 1) {
      isBatchMode.value = false
      selectedIds.value.clear()
    }
  }
  pendingDeleteIds.value = []
  showDeleteConfirm.value = false
}

// Edit modal
function openCreateModal() {
  editingExpression.value = null
  editorModalVisible.value = true
}

function openEditModal(expr: Expression) {
  editingExpression.value = expr
  editorModalVisible.value = true
}

function closeEditorModal() {
  editorModalVisible.value = false
  editingExpression.value = null
}

function handleExpressionSaved() {
  closeEditorModal()
  clearCache()
  preloadExpressionImages()
}

function handleExpressionDeleted() {
  closeEditorModal()
  clearCache()
  preloadExpressionImages()
}

// Watch filteredExpressions change and preload images
watch(filteredExpressions, () => {
  preloadExpressionImages()
}, { deep: true })

onMounted(() => {
  preloadExpressionImages()
})

// Delete expression
function deleteExpression(id: string) {
  pendingDeleteIds.value = [id]
  deleteConfirmTitle.value = 'Delete Expression'
  deleteConfirmMessage.value = 'Are you sure you want to delete this expression? This action cannot be undone!'
  showDeleteConfirm.value = true
}

// Handle import complete
function handleImported(count: number) {
  console.log(`[ExpressionManager] Successfully imported ${count} expressions`)
  clearCache()
  preloadExpressionImages()
}
</script>

<style scoped>
.expression-manager {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f9fafb;
  overflow: hidden;
}

/* Top toolbar */
.toolbar {
  padding: 16px 24px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
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

.filter-controls {
  display: flex;
  gap: 8px;
}

.type-filters {
  display: flex;
  background: #f3f4f6;
  padding: 4px;
  border-radius: 8px;
}

.btn-filter-type {
  padding: 6px 16px;
  border: none;
  background: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-filter-type.active {
  background: white;
  color: #3b82f6;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

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

.search-box {
  position: relative;
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

.sort-select:hover {
  border-color: #9ca3af;
}

.search-input {
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  width: 200px;
}

.search-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.btn-batch,
.btn-secondary {
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  background: white;
  border-radius: 6px;
  cursor: pointer;
  color: #374151;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-batch:hover,
.btn-secondary:hover {
  background: #f9fafb;
}

.btn-new {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-new:hover {
  background: #2563eb;
}

.btn-import {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-import:hover {
  background: #2563eb;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.filter-modal {
  background: white;
  width: 500px;
  max-width: 90vw;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.2);
  display: flex;
  flex-direction: column;
}

.filter-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.filter-header h3 {
  margin: 0;
  font-size: 16px;
  color: #111827;
}

.close-btn {
  background: none; border: none; font-size: 24px; cursor: pointer; color: #9ca3af;
}

.filter-body {
  padding: 20px;
  max-height: 60vh;
  overflow-y: auto;
}

.tags-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-chip {
  padding: 6px 12px;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 20px;
  font-size: 14px;
  color: #4b5563;
  cursor: pointer;
  transition: all 0.2s;
}

.tag-chip:hover {
  background: #e5e7eb;
  border-color: #d1d5db;
}

.tag-chip.active {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

/* Gallery container */
.gallery-container {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
  font-size: 16px;
}

.empty-state .hint {
  margin-top: 8px;
  font-size: 14px;
  color: #d1d5db;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 20px;
}

.expression-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  display: flex;
  flex-direction: column;
}

.expression-card:hover {
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  transform: translateY(-2px);
}

.expression-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
}

.card-checkbox {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
}

.card-checkbox input[type="checkbox"] {
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.card-image {
  width: 100%;
  aspect-ratio: 1;
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  margin-bottom: 12px;
}

.card-image img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.card-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-name {
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #6b7280;
}

.card-time {
  flex: 1;
}

.card-badge {
  padding: 2px 6px;
  background: #fef3c7;
  color: #92400e;
  border-radius: 3px;
  font-size: 11px;
}

.card-actions {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.expression-card:hover .card-actions {
  opacity: 1;
}

.btn-edit,
.btn-delete {
  width: 28px;
  height: 28px;
  padding: 0;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-edit:hover {
  background: white;
  border-color: #3b82f6;
}

.btn-delete:hover {
  background: #fee2e2;
  border-color: #ef4444;
}

.btn-delete-batch {
  padding: 8px 16px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-delete-batch:disabled {
  background: #fca5a5;
  cursor: not-allowed;
}

.btn-delete-batch:hover:not(:disabled) {
  background: #dc2626;
}
</style>
