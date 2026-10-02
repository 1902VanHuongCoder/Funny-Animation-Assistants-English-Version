/**
 * v12.x: Auto Duration marker value
 * When track duration === 'auto', getTrackDuration returns this value.
 * AnimationPlayer will replace it with the runtime injected runtimeDuration.
 */
export const AUTO_DURATION_MARKER = -1

/**
 * Animation Track Evaluator (v11.0)
 * Track evaluator responsible for computing output values based on track definition and progress.
 */

import type {
    AnimationOutput,
    AnimationTrack,
    EffectTrack,
    EffectTrackOutput,
    TrackOutput,
    TransformKeyframe,
    TransformTrack,
    TransformTrackOutput,
    VisibilityKeyframe,
    VisibilityTrack,
    VisibilityTrackOutput,
} from '@/types/animation'
import { applyEasing, lerp } from '@/utils/easing'

import { DynamicEffectManager } from './animation/DynamicEffectManager'

/**
 * v13 Scheme B helpers — Left/Right side value resolution for split keyframes
 *
 * Interpolation within segment [prev, next]: start = resolveRightSide(prev), end = resolveLeftSide(next)
 * - resolveLeftSide(kf): Top-level fields, representing valueIn (value entering from left segment / end value of segment)
 * - resolveRightSide(kf): Fields overridden by kf.out, representing valueOut (start value of segment)
 * Keyframes without out defined have equal left and right sides (continuous, backward compatible)
 */
function transformKfRight(kf: TransformKeyframe): {
    x: number; y: number; scaleX: number; scaleY: number; rotation: number; flipX: boolean | undefined
} {
    const o = kf.out
    return {
        x: o?.x ?? kf.x ?? 0,
        y: o?.y ?? kf.y ?? 0,
        scaleX: o?.scaleX ?? kf.scaleX ?? 1,
        scaleY: o?.scaleY ?? kf.scaleY ?? 1,
        rotation: o?.rotation ?? kf.rotation ?? 0,
        flipX: o?.flipX ?? kf.flipX,
    }
}

function transformKfLeft(kf: TransformKeyframe): {
    x: number; y: number; scaleX: number; scaleY: number; rotation: number; flipX: boolean | undefined
} {
    return {
        x: kf.x ?? 0,
        y: kf.y ?? 0,
        scaleX: kf.scaleX ?? 1,
        scaleY: kf.scaleY ?? 1,
        rotation: kf.rotation ?? 0,
        flipX: kf.flipX,
    }
}

function visibilityKfRight(kf: VisibilityKeyframe): { alpha: number } {
    return { alpha: kf.out?.alpha ?? kf.alpha ?? 1 }
}

function visibilityKfLeft(kf: VisibilityKeyframe): { alpha: number } {
    return { alpha: kf.alpha ?? 1 }
}

/**
 * Track evaluator
 * Pure function computing output values based on track definition and progress
 */
export class AnimationTrackEvaluator {
    /**
     * Evaluate track
     * @param track Track definition
     * @param progress Normalized progress (0-1)
     * @param duration Animation duration (ms), used for progress-driven effect calculation
     * v11.52: Removed frame_sequence case; frame animation directly uses AnimatedSprite.play()
     * v11.70: Added duration parameter supporting progress-driven mode
     */
    static evaluate(track: AnimationTrack, progress: number, duration = 1000): TrackOutput {
        switch (track.trackType) {
            case 'frame_sequence':
                // v11.52: Frame sequence tracks no longer need evaluation, returning empty output
                // Frame animation directly uses AnimatedSprite.play()
                throw new Error('frame_sequence tracks should not be evaluated. Use AnimatedSprite.play() instead.')
            case 'transform':
                return this.evaluateTransform(track, progress)
            case 'visibility':
                return this.evaluateVisibility(track, progress)
            case 'effect':
                return this.evaluateEffect(track, progress, duration)
            default:
                throw new Error(`Unknown track type: ${(track as AnimationTrack).trackType}`)
        }
    }

