/**
 * AnimationComposition
 *
 * Shared multi-track output composition logic, reused by both runtime player (GenericAnimationPlayer)
 * and animation workbench (AnimationWorkbench), avoiding implementation divergence.
 *
 * Composition rules (consistent with GenericAnimationPlayer.applyOutputs):
 * - Transform: translation/rotation accumulated additively, scale multiplied; supports per-track pivot compensation
 * - Visibility: alpha multiplied
 * - Effect (numeric deltas): translation/rotation accumulated additively, (1 + deltaScale) multiplied, (1 + deltaAlpha) multiplied
 *
 * Note: Effect filters/particles/special effects state (glow/motionBlur/wave/ribbon/...) are
 * stateful resources, managed and cleaned up by callers according to their own caching strategy, not handled here.
 */

import type * as PIXI from 'pixi.js'

import type {
    AnimationOutput,
    EffectTrackOutput,
    TransformTrackOutput,
    VisibilityTrackOutput,
} from '@/types/animation'

/** Final composed transform delta across multiple tracks on a single target object */
export interface ComposedTransform {
    deltaX: number
    deltaY: number
    deltaRotation: number
    scaleMultX: number
    scaleMultY: number
    alphaProduct: number
}

/** Composition context (base transform + object bounding box + PIXI pivot) */
export interface CompositionContext {
    baseRotation: number
    baseScaleX: number
    baseScaleY: number
    /** Object bounding box: used for converting pivot percentages to local coordinates */
    objectBoundsX: number
    objectBoundsY: number
    objectWidth: number
    objectHeight: number
    /** Current pivot of PIXI container (true rotation center for rotation/scale) */
    pivotX: number
    pivotY: number
}

/** Create an empty accumulator (identity element) */
export function createEmptyComposedTransform(): ComposedTransform {
    return {
        deltaX: 0,
        deltaY: 0,
        deltaRotation: 0,
        scaleMultX: 1,
        scaleMultY: 1,
        alphaProduct: 1,
    }
}

/**
 * Accumulate the output of a Transform track.
 * Mirrors the logic of transform branch in GenericAnimationPlayer.applyOutputs,
 * including merging flipX into sx, and pivot position compensation.
 */
export function accumulateTransformOutput(
    acc: ComposedTransform,
    t: TransformTrackOutput,
    ctx: CompositionContext,
): void {
    const flipFactor = t.flipX ? -1 : 1
    const sx = (t.scaleX ?? 1) * flipFactor
    const sy = t.scaleY ?? 1
    const rot = t.rotation ?? 0

    const pivot = t.pivot
    if (pivot) {
        // Pivot compensation: pivot is local coordinate pixel value of object (same coordinate space as container.pivot)
        // Offset dx/dy relative to PIXI pivot
        const dx = pivot.x - ctx.pivotX
        const dy = pivot.y - ctx.pivotY

        const bx = ctx.baseScaleX * dx
        const by = ctx.baseScaleY * dy
        const ax = ctx.baseScaleX * sx * dx
        const ay = ctx.baseScaleY * sy * dy
        const cosB = Math.cos(ctx.baseRotation)
        const sinB = Math.sin(ctx.baseRotation)
        const cosA = Math.cos(ctx.baseRotation + rot)
        const sinA = Math.sin(ctx.baseRotation + rot)
        const beforeX = cosB * bx - sinB * by
        const beforeY = sinB * bx + cosB * by
        const afterX = cosA * ax - sinA * ay
        const afterY = sinA * ax + cosA * ay
        acc.deltaX += (beforeX - afterX) + (t.x ?? 0)
        acc.deltaY += (beforeY - afterY) + (t.y ?? 0)
    } else {
        acc.deltaX += t.x ?? 0
        acc.deltaY += t.y ?? 0
    }

    acc.deltaRotation += rot
    acc.scaleMultX *= sx
    acc.scaleMultY *= sy
}

/** Accumulate a Visibility track output */
export function accumulateVisibilityOutput(
    acc: ComposedTransform,
    v: VisibilityTrackOutput,
): void {
    acc.alphaProduct *= v.alpha ?? 1
}

/** Effect numeric delta (compatible with numeric fields of DynamicEffectManager.EffectOutput / EffectTrackOutput) */
export interface EffectNumericDelta {
    deltaX?: number | undefined
    deltaY?: number | undefined
    deltaRotation?: number | undefined
    deltaScaleX?: number | undefined
    deltaScaleY?: number | undefined
    deltaAlpha?: number | undefined
}

/** Accumulate numeric delta of an Effect track (does not handle filters) */
export function accumulateEffectDelta(
    acc: ComposedTransform,
    d: EffectNumericDelta | null | undefined,
): void {
    if (!d) return
    acc.deltaX += d.deltaX ?? 0
    acc.deltaY += d.deltaY ?? 0
    acc.deltaRotation += d.deltaRotation ?? 0
    if (d.deltaScaleX !== undefined) acc.scaleMultX *= 1 + d.deltaScaleX
    if (d.deltaScaleY !== undefined) acc.scaleMultY *= 1 + d.deltaScaleY
    if (d.deltaAlpha !== undefined) acc.alphaProduct *= 1 + d.deltaAlpha
}

/**
 * Compose multiple AnimationOutputs into a single ComposedTransform.
 *
 * @param outputs AnimationOutput for each track (usually one per track)
 * @param ctx     Composition context
 * @param evaluateEffect Caller-provided callback: converts an EffectTrackOutput to numeric delta.
 *               - Runtime player: uses effectManager + jelly/squash precomputed branch
 *               - Workbench: uses DynamicEffectManager.calculateWithProgress (precomputed deltas)
 *               Passing undefined skips accumulating effect deltas (transform + visibility only).
 */
export function composeAnimationOutputs(
    outputs: AnimationOutput[],
    ctx: CompositionContext,
    evaluateEffect?: (e: EffectTrackOutput) => EffectNumericDelta | null,
): ComposedTransform {
    const acc = createEmptyComposedTransform()

    for (const output of outputs) {
        for (const t of output.transforms) {
            accumulateTransformOutput(acc, t, ctx)
        }
        for (const v of output.visibilities) {
            accumulateVisibilityOutput(acc, v)
        }
        if (evaluateEffect) {
            for (const e of output.effects) {
                accumulateEffectDelta(acc, evaluateEffect(e))
            }
        }
    }

    return acc
}

/** Base posture state (for writing back to container) */
export interface BaseTransformState {
    x: number
    y: number
    scaleX: number
    scaleY: number
    rotation: number
    alpha: number
}

/**
 * Write composed transform back to container in one batch.
 * Equivalent to write-back code at the end of GenericAnimationPlayer.applyOutputs.
 */
export function applyComposedTransformToContainer(
    container: PIXI.Container,
    base: BaseTransformState,
    composed: ComposedTransform,
): void {
    container.x = base.x + composed.deltaX
    container.y = base.y + composed.deltaY
    container.rotation = base.rotation + composed.deltaRotation
    container.scale.x = base.scaleX * composed.scaleMultX
    container.scale.y = base.scaleY * composed.scaleMultY
    container.alpha = base.alpha * composed.alphaProduct
}
