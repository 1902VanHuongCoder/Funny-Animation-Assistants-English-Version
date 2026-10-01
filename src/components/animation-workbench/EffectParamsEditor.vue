<template>
  <div class="effect-params-editor">
    <!-- Current type + Change button -->
    <div class="field-row">
      <label>Type</label>
      <div class="type-selector">
        <span class="current-type" :class="{ unsupported: currentUnsupportedReason }" :title="currentUnsupportedReason">
          <span class="type-icon">{{ currentMeta?.icon ?? '?' }}</span>
          <span class="type-name">{{ currentMeta?.name ?? localTrack.effectParams.type }}</span>
          <span v-if="currentUnsupportedReason" class="type-status">Unavailable</span>
        </span>
        <button class="btn-change" @click="showPicker = !showPicker">Change ▾</button>
      </div>
    </div>

    <!-- Popover effect type selector -->
    <div v-if="showPicker" class="type-picker-popover">
      <template v-for="cat in categories" :key="cat.key">
        <div class="cat-header">{{ cat.label }}</div>
        <div class="cat-grid">
          <button
            v-for="meta in cat.items"
            :key="meta.type"
            class="type-btn"
            :class="{
              selected: localTrack.effectParams.type === meta.type,
              disabled: isEffectTypeDisabled(meta.type),
            }"
            :disabled="isEffectTypeDisabled(meta.type)"
            :title="getEffectDisabledReason(meta.type)"
            @click="selectEffectType(meta.type)"
          >
            <span class="type-btn-icon">{{ meta.icon }}</span>
            <span class="type-btn-name">{{ meta.name }}</span>
          </button>
        </div>
      </template>
    </div>

    <!-- Parameters editing area -->
    <div class="section-divider" />
    <div class="section-header">Parameters</div>

    <template v-for="field in currentFields" :key="field.key">
      <div class="field-row">
        <label>{{ field.label }}</label>
        <template v-if="field.type === 'number'">
          <input
            type="number"
            :value="getParamValue(field.key)"
            :min="field.min"
            :max="field.max"
            :step="field.step ?? 1"
            :disabled="!!currentUnsupportedReason"
            @input="onParamInput(field.key, $event)"
          >
          <span v-if="field.unit" class="unit">{{ field.unit }}</span>
        </template>
        <template v-else-if="field.type === 'select'">
          <select :value="getParamValue(field.key)" :disabled="!!currentUnsupportedReason" @change="onParamInput(field.key, $event)">
            <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </template>
        <template v-else-if="field.type === 'color'">
          <input type="color" :value="getParamValue(field.key)" :disabled="!!currentUnsupportedReason" @input="onParamInput(field.key, $event)" >
        </template>
        <template v-else-if="field.type === 'checkbox'">
          <input type="checkbox" :checked="!!getParamValue(field.key)" :disabled="!!currentUnsupportedReason" @change="onCheckboxInput(field.key, $event)" >
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, toRaw, watch } from 'vue'

import type { DynamicEffectType, EffectParams, EffectTrack } from '@/types/animation'

// ===== Types =====

interface ParamFieldDef {
  key: string
  label: string
  type: 'number' | 'select' | 'color' | 'checkbox'
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: { value: string; label: string }[]
}

interface EffectMeta {
  type: DynamicEffectType
  icon: string
  name: string
  category: 'motion' | 'deform' | 'visual' | 'special'
  defaultParams: EffectParams
  paramFields: ParamFieldDef[]
}

// ===== Props & Emits =====

const props = defineProps<{
  track: EffectTrack
  unsupportedEffectTypes?: Partial<Record<DynamicEffectType, string>>
}>()

const emit = defineEmits<{
  update: [track: EffectTrack]
}>()

// ===== Effect Registry =====

const DIRECTION_OPTIONS = [
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'both', label: 'Both' },
]

const AXIS_OPTIONS = [
  { value: 'rotation', label: 'Rotation' },
  { value: 'x', label: 'Horizontal' },
  { value: 'y', label: 'Vertical' },
]

