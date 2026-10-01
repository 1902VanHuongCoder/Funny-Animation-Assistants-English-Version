<!--
  KeyframePropertyPanel.vue — Right property edit panel (three-state toggle)
  
  v5.0: Three-state panel
  - State A (none): No selection -> Animation-level properties (loop, fill mode, tracks)
  - State B (track): Track selected -> Track-level properties (categorized by trackType)
  - State C (keyframe): Keyframe selected -> Frame-level properties (categorized by keyframe type)
-->
<template>
  <div class="keyframe-property-panel">
    <!-- ===== State A: No Selection -> Guide Hint ===== -->
    <template v-if="selectionMode === 'none'">
      <div class="animation-overview">
        <div class="section-header">Animation Properties</div>
        <div class="overview-row">
          <span class="overview-label">Name</span>
          <span class="overview-value">{{ ctx.animationDef.name }}</span>
        </div>
        <div class="overview-row">
          <span class="overview-label">Tracks</span>
          <span class="overview-value">{{ ctx.allTracks.value.length }}</span>
        </div>
        <div class="section-divider" />
        <div class="section-header">Default Playback Mode</div>
        <div class="timing-mode-options">
          <label
            class="timing-mode-option"
            :class="{ active: currentTimingMode === 'continuous' }"
          >
            <input
              type="radio"
              name="animation-timing-mode"
              value="continuous"
              :checked="currentTimingMode === 'continuous'"
              @change="onTimingModeChange('continuous')"
            >
            <span>Continuous Playback</span>
          </label>
          <label
            class="timing-mode-option"
            :class="{ active: currentTimingMode === 'tts_speech' }"
          >
            <input
              type="radio"
              name="animation-timing-mode"
              value="tts_speech"
              :checked="currentTimingMode === 'tts_speech'"
              @change="onTimingModeChange('tts_speech')"
            >
            <span>Follow TTS Voiced Segments</span>
          </label>
        </div>
        <div class="panel-empty-hint compact">
          <div class="hint-text">Click on a track or keyframe in the timeline below to edit details</div>
        </div>
      </div>
    </template>

    <!-- ===== State B: Track-Level Properties ===== -->
    <template v-else-if="selectionMode === 'track'">
      <div class="section-header">Track: {{ trackTypeLabel(currentTrackAny!) }}</div>
      <div class="field-row">
        <label>Display Name</label>
        <input
          type="text"
          class="text-input"
          :value="currentTrackAny?.displayName ?? ''"
          placeholder="Optional"
          maxlength="40"
          @change="onDisplayNameInput"
        />
      </div>
      <div class="field-row">
        <label>Target</label>
        <div class="target-picker" @pointerdown.stop>
          <button
            class="target-picker-trigger"
            :class="{ active: showTargetPicker }"
            title="Select target object"
            @click="toggleTargetPicker"
          >
            <span class="target-picker-label">{{ currentTargetLabel }}</span>
            <span class="target-picker-arrow">{{ showTargetPicker ? '▲' : '▼' }}</span>
          </button>
          <div v-if="showTargetPicker" class="target-picker-popover">
            <button
              class="target-tree-row"
              :class="{ selected: currentTargetValue === TARGET_SELF }"
              @click="selectTarget(TARGET_SELF)"
            >
              <span class="tree-spacer" />
              <span class="target-icon">🎯</span>
              <span class="target-name">Self</span>
            </button>
            <button
              v-for="node in flatTargetNodes"
              :key="node.id"
              class="target-tree-row"
              :class="{ selected: node.id === currentTargetValue }"
              :style="node.depth > 0 ? { paddingLeft: (8 + node.depth * 18) + 'px' } : {}"
              @click="selectTarget(node.id)"
            >
              <span
                v-if="node.hasChildren"
                class="tree-toggle"
                @click.stop="toggleTargetExpanded(node.id)"
              >
                {{ expandedTargetIds.has(node.id) ? '▼' : '▶' }}
              </span>
              <span v-else class="tree-spacer" />
              <span class="target-icon">{{ node.icon }}</span>
              <span class="target-name">{{ node.name }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- TransformTrack Settings -->
      <template v-if="currentTrackAny?.trackType === 'transform'">
        <div class="section-divider" />
        <div class="section-header">Timing</div>
        <div class="field-row">
          <label>Duration</label>
          <div class="duration-mode">
            <label><input type="radio" :checked="durationMode === 'fixed'" @change="setDurationMode('fixed')" /> Fixed</label>
            <input v-if="durationMode === 'fixed'" type="number" :value="currentTrackDurationValue" min="10" step="10" class="duration-input" @change="onDurationInput" />
            <span v-if="durationMode === 'fixed'" class="unit">ms</span>
            <label><input type="radio" :checked="durationMode === 'auto'" @change="setDurationMode('auto')" /> Auto</label>
          </div>
        </div>
        <div class="easing-section">
          <label class="easing-label">Easing</label>
          <EasingPicker :model-value="currentEasing" @update:model-value="onEasingChange" />
        </div>
        <div class="section-divider" />
        <div class="section-header">Basic</div>
        <div class="field-row">
          <label>Pivot</label>
          <div class="field-pair">
            <span class="field-label">X</span>
            <input type="number" :value="pivotDisplayPx.x" step="1" @change="e => onPivotInput('x', e)" />
          </div>
          <div class="field-pair">
            <span class="field-label">Y</span>
            <input type="number" :value="pivotDisplayPx.y" step="1" @change="e => onPivotInput('y', e)" />
          </div>
          <span class="unit">px</span>
          <span v-if="!hasPivotSet" class="default-hint">
            ({{ pivotDefaultIsApproximate ? 'Default ≈' : 'Default' }})
          </span>
        </div>
        <PivotEditorPanel
          v-if="pivotPanelResourceInfo"
          :key="pivotPanelKey"
          :resource-type="pivotPanelResourceInfo.resourceType"
          :resource-id="pivotPanelResourceInfo.resourceId"
          :scene-object-id="pivotPanelResourceInfo.sceneObjectId"
          :target-object-id="pivotPanelResourceInfo.targetObjectId"
          :has-pivot-set="hasPivotSet"
          :effective-pivot="resolvedPivot"
          @pivot-change="onPivotVisualChange"
          @pivot-reset="onPivotReset"
        />
      </template>

      <!-- VisibilityTrack Settings -->
      <template v-else-if="currentTrackAny?.trackType === 'visibility'">
        <div class="section-divider" />
        <div class="section-header">Timing</div>
        <div class="field-row">
          <label>Duration</label>
          <div class="duration-mode">
            <label><input type="radio" :checked="durationMode === 'fixed'" @change="setDurationMode('fixed')" /> Fixed</label>
            <input v-if="durationMode === 'fixed'" type="number" :value="currentTrackDurationValue" min="10" step="10" class="duration-input" @change="onDurationInput" />
            <span v-if="durationMode === 'fixed'" class="unit">ms</span>
            <label><input type="radio" :checked="durationMode === 'auto'" @change="setDurationMode('auto')" /> Auto</label>
          </div>
        </div>
        <div class="easing-section">
          <label class="easing-label">Easing</label>
          <EasingPicker :model-value="currentEasing" @update:model-value="onEasingChange" />
        </div>
      </template>

      <!-- FrameSequenceTrack Settings -->
      <template v-else-if="currentTrackAny?.trackType === 'frame_sequence'">
        <div class="section-divider" />
        <div class="field-row">
          <label>Frame Rate</label>
          <div class="duration-mode">
            <label><input type="radio" :checked="!hasCustomFps" @change="setFpsMode('source')" /> Follow Asset</label>
            <label><input type="radio" :checked="hasCustomFps" @change="setFpsMode('custom')" /> Custom</label>
            <input v-if="hasCustomFps" type="number" :value="(currentTrackAny as FrameSequenceTrack).fps ?? sourceFps" min="1" max="60" step="1" class="duration-input" @change="onFpsInput" />
            <span v-if="hasCustomFps" class="unit">fps</span>
          </div>
          <span v-if="!hasCustomFps" class="default-hint">(Asset: {{ sourceFps }} fps)</span>
        </div>
        <div class="field-row">
          <label>Loop</label>
          <input type="checkbox" :checked="(currentTrackAny as FrameSequenceTrack).loop ?? true" @change="onFrameSeqLoopChange" />
        </div>
      </template>

      <!-- EffectTrack Settings -->
      <template v-else-if="currentTrackAny?.trackType === 'effect'">
        <EffectParamsEditor
          :track="currentTrackAny as EffectTrack"
          :unsupported-effect-types="effectUnsupportedTypes"
          @update="onEffectUpdate"
        />
      </template>

      <div class="section-divider" />
      <div class="quick-actions">
        <button class="btn-sm btn-danger" @click="onDeleteTrack">Delete Track</button>
      </div>
    </template>

    <!-- ===== State C: Keyframe Properties ===== -->
    <template v-else>
      <!-- TransformKeyframe -->
      <template v-if="currentTrackAny?.trackType === 'transform'">
        <div class="frame-bar">
          <select class="frame-select" :value="selectedIndex" @change="onFrameSelect">
            <option
              v-for="(frame, index) in ctx.keyframes.value"
              :key="index"
              :value="index"
            >
              Frame {{ index + 1 }} / {{ ctx.keyframes.value.length }} · {{ Math.round(frame.time * 100) }}%
            </option>
          </select>
          <span class="frame-bar-hint" title="Add/copy/paste/delete keyframes in timeline toolbar">⓵ Operate frames via timeline toolbar</span>
        </div>

        <div class="field-row">
          <label>Time</label>
          <input type="number" :value="timePercent" min="0" max="100" step="1" :disabled="isInterpolated" @change="onTimeInput" />
          <span class="unit">%</span>
        </div>

        <div class="section-divider" />
        <div class="section-header">
          Transform
          <span v-if="isKeyframeSplit" class="mode-badge" title="Split keyframe: values arriving at and leaving this frame differ, jumping instantly on timeline">Split</span>
        </div>

        <!-- === Smooth State: Single Column Edit (Default) === -->
        <div v-if="!isKeyframeSplit" :class="['field-group', { 'interpolated': isInterpolated }]">
          <div class="field-row">
            <label>Position</label>
            <div class="field-pair">
              <span class="field-label">X</span>
              <input type="number" :value="Math.round(displayValues.x)" step="1" :disabled="isInterpolated" @change="e => onValueInput('x', e)" />
            </div>
            <div class="field-pair">
              <span class="field-label">Y</span>
              <input type="number" :value="Math.round(displayValues.y)" step="1" :disabled="isInterpolated" @change="e => onValueInput('y', e)" />
            </div>
          </div>

          <div class="field-row">
            <label>Scale</label>
            <div class="field-pair">
              <span class="field-label">X</span>
              <input type="number" :value="Math.round(displayValues.scaleX * 100)" step="1" :disabled="isInterpolated" @change="e => onScaleInput('scaleX', e)" />
            </div>
            <div class="field-pair">
              <span class="field-label">Y</span>
              <input type="number" :value="Math.round(displayValues.scaleY * 100)" step="1" :disabled="isInterpolated" @change="e => onScaleInput('scaleY', e)" />
            </div>
            <button class="btn-link" :class="{ active: scaleLocked }" title="Lock Aspect Ratio" @click="scaleLocked = !scaleLocked">🔗</button>
          </div>

          <div class="field-row">
            <label>Rotation</label>
            <input type="number" :value="displayRotationDeg" step="1" :disabled="isInterpolated" @change="onRotationInput" />
            <span class="unit">°</span>
            <label class="checkbox-inline">
              <input type="checkbox" :checked="displayValues.flipX" :disabled="isInterpolated" @change="onFlipXChange" />
              Flip
            </label>
          </div>
        </div>

        <!-- === Split State: Dual Column Comparison Edit === -->
        <div v-else :class="['field-group', 'split-group', { 'interpolated': isInterpolated }]">
          <div class="split-hint">Split keyframe: Animation jumps instantly from 'Value In' to 'Value Out' at this moment.</div>
          <div class="split-col-header-row">
            <span class="split-label-spacer"></span>
            <span class="split-col-header">Value In</span>
            <span class="split-col-arrow-spacer"></span>
            <span class="split-col-header">Value Out</span>
            <span class="split-sync-spacer"></span>
          </div>

          <div class="split-row" :class="{ 'has-diff': Math.round(displayValues.x) !== Math.round(valueOutDisplay.x) }">
            <label class="split-label">Position X</label>
            <input class="split-input" type="number" :value="Math.round(displayValues.x)" step="1" :disabled="isInterpolated" @change="e => onValueInput('x', e)" />
            <span class="split-arrow">→</span>
            <input class="split-input" type="number" :value="Math.round(valueOutDisplay.x)" step="1" :disabled="isInterpolated" @change="e => onOutValueInput('x', e)" />
            <button class="btn-sync" :disabled="isInterpolated || Math.round(displayValues.x) === Math.round(valueOutDisplay.x)" title="Sync Value Out with Value In" @click="syncSplitField('x')">⇆</button>
          </div>

          <div class="split-row" :class="{ 'has-diff': Math.round(displayValues.y) !== Math.round(valueOutDisplay.y) }">
            <label class="split-label">Position Y</label>
            <input class="split-input" type="number" :value="Math.round(displayValues.y)" step="1" :disabled="isInterpolated" @change="e => onValueInput('y', e)" />
            <span class="split-arrow">→</span>
            <input class="split-input" type="number" :value="Math.round(valueOutDisplay.y)" step="1" :disabled="isInterpolated" @change="e => onOutValueInput('y', e)" />
            <button class="btn-sync" :disabled="isInterpolated || Math.round(displayValues.y) === Math.round(valueOutDisplay.y)" title="Sync Value Out with Value In" @click="syncSplitField('y')">⇆</button>
          </div>

          <div class="split-row" :class="{ 'has-diff': Math.round(displayValues.scaleX * 100) !== Math.round(valueOutDisplay.scaleX * 100) }">
            <label class="split-label">Scale X<span class="unit">%</span></label>
            <input class="split-input" type="number" :value="Math.round(displayValues.scaleX * 100)" step="1" :disabled="isInterpolated" @change="e => onScaleInput('scaleX', e)" />
            <span class="split-arrow">→</span>
            <input class="split-input" type="number" :value="Math.round(valueOutDisplay.scaleX * 100)" step="1" :disabled="isInterpolated" @change="e => onOutScaleInput('scaleX', e)" />
            <button class="btn-sync" :disabled="isInterpolated || Math.round(displayValues.scaleX * 100) === Math.round(valueOutDisplay.scaleX * 100)" title="Sync Value Out with Value In" @click="syncSplitField('scaleX')">⇆</button>
          </div>

          <div class="split-row" :class="{ 'has-diff': Math.round(displayValues.scaleY * 100) !== Math.round(valueOutDisplay.scaleY * 100) }">
            <label class="split-label">Scale Y<span class="unit">%</span></label>
            <input class="split-input" type="number" :value="Math.round(displayValues.scaleY * 100)" step="1" :disabled="isInterpolated" @change="e => onScaleInput('scaleY', e)" />
            <span class="split-arrow">→</span>
            <input class="split-input" type="number" :value="Math.round(valueOutDisplay.scaleY * 100)" step="1" :disabled="isInterpolated" @change="e => onOutScaleInput('scaleY', e)" />
            <button class="btn-sync" :disabled="isInterpolated || Math.round(displayValues.scaleY * 100) === Math.round(valueOutDisplay.scaleY * 100)" title="Sync Value Out with Value In" @click="syncSplitField('scaleY')">⇆</button>
          </div>

          <div class="split-row" :class="{ 'has-diff': displayRotationDeg !== valueOutRotationDeg }">
            <label class="split-label">Rotation<span class="unit">°</span></label>
            <input class="split-input" type="number" :value="displayRotationDeg" step="1" :disabled="isInterpolated" @change="onRotationInput" />
            <span class="split-arrow">→</span>
            <input class="split-input" type="number" :value="valueOutRotationDeg" step="1" :disabled="isInterpolated" @change="onOutRotationInput" />
            <button class="btn-sync" :disabled="isInterpolated || displayRotationDeg === valueOutRotationDeg" title="Sync Value Out with Value In" @click="syncSplitField('rotation')">⇆</button>
          </div>

          <div class="split-row" :class="{ 'has-diff': displayValues.flipX !== valueOutDisplay.flipX }">
            <label class="split-label">Flip</label>
            <span class="split-input split-checkbox-cell">
              <input type="checkbox" :checked="displayValues.flipX" :disabled="isInterpolated" @change="onFlipXChange" />
            </span>
            <span class="split-arrow">→</span>
            <span class="split-input split-checkbox-cell">
              <input type="checkbox" :checked="valueOutDisplay.flipX" :disabled="isInterpolated" @change="onOutFlipXChange" />
            </span>
            <button class="btn-sync" :disabled="isInterpolated || displayValues.flipX === valueOutDisplay.flipX" title="Sync Value Out with Value In" @click="syncSplitField('flipX')">⇆</button>
          </div>
        </div>

        <div class="section-divider" />
        <div class="quick-actions">
          <button class="btn-sm" title="Reset frame to defaults" :disabled="isInterpolated" @click="ctx.resetKeyframe(selectedIndex)">Reset Frame</button>
          <button
            v-if="!isKeyframeSplit"
            class="btn-sm"
            title="Switch to split keyframe: allows setting different Value In and Value Out"
            :disabled="isInterpolated"
            @click="onSplitKeyframe"
          >Convert to Split Keyframe</button>
          <button
            v-else
            class="btn-sm"
            title="Switch to smooth keyframe: merge Value In and Value Out into a single value"
            @click="onMergeKeyframe"
          >Convert to Smooth Keyframe</button>
        </div>
      </template>

      <!-- VisibilityKeyframe -->
      <template v-else-if="currentTrackAny?.trackType === 'visibility'">
        <div class="frame-bar">
          <select class="frame-select" :value="selectedIndex" @change="onFrameSelect">
            <option
              v-for="(frame, index) in visibilityKeyframes"
              :key="index"
              :value="index"
            >
              Frame {{ index + 1 }} / {{ visibilityKeyframes.length }} · {{ Math.round((frame.time ?? 0) * 100) }}%
            </option>
          </select>
          <span class="frame-bar-hint" title="Add/copy/paste/delete keyframes in timeline toolbar">⓵ Operate frames via timeline toolbar</span>
        </div>

        <div class="field-row">
          <label>Time</label>
          <input type="number" :value="visibilityTimePercent" min="0" max="100" step="1" @change="onVisibilityTimeInput" />
          <span class="unit">%</span>
        </div>

        <div class="section-divider" />
        <div class="section-header">
          Opacity
          <span v-if="isVisibilityKeyframeSplit" class="mode-badge" title="Split keyframe: Alpha In and Alpha Out differ, jumping instantly on timeline">Split</span>
        </div>
        <div v-if="!isVisibilityKeyframeSplit" class="field-row">
          <label>Alpha</label>
          <input type="number" :value="visibilityAlpha" min="0" max="1" step="0.1" @change="onVisibilityAlphaInput" />
        </div>
        <div v-else class="field-group split-group">
          <div class="split-hint">Split keyframe: Alpha jumps instantly from 'Value In' to 'Value Out' at this moment.</div>
          <div class="split-col-header-row">
            <span class="split-label-spacer"></span>
            <span class="split-col-header">Value In</span>
            <span class="split-col-arrow-spacer"></span>
            <span class="split-col-header">Value Out</span>
            <span class="split-sync-spacer"></span>
          </div>
          <div class="split-row" :class="{ 'has-diff': visibilityAlpha !== visibilityAlphaOut }">
            <label class="split-label">Alpha</label>
            <input class="split-input" type="number" :value="visibilityAlpha" min="0" max="1" step="0.1" @change="onVisibilityAlphaInput" />
            <span class="split-arrow">→</span>
            <input class="split-input" type="number" :value="visibilityAlphaOut" min="0" max="1" step="0.1" @change="onVisibilityAlphaOutInput" />
            <button class="btn-sync" :disabled="visibilityAlpha === visibilityAlphaOut" title="Sync Value Out with Value In" @click="syncVisibilityAlpha">⇆</button>
          </div>
        </div>

        <div class="section-divider" />
        <div class="quick-actions">
          <button
            v-if="!isVisibilityKeyframeSplit"
            class="btn-sm"
            title="Switch to split keyframe: allows setting different Alpha In and Alpha Out"
            @click="onSplitVisibilityKeyframe"
          >Convert to Split Keyframe</button>
          <button
            v-else
            class="btn-sm"
            title="Switch to smooth keyframe: merge Value In and Value Out into a single value"
            @click="onMergeVisibilityKeyframe"
          >Convert to Smooth Keyframe</button>
        </div>
      </template>
    </template>

    <div v-if="deleteTrackDialog" class="panel-dialog-overlay" @click.self="cancelDeleteTrack">
      <div class="panel-dialog">
        <p class="panel-dialog-title">{{ deleteTrackDialog.title }}</p>
        <p class="panel-dialog-message">{{ deleteTrackDialog.message }}</p>
        <div class="panel-dialog-actions">
          <button class="btn-sm" @click="cancelDeleteTrack">Cancel</button>
          <button class="btn-danger" @click="confirmDeleteTrack">Delete</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { AnimationEditContext } from '@/composables/useAnimationEdit'
import { useBackgroundStore } from '@/stores/backgroundStore'
import { useExpressionStore } from '@/stores/expressionStore'
import { usePropStore } from '@/stores/propStore'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import type {
  AnimationTimingMode,
  AnimationTrack,
  DynamicEffectType,
  EffectTrack,
  FrameSequenceTrack,
} from '@/types/animation'
import { TARGET_SELF } from '@/types/animation'
import type { CompositeObject, SceneObject, SymbolObject } from '@/types/sceneObject'

import EasingPicker from './EasingPicker.vue'
import EffectParamsEditor from './EffectParamsEditor.vue'
import PivotEditorPanel from './PivotEditorPanel.vue'
import { resolveTrackTargetDisplay } from './trackDisplay'

interface TargetTreeNode {
  id: string
  name: string
  icon: string
  depth: number
  children: TargetTreeNode[]
}

interface FlatTargetTreeNode {
  id: string
  name: string
  icon: string
  depth: number
  hasChildren: boolean
}

interface DeleteTrackDialogState {
  trackIndex: number
  title: string
  message: string
}

type EffectUnsupportedMap = Partial<Record<DynamicEffectType, string>>

const props = defineProps<{
  ctx: AnimationEditContext
  sceneObject?: SceneObject | undefined
  sceneObjects?: SceneObject[] | undefined
  targetOptions: { id: string; label: string }[]
  targetTreeNodes: TargetTreeNode[]
  getDefaultPivot?: (objectId: string | null) => { x: number; y: number } | null
}>()

const emit = defineEmits<{
  /**
   * User submits new pivot in panel (number input or PivotEditorPanel drag).
   * Parent component performs per-keyframe (R*S - f*I)*dOrigin compensation before writing track.pivot.
   */
  'pivot-change': [pivot: { x: number; y: number }]
  /** Clear track.pivot, fallback to object default pivot. */
  'pivot-reset': []
}>()

const scaleLocked = ref(true)
const sceneObjectStore = useSceneObjectStore()
const expressionStore = useExpressionStore()
const propStore = usePropStore()
const backgroundStore = useBackgroundStore()
const showTargetPicker = ref(false)
const expandedTargetIds = ref(new Set<string>())

const currentTimingMode = computed(() => props.ctx.animationDef.timingMode ?? 'continuous')

function onTimingModeChange(timingMode: AnimationTimingMode) {
  props.ctx.updateTimingMode(timingMode)
}

// ===== FrameSequenceTrack Asset Source FPS/Loop =====

/** Asset source FPS (used when track.fps is undefined) */
const sourceFps = computed(() => {
  const obj = props.sceneObject
  if (!obj) return 25

  if (obj.type === 'expression') {
    const expr = expressionStore.getExpression(obj.refId)
    return expr?.speakingFps ?? 12
  }
  if (obj.type === 'prop') {
    const prop = propStore.getProp(obj.refId)
    return prop?.fps ?? 25
  }
  if (obj.type === 'symbol') {
    const symbolObj = obj as SymbolObject
    const materialId = symbolObj.currentMaterialId
    const material = materialId
      ? symbolObj.materials?.find(m => m.id === materialId)
      : symbolObj.materials?.[0]
    if (material?.type === 'animation') {
      return material.fps ?? 12
    }
    return 12
  }
  if (obj.type === 'background') {
    const bg = backgroundStore.backgrounds.find(b => b.id === obj.refId)
    return (bg as { fps?: number } | undefined)?.fps ?? 25
  }
  return 25
})

/** Whether user customized FPS */
const hasCustomFps = computed(() => {
  const track = currentTrackAny.value as FrameSequenceTrack | undefined
  return track?.trackType === 'frame_sequence' && track.fps !== undefined
})

const deleteTrackDialog = ref<DeleteTrackDialogState | null>(null)

// ===== Selection Mode =====

const selectionMode = computed(() => props.ctx.selectionMode.value)
const currentTrackAny = computed(() => props.ctx.currentTrackAny.value)
const selectedKeyframeIndexRef = props.ctx.selectedKeyframeIndex

// ===== Track display helpers =====

function trackTypeLabel(track: AnimationTrack): string {
  if (track.trackType === 'effect') return `Effect:${(track).effectParams.type}`
  const labels: Record<string, string> = { transform: 'Transform', visibility: 'Opacity', frame_sequence: 'Frame Seq', effect: 'Effect' }
  return labels[track.trackType] ?? track.trackType
}

function targetLabel(track: AnimationTrack): string {
  if (track.displayName?.trim()) return track.displayName.trim()
  const display = resolveTrackTargetDisplay({
    track,
    sceneObject: props.sceneObject,
    getObjectName,
  })
  return display.secondary ? `${display.primary} · ${display.secondary}` : display.primary
}

function getObjectName(objectId: string): string | undefined {
  const object = getSceneObjectById(objectId)
  return object?.alias?.trim() || object?.name?.trim() || undefined
}

function getSceneObjectById(objectId: string | null | undefined): SceneObject | null {
  if (!objectId) return null
  const local = props.sceneObjects?.find(obj => obj.id === objectId)
  if (local) return local
  return sceneObjectStore.getObject(objectId) ?? null
}

function getCompositeContentBounds(object: SceneObject): { x: number; y: number; width: number; height: number } {
  if (object.type !== 'composite') {
    return {
      x: 0,
      y: 0,
      width: object.width,
      height: object.height,
    }
  }

  const composite = object as CompositeObject
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const childId of composite.childIds ?? []) {
    const child = getSceneObjectById(childId)
    if (!child) continue

    const childBounds = getCompositeContentBounds(child)
    minX = Math.min(minX, child.x + childBounds.x)
    minY = Math.min(minY, child.y + childBounds.y)
    maxX = Math.max(maxX, child.x + childBounds.x + childBounds.width)
    maxY = Math.max(maxY, child.y + childBounds.y + childBounds.height)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return {
      x: 0,
      y: 0,
      width: object.width,
      height: object.height,
    }
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  }
}

