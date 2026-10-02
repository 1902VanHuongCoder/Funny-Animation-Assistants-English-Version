/**
 * Coordinate transform utilities (v4.3)
 * 
 * The system adopts a dual coordinate system design, separating data storage from visual rendering:
 * 
 * 1️⃣ Canvas Coordinate System (Canvas Coordinates) - Data layer:
 *    - Definition: Scene object persistent storage coordinates, fixed and invariant
 *    - Origin: Canvas top-left corner is (0, 0)
 *    - Usage: Scene object x, y, width, height properties; data serialization; position calculation in script execution
 *    - Characteristics: Independent of viewport size, scale factor, or centering offsets, ensuring data stability and portability
 * 
 * 2️⃣ Viewport Coordinate System (Viewport Coordinates) - Rendering layer:
 *    - Definition: User-visible rendering coordinate system, dynamic and responsive
 *    - Origin: Viewport container (canvas-wrapper) top-left corner is (0, 0)
 *    - Usage: Screen positions of PixiJS rendered objects; mouse event coordinate capture; visual centering and scaling adaptation
 *    - Characteristics: Varies with viewport size, scale factor, and centering offset, ensuring adaptive visual display
 * 
 * Coordinate transformation formulas:
 *   Canvas -> Viewport: viewportX = canvasX * scale + offsetX
 *   Viewport -> Canvas: canvasX = (viewportX - offsetX) / scale
 */

export interface CoordinateTransformParams {
  scale: number    // Viewport scale factor (display ratio of canvas within viewport)
  offsetX: number  // Horizontal centering offset of canvas in viewport (pixels)
  offsetY: number  // Vertical centering offset of canvas in viewport (pixels)
}

/**
 * Viewport coordinates -> Canvas coordinates (handles mouse events)
 */
export function viewportToCanvas(
  viewportX: number,
  viewportY: number,
  params: CoordinateTransformParams
): { x: number; y: number } {
  return {
    x: (viewportX - params.offsetX) / params.scale,
    y: (viewportY - params.offsetY) / params.scale
  }
}

/**
 * Canvas coordinates -> Viewport coordinates (renders objects)
 */
export function canvasToViewport(
  canvasX: number,
  canvasY: number,
  params: CoordinateTransformParams
): { x: number; y: number } {
  return {
    x: canvasX * params.scale + params.offsetX,
    y: canvasY * params.scale + params.offsetY
  }
}

/**
 * Calculate transformation parameters
 * 
 * According to PRD specifications:
 * 1. Height scaling: Canvas height scales to match viewport height
 * 2. Width scaling: Maintaining canvas aspect ratio, width scales proportionally
 * 3. Centering alignment: Canvas center aligns with viewport center
 * 
 * @param canvasWidth Canvas width (pixels)
 * @param canvasHeight Canvas height (pixels)
 * @param viewportWidth Viewport width (pixels)
 * @param viewportHeight Viewport height (pixels)
 * @returns Coordinate transformation parameters
 */
export function calculateTransformParams(
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth: number,
  viewportHeight: number
): CoordinateTransformParams {
  // 1. Calculate scale factor based on height
  const scale = viewportHeight / canvasHeight
  
  // 2. Calculate scaled canvas dimensions
  const scaledCanvasWidth = canvasWidth * scale
  // const scaledCanvasHeight = viewportHeight  // Equal to viewport height (unused)
  
  // 3. Calculate horizontal centering offset
  const offsetX = (viewportWidth - scaledCanvasWidth) / 2
  const offsetY = 0  // Height is fully occupied, no offset needed
  
  return { scale, offsetX, offsetY }
}
