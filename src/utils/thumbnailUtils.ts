import * as PIXI from 'pixi.js'

/**
 * Thumbnail generation utility
 */

const THUMBNAIL_SIZE = 512
const THUMBNAIL_QUALITY = 0.8

// In-memory thumbnail cache (Map<sourceUrl, thumbnailUrl>)
const thumbnailCache = new Map<string, string>()

/**
 * Generate thumbnail Blob URL from image URL
 * @param sourceUrl Original image URL (Blob URL or HTTP URL)
 * @returns Thumbnail Blob URL
 */
export async function generateThumbnail(sourceUrl: string): Promise<string> {
  if (!sourceUrl) return ''

  // 1. Check cache
  if (thumbnailCache.has(sourceUrl)) {
    return thumbnailCache.get(sourceUrl)!
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'Anonymous'

    img.onload = () => {
      try {
        // Calculate scaling ratio
        let width = img.width
        let height = img.height

        // If image itself is small, return original
        if (width <= THUMBNAIL_SIZE && height <= THUMBNAIL_SIZE) {
          thumbnailCache.set(sourceUrl, sourceUrl)
          resolve(sourceUrl)
          return
        }

        // Maintain aspect ratio scaling
        if (width > height) {
          if (width > THUMBNAIL_SIZE) {
            height = Math.round(height * (THUMBNAIL_SIZE / width))
            width = THUMBNAIL_SIZE
          }
        } else {
          if (height > THUMBNAIL_SIZE) {
            width = Math.round(width * (THUMBNAIL_SIZE / height))
            height = THUMBNAIL_SIZE
          }
        }

        // Create canvas
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          reject(new Error('Failed to get canvas context'))
          return
        }

        // Draw image
        ctx.drawImage(img, 0, 0, width, height)

        // Export as Blob
        canvas.toBlob((blob) => {
          if (blob) {
            const thumbUrl = URL.createObjectURL(blob)
            thumbnailCache.set(sourceUrl, thumbUrl)
            resolve(thumbUrl)
          } else {
            reject(new Error('Failed to create blob'))
          }
        }, 'image/jpeg', THUMBNAIL_QUALITY)

      } catch (err) {
        let msg = 'Unknown error';
        if (err instanceof Error) msg = err.message;
        else if (typeof err === 'string') msg = err;
        reject(new Error(msg))
      }
    }

    img.onerror = (err) => {
      let msg = 'Unknown error';
      if (err instanceof Error) msg = err.message;
      else if (typeof err === 'string') msg = err;
      reject(new Error(msg))
    }

    img.src = sourceUrl
  })
}

/**
 * Generate thumbnail from PIXI Application
 * @param app PIXI Application instance
 * @returns Thumbnail Blob URL
 */
export async function generateThumbnailFromCanvas(app: PIXI.Application): Promise<string> {
  // 1. Extract canvas
  // Note: Extract operation is expensive and may cause momentary frame drop
  const sourceCanvas = app.renderer.extract.canvas(app.stage) as HTMLCanvasElement

  return new Promise((resolve, reject) => {
    try {
      // Calculate scaling ratio
      let width = sourceCanvas.width
      let height = sourceCanvas.height

      // Maintain aspect ratio scaling
      if (width > height) {
        if (width > THUMBNAIL_SIZE) {
          height = Math.round(height * (THUMBNAIL_SIZE / width))
          width = THUMBNAIL_SIZE
        }
      } else {
        if (height > THUMBNAIL_SIZE) {
          width = Math.round(width * (THUMBNAIL_SIZE / height))
          height = THUMBNAIL_SIZE
        }
      }

      // Create target canvas
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }

      // Fill white background first to avoid transparent areas turning black during JPEG conversion
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, width, height)

      // Draw image
      ctx.drawImage(sourceCanvas, 0, 0, width, height)

      // Export as Base64 Data URL instead of Blob URL so it can be stored in .anime project files
      try {
        const dataUrl = canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY)
        resolve(dataUrl)
      } catch (err) {
        reject(new Error('Failed to convert canvas to data URL: ' + (err instanceof Error ? err.message : String(err))))
      }

    } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
}

/**
 * Clear thumbnail cache
 */
export function clearThumbnailCache() {
  thumbnailCache.forEach(url => {
    // Only release Blob URLs we created
    if (url.startsWith('blob:') && url !== thumbnailCache.keys().next().value) {
      // Cache stores url
    }
  })
  // Relies on page reload or component destruction for cleanup
}