    /**
     * Evaluate transform track
     */
    static evaluateTransform(track: TransformTrack, progress: number): TransformTrackOutput {
        const keyframes = track.keyframes
        if (keyframes.length === 0) {
            return {
                targetObjectId: track.targetObjectId,
                x: 0,
                y: 0,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                flipX: undefined,
                pivot: track.pivot,
            }
        }

        if (keyframes.length === 1) {
            const kf = keyframes[0]
            if (!kf) throw new Error('Keyframe is undefined')
            // Single frame: display as valueOut (forward-facing)
            const r = transformKfRight(kf)
            return {
                targetObjectId: track.targetObjectId,
                x: r.x,
                y: r.y,
                scaleX: r.scaleX,
                scaleY: r.scaleY,
                rotation: r.rotation,
                flipX: r.flipX,
                pivot: track.pivot,
            }
        }

        // Find surrounding keyframes and interpolate
        const { prev, next, t, atEnd } = this.findKeyframes(keyframes, progress)
        const eased = applyEasing(t, track.easing ?? 'linear')

        // v13 Scheme B:
        //   atEnd=true  -> Reached/past last frame -> use next valueIn (top-level)
        //   atEnd=false -> Segment interpolation / before first frame -> start=prev.valueOut, end=next.valueIn
        const start = atEnd ? transformKfLeft(prev) : transformKfRight(prev)
        const end = transformKfLeft(next)

        // flipX uses Step logic: no interpolation, takes keyframe value corresponding to current time point
        // When t >= 0.5 uses next value, otherwise uses prev value
        const flipX = t >= 0.5 ? end.flipX : start.flipX

        return {
            targetObjectId: track.targetObjectId,
            x: lerp(start.x, end.x, eased),
            y: lerp(start.y, end.y, eased),
            scaleX: lerp(start.scaleX, end.scaleX, eased),
            scaleY: lerp(start.scaleY, end.scaleY, eased),
            rotation: lerp(start.rotation, end.rotation, eased),
            flipX,
            pivot: track.pivot,
        }
    }

    /**
     * Evaluate visibility track
     */
    static evaluateVisibility(track: VisibilityTrack, progress: number): VisibilityTrackOutput {
        const keyframes = track.keyframes
        if (keyframes.length === 0) {
            return {
                targetObjectId: track.targetObjectId,
                alpha: 1,
            }
        }

        if (keyframes.length === 1) {
            const kf = keyframes[0]
            if (!kf) throw new Error('Keyframe is undefined')
            return {
                targetObjectId: track.targetObjectId,
                alpha: visibilityKfRight(kf).alpha,
            }
        }

        const { prev, next, t, atEnd } = this.findKeyframes(keyframes, progress)
        const eased = applyEasing(t, track.easing ?? 'linear')

        const start = atEnd ? visibilityKfLeft(prev) : visibilityKfRight(prev)
        const end = visibilityKfLeft(next)

        return {
            targetObjectId: track.targetObjectId,
            alpha: lerp(start.alpha, end.alpha, eased),
        }
    }

    // v11.52: evaluateFrameSequence removed. Frame animation directly uses AnimatedSprite.play()

    /**
     * Evaluate effect track
     * v11.70: Added progress and duration parameters supporting progress-driven mode
     * For damped effects (jelly/squash), computes output directly using progress
     */
    static evaluateEffect(track: EffectTrack, progress: number, duration: number): EffectTrackOutput {
        const effectType = track.effectParams.type

        // v11.70: Damped effects use progress-driven mode, computing output directly
        // These effects rely on time decay, resetting when progress returns to zero on loop
        if (effectType === 'jelly' || effectType === 'squash') {
            const effectOutput = DynamicEffectManager.calculateWithProgress(
                track.effectParams,
                progress,
                duration
            )
            return {
                targetObjectId: track.targetObjectId,
                effectType: track.effectParams.type,
                effectParams: track.effectParams,
                active: true,
                // v11.70: Directly carries calculation results
                ...effectOutput
            }
        }

        // Non-damped effects: returns parameters for real-time computation by DynamicEffectManager
        return {
            targetObjectId: track.targetObjectId,
            effectType: track.effectParams.type,
            effectParams: track.effectParams,
            active: true,
        }
    }

