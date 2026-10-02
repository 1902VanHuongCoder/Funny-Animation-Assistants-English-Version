/**
 * UUID utility functions
 * Provides unified ID generation strategies
 */

/**
 * Generate unique ID
 * Prefers crypto.randomUUID() (if available), otherwise uses timestamp + random numbers
 * 
 * @param prefix Optional prefix (used to identify ID type)
 * @returns Unique ID string
 */
export function generateId(prefix?: string): string {
  // Prefer browser native UUID API (if available)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    const uuid = crypto.randomUUID()
    return prefix ? `${prefix}_${uuid}` : uuid
  }

  // Fallback: timestamp + random numbers
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 11)
  const id = `${timestamp}_${random}`
  return prefix ? `${prefix}_${id}` : id
}

/**
 * Generate short ID (for display)
 * Format: prefix_randomString (8 chars)
 */
export function generateShortId(prefix: string): string {
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${random}`
}