function getPivotDisplayRect(object: SceneObject | null): { x: number; y: number; width: number; height: number } | null {
  if (!object) return null

  if (object.type === 'composite') {
    const bounds = getCompositeContentBounds(object)
    if (bounds.width > 0 && bounds.height > 0) return bounds
  }

  if (object.width <= 0 || object.height <= 0) return null
  return {
    x: 0,
    y: 0,
    width: object.width,
    height: object.height,
  }
}


// ===== State B: Track-level shared =====

const currentEasing = computed(() =>
  props.ctx.currentTrack.value?.easing ?? props.ctx.currentVisibilityTrack.value?.easing ?? 'linear'
)

const currentTargetValue = computed(() => currentTrackAny.value?.targetObjectId ?? TARGET_SELF)

const flatTargetNodes = computed<FlatTargetTreeNode[]>(() => {
  const result: FlatTargetTreeNode[] = []

  function walk(nodes: TargetTreeNode[]): void {
    for (const node of nodes) {
      result.push({
        id: node.id,
        name: node.name,
        icon: node.icon,
        depth: node.depth,
        hasChildren: node.children.length > 0,
      })
      if (node.children.length > 0 && expandedTargetIds.value.has(node.id)) {
        walk(node.children)
      }
    }
  }

  walk(props.targetTreeNodes)
  return result
})

