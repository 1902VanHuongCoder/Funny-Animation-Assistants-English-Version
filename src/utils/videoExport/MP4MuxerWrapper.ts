import { ArrayBufferTarget, Muxer } from 'mp4-muxer'

import type { VideoExportConfig } from './types'

/**
 * MP4 muxer wrapper class
 */
export class MP4MuxerWrapper {
    private muxer: Muxer<ArrayBufferTarget> | null = null
    private target: ArrayBufferTarget | null = null

    /**
     * Initialize Muxer
     */
    initialize(config: VideoExportConfig): void {
        this.target = new ArrayBufferTarget()

        this.muxer = new Muxer({
            target: this.target,
            video: {
                codec: 'avc',
                width: config.resolution.width,
                height: config.resolution.height,
            },
            audio: {
                codec: 'aac',
                numberOfChannels: 2,
                sampleRate: config.audioSampleRate,
            },
            fastStart: 'in-memory', // Enable fast start mode
            firstTimestampBehavior: 'offset', // Automatically handle timestamp offset
        })
    }

    /**
     * Add video chunk
     */
    addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
        if (!this.muxer) {
            throw new Error('Muxer not initialized')
        }

        this.muxer.addVideoChunk(chunk, meta)
    }

    /**
     * Add audio chunk
     */
    addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void {
        if (!this.muxer) {
            throw new Error('Muxer not initialized')
        }

        this.muxer.addAudioChunk(chunk, meta)
    }

    /**
     * Finalize muxing and return Blob
     */
    finalize(): Blob {
        if (!this.muxer || !this.target) {
            throw new Error('Muxer not initialized')
        }

        this.muxer.finalize()

        const blob = new Blob([this.target.buffer], { type: 'video/mp4' })

        return blob
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        this.muxer = null
        this.target = null
    }
}
