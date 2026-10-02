// Scene object type definitions
// Extracted from src/stores/sceneObjectStore.ts to resolve circular dependencies

// Scene object types
export type SceneObjectType = 'background' | 'audio' | 'prop' | 'text' | 'camera' | 'light' | 'screen_effect' | 'composite' | 'symbol' | 'expression' | 'mask'

// Scene object base interface (base class)
// All subtypes extend this base interface
export interface SceneObjectBase {
  // Basic identifiers
  id: string
  type: SceneObjectType
  name: string             // Display name
  alias?: string           // v7.1: In-scene alias, required for all objects except camera
  refId: string            // Unified reference field pointing to Asset ID (types with no asset ref assign '')

  // Position and dimensions (canvas coordinate system)
  x: number               // X coordinate
  y: number               // Y coordinate
  width: number           // Width
  height: number          // Height

  // Transform properties
  scaleX: number          // X-axis scale (default 1.0)
  scaleY: number          // Y-axis scale (default 1.0)
  rotation: number        // Rotation angle (radians)
  alpha: number           // Opacity (0-1)
  flipX: boolean          // Whether horizontally flipped (default false)

  // Transform origin (pixel offset relative to PivotBase, default 0 = rotate around PivotBase)
  transformOriginX?: number   // Pixel offset, 0 = no offset
  transformOriginY?: number   // Pixel offset, 0 = no offset

  // Hierarchy and status
  zIndex: number          // Render layer index
  visible: boolean        // Whether visible

  // Lighting behavior
  receiveLighting?: boolean  // Whether affected by global lighting, default true (undefined = true)
  castShadow?: boolean       // Whether to cast foot shadow, default false (undefined = false)

  // v9.3: Lifecycle status
  spawned?: boolean       // Whether spawned (false in Setup for dynamic objects)

  // P2: Composite object ownership
  parentId?: string       // Parent composite object ID (undefined when no parent)

  // Initial animations (shared across actors/backgrounds/props, kept in base class)
  initialAnimations?: InitialAnimationItem[]

  // v13.x: Animation definitions (carried by object itself, saved/instantiated with template)
  animations?: Record<string, AnimationDefinition>

  // v20: Additional info — identifies source identity and associated metadata
  extraInfo?: CompositeExtraInfo
}

/** Composite object additional info (discriminated union) */
export type CompositeExtraInfo =
  | { kind: 'actor'; actorId: string }
  | { kind: 'character'; characterId: string }
  | { kind: 'template'; templateId: string }

import type { AnimationDefinition, InitialAnimationItem } from './animation'

// Background object
export interface BackgroundObject extends SceneObjectBase {
  type: 'background'
  refId: string        // Unified reference field -> Background.id
}

// Audio object (unified BGM/SFX)
export interface AudioObject extends SceneObjectBase {
  type: 'audio'
  refId: string        // SoundAsset ID

  // Properties (supports inheriting default values from SoundAsset, but overrides stored here)
  volume: number       // 0-1
  loop: boolean
  fadeIn: number       // Seconds
  fadeOut: number      // Seconds
  playbackState: 'play' | 'stop' // Default playback state
}

// Prop object
// v11.0: Removed legacy animState, animation managed via AnimationPlayer
export interface PropObject extends SceneObjectBase {
  type: 'prop'
  refId: string        // Unified reference field -> PropAsset.id
}

// Text object
export interface TextObject extends SceneObjectBase {
  type: 'text'
  content: string
  fontSize: number
  fontFamily: string
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  color: string
  align: 'left' | 'center' | 'right'
  wordWrap: boolean
  wordWrapWidth: number

  // === Phase 1: Visual enhancement ===
  stroke?: string                   // Stroke color (hex), undefined = no stroke
  strokeThickness?: number          // Stroke thickness (px), default 0
  dropShadow?: boolean              // Drop shadow toggle, default false
  dropShadowColor?: string          // Shadow color, default '#000000'
  dropShadowBlur?: number           // Shadow blur, default 4
  dropShadowAngle?: number          // Shadow angle (radians), default Math.PI/4
  dropShadowDistance?: number       // Shadow distance, default 4
  lineHeight?: number               // Line height (px), undefined = auto
  letterSpacing?: number            // Letter spacing (px), default 0
  textBoxMode?: 'auto-width' | 'auto-height' | 'auto-size' | 'fixed'  // Default 'auto-size'
  writingMode?: 'horizontal' | 'vertical'  // Default 'horizontal'

