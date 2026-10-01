/**
 * Canvas dimension constants
 * 
 * Unified definition of physical canvas dimensions and derived values for the scene editor.
 * All modules involving canvas dimensions should import constants from this file to avoid magic numbers.
 */

// ============================================================================
// Physical Canvas Dimensions
// ============================================================================

/** Canvas width (pixels) */
export const CANVAS_WIDTH = 6720

/** Canvas height (pixels) */
export const CANVAS_HEIGHT = 2800

// ============================================================================
// Canvas Center Point (Derived Constants)
// ============================================================================

/** Canvas center X coordinate */
export const CANVAS_CENTER_X = CANVAS_WIDTH / 2 // 3360

/** Canvas center Y coordinate */
export const CANVAS_CENTER_Y = CANVAS_HEIGHT / 2 // 1400

// ============================================================================
// Camera Base Viewport Dimensions (16:9)
// ============================================================================

/** Camera base viewport width */
export const CAMERA_BASE_WIDTH = 1456

/** Camera base viewport height */
export const CAMERA_BASE_HEIGHT = 819
