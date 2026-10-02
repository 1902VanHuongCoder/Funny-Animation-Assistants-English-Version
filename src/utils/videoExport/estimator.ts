/**
 * Video export file size estimation utility
 */

/**
 * Estimate file size (bytes)
 * @param durationMs Video duration (ms)
 * @param videoBitrate Video bitrate (bps)
 * @param audioBitrate Audio bitrate (bps)
 * @returns Estimated file size (bytes)
 */
export function estimateFileSize(
    durationMs: number,
    videoBitrate: number,
    audioBitrate: number
): number {
    const durationSec = durationMs / 1000

    // Under VBR mode, actual bitrate is usually 60-80% of target bitrate
    // For animated content (many static frames), 70% is used as estimation factor
    // Conservative estimation means actual files are smaller, providing better user experience
    const effectiveVideoBitrate = videoBitrate * 0.7

    // Audio also uses VBR, actual is roughly 90% of target
    const effectiveAudioBitrate = audioBitrate * 0.9

    // File size = (effective video bitrate + effective audio bitrate) * duration / 8
    // Divided by 8 because bitrate is in bits per second, converting to bytes
    const sizeBytes = ((effectiveVideoBitrate + effectiveAudioBitrate) * durationSec) / 8

    // Add 5% container overhead (MP4 header, metadata, etc.)
    return Math.ceil(sizeBytes * 1.05)
}

/**
 * Format file size into human-readable string
 * @param bytes File size (bytes)
 * @returns Formatted string (e.g. "45.2 MB")
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B'

    const units = ['B', 'KB', 'MB', 'GB']
    const k = 1024
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`
}

/**
 * Format duration into human-readable string
 * @param ms Duration (ms)
 * @returns Formatted string (e.g. "2:35")
 */
export function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60

    return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