  // === Phase 2: Animation ===
  revealInitialState?: 'complete' | 'typewriter' // Default display mode: complete = full text, typewriter = typewriter reveal
  revealSpeed?: number                 // Speed (chars/sec), default 8
  fillType?: 'linear_gradient'          // Text gradient toggle (undefined = use solid color)
  gradientStops?: { offset: number; color: string }[]  // Gradient color stops
  gradientAngle?: number               // Gradient angle (degrees)
  textBackgroundEnabled?: boolean      // Text background fill toggle
  textBackgroundColor?: string         // Text background color
  textBackgroundAlpha?: number         // Text background opacity 0~1
  textBackgroundPaddingX?: number      // Text background horizontal padding
  textBackgroundPaddingY?: number      // Text background vertical padding
  textBackgroundRadius?: number        // Text background corner radius
}

// Camera object
export interface CameraObject extends SceneObjectBase {
  type: 'camera'
  zoom: number  // Zoom level, 1.0 = normal
}

// Light object — ambient light and point light
// ambient: Scene-unique, auto-created, non-deletable (same model as Camera)
// point: Multiple allowed, carries position/radius, top 8 by intensity selected at render time
export interface LightObject extends SceneObjectBase {
  type: 'light'
  /** Light type */
  lightType: 'ambient' | 'point' | 'spot'
  /** Light color (hex) */
  lightColor: string
  /** Light intensity 0~2 */
  lightIntensity: number
  /** Light radius (pixels), effective for point only */
  lightRadius: number

  // === Phase 1: Dynamic parameters ===
  /** Flicker intensity 0~1, 0 = no flicker */
  flicker?: number
  /** Flicker speed 0~1 */
  flickerSpeed?: number
  /** Emission mode: default omni; cone enables directional lighting */
  directionMode?: 'omni' | 'cone'
  /** Direction angle (radians), effective only when directionMode=cone */
  directionAngle?: number
  /** Sector opening angle (degrees, 10~360), default 100, effective only when directionMode=cone */
  coneAngle?: number
}

// Screen effect parameters (Phase 1: overlay + hole + follow)
export interface ScreenEffectParams {
  // --- Overlay general parameters ---
  baseColor?: string          // Overlay color, default '#000000'
  // Overlay opacity uniformly controlled by SceneObjectBase.alpha, coverOpacity no longer used

  // --- Hole parameters ---
  holeShape?: 'circle' | 'horizontal_ellipse' | 'vertical_ellipse' | 'rectangle'
  holeCenterX?: number        // Hole center X
  holeCenterY?: number        // Hole center Y
  holeWidth?: number          // Hole width
  holeHeight?: number         // Hole height
  openRatio?: number          // Open/close ratio 0~1
  feather?: number            // Edge feathering radius (px)

  // --- Follow parameters ---
  targetId?: string           // Bound follow target object ID
  offsetX?: number            // Follow offset X
  offsetY?: number            // Follow offset Y

  // --- Lighting mode parameters ---
  /** Lighting mode: additive = additive glow (ADD), soft = soft illumination (SCREEN) */
  lightMode?: 'additive' | 'soft'
  /** Light spot color, default '#ffffff' */
  lightColor?: string
  /** Falloff curve, default 'smooth' */
  lightFalloff?: 'linear' | 'quadratic' | 'smooth'
}

// Screen effect object
export interface ScreenEffectObject extends SceneObjectBase {
  type: 'screen_effect'
  effectClass: string         // Effect class identifier, e.g. 'spotlight', 'fullscreen_cover'
  customName?: string         // Name displayed on track, e.g. "Blackout_1"
  params: ScreenEffectParams
}

