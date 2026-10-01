/**
 * Scene Object Z-Index Constants
 * Defines default z-index constants for scene objects
 * 
 * Layer order (from bottom to top):
 * -10: Background
 *  -5: Camera border
 *   0: Ghost object
 *  10: Normal objects (characters, props)
 * 100: Text
 */

// Background layer - bottom-most layer
export const Z_INDEX_BACKGROUND = -10

// Camera layer - slightly above background, below normal objects
export const Z_INDEX_CAMERA = -5

// Ghost layer - above background and camera, but below normal objects
export const Z_INDEX_GHOST = 0

// Normal object layer (characters, props)
export const Z_INDEX_DEFAULT = 10

// Text layer - higher priority
export const Z_INDEX_TEXT = 100

// Screen effect layer - above all normal scene objects (Phase 1)
export const Z_INDEX_SCREEN_EFFECT = 1000

// Camera overlay layer - used by "Show Camera" mode in Setup editor
export const Z_INDEX_CAMERA_OVERLAY = 10000

// Light indicator layer - same level as screen effects
export const Z_INDEX_LIGHT = 1000
export const Z_INDEX_LIGHT_OVERLAY = 10001
