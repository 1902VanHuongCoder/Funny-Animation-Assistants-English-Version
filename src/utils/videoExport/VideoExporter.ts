import { useAssetAudio } from '@/composables/useAssetAudio'
import { getPlaybackVolumeGain } from '@/constants/voiceOptions'
import type { Episode } from '@/stores/episodeStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSoundStore } from '@/stores/soundStore'
import type { AudioObject } from '@/types/sceneObject'
import type { Action, RuntimeSlot, SceneContainer, ScriptBlock } from '@/types/screenplay'
import { parseBlockToSlots } from '@/utils/slotUtils'
import { audioKit } from '@/utils/WebAudioKit'

import { AudioEncoderWrapper } from './AudioEncoderWrapper'
import { AudioMixer } from './AudioMixer'
import { ERROR_CODES } from './constants'
import { FrameCapture } from './FrameCapture'
import { MP4MuxerWrapper } from './MP4MuxerWrapper'
import { ResourcePreloader } from './ResourcePreloader'
import type { AudioTrack, VideoExportConfig, VideoExportOptions, VideoExportProgress } from './types'
import { VideoEncoderWrapper } from './VideoEncoderWrapper'

/**
 * Video export core class
 * Coordinates the entire export pipeline
 */
export class VideoExporter {
    private episode: Episode
    private episodeWithResources: Episode | null = null  // Copy with preloaded resources
    private config: VideoExportConfig
    private options: VideoExportOptions

    private frameCapture: FrameCapture | null = null
    private videoEncoder: VideoEncoderWrapper | null = null
    private audioEncoder: AudioEncoderWrapper | null = null
    private audioMixer: AudioMixer | null = null
    private muxer: MP4MuxerWrapper | null = null
    private resourcePreloader: ResourcePreloader | null = null

    private aborted = false
    private startTime = 0

    // Timeline data (retrieved from preloader)
    private totalDuration = 0
    private sceneDurations: number[] = []
    private sceneStartTimes: number[] = []

    constructor(episode: Episode, config: VideoExportConfig, options: VideoExportOptions = {}) {
        this.episode = episode
        this.config = config
        this.options = options

        // Listen for cancellation signal
        if (options.signal) {
            options.signal.addEventListener('abort', () => {
                this.aborted = true
            })
        }
    }

    /**
     * Execute export
     */
    async export(): Promise<Blob> {
        this.startTime = Date.now()

        try {
            // Stage 1: Prepare resources
            await this.prepareResources()
            this.checkAborted()

            // Stage 2: Initialize encoders
            await this.initializeEncoders()
            this.checkAborted()

            // Stage 3: Encode video
            await this.encodeVideo()
            this.checkAborted()

            // Stage 4: Encode audio
            await this.encodeAudio()
            this.checkAborted()

            // Stage 5: Mux MP4
            const blob = await this.finalize()

            return blob

        } catch (error: unknown) {
            // User cancellation is normal operation, do not log as error
            const message = error instanceof Error ? error.message : String(error)
            if (message !== ERROR_CODES.CANCELLED) {
                console.error('[VideoExporter] Export failed:', error)
            }
            throw error
        } finally {
            await this.cleanup()
        }
    }

    /**
     * Stage 1: Prepare resources
     */
    private async prepareResources(): Promise<void> {

        // Create resource preloader
        this.resourcePreloader = new ResourcePreloader(this.episode, (progress) => {
            this.updateProgress(progress)
        })

        // Execute preload, get copy containing Blob URLs
        this.episodeWithResources = await this.resourcePreloader.preloadAll()

        // Save timeline data
        this.totalDuration = this.resourcePreloader.totalDuration
        this.sceneDurations = this.resourcePreloader.sceneDurations
        this.sceneStartTimes = this.resourcePreloader.sceneStartTimes
    }

    /**
     * Stage 2: Initialize encoders
     */
    private async initializeEncoders(): Promise<void> {
        if (!this.episodeWithResources) {
            throw new Error('Resources not prepared')
        }

        // Initialize MP4 Muxer
        this.muxer = new MP4MuxerWrapper()
        this.muxer.initialize(this.config)

        // Initialize video encoder
        this.videoEncoder = new VideoEncoderWrapper(this.muxer, this.config)
        await this.videoEncoder.initialize()

        // Initialize audio encoder
        this.audioEncoder = new AudioEncoderWrapper(this.muxer, this.config)
        await this.audioEncoder.initialize()

        // Initialize frame capture
        this.frameCapture = new FrameCapture(this.episodeWithResources, this.config)
        await this.frameCapture.initialize()

    }