const currentTargetLabel = computed(() => {
  const current = currentTargetValue.value
  if (current === TARGET_SELF) return 'Self'
  const node = findTargetNode(current, props.targetTreeNodes)
  if (node) return `${node.icon} ${node.name}`
  return props.targetOptions.find(option => option.id === current)?.label ?? current
})

watch(
  () => props.targetTreeNodes,
  () => {
    if (expandedTargetIds.value.size > 0) return
    const rootIds = props.targetTreeNodes
      .filter(node => node.children.length > 0)
      .map(node => node.id)
    if (rootIds.length > 0) {
      expandedTargetIds.value = new Set(rootIds)
    }
  },
  { immediate: true },
)

function findTargetNode(id: string, nodes: TargetTreeNode[]): TargetTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findTargetNode(id, node.children)
    if (child) return child
  }
  return null
}

function toggleTargetPicker(): void {
  showTargetPicker.value = !showTargetPicker.value
}

function toggleTargetExpanded(id: string): void {
  const next = new Set(expandedTargetIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  expandedTargetIds.value = next
}

function selectTarget(value: string): void {
  const track = currentTrackAny.value
  if (!track) return
  track.targetObjectId = value || TARGET_SELF
  showTargetPicker.value = false
}

function closeTargetPicker(): void {
  showTargetPicker.value = false
}

const durationMode = computed(() => {
  const track = currentTrackAny.value
  if (!track) return 'fixed'
  if ('duration' in track) {
    return (track as { duration?: number | 'auto' }).duration === 'auto' ? 'auto' : 'fixed'
  }
  return 'fixed'
})

const currentTrackDurationValue = computed(() => {
  const track = currentTrackAny.value
  if (!track || !('duration' in track)) return props.ctx.trackDuration.value
  const duration = (track as { duration?: number | 'auto' }).duration
  return typeof duration === 'number' && Number.isFinite(duration) ? duration : 1000
})

function onEasingChange(value: string) {
  props.ctx.updateEasing(value)
}

function onDurationInput(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value)
  if (isNaN(val) || val < 10) return
  props.ctx.updateDuration(val)
}

