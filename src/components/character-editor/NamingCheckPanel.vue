<template>
  <Teleport to="body">
    <div
      class="modal-overlay"
      @click.self="emit('close')"
    >
      <div class="modal-container">
        <div class="modal-header">
          <div>
            <h3>Preset Name Check</h3>
            <p>Ensures character part names can be reliably recognized by preset actions.</p>
          </div>
          <button
            class="btn-close"
            @click="emit('close')"
          >×</button>
        </div>

        <div class="modal-body">
          <div
            v-if="!rootCompositeId"
            class="empty-state"
          >
            Character root composite object not set, cannot run checks.
          </div>
          <template v-else>
            <div class="summary-grid">
              <div class="summary-card">
                <span class="summary-value">{{ coveredRecommendedCount }}/{{ recommendedNameTotal }}</span>
                <span class="summary-label">Covered Recommended</span>
              </div>
              <div class="summary-card" :class="{ warn: duplicateAliases.length > 0 }">
                <span class="summary-value">{{ duplicateAliases.length }}</span>
                <span class="summary-label">Duplicate Aliases</span>
              </div>
              <div class="summary-card" :class="{ warn: nonStandard.length > 0 }">
                <span class="summary-value">{{ nonStandard.length }}</span>
                <span class="summary-label">Fixable Names</span>
              </div>
            </div>

            <!-- D1 Duplicate alias -->
            <section class="section">
              <div
                class="section-header"
                :class="duplicateAliases.length > 0 ? 'danger' : 'success'"
              >
                <span class="section-icon">{{ duplicateAliases.length > 0 ? '⛔' : '✅' }}</span>
                <span>Duplicate Preset Names</span>
                <span class="section-count">{{ duplicateAliases.length }}</span>
              </div>
              <div
                v-if="duplicateAliases.length === 0"
                class="section-hint"
              >
                No duplicate names found.
              </div>
              <ul
                v-else
                class="entry-list"
              >
                <li
                  v-for="entry in duplicateAliases"
                  :key="entry.alias"
                  class="entry-item"
                >
                  <div class="entry-title">"{{ entry.alias }}" is shared by {{ entry.objectIds.length }} objects</div>
                  <div class="entry-sub">
                    <span
                      v-for="oid in entry.objectIds"
                      :key="oid"
                      class="id-tag"
                    >{{ objectDisplayName(oid) }}</span>
                  </div>
                </li>
              </ul>
            </section>

            <!-- D2 Missing recommended names -->
            <section class="section">
              <div
                class="section-header"
                :class="missingRecommended.length > 0 ? 'warning' : 'success'"
              >
                <span class="section-icon">{{ missingRecommended.length > 0 ? '⚠️' : '✅' }}</span>
                <span>Missing Preset Names</span>
                <span class="section-count">{{ missingRecommended.length }}</span>
              </div>
              <div
                v-if="missingRecommended.length === 0"
                class="section-hint"
              >
                All {{ recommendedNameTotal }} system recommended names are covered.
              </div>
              <div
                v-else
                class="missing-name-list"
              >
                <div
                  v-for="m in missingRecommended"
                  :key="m.recommendedName"
                  class="missing-name-row"
                >
                  <span class="match-tag missing">{{ m.recommendedName }}</span>
                  <select
                    class="object-select"
                    :value="missingAssignments[m.recommendedName] ?? ''"
                    @change="missingAssignments = { ...missingAssignments, [m.recommendedName]: ($event.target as HTMLSelectElement).value }"
                  >
                    <option value="">Select object to assign this name...</option>
                    <option
                      v-for="opt in assignableObjectOptions"
                      :key="opt.id"
                      :value="opt.id"
                    >
                      {{ opt.label }}
                    </option>
                  </select>
                  <button
                    class="btn-apply"
                    :disabled="!missingAssignments[m.recommendedName]"
                    @click="applyMissingRecommendedName(m.recommendedName)"
                  >
                    Apply
                  </button>
                </div>
              </div>
              <div class="section-hint subtle">
                Can be ignored if character lacks corresponding part; detailed actions prioritize fine-grained names and fallback to coarse names in system templates.
              </div>
            </section>

            <!-- D3 Non-standard naming -->
            <section class="section">
              <div
                class="section-header"
                :class="nonStandard.length > 0 ? 'warning' : 'success'"
              >
                <span class="section-icon">{{ nonStandard.length > 0 ? '📝' : '✅' }}</span>
                <span>Similar but Non-Standard Names</span>
                <span class="section-count">{{ nonStandard.length }}</span>
              </div>
              <div
                v-if="nonStandard.length > 1"
                class="section-toolbar"
              >
                <button
                  class="btn-apply"
                  @click="applyAllSuggestions"
                >
                  Apply All Suggestions
                </button>
              </div>
              <div
                v-if="nonStandard.length === 0"
                class="section-hint"
              >
                No objects with similar but non-standard names found.
              </div>
              <ul
                v-else
                class="entry-list"
              >
                <li
                  v-for="entry in nonStandard"
                  :key="entry.objectId + entry.field"
                  class="entry-item"
                >
                  <div class="entry-title">
                    <strong>{{ objectDisplayName(entry.objectId) }}</strong>
                     {{ entry.field === 'alias' ? 'Alias' : 'Name' }}
                    "<em>{{ entry.value }}</em>"
                    →
                    Suggested
                    "<strong>{{ entry.suggested }}</strong>"
                  </div>
                  <div class="entry-actions">
                    <button
                      class="btn-apply"
                      @click="applySuggestion(entry)"
                    >Apply Suggestion</button>
                    <button
                      class="btn-secondary"
                      @click="handleSelectObject(entry.objectId)"
                    >Locate Object</button>
                  </div>
                </li>
              </ul>
            </section>
          </template>
        </div>

        <div class="modal-footer">
          <button
            class="btn-secondary"
            @click="emit('close')"
          >Close</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { RECOMMENDED_NAMES } from '@/constants/recommendedNames'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { SceneObject } from '@/types/sceneObject'