// Screen effect preset (used for Picker dialog selection result)
export interface ScreenEffectPreset {
  effectClass: string
  name: string
  params: ScreenEffectParams
  defaultAlpha?: number  // Overlay opacity, set to SceneObjectBase.alpha by caller
}

// P2: Composite object
export interface CompositeObject extends SceneObjectBase {
  type: 'composite'
  childIds: string[]      // Child object ID list (flat storage, maintained via bidirectional references)
  compositeLocked: boolean  // Lock mode: true = clicking child selects parent composite, false = children independently operable
  compositeMode: 'entity' | 'union'  // entity = entity mode (cascading delete), union = union mode (child bubbling)
  /** Entity only: internal render chain (ordered ID list). Nested unions do not appear; their children are flattened. */
  renderChain?: string[]

  /** Scene instance-level rootComposite ID (remapped from CompositeCharacter.rootCompositeId by idMap during character import) */
  instanceRootCompositeId?: string
}

// v16: Symbol material
export interface SymbolMaterial {
  id: string
  name: string
  type: 'static' | 'animation'
  /** Static image URL / Animation still frame URL (main image when type === 'static', still frame when type === 'animation') */
  url?: string
  /** Frame sequence (used when type === 'animation') */
  frames?: { url: string }[]
  /** Framerate (used when type === 'animation') */
  fps?: number
  /** Whether to loop playback */
  loop?: boolean
  /** Still frame source: 'frame' = select from sequence frames, 'custom' = custom uploaded image */
  stillFrameSource?: 'frame' | 'custom'
  /** Frame index used when stillFrameSource === 'frame' */
  stillFrameIndex?: number
}

// v16: Symbol object — bridges the gap between props (single asset) and actors (multiple parts)
// Materials reside directly on object (self-contained), independent of external asset Stores
export interface SymbolObject extends SceneObjectBase {
  type: 'symbol'
  /** Material list */
  materials: SymbolMaterial[]
  /** Currently displayed material ID */
  currentMaterialId?: string
}

// v18: Independent expression object — references expression resource in expressionStore
// refId is mutable, supporting runtime switching across different expressions (similar to SymbolObject.currentMaterialId)
export interface ExpressionObject extends SceneObjectBase {
  type: 'expression'
  refId: string  // -> Expression.id (expressionStore), mutable
  defaultRefId?: string  // -> Default expression ID (auto-set at creation, used to restore default)
}

// Clip-Mask Phase 1: Mask object — Independent SceneObject, acts as clipping source to clip target objects in targetIds list
// See docs/features/clip-mask.md (v2.1)
export type MaskShape = 'rectangle' | 'ellipse'
/** Phase 1 only supports inside_visible (visible inside shape, hidden outside).
 *  outer / outside_visible modes introduced in Phase 2 will extend this union type. */
export type MaskMode = 'inside_visible'

export interface MaskObject extends SceneObjectBase {
  type: 'mask'
  refId: ''                 // mask does not reference any Asset, fixed empty string to satisfy base class constraint
  /** Shape type; geometry provided by SceneObjectBase width/height/rotation/scale, etc. */
  shape: MaskShape
  /** Clipping mode (Phase 1 locked to 'inside_visible') */
  mode: MaskMode
  /** List of target object IDs clipped by this mask; Phase 1 single mask exclusive — same ID can only appear in one mask's targetIds at a time. */
  targetIds: string[]
}

// SceneObject = Base class (polymorphic reference; consumers access subtype fields via `as SubType` inside type check branches)
export type SceneObject = SceneObjectBase

/**
 * Parameter type for updateObject (generic version).
 *
 * - `SceneObjectUpdateFor<SceneObject>` — Base class property update
 * - `SceneObjectUpdateFor<CompositeObject>` — Subtype fields including compositeLocked/compositeMode, etc.
 *
 * Each property explicitly permits `undefined`, with semantics = **delete this property** (bypasses exactOptionalPropertyTypes constraint).
 */
export type SceneObjectUpdateFor<T extends SceneObject = SceneObject> = {
  [K in keyof T]?: T[K] | undefined
}

/** Base class property update (shorthand for most common usage) */
export type SceneObjectUpdate = SceneObjectUpdateFor<SceneObject>