function setDurationMode(mode: 'fixed' | 'auto') {
  if (mode === 'auto') props.ctx.updateDuration('auto')
  else props.ctx.updateDuration(1000)
}

// Pivot (transform track only)
const currentTargetSceneObject = computed(() => {
  const targetId = currentTargetValue.value
  if (targetId === TARGET_SELF) {
    const rootId = props.sceneObject?.id
    if (rootId) {
      const rootObject = getSceneObjectById(rootId)
      if (rootObject) return rootObject
    }
    return props.sceneObject ?? null
  }
  return getSceneObjectById(targetId)
})

const currentTargetObjectId = computed(() => {
  const targetId = currentTargetValue.value
  if (targetId === TARGET_SELF) return props.sceneObject?.id ?? TARGET_SELF
  return targetId
})

const effectUnsupportedTypes = computed<EffectUnsupportedMap>(() => {
  const target = currentTargetSceneObject.value
  if (!isUnionCompositeObject(target)) return {}

  const reason = 'Union composite does not support this effect'
  return {
    wave: reason,
    ribbon: reason,
    glow: reason,
    motion_blur: reason,
  }
})

function isUnionCompositeObject(object: SceneObject | null): boolean {
  return object?.type === 'composite'
    && ((object as CompositeObject).compositeMode ?? 'entity') === 'union'
}

