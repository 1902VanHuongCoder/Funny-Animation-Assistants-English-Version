/**
 * useAnimationWorkbenchRenderer — Workbench preview rendering helper
 *
 * Current status (post-Phase 2b):
 *   This module only retains a top-level imperative helper —— runPreviewTracksOnCanvas(),
 *   which hosts the core logic originally inlined in AnimationWorkbench.vue's applyPreviewTracksToCanvas:
 *     1) Group active preview tracks by target
 *     2) Clean up residue for targets affected in previous turn but not covered in current turn
 *     3) For each target: reset + origin-delta compensation + transform/visibility/effect composition
 *     4) Write back to container in one shot; update previouslyAffectedKeys
 *
 *   All dependencies (rootContainer / cache Map / resolver callbacks / side-effect callbacks, etc.)
 *   are injected via PreviewTracksRenderDeps — caller (AnimationWorkbench.vue) is responsible for
 *   holding and assembling these local states; this module does not hold any mutable state.
 *
 * History notes:
 *   Previous version included a useAnimationWorkbenchRenderer() composable skeleton,
 *   designed to encapsulate base caches / playhead / keyframe commit,
 *   but was never wired anywhere, and main workbench cannot easily switch to it short term
 *   (PivotEditorPanel still depends on LightweightCanvas + AnimationSceneObjectStore
 *   independent data isolation path, see /memories/repo/animation-workbench-pivot.txt).
 *   Phase 4 removed the skeleton entirely; if restored as composable in the future, it should
 *   be initiated after "main canvas no longer connects directly to AnimationSceneObjectStore".
 */

import * as PIXI from 'pixi.js'

import { DynamicEffectManager } from '@/core/animation/DynamicEffectManager'
import {
    accumulateEffectDelta,
    accumulateTransformOutput,
    accumulateVisibilityOutput,
    applyComposedTransformToContainer,
    type CompositionContext,
    createEmptyComposedTransform,
} from '@/core/AnimationComposition'
import { AnimationTrackEvaluator } from '@/core/AnimationTrackEvaluator'
import type { ContainerBaseState } from '@/core/WorkbenchBaseTransformSnapshot'
import {
    type AnimationDefinition,
    type AnimationTrack,
    TARGET_SELF,
    type TransformTrackOutput,
    type VisibilityTrackOutput,
} from '@/types/animation'

// Phase 2b: Preview track composition migration
// ----------------------------------------------------------------------------
// Migrate applyPreviewTracksToCanvas previously inlined in AnimationWorkbench.vue
// entirely to this module as a pure "imperative" top-level function: caller provides all
// required container references / caches / resolve callbacks (PreviewTracksRenderDeps),
// and the function executes a composition at time 'time' on these containers and writes back.
//
// Goals:
//   1) Code location unified with Phase 2 skeleton —— when caches are encapsulated in composable later,
//      caller can replace with same-name deps provided by composable;
//   2) AnimationWorkbench.vue's same-named function downgraded to thin wrapper (arranging deps once),
//      convenient for eventual complete removal;
//   3) Pure function arguments + explicit dependency injection, convenient for workbench composition unit tests.
// ============================================================================

export interface PreviewTracksEffectDelta {
    glowColor?: string
    glowIntensity?: number
    glowSize?: number
    motionBlurVelocity?: [number, number]
    motionBlurKernelSize?: number
    petrifyProgress?: number
    petrifyGrayScale?: boolean
    shatterAlpha?: number
    shatterProgress?: number
    deltaX?: number
    deltaY?: number
    deltaScaleX?: number
    deltaScaleY?: number
    deltaRotation?: number
    deltaAlpha?: number
}

export interface PreviewTracksRenderDeps {
    /** Root container (if null, entire function short-circuits) */
    rootContainer: PIXI.Container | null
    /** Active preview track indices (computed from previewMode) */
    activePreviewTrackIndexes: readonly number[]
    /** Full animation definition (for indexing tracks + reading loop) */
    animationDef: AnimationDefinition
    /** Global duration (ms), usually equal to ctx.trackDuration.value */
    globalDurationMs: number
    /** Turn off frame_sequence/filter temporal tracks when scrubbing playhead; turn on during playback preview. */
    includeTemporalTracks?: boolean

    // Mutable cache (read and updated by function)
    previouslyAffectedKeys: Set<string>
    baseStateCache: Map<string, ContainerBaseState>
    initialContainerBaseStateCache: Map<string, ContainerBaseState>
    objectBaseStateCache: Map<string, { transformOriginX: number; transformOriginY: number }>

    // Resolver callbacks
    resolveTargetObjectIdForTrack: (track: AnimationTrack) => string | null
    resolveTargetContainerForTrack: (track: AnimationTrack) => PIXI.Container
    resolveContainerForKey: (key: string) => PIXI.Container | null
    resolveObjectIdForPreviewKey: (key: string) => string | null
    getBaseStateForTrack: (track: AnimationTrack) => ContainerBaseState
    getSceneObjectById: (objectId: string | null) => { flipX?: boolean; transformOriginX?: number; transformOriginY?: number } | null

