import { useAssetAudio } from '@/composables/useAssetAudio'
import { useAssetImage } from '@/composables/useAssetImage'
import { useAssetLoader } from '@/composables/useAssetLoader'
import { DEFAULT_VOLUME, getVoiceEngine } from '@/constants/voiceOptions'
import type { Episode } from '@/stores/episodeStore'
import { useEpisodeStore } from '@/stores/episodeStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSoundStore } from '@/stores/soundStore'
import type { SceneContainer, ScriptBlock, TTSConfig } from '@/types/screenplay'
import { ttsClient } from '@/utils/ttsClient'
import { resolveVoiceId, resolveVoiceSpeed } from '@/utils/ttsUtils'
import { audioKit } from '@/utils/WebAudioKit'

import type { VideoExportProgress } from './types'

/**
 * Resource Preloader for Video Export
 * Adapts V7 State-Centric model by using useAssetLoader for asset collection
 */
export class ResourcePreloader {
    private episode: Episode
    private episodeCopy: Episode
    private onProgress: ((progress: VideoExportProgress) => void) | undefined

    // Stores
    private projectStore = useProjectStore()
    private episodeStore = useEpisodeStore()
    private soundStore = useSoundStore()

    // Asset helpers
    private assetImage = useAssetImage()
    private assetAudio = useAssetAudio()
    private assetLoader = useAssetLoader()

    private get loadAudioUrl() { return this.assetAudio.loadAudioUrl }
    private get getAudioUrl() { return this.assetAudio.getAudioUrl }
    private get getImageUrl() { return this.assetImage.getImageUrl }

    // Resource tracking
    private generatedBlobUrls = new Set<string>()
    private loadedAudioUrls = new Set<string>()

    // Note: loadedTextureUrls removed as we rely on useAssetLoader's global cache
    // and we shouldn't unload shared assets.
    public loadedTextureUrls = new Set<string>() // Keep for backward compatibility/logging if needed, but essentially unused for unloading.

    // Timeline data
    public sceneDurations: number[] = []
    public sceneStartTimes: number[] = []
    public totalDuration = 0

    constructor(episode: Episode, onProgress?: (progress: VideoExportProgress) => void) {
        this.episode = episode
        this.episodeCopy = JSON.parse(JSON.stringify(episode)) as Episode
        this.onProgress = onProgress
    }

    /**
     * Execute full resource preloading
     */
    async preloadAll(): Promise<Episode> {
        const scenes = this.episodeCopy.scenes || []
        if (scenes.length === 0) {
            throw new Error('Screenplay has no scenes')
        }

        this.updateProgress('preparing', 'Analyzing screenplay resources...', 0)

        // Initialize timeline data
        this.sceneDurations = new Array(scenes.length).fill(0) as number[]
        this.sceneStartTimes = new Array(scenes.length).fill(0) as number[]

        try {
            const totalScenes = scenes.length

            // Initialize AudioKit
            await audioKit.init()

            // Preload each scene
            for (let i = 0; i < totalScenes; i++) {
                const scene = scenes[i]!
                const sceneProgressBase = (i / totalScenes) * 80
                const sceneProgressStep = (1 / totalScenes) * 80

                this.updateProgress(
                    'preparing',
                    `Scene ${i + 1}/${totalScenes}: ${scene.title || 'Untitled'}`,
                    sceneProgressBase
                )

                const originalScene = this.episode.scenes[i]!
                await this.preloadSceneTTS(scene, originalScene, i)
                this.updateProgress('preparing', `Scene ${i + 1}: TTS completed`, sceneProgressBase + sceneProgressStep * 0.4)

                this.calculateSceneDuration(scene, i)

                await this.preloadSceneImages(scene)
                this.updateProgress('preparing', `Scene ${i + 1}: Image loading completed`, sceneProgressBase + sceneProgressStep * 0.7)

                await this.preloadSceneAudio(scene)
                this.updateProgress('preparing', `Scene ${i + 1}: Completed`, sceneProgressBase + sceneProgressStep)
            }

            this.updateProgress('preparing', 'Preloading soundtrack...', 85)
            await this.preloadGlobalBGM()

            this.recalculateGlobalTimeline()
            this.updateProgress('preparing', 'Resource preparation completed', 100)

            return this.episodeCopy
        } catch (error) {
            console.error('[ResourcePreloader] Resource preloading failed:', error)
            throw error
        }
    }

