<template>
  <div
    class="bgm-manager-overlay"
    @click.self="handleClose"
  >
    <div class="bgm-manager-dialog">
      <div class="dialog-header">
        <h3>🎵 Background Music</h3>
        <button
          class="close-btn"
          @click="handleClose"
        >
          ✕
        </button>
      </div>

      <div class="dialog-content">
        <!-- Display tracks list directly, if empty onMounted will add one -->
        <div class="tracks-list">
          <div
            v-for="(track, index) in localTracks"
            :key="track.id"
            class="track-card"
          >
            <div class="track-header">
              <span class="track-index">Track {{ index + 1 }}</span>
              <button
                class="btn-icon danger"
                title="Delete Track"
                @click="handleDeleteTrack(index)"
              >
                🗑️
              </button>
            </div>

            <div class="track-row">
              <!-- Music Selector -->
              <div class="track-col music-col">
                <label>Background Music</label>
                <div
                  class="music-selector"
                  @click="openMusicPicker(index)"
                >
                  <span class="music-icon">🎵</span>
                  <span class="music-name">{{ getAssetName(track.assetId) || 'Click to select music...' }}</span>
                </div>
              </div>

              <!-- Volume & Loop & Fade in/out -->
              <div class="track-col options-col">
                <div class="option-item">
                  <label>Volume: {{ Math.round(track.volume * 100) }}%</label>
                  <input 
                    v-model.number="track.volume" 
                    type="range" 
                    min="0"
                    max="1"
                    step="0.05"
                  >
                </div>
                
                <!-- Fade settings -->
                <div class="option-item fade-item">
                  <label>Fade In (s)</label>
                  <input
                    v-model.number="track.fadeIn"
                    type="number"
                    min="0"
                    step="0.5"
                    class="fade-input"
                    placeholder="0"
                  >
                </div>
                <div class="option-item fade-item">
                  <label>Fade Out (s)</label>
                  <input
                    v-model.number="track.fadeOut"
                    type="number"
                    min="0"
                    step="0.5"
                    class="fade-input"
                    placeholder="0"
                  >
                </div>

                <div class="option-item checkbox">
                  <label>
                    <input
                      v-model="track.loop"
                      type="checkbox"
                    >
                    Loop
                  </label>
                </div>
              </div>
            </div>

            <div class="track-row time-row">
              <!-- Start position -->
              <div class="track-col">
                <label>Start Position</label>
                <div class="select-group">
                  <select 
                    :value="track.start.sceneId" 
                    class="scene-select"
                    @change="e => updateStartScene(track, (e.target as HTMLSelectElement).value)"
                  >
                    <option
                      v-for="scene in scenes"
                      :key="scene.id"
                      :value="scene.id"
                    >
                      {{ getSceneLabel(scene) }}
                    </option>
                  </select>
                  
                  <select 
                    v-model="track.start.blockId"
                    class="block-select"
                  >
                    <option :value="SCENE_START_ID">
                      Scene Start
                    </option>
                    <option
                      v-for="block in getSceneBlocks(track.start.sceneId)"
                      :key="block.id"
                      :value="block.id"
                    >
                      {{ getBlockLabel(block) }}
                    </option>
                    <option :value="SCENE_END_ID">
                      Scene End
                    </option>
                  </select>
                </div>
              </div>

              <div class="arrow">
                →
              </div>

              <!-- End position -->
              <div class="track-col">
                <label>End Position</label>
                <div class="select-group">
                  <select 
                    :value="track.end.sceneId" 
                    class="scene-select"
                    @change="e => updateEndScene(track, (e.target as HTMLSelectElement).value)"
                  >
                    <option
                      v-for="scene in scenes"
                      :key="scene.id"
                      :value="scene.id"
                    >
                      {{ getSceneLabel(scene) }}
                    </option>
                  </select>
                  
                  <select 
                    v-model="track.end.blockId"
                    class="block-select"
                  >
                    <option :value="SCENE_START_ID">
                      Scene Start
                    </option>
                    <option
                      v-for="block in getSceneBlocks(track.end.sceneId)"
                      :key="block.id"
                      :value="block.id"
                    >
                      {{ getBlockLabel(block) }}
                    </option>
                    <option :value="SCENE_END_ID">
                      Scene End
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div class="add-btn-wrapper">
            <button
              class="btn-secondary full-width"
              @click="handleAddTrack"
            >
              + Add New Track
            </button>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button
          class="btn-cancel"
          @click="handleClose"
        >
          Cancel
        </button>
        <button
          class="btn-confirm"
          @click="handleSave"
        >
          Save
        </button>
      </div>
    </div>

    <!-- Music selector -->
    <SoundPickerDialog
      v-if="showPicker"
      @close="showPicker = false"
      @select="handleMusicSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted,ref } from 'vue'