const pivotDisplayRect = computed(() => getPivotDisplayRect(currentTargetSceneObject.value))

/**
 * PivotEditorPanel asset info: prioritize scene object matching targetObjectId of active track,
 * otherwise fallback to root sceneObject.
 */
const pivotPanelResourceInfo = computed<{
  resourceType: 'prop' | 'background' | 'symbol' | 'composite' | 'expression'
  resourceId: string
  sceneObjectId: string | undefined
  targetObjectId: string | undefined
} | null>(() => {
  const target = currentTargetSceneObject.value
  if (!target) return null
  const supportedTypes = ['prop', 'background', 'symbol', 'composite', 'expression'] as const
  type SupportedType = typeof supportedTypes[number]
  if (!supportedTypes.includes(target.type as SupportedType)) return null
  return {
    resourceType: target.type as SupportedType,
    resourceId: target.refId ?? target.id,
    sceneObjectId: target.id,
    targetObjectId: currentTargetValue.value !== TARGET_SELF ? currentTargetValue.value : undefined,
  }
})

// Default pixel pivot = object container.pivot equivalent value (aligned with useSceneGraph)
// - composite / expression: PivotBase = (0,0) -> pivot = (originX, originY), exact
// - Other types: PivotBase ≈ bounds center, cannot read localBounds.x/y offline:
//     - With width/height: (width/2 + originX, height/2 + originY)
//       sprite/text/graphics localBounds starts at (0,0), consistent with runtime;
//       for objects whose localBounds does not start at (0,0), value is approximate,
//       indicated by '≈' symbol in UI;
//     - Without width/height: fallback to (originX, originY).
// User input value is always written to track as real pixel coordinates directly.
const defaultPixelPivot = computed(() => {
  const target = currentTargetSceneObject.value
  const runtimeDefault = props.getDefaultPivot?.(currentTargetObjectId.value)
  if (runtimeDefault) return runtimeDefault

  if (!target) return { x: 0, y: 0 }
  const originX = target.transformOriginX ?? 0
  const originY = target.transformOriginY ?? 0
  if (target.type === 'composite' || target.type === 'expression') {
    return { x: originX, y: originY }
  }
  const rect = pivotDisplayRect.value
  if (!rect) return { x: originX, y: originY }
  return {
    x: rect.x + rect.width / 2 + originX,
    y: rect.y + rect.height / 2 + originY,
  }
})