const EFFECT_REGISTRY: EffectMeta[] = [
  // Motion category
  {
    type: 'wave', icon: '🌊', name: 'Wave', category: 'motion',
    defaultParams: { type: 'wave', speed: 1, amplitude: 10, frequency: 1, direction: 'horizontal' },
    paramFields: [
      { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
      { key: 'amplitude', label: 'Amplitude', type: 'number' },
      { key: 'frequency', label: 'Frequency', type: 'number', step: 0.1 },
      { key: 'direction', label: 'Direction', type: 'select', options: DIRECTION_OPTIONS },
    ],
  },
  {
    type: 'ribbon', icon: '🎀', name: 'Ribbon', category: 'motion',
    defaultParams: { type: 'ribbon', speed: 0.5, amplitude: 10, frequency: 0.5, direction: 'horizontal', damping: 2, phaseScale: 0.2 },
    paramFields: [
      { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
      { key: 'amplitude', label: 'Max Amplitude', type: 'number' },
      { key: 'frequency', label: 'Frequency', type: 'number', step: 0.1 },
      { key: 'direction', label: 'Direction', type: 'select', options: DIRECTION_OPTIONS },
      { key: 'damping', label: 'Damping Index', type: 'number', step: 0.5, min: 1, max: 5 },
      { key: 'phaseScale', label: 'Phase Accumulation', type: 'number', step: 0.5, min: 0.5, max: 5 },
    ],
  },
  {
    type: 'shake', icon: '😵‍💫', name: 'Shake', category: 'motion',
    defaultParams: { type: 'shake', speed: 10, range: 10, axis: 'rotation' },
    paramFields: [
      { key: 'speed', label: 'Speed', type: 'number', min: 1, max: 20 },
      { key: 'range', label: 'Range', type: 'number', min: 1, max: 30 },
      { key: 'axis', label: 'Axis', type: 'select', options: AXIS_OPTIONS },
    ],
  },
  {
    type: 'float', icon: '🫧', name: 'Float', category: 'motion',
    defaultParams: { type: 'float', amplitude: 10, speed: 1 },
    paramFields: [
      { key: 'amplitude', label: 'Amplitude', type: 'number', unit: 'px' },
      { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
    ],
  },
  // Deform category
  {
    type: 'breathe', icon: '💨', name: 'Breathe', category: 'deform',
    defaultParams: { type: 'breathe', intensity: 0.5, speed: 1 },
    paramFields: [
      { key: 'intensity', label: 'Intensity', type: 'number', step: 0.1, min: 0, max: 1 },
      { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
    ],
  },
  {
    type: 'jelly', icon: '🩷', name: 'Jelly', category: 'deform',
    defaultParams: { type: 'jelly', stiffness: 8, damping: 0.3, intensity: 0.3, duration: 1000 },
    paramFields: [
      { key: 'stiffness', label: 'Stiffness', type: 'number', min: 1, max: 20 },
      { key: 'damping', label: 'Damping', type: 'number', step: 0.1, min: 0.1, max: 1 },
      { key: 'intensity', label: 'Intensity', type: 'number', step: 0.1, min: 0.1, max: 1 },
      { key: 'duration', label: 'Duration', type: 'number', step: 100, min: 100, max: 5000, unit: 'ms' },
    ],
  },
  {
    type: 'squash', icon: '🦮', name: 'Squash', category: 'deform',
    defaultParams: { type: 'squash', intensity: 0.2, speed: 2, duration: 1000 },
    paramFields: [
      { key: 'intensity', label: 'Intensity', type: 'number', step: 0.1, min: 0.1, max: 0.5 },
      { key: 'speed', label: 'Speed', type: 'number', step: 0.5, min: 0.5, max: 5 },
      { key: 'duration', label: 'Duration', type: 'number', step: 100, min: 100, max: 5000, unit: 'ms' },
    ],
  },
  // Visual category
  {
    type: 'glow', icon: '✨', name: 'Glow', category: 'visual',
    defaultParams: { type: 'glow', color: '#ffff00', intensity: 2, size: 15 },
    paramFields: [
      { key: 'color', label: 'Color', type: 'color' },
      { key: 'intensity', label: 'Intensity', type: 'number', step: 0.1, min: 0, max: 3 },
      { key: 'size', label: 'Size', type: 'number', min: 1, unit: 'px' },
    ],
  },
  {
    type: 'motion_blur', icon: '💨', name: 'Motion Blur', category: 'visual',
    defaultParams: { type: 'motion_blur', velocity: 20, angle: 0, kernelSize: 5 },
    paramFields: [
      { key: 'velocity', label: 'Blur Velocity', type: 'number', min: 5, max: 100 },
      { key: 'angle', label: 'Angle', type: 'number', step: 15, unit: '°' },
      { key: 'kernelSize', label: 'Kernel Size', type: 'number', min: 5, max: 15, step: 2 },
    ],
  },
  // Special category
  {
    type: 'petrify', icon: '🪨', name: 'Petrify', category: 'special',
    defaultParams: { type: 'petrify', duration: 1000, intensity: 1.0, grayScale: true },
    paramFields: [
      { key: 'duration', label: 'Duration', type: 'number', step: 100, min: 100, max: 5000, unit: 'ms' },
      { key: 'intensity', label: 'Intensity', type: 'number', step: 0.1, min: 0, max: 1 },
      { key: 'grayScale', label: 'Desaturate', type: 'checkbox' },
    ],
  },
  {
    type: 'shatter', icon: '💥', name: 'Shatter', category: 'special',
    defaultParams: { type: 'shatter', duration: 1500, pieceCount: 5, explodeForce: 10.0 },
    paramFields: [
      { key: 'duration', label: 'Duration', type: 'number', step: 100, min: 100, max: 5000, unit: 'ms' },
      { key: 'pieceCount', label: 'Piece Count', type: 'number', min: 1, max: 20 },
      { key: 'explodeForce', label: 'Explosion Force', type: 'number', min: 1, max: 50 },
    ],
  },
]

const HIDDEN_EFFECT_TYPES = new Set<DynamicEffectType>(['petrify', 'shatter'])

const CATEGORY_LABELS: Record<string, string> = {
  motion: 'Motion',
  deform: 'Deformation',
  visual: 'Visual',
  special: 'Special',
}

// ===== Local State =====

const showPicker = ref(false)
const localTrack = reactive<EffectTrack>({
  trackType: 'effect',
  effectParams: { type: 'breathe', intensity: 0.5, speed: 1 },
})

// ===== Watch props =====

watch(() => props.track, (newTrack) => {
  Object.assign(localTrack, structuredClone(toRaw(newTrack)))
}, { immediate: true, deep: true })

// ===== Computed =====

const currentMeta = computed(() =>
  EFFECT_REGISTRY.find(m => m.type === localTrack.effectParams.type)
)

const currentFields = computed(() =>
  currentMeta.value?.paramFields ?? []
)

const currentUnsupportedReason = computed(() =>
  props.unsupportedEffectTypes?.[localTrack.effectParams.type] ?? ''
)

const categories = computed(() => {
  const cats = ['motion', 'deform', 'visual', 'special'] as const
  return cats.map(key => ({
    key,
    label: CATEGORY_LABELS[key],
    items: EFFECT_REGISTRY.filter(m => m.category === key && !HIDDEN_EFFECT_TYPES.has(m.type)),
  })).filter(c => c.items.length > 0)
})

// ===== Methods =====

function getParamValue(key: string): unknown {
  return (localTrack.effectParams as Record<string, unknown>)[key]
}

function selectEffectType(type: DynamicEffectType) {
  if (isEffectTypeDisabled(type)) return
  const meta = EFFECT_REGISTRY.find(m => m.type === type)
  if (!meta) return
  localTrack.effectParams = structuredClone(toRaw(meta.defaultParams))
  showPicker.value = false
  emitUpdate()
}

function isEffectTypeDisabled(type: DynamicEffectType): boolean {
  return !!props.unsupportedEffectTypes?.[type]
}

function getEffectDisabledReason(type: DynamicEffectType): string {
  return props.unsupportedEffectTypes?.[type] ?? ''
}

function onParamInput(key: string, e: Event) {
  const target = e.target as HTMLInputElement | HTMLSelectElement
  const field = currentFields.value.find(f => f.key === key)
  if (!field) return

  let value: unknown
  if (field.type === 'number') {
    value = parseFloat(target.value)
    if (isNaN(value as number)) return
  } else if (field.type === 'color') {
    value = target.value
  } else {
    value = target.value
  }

  ;(localTrack.effectParams as Record<string, unknown>)[key] = value
  emitUpdate()
}

function onCheckboxInput(key: string, e: Event) {
  ;(localTrack.effectParams as Record<string, unknown>)[key] = (e.target as HTMLInputElement).checked
  emitUpdate()
}

function emitUpdate() {
  emit('update', structuredClone(toRaw(localTrack)))
}
</script>

<style scoped>
.effect-params-editor {
  padding: 0;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  min-height: 28px;
}

.field-row label {
  font-size: 11px;
  color: #888;
  min-width: 52px;
  flex-shrink: 0;
}

.field-row input[type="number"],
.field-row select {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  background: #f5f6f8;
  border: 1px solid #d0d3d9;
  border-radius: 3px;
  font-size: 12px;
  color: #333;
}

.field-row input[type="color"] {
  flex: 1;
  height: 26px;
  padding: 2px;
  background: #f5f6f8;
  border: 1px solid #d0d3d9;
  border-radius: 3px;
  cursor: pointer;
}

.field-row input:focus,
.field-row select:focus {
  border-color: #3b82f6;
  outline: none;
}

.unit {
  font-size: 10px;
  color: #aaa;
  flex-shrink: 0;
}

.type-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.current-type {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #333;
}

.current-type.unsupported {
  color: #9ca3af;
}

.type-icon {
  font-size: 14px;
}

.type-name {
  font-weight: 500;
}

.type-status {
  padding: 1px 4px;
  border-radius: 3px;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 10px;
}

.btn-change {
  background: #f0f1f3;
  border: 1px solid #d0d3d9;
  border-radius: 3px;
  font-size: 11px;
  color: #555;
  padding: 2px 8px;
  cursor: pointer;
  white-space: nowrap;
}

.btn-change:hover {
  background: #e4e6ea;
  border-color: #3b82f6;
  color: #3b82f6;
}

/* Popover */
.type-picker-popover {
  margin: 4px 8px;
  padding: 8px;
  background: #fff;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  max-height: 320px;
  overflow-y: auto;
}

.cat-header {
  font-size: 10px;
  color: #999;
  font-weight: 500;
  padding: 4px 0 2px;
  border-bottom: 1px solid #f0f1f3;
  margin-bottom: 4px;
}

.cat-header:not(:first-child) {
  margin-top: 8px;
}

.cat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 4px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.type-btn:hover {
  background: #f0f4ff;
  border-color: #93b4f6;
}

.type-btn.selected {
  background: #eff6ff;
  border-color: #3b82f6;
}

.type-btn.disabled {
  opacity: 0.42;
  cursor: not-allowed;
  background: #f3f4f6;
}

.type-btn.disabled:hover {
  background: #f3f4f6;
  border-color: #e5e7eb;
}

.type-btn-icon {
  font-size: 16px;
}

.type-btn-name {
  font-size: 10px;
  color: #666;
  line-height: 1;
}

.type-btn.selected .type-btn-name {
  color: #1d4ed8;
  font-weight: 500;
}

.section-divider {
  height: 1px;
  background: #e0e3e8;
  margin: 6px 8px;
}

.section-header {
  font-size: 11px;
  font-weight: 600;
  color: #777;
  padding: 2px 8px 4px;
}
</style>