import SoundPickerDialog from '@/components/SoundPickerDialog.vue'
import { useEpisodeStore } from '@/stores/episodeStore'
import { useSoundStore } from '@/stores/soundStore'
import type { SoundAsset } from '@/types/project'
import type { BGMTrack, SceneContainer, ScriptBlock } from '@/types/screenplay'
import { generateId } from '@/utils/uuid'

const props = defineProps<{
  episodeId?: string
}>()

const emit = defineEmits<(e: 'close') => void>()

const episodeStore = useEpisodeStore()
const soundStore = useSoundStore()
// const projectStore = useProjectStore() // Save handled via episodeStore action

const currentEpisodeId = computed(() => props.episodeId || episodeStore.currentEpisodeId)
const currentEpisode = computed(() => {
  if (props.episodeId) return episodeStore.getEpisode(props.episodeId)
  return episodeStore.currentEpisode
})

const scenes = computed(() => currentEpisode.value?.scenes || [])

// Local state (Draft)
const localTracks = ref<BGMTrack[]>([])
const showPicker = ref(false)
const pickingTrackIndex = ref<number | null>(null)

// Initialize
const SCENE_START_ID = '__SCENE_START__'
const SCENE_END_ID = '__SCENE_END__'

onMounted(() => {
  if (currentEpisode.value?.bgmTracks) {
    // Deep clone
    localTracks.value = JSON.parse(JSON.stringify(currentEpisode.value.bgmTracks)) as BGMTrack[]
    
    // Migrate legacy data: convert null to explicit constant
    localTracks.value.forEach(track => {
      if (track.start.blockId === null) track.start.blockId = SCENE_START_ID
      if (track.end.blockId === null) track.end.blockId = SCENE_END_ID
    })
  } else {
    localTracks.value = []
  }

  // If no BGM, auto add one track
  if (localTracks.value.length === 0) {
    handleAddTrack()
  }
})

function getAssetName(assetId: string) {
  const asset = soundStore.sounds.find(s => s.id === assetId)
  return asset ? asset.name : ''
}

function getSceneLabel(scene: SceneContainer) {
  const index = scenes.value.findIndex(s => s.id === scene.id)
  return `${index + 1}. ${scene.title}`
}

function getSceneBlocks(sceneId: string) {
  const scene = scenes.value.find(s => s.id === sceneId)
  return scene?.script || []
}

function getBlockLabel(block: ScriptBlock) {
  const typeMap: Record<string, string> = {
    dialogue: 'Dialogue',
    narration: 'Narration',
    action: 'Action'
  }
  let text = ''
  if ('text' in block) {
    text = (block as { text: string }).text
  } else if ((block as unknown as { type: string }).type === 'action') {
    text = 'Action Clip'
  }
  
  if (text.length > 15) text = text.substring(0, 15) + '...'
  return `[${typeMap[block.type] || block.type}] ${text}`
}

// Actions
function handleAddTrack() {
  // Default: start at first scene, end at last scene
  const firstScene = scenes.value[0]
  const lastScene = scenes.value[scenes.value.length - 1]
  
  if (!firstScene) return

  const newTrack: BGMTrack = {
    id: generateId('bgm'),
    assetId: '',
    start: {
      sceneId: firstScene.id,
      blockId: SCENE_START_ID
    },
    end: {
      sceneId: lastScene ? lastScene.id : firstScene.id,
      blockId: SCENE_END_ID
    },
    volume: 0.5,
    loop: false, // Default: no loop
    fadeIn: 1, // Default: 1s fade-in
    fadeOut: 1 // Default: 1s fade-out
  }
  
  localTracks.value.push(newTrack)
}

