/**
 * Blob URL and Base64 conversion utility functions
 * Used for project file serialization and deserialization
 */

/**
 * Convert Blob URL to Base64 Data URL
 * @param blobUrl Blob URL (blob:http://...)
 * @returns Base64 Data URL (data:image/png;base64,...)
 */
export async function blobUrlToBase64(blobUrl: string): Promise<string> {
  try {
    const response = await fetch(blobUrl)
    const blob = await response.blob()
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result)
        } else {
          reject(new Error('Failed to convert blob to base64'))
        }
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch (error) {
    console.error('[BlobUtils] Failed to convert blob URL to base64:', blobUrl, error)
    throw error
  }
}

/**
 * Convert Base64 Data URL to Blob URL
 * @param base64 Base64 Data URL
 * @returns Blob URL
 */
export function base64ToBlobUrl(base64: string): string {
  try {
    // Parse base64 string
    const parts = base64.split(',')
    if (parts.length !== 2) {
      throw new Error('Invalid base64 format')
    }

    const header = parts[0]
    const data = parts[1]
    
    if (!header || !data) {
       throw new Error('Invalid base64 data')
    }
    
    const mimeMatch = /:(.*?);/.exec(header)
    if (!mimeMatch) {
      throw new Error('Invalid MIME type')
    }
    
    const mimeString = mimeMatch[1] ?? ''
    const byteString = atob(data)
    
    // Convert to ArrayBuffer
    const ab = new ArrayBuffer(byteString.length)
    const ia = new Uint8Array(ab)
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i)
    }
    
    // Create Blob and generate URL
    const blob = new Blob([ab], { type: mimeString })
    return URL.createObjectURL(blob)
  } catch (error) {
    console.error('[BlobUtils] Failed to convert base64 to blob URL:', error)
    throw error
  }
}

/**
 * Batch convert Blob URLs to Base64
 * @param urls Set of Blob URLs
 * @returns Map<originalURL, Base64>
 */
export async function batchBlobUrlsToBase64(urls: Set<string>): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const promises: Promise<void>[] = []
  
  for (const url of urls) {
    if (url.startsWith('blob:')) {
      promises.push(
        blobUrlToBase64(url).then(base64 => {
          result.set(url, base64)
        }).catch(error => {
          console.warn(`[BlobUtils] Failed to convert ${url}:`, error)
        })
      )
    } else {
      // Retain non-Blob URLs directly
      result.set(url, url)
    }
  }
  
  await Promise.all(promises)
  return result
}

/**
 * Batch convert Base64 to Blob URLs
 * @param base64Strings Set of Base64 strings
 * @returns Map<Base64, BlobURL>
 */
export function batchBase64ToBlobUrls(base64Strings: Set<string>): Map<string, string> {
  const result = new Map<string, string>()
  
  for (const str of base64Strings) {
    if (str.startsWith('data:')) {
      try {
        const blobUrl = base64ToBlobUrl(str)
        result.set(str, blobUrl)
      } catch (error) {
        console.warn(`[BlobUtils] Failed to convert base64:`, error)
        result.set(str, str) // Retain original value
      }
    } else {
      result.set(str, str) // Retain non-Base64 directly
    }
  }
  
  return result
}

/**
 * Recursively replace all URLs in object
 * @param data Data object
 * @param urlMap URL mapping table Map<originalURL, newURL>
 * @returns Replaced data
 */
export function replaceUrlsInData(data: unknown, urlMap: Map<string, string>): unknown {
  if (typeof data === 'string') {
    return urlMap.get(data) ?? data
  }
  
  if (Array.isArray(data)) {
    return data.map(item => replaceUrlsInData(item, urlMap))
  }
  
  if (data && typeof data === 'object') {
    const result: Record<string, unknown> = {}
    const obj = data as Record<string, unknown>
    for (const key in obj) {
      result[key] = replaceUrlsInData(obj[key], urlMap)
    }
    return result
  }
  
  return data
}

/**
 * Recursively collect all URLs from object
 * @param data Data object
 * @param urlSet Set of URLs (will be mutated)
 * @param urlType 'blob' | 'base64' | 'all'
 */
export function collectUrlsFromData(data: unknown, urlSet: Set<string>, urlType: 'blob' | 'base64' | 'all' = 'all'): void {
  if (typeof data === 'string') {
    if (urlType === 'all') {
      if (data.startsWith('blob:') || data.startsWith('data:')) {
        urlSet.add(data)
      }
    } else if (urlType === 'blob' && data.startsWith('blob:')) {
      urlSet.add(data)
    } else if (urlType === 'base64' && data.startsWith('data:')) {
      urlSet.add(data)
    }
    return
  }
  
  if (Array.isArray(data)) {
    data.forEach(item => collectUrlsFromData(item, urlSet, urlType))
    return
  }
  
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    for (const key in obj) {
      collectUrlsFromData(obj[key], urlSet, urlType)
    }
  }
}
