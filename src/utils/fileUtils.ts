/**
 * File utility functions
 */

/**
 * Convert File object to Blob URL
 */
export function fileToBlob(file: File): string {
  return URL.createObjectURL(file)
}

/**
 * Load image from Blob URL
 */
export async function loadImageFromBlob(blobUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = blobUrl
  })
}
