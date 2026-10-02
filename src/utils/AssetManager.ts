/**
 * Asset loader
 * Manages loading and caching of images, audio, and other resources
 */

import * as PIXI from 'pixi.js'

import type { Assets } from '@/types/project'

import { LRUCache } from './LRUCache'

export interface LoadProgress {
  loaded: number
  total: number
  currentUrl: string
}

export interface AssetManagerConfig {
  maxTextureCache?: number // Maximum texture cache count
  maxMemoryMB?: number // Maximum memory limit (MB)
}

export class AssetManager {
  private textureCache: LRUCache<string, PIXI.Texture>
  private imageCache = new Map<string, HTMLImageElement>()
  private audioCache = new Map<string, AudioBuffer>()
  private loadingPromises = new Map<string, Promise<unknown>>()
  private audioContext: AudioContext
  private maxMemoryBytes: number
  private currentMemoryBytes = 0

  constructor(config: AssetManagerConfig = {}) {
    // maxTextureCache no longer used; controlled entirely by memory limit
    const maxMemoryMB = config.maxMemoryMB ?? 200

    this.maxMemoryBytes = maxMemoryMB * 1024 * 1024

    // Create LRU texture cache, destroys textures on eviction
    this.textureCache = new LRUCache<string, PIXI.Texture>(
      10000, // Very large limit; eviction controlled by memory limit
      (url, texture) => {
        texture.destroy(true)

        // Update memory statistics
        const img = this.imageCache.get(url)
        if (img) {
          const size = this.estimateImageSize(img)
          this.currentMemoryBytes -= size
          this.imageCache.delete(url)
        }
      }
    )

    // Lazily initialize AudioContext to avoid suspended state when created without user interaction
    // Created when actually needed (in loadAudio)
    this.audioContext = null as unknown as AudioContext
  }

  /**
   * Get or create AudioContext (lazy initialization)
   */
  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
      // If suspended, attempt resume
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(err => {
          console.warn('[AssetManager] Failed to resume AudioContext:', err)
        })
      }
    }
    return this.audioContext
  }

  /**
   * Load all assets from project asset list
   */
  async loadProjectAssets(
    assets: Assets,
    onProgress?: (progress: LoadProgress) => void
  ): Promise<void> {
    const urls: string[] = []

    // Collect background image URLs
    assets.backgrounds.forEach(bg => {
        if (bg.url) urls.push(bg.url)
    })

    // Collect music URLs
    assets.musics.forEach(music => urls.push(music.url))
    let loaded = 0
    const total = urls.length

    for (const url of urls) {
      if (onProgress) {
        onProgress({ loaded, total, currentUrl: url })
      }

      try {
        if (this.isAudioUrl(url)) {
          await this.loadAudio(url)
        } else {
          await this.loadImage(url)
        }
        loaded++
      } catch (error) {
        // Ignore error
      }
    }

    if (onProgress) {
      onProgress({ loaded: total, total, currentUrl: '' })
    }
  }

  /**
   * Load image and create texture
   */
  async loadImage(url: string): Promise<PIXI.Texture> {
    // Check texture cache
    const cached = this.textureCache.get(url)
    if (cached) {
      return cached
    }

    // Check if already loading
    const loading = this.loadingPromises.get(url)
    if (loading) {
      return loading as Promise<PIXI.Texture>
    }

    // Start loading
    const promise = this._loadImageInternal(url)
    this.loadingPromises.set(url, promise)

    try {
      const texture = await promise
      return texture
    } finally {
      this.loadingPromises.delete(url)
    }
  }

  private async _loadImageInternal(url: string): Promise<PIXI.Texture> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'

      img.onload = () => {
        try {
          // Estimate image size
          const size = this.estimateImageSize(img)

          // Check memory limit
          if (this.currentMemoryBytes + size > this.maxMemoryBytes) {
            this.evictOldTextures(size)
          }

          // Create Pixi texture
          const baseTexture = PIXI.BaseTexture.from(img, {
            scaleMode: PIXI.SCALE_MODES.LINEAR,
            resolution: 1
          })
          const texture = new PIXI.Texture(baseTexture)

          // Cache image and texture
          this.imageCache.set(url, img)
          this.textureCache.set(url, texture)
          this.currentMemoryBytes += size

          resolve(texture)
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }

      img.onerror = () => {
        reject(new Error(`Failed to load image: ${url}`))
      }

      img.src = url
    })
  }

  /**
   * Load audio
   */
  async loadAudio(url: string): Promise<AudioBuffer> {
    // Check cache
    const cached = this.audioCache.get(url)
    if (cached) {
      return cached
    }

    // Check if already loading
    const loading = this.loadingPromises.get(url)
    if (loading) {
      return loading as Promise<AudioBuffer>
    }

    // Start loading
    const promise = this._loadAudioInternal(url)
    this.loadingPromises.set(url, promise)

    try {
      const buffer = await promise
      return buffer
    } finally {
      this.loadingPromises.delete(url)
    }
  }

  private async _loadAudioInternal(url: string): Promise<AudioBuffer> {
    try {
      const response = await fetch(url)
      const arrayBuffer = await response.arrayBuffer()
      const audioContext = this.getAudioContext()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

      this.audioCache.set(url, audioBuffer)
      return audioBuffer
    } catch (error) {
      throw new Error(`Failed to load audio: ${url} - ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Get texture
   */
  getTexture(url: string): PIXI.Texture | undefined {
    return this.textureCache.get(url)
  }

  /**
   * Get audio buffer
   */
  getAudio(url: string): AudioBuffer | undefined {
    return this.audioCache.get(url)
  }

  /**
   * Preload multiple assets
   */
  async preload(urls: string[]): Promise<void> {
    const promises = urls.map(url => {
      if (this.isAudioUrl(url)) {
        return this.loadAudio(url)
      } else {
        return this.loadImage(url)
      }
    })

    await Promise.all(promises)
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.textureCache.clear()
    this.imageCache.clear()
    this.audioCache.clear()
    this.loadingPromises.clear()
    this.currentMemoryBytes = 0
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      textures: this.textureCache.size,
      images: this.imageCache.size,
      audios: this.audioCache.size,
      memoryMB: (this.currentMemoryBytes / 1024 / 1024).toFixed(2),
      maxMemoryMB: (this.maxMemoryBytes / 1024 / 1024).toFixed(2)
    }
  }

  /**
   * Estimate image memory footprint (bytes)
   */
  private estimateImageSize(img: HTMLImageElement): number {
    // Estimate: width * height * 4 (RGBA)
    // Factoring in Mipmaps and GPU memory alignment, use 1.5x safety margin
    return Math.ceil(img.width * img.height * 4 * 1.5)
  }

  /**
   * Evict old textures to free memory
   */
  private evictOldTextures(neededBytes: number): void {
    const keys = this.textureCache.keys()
    let freedBytes = 0

    for (const url of keys) {
      if (freedBytes >= neededBytes) break

      const img = this.imageCache.get(url)
      if (img) {
        const size = this.estimateImageSize(img)
        this.textureCache.delete(url)
        freedBytes += size
      }
    }
  }

  /**
   * Determine whether URL is audio
   */
  private isAudioUrl(url: string): boolean {
    const audioExts = ['.mp3', '.ogg', '.wav', '.m4a', '.aac']
    const lowerUrl = url.toLowerCase()
    return audioExts.some(ext => lowerUrl.endsWith(ext))
  }

  /**
   * Destroy asset manager
   */
  destroy(): void {
    this.clear()
    if (this.audioContext) {
      void this.audioContext.close()
    }
  }
}