import {
  findDuplicateAliases,
  findMissingRecommendedNames,
  findNonStandardNames,
  type NonStandardNameEntry,
} from '@/utils/namingDiagnostics'
import { collectSubtreeIds } from '@/utils/presetAnimationMapper'

const props = defineProps<{
  rootCompositeId?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update-alias', objectId: string, newAlias: string): void
  (e: 'update-name', objectId: string, newName: string): void
  (e: 'select-object', objectId: string): void
}>()

const sceneObjectStore = useSceneObjectStore()
const missingAssignments = ref<Record<string, string>>({})
const recommendedNameTotal = RECOMMENDED_NAMES.length

const sceneObjectsMap = computed<Map<string, SceneObject>>(() => {
  const m = new Map<string, SceneObject>()
  for (const obj of sceneObjectStore.objects) m.set(obj.id, obj)
  return m
})

const duplicateAliases = computed(() =>
  props.rootCompositeId
    ? findDuplicateAliases(props.rootCompositeId, sceneObjectsMap.value)
    : [],
)

const missingRecommended = computed(() =>
  props.rootCompositeId
    ? findMissingRecommendedNames(props.rootCompositeId, sceneObjectsMap.value)
    : [],
)

const nonStandard = computed(() =>
  props.rootCompositeId
    ? findNonStandardNames(props.rootCompositeId, sceneObjectsMap.value)
    : [],
)

const coveredRecommendedCount = computed(() => RECOMMENDED_NAMES.length - missingRecommended.value.length)

