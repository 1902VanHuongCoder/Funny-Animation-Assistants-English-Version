import type { SubtitleStyle } from './types'

/**
 * Canvas dimension constants (imported from unified constants)
 */
export {
    CAMERA_BASE_HEIGHT,
    CAMERA_BASE_WIDTH,
    CANVAS_CENTER_X,
    CANVAS_CENTER_Y,
    CANVAS_HEIGHT,
    CANVAS_WIDTH
} from '@/constants/canvas'

/**
 * Default export configuration
 */
export const DEFAULT_EXPORT_CONFIG = {
    // Resolution scale
    resolutionScale: 1.0,  // 1x = 1456×819

    // Default framerate
    frameRate: 60,

    // Video bitrate (15 Mbps, ultra quality)
    videoBitrate: 15_000_000,

    // Audio bitrate (128 kbps)
    audioBitrate: 128_000,

    // Audio sample rate
    audioSampleRate: 48000,

    // Encoder configuration
    videoCodec: 'avc1.640028' as const,  // H.264 High Profile Level 4.0
    audioCodec: 'mp4a.40.2' as const,    // AAC-LC
}

/**
 * Default export subtitle style
 * Aligned with ScenePlayer subtitle appearance: bottom-centered, white text, translucent black background.
 */
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
    fontFamily: 'Noto Sans SC',
    fontSize: 24,
    textColor: '#ffffff',
    backgroundColor: '#000000',
    backgroundOpacity: 0.6,
    maxWidthPercent: 80,
    bottomPercent: 5,
}

/**
 * Supported resolution presets
 */
export const RESOLUTION_PRESETS = [
    { id: '1080p', label: '1080P', width: 1920, height: 1080 },
    { id: '720p', label: '720P', width: 1280, height: 720 },
] as const

/**
 * Supported framerate presets
 */
export const FRAMERATE_PRESETS = [
    { value: 60, label: '60 FPS' },
] as const

/**
 * Quality presets
 */
export const QUALITY_PRESETS = [
    { id: 'low', label: 'Low', videoBitrate: 2_000_000, description: 'Smallest file' },
    { id: 'medium', label: 'Medium', videoBitrate: 5_000_000, description: 'Balanced' },
    { id: 'high', label: 'High', videoBitrate: 8_000_000, description: 'Recommended' },
    { id: 'ultra', label: 'Ultra', videoBitrate: 15_000_000, description: 'Best quality' },
] as const

/**
 * Error codes
 */
export const ERROR_CODES = {
    BROWSER_NOT_SUPPORTED: 'BROWSER_NOT_SUPPORTED',
    RESOURCE_LOAD_FAILED: 'RESOURCE_LOAD_FAILED',
    ENCODER_INIT_FAILED: 'ENCODER_INIT_FAILED',
    ENCODING_FAILED: 'ENCODING_FAILED',
    MUXING_FAILED: 'MUXING_FAILED',
    CANCELLED: 'CANCELLED',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const

/**
 * Check whether browser supports WebCodecs
 */
export function checkWebCodecsSupport(): { supported: boolean; error?: string } {
    if (typeof VideoEncoder === 'undefined') {
        return {
            supported: false,
            error: 'Current browser does not support WebCodecs API, please use Chrome 94+ or Edge 94+'
        }
    }

    if (typeof AudioEncoder === 'undefined') {
        return {
            supported: false,
            error: 'Current browser does not support WebCodecs AudioEncoder'
        }
    }

    return { supported: true }
}
