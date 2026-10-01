<template>
  <div class="screen-effect-picker-overlay" @click.self="$emit('close')">
    <div class="screen-effect-picker-dialog">
      <!-- Title bar -->
      <div class="dialog-header">
        <h3>🌟 Select Visual Effect</h3>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>

      <!-- Scrollable content area -->
      <div class="dialog-body">
        <!-- Group: Screen Effects -->
        <div class="effect-group-title">Screen Effects</div>
        <div class="effect-grid">
          <div
            v-for="effect in effects"
            :key="effect.id"
            class="effect-card"
            :class="{ selected: selectedKind === 'effect' && selectedEffectId === effect.id }"
            @click="selectEffect(effect)"
          >
            <!-- Preview canvas -->
            <div class="card-preview">
              <canvas
                :ref="(el) => { if (el) canvasRefs[effect.id] = el as HTMLCanvasElement }"
                class="preview-canvas"
                width="160"
                height="100"
              />
            </div>
            <!-- Name -->
            <div class="card-name">{{ effect.name }}</div>
            <!-- Description -->
            <div class="card-desc">{{ effect.description }}</div>
          </div>
        </div>

        <!-- Group: Clipping Masks -->
        <div class="effect-group-title">Clipping Masks</div>
        <div class="effect-grid">
          <div
            v-for="mask in maskPresets"
            :key="mask.shape"
            class="effect-card"
            :class="{ selected: selectedKind === 'mask' && selectedMaskShape === mask.shape }"
            @click="selectMask(mask.shape)"
          >
            <div class="card-preview mask-preview">
              <div
                class="mask-shape-icon"
                :class="mask.shape === 'ellipse' ? 'mask-ellipse' : 'mask-rect'"
              />
            </div>
            <div class="card-name">{{ mask.name }}</div>
            <div class="card-desc">{{ mask.description }}</div>
          </div>
        </div>
      </div>

      <!-- Bottom buttons -->
      <div class="dialog-footer">
        <button class="cancel-btn" @click="$emit('close')">Cancel</button>
        <button
          class="confirm-btn"
          :disabled="!canConfirm"
          @click="handleConfirm"
        >
          {{ selectedKind === 'mask' ? 'Add Mask' : 'Add Effect' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUpdated, ref } from 'vue'

import type { ScreenEffectParams, ScreenEffectPreset } from '@/types/sceneObject'

const emit = defineEmits<{
  select: [preset: ScreenEffectPreset]
  'select-mask': [shape: 'rectangle' | 'ellipse']
  close: []
}>()

// === State ===
const selectedKind = ref<'effect' | 'mask' | null>(null)
const selectedEffectId = ref<string | null>(null)
const selectedMaskShape = ref<'rectangle' | 'ellipse' | null>(null)
const canvasRefs: Record<string, HTMLCanvasElement> = {}

// === Mask Presets ===
const maskPresets: { shape: 'rectangle' | 'ellipse'; name: string; description: string }[] = [
  { shape: 'rectangle', name: 'Rectangle Mask', description: 'Rectangular region clipping' },
  { shape: 'ellipse', name: 'Ellipse Mask', description: 'Elliptical region clipping' },
]

// === Effects Registry ===

type ModuleType = 'base_cover' | 'hole_shape' | 'follow_target'

interface EffectDef {
  id: string
  name: string
  description: string
  icon: string
  effectClass: string
  modules: ModuleType[]
  defaults: ScreenEffectParams
  defaultAlpha: number
}

const effects: EffectDef[] = [
  {
    id: 'black_cover',
    name: 'Black Screen',
    description: 'Solid black full-screen overlay',
    icon: '⬛',
    effectClass: 'fullscreen_cover',
    modules: ['base_cover'],
    defaults: { baseColor: '#000000' },
    defaultAlpha: 1.0
  },
  {
    id: 'eye_iris',
    name: 'Blink / Iris',
    description: 'Horizontal ellipse aperture simulating eye blink',
    icon: '👁️',
    effectClass: 'iris_mask',
    modules: ['base_cover', 'hole_shape'],
    defaults: {
      baseColor: '#000000',
      holeShape: 'horizontal_ellipse', holeWidth: 1200, holeHeight: 400,
      openRatio: 1.0, feather: 20
    },
    defaultAlpha: 1.0
  },
  {
    id: 'spotlight_center',
    name: 'Center Spotlight',
    description: 'Spotlight focused at screen center',
    icon: '💡',
    effectClass: 'spotlight',
    modules: ['base_cover', 'hole_shape'],
    defaults: {
      baseColor: '#000000',
      holeShape: 'vertical_ellipse', holeWidth: 250, holeHeight: 600,
      openRatio: 0.8, feather: 20
    },
    defaultAlpha: 0.9
  },
]

// === Computed Properties ===

const selectedEffect = computed<EffectDef | null>(() => {
  if (!selectedEffectId.value) return null
  return effects.find(e => e.id === selectedEffectId.value) ?? null
})

const canConfirm = computed<boolean>(() => {
  if (selectedKind.value === 'effect') return !!selectedEffect.value
  if (selectedKind.value === 'mask') return !!selectedMaskShape.value
  return false
})

// === Methods ===

function selectEffect(effect: EffectDef) {
  selectedKind.value = 'effect'
  selectedEffectId.value = effect.id
  selectedMaskShape.value = null
}

function selectMask(shape: 'rectangle' | 'ellipse') {
  selectedKind.value = 'mask'
  selectedMaskShape.value = shape
  selectedEffectId.value = null
}

function handleConfirm() {
  if (selectedKind.value === 'mask' && selectedMaskShape.value) {
    emit('select-mask', selectedMaskShape.value)
    return
  }
  if (selectedKind.value !== 'effect' || !selectedEffect.value) return

  const effect = selectedEffect.value
  const params: ScreenEffectParams = {}
  const modules = effect.modules

  if (modules.includes('base_cover')) {
    params.baseColor = effect.defaults.baseColor ?? '#000000'
  }
  if (modules.includes('hole_shape')) {
    params.holeShape = effect.defaults.holeShape ?? 'circle'
    params.holeWidth = effect.defaults.holeWidth ?? 600
    params.holeHeight = effect.defaults.holeHeight ?? 600
    params.openRatio = effect.defaults.openRatio ?? 1.0
    params.feather = effect.defaults.feather ?? 0
  }
  if (modules.includes('follow_target')) {
    params.offsetX = effect.defaults.offsetX ?? 0
    params.offsetY = effect.defaults.offsetY ?? 0
  }
  // Light mode parameters
  if (effect.defaults.lightMode) {
    params.lightMode = effect.defaults.lightMode
    params.lightColor = effect.defaults.lightColor ?? '#ffffff'
    params.lightFalloff = effect.defaults.lightFalloff ?? 'smooth'
  }

  emit('select', {
    effectClass: effect.effectClass,
    name: effect.name,
    params,
    defaultAlpha: effect.defaultAlpha
  })
}

// === Thumbnail Preview Drawing ===

function drawPreview(canvas: HTMLCanvasElement, effect: EffectDef) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.width
  const h = canvas.height
  const d = effect.defaults

  // Draw checkerboard background (transparent indicator)
  ctx.fillStyle = '#f0f0f0'
  ctx.fillRect(0, 0, w, h)
  const gridSize = 8
  ctx.fillStyle = '#ddd'
  for (let y = 0; y < h; y += gridSize) {
    for (let x = 0; x < w; x += gridSize) {
      if ((Math.floor(x / gridSize) + Math.floor(y / gridSize)) % 2 === 0) {
        ctx.fillRect(x, y, gridSize, gridSize)
      }
    }
  }

  // Draw overlay layer
  const opacity = effect.defaultAlpha

  // Lighting preset: Draw colored radial gradient
  if (d.lightMode) {
    const cx = w / 2
    const cy = h / 2
    const lightColor = d.lightColor ?? '#ffffff'
    const maxR = Math.min(w, h) * 0.45
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR)
    gradient.addColorStop(0, lightColor)
    gradient.addColorStop(0.4, lightColor + '88')
    gradient.addColorStop(0.7, lightColor + '33')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = opacity
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 1
    return
  }

  // Non-light mode: Draw solid color overlay
  const color = d.baseColor ?? '#000000'
  ctx.fillStyle = color
  ctx.globalAlpha = opacity
  ctx.fillRect(0, 0, w, h)
  ctx.globalAlpha = 1

  // Draw aperture / hole
  if (d.holeShape && (d.openRatio ?? 0) > 0) {
    const cx = w / 2
    const cy = h / 2
    const ratio = d.openRatio ?? 1
    const baseW = ((d.holeWidth ?? 400) / 1600) * w / 2
    const baseH = ((d.holeHeight ?? 300) / 900) * h / 2
    // Scale according to shape orientation
    let holeW: number
    let holeH: number
    if (d.holeShape === 'horizontal_ellipse') {
      holeW = baseW
      holeH = baseH * ratio
    } else if (d.holeShape === 'vertical_ellipse') {
      holeW = baseW * ratio
      holeH = baseH
    } else {
      holeW = baseW * ratio
      holeH = baseH * ratio
    }
    const feather = ((d.feather ?? 0) / 1600) * w

    if (feather > 0) {
      // Simulate feathering with radial gradient
      const maxR = Math.max(holeW, holeH) + feather
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR)
      const innerRatio = Math.max(0, Math.min(holeW, holeH) / maxR)
      grad.addColorStop(0, 'rgba(255,255,255,1)')
      grad.addColorStop(innerRatio, 'rgba(255,255,255,0.8)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.globalCompositeOperation = 'destination-out'

      if (d.holeShape === 'rectangle') {
        ctx.fillStyle = grad
        ctx.fillRect(cx - holeW - feather, cy - holeH - feather,
          (holeW + feather) * 2, (holeH + feather) * 2)
      } else {
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.ellipse(cx, cy, holeW + feather, holeH + feather, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    } else {
      // Hard edge aperture
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'white'
      ctx.beginPath()
      if (d.holeShape === 'circle') {
        ctx.arc(cx, cy, Math.min(holeW, holeH), 0, Math.PI * 2)
      } else if (d.holeShape === 'rectangle') {
        ctx.rect(cx - holeW, cy - holeH, holeW * 2, holeH * 2)
      } else {
        ctx.ellipse(cx, cy, holeW, holeH, 0, 0, Math.PI * 2)
      }
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    }
  }
}

function renderAllPreviews() {
  for (const effect of effects) {
    const canvas = canvasRefs[effect.id]
    if (canvas) {
      drawPreview(canvas, effect)
    }
  }
}

onMounted(() => {
  void nextTick(() => renderAllPreviews())
})

// Redraw previews on update
onUpdated(() => {
  void nextTick(() => renderAllPreviews())
})
</script>

<style scoped>
.screen-effect-picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.screen-effect-picker-dialog {
  background: #ffffff;
  border-radius: 12px;
  width: 680px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

/* Title bar */
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #e8eaed;
}

.dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1a1a2e;
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #9ca3af;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: all 0.15s;
}