const assignableObjectOptions = computed(() => {
  if (!props.rootCompositeId) return []
  const subtreeIds = collectSubtreeIds(props.rootCompositeId, sceneObjectsMap.value)
  const out: { id: string; label: string }[] = []
  for (const id of subtreeIds) {
    const obj = sceneObjectsMap.value.get(id)
    if (!obj) continue
    if (obj.type === 'camera') continue
    out.push({ id: obj.id, label: objectDisplayName(obj.id) })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
})

function objectDisplayName(objectId: string): string {
  const obj = sceneObjectStore.getObject(objectId)
  if (!obj) return objectId.slice(0, 8)
  return obj.alias ?? obj.name ?? objectId.slice(0, 8)
}

function applySuggestion(entry: NonStandardNameEntry): void {
  if (entry.field === 'alias') {
    emit('update-alias', entry.objectId, entry.suggested)
  } else {
    emit('update-name', entry.objectId, entry.suggested)
  }
}

function applyAllSuggestions(): void {
  for (const entry of nonStandard.value) {
    applySuggestion(entry)
  }
}

function applyMissingRecommendedName(recommendedName: string): void {
  const objectId = missingAssignments.value[recommendedName]
  if (!objectId) return
  emit('update-alias', objectId, recommendedName)
  emit('select-object', objectId)
  const next = { ...missingAssignments.value }
  delete next[recommendedName]
  missingAssignments.value = next
}

function handleSelectObject(objectId: string): void {
  emit('select-object', objectId)
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal-container {
  background: #fff;
  width: 600px;
  max-width: 92vw;
  max-height: 85vh;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.modal-header h3 { margin: 0; font-size: 16px; }
.modal-header p {
  margin: 3px 0 0;
  color: #6b7280;
  font-size: 12px;
}

.btn-close {
  background: transparent;
  border: none;
  font-size: 22px;
  cursor: pointer;
  line-height: 1;
  color: #6b7280;
}
.btn-close:hover { color: #111827; }

.modal-body {
  padding: 12px 16px;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px;
  border-top: 1px solid #e5e7eb;
}

.section {
  margin-bottom: 18px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px;
  border: 1px solid #d1fae5;
  border-radius: 6px;
  background: #ecfdf5;
}

.summary-card.warn {
  border-color: #fde68a;
  background: #fffbeb;
}

.summary-value {
  font-size: 18px;
  font-weight: 700;
  color: #065f46;
}

.summary-card.warn .summary-value {
  color: #92400e;
}

.summary-label {
  font-size: 12px;
  color: #4b5563;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
  padding: 6px 8px;
  border-radius: 4px;
  margin-bottom: 6px;
}
.section-header.success { background: #ecfdf5; color: #065f46; }
.section-header.warning { background: #fffbeb; color: #92400e; }
.section-header.danger  { background: #fef2f2; color: #991b1b; }
.section-count {
  margin-left: auto;
  font-weight: 500;
  font-size: 12px;
  background: rgba(0,0,0,0.08);
  padding: 1px 8px;
  border-radius: 999px;
}

.section-hint {
  font-size: 12px;
  color: #4b5563;
  padding: 4px 8px;
}
.section-hint.subtle { color: #9ca3af; font-style: italic; }
.section-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 0 8px 8px;
}

.entry-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.entry-item {
  padding: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  margin-bottom: 6px;
  background: #fafafa;
}
.entry-title { font-size: 13px; color: #111827; }
.entry-sub { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }
.id-tag {
  font-size: 11px;
  background: #e5e7eb;
  padding: 2px 6px;
  border-radius: 3px;
}
.entry-actions {
  margin-top: 6px;
  display: flex;
  gap: 8px;
}

.btn-apply, .btn-secondary {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
}
.btn-apply {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.btn-apply:hover { background: #1d4ed8; }
.btn-apply:disabled {
  opacity: 0.45;
  cursor: default;
}
.btn-secondary:hover { background: #f3f4f6; }

.tag-list { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 8px; }
.missing-name-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 8px;
}

.missing-name-row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.object-select {
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  color: #374151;
  font-size: 12px;
}

.match-tag {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 3px;
}
.match-tag.missing { background: #fef3c7; color: #92400e; }

.empty-state {
  color: #6b7280;
  padding: 20px;
  text-align: center;
  font-size: 13px;
}
</style>