    /**
     * Preload scene TTS
     */
    private async preloadSceneTTS(scene: SceneContainer, originalScene: SceneContainer, _sceneIndex: number): Promise<void> {
        if (!scene.script) return

        for (const block of scene.script) {
            if (block.type !== 'dialogue' && block.type !== 'narration') continue

            const originalBlock = originalScene.script.find(b => b.id === block.id)
            if (!originalBlock || (originalBlock.type !== 'dialogue' && originalBlock.type !== 'narration')) continue

            const existingConfig = originalBlock.ttsConfig
            let needRegenerate = false

            if (!existingConfig?.audioPath) {
                needRegenerate = true
            } else {
                const audioFileExists = await this.projectStore.checkTTSAudioExists(existingConfig.audioPath)
                if (!audioFileExists) {
                    console.log('[ResourcePreloader] TTS audio file does not exist, regenerating:', existingConfig.audioPath)
                    needRegenerate = true
                }

                const gen = existingConfig.generatedFrom
                if (!needRegenerate && gen) {
                    const currentText = originalBlock.text ?? ''
                    const currentVoiceId = this.getVoiceId(originalScene, originalBlock)
                    const currentSpeed = this.getVoiceSpeed(originalScene, originalBlock)

                    if (
                        gen.text !== currentText ||
                        String(gen.voiceId) !== String(currentVoiceId) ||
                        gen.speed !== currentSpeed 
                    ) {
                        needRegenerate = true
                    }
                } else if (!needRegenerate && !gen) {
                    needRegenerate = true
                }
            }

            if (needRegenerate) {
                try {
                    const text = originalBlock.text
                    if (text && text.trim().length > 0) {
                        const voiceId = this.getVoiceId(originalScene, originalBlock)
                        const speed = this.getVoiceSpeed(originalScene, originalBlock)

                        const numericVoiceId = typeof voiceId === 'string' ? parseInt(voiceId) : voiceId

                        const result = await ttsClient.synthesize({
                            text,
                            engine: getVoiceEngine(numericVoiceId),
                            voiceType: numericVoiceId,
                            volume: DEFAULT_VOLUME,
                            speed,
                        })

                        const duration = result.duration ?? await ttsClient.estimateDuration(text, speed)

                        if (!result.audioBase64) {
                            throw new Error('TTS generation result missing Base64 data, cannot save')
                        }

                        const cacheKey = `${text}_${numericVoiceId}_${speed}`
                        const audioPath = await this.projectStore.saveTTSAudio(result.audioBase64, cacheKey)

                        const ttsConfig: TTSConfig = {
                            audioPath,
                            duration,
                            voiceId: numericVoiceId,

                            generatedFrom: {
                                text,
                                voiceId: numericVoiceId,
                                speed,
                                ...(originalBlock.type === 'dialogue' ? { instanceId: originalBlock.instanceId } : {}),
                            },
                        }

                        this.episodeStore.updateBlockInScene(this.episode.id, scene.id, originalBlock.id, { ttsConfig })
                        block.ttsConfig = JSON.parse(JSON.stringify(ttsConfig)) as TTSConfig
                    }
                } catch (e) {
                    console.error('[ResourcePreloader] TTS generation error:', e)
                    const error = e as Error & { errorCode?: string }
                    if (error.errorCode === 'TTS_PROVIDER_NOT_CONFIGURED') {
                        const ttsError = new Error('Local TTS Provider not configured. Please import local audio for lines first or configure local TTS Provider.')
                        ; (ttsError as Error & { code?: string }).code = 'TTS_PROVIDER_NOT_CONFIGURED'
                        throw ttsError
                    }
                }
            } else {
                block.ttsConfig = JSON.parse(JSON.stringify(existingConfig)) as TTSConfig
            }

            const finalConfig = block.ttsConfig
            if (finalConfig?.audioPath) {
                try {
                    const audioPath = finalConfig.audioPath

                    if (audioPath.startsWith('blob:')) {
                        const audioBuffer = await audioKit.load(audioPath)
                        this.syncTtsDurationFromAudioBuffer(finalConfig, audioBuffer)
                        this.loadedAudioUrls.add(audioPath)
                        this.generatedBlobUrls.add(audioPath)
                    } else {
                        await this.loadAudioUrl(audioPath)
                        const blobUrl = this.getAudioUrl(audioPath)
                        if (blobUrl) {
                            const audioBuffer = await audioKit.load(blobUrl)
                            this.syncTtsDurationFromAudioBuffer(finalConfig, audioBuffer)
                            await this.ensureTtsTiming(audioPath, audioBuffer)
                            this.loadedAudioUrls.add(blobUrl)
                            finalConfig.timingAudioPath = audioPath
                            finalConfig.audioPath = blobUrl
                        }
                    }
                } catch (e) {
                    console.error('[ResourcePreloader] Audio loading error:', e)
                    finalConfig.audioPath = ''
                    delete finalConfig.timingAudioPath
                }
            }
        }
    }

    private syncTtsDurationFromAudioBuffer(ttsConfig: TTSConfig, audioBuffer: AudioBuffer | null): void {
        const actualDuration = Math.round((audioBuffer?.duration ?? 0) * 1000)
        if (actualDuration > 0) {
            ttsConfig.duration = Math.max(ttsConfig.duration ?? 0, actualDuration)
        }
    }

    private async ensureTtsTiming(audioPath: string, audioBuffer: AudioBuffer | null): Promise<void> {
        if (!audioBuffer || audioPath.startsWith('blob:') || audioPath.startsWith('data:')) return

        try {
            await this.projectStore.ensureTTSTiming(audioPath, audioBuffer)
        } catch (error) {
            console.warn('[ResourcePreloader] Failed to generate TTS timing, continuing export:', error)
        }
    }