// composite / expression defaults can be derived exactly; others approximate due to lacking localBounds.x/y.
const pivotDefaultIsApproximate = computed(() => {
  if (props.getDefaultPivot?.(currentTargetObjectId.value)) return false
  const target = currentTargetSceneObject.value
  if (!target) return false
  return target.type !== 'composite' && target.type !== 'expression'
})

const resolvedPivot = computed(() => props.ctx.currentTrack.value?.pivot ?? defaultPixelPivot.value)

const hasPivotSet = computed(() => props.ctx.currentTrack.value?.pivot !== undefined)

// pivot is already local pixel coordinates, display directly
const pivotDisplayPx = computed(() => ({
  x: Math.round(resolvedPivot.value.x),
  y: Math.round(resolvedPivot.value.y),
}))

const pivotPanelKey = computed(() => {
  const info = pivotPanelResourceInfo.value
  if (!info) return 'pivot-panel:none'
  return [
    info.resourceType,
    info.resourceId,
    info.sceneObjectId ?? '',
    info.targetObjectId ?? '',
  ].join(':')
})

function onPivotInput(axis: 'x' | 'y', e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  if (isNaN(val)) return
  const current = resolvedPivot.value
  // v26: No longer ctx.updatePivot directly — parent component executes per-keyframe x/y compensation
  emit('pivot-change', { ...current, [axis]: val })
}

function onPivotVisualChange(pivot: { x: number; y: number }) {
  emit('pivot-change', pivot)
}

function onPivotReset() {
  emit('pivot-reset')
}

// FrameSequenceTrack
function onFpsInput(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value)
  if (isNaN(val) || val < 1) return
  props.ctx.updateFrameSequenceTrack({ fps: val })
}

function onFrameSeqLoopChange(e: Event) {
  props.ctx.updateFrameSequenceTrack({ loop: (e.target as HTMLInputElement).checked })
}

function setFpsMode(mode: 'source' | 'custom') {
  const track = props.ctx.currentFrameSequenceTrack.value
  if (!track) return
  if (mode === 'source') {
    delete (track as { fps?: number }).fps
  } else {
    track.fps = sourceFps.value
  }
}


// EffectTrack
function onEffectUpdate(updatedTrack: EffectTrack) {
  props.ctx.updateEffectParams(updatedTrack.effectParams)
}

function onDisplayNameInput(e: Event) {
  const track = currentTrackAny.value
  if (!track) return
  const value = (e.target as HTMLInputElement).value.trim()
  if (value) track.displayName = value
  else delete track.displayName
}

function onDeleteTrack() {
  const idx = props.ctx.currentTrackIndex.value
  if (idx < 0) return
  const track = currentTrackAny.value
  const keyframeCount = track && (track.trackType === 'transform' || track.trackType === 'visibility') ? track.keyframes.length : 0
  const label = track ? targetLabel(track) : 'Current Track'
  deleteTrackDialog.value = {
    trackIndex: idx,
    title: `Delete Track "${label}"`, 
    message: keyframeCount > 0
      ? `This track contains ${keyframeCount} keyframe(s); deletion cannot be undone.`
      : 'Track deletion cannot be undone.',
  }
}

function cancelDeleteTrack(): void {
  deleteTrackDialog.value = null
}

function confirmDeleteTrack(): void {
  const target = deleteTrackDialog.value
  deleteTrackDialog.value = null
  if (!target) return
  props.ctx.removeTrack(target.trackIndex)
}

// ===== State C: Keyframe-level =====

const selectedIndex = computed(() => props.ctx.selectedKeyframeIndex.value)

const isInterpolated = computed(() => {
  const idx = props.ctx.findKeyframeAtTime(props.ctx.playheadPosition.value)
  return idx < 0
})

// TransformKeyframe display
const displayValues = computed(() => {
  const kf = props.ctx.selectedKeyframe.value
  if (kf && !isInterpolated.value) {
    return {
      x: kf.x ?? 0,
      y: kf.y ?? 0,
      scaleX: kf.scaleX ?? 1,
      scaleY: kf.scaleY ?? 1,
      rotation: kf.rotation ?? 0,
      flipX: kf.flipX ?? false,
    }
  }
  const output = props.ctx.currentOutput.value
  if (output) {
    return {
      x: output.x, y: output.y,
      scaleX: output.scaleX, scaleY: output.scaleY,
      rotation: output.rotation, flipX: output.flipX ?? false,
    }
  }
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, flipX: false }
})

const timePercent = computed(() => {
  const kf = props.ctx.selectedKeyframe.value
  if (kf) return Math.round(kf.time * 100)
  return Math.round(props.ctx.playheadPosition.value * 100)
})

const displayRotationDeg = computed(() =>
  Math.round((displayValues.value.rotation * 180) / Math.PI)
)

function onTimeInput(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  if (isNaN(val)) return
  props.ctx.updateKeyframe(selectedIndex.value, { time: Math.max(0, Math.min(100, val)) / 100 })
}

function onFrameSelect(e: Event) {
  const index = parseInt((e.target as HTMLSelectElement).value, 10)
  if (isNaN(index) || index < 0) return
  const frame = props.ctx.activeKeyframes.value[index]
  if (!frame) return
  selectedKeyframeIndexRef.value = index
  props.ctx.seekTo(frame.time)
}

function onValueInput(field: 'x' | 'y', e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  if (isNaN(val)) return
  props.ctx.updateKeyframe(selectedIndex.value, { [field]: val })
}

function onScaleInput(field: 'scaleX' | 'scaleY', e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  if (isNaN(val)) return
  const scaleVal = val / 100
  if (scaleLocked.value) {
    props.ctx.updateKeyframe(selectedIndex.value, { scaleX: scaleVal, scaleY: scaleVal })
  } else {
    props.ctx.updateKeyframe(selectedIndex.value, { [field]: scaleVal })
  }
}

function onRotationInput(e: Event) {
  const deg = parseFloat((e.target as HTMLInputElement).value)
  if (isNaN(deg)) return
  props.ctx.updateKeyframe(selectedIndex.value, { rotation: (deg * Math.PI) / 180 })
}

function onFlipXChange(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  if (checked) {
    props.ctx.updateKeyframe(selectedIndex.value, { flipX: true })
  } else {
    const kf = props.ctx.selectedKeyframe.value
    if (kf && 'flipX' in kf) delete kf.flipX
  }
}

// VisibilityKeyframe display
const visibilityKeyframes = computed(() => {
  const track = props.ctx.currentVisibilityTrack.value
  return track?.keyframes ?? []
})

const visibilityTimePercent = computed(() => {
  const kfs = visibilityKeyframes.value
  const idx = selectedIndex.value
  if (idx >= 0 && idx < kfs.length) {
    return Math.round((kfs[idx]?.time ?? 0) * 100)
  }
  return Math.round(props.ctx.playheadPosition.value * 100)
})

