<template>
  <div
    class="export-confirm-dialog-overlay"
    @click.self="$emit('cancel')"
  >
    <div class="export-confirm-dialog">
      <div class="dialog-header">
        <h3>Export Video</h3>
        <button
          class="close-btn"
          title="Close"
          @click="$emit('cancel')"
        >
          ✕
        </button>
      </div>
      
      <div class="dialog-body">
        <p class="export-description">
          🎬 Export the full screenplay as an MP4 video
        </p>
        
        <!-- Export Settings -->
        <div class="export-settings">
          <div class="setting-item">
            <label class="setting-label">Resolution</label>
            <select
              v-model="localSettings.resolution"
              class="setting-select"
            >
              <option
                v-for="preset in RESOLUTION_PRESETS"
                :key="preset.id"
                :value="preset.id"
              >
                {{ preset.label }} ({{ preset.width }}×{{ preset.height }})
              </option>
            </select>
          </div>
          
          <div class="setting-item">
            <label class="setting-label">Frame Rate</label>
            <div class="setting-value">
              60 FPS
            </div>
          </div>
          
          <div class="setting-item">
            <label class="setting-label">Quality</label>
            <select
              v-model="localSettings.quality"
              class="setting-select"
            >
              <option
                v-for="preset in QUALITY_PRESETS"
                :key="preset.id"
                :value="preset.id"
              >
                {{ preset.label }} - {{ preset.description }}
              </option>
            </select>
          </div>

          <div class="setting-item">
            <label class="setting-label">Encoder</label>
            <select
              v-model="localSettings.encoder"
              class="setting-select"
            >
              <option value="hardware">
                Hardware Encoding (Fast)
              </option>
              <option value="software">
                Software Encoding (High Quality)
              </option>
            </select>
          </div>
        </div>

        <!-- Subtitle Options -->
        <div class="subtitle-section">
          <label class="subtitle-label">
            <input
              v-model="localSettings.showSubtitles"
              type="checkbox"
              class="subtitle-checkbox"
            >
            <span class="label-text">Show subtitles at the bottom of the video</span>
          </label>
          <div
            v-if="localSettings.showSubtitles"
            class="subtitle-style-panel"
          >
            <div class="subtitle-style-row">
              <label class="subtitle-style-label">Font</label>
              <select
                v-model="localSettings.subtitleStyle.fontFamily"
                class="subtitle-style-select"
              >
                <option
                  v-for="font in subtitleFontOptions"
                  :key="font.value"
                  :value="font.value"
                >
                  {{ font.label }}
                </option>
              </select>
            </div>

            <div class="subtitle-style-row">
              <label class="subtitle-style-label">Font Size</label>
              <select
                :value="subtitleFontSizePresetMatch"
                class="subtitle-style-select"
                @change="handleSubtitleFontSizeChange(($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-for="size in FONT_SIZE_PRESETS"
                  :key="size"
                  :value="size"
                >
                  {{ size }}
                </option>
                <option
                  v-if="!FONT_SIZE_PRESETS.includes(localSettings.subtitleStyle.fontSize)"
                  :value="localSettings.subtitleStyle.fontSize"
                >
                  {{ localSettings.subtitleStyle.fontSize }} (Custom)
                </option>
              </select>
            </div>

            <div class="subtitle-preview">
              <div
                class="subtitle-preview-text"
                :style="subtitlePreviewStyle"
              >
                Subtitle Sample Text
              </div>
            </div>

            <div class="subtitle-style-grid">
              <label class="subtitle-color-field">
                <span>Text Color</span>
                <input
                  v-model="localSettings.subtitleStyle.textColor"
                  type="color"
                  class="subtitle-color-input"
                >
              </label>
              <label class="subtitle-color-field">
                <span>Background Color</span>
                <input
                  v-model="localSettings.subtitleStyle.backgroundColor"
                  type="color"
                  class="subtitle-color-input"
                >
              </label>
            </div>

            <label class="subtitle-range-field">
              <span>Background Opacity {{ Math.round(localSettings.subtitleStyle.backgroundOpacity * 100) }}%</span>
              <input
                v-model.number="localSettings.subtitleStyle.backgroundOpacity"
                type="range"
                min="0"
                max="1"
                step="0.05"
              >
            </label>

            <label class="subtitle-range-field">
              <span>Subtitle Width {{ localSettings.subtitleStyle.maxWidthPercent }}%</span>
              <input
                v-model.number="localSettings.subtitleStyle.maxWidthPercent"
                type="range"
                min="50"
                max="95"
                step="5"
              >
            </label>

            <label class="subtitle-range-field">
              <span>Bottom Offset {{ localSettings.subtitleStyle.bottomPercent }}%</span>
              <input
                v-model.number="localSettings.subtitleStyle.bottomPercent"
                type="range"
                min="2"
                max="20"
                step="1"
              >
            </label>
          </div>
        </div>
        
        <!-- Watermark Options -->
        <div class="watermark-section">
          <label class="watermark-label">
            <input
              v-model="localSettings.showWatermark"
              type="checkbox"
              class="watermark-checkbox"
            >
            <span class="label-text">Show project watermark in bottom-right corner</span>
          </label>
        </div>
        
        <!-- Estimated Info -->
        <div class="export-estimate">
          <div class="estimate-item">
            <span class="label">Estimated Duration:</span>
            <span class="value">{{ estimatedDuration }}</span>
          </div>
          <div class="estimate-item">
            <span class="label">Format:</span>
            <span class="value">MP4 (H.264 + AAC)</span>
          </div>
        </div>
      </div>
      
      <div class="dialog-footer">
        <button
          class="btn btn-secondary"
          @click="$emit('cancel')"
        >
          Cancel
        </button>
        <button
          class="btn btn-primary"
          @click="handleConfirm"
        >
          Start Export
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { useAssetAudio } from '@/composables/useAssetAudio'
import { useEpisodeStore } from '@/stores/episodeStore'
import type { ScriptBlock } from '@/types/screenplay'
import { getBlockDurationMs } from '@/utils/exportAdapter'
import { ensureFontLoaded } from '@/utils/fontLoader'
import { FONT_SIZE_PRESETS } from '@/utils/textStylePresets'
import { DEFAULT_SUBTITLE_STYLE, type ExportSettings,QUALITY_PRESETS, RESOLUTION_PRESETS } from '@/utils/videoExport'
import { formatDuration } from '@/utils/videoExport/estimator'
import { audioKit } from '@/utils/WebAudioKit'

