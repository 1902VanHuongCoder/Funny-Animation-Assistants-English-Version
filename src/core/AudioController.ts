/**
 * AudioController — Unified audio state computation module
 *
 * Extracts state computation logic from ScenePlayer.vue updateAudio() as pure functions.
 * Actual WebAudio I/O is still controlled by ScenePlayer.
 *
 * Design principles:
 * - Pure functions, side-effect free, independent of any PIXI/WebAudio API
 * - Unit testable without mocking browser APIs
 * - FrameCapture does not play audio, but if audio timeline info is needed in the future, this module can be used directly
 */

import type { SceneObject } from '@/types/sceneObject'
import type {
    Action,
    RuntimeSlot,
    SetAudioAction,
} from '@/types/screenplay'

// ============================================================================
// Types
// ============================================================================

/**
 * Lightweight version of BlockPlayInfo, containing only fields needed for audio computation
 */
export interface AudioBlockInfo {
    startTime: number
    blockActions: Action[]
    slots?: RuntimeSlot[]
}

/**
 * Audio state computation result
 */
export interface AudioStateResult {
    /** Whether it should play */
    shouldPlay: boolean
    /** Target volume (0-1) */
    targetVolume: number
    /** Whether to loop */
    loop: boolean
    /** Playback start time (absolute time, ms) */
    playTime: number
    /** Fade-in duration (seconds) */
    fadeIn: number
    /** Whether currently in fade-out tail */
    inFadeOutTail: boolean
    /** Fade-out duration (seconds) */
    fadeOutDuration: number
    /** Stop time (absolute time, ms) */
    stopTime: number
}

// ============================================================================
// Core Pure Function
// ============================================================================

/**
 * Compute playback state of audio object at given absolute time
 *
 * This is a pure function without side effects:
 * - Does not access WebAudio APIs
 * - Does not modify external state
 * - Computes and returns results solely based on input data
 *
 * @param objSetup         Setup definition of audio object
 * @param blockPlayInfos   Playback info of all Blocks (for backtracking historical set_audio actions)
 * @param currentAbsTime   Current absolute time (ms)
 * @param audioDurationSec Known audio duration (seconds), used for fadeOut calculation on natural completion.
 *                         Pass 0 if audio has not loaded yet.
 */
export function computeAudioState(
    objSetup: SceneObject,
    blockPlayInfos: AudioBlockInfo[],
    currentAbsTime: number,
    audioDurationSec: number,
): AudioStateResult {
    const result: AudioStateResult = {
        shouldPlay: false,
        targetVolume: 1.0,
        loop: false,
        playTime: 0,
        fadeIn: 0,
        inFadeOutTail: false,
        fadeOutDuration: 0,
        stopTime: 0,
    }

    // ──── 1. Determine initial playback state ────
    let activePlayAction: {
        params: SetAudioAction['params']
        virtualTime: number
    } | null = null
    let activeStopAction: {
        params: SetAudioAction['params']
        virtualTime: number
    } | null = null

    const audioProps = objSetup as unknown as {
        playbackState?: string
        volume?: number
        loop?: boolean | string
    }
    const initialPlaybackState =
        audioProps.playbackState === 'play' ? 'play' : 'stop'

    if (initialPlaybackState === 'play') {
        activePlayAction = {
            params: {
                action: 'play',
                volume: audioProps.volume ?? 1.0,
                loop: audioProps.loop === true || audioProps.loop === 'true',
                fadeIn: 0,
            },
            virtualTime: 0,
        }
    }

    // ──── 2. Iterate through set_audio actions of all Blocks to determine final state ────
    for (const info of blockPlayInfos) {
        const actions = info.blockActions.filter(
            (a: Action) => a.type === 'set_audio' && a.target === objSetup.id,
        )
        for (const action of actions) {
            let t = info.startTime
            const slot = info.slots?.[action.slotIndex]
            if (slot) t += slot.startTime

            const audioParams = action.params as SetAudioAction['params']
            if (audioParams.action === 'play') {
                if (t <= currentAbsTime) {
                    activePlayAction = {
                        ...action,
                        params: audioParams,
                        virtualTime: t,
                    }
                    activeStopAction = null
                }
            } else {
                if (activePlayAction && t >= activePlayAction.virtualTime) {
                    activeStopAction ??= {
                        ...action,
                        params: audioParams,
                        virtualTime: t,
                    }
                }
            }
        }
    }

    // ──── 3. Compute final result based on Play/Stop/FadeOut states ────
    if (!activePlayAction) {
        return result
    }

    const playParams = activePlayAction.params
    result.playTime = activePlayAction.virtualTime
    result.loop =
        playParams.loop === true || String(playParams.loop) === 'true'
    const parsedVolume = Number(playParams.volume)
    result.targetVolume = isNaN(parsedVolume) ? 1.0 : parsedVolume
    result.fadeIn = Number(playParams.fadeIn) || 0
    result.shouldPlay = true

    if (activeStopAction) {
        const stopParams = activeStopAction.params
        result.stopTime = activeStopAction.virtualTime
        result.fadeOutDuration = Number(stopParams.fadeOut) || 0
        if (
            currentAbsTime
            < result.stopTime + result.fadeOutDuration * 1000
        ) {
            if (currentAbsTime >= result.stopTime) {
                result.inFadeOutTail = true
            }
        } else {
            result.shouldPlay = false
        }
    } else if (
        !result.loop
        && (Number(playParams.fadeOut) || 0) > 0
        && audioDurationSec > 0
    ) {
        // Non-looping + has fadeOut + known duration -> compute FadeOut before natural end
        const fadeOutSec = Number(playParams.fadeOut) || 0
        const durationMs = audioDurationSec * 1000
        const fadeOutMs = fadeOutSec * 1000
        const naturalEndTime = result.playTime + durationMs
        const autoStopStartTime = naturalEndTime - fadeOutMs
        if (currentAbsTime >= autoStopStartTime) {
            result.stopTime = autoStopStartTime
            result.fadeOutDuration = fadeOutSec
            if (currentAbsTime < naturalEndTime) {
                result.inFadeOutTail = true
            } else {
                result.shouldPlay = false
            }
        }
    }

    return result
}
