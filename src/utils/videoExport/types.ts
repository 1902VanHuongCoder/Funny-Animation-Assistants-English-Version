// Types are defined inline in this file

/**
 * Hardware acceleration mode
 */
export type HardwareAcceleration = 'prefer-hardware' | 'prefer-software'

/**
 * Export configuration
 */
export interface VideoExportConfig {
    // Export range
    episodeId: string

    // Video parameters
    resolution: {
        width: number   // Pixel width
        height: number  // Pixel height
        scale: number   // Camera viewport multiplier (1x, 1.5x, 2x)
    }
    frameRate: number
    videoBitrate: number  // bps, e.g. 8_000_000 = 8Mbps

    // Audio parameters
    audioBitrate: number  // bps, e.g. 128_000 = 128kbps
    audioSampleRate: 48000  // Fixed 48kHz

    // Encoder configuration
    videoCodec: 'avc1.640028'  // H.264 High Profile Level 4.0
    audioCodec: 'mp4a.40.2'    // AAC-LC

    // Hardware acceleration
    hardwareAcceleration: HardwareAcceleration  // Encoder type

    // Watermark configuration
    showWatermark?: boolean  // Whether to show watermark, default false

    // Subtitle configuration
    showSubtitles?: boolean  // Whether to show subtitles, default false
    subtitleStyle?: SubtitleStyle
}

/**
 * Export subtitle style
 */
export interface SubtitleStyle {
    fontFamily: string
    fontSize: number
    textColor: string
    backgroundColor: string
    backgroundOpacity: number
    maxWidthPercent: number
    bottomPercent: number
}

/**
 * Export status
 */
export type VideoExportStatus =
    | 'idle'
    | 'preparing'   // Preparing resources
    | 'encoding'    // Encoding
    | 'muxing'      // Muxing
    | 'completed'
    | 'error'
    | 'cancelled'

/**
 * Export progress information
 */
export interface VideoExportProgress {
    currentFrame: number
    totalFrames: number
    percentage: number  // 0-100

    // Timing information
    elapsedTime: number      // ms
    estimatedRemaining: number  // ms

    // Current stage
    stage: 'preparing' | 'encoding' | 'muxing'
    stageMessage: string

    // Scene information
    currentScene?: string       // Current scene name
    currentSceneIndex?: number  // Current scene index
    totalScenes?: number        // Total scene count
}

/**
 * Export state data
 */
export interface VideoExportState {
    status: VideoExportStatus
    progress: VideoExportProgress

    // Error information
    error?: {
        code: string
        message: string
        details?: unknown
    }

    // Output
    outputBlob?: Blob
    outputFileName?: string
}

/**
 * Audio track information
 */
export interface AudioTrack {
    buffer: AudioBuffer
    startTime: number      // ms
    duration: number       // ms
    volume: number         // 0-1
    fadeIn?: number        // ms
    fadeOut?: number       // ms
    source: 'tts' | 'bgm' | 'sfx'
}

/**
 * Progress callback
 */
export type ProgressCallback = (progress: VideoExportProgress) => void

/**
 * Export options
 */
export interface VideoExportOptions {
    onProgress?: ProgressCallback
    signal?: AbortSignal
}

/**
 * User export settings (configurable items)
 */
export interface ExportSettings {
    resolution: '1080p' | '720p'
    frameRate: 60
    quality: 'low' | 'medium' | 'high' | 'ultra'
    encoder: 'hardware' | 'software'  // Encoder type
    showWatermark: boolean  // Whether to show watermark, default false
    showSubtitles: boolean  // Whether to show subtitles, default false
    subtitleStyle: SubtitleStyle
}

/**
 * Export result information
 */
export interface ExportResult {
    success: boolean
    fileSize: number           // File size (bytes)
    duration: number           // Export duration (ms)
    totalFrames: number        // Total frame count
    resolution: {
        width: number
        height: number
    }
    frameRate: number
    quality: string
    errorMessage?: string      // Error message
    errorDetails?: string      // Error details
}
