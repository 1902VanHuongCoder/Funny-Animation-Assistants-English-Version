<!--
  PivotEditorPanel.vue — Transform pivot visual editing panel

  Design key points (locked by Phase 3 PRD):
  1. Use independent PIXI sub-app (reuse LightweightCanvas + useSceneRenderer), no shared state with main canvas;
  2. Show target object only (no parent context);
  3. Object is in 'raw pose' — no animation evaluation applied, convenient for precise pivot positioning;
  4. Orange pivot handle on canvas is draggable; same handle on main canvas is grey read-only gizmo.

  Data flow:
  User drags -> LightweightCanvas internal useSceneRenderer(mode='setup', storeOverride=isolated store)
           → onSetupChange(type='origin', pivot)
           -> This component emit('pivot-change', pivot)
           -> Parent component (AnimationWorkbench) performs per-keyframe compensation + ctx.updatePivot
-->
<template>
  <div class="pivot-editor-panel">
    <div class="header">
      <span class="title">Pivot Editor</span>
      <button
        v-if="canReset"
        type="button"
        class="reset-btn"
        title="Reset to default pivot"
        @click="onResetClick"
      >
        Reset
      </button>
    </div>
    <div class="canvas-wrap">
      <LightweightCanvas
        ref="panelCanvasRef"
        :resource-type="resourceType"
        :resource-id="resourceId"
        :scene-object-id="sceneObjectId"
        :target-object-id="targetObjectId"
        origin-handle-mode="editable"
        fit-mode="fit-content"
        :lock-object-interaction="true"
        :disable-viewport-pan-zoom="true"
        @container-ready="applyEffectivePivotToPanel"
        @setup-change="onPanelSetupChange"
      />
    </div>
    <p class="hint">
      Drag orange cross to adjust pivot; {{ pivotSetHint }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import type { SetupChangePayload, useSceneRenderer } from '@/composables/useSceneRenderer'
import type { WorkbenchPreviewStore } from '@/types/WorkbenchPreviewStore'

import LightweightCanvas from './LightweightCanvas.vue'

export interface PivotEditorPanelProps {
    resourceType: 'prop' | 'background' | 'symbol' | 'composite' | 'expression'
    resourceId: string
  sceneObjectId?: string | undefined
    /** targetObjectId of current active track — determines which child object panel edits */
  targetObjectId?: string | undefined
    /** Whether current track.pivot has been explicitly set (determines whether 'Reset' button is shown) */
    hasPivotSet: boolean
    /** Effective pivot currently used by track (custom pivot or object default pivot), pixel local coordinates. */
    effectivePivot: { x: number; y: number }
}

const props = defineProps<PivotEditorPanelProps>()

const emit = defineEmits<{
    /**
     * Triggered when user finishes dragging pivot on panel canvas.
     * payload carries pixel values in object local coordinate system, same as track.pivot / container.pivot.
     */
    'pivot-change': [pivot: { x: number; y: number }, objectId: string]
    /** User clicks 'Reset' button — clears track.pivot to default value. */
    'pivot-reset': []
}>()

const panelCanvasRef = ref<InstanceType<typeof LightweightCanvas> | null>(null)

const canReset = computed(() => props.hasPivotSet)
const pivotSetHint = computed(() =>
    props.hasPivotSet ? 'Custom pivot is set' : 'Using object default pivot'
)

watch(
    () => [props.effectivePivot.x, props.effectivePivot.y, props.sceneObjectId, props.targetObjectId] as const,
    () => {
        void nextTick(() => applyEffectivePivotToPanel())
    },
    { immediate: true },
)

function resolvePanelObjectId(): string | undefined {
    return props.targetObjectId ?? props.sceneObjectId
}

/**
 * Getter properties exposed by LightweightCanvas via defineExpose,
 * Vue InstanceType inference would mark them as error type.
 * Explicitly declare narrow interface here for type safety.
 */
interface LightweightCanvasExposed {
    renderer: ReturnType<typeof useSceneRenderer> | null
    previewStore: WorkbenchPreviewStore | null
    sceneGraph: ReturnType<ReturnType<typeof useSceneRenderer>['getSceneGraph']> | null
}

function applyEffectivePivotToPanel(): void {
    const panel = panelCanvasRef.value as LightweightCanvasExposed | null
    const renderer = panel?.renderer
    const store = panel?.previewStore
    const sceneGraph = panel?.sceneGraph
    const objectId = resolvePanelObjectId()
    if (!renderer || !store || !sceneGraph || !objectId) return

    const obj = store.getObject(objectId)
    const container = sceneGraph.getContainer(objectId)
    if (!obj || !container || container.destroyed) return

    const currentOriginX = obj.transformOriginX ?? 0
    const currentOriginY = obj.transformOriginY ?? 0
    const pivotBaseX = container.pivot.x - currentOriginX
    const pivotBaseY = container.pivot.y - currentOriginY
    const nextOriginX = props.effectivePivot.x - pivotBaseX
    const nextOriginY = props.effectivePivot.y - pivotBaseY

    if (
        Math.abs(currentOriginX - nextOriginX) < 0.001 &&
        Math.abs(currentOriginY - nextOriginY) < 0.001
    ) {
        renderer.selectObject(objectId)
        renderer.updateSelectionBox()
        return
    }

    // Written to panel internal isolated store, used only for positioning small canvas gizmo;
    // Persistence of track.pivot and sync with main canvas runtime handled by AnimationWorkbench.
    store.updateObject(objectId, {
        transformOriginX: nextOriginX,
        transformOriginY: nextOriginY,
    })
    renderer.syncObjectFromStore(objectId)
    renderer.selectObject(objectId)
    renderer.updateSelectionBox()
}

function onPanelSetupChange(change: SetupChangePayload): void {
    if (change.type !== 'origin') {
        // Panel cares only about pivot editing; overall object transform changes handled by main canvas.
        // Ignore here; panel users do not expect overall drags inside small window.
        return
    }
    emit('pivot-change', { x: change.pivot.x, y: change.pivot.y }, change.objectId)
}

function onResetClick(): void {
    emit('pivot-reset')
}
</script>

<style scoped>
.pivot-editor-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: #1e1e1e;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
}

.header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.title {
    font-size: 12px;
    color: #ddd;
    font-weight: 600;
}

.reset-btn {
    font-size: 11px;
    padding: 2px 8px;
    background: #2a2a2a;
    color: #ddd;
    border: 1px solid #555;
    border-radius: 3px;
    cursor: pointer;
}

.reset-btn:hover {
    background: #3a3a3a;
    color: #fff;
}

.canvas-wrap {
    position: relative;
    width: 100%;
    height: 200px;
    background: #111;
    border: 1px solid #2a2a2a;
    border-radius: 3px;
    overflow: hidden;
}

.canvas-wrap :deep(.lightweight-canvas) {
    width: 100%;
    height: 100%;
}

.hint {
    font-size: 11px;
    color: #888;
    margin: 0;
    line-height: 1.4;
}
</style>