    /**
     * Stage 3: Encode video
     */
    private async encodeVideo(): Promise<void> {
        if (!this.frameCapture || !this.videoEncoder) {
            throw new Error('Encoders not initialized')
        }


        // Use true total duration
        const totalFrames = Math.ceil((this.totalDuration / 1000) * this.config.frameRate)

        // Batch parameters: pause after processing fixed frame count
        const BATCH_SIZE = 100  // Process 100 frames per batch
        const MAX_QUEUE_SIZE = 10  // Maximum allowed backlog in encoding queue
        let processedFrames = 0

        // Render and encode frame by frame
        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
            this.checkAborted()

            const time = (frameIndex / this.config.frameRate) * 1000 // ms

            try {
                // Calculate scene and in-scene time corresponding to current frame
                const { sceneIndex, timeInScene } = this.getSceneAtTime(time)

                // Render frame (passing absolute time)
                // v11.81: renderFrame is now async, requires await
                const videoFrame = await this.frameCapture.renderFrame(sceneIndex, timeInScene, time)

                // Encode frame
                const isKeyFrame = frameIndex % 30 === 0 // Keyframe every 30 frames
                this.videoEncoder.encode(videoFrame, isKeyFrame)

                // Close VideoFrame to release memory
                videoFrame.close()
            } catch (e) {
                console.error(`[VideoExporter] Failed to process frame ${frameIndex}:`, e)
                throw e
            }

            processedFrames++

            // Calculate current scene info
            const { sceneIndex, timeInScene: _ } = this.getSceneAtTime(time)
            const currentScene = this.episodeWithResources!.scenes[sceneIndex]
            const sceneName = currentScene?.title ?? `Scene ${sceneIndex + 1}`

            // Update progress
            const percentage = ((frameIndex + 1) / totalFrames) * 50 // Video encoding accounts for 50%
            const elapsedTime = Date.now() - this.startTime
            const estimatedTotal = (elapsedTime / percentage) * 100
            const estimatedRemaining = estimatedTotal - elapsedTime

            this.updateProgress({
                currentFrame: frameIndex + 1,
                totalFrames,
                percentage,
                elapsedTime,
                estimatedRemaining,
                stage: 'encoding',
                stageMessage: `Encoding video: ${frameIndex + 1} / ${totalFrames}`,
                currentScene: sceneName,
                currentSceneIndex: sceneIndex,
                totalScenes: this.episodeWithResources!.scenes.length
            })

            // Queue flow control: wait for encoder to process backlogged frames
            const queueSize = this.videoEncoder.getQueueSize()
            if (queueSize >= MAX_QUEUE_SIZE) {
                // Wait for queue to drain to acceptable level
                while (this.videoEncoder.getQueueSize() > MAX_QUEUE_SIZE / 2) {
                    await new Promise(resolve => setTimeout(resolve, 10))
                }
            }

            // Batching: pause after processing BATCH_SIZE frames
            if (processedFrames >= BATCH_SIZE) {
                processedFrames = 0
            }
        }