const visibilityAlpha = computed(() => {
  const kfs = visibilityKeyframes.value
  const idx = selectedIndex.value
  if (idx >= 0 && idx < kfs.length) {
    return kfs[idx]?.alpha ?? 1
  }
  return 1
})

function onVisibilityTimeInput(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  if (isNaN(val)) return
  props.ctx.updateVisibilityKeyframe(selectedIndex.value, { time: Math.max(0, Math.min(100, val)) / 100 })
}

function onVisibilityAlphaInput(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  if (isNaN(val)) return
  props.ctx.updateVisibilityKeyframe(selectedIndex.value, { alpha: Math.max(0, Math.min(1, val)) })
}

// ===== v13 (Scheme B): valueOut split edit =====

/** Whether currently selected keyframe is in 'split' state (at least one out field exists) */
const isKeyframeSplit = computed(() => {
  const kf = props.ctx.selectedKeyframe.value
  return props.ctx.isKeyframeStructurallySplit(kf)
})

const isVisibilityKeyframeSplit = computed(() => {
  const kfs = visibilityKeyframes.value
  const idx = selectedIndex.value
  if (idx < 0 || idx >= kfs.length) return false
  return props.ctx.isKeyframeStructurallySplit(kfs[idx])
})

/** valueOut display: falls back to valueIn if out field missing (fall-through semantics) */
const valueOutDisplay = computed(() => {
  const kf = props.ctx.selectedKeyframe.value
  if (!kf) return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, flipX: false }
  const out = kf.out ?? {}
  return {
    x: out.x ?? kf.x ?? 0,
    y: out.y ?? kf.y ?? 0,
    scaleX: out.scaleX ?? kf.scaleX ?? 1,
    scaleY: out.scaleY ?? kf.scaleY ?? 1,
    rotation: out.rotation ?? kf.rotation ?? 0,
    flipX: out.flipX ?? kf.flipX ?? false,
  }
})

const valueOutRotationDeg = computed(() =>
  Math.round((valueOutDisplay.value.rotation * 180) / Math.PI),
)

function onSplitKeyframe() {
  props.ctx.splitKeyframeAt(selectedIndex.value)
}

function onMergeKeyframe() {
  props.ctx.mergeKeyframeAt(selectedIndex.value)
}

function onOutValueInput(field: 'x' | 'y', e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  if (isNaN(val)) return
  props.ctx.updateKeyframeOut(selectedIndex.value, field, val)
}

function onOutScaleInput(field: 'scaleX' | 'scaleY', e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  if (isNaN(val)) return
  const scaleVal = val / 100
  if (scaleLocked.value) {
    props.ctx.updateKeyframeOut(selectedIndex.value, 'scaleX', scaleVal)
    props.ctx.updateKeyframeOut(selectedIndex.value, 'scaleY', scaleVal)
  } else {
    props.ctx.updateKeyframeOut(selectedIndex.value, field, scaleVal)
  }
}

function onOutRotationInput(e: Event) {
  const deg = parseFloat((e.target as HTMLInputElement).value)
  if (isNaN(deg)) return
  props.ctx.updateKeyframeOut(selectedIndex.value, 'rotation', (deg * Math.PI) / 180)
}

function onOutFlipXChange(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  props.ctx.updateKeyframeOut(selectedIndex.value, 'flipX', checked ? true : undefined)
}

/**
 * Sync 'Value Out' to 'Value In': under Scheme B fall-through semantics,
 * clearing out[field] is equivalent to reverting out to in.
 */
function syncSplitField(field: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'flipX') {
  props.ctx.updateKeyframeOut(selectedIndex.value, field, undefined)
}

// visibility valueOut
const visibilityAlphaOut = computed(() => {
  const kfs = visibilityKeyframes.value
  const idx = selectedIndex.value
  if (idx < 0 || idx >= kfs.length) return 1
  const kf = kfs[idx]
  return kf?.out?.alpha ?? kf?.alpha ?? 1
})

function onSplitVisibilityKeyframe() {
  props.ctx.splitKeyframeAt(selectedIndex.value)
}

function onMergeVisibilityKeyframe() {
  props.ctx.mergeKeyframeAt(selectedIndex.value)
}

function onVisibilityAlphaOutInput(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  if (isNaN(val)) return
  props.ctx.updateVisibilityKeyframeOut(selectedIndex.value, Math.max(0, Math.min(1, val)))
}

/**
 * Sync 'Alpha Out' to 'Alpha In': pass undefined to clear out.alpha,
 * reverting out to alpha in value.
 */
function syncVisibilityAlpha() {
  props.ctx.updateVisibilityKeyframeOut(selectedIndex.value, undefined)
}

onMounted(() => {
  document.addEventListener('pointerdown', closeTargetPicker)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeTargetPicker)
})
</script>

<style scoped>
.keyframe-property-panel {
  position: relative;
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  font-size: 12px;
  color: #333;
}

.panel-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.42);
}

.panel-dialog {
  width: 300px;
  padding: 18px 20px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.24);
}

.panel-dialog-title {
  margin: 0 0 8px;
  color: #111827;
  font-size: 14px;
  font-weight: 600;
  text-align: center;
}

.panel-dialog-message {
  margin: 0;
  color: #4b5563;
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}

.panel-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

/* Frame bar (merged frame selector + actions) */
.frame-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e0e3e8;
  flex-wrap: nowrap;
}

.frame-select {
  flex: 1;
  min-width: 112px;
}

.frame-bar .btn-sm {
  flex-shrink: 0;
}

.frame-bar-hint {
  font-size: 10px;
  color: #a0a4ad;
  white-space: nowrap;
  flex-shrink: 0;
}

.section-divider {
  height: 1px;
  background: #e0e3e8;
  margin: 10px 0;
}

.section-header {
  font-weight: 600;
  color: #888;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.split-hint {
  color: #888;
  font-size: 11px;
  margin-bottom: 6px;
  line-height: 1.4;
}

/* === Split keyframe dual-column comparison layout === */
.mode-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  background: #fff3e0;
  color: #c77700;
  border: 1px solid #f0c887;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  vertical-align: middle;
}

.split-group {
  background: #fafbfc;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
  padding: 8px 8px 4px;
}

.split-col-header-row {
  display: grid;
  grid-template-columns: 46px 1fr 14px 1fr 20px;
  gap: 4px;
  align-items: center;
  margin-bottom: 4px;
  padding-bottom: 4px;
  border-bottom: 1px dashed #e0e3e8;
}

.split-col-header {
  font-size: 10px;
  color: #888;
  text-align: center;
  letter-spacing: 0.3px;
}

.split-label-spacer,
.split-col-arrow-spacer,
.split-sync-spacer {
  /* placeholders to align with .split-row grid */
}

