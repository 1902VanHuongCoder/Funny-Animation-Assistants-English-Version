import { ref } from 'vue'

import { useEpisodeStore } from '@/stores/episodeStore'
import { useProjectStore } from '@/stores/projectStore'
import { ensureEpisodeTTS } from '@/utils/ttsUtils'
import type { ExportResult, ExportSettings, VideoExportConfig, VideoExportProgress, VideoExportState } from '@/utils/videoExport'
import { checkWebCodecsSupport, DEFAULT_EXPORT_CONFIG, DEFAULT_SUBTITLE_STYLE, ERROR_CODES, QUALITY_PRESETS, RESOLUTION_PRESETS, VideoExporter } from '@/utils/videoExport'

/**
 * Video export Composable
 */
export function useVideoExport() {
    const episodeStore = useEpisodeStore()
    const projectStore = useProjectStore()

    // Export state
    const exportState = ref<VideoExportState>({
        status: 'idle',
        progress: {
            currentFrame: 0,
            totalFrames: 0,
            percentage: 0,
            elapsedTime: 0,
            estimatedRemaining: 0,
            stage: 'preparing',
            stageMessage: ''
        }
    })

    // Show confirmation dialog
    const showConfirmDialog = ref(false)

    // Show progress dialog
    const showProgressDialog = ref(false)

    // Show result dialog
    const showResultDialog = ref(false)

    // Export result
    const exportResult = ref<ExportResult | null>(null)

    // Currently exporting episode ID
    const currentEpisodeId = ref<string | null>(null)

    // Export start time
    let exportStartTime = 0

    // Export settings (user-configurable)
    const exportSettings = ref<ExportSettings>(loadExportSettings())

    // Abort controller
    let abortController: AbortController | null = null

    /**
     * Load export settings from localStorage
     */
    function loadExportSettings(): ExportSettings {
        const defaults: ExportSettings = {
            resolution: '1080p',
            frameRate: 60,
            quality: 'ultra',
            encoder: 'software',
            showWatermark: false,
            showSubtitles: false,
            subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE }
        }

        const stored = localStorage.getItem('animeStudio_exportSettings')
        if (stored) {
            try {
                const parsed = JSON.parse(stored) as Partial<ExportSettings>
                // Frame rate fixed at 60, legacy local settings no longer affect export frame rate
                return {
                    ...defaults,
                    ...parsed,
                    subtitleStyle: {
                        ...defaults.subtitleStyle,
                        ...parsed.subtitleStyle,
                    },
                    frameRate: 60,
                }
            } catch (e) {
                console.warn('[useVideoExport] Failed to parse stored settings:', e)
            }
        }

        return defaults
    }

    /**
     * Save export settings to localStorage
     */
    function saveExportSettings(settings: ExportSettings) {
        localStorage.setItem('animeStudio_exportSettings', JSON.stringify(settings))
        exportSettings.value = settings
    }

    /**
     * Start export
     */
    const startExport = async (episodeId: string) => {
        // Check browser support
        await Promise.resolve()
        const support = checkWebCodecsSupport()
        if (!support.supported) {
            alert(support.error ?? 'Current browser does not support video export')
            return
        }

        // Get episode data
        const episode = episodeStore.getEpisode(episodeId)
        if (!episode) {
            alert('Episode does not exist')
            return
        }

        if (!episode.scenes || episode.scenes.length === 0) {
            alert('Screenplay must contain at least one scene')
            return
        }

        currentEpisodeId.value = episodeId

        // Show confirmation dialog
        showConfirmDialog.value = true
    }

    /**
     * Confirm export
     */
    const confirmExport = async (settings?: ExportSettings) => {
        if (!currentEpisodeId.value) return

        const episodeId = currentEpisodeId.value
        const episode = episodeStore.getEpisode(episodeId)
        if (!episode) return

        // If settings provided, save to localStorage
        if (settings) {
            saveExportSettings(settings)
        }

        // Close confirmation dialog, open progress dialog
        showConfirmDialog.value = false
        showProgressDialog.value = true

        // Reset state
        exportState.value.status = 'preparing'
        delete (exportState.value as { error?: unknown }).error
        delete (exportState.value as { outputBlob?: unknown }).outputBlob
        exportResult.value = null
        exportStartTime = Date.now()

        // Use user-selected settings (defined outside try so catch block can access)
        const currentSettings = exportSettings.value

        // Get resolution preset
        const resolutionPreset = RESOLUTION_PRESETS.find((p: typeof RESOLUTION_PRESETS[number]) => p.id === currentSettings.resolution)
        if (!resolutionPreset) {
            alert('Invalid resolution setting')
            showProgressDialog.value = false
            return
        }

        try {
            // Create abort controller
            abortController = new AbortController()

            // ── TTS Preprocessing ──────────────────────────────────────
            exportState.value.progress = {
                ...exportState.value.progress,
                stage: 'preparing',
                stageMessage: 'Checking and generating speech...'
            }

            // Deep copy Episode for TTS processing (prevent mutation of exporter copy)
            const episodeCopy = JSON.parse(JSON.stringify(episode)) as typeof episode

            try {
                await ensureEpisodeTTS(episode, episodeCopy, {
                    actors: projectStore.actors,
                    narrator: projectStore.narrator,
                    onProgress: (msg) => {
                        exportState.value.progress = {
                            ...exportState.value.progress,
                            stageMessage: msg
                        }
                    }
                })
            } catch (ttsErr) {
                const ttsError = ttsErr as Error & { errorCode?: string }
                if (ttsError.errorCode === 'TTS_PROVIDER_NOT_CONFIGURED') {
                    throw new Error('Local TTS Provider is not configured yet. Please import local audio for dialogue or configure a local TTS Provider.')
                }
                throw ttsErr
            }

            // After TTS completes, use fresh episode data (persisted to Store)
            const freshEpisode = episodeStore.getEpisode(episodeId) ?? episode

            // Get bitrate for quality preset
            const qualityPreset = QUALITY_PRESETS.find((p: typeof QUALITY_PRESETS[number]) => p.id === currentSettings.quality)
            const videoBitrate = qualityPreset?.videoBitrate ?? DEFAULT_EXPORT_CONFIG.videoBitrate

            const config: VideoExportConfig = {
                episodeId: episodeId,
                resolution: {
                    width: resolutionPreset.width,
                    height: resolutionPreset.height,
                    scale: 1 // Use preset resolution, no scaling needed
                },
                frameRate: 60,
                videoBitrate: videoBitrate,
                audioBitrate: DEFAULT_EXPORT_CONFIG.audioBitrate,
                audioSampleRate: 48000 as const,
                videoCodec: DEFAULT_EXPORT_CONFIG.videoCodec,
                audioCodec: DEFAULT_EXPORT_CONFIG.audioCodec,
                hardwareAcceleration: currentSettings.encoder === 'software' ? 'prefer-software' : 'prefer-hardware',
                showWatermark: currentSettings.showWatermark,  // Pass watermark setting
                showSubtitles: currentSettings.showSubtitles,
                subtitleStyle: currentSettings.subtitleStyle
            }

            // Record total frames during video encoding (as audio encoding and muxing will overwrite to 0)
            let videoTotalFrames = 0

            // Create exporter
            const exporter = new VideoExporter(freshEpisode, config, {
                signal: abortController.signal,
                onProgress: (progress: VideoExportProgress) => {

                    // Save video encoding total frames
                    if (progress.stage === 'encoding' && progress.totalFrames > 0) {
                        videoTotalFrames = progress.totalFrames
                    }

                    exportState.value.progress = progress

                    // Update status
                    if (progress.stage === 'preparing') {
                        exportState.value.status = 'preparing'
                    } else if (progress.stage === 'encoding') {
                        exportState.value.status = 'encoding'
                    } else if (progress.stage === 'muxing') {
                        exportState.value.status = 'muxing'
                    }
                }
            })

            // Execute export
            const blob = await exporter.export()

            // Export successful
            exportState.value.status = 'completed'
            exportState.value.outputBlob = blob
            exportState.value.outputFileName = `${episode.name ?? 'Untitled_Script'}_${new Date().toISOString().slice(0, 10)}.mp4`

            // Collect export result info
            const duration = Date.now() - exportStartTime
            const qualityLabel = QUALITY_PRESETS.find(p => p.id === currentSettings.quality)?.label ?? currentSettings.quality

            // Use video encoding total frames (audio/muxing stages overwrite progress.totalFrames to 0)
            const totalFrames = videoTotalFrames || exportState.value.progress.totalFrames || exportState.value.progress.currentFrame || 0



            exportResult.value = {
                success: true,
                fileSize: blob.size,
                duration: duration,
                totalFrames: totalFrames,
                resolution: {
                    width: resolutionPreset.width,
                    height: resolutionPreset.height
                },
                frameRate: 60,
                quality: qualityLabel
            }

            // Auto download
            downloadBlob(blob, exportState.value.outputFileName)

            // Close progress dialog, show results dialog
            showProgressDialog.value = false
            showResultDialog.value = true

        } catch (error: unknown) {
            const err = error as { message?: string, stack?: string }
            if (err.message === ERROR_CODES.CANCELLED) {
                // User cancellation is normal operation, do not log as error
                exportState.value.status = 'cancelled'
                exportState.value.error = {
                    code: ERROR_CODES.CANCELLED,
                    message: 'Export cancelled'
                }
                // Do not show results dialog on cancellation
            } else {
                // Only log genuine errors
                console.error('[useVideoExport] Export failed:', error)
                exportState.value.status = 'error'
                exportState.value.error = {
                    code: ERROR_CODES.UNKNOWN_ERROR,
                    message: err.message ?? 'Export failed',
                    details: error
                }

                // Collect error result information
                const duration = Date.now() - exportStartTime
                const qualityLabel = QUALITY_PRESETS.find(p => p.id === currentSettings.quality)?.label ?? currentSettings.quality
                const resolutionPreset = RESOLUTION_PRESETS.find(p => p.id === currentSettings.resolution)

                exportResult.value = {
                    success: false,
                    fileSize: 0,
                    duration: duration,
                    totalFrames: exportState.value.progress.totalFrames,
                    resolution: {
                        width: resolutionPreset?.width ?? 1920,
                        height: resolutionPreset?.height ?? 1080
                    },
                    frameRate: 60,
                    quality: qualityLabel,
                    errorMessage: err.message ?? 'Export failed',
                    errorDetails: err.stack ?? JSON.stringify(error, null, 2)
                }

                // Close progress dialog, show results dialog
                showProgressDialog.value = false
                showResultDialog.value = true
            }
        } finally {
            abortController = null
        }
    }

    /**
     * Cancel export
     */
    const cancelExport = () => {
        if (abortController) {
            abortController.abort()
            abortController = null
        }

        showConfirmDialog.value = false
        showProgressDialog.value = false
        currentEpisodeId.value = null
    }

    /**
     * Download Blob
     */
    const downloadBlob = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    /**
     * Close result dialog
     */
    const closeResultDialog = () => {
        showResultDialog.value = false
        exportResult.value = null
    }

    /**
     * Export again
     */
    const exportAgain = () => {
        closeResultDialog()
        if (currentEpisodeId.value) {
            showConfirmDialog.value = true
        }
    }

    /**
     * Retry export
     */
    const retryExport = () => {
        closeResultDialog()
        if (currentEpisodeId.value) {
            void confirmExport()
        }
    }

    return {
        exportState,
        exportSettings,
        exportResult,
        showConfirmDialog,
        showProgressDialog,
        showResultDialog,
        startExport,
        confirmExport,
        cancelExport,
        closeResultDialog,
        exportAgain,
        retryExport,
    }
}