    // Side-effect callbacks (local state held by caller, e.g. filter bundles, sprite frame)
    resetContainerToBaseStateWithKey: (container: PIXI.Container, state: ContainerBaseState, key: string) => void
    applyFrameSequenceTrackToContainer: (track: AnimationTrack & { trackType: 'frame_sequence' }, container: PIXI.Container, progress: number) => void
    applyEffectFiltersForKey: (container: PIXI.Container, key: string, deltas: PreviewTracksEffectDelta[]) => void
    getTrackDurationMs: (track: AnimationTrack) => number
}

/**
 * Compose and write back all active preview tracks onto deps.rootContainer / partContainers at current time.
 *
 * Semantically equivalent to original AnimationWorkbench.applyPreviewTracksToCanvas (pre-Phase 2b implementation).
 * After completion:
 *   - previouslyAffectedKeys is updated to current affected keys;
 *   - affected container position/scale/rotation/pivot/alpha/filters/sprite frame are written to final state;
 *   - single-track 'current' mode does not use this function (still uses applyTimeToCanvas branch).
 */
export function runPreviewTracksOnCanvas(deps: PreviewTracksRenderDeps, time: number): void {
    if (!deps.rootContainer) return

    const tracks = deps.activePreviewTrackIndexes
        .map(index => deps.animationDef.tracks[index])
        .filter((track): track is AnimationTrack => !!track)

    // 1) Group by target (equivalent to formal player's "cross-object delegation")
    const tracksByKey = new Map<string, AnimationTrack[]>()
    for (const track of tracks) {
        const key = deps.resolveTargetObjectIdForTrack(track) ?? TARGET_SELF
        let group = tracksByKey.get(key)
        if (!group) { group = []; tracksByKey.set(key, group) }
        group.push(track)
    }

    const affectedKeys = new Set<string>(tracksByKey.keys())

    // 2) Restore targets from previous turn that are not in current turn to base (including filter cleanup)
    for (const prevKey of deps.previouslyAffectedKeys) {
        if (affectedKeys.has(prevKey)) continue
        const state = deps.initialContainerBaseStateCache.get(prevKey) ?? deps.baseStateCache.get(prevKey)
        if (!state) continue
        const container = deps.resolveContainerForKey(prevKey)
        if (!container) continue
        deps.resetContainerToBaseStateWithKey(container, state, prevKey)
    }

    // 3) For each target: reset + composite + write back once
    const globalDurationMs = deps.globalDurationMs
    const loop = deps.animationDef.loop === true
    const elapsedMs = Math.max(0, time) * globalDurationMs

    for (const [key, groupTracks] of tracksByKey) {
        const representative = groupTracks[0]!
        const container = deps.resolveTargetContainerForTrack(representative)
        const base = deps.baseStateCache.get(key) ?? deps.getBaseStateForTrack(representative)

        // reset: clear filters and restore transform
        deps.resetContainerToBaseStateWithKey(container, base, key)

        // If current store transformOrigin changed compared to mount time (e.g. user dragged
        // pivot cross in PivotEditorPanel), compensate to container.pivot / base.position as "delta".
        // baseStateCache is captured from onContainerReady (when SceneObjectRenderer already applied applyObjectState),
        // so base.pivot = PivotBase + originAtMount, and base.position contains flipSign*originAtMount;
        // Cannot add "current origin" in full again, otherwise on sub-objects with origin != 0 origin would be double-added,
        // causing pivot drift of (I - R(θ))·origin during rotation (e.g. legs detaching from body at 50% progress).
        let basePositionX = base.position.x
        let basePositionY = base.position.y
        let effectivePivotX = base.pivot.x
        let effectivePivotY = base.pivot.y
        let baseFlipSign = base.scale.x < 0 ? -1 : 1
        {
            const storeObjId = deps.resolveObjectIdForPreviewKey(key)
            const storeObj = deps.getSceneObjectById(storeObjId)
            const mountBase = storeObjId ? deps.objectBaseStateCache.get(storeObjId) : null
            if (storeObj && mountBase) {
                const originX = storeObj.transformOriginX ?? 0
                const originY = storeObj.transformOriginY ?? 0
                const mountOriginX = mountBase.transformOriginX ?? 0
                const mountOriginY = mountBase.transformOriginY ?? 0
                const dOX = originX - mountOriginX
                const dOY = originY - mountOriginY
                if (dOX !== 0 || dOY !== 0) {
                    baseFlipSign = storeObj.flipX ? -1 : 1
                    effectivePivotX = base.pivot.x + dOX
                    effectivePivotY = base.pivot.y + dOY
                    container.pivot.set(effectivePivotX, effectivePivotY)
                    basePositionX = base.position.x + baseFlipSign * dOX
                    basePositionY = base.position.y + dOY
                } else {
                    // origin unchanged: base.pivot already contains correct PivotBase + origin,
                    // here only defensive against reset residue (already set by resetContainerToBaseStateWithKey).
                    container.pivot.set(base.pivot.x, base.pivot.y)
                }
            }
        }

        // Classified evaluation: transform/visibility/effect participate in composition; frame_sequence handled separately
        const transforms: TransformTrackOutput[] = []
        const visibilities: VisibilityTrackOutput[] = []
        const effectDeltas: ReturnType<typeof DynamicEffectManager.calculateWithProgress>[] = []
        const rawEffectTracks: (AnimationTrack & { trackType: 'effect' })[] = []
        let visualPivot: { x: number; y: number } | null = null

        for (const track of groupTracks) {
            const trackDurationMs = deps.getTrackDurationMs(track)
            const normalizedTrackProgress = computeTrackProgressInternal(elapsedMs, trackDurationMs, globalDurationMs, loop)

            if (track.trackType === 'transform') {
                const output = AnimationTrackEvaluator.evaluateTransform(track, normalizedTrackProgress)
                transforms.push(output)
                if (output.pivot) visualPivot = output.pivot
            } else if (track.trackType === 'visibility') {
                visibilities.push(AnimationTrackEvaluator.evaluateVisibility(track, normalizedTrackProgress))
            } else if (track.trackType === 'effect' && deps.includeTemporalTracks === true) {
                const effectOutput = DynamicEffectManager.calculateWithProgress(track.effectParams, normalizedTrackProgress, trackDurationMs)
                effectDeltas.push(effectOutput)
                rawEffectTracks.push(track)
            } else if (track.trackType === 'frame_sequence' && deps.includeTemporalTracks === true) {
                deps.applyFrameSequenceTrackToContainer(track, container, normalizedTrackProgress)
            }
        }

        if (visualPivot) {
            // track.pivot is animation reference point of current transform track. First translate base pose
            // to equivalent rest pose under new pivot: object doesn't move when no rotation/scale output;
            // with rotation/scale, subsequent transform naturally computes position changes around new pivot.
            const dPX = visualPivot.x - effectivePivotX
            const dPY = visualPivot.y - effectivePivotY
            basePositionX += baseFlipSign * dPX
            basePositionY += dPY
            effectivePivotX = visualPivot.x
            effectivePivotY = visualPivot.y
            container.pivot.set(effectivePivotX, effectivePivotY)
        }

        // Composition: reuse formal player rules of transform accumulation / visibility multiplication / effect numeric delta multiplication
        const composed = createEmptyComposedTransform()
        const compositionCtx: CompositionContext = {
            baseRotation: base.rotation,
            baseScaleX: base.scale.x,
            baseScaleY: base.scale.y,
            objectBoundsX: base.bounds.x,
            objectBoundsY: base.bounds.y,
            objectWidth: base.bounds.width,
            objectHeight: base.bounds.height,
            pivotX: effectivePivotX,
            pivotY: effectivePivotY,
        }
        for (const t of transforms) accumulateTransformOutput(composed, t, compositionCtx)
        for (const v of visibilities) accumulateVisibilityOutput(composed, v)
        for (const d of effectDeltas) {
            accumulateEffectDelta(composed, d)
            // Extra alpha attenuation for shatter (consistent with old implementation, now combined into alphaProduct)
            if (d.shatterAlpha !== undefined) {
                composed.alphaProduct *= Math.max(0, d.shatterAlpha)
            } else if (d.shatterProgress !== undefined) {
                composed.alphaProduct *= Math.max(0, 1 - d.shatterProgress)
            }
        }

        // Write back (in one shot)
        applyComposedTransformToContainer(container, {
            x: basePositionX,
            y: basePositionY,
            scaleX: base.scale.x,
            scaleY: base.scale.y,
            rotation: base.rotation,
            alpha: base.alpha,
        }, composed)

        // Handle effect filters separately (stateful, cached by target key)
        if (rawEffectTracks.length > 0) {
            deps.applyEffectFiltersForKey(container, key, effectDeltas)
        }
    }

    // 4) Record affected keys for residue cleanup in next turn
    deps.previouslyAffectedKeys.clear()
    for (const k of affectedKeys) deps.previouslyAffectedKeys.add(k)
}

/**
 * Top-level internal helper: equivalent to legacy AnimationWorkbench.computeTrackProgress.
 * Named uniquely to avoid conflicts with same-named private functions inside composable.
 */
function computeTrackProgressInternal(
    elapsedMs: number,
    trackDurationMs: number,
    globalDurationMs: number,
    loop: boolean,
): number {
    if (trackDurationMs <= 0) return 0
    if (globalDurationMs <= 0) return 0
    if (!Number.isFinite(trackDurationMs)) return Math.min(1, Math.max(0, elapsedMs / globalDurationMs))
    if (trackDurationMs >= globalDurationMs) {
        return Math.min(1, Math.max(0, elapsedMs / globalDurationMs))
    }
    if (loop) {
        return (elapsedMs % trackDurationMs) / trackDurationMs
    }
    return Math.min(1, elapsedMs / trackDurationMs)
}