.close-btn:hover {
  background: #f3f4f6;
  color: #374151;
}

/* Scrollable content */
.dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

/* Card grid */
.effect-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 8px;
}

/* Group title */
.effect-group-title {
  font-size: 13px;
  font-weight: 600;
  color: #4b5563;
  margin: 4px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #f0f1f3;
}
.effect-group-title:not(:first-child) {
  margin-top: 16px;
}

/* Mask preview */
.card-preview.mask-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f3f4f6;
}
.mask-shape-icon {
  width: 80px;
  height: 50px;
  border: 2px dashed #f59e0b;
  background: rgba(245, 158, 11, 0.15);
}
.mask-shape-icon.mask-ellipse {
  border-radius: 50%;
}
.mask-shape-icon.mask-rect {
  border-radius: 2px;
}

/* Cards */
.effect-card {
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: #fafbfc;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.effect-card:hover {
  border-color: #93c5fd;
  background: #f0f7ff;
  transform: translateY(-1px);
  box-shadow: 0 3px 12px rgba(59, 130, 246, 0.1);
}

.effect-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

/* Preview area */
.card-preview {
  width: 100%;
  height: 80px;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
  background: #e5e7eb;
}

.preview-canvas {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

/* Card typography */
.card-name {
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 2px;
}

.card-desc {
  font-size: 11px;
  color: #9ca3af;
  line-height: 1.3;
}

/* Bottom buttons */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid #e8eaed;
}

.cancel-btn {
  padding: 8px 20px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #ffffff;
  color: #374151;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.cancel-btn:hover {
  background: #f9fafb;
  border-color: #9ca3af;
}

.confirm-btn {
  padding: 8px 24px;
  border: none;
  border-radius: 8px;
  background: #3b82f6;
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.confirm-btn:hover:not(:disabled) {
  background: #2563eb;
}

.confirm-btn:disabled {
  background: #93c5fd;
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
