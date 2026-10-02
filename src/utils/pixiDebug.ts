/**
 * PixiJS object debugging utility
 * Adds debug information to PixiJS objects for development debugging
 */

import type { Container } from 'pixi.js'

import type { SceneObject } from '@/stores/sceneObjectStore'

/**
 * Add debug info to PixiJS object
 * @param displayObject PixiJS display object
 * @param obj Scene object data
 * @param extraInfo Additional debug info
 */
export function addPixiDebugInfo(
  displayObject: Container,
  obj: SceneObject,
  extraInfo?: Record<string, unknown>
): void {
  // Set object name for easy identification in console
  displayObject.name = `${obj.type}_${obj.name}_${obj.id.slice(-6)}`

  // Mount custom debug data
  ;(displayObject as unknown as { debugInfo: unknown }).debugInfo = {
    // Basic info
    id: obj.id,
    type: obj.type,
    name: obj.name,

    // Position and dimensions
    position: { x: obj.x, y: obj.y },
    size: { width: obj.width, height: obj.height },

    // Transform info
    transform: {
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      rotation: obj.rotation,
      alpha: obj.alpha
    },

    // Hierarchy and state
    zIndex: obj.zIndex,
    visible: obj.visible,

    // Timestamp
    createdTime: Date.now(),

    // Extra info
    ...extraInfo
  }
}

/**
 * Update debug info of PixiJS object
 * @param displayObject PixiJS display object
 * @param updates Fields to update
 */
export function updatePixiDebugInfo(
  displayObject: Container,
  updates: Record<string, unknown>
): void {
  const debugInfo = (displayObject as unknown as { debugInfo: Record<string, unknown> }).debugInfo
  if (debugInfo) {
    Object.assign(debugInfo, {
      ...updates,
      lastUpdated: Date.now()
    })
  }
}

/**
 * Log debug info of PixiJS object
 * @param displayObject PixiJS display object
 */
export function logPixiDebugInfo(displayObject: Container): void {
  const debugInfo = (displayObject as unknown as { debugInfo: unknown }).debugInfo
  if (debugInfo) {
    //console.log(`[PixiDebug] ${displayObject.name}:`, debugInfo)
  } else {
    console.warn('[PixiDebug] Object has no debug info:', displayObject)
  }
}

/**
 * Add debug info to child object (part, sprite, etc.)
 * @param displayObject PixiJS display object
 * @param name Child object name
 * @param info Debug info
 */
export function addChildDebugInfo(
  displayObject: Container,
  name: string,
  info: Record<string, unknown>
): void {
  displayObject.name = name
  ;(displayObject as unknown as { debugInfo: unknown }).debugInfo = {
    name,
    ...info,
    createdTime: Date.now()
  }
}
