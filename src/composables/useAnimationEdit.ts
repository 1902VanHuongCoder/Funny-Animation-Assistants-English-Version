/**
 * useAnimationEdit - Animation WYSIWYG editor core composable
 * 
 * Responsibilities:
 * - Deep clone AnimationDefinition as local editing state
 * - Keyframe CRUD (always sorted by time)
 * - Playhead management + evaluateAtTime
 * - Auto-Key logic
 * - Playback control (internally uses AnimationPlayer)
 * - Dirty state tracking
 * 
 * Data isolation: Does not read/write sceneObjectStore; all transformations during editing are written only to local keyframe data
 */

import { computed, reactive, ref } from 'vue'

import { AnimationTrackEvaluator } from '@/core/AnimationTrackEvaluator'
import type {
    AnimationDefinition,
    AnimationTimingMode,
    AnimationTrack,
    EasingType,
    EffectParams,
    FrameSequenceTrack,
    TransformKeyframe,
    TransformTrackOutput,
    VisibilityKeyframe,
    VisibilityTrackOutput,
} from '@/types/animation'

/** Keyframe time matching tolerance */
const TIME_TOLERANCE = 0.005

export interface UseAnimationEditOptions {
    /** Original animation definition (deep-cloned upon input) */
    animation: AnimationDefinition
    /** Initially edited transform track index */
    initialTrackIndex?: number
}