    /**
     * Preload scene images
     * V7 Adaptation using useAssetLoader
     */
    private async preloadSceneImages(scene: SceneContainer): Promise<void> {
        const { collectAssets, loadAssets } = this.assetLoader
        const allImageUrls = new Set<string>()
        const allAudioUrls = new Set<string>()

        const setupRes = collectAssets(scene.setup, null)
        setupRes.imageUrls.forEach(url => allImageUrls.add(url))
        setupRes.audioUrls.forEach(url => allAudioUrls.add(url))

        if (scene.script) {
            for (const block of scene.script) {
                const blockRes = collectAssets(scene.setup, block)
                blockRes.imageUrls.forEach(url => allImageUrls.add(url))
                blockRes.audioUrls.forEach(url => allAudioUrls.add(url))
            }
        }

        if (allImageUrls.size > 0 || allAudioUrls.size > 0) {
            await loadAssets(allImageUrls, allAudioUrls)

            for (const url of allImageUrls) {
                const fullUrl = this.getImageUrl(url)
                if (fullUrl) {
                    this.loadedTextureUrls.add(fullUrl)
                }
            }
        }
    }

    /**
     * Preload scene audio (SFX)
     */
    private async preloadSceneAudio(scene: SceneContainer): Promise<void> {
        const audioPaths = new Set<string>()
        for (const obj of scene.setup.objects) {
            if (obj.type === 'audio') {
                const sound = this.soundStore.getSound(obj.refId)
                if (sound?.url) audioPaths.add(sound.url)
            }
        }

        const paths = Array.from(audioPaths)
        if (paths.length > 0) {
            await Promise.all(
                paths.map(async (path) => {
                    try {
                        await this.loadAudioUrl(path)
                        const blobUrl = this.getAudioUrl(path)
                        if (blobUrl) {
                            await audioKit.load(blobUrl)
                            this.loadedAudioUrls.add(blobUrl)
                        }
                    } catch (e) {
                        console.warn(`[ResourcePreloader] Failed to load audio: ${path}`, e)
                    }
                })
            )
        }
    }

    /**
     * Preload global BGM
     */
    private async preloadGlobalBGM(): Promise<void> {
        const tracks = this.episode.bgmTracks || []
        if (tracks.length === 0) return

        for (const track of tracks) {
            if (track.assetId) {
                const asset = this.soundStore.getSound(track.assetId)
                if (asset?.url) {
                    try {
                        await this.loadAudioUrl(asset.url)
                        const blobUrl = this.getAudioUrl(asset.url)
                        if (blobUrl) {
                            await audioKit.load(blobUrl)
                            this.loadedAudioUrls.add(blobUrl)
                        }
                    } catch (e) {
                        console.warn(`[ResourcePreloader] Failed to load BGM: ${asset.url}`, e)
                    }
                }
            }
        }
    }

    /**
     * Calculate scene duration
     */
    private calculateSceneDuration(scene: SceneContainer, index: number): void {
        let duration = 0

        if (scene.script) {
            for (const block of scene.script) {
                let blockDur = 1000
                if (block.type === 'action') {
                    blockDur = block.duration
                } else if (block.ttsConfig?.duration) {
                    blockDur = block.ttsConfig.duration
                } else if ((block as { duration?: number }).duration) {
                    blockDur = (block as { duration?: number }).duration!
                }
                duration += blockDur
            }
        }

        this.sceneDurations[index] = duration
    }

    /**
     * Recalculate global timeline
     */
    private recalculateGlobalTimeline(): void {
        let accumulatedTime = 0
        for (let i = 0; i < this.sceneDurations.length; i++) {
            this.sceneStartTimes[i] = accumulatedTime
            accumulatedTime += (this.sceneDurations[i] ?? 0)
        }
        this.totalDuration = accumulatedTime
    }

    /**
     * Get voice ID
     */
    private getVoiceId(scene: SceneContainer, block: ScriptBlock): string | number {
        return resolveVoiceId(block, scene.setup.objects, this.projectStore.actors, this.projectStore.narrator)
    }

    /**
     * Get voice speed config
     */
    private getVoiceSpeed(scene: SceneContainer, block: ScriptBlock): number {
        return resolveVoiceSpeed(block, scene.setup.objects, this.projectStore.actors, this.projectStore.narrator)
    }

    /**
     * Update progress
     */
    private updateProgress(
        stage: 'preparing' | 'encoding' | 'muxing',
        message: string,
        percentage: number
    ): void {
        if (this.onProgress) {
            this.onProgress({
                currentFrame: 0,
                totalFrames: 0,
                percentage,
                elapsedTime: 0,
                estimatedRemaining: 0,
                stage,
                stageMessage: message,
            })
        }
    }

    /**
     * Clean up resources
     */
    cleanup(): void {
        this.generatedBlobUrls.forEach(url => URL.revokeObjectURL(url))
        this.generatedBlobUrls.clear()

        this.loadedTextureUrls.clear()
        this.loadedAudioUrls.clear()
    }
}