    /**
     * Find surrounding keyframes
     * @param keyframes Keyframe array (sorted by time)
     * @param progress Normalized progress (0-1)
     *
     * v13 Scheme B enhanced return field `atEnd`:
     * - true: progress >= last frame time (reached end, should show last frame's valueIn/top-level)
     * - false: other (within segment / before first frame, should use prev.valueOut -> next.valueIn semantics)
     */
    private static findKeyframes<T extends { time: number }>(
        keyframes: T[],
        progress: number
    ): { prev: T; next: T; t: number; atEnd: boolean } {
        // Ensure array is non-empty
        if (keyframes.length === 0) {
            throw new Error('Keyframes array is empty')
        }

        const first = keyframes[0]
        const last = keyframes[keyframes.length - 1]

        if (!first || !last) {
            throw new Error('Keyframes array contains undefined elements')
        }

        // Boundary case: progress <= first frame (atEnd=false, use first frame valueOut)
        if (progress <= first.time) {
            return {
                prev: first,
                next: first,
                t: 0,
                atEnd: false,
            }
        }

        // Boundary case: progress >= last frame (atEnd=true, use last frame valueIn)
        if (progress >= last.time) {
            return {
                prev: last,
                next: last,
                t: 0,
                atEnd: true,
            }
        }

        // v13 Scheme B: When exactly on an intermediate keyframe, use its valueOut (forward-facing)
        // This ensures sudden jumps from split keyframes show the "right-side" value when playhead stops at keyframe position
        for (let i = 1; i < keyframes.length - 1; i++) {
            const kf = keyframes[i]
            if (kf && kf.time === progress) {
                return { prev: kf, next: kf, t: 0, atEnd: false }
            }
        }

        // Search for interval containing progress
        for (let i = 0; i < keyframes.length - 1; i++) {
            const prev = keyframes[i]
            const next = keyframes[i + 1]

            if (!prev || !next) continue

            if (progress >= prev.time && progress <= next.time) {
                const duration = next.time - prev.time
                const t = duration > 0 ? (progress - prev.time) / duration : 0

                return { prev, next, t, atEnd: false }
            }
        }

        // Should not reach here, return last frame as fallback
        return {
            prev: last,
            next: last,
            t: 0,
            atEnd: true,
        }
    }

    /**
     * Calculate track duration
     * v11.2: Frame sequence tracks calculate duration based on frame count and frame rate
     */
    static getTrackDuration(track: AnimationTrack): number {
        switch (track.trackType) {
            case 'transform':
            case 'visibility':
                // v12.x: 'auto' duration resolved at runtime
                if (track.duration === 'auto') return AUTO_DURATION_MARKER
                return track.duration ?? 1000
            case 'frame_sequence': {
                // v11.52: Frame sequence duration computed dynamically at runtime, using default here
                // Actual duration is computed by AnimationPlayer based on AnimatedSprite.textures.length
                return 1000
            }
            case 'effect': {
                // v11.70: Return appropriate duration according to effect type
                const effectType = track.effectParams.type
                const params = track.effectParams

                // Damped effects: use duration parameter or default 1000ms
                if (effectType === 'jelly' || effectType === 'squash') {
                    return (params as { duration?: number }).duration ?? 1000
                }

                // One-shot effects: use own duration parameter (ms)
                if (effectType === 'petrify') {
                    return (params as { duration?: number }).duration ?? 1000
                }
                if (effectType === 'shatter') {
                    return (params as { duration?: number }).duration ?? 1500
                }

                // Continuous effects (wave/breathe/float/glow/shake/motion_blur): infinite duration
                return Infinity
            }
            default:
                return 1000
        }
    }
}

/**
 * Merge multiple track outputs into unified AnimationOutput
 * v11.52: frameSequences removed
 */
export function mergeTrackOutputs(outputs: TrackOutput[]): AnimationOutput {
    const result: AnimationOutput = {
        transforms: [],
        visibilities: [],
        effects: [],
    }

    for (const output of outputs) {
        if ('x' in output && 'y' in output) {
            result.transforms.push(output)
        } else if ('alpha' in output && !('effectType' in output)) {
            result.visibilities.push(output)
        } else if ('effectType' in output) {
            result.effects.push(output as EffectTrackOutput)
        }
        // v11.52: frameSequences case deleted
    }

    return result
}