const props = defineProps<{
  episodeId: string
  settings: ExportSettings
}>()

const emit = defineEmits<{
  confirm: [settings: ExportSettings]
  cancel: []
}>()

const episodeStore = useEpisodeStore()
const { loadAudioUrl, getAudioUrl } = useAssetAudio()

// Local settings (editable)
const localSettings = ref<ExportSettings>(normalizeExportSettings(props.settings))
const resolvedDurationMs = ref<number | null>(null)
const isResolvingDuration = ref(false)

const subtitleFontOptions = [
  { value: 'Noto Sans SC', label: 'Noto Sans (Sans-serif)' },
  { value: 'Noto Serif SC', label: 'Noto Serif (Serif)' },
  { value: 'LXGW WenKai', label: 'LXGW WenKai' },
  { value: 'ZCOOL QingKe HuangYou', label: 'ZCOOL QingKe HuangYou' },
  { value: 'Ma Shan Zheng', label: 'Ma Shan Zheng' },
]

const subtitlePreviewStyle = computed(() => {
  const style = localSettings.value.subtitleStyle
  const background = hexToRgba(style.backgroundColor, style.backgroundOpacity)

  return {
    color: style.textColor,
    background,
    fontFamily: `"${style.fontFamily}", sans-serif`,
    fontSize: `${style.fontSize}px`,
    maxWidth: `${style.maxWidthPercent}%`,
  }
})

const subtitleFontSizePresetMatch = computed(() => localSettings.value.subtitleStyle.fontSize)

function normalizeExportSettings(settings: ExportSettings): ExportSettings {
  return {
    ...settings,
    subtitleStyle: {
      ...DEFAULT_SUBTITLE_STYLE,
      ...(settings.subtitleStyle ?? {}),
    },
  }
}

