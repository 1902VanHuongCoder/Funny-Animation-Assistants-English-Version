import type { MP4MuxerWrapper } from './MP4MuxerWrapper'
import type { VideoExportConfig } from './types'

/**
 * Video encoder wrapper class
 */
export class VideoEncoderWrapper {
    private encoder: VideoEncoder | null = null
    private muxer: MP4MuxerWrapper
    private config: VideoExportConfig
    private isConfigured = false

    constructor(muxer: MP4MuxerWrapper, config: VideoExportConfig) {
        this.muxer = muxer
        this.config = config
    }

    /**
     * Initialize and configure encoder
     */
    async initialize(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.encoder = new VideoEncoder({
                output: (chunk, meta) => {
                    try {
                        this.muxer.addVideoChunk(chunk, meta)
                    } catch (error) {
                        console.error('[VideoEncoder] Failed to add video chunk:', error)
                    }
                },
                error: (error) => {
                    console.error('[VideoEncoder] Encoding error:', error)
                    reject(error)
                },
            })

            // Configure encoder
            // Hardware encoders have lower bitrate efficiency (NVENC/QSV/AMF), require 1.5x bitrate compensation for equivalent quality
            const effectiveBitrate = this.config.hardwareAcceleration === 'prefer-hardware'
                ? Math.round(this.config.videoBitrate * 1.5)
                : this.config.videoBitrate

            const encoderConfig: VideoEncoderConfig = {
                codec: this.config.videoCodec,
                width: this.config.resolution.width,
                height: this.config.resolution.height,
                bitrate: effectiveBitrate,
                framerate: this.config.frameRate,
                // Use user-selected encoder type
                hardwareAcceleration: this.config.hardwareAcceleration,
                // Software encoding enables quality-first mode, sacrificing speed for higher picture quality
                ...(this.config.hardwareAcceleration === 'prefer-software'
                    ? { latencyMode: 'quality' as const }
                    : {}),
                // AVC configuration
                avc: { format: 'avc' },
            }

            this.encoder.configure(encoderConfig)
            this.isConfigured = true

            resolve()
        })
    }

    /**
     * Encode one frame
     */
    encode(frame: VideoFrame, keyFrame = false): void {
        if (!this.encoder || !this.isConfigured) {
            throw new Error('Encoder not initialized')
        }

        try {
            this.encoder.encode(frame, { keyFrame })
        } catch (error) {
            console.error('[VideoEncoder] Failed to encode frame:', error)
            throw error
        }
    }

    /**
     * Flush encoder buffer
     */
    async flush(): Promise<void> {
        if (!this.encoder) {
            return
        }

        return this.encoder.flush()
    }

    /**
     * Get encoder queue size (for debugging)
     */
    getQueueSize(): number {
        if (!this.encoder) {
            return 0
        }
        return this.encoder.encodeQueueSize
    }

    /**
     * Clean up resources
     */
    async destroy(): Promise<void> {
        if (this.encoder) {
            try {
                await this.flush()
                this.encoder.close()
            } catch (error) {
                console.error('[VideoEncoder] Cleanup failed:', error)
            }
            this.encoder = null
        }
        this.isConfigured = false
    }
}