export function useAnimationEdit(options: UseAnimationEditOptions) {
    // ===== Core Editing State =====

    /** Local deep-cloned animation definition (reactive) */
    const animationDef = reactive<AnimationDefinition>(
        JSON.parse(JSON.stringify(options.animation)) as AnimationDefinition
    )

    /** Initial snapshot for dirty state comparison (needs synchronized update when switching animations) */
    let initialSnapshot = JSON.stringify(options.animation)

    /** Currently edited track index */
    const currentTrackIndex = ref(options.initialTrackIndex ?? findFirstTransformTrackIndex())

    /** Currently selected keyframe index (-1 = none selected) */
    const selectedKeyframeIndex = ref(0)

    /** Playhead position (normalized 0-1) */
    const playheadPosition = ref(0)

    /** Auto-Key always enabled (dragging writes keyframe directly) */
    const autoKeyEnabled = ref(true)

    /** Playback state */
    const isPlaying = ref(false)

    /** Loop playback */
    const loopPlayback = ref(false)

    /** Internal player (reserved, currently replaced by rAF loop) */
    // const player = shallowRef(new AnimationPlayer())

    // ===== Computed Properties =====

    /** All tracks (all types) */
    const allTracks = computed(() =>
        animationDef.tracks
            .map((t, i) => ({ track: t, index: i }))
    )

    /** Available transform tracks */
    const transformTracks = computed(() =>
        animationDef.tracks
            .map((t, i) => ({ track: t, index: i }))
            .filter(({ track }) => track.trackType === 'transform')
    )

    /** Currently edited track (any type) */
    const currentTrackAny = computed((): AnimationTrack | null => {
        if (currentTrackIndex.value < 0) return null
        return animationDef.tracks[currentTrackIndex.value] ?? null
    })

    /** Currently edited transform track (returned only when type matches) */
    const currentTrack = computed(() => {
        const track = currentTrackAny.value
        if (track?.trackType === 'transform') return track
        return null
    })

    /** Currently edited visibility track (returned only when type matches) */
    const currentVisibilityTrack = computed(() => {
        const track = currentTrackAny.value
        if (track?.trackType === 'visibility') return track
        return null
    })

    /** Currently edited effect track (returned only when type matches) */
    const currentEffectTrack = computed(() => {
        const track = currentTrackAny.value
        if (track?.trackType === 'effect') return track
        return null
    })

    /** Currently edited frame_sequence track (returned only when type matches) */
    const currentFrameSequenceTrack = computed(() => {
        const track = currentTrackAny.value
        if (track?.trackType === 'frame_sequence') return track
        return null
    })

    /** Tri-state selection model */
    type SelectionMode = 'none' | 'track' | 'keyframe'
    const selectionMode = computed((): SelectionMode => {
        if (currentTrackIndex.value < 0) return 'none'
        if (selectedKeyframeIndex.value < 0) return 'track'
        return 'keyframe'
    })

    /** Whether current track supports keyframe editing */
    const isKeyframable = computed(() => {
        const t = currentTrackAny.value
        return t?.trackType === 'transform' || t?.trackType === 'visibility'
    })

    /** Current track's keyframe list (transform-only, kept for backwards compatibility) */
    const keyframes = computed(() => currentTrack.value?.keyframes ?? [])

    /** Currently selected keyframe (transform-only) */
    const selectedKeyframe = computed(() => {
        if (selectedKeyframeIndex.value < 0) return null
        return keyframes.value[selectedKeyframeIndex.value] ?? null
    })

    /**
     * Active track keyframes list (transform or visibility).
     * seekPrev/Next and findKeyframeAtTime should use this collection instead of keyframes.
     */
    const activeKeyframes = computed((): { time: number }[] => {
        const t = currentTrackAny.value
        if (t?.trackType === 'transform') return currentTrack.value?.keyframes ?? []
        if (t?.trackType === 'visibility') return currentVisibilityTrack.value?.keyframes ?? []
        return []
    })

    /** Runtime dynamic track duration override (e.g., frame_sequence calculated from total frames/fps) */
    const trackDurationOverrideMs = ref<number | null>(null)

    /** Current track duration (ms) (supports transform / visibility / runtime override) */
    const trackDuration = computed(() => {
        if (trackDurationOverrideMs.value !== null) return trackDurationOverrideMs.value
        const track = currentTrack.value ?? currentVisibilityTrack.value
        if (!track) return 1000
        const d = track.duration
        if (d === 'auto' || d === undefined) return 1000
        return d
    })

    /** Whether there are unsaved changes */
    const hasUnsavedChanges = computed(() =>
        JSON.stringify(animationDef) !== initialSnapshot
    )

    /** Evaluated output at the current time point */
    const currentOutput = computed(() => evaluateAtTime(playheadPosition.value))

    // ===== Helper Functions =====

    function findFirstTransformTrackIndex(): number {
        const idx = options.animation.tracks.findIndex(t => t.trackType === 'transform')
        return idx >= 0 ? idx : 0
    }

    // ===== Keyframe Operations =====

    /**
     * Resort current track keyframes array (ascending by time)
     * Hard constraint: AnimationTrackEvaluator.findKeyframes assumes sorted array
     */
    function sortKeyframes() {
        const track = currentTrack.value
        if (!track) return
        track.keyframes.sort((a, b) => a.time - b.time)
    }

    /**
     * Update specified keyframe properties
     */
    function updateKeyframe(index: number, values: Partial<TransformKeyframe>) {
        const track = currentTrack.value
        if (!track || index < 0 || index >= track.keyframes.length) return

        const kf = track.keyframes[index]
        if (!kf) return

        Object.assign(kf, values)

        // If time was modified, resort keyframes
        if ('time' in values) {
            sortKeyframes()
            // Find new index of this keyframe after sort
            const newIdx = track.keyframes.findIndex(k => k === kf)
            if (newIdx >= 0) selectedKeyframeIndex.value = newIdx
        }
    }

    /**
     * Add keyframe at playhead position (based on current interpolated state)
     */
    function addKeyframeAtPlayhead(): number {
        const track = currentTrack.value
        if (!track) return -1

        const time = playheadPosition.value

        // Check if keyframe already exists at this time point
        const existing = findKeyframeAtTime(time)
        if (existing >= 0) {
            selectedKeyframeIndex.value = existing
            return existing
        }

        // Create new keyframe based on interpolated state
        const interpolated = AnimationTrackEvaluator.evaluateTransform(track, time)
        const newKf: TransformKeyframe = {
            time,
            x: interpolated.x,
            y: interpolated.y,
            scaleX: interpolated.scaleX,
            scaleY: interpolated.scaleY,
            rotation: interpolated.rotation,
            ...(interpolated.flipX !== undefined ? { flipX: interpolated.flipX } : {}),
        }

        return insertKeyframeSorted(newKf)
    }

    /**
     * Insert keyframe and keep sorted
     * @returns Inserted index
     */
    function insertKeyframeSorted(kf: TransformKeyframe): number {
        const track = currentTrack.value
        if (!track) return -1

        // Find correct insertion index
        let insertIdx = track.keyframes.findIndex(k => k.time > kf.time)
        if (insertIdx === -1) insertIdx = track.keyframes.length

        track.keyframes.splice(insertIdx, 0, kf)
        selectedKeyframeIndex.value = insertIdx
        return insertIdx
    }

    /**
     * Remove specified keyframe (retains minimum 2 keyframes constraint)
     */
    function removeKeyframe(index: number) {
        // Supports transform and visibility tracks
        const trackType = currentTrackAny.value?.trackType
        const kfs = activeKeyframes.value
        if (kfs.length <= 2) return
        if (index < 0 || index >= kfs.length) return

        if (trackType === 'transform') {
            currentTrack.value!.keyframes.splice(index, 1)
        } else if (trackType === 'visibility') {
            currentVisibilityTrack.value!.keyframes.splice(index, 1)
        } else {
            return
        }

        // Adjust selected index
        if (selectedKeyframeIndex.value >= kfs.length - 1) {
            selectedKeyframeIndex.value = kfs.length - 2
        }
    }

    /**
     * v13 (Scheme B): Split keyframe into valueIn / valueOut
     * Initial out equals current valueIn field values with unchanged semantics; user can edit independently later.
     */
    function splitKeyframeAt(index: number): boolean {
        const trackType = currentTrackAny.value?.trackType
        if (trackType === 'transform') {
            const kf = currentTrack.value?.keyframes[index]
            if (!kf || kf.out) return false
            const out: NonNullable<TransformKeyframe['out']> = {}
            if (kf.x !== undefined) out.x = kf.x
            if (kf.y !== undefined) out.y = kf.y
            if (kf.scaleX !== undefined) out.scaleX = kf.scaleX
            if (kf.scaleY !== undefined) out.scaleY = kf.scaleY
            if (kf.rotation !== undefined) out.rotation = kf.rotation
            if (kf.flipX !== undefined) out.flipX = kf.flipX
            kf.out = out
            return true
        }
        if (trackType === 'visibility') {
            const kf = currentVisibilityTrack.value?.keyframes[index]
            if (!kf || kf.out) return false
            const out: NonNullable<VisibilityKeyframe['out']> = {}
            if (kf.alpha !== undefined) out.alpha = kf.alpha
            kf.out = out
            return true
        }
        return false
    }

    /**
     * v13 (Scheme B): Merge keyframe valueIn / valueOut (discards out, retains valueIn)
     */
    function mergeKeyframeAt(index: number): boolean {
        const trackType = currentTrackAny.value?.trackType
        if (trackType === 'transform') {
            const kf = currentTrack.value?.keyframes[index]
            if (!kf?.out) return false
            delete kf.out
            return true
        }
        if (trackType === 'visibility') {
            const kf = currentVisibilityTrack.value?.keyframes[index]
            if (!kf?.out) return false
            delete kf.out
            return true
        }
        return false
    }

    /**
     * v13 (Scheme B): Determine whether keyframe is structurally split (has at least one out field)
     */
    function isKeyframeStructurallySplit(
        kf: TransformKeyframe | VisibilityKeyframe | undefined | null,
    ): boolean {
        if (!kf?.out) return false
        return Object.keys(kf.out).length > 0
    }

    /**
     * Update keyframe valueOut field (ensures out object exists)
     * value === undefined indicates fallback to top-level valueIn (i.e. delete that out field)
     */
    function updateKeyframeOut(
        index: number,
        field: keyof NonNullable<TransformKeyframe['out']>,
        value: number | boolean | undefined,
    ): void {
        const trackType = currentTrackAny.value?.trackType
        if (trackType === 'transform') {
            const kf = currentTrack.value?.keyframes[index]
            if (!kf) return
            kf.out ??= {}
            if (value === undefined) {
                delete (kf.out as Record<string, unknown>)[field]
                if (Object.keys(kf.out).length === 0) delete kf.out
            } else {
                (kf.out as Record<string, unknown>)[field] = value
            }
        }
    }

    function updateVisibilityKeyframeOut(
        index: number,
        value: number | undefined,
    ): void {
        const kf = currentVisibilityTrack.value?.keyframes[index]
        if (!kf) return
        kf.out ??= {}
        if (value === undefined) {
            delete kf.out.alpha
            if (Object.keys(kf.out).length === 0) delete kf.out
        } else {
            kf.out.alpha = value
        }
    }

    /**
     * Duplicate selected keyframe to playhead position
     */
    function duplicateKeyframeToPlayhead(): number {
        const track = currentTrackAny.value
        if (!track || selectedKeyframeIndex.value < 0) return -1

        if (track.trackType === 'transform') {
            const kf = currentTrack.value?.keyframes[selectedKeyframeIndex.value]
            if (!kf) return -1

            const newKf: TransformKeyframe = {
                ...(JSON.parse(JSON.stringify(kf)) as TransformKeyframe),
                time: playheadPosition.value,
            }
            return insertKeyframeSorted(newKf)
        }

        if (track.trackType === 'visibility') {
            const kf = currentVisibilityTrack.value?.keyframes[selectedKeyframeIndex.value]
            if (!kf) return -1

            const newKf: VisibilityKeyframe = {
                ...(JSON.parse(JSON.stringify(kf)) as VisibilityKeyframe),
                time: playheadPosition.value,
            }
            const visibilityTrack = currentVisibilityTrack.value
            if (!visibilityTrack) return -1
            let insertIdx = visibilityTrack.keyframes.findIndex(item => item.time > newKf.time)
            if (insertIdx === -1) insertIdx = visibilityTrack.keyframes.length
            visibilityTrack.keyframes.splice(insertIdx, 0, newKf)
            selectedKeyframeIndex.value = insertIdx
            return insertIdx
        }

        return -1
    }

    /**
     * Reset selected keyframe to default values
     */
    function resetKeyframe(index: number) {
        const kf = currentTrack.value?.keyframes[index]
        if (!kf) return
        updateKeyframe(index, {
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
        })
        // Clear flipX separately since undefined is not assignable with exactOptionalPropertyTypes
        if (kf.flipX !== undefined) delete kf.flipX
    }

    // ===== Copy / Paste =====

    /** Keyframe clipboard */
    let keyframeClipboard:
        | { trackType: 'transform'; keyframe: TransformKeyframe }
        | { trackType: 'visibility'; keyframe: VisibilityKeyframe }
        | null = null

    /** Whether clipboard has content (reactive, for UI paste button enable/disable) */
    const hasKeyframeClipboard = ref(false)

    /** Type of keyframe in clipboard (for UI to determine if current track accepts paste) */
    const keyframeClipboardType = ref<'transform' | 'visibility' | null>(null)

    function canPasteKeyframeToCurrentTrack(): boolean {
        const trackType = currentTrackAny.value?.trackType
        if (!keyframeClipboard || !trackType) return false
        return keyframeClipboard.trackType === trackType
    }

    /**
     * Copy selected keyframe to clipboard
     */
    function copyKeyframe() {
        const track = currentTrackAny.value
        if (track?.trackType === 'transform') {
            const kf = currentTrack.value?.keyframes[selectedKeyframeIndex.value]
            if (!kf) return
            keyframeClipboard = {
                trackType: 'transform',
                keyframe: JSON.parse(JSON.stringify(kf)) as TransformKeyframe,
            }
            hasKeyframeClipboard.value = true
            keyframeClipboardType.value = 'transform'
        } else if (track?.trackType === 'visibility') {
            const kf = currentVisibilityTrack.value?.keyframes[selectedKeyframeIndex.value]
            if (!kf) return
            keyframeClipboard = {
                trackType: 'visibility',
                keyframe: JSON.parse(JSON.stringify(kf)) as VisibilityKeyframe,
            }
            hasKeyframeClipboard.value = true
            keyframeClipboardType.value = 'visibility'
        }
    }

    /**
     * Paste keyframe from clipboard to playhead position
     * @returns Inserted index, or -1 if no clipboard content
     */
    function pasteKeyframe(): number {
        const clipboard = keyframeClipboard
        if (!clipboard || !canPasteKeyframeToCurrentTrack()) return -1
        if (clipboard.trackType === 'transform') {
            const newKf: TransformKeyframe = {
                ...(JSON.parse(JSON.stringify(clipboard.keyframe)) as TransformKeyframe),
                time: playheadPosition.value,
            }
            return insertKeyframeSorted(newKf)
        }

        const track = currentVisibilityTrack.value
        if (!track) return -1
        const newKf: VisibilityKeyframe = {
            ...(JSON.parse(JSON.stringify(clipboard.keyframe)) as VisibilityKeyframe),
            time: playheadPosition.value,
        }
        let insertIdx = track.keyframes.findIndex(k => k.time > newKf.time)
        if (insertIdx === -1) insertIdx = track.keyframes.length
        track.keyframes.splice(insertIdx, 0, newKf)
        selectedKeyframeIndex.value = insertIdx
        return insertIdx
    }

    function canDuplicateKeyframeToPlayhead(): boolean {
        const track = currentTrackAny.value
        if (!track || selectedKeyframeIndex.value < 0) return false
        return track.trackType === 'transform' || track.trackType === 'visibility'
    }

    /**
     * Find keyframe index at specified time (supports transform and visibility tracks)
     */
    function findKeyframeAtTime(time: number): number {
        const kfs = activeKeyframes.value
        for (let i = 0; i < kfs.length; i++) {
            if (Math.abs((kfs[i]?.time ?? -1) - time) < TIME_TOLERANCE) return i
        }
        return -1
    }

    // ===== Evaluation =====

    /**
     * Evaluate transform output at specified time
     */
    function evaluateAtTime(time: number): TransformTrackOutput | null {
        const track = currentTrack.value
        if (!track) return null
        return AnimationTrackEvaluator.evaluateTransform(track, time)
    }

    // ===== Canvas Interaction -> Keyframe Commit =====

    /** Return status for `commitTransformAtPlayhead` */
    type CommitTransformResult =
        /** Updated existing keyframe at playhead position */
        | { status: 'updated'; index: number }
        /** Empty track - created first keyframe */
        | { status: 'created'; index: number }
        /** Track does not exist or type mismatch (not committed) */
        | { status: 'no-track' }
        /** Track has keyframes but playhead is not on any keyframe - no new frame created, caller restores canvas */
        | { status: 'skipped-no-keyframe-at-playhead' }

    /**
     * After canvas drag/scale/rotate ends, commits transform delta into keyframe at current playhead position.
     *
     * Behavior (from v22):
     * - If keyframe exists at current time point: update that keyframe.
     * - If track has no keyframes: create first keyframe (establish baseline pose).
     * - If track has keyframes but playhead is not on any keyframe: **will not automatically create a new keyframe**.
     *   Caller should restore canvas to interpolated pose and prompt user to explicitly add a keyframe first.
     *
     * @param values Keyframe space delta (relative to baseline pose)
     * @returns Result of commit, caller can decide whether to restore canvas or notify user
     */
    function commitTransformAtPlayhead(values: Partial<TransformKeyframe>): CommitTransformResult {
        return commitAutoKey(values)
    }

    function commitAutoKey(finalValues: Partial<TransformKeyframe>): CommitTransformResult {
        const track = currentTrack.value
        if (!track) return { status: 'no-track' }

        const time = playheadPosition.value
        const existingIdx = findKeyframeAtTime(time)

        if (existingIdx >= 0) {
            // Update existing keyframe
            Object.assign(track.keyframes[existingIdx]!, finalValues)
            return { status: 'updated', index: existingIdx }
        }

        if (track.keyframes.length === 0) {
            // Empty track: create first keyframe (establish baseline pose)
            const interpolated = AnimationTrackEvaluator.evaluateTransform(track, time)
            const newKf: TransformKeyframe = {
                time,
                x: interpolated.x,
                y: interpolated.y,
                scaleX: interpolated.scaleX,
                scaleY: interpolated.scaleY,
                rotation: interpolated.rotation,
                ...(interpolated.flipX !== undefined ? { flipX: interpolated.flipX } : {}),
                ...finalValues,
            }
            const idx = insertKeyframeSorted(newKf)
            return { status: 'created', index: idx }
        }

        // Track already has keyframes but playhead is not on any frame: do not silently create, caller restores canvas and prompts
        return { status: 'skipped-no-keyframe-at-playhead' }
    }

    // ===== Playback Control =====

    let animationFrameId: number | null = null
    let lastTimestamp: number | null = null

    function play() {
        if (isPlaying.value) return
        isPlaying.value = true
        lastTimestamp = null
        animationFrameId = requestAnimationFrame(playbackTick)
    }

    function pause() {
        isPlaying.value = false
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId)
            animationFrameId = null
        }
    }

    function togglePlay() {
        if (isPlaying.value) pause()
        else play()
    }

    function playbackTick(timestamp: number) {
        if (!isPlaying.value) return

        if (lastTimestamp !== null) {
            const deltaMs = timestamp - lastTimestamp
            const duration = trackDuration.value
            if (duration > 0) {
                const progressDelta = deltaMs / duration
                let newProgress = playheadPosition.value + progressDelta

                if (newProgress >= 1) {
                    if (loopPlayback.value) {
                        newProgress = newProgress % 1
                    } else {
                        newProgress = 1
                        pause()
                    }
                }

                playheadPosition.value = newProgress
            }
        }

        lastTimestamp = timestamp
        if (isPlaying.value) {
            animationFrameId = requestAnimationFrame(playbackTick)
        }
    }

    /**
     * Seek to specified time
     */
    function seekTo(time: number) {
        playheadPosition.value = Math.max(0, Math.min(1, time))

        // If precisely on a keyframe, select it
        const idx = findKeyframeAtTime(playheadPosition.value)
        if (idx >= 0) {
            selectedKeyframeIndex.value = idx
        }
    }

    /**
     * Seek to previous keyframe (supports transform and visibility tracks)
     */
    function seekPrevKeyframe() {
        const kfs = activeKeyframes.value
        for (let i = kfs.length - 1; i >= 0; i--) {
            const kf = kfs[i]
            if (kf && kf.time < playheadPosition.value - TIME_TOLERANCE) {
                seekTo(kf.time)
                selectedKeyframeIndex.value = i
                return
            }
        }
        // Already at start, seek to 0
        seekTo(0)
    }

    /**
     * Seek to next keyframe (supports transform and visibility tracks)
     */
    function seekNextKeyframe() {
        const kfs = activeKeyframes.value
        for (let i = 0; i < kfs.length; i++) {
            const kf = kfs[i]
            if (kf && kf.time > playheadPosition.value + TIME_TOLERANCE) {
                seekTo(kf.time)
                selectedKeyframeIndex.value = i
                return
            }
        }
        // Already at end, seek to 1
        seekTo(1)
    }

    // ===== Track Settings Operations =====

    /** Switch currently edited track (supports any track type) */
    function selectTrack(index: number) {
        if (index < 0 || index >= animationDef.tracks.length) return
        currentTrackIndex.value = index
        selectedKeyframeIndex.value = 0
        playheadPosition.value = 0
    }

    /** Deselect all (return to animation level) */
    function deselectAll() {
        currentTrackIndex.value = -1
        selectedKeyframeIndex.value = -1
    }

    /** Select track only (without selecting a keyframe) */
    function selectTrackOnly(index: number) {
        if (index < 0 || index >= animationDef.tracks.length) return
        currentTrackIndex.value = index
        selectedKeyframeIndex.value = -1
    }

    /** Update track pivot */
    function updatePivot(pivot: { x: number; y: number }) {
        const track = currentTrack.value
        if (!track) return
        track.pivot = { ...pivot }
    }

    /** Clear custom track pivot, fallback to object default transform point */
    function clearPivot() {
        const track = currentTrack.value
        if (!track) return
        delete track.pivot
    }

    /** Update track easing (supports transform and visibility tracks) */
    function updateEasing(easing: string) {
        const track = currentTrack.value ?? currentVisibilityTrack.value
        if (!track) return
        if (easing) {
            track.easing = easing as EasingType
        } else {
            delete track.easing
        }
    }

    /** Update animation loop setting */
    function updateLoop(loop: boolean) {
        animationDef.loop = loop
    }

    /** Update animation fill mode */
    function updateFillMode(fillMode: 'none' | 'forwards') {
        animationDef.fillMode = fillMode
    }

    /** Update animation default timing mode */
    function updateTimingMode(timingMode: AnimationTimingMode) {
        animationDef.timingMode = timingMode
    }

    /** Update track duration (supports transform and visibility tracks) */
    function updateDuration(duration: number | 'auto') {
        const track = currentTrack.value ?? currentVisibilityTrack.value
        if (!track) return
        track.duration = duration
    }

    // ===== Track CRUD =====

    /** Add track */
    function addTrack(track: AnimationTrack): number {
        animationDef.tracks.push(track)
        const idx = animationDef.tracks.length - 1
        currentTrackIndex.value = idx
        selectedKeyframeIndex.value = 0
        return idx
    }

    /** Remove track */
    function removeTrack(index: number) {
        if (index < 0 || index >= animationDef.tracks.length) return
        animationDef.tracks.splice(index, 1)
        // Adjust selected index
        if (currentTrackIndex.value >= animationDef.tracks.length) {
            currentTrackIndex.value = animationDef.tracks.length - 1
        }
        if (animationDef.tracks.length === 0) {
            currentTrackIndex.value = -1
            selectedKeyframeIndex.value = -1
        }
    }

    // ===== Visibility Operations =====

    /** Evaluate visibility output at specified time */
    function evaluateVisibilityAtTime(time: number): VisibilityTrackOutput | null {
        const track = currentVisibilityTrack.value
        if (!track) return null
        return AnimationTrackEvaluator.evaluateVisibility(track, time)
    }

    /** Add visibility keyframe at playhead position */
    function addVisibilityKeyframeAtPlayhead(): number {
        const track = currentVisibilityTrack.value
        if (!track) return -1

        const time = playheadPosition.value
        // Check if keyframe already exists at this time point
        const existing = track.keyframes.findIndex(k => Math.abs(k.time - time) < TIME_TOLERANCE)
        if (existing >= 0) {
            selectedKeyframeIndex.value = existing
            return existing
        }

        const interpolated = AnimationTrackEvaluator.evaluateVisibility(track, time)
        const newKf: VisibilityKeyframe = {
            time,
            alpha: interpolated.alpha,
        }

        let insertIdx = track.keyframes.findIndex(k => k.time > newKf.time)
        if (insertIdx === -1) insertIdx = track.keyframes.length
        track.keyframes.splice(insertIdx, 0, newKf)
        selectedKeyframeIndex.value = insertIdx
        return insertIdx
    }

    /** Update visibility keyframe */
    function updateVisibilityKeyframe(index: number, values: Partial<VisibilityKeyframe>) {
        const track = currentVisibilityTrack.value
        if (!track || index < 0 || index >= track.keyframes.length) return
        const kf = track.keyframes[index]
        if (!kf) return
        Object.assign(kf, values)
        if ('time' in values) {
            track.keyframes.sort((a, b) => a.time - b.time)
            const newIdx = track.keyframes.findIndex(k => k === kf)
            if (newIdx >= 0) selectedKeyframeIndex.value = newIdx
        }
    }

    // ===== Effect Operations =====

    /** Update effect track parameters */
    function updateEffectParams(params: EffectParams) {
        const track = currentEffectTrack.value
        if (!track) return
        track.effectParams = params
    }

    // ===== FrameSequence Operations =====

    /** Update FrameSequence track parameters */
    function updateFrameSequenceTrack(values: Partial<Pick<FrameSequenceTrack, 'fps' | 'loop' | 'assetId'>>) {
        const track = currentFrameSequenceTrack.value
        if (!track) return
        if (values.fps !== undefined) track.fps = values.fps
        if (values.loop !== undefined) track.loop = values.loop
        if (values.assetId !== undefined) track.assetId = values.assetId
    }

    /** Set or clear runtime dynamic track duration override */
    function setTrackDurationOverride(durationMs: number | null) {
        trackDurationOverrideMs.value = durationMs
    }

    // ===== Reset (Switch Animation) =====

    function resetAnimation(newAnim: AnimationDefinition) {
        pause()
        const fresh = JSON.parse(JSON.stringify(newAnim)) as AnimationDefinition
        // In-place replace all fields of reactive object
        for (const key of Object.keys(animationDef) as (keyof AnimationDefinition)[]) {
            if (!(key in fresh)) delete (animationDef as Record<string, unknown>)[key]
        }
        Object.assign(animationDef, fresh)
        // Reset dirty state baseline to fresh snapshot to avoid false "modified" alerts
        initialSnapshot = JSON.stringify(fresh)
        trackDurationOverrideMs.value = null
        // Reset playhead and selection state
        playheadPosition.value = 0
        if (newAnim.tracks.length === 0) {
            // Empty animation: deselect all tracks and keyframes
            currentTrackIndex.value = -1
            selectedKeyframeIndex.value = -1
        } else {
            const firstTransformIdx = newAnim.tracks.findIndex(t => t.trackType === 'transform')
            currentTrackIndex.value = firstTransformIdx >= 0 ? firstTransformIdx : 0
            selectedKeyframeIndex.value = 0
        }
    }

    function markSaved() {
        initialSnapshot = JSON.stringify(animationDef)
    }

    // ===== Cleanup =====

    function dispose() {
        pause()
    }

    // ===== Export =====

    return {
        // Data
        animationDef,
        currentTrackIndex,
        currentTrack,
        currentTrackAny,
        currentVisibilityTrack,
        allTracks,
        transformTracks,
        keyframes,
        activeKeyframes,
        selectedKeyframeIndex,
        selectedKeyframe,
        playheadPosition,
        autoKeyEnabled,
        isPlaying,
        loopPlayback,
        trackDuration,
        hasUnsavedChanges,
        currentOutput,
        selectionMode,
        isKeyframable,

        // Keyframe operations
        updateKeyframe,
        addKeyframeAtPlayhead,
        removeKeyframe,
        splitKeyframeAt,
        mergeKeyframeAt,
        isKeyframeStructurallySplit,
        updateKeyframeOut,
        updateVisibilityKeyframeOut,
        duplicateKeyframeToPlayhead,
        canDuplicateKeyframeToPlayhead,
        resetKeyframe,
        copyKeyframe,
        pasteKeyframe,
        hasKeyframeClipboard,
        keyframeClipboardType,
        canPasteKeyframeToCurrentTrack,
        sortKeyframes,
        findKeyframeAtTime,

        // Evaluation
        evaluateAtTime,

        // Canvas interaction
        commitTransformAtPlayhead,

        // Playback control
        play,
        pause,
        togglePlay,
        seekTo,
        seekPrevKeyframe,
        seekNextKeyframe,

        // Track settings
        selectTrack,
        selectTrackOnly,
        deselectAll,
        updatePivot,
        clearPivot,
        updateEasing,
        updateDuration,
        updateLoop,
        updateFillMode,
        updateTimingMode,

        // Track CRUD
        addTrack,
        removeTrack,

        // Visibility operations
        evaluateVisibilityAtTime,
        addVisibilityKeyframeAtPlayhead,
        updateVisibilityKeyframe,

        // Effect operations
        currentEffectTrack,
        updateEffectParams,

        // FrameSequence operations
        currentFrameSequenceTrack,
        updateFrameSequenceTrack,
        setTrackDurationOverride,

        // Switch animation
        resetAnimation,
        markSaved,

        // Cleanup
        dispose,
    }
}

export type AnimationEditContext = ReturnType<typeof useAnimationEdit>