function hexToRgba(hex: string, opacity: number): string {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_SUBTITLE_STYLE.backgroundColor
  const alpha = Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : DEFAULT_SUBTITLE_STYLE.backgroundOpacity))
  const value = Number.parseInt(normalized.slice(1), 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function preloadSubtitlePreviewFont() {
  if (!localSettings.value.showSubtitles) return
  void ensureFontLoaded(localSettings.value.subtitleStyle.fontFamily, 'Subtitle Sample Text')
}

function handleSubtitleFontSizeChange(value: string) {
  localSettings.value.subtitleStyle.fontSize = Number(value)
}

function calculateStoredDurationMs(): number {
  const episode = episodeStore.getEpisode(props.episodeId)
  if (!episode?.scenes) return 0
  
  let totalDuration = 0
  for (const scene of episode.scenes) {
    if (scene.script) {
      for (const block of scene.script) {
        totalDuration += getBlockDurationMs(block)
      }
    }
  }

  return totalDuration
}

async function resolveBlockDurationMs(block: ScriptBlock): Promise<number> {
  if (block.type !== 'dialogue' && block.type !== 'narration') {
    return getBlockDurationMs(block)
  }

  const storedDuration = getBlockDurationMs(block)
  const audioPath = block.ttsConfig?.audioPath
  if (!audioPath) {
    return storedDuration
  }

  try {
    const playableUrl = audioPath.startsWith('blob:') || audioPath.startsWith('data:') || audioPath.startsWith('http')
      ? audioPath
      : (await loadAudioUrl(audioPath), getAudioUrl(audioPath))

    if (!playableUrl) {
      return storedDuration
    }

    const audioBuffer = await audioKit.load(playableUrl)
    const actualDuration = Math.round((audioBuffer?.duration ?? 0) * 1000)
    return actualDuration > 0 ? Math.max(storedDuration, actualDuration) : storedDuration
  } catch {
    return storedDuration
  }
}

async function refreshEstimatedDuration() {
  const episode = episodeStore.getEpisode(props.episodeId)
  if (!episode?.scenes) {
    resolvedDurationMs.value = 0
    return
  }

  isResolvingDuration.value = true
  const runId = Symbol('duration-run')
  latestDurationRun = runId

  try {
    await audioKit.init()
    let total = 0

    for (const scene of episode.scenes) {
      if (!scene.script) continue
      for (const block of scene.script) {
        total += await resolveBlockDurationMs(block)
      }
    }

    if (latestDurationRun === runId) {
      resolvedDurationMs.value = total
    }
  } finally {
    if (latestDurationRun === runId) {
      isResolvingDuration.value = false
    }
  }
}

let latestDurationRun: symbol | null = null

// Calculate estimated duration
const estimatedDuration = computed(() => {
  const duration = resolvedDurationMs.value ?? calculateStoredDurationMs()
  const prefix = isResolvingDuration.value && resolvedDurationMs.value === null ? 'Calculating... ' : ''
  return `${prefix}${formatDuration(duration)}`
})

onMounted(() => {
  void refreshEstimatedDuration()
  preloadSubtitlePreviewFont()
})

watch(() => props.episodeId, () => {
  resolvedDurationMs.value = null
  void refreshEstimatedDuration()
})

watch(
  () => [localSettings.value.showSubtitles, localSettings.value.subtitleStyle.fontFamily] as const,
  preloadSubtitlePreviewFont
)

// Confirm export
const handleConfirm = () => {
  emit('confirm', { ...localSettings.value })
}
</script>

<style scoped>
.export-confirm-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.export-confirm-dialog {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 480px;
  max-height: calc(100vh - 48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  overflow: hidden;
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

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  font-size: 20px;
  color: #6b7280;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: #f3f4f6;
  color: #1f2937;
}

.dialog-body {
  padding: 16px 24px;
  overflow-y: auto;
  min-height: 0;
}

.export-description {
  margin: 0 0 12px;
  font-size: 14px;
  color: #6b7280;
}

.export-settings {
  background: #f9fafb;
  border-radius: 8px;
  padding: 8px 16px;
  margin-bottom: 12px;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.setting-item:not(:last-child) {
  border-bottom: 1px solid #e5e7eb;
}

.setting-label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  min-width: 60px;
}

.setting-select {
  flex: 1;
  margin-left: 16px;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  color: #1f2937;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
}

.setting-select:hover {
  border-color: #3b82f6;
}

.setting-select:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.setting-value {
  flex: 1;
  margin-left: 16px;
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
  background: #fff;
}

.export-estimate {
  background: #eff6ff;
  border-radius: 8px;
  padding: 16px;
}

.estimate-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
}

.estimate-item:not(:last-child) {
  border-bottom: 1px solid #bfdbfe;
}

.estimate-item .label {
  font-size: 14px;
  color: #3b82f6;
}

.estimate-item .value {
  font-size: 14px;
  font-weight: 600;
  color: #1e40af;
}

.watermark-section,
.subtitle-section {
  background: #f9fafb;
  border-radius: 8px;
  padding: 10px 16px;
  margin-bottom: 12px;
}

.watermark-label,
.subtitle-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.watermark-checkbox,
.subtitle-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.subtitle-style-panel {
  margin: 8px 0 0 28px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid #e5e7eb;
}

.subtitle-style-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.subtitle-style-label {
  width: 64px;
  font-size: 12px;
  font-weight: 500;
  color: #4b5563;
}

.subtitle-style-select,
.subtitle-number-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0 10px;
  font-size: 13px;
  color: #1f2937;
  background: white;
}

.subtitle-number-input {
  max-width: 96px;
}

.subtitle-style-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.subtitle-preview {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 0;
  overflow: hidden;
}

.subtitle-preview-text {
  padding: 6px 12px;
  border-radius: 4px;
  line-height: 1.33;
  text-align: center;
  word-break: break-word;
}

.subtitle-color-field,
.subtitle-range-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #4b5563;
}

.subtitle-color-input {
  width: 100%;
  height: 32px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 2px;
  background: white;
  cursor: pointer;
}

.subtitle-range-field input {
  width: 100%;
}

.label-text {
  font-size: 14px;
  color: #374151;
}

.dialog-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px 24px;
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary {
  background: white;
  color: #374151;
  border: 1px solid #d1d5db;
}

.btn-secondary:hover {
  background: #f9fafb;
  border-color: #9ca3af;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover {
  background: #2563eb;
}
</style>