function handleDeleteTrack(index: number) {
  if (confirm('Are you sure you want to delete this BGM track?')) {
    localTracks.value.splice(index, 1)
  }
}

function handleSave() {
  if (currentEpisodeId.value) {
    // Filter out empty tracks without selected assets (optional)
    // Retain all tracks here
    episodeStore.setBGMTracks(currentEpisodeId.value, localTracks.value)
    emit('close')
  }
}

function handleClose() {
  emit('close')
}

// Time Updates
function updateStartScene(track: BGMTrack, sceneId: string) {
  track.start.sceneId = sceneId
  track.start.blockId = SCENE_START_ID // Default to Start
}

function updateEndScene(track: BGMTrack, sceneId: string) {
  track.end.sceneId = sceneId
  track.end.blockId = SCENE_END_ID // Default to End
}

// Music Picker
function openMusicPicker(index: number) {
  pickingTrackIndex.value = index
  showPicker.value = true
}

function handleMusicSelected(sound: SoundAsset) {
  const index = pickingTrackIndex.value
  if (index !== null) {
    const track = localTracks.value[index]
    if (track) {
      track.assetId = sound.id
    }
  }
  showPicker.value = false
  pickingTrackIndex.value = null
}
</script>

<style scoped>
.bgm-manager-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  backdrop-filter: blur(2px);
}

.bgm-manager-dialog {
  width: 1000px; /* Increased width from 900px to 1000px */
  max-width: 95vw;
  height: 85vh; /* Fixed height for better layout */
  max-height: 90vh;
  background: white;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.dialog-header {
  padding: 16px 24px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f9fafb;
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #111827;
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  color: #6b7280;
  cursor: pointer;
}

.dialog-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: #f3f4f6;
}

.dialog-footer {
  padding: 16px 24px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn-cancel {
  padding: 8px 16px;
  border: 1px solid #d1d5db;
  background: white;
  color: #374151;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
}

.btn-cancel:hover {
  background: #f9fafb;
}

.btn-confirm {
  padding: 8px 24px;
  border: none;
  background: #3b82f6;
  color: white;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
}

.btn-confirm:hover {
  background: #2563eb;
}

.tracks-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.track-card {
  background: white;
  border-radius: 8px;
  padding: 20px; /* Increased padding */
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;
}

.track-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.track-index {
  font-weight: 600;
  color: #374151;
  font-size: 15px;
}

.track-row {
  display: flex;
  gap: 20px;
  margin-bottom: 16px;
}

.track-row:last-child {
  margin-bottom: 0;
}

.track-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.track-col label {
  font-size: 13px;
  color: #6b7280;
  font-weight: 500;
}

/* Music Selector */
.music-selector {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  background: #f9fafb;
  transition: all 0.2s;
}

.music-selector:hover {
  border-color: #3b82f6;
  background: white;
}

.music-name {
  font-size: 14px;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Options */
.options-col {
  flex-direction: row;
  align-items: center;
  gap: 32px;
}

.option-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.option-item.checkbox {
  flex-direction: row;
  align-items: center;
}

.option-item.checkbox label {
  font-size: 14px;
  color: #374151;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.fade-item {
  max-width: 60px;
}

.fade-input {
  width: 100%;
  padding: 4px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
  text-align: center;
}

/* Time Row */
.time-row {
  align-items: flex-end;
}

.select-group {
  display: flex;
  gap: 12px;
}

.scene-select, .block-select {
  flex: 1;
  padding: 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  max-width: 50%;
}

.arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  padding-bottom: 10px;
  font-size: 18px;
}

.add-btn-wrapper {
  margin-top: 12px;
}

.btn-secondary {
  background: white;
  color: #3b82f6;
  border: 1px dashed #3b82f6;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: #eff6ff;
  border-color: #2563eb;
}

.btn-icon {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  padding: 6px;
  border-radius: 4px;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: #f3f4f6;
}

.btn-icon.danger {
  color: #ef4444;
}

.btn-icon.danger:hover {
  background: #fee2e2;
}

.full-width {
  width: 100%;
}
</style>
