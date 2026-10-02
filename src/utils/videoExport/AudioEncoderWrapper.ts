import type { MP4MuxerWrapper } from './MP4MuxerWrapper'
import type { VideoExportConfig } from './types'

/**
 * Audio encoder wrapper class
 */
export class AudioEncoderWrapper {
    private encoder: AudioEncoder | null = null
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
            this.encoder = new AudioEncoder({
                output: (chunk, meta) => {
                    try {
                        this.muxer.addAudioChunk(chunk, meta)
                    } catch (error) {
                        console.error('[AudioEncoder] Failed to add audio chunk:', error)
                    }
                },
                error: (error) => {
                    console.error('[AudioEncoder] Encoding error:', error)
                    reject(error)
                },
            })

            // Configure encoder
            const encoderConfig: AudioEncoderConfig = {
                codec: this.config.audioCodec,
                sampleRate: this.config.audioSampleRate,
                numberOfChannels: 2,
                bitrate: this.config.audioBitrate,
            }

            this.encoder.configure(encoderConfig)
            this.isConfigured = true

            resolve()
        })
    }

    /**
     * Encode AudioData
     */
    encode(audioData: AudioData): void {
        if (!this.encoder || !this.isConfigured) {
            throw new Error('Encoder not initialized')
        }

        try {
            this.encoder.encode(audioData)
        } catch (error) {
            console.error('[AudioEncoder] Encoding failed:', error)
            throw error
        }
    }

    /**
     * Batch encode AudioBuffer
     */
    encodeBuffer(buffer: AudioBuffer): Promise<void> {
        if (!this.encoder || !this.isConfigured) {
            throw new Error('Encoder not initialized')
        }

        const sampleRate = buffer.sampleRate
        const numberOfChannels = buffer.numberOfChannels
        const length = buffer.length

        // Convert AudioBuffer to AudioData
        // Pass chunks to avoid memory issues
        const chunkSize = sampleRate // 1 second of data

        for (let offset = 0; offset < length; offset += chunkSize) {
            const frameLength = Math.min(chunkSize, length - offset)

            // Extract planar data (channels sequentially arranged)
            const planarData = new Float32Array(frameLength * numberOfChannels)
            for (let ch = 0; ch < numberOfChannels; ch++) {
                const channelSamples = buffer.getChannelData(ch)
                const channelSlice = channelSamples.subarray(offset, offset + frameLength)
                planarData.set(channelSlice, ch * frameLength)
            }

            // Create AudioData - using f32-planar format
            const audioData = new AudioData({
                format: 'f32-planar',
                sampleRate: sampleRate,
                numberOfFrames: frameLength,
                numberOfChannels: numberOfChannels,
                timestamp: (offset / sampleRate) * 1_000_000, // Convert to microseconds
                data: planarData,
            })

            this.encode(audioData)
            audioData.close()
        }
        return Promise.resolve()
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
     * Clean up resources
     */
    async destroy(): Promise<void> {
        if (this.encoder) {
            try {
                await this.flush()
                this.encoder.close()
            } catch (error) {
                console.error('[AudioEncoder] Cleanup failed:', error)
            }
            this.encoder = null
        }
        this.isConfigured = false
    }
}