.split-row {
  display: grid;
  grid-template-columns: 46px 1fr 14px 1fr 20px;
  gap: 4px;
  align-items: center;
  margin-bottom: 5px;
  padding: 2px 0;
  border-radius: 3px;
  transition: background 0.15s;
}

.split-row.has-diff {
  background: #fff7e6;
}

.split-label {
  font-size: 11px;
  color: #666;
  text-align: right;
  padding-right: 2px;
  white-space: nowrap;
}

.split-label .unit {
  margin-left: 2px;
  color: #aaa;
}

.split-input {
  width: 100%;
  min-width: 0;
  text-align: right;
}

.split-checkbox-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.split-arrow {
  font-size: 12px;
  color: #aaa;
  text-align: center;
  user-select: none;
}

.split-row.has-diff .split-arrow {
  color: #f59f00;
  font-weight: 700;
}

.btn-sync {
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 11px;
  line-height: 1;
  border: 1px solid #d0d3d9;
  background: #fff;
  color: #666;
  border-radius: 3px;
  cursor: pointer;
}

.btn-sync:hover:not(:disabled) {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

.btn-sync:disabled {
  opacity: 0.3;
  cursor: default;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.field-row > label {
  width: 40px;
  text-align: right;
  font-size: 11px;
  color: #888;
  flex-shrink: 0;
}

.animation-overview {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.overview-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.overview-label {
  width: 42px;
  color: #888;
  text-align: right;
  flex-shrink: 0;
}

.overview-value {
  min-width: 0;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timing-mode-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.timing-mode-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border: 1px solid #d9dee8;
  border-radius: 6px;
  background: #fff;
  color: #4b5563;
  font-size: 12px;
  cursor: pointer;
}

.timing-mode-option.active {
  border-color: #4f7fcf;
  background: #eef5ff;
  color: #244f91;
}

.timing-mode-option input {
  margin: 0;
}

.field-pair {
  display: flex;
  align-items: center;
  gap: 2px;
}

.field-label {
  font-size: 10px;
  color: #aaa;
  width: 12px;
}

.unit {
  font-size: 10px;
  color: #aaa;
}

.default-hint {
  font-size: 10px;
  color: #bbb;
  font-style: italic;
}

input[type="number"] {
  width: 52px;
  background: #fff;
  border: 1px solid #d0d3d9;
  color: #333;
  border-radius: 3px;
  padding: 3px 5px;
  font-size: 12px;
  text-align: right;
}

input[type="number"]:focus {
  border-color: #2563eb;
  outline: none;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}

input[type="number"]:disabled {
  opacity: 0.5;
  color: #999;
  background: #f8f8fa;
}

/* Text input */
.text-input {
  flex: 1;
  min-width: 0;
  background: #fff;
  border: 1px solid #d0d3d9;
  color: #333;
  border-radius: 3px;
  padding: 3px 6px;
  font-size: 12px;
}

.text-input:focus {
  border-color: #2563eb;
  outline: none;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}

.target-picker {
  position: relative;
  flex: 1;
  min-width: 0;
}

.target-picker-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  padding: 4px 7px;
  color: #333;
  background: #fff;
  border: 1px solid #d0d3d9;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  text-align: left;
}

.target-picker-trigger.active,
.target-picker-trigger:focus {
  border-color: #2563eb;
  outline: none;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}

.target-picker-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-picker-arrow {
  flex-shrink: 0;
  color: #6b7280;
  font-size: 10px;
}

.target-picker-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 30;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px;
  background: #fff;
  border: 1px solid #d0d3d9;
  border-radius: 4px;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.14);
}

.target-tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 28px;
  padding: 4px 7px;
  color: #374151;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
}

.target-tree-row:hover {
  background: #f3f4f6;
}

.target-tree-row.selected {
  color: #1d4ed8;
  font-weight: 600;
  background: #eff6ff;
}

.tree-toggle,
.tree-spacer {
  width: 16px;
  flex-shrink: 0;
  color: #6b7280;
  font-size: 10px;
  text-align: center;
}

.tree-toggle:hover {
  color: #2563eb;
}

.target-icon {
  width: 18px;
  flex-shrink: 0;
  font-size: 14px;
  text-align: center;
}

.target-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.checkbox-inline {
  display: flex;
  align-items: center;
  gap: 4px;
  width: auto !important;
  font-size: 11px;
  color: #666;
  cursor: pointer;
  margin-left: 4px;
}

.duration-mode {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.duration-mode label {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  width: auto;
}

input.duration-input {
  width: 80px;
}

.easing-section {
  margin-bottom: 6px;
}

.easing-label {
  font-size: 11px;
  color: #888;
  margin-bottom: 4px;
  display: block;
}

.btn-icon {
  background: none;
  border: 1px solid #d0d3d9;
  color: #555;
  border-radius: 3px;
  padding: 1px 5px;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
}

.btn-icon:hover:not(:disabled) {
  background: #e4e6ea;
}

.btn-icon:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.btn-link {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  opacity: 0.4;
}

.btn-link.active {
  opacity: 1;
}

.btn-sm {
  background: #f0f1f3;
  border: 1px solid #d0d3d9;
  color: #555;
  border-radius: 3px;
  padding: 1px 6px;
  cursor: pointer;
  font-size: 11px;
  line-height: 1.4;
}

.btn-sm:hover:not(:disabled) {
  background: #e4e6ea;
}

.btn-sm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.interpolated input[type="number"] {
  color: #bbb;
  font-style: italic;
}

.quick-actions {
  display: flex;
  gap: 4px;
  padding-top: 4px;
}

/* Track list (State A) */
.track-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.track-list-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 3px;
  cursor: pointer;
}

.track-list-item:hover {
  background: #e4e6ea;
}

.track-color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.track-list-label {
  font-size: 11px;
  color: #555;
}

/* Value display text (State B) */
.value-text {
  font-size: 12px;
  color: #333;
}

/* Danger button (delete track) */
.btn-danger {
  background: #fee2e2;
  border: 1px solid #fca5a5;
  color: #dc2626;
  border-radius: 3px;
  padding: 3px 10px;
  cursor: pointer;
  font-size: 11px;
}

.btn-danger:hover {
  background: #fecaca;
}

/* Select */
select {
  background: #fff;
  border: 1px solid #d0d3d9;
  color: #333;
  border-radius: 3px;
  padding: 3px 5px;
  font-size: 12px;
  flex: 1;
  min-width: 0;
}

select:focus {
  border-color: #2563eb;
  outline: none;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}

/* Empty hint (State A) */
.panel-empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
  color: #999;
}

.panel-empty-hint.compact {
  padding: 8px 6px 0;
}

.hint-icon {
  font-size: 28px;
  margin-bottom: 8px;
  opacity: 0.6;
}

.hint-text {
  font-size: 12px;
  line-height: 1.5;
  color: #888;
}

.hint-meta {
  margin-top: 12px;
  font-size: 11px;
  color: #bbb;
}
</style>
