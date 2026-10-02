import type { AudioTrack } from './types'

/**
 * Audio Mixer
 * Uses OfflineAudioContext to pre-render all audio tracks
 */
export class AudioMixer {
    private offlineCtx: OfflineAudioContext | null = null
    private audioTracks: AudioTrack[] = []

    /**
     * Initialize mixer
     * @param duration Total duration (ms)
     * @param sampleRate Sample rate
     */
    initialize(duration: number, sampleRate = 48000): void {
        const lengthInSamples = Math.ceil((duration / 1000) * sampleRate)

        this.offlineCtx = new OfflineAudioContext({
            numberOfChannels: 2,
            length: lengthInSamples,
            sampleRate: sampleRate,
        })
    }

    /**
     * Add audio track
     */
    addTrack(track: AudioTrack): void {
        this.audioTracks.push(track)
    }

    /**
     * Render and mix all audio tracks
     */
    async render(): Promise<AudioBuffer> {
        if (!this.offlineCtx) {
            throw new Error('AudioMixer not initialized')
        }

        // Create audio graph for each track
        for (const track of this.audioTracks) {
            await this.addTrackToContext(track)
        }

        // Start offline rendering
        const renderedBuffer = await this.offlineCtx.startRendering()
        return renderedBuffer
    }

    /**
     * Add track to audio context
     */
    private addTrackToContext(track: AudioTrack): Promise<void> {
        if (!this.offlineCtx) {
            return Promise.resolve()
        }

        const ctx = this.offlineCtx
        const startTimeSec = track.startTime / 1000

        // Create buffer source
        const source = ctx.createBufferSource()
        source.buffer = track.buffer

        // Create gain node
        const gainNode = ctx.createGain()

        // Set volume
        gainNode.gain.value = track.volume

        // Apply fade-in (fadeIn/fadeOut units are already seconds)
        if (track.fadeIn && track.fadeIn > 0) {
            this.applyFadeIn(gainNode, startTimeSec, track.fadeIn)
        }

        // Handle fade-out
        const AUTO_FADE_OUT = 0.1 // 100ms auto fade-out (consistent with WebAudioKit)
        const trackDurationSec = track.duration / 1000
        const hasUserFadeOut = track.fadeOut && track.fadeOut > 0

        if (hasUserFadeOut) {
            // User configured fade-out, use user configuration
            const fadeOutStart = startTimeSec + trackDurationSec - track.fadeOut!
            this.applyFadeOut(gainNode, fadeOutStart, track.fadeOut!)
        } else {
            // Auto fade-out: prevents clicking on abrupt audio cutoff (only for sufficiently long tracks)
            // Applied only when duration > fadeIn + autoFadeOut
            const fadeInDuration = track.fadeIn ?? 0
            if (trackDurationSec > fadeInDuration + AUTO_FADE_OUT) {
                const fadeOutStart = startTimeSec + trackDurationSec - AUTO_FADE_OUT
                this.applyFadeOut(gainNode, fadeOutStart, AUTO_FADE_OUT)
            }
        }

        // Connect audio graph
        source.connect(gainNode)
        gainNode.connect(ctx.destination)

        // Start playback
        source.start(startTimeSec)

        // If duration specified, stop at end of duration
        if (track.duration) {
            source.stop(startTimeSec + track.duration / 1000)
        }
        return Promise.resolve()
    }

    /**
     * Apply fade-in effect
     */
    private applyFadeIn(gainNode: GainNode, startTime: number, duration: number): void {
        if (!this.offlineCtx) return

        const gain = gainNode.gain

        // Fade-in curve: from 0 to current volume
        const currentVolume = gain.value
        gain.setValueAtTime(0, startTime)
        gain.linearRampToValueAtTime(currentVolume, startTime + duration)
    }

    /**
     * Apply fade-out effect
     */
    private applyFadeOut(gainNode: GainNode, startTime: number, duration: number): void {
        if (!this.offlineCtx) return

        const gain = gainNode.gain

        // Fade-out curve: from current volume to 0
        const currentVolume = gain.value
        gain.setValueAtTime(currentVolume, startTime)
        gain.linearRampToValueAtTime(0, startTime + duration)
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        this.offlineCtx = null
        this.audioTracks = []
    }
}