        // Flush encoder buffer
        await this.videoEncoder.flush()
    }

    /**
     * Stage 4: Encode audio
     */
    private getBlockPlaybackVolume(scene: SceneContainer, block: ScriptBlock): number {
        const projectStore = useProjectStore()

        if (block.type === 'dialogue') {
            const instance = scene.setup.objects.find((object) => object.id === block.instanceId)
            const actorId = instance?.extraInfo?.kind === 'actor' ? instance.extraInfo.actorId : undefined
            const actor = actorId
                ? projectStore.actors.find((item) => item.id === actorId)
                : (instance?.refId ? projectStore.actors.find((item) => item.characterId === instance.refId) : undefined)
            return getPlaybackVolumeGain(actor?.voice?.volume)
        }

        if (block.type === 'narration') {
            return getPlaybackVolumeGain(projectStore.narrator?.voice?.volume)
        }

        return 1
    }

    private async encodeAudio(): Promise<void> {
        if (!this.audioEncoder || !this.episodeWithResources) {
            throw new Error('Audio encoder not initialized or resources not loaded')
        }

        const audioTracks: AudioTrack[] = []
        const soundStore = useSoundStore()

        // 1. Collect TTS audio tracks

        for (let sceneIdx = 0; sceneIdx < this.episodeWithResources.scenes.length; sceneIdx++) {
            const scene = this.episodeWithResources.scenes[sceneIdx]
            const sceneStartTime = this.sceneStartTimes[sceneIdx] ?? 0
            let blockStartTime = sceneStartTime

            if (scene?.script) {
                for (const block of scene.script) {
                    if ((block.type === 'dialogue' || block.type === 'narration') && block.ttsConfig?.audioPath) {
                        const audioPath = block.ttsConfig.audioPath

                        // v12.8: audioPath may already be blob URL (preloaded by ResourcePreloader)
                        // in this case use it directly; otherwise load via useAssetAudio
                        let blobUrl: string | undefined

                        if (audioPath.startsWith('blob:')) {
                            // Already blob URL, use directly
                            blobUrl = audioPath
                        } else {
                            // Relative path, load via useAssetAudio
                            const { loadAudioUrl, getAudioUrl } = useAssetAudio()
                            await loadAudioUrl(audioPath)
                            blobUrl = getAudioUrl(audioPath)
                        }

                        if (blobUrl?.startsWith('blob:')) {
                            try {
                                // audioKit.load() returns AudioBuffer
                                const audioBuffer = await audioKit.load(blobUrl)
                                if (audioBuffer) {
                                    const actualDuration = Math.round(audioBuffer.duration * 1000)
                                    const blockDuration = Math.max(block.ttsConfig.duration ?? 0, actualDuration)
                                    block.ttsConfig.duration = blockDuration
                                    audioTracks.push({
                                        buffer: audioBuffer,
                                        startTime: blockStartTime,
                                        duration: blockDuration,
                                        volume: this.getBlockPlaybackVolume(scene, block),
                                        source: 'tts'
                                    })
                                }
                            } catch (e) {
                                console.warn(`[VideoExporter] Failed to get TTS audio:`, e)
                            }
                        } else {
                            console.warn(`[VideoExporter] TTS audio is not a Blob URL: ${blobUrl?.substring(0, 50)}...`)
                        }

                        blockStartTime += block.ttsConfig.duration ?? 1000
                    } else {
                        blockStartTime += (block as { duration?: number }).duration ?? 1000
                    }
                }
            }
        }

        // 2. Collect global BGM audio tracks
        const bgmTracks = this.episodeWithResources.bgmTracks || []

        for (const bgmTrack of bgmTracks) {

            if (bgmTrack.assetId) {
                try {
                    const bgmSound = soundStore.getSound(bgmTrack.assetId)

                    if (bgmSound?.url) {
                        // Get Blob URL via asset loader system first
                        const { loadAudioUrl, getAudioUrl } = useAssetAudio()
                        await loadAudioUrl(bgmSound.url)
                        const blobUrl = getAudioUrl(bgmSound.url)

                        if (blobUrl) {
                            const audioBuffer = await audioKit.load(blobUrl)
                            if (audioBuffer) {
                                // Handle looping: if BGM loops and duration is insufficient, add multiple times
                                const bgmDuration = audioBuffer.duration * 1000 // ms
                                const shouldLoop = bgmTrack.loop === true

                                // Calculate BGM actual start and end times
                                const bgmStartTime = this.calculateTimeFromPosition(
                                    bgmTrack.start.sceneId,
                                    bgmTrack.start.blockId,
                                    false // Start position
                                )
                                const bgmEndTime = this.calculateTimeFromPosition(
                                    bgmTrack.end.sceneId,
                                    bgmTrack.end.blockId,
                                    true // End position
                                )

                                if (shouldLoop && bgmDuration < (bgmEndTime - bgmStartTime)) {
                                    // Looping needed: add track multiple times
                                    let currentStart = bgmStartTime
                                    let loopCount = 0
                                    while (currentStart < bgmEndTime) {
                                        const remainingTime = bgmEndTime - currentStart
                                        const clipDuration = Math.min(bgmDuration, remainingTime)

                                        const track: AudioTrack = {
                                            buffer: audioBuffer,
                                            startTime: currentStart,
                                            duration: clipDuration,
                                            volume: bgmTrack.volume ?? 0.3,
                                            source: 'bgm'
                                        }
                                        if (loopCount === 0 && bgmTrack.fadeIn) track.fadeIn = bgmTrack.fadeIn
                                        if (currentStart + clipDuration >= bgmEndTime && bgmTrack.fadeOut) track.fadeOut = bgmTrack.fadeOut
                                        audioTracks.push(track)

                                        currentStart += bgmDuration
                                        loopCount++
                                    }
                                } else {
                                    // Non-looping: single add
                                    const track: AudioTrack = {
                                        buffer: audioBuffer,
                                        startTime: bgmStartTime,
                                        duration: Math.min(bgmDuration, bgmEndTime - bgmStartTime),
                                        volume: bgmTrack.volume ?? 0.3,
                                        source: 'bgm'
                                    }
                                    if (bgmTrack.fadeIn) track.fadeIn = bgmTrack.fadeIn
                                    if (bgmTrack.fadeOut) track.fadeOut = bgmTrack.fadeOut
                                    audioTracks.push(track)
                                }
                            }
                        } else {
                            console.warn(`[VideoExporter] Failed to get BGM Blob URL`)
                        }
                    }
                } catch (e) {
                    console.warn(`[VideoExporter] Failed to get BGM audio:`, e)
                }
            }
        }

        // 3. Collect scene sound effect objects (SFX)

        // Get block timeline to calculate set_audio trigger times
        const blockTimeline = this.getBlockTimeline()

        // Preload all SFX assets
        const sfxBufferCache = new Map<string, AudioBuffer>()

        for (let sceneIdx = 0; sceneIdx < this.episodeWithResources.scenes.length; sceneIdx++) {
            const scene = this.episodeWithResources.scenes[sceneIdx]
            const sceneStartTime = this.sceneStartTimes[sceneIdx] ?? 0
            const sceneEndTime = sceneIdx < this.sceneDurations.length
                ? sceneStartTime + (this.sceneDurations[sceneIdx] ?? 0)
                : this.totalDuration

            if (scene?.setup?.objects) {
                for (const obj of scene.setup.objects) {
                    // Only process audio type objects
                    if (obj.type === 'audio') {
                        const sound = soundStore.getSound(obj.refId)
                        if (!sound?.url) continue

                        try {
                            // Get or cache audio buffer
                            let audioBuffer = sfxBufferCache.get(obj.refId)
                            if (!audioBuffer) {
                                const { loadAudioUrl, getAudioUrl } = useAssetAudio()
                                await loadAudioUrl(sound.url)
                                const blobUrl = getAudioUrl(sound.url)
                                if (blobUrl) {
                                    audioBuffer = await audioKit.load(blobUrl) ?? undefined
                                    if (audioBuffer) {
                                        sfxBufferCache.set(obj.refId, audioBuffer)
                                    }
                                }
                            }

                            if (!audioBuffer) continue

                            const sfxDuration = audioBuffer.duration * 1000

                            // Collect playback events
                            const playEvents: {
                                startTime: number
                                endTime: number
                                volume: number
                                loop: boolean
                                fadeIn?: number
                                fadeOut?: number
                            }[] = []

                            // Get all blocks for current scene
                            const sceneBlocks = blockTimeline.filter(b => b.sceneIndex === sceneIdx)

                            // 1. Initial state: if playbackState === 'play', play from scene start
                            const audioObj = obj as AudioObject
                            if (audioObj.playbackState === 'play') {
                                // Calculate despawn time: check set_lifecycle (spawned=false) and autoDespawnOnBlockEnd
                                const despawnTime = this.findDespawnTime(obj.id, sceneBlocks, sceneEndTime)
                                let effectiveEndTime = Math.min(sceneEndTime, despawnTime)

                                // Find first set_audio stop/play action truncating initial playback
                                for (const laterBlock of sceneBlocks) {
                                    for (const laterAction of laterBlock.actions) {
                                        if (laterAction.type === 'set_audio' &&
                                            laterAction.target === obj.id &&
                                            (laterAction.params?.action === 'stop' || laterAction.params?.action === 'play')) {
                                            const laterSlot = laterBlock.slots?.[laterAction.slotIndex]
                                            const laterTime = laterBlock.startTime + (laterSlot?.startTime ?? 0)
                                            if (laterTime <= sceneStartTime) continue
                                            effectiveEndTime = Math.min(effectiveEndTime, laterTime)
                                            break
                                        }
                                    }
                                    if (effectiveEndTime < Math.min(sceneEndTime, despawnTime)) break
                                }

                                if (effectiveEndTime > sceneStartTime) {
                                    const event: typeof playEvents[number] = {
                                        startTime: sceneStartTime,
                                        endTime: effectiveEndTime,
                                        volume: audioObj.volume ?? 1.0,
                                        loop: audioObj.loop === true
                                    }
                                    if (audioObj.fadeIn !== undefined) event.fadeIn = audioObj.fadeIn
                                    if (audioObj.fadeOut !== undefined) event.fadeOut = audioObj.fadeOut
                                    playEvents.push(event)
                                }
                            }

                            // 2. Iterate through all blocks in current scene to find set_audio actions
                            for (const blockInfo of sceneBlocks) {
                                for (const action of blockInfo.actions) {
                                    if (action.type === 'set_audio' && action.target === obj.id) {
                                        const params = action.params || {}

                                        // Calculate action trigger time (block start time + slot offset)
                                        const slot = blockInfo.slots?.[action.slotIndex]
                                        const triggerTime = blockInfo.startTime + (slot?.startTime ?? 0)

                                        if (params.action === 'play') {
                                            // Find next termination point (stop action, subsequent play action, or scene end)
                                            let stopTime = sceneEndTime

                                            // Find subsequent stop or play action (subsequent play implicitly truncates previous play)
                                            for (const laterBlock of sceneBlocks) {
                                                for (const laterAction of laterBlock.actions) {
                                                    if (laterAction.type === 'set_audio' &&
                                                        laterAction.target === obj.id &&
                                                        (laterAction.params?.action === 'stop' || laterAction.params?.action === 'play')) {
                                                        const laterSlot = laterBlock.slots?.[laterAction.slotIndex]
                                                        const laterTime = laterBlock.startTime + (laterSlot?.startTime ?? 0)
                                                        if (laterTime <= triggerTime) continue
                                                        stopTime = Math.min(stopTime, laterTime)
                                                        break
                                                    }
                                                }
                                                if (stopTime < sceneEndTime) break
                                            }

                                            // Check despawn time: set_lifecycle (spawned=false) or autoDespawnOnBlockEnd
                                            const despawnTime = this.findDespawnTime(obj.id, sceneBlocks, sceneEndTime, triggerTime)
                                            stopTime = Math.min(stopTime, despawnTime)

                                            const event: typeof playEvents[number] = {
                                                startTime: triggerTime,
                                                endTime: stopTime,
                                                volume: params.volume ?? audioObj.volume ?? 1.0,
                                                loop: params.loop ?? audioObj.loop === true
                                            }
                                            const fadeIn = params.fadeIn ?? audioObj.fadeIn
                                            const fadeOut = params.fadeOut ?? audioObj.fadeOut
                                            if (fadeIn !== undefined) event.fadeIn = fadeIn
                                            if (fadeOut !== undefined) event.fadeOut = fadeOut
                                            playEvents.push(event)
                                        }
                                    }
                                }
                            }

                            // 3. Convert playback events to audio tracks
                            for (const event of playEvents) {
                                const duration = event.endTime - event.startTime

                                if (event.loop && sfxDuration < duration) {
                                    // Loop playback
                                    let currentStart = event.startTime
                                    let loopCount = 0
                                    while (currentStart < event.endTime) {
                                        const remainingTime = event.endTime - currentStart
                                        const clipDuration = Math.min(sfxDuration, remainingTime)

                                        const track: AudioTrack = {
                                            buffer: audioBuffer,
                                            startTime: currentStart,
                                            duration: clipDuration,
                                            volume: event.volume,
                                            source: 'sfx'
                                        }
                                        if (loopCount === 0 && event.fadeIn !== undefined) track.fadeIn = event.fadeIn
                                        if (currentStart + clipDuration >= event.endTime && event.fadeOut !== undefined) track.fadeOut = event.fadeOut
                                        audioTracks.push(track)

                                        currentStart += sfxDuration
                                        loopCount++
                                    }
                                } else {
                                    // Single playback
                                    const track: AudioTrack = {
                                        buffer: audioBuffer,
                                        startTime: event.startTime,
                                        duration: Math.min(sfxDuration, duration),
                                        volume: event.volume,
                                        source: 'sfx'
                                    }
                                    if (event.fadeIn !== undefined) track.fadeIn = event.fadeIn
                                    if (event.fadeOut !== undefined) track.fadeOut = event.fadeOut
                                    audioTracks.push(track)
                                }
                            }
                        } catch (e) {
                            console.warn(`[VideoExporter] Failed to get SFX audio:`, e)
                        }
                    }
                }
            }
        }

        this.updateProgress({
            currentFrame: 0,
            totalFrames: 0,
            percentage: 60,
            elapsedTime: Date.now() - this.startTime,
            estimatedRemaining: 0,
            stage: 'encoding',
            stageMessage: 'Mixing audio...'
        })

        // Initialize audio mixer
        this.audioMixer = new AudioMixer()
        this.audioMixer.initialize(this.totalDuration, this.config.audioSampleRate)

        // Add all audio tracks
        for (const track of audioTracks) {
            this.audioMixer.addTrack(track)
        }

        // Render mixed audio
        const mixedAudio = await this.audioMixer.render()

        this.updateProgress({
            currentFrame: 0,
            totalFrames: 0,
            percentage: 75,
            elapsedTime: Date.now() - this.startTime,
            estimatedRemaining: 0,
            stage: 'encoding',
            stageMessage: 'Encoding audio...'
        })

        // Encode audio
        await this.audioEncoder.encodeBuffer(mixedAudio)

        // Flush encoder buffer
        await this.audioEncoder.flush()
    }

    /**
     * Stage 5: Mux MP4
     */
    private async finalize(): Promise<Blob> {
        await Promise.resolve()
        if (!this.muxer) {
            throw new Error('Muxer not initialized')
        }

        this.updateProgress({
            currentFrame: 0,
            totalFrames: 0,
            percentage: 95,
            elapsedTime: Date.now() - this.startTime,
            estimatedRemaining: 0,
            stage: 'muxing',
            stageMessage: 'Muxing MP4...'
        })

        const blob = this.muxer.finalize()

        this.updateProgress({
            currentFrame: 0,
            totalFrames: 0,
            percentage: 100,
            elapsedTime: Date.now() - this.startTime,
            estimatedRemaining: 0,
            stage: 'muxing',
            stageMessage: 'Export completed'
        })

        return blob
    }

    /**
     * Clean up resources
     */
    private async cleanup(): Promise<void> {

        if (this.frameCapture) {
            this.frameCapture.destroy()
            this.frameCapture = null
        }

        if (this.videoEncoder) {
            await this.videoEncoder.destroy()
            this.videoEncoder = null
        }

        if (this.audioEncoder) {
            await this.audioEncoder.destroy()
            this.audioEncoder = null
        }

        if (this.audioMixer) {
            this.audioMixer.destroy()
            this.audioMixer = null
        }

        if (this.muxer) {
            this.muxer.destroy()
            this.muxer = null
        }
    }

    /**
     * Update progress
     */
    private updateProgress(progress: VideoExportProgress): void {
        if (this.options.onProgress) {
            this.options.onProgress(progress)
        }
    }

    /**
     * Check if cancelled
     */
    private checkAborted(): void {
        if (this.aborted) {
            throw new Error(ERROR_CODES.CANCELLED)
        }
    }

    /**
     * Calculate absolute time for specified scene and block
     * @param sceneId Scene ID
     * @param blockId Block ID, null indicates scene boundary
     * @param isEnd Whether end position (true=scene/block end, false=scene/block start)
     */
    private calculateTimeFromPosition(
        sceneId: string,
        blockId: string | null,
        isEnd: boolean
    ): number {
        if (!this.episodeWithResources) return 0

        // Find scene index
        const sceneIndex = this.episodeWithResources.scenes.findIndex(s => s.id === sceneId)
        if (sceneIndex === -1) return isEnd ? this.totalDuration : 0

        const sceneStartTime = this.sceneStartTimes[sceneIndex] ?? 0
        const sceneDuration = this.sceneDurations[sceneIndex] ?? 0

        // If blockId not specified, return scene boundary
        if (!blockId) {
            return isEnd ? sceneStartTime + sceneDuration : sceneStartTime
        }

        // Calculate block time
        const scene = this.episodeWithResources.scenes[sceneIndex]
        if (!scene?.script) {
            return isEnd ? sceneStartTime + sceneDuration : sceneStartTime
        }

        let blockTime = sceneStartTime
        for (const block of scene.script) {
            const blockDuration = this.getBlockDurationMs(block)

            if (block.id === blockId) {
                // Found target block
                return isEnd ? blockTime + blockDuration : blockTime
            }

            blockTime += blockDuration
        }

        // Block not found, return scene boundary
        return isEnd ? sceneStartTime + sceneDuration : sceneStartTime
    }

    /**
     * Get block timeline information
     * Returns { sceneIndex, blockId, startTime, duration } for each block
     */
    private getBlockTimeline(): {
        sceneIndex: number
        blockId: string
        startTime: number
        duration: number
        actions: Action[]
        slots: RuntimeSlot[]
    }[] {
        if (!this.episodeWithResources) return []

        const timeline: {
            sceneIndex: number
            blockId: string
            startTime: number
            duration: number
            actions: Action[]
            slots: RuntimeSlot[]
        }[] = []

        for (let sceneIdx = 0; sceneIdx < this.episodeWithResources.scenes.length; sceneIdx++) {
            const scene = this.episodeWithResources.scenes[sceneIdx]
            let blockStartTime = this.sceneStartTimes[sceneIdx] ?? 0

            if (scene?.script) {
                for (const block of scene.script) {
                    const blockDuration = this.getBlockDurationMs(block)

                    timeline.push({
                        sceneIndex: sceneIdx,
                        blockId: block.id,
                        startTime: blockStartTime,
                        duration: blockDuration,
                        actions: block.actions || [],
                        slots: parseBlockToSlots(block)
                    })

                    blockStartTime += blockDuration
                }
            }
        }

        return timeline
    }

    private getBlockDurationMs(block: Episode['scenes'][number]['script'][number]): number {
        if (block.type === 'action') {
            return block.duration ?? 1000
        }
        return block.ttsConfig?.duration ?? 1000
    }

    /**
     * Find despawn time for audio object
     * Checks set_lifecycle (spawned=false) and autoDespawnOnBlockEnd
     * @param objectId Audio object ID
     * @param sceneBlocks Block timeline of current scene
     * @param sceneEndTime Scene end time (default return value)
     * @param afterTime Only search for despawn events after this time (optional)
     */
    private findDespawnTime(
        objectId: string,
        sceneBlocks: { startTime: number; duration: number; actions: Action[]; slots: RuntimeSlot[] }[],
        sceneEndTime: number,
        afterTime = 0
    ): number {
        let earliestDespawn = sceneEndTime

        for (const blockInfo of sceneBlocks) {
            const blockEndTime = blockInfo.startTime + blockInfo.duration

            for (const action of blockInfo.actions) {
                // Explicit set_lifecycle spawned=false -> object despawns
                if (
                    action.type === 'set_lifecycle' &&
                    action.target === objectId &&
                    action.params?.spawned === false
                ) {
                    const slot = blockInfo.slots?.[action.slotIndex]
                    const despawnTime = blockInfo.startTime + (slot?.startTime ?? 0)
                    if (despawnTime > afterTime && despawnTime < earliestDespawn) {
                        earliestDespawn = despawnTime
                    }
                }

                // autoDespawnOnBlockEnd: If block contains set_lifecycle spawned=true (spawn)
                // and autoDespawnOnBlockEnd !== false and no manual despawn within same block,
                // object despawns at block end
                if (
                    action.type === 'set_lifecycle' &&
                    action.target === objectId &&
                    action.params?.spawned === true &&
                    action.params?.autoDespawnOnBlockEnd !== false
                ) {
                    // Check if manual despawn exists within same block
                    const hasManualDespawn = blockInfo.actions.some(
                        a => a.type === 'set_lifecycle' &&
                            a.target === objectId &&
                            a.params?.spawned === false
                    )
                    if (!hasManualDespawn && blockEndTime > afterTime && blockEndTime < earliestDespawn) {
                        earliestDespawn = blockEndTime
                    }
                }
            }
        }

        return earliestDespawn
    }

    /**
     * Get scene index and in-scene time based on absolute time
     */
    private getSceneAtTime(absoluteTime: number): { sceneIndex: number; timeInScene: number } {
        let accumulatedTime = 0

        for (let i = 0; i < this.sceneDurations.length; i++) {
            const sceneDuration = this.sceneDurations[i] ?? 0

            if (absoluteTime < accumulatedTime + sceneDuration) {
                // Find corresponding scene
                return {
                    sceneIndex: i,
                    timeInScene: absoluteTime - accumulatedTime
                }
            }

            accumulatedTime += sceneDuration
        }

        // Out of range, return last scene
        const lastIndex = this.sceneDurations.length - 1
        return {
            sceneIndex: Math.max(0, lastIndex),
            timeInScene: 0
        }
    }
}

