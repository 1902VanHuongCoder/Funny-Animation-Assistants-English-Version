/**
 * Screenplay editor type definitions
 * Corresponds to ScreenPlayEditor_PRD.md
 */

import type { AnimationTimingMode } from './animation'
import type { SceneObject } from './sceneObject'
export type { SceneObject }

export const SCENE_ACTION_TARGET = '_scene_' as const

// ==================== Scene State Snapshot ====================

/**
 * Camera state
 */
export interface CameraState {
  x: number
  y: number
  zoom: number
  transition?: 'cut' | 'fade' // Transition mode
}

/**
 * Actor state
 */
export interface ActorState {
  x: number
  y: number
  state: string // Character pose name, e.g. "stand_nervous"
  expression?: string // Expression name, e.g. "blush"
}



// ==================== Action System ====================

/**
 * Action type enum (v6.3 streamlined)
 * Point Actions: triggered at a specific timestamp, immediately alters state
 * Duration Actions: continuously interpolates changes over a duration
 * 
 * Design principles:
 * - set_transform: Controls transform properties (x, y, scale, rotation, alpha)
 * - tween_transform: Controls geometric property tweens (x, y, scaleX, scaleY, rotation)
 */
export type ActionType =
  // --- Point Actions ---
  | 'set_scene_structure'   // Scene-level parent-child hierarchy state patch
  | 'set_transform'   // Immediately change geometric properties (x/y/scale/rotation/alpha)
  | 'set_visual'      // Immediately change visual properties (visible/flipX/zIndex) added in v9.3
  | 'set_lifecycle'   // Control object spawn/despawn (spawned) added in v9.3
  | 'set_composite'   // P2: Modify composite object own properties (compositeMode/renderChain)
  | 'set_mask'        // Clip-Mask Phase 1: Modify mask object own properties (targetIds/shape)

  | 'set_anim'        // Set component animation state (v6.3 added, v10.0 renamed)
  | 'set_audio'       // Set audio playback state (v7.5 added, v10.0 renamed)
  | 'set_screen_effect' // Instantly set screen effect parameters (Phase 1 added)
  | 'set_light'        // Instantly set light parameters (Point light PRD Phase 0.5)
  | 'set_material'    // v16: Switch current material of SymbolObject
  | 'set_text'        // Instantly set text properties (Text PRD Phase 0)
  | 'set_text_reveal' // Text reveal / typewriter playback control
  | 'camera_cut'      // Camera cut (instant camera switch)
  // --- Duration Actions ---
  | 'tween_transform' // Tween transform (x/y/scale/rotation/alpha)
  | 'tween_screen_effect' // Tween screen effect parameters (Phase 1 added)
  | 'tween_light'      // Tween light parameters (Point light PRD Phase 0.5)
  | 'tween_text'       // Tween text properties (Text PRD Phase 1)
  | 'camera_move'     // Camera move (pan/tilt/zoom)
  | 'camera_shake'    // Camera shake
  | 'camera_follow'   // Camera follow (v6.5 added)

/**
 * Action category (v6.2)
 * point: Point action, triggered at Slot start
 * duration: Duration action, spans full Slot duration
 */
export type ActionCategory = 'point' | 'duration'

/**
 * Action base interface (v6.2)
 */
export interface BaseAction {
  id: string           // UUID
  target: string       // Target identifier (usually Actor Alias or Object ID)
  type: ActionType
  category: ActionCategory // Action category
  slotIndex: number    // Attached starting slot index
  order?: number        // Explicit execution order within same slot; legacy uses fallback sort when omitted
}

// ==================== Point Actions ====================

/**
 * Geometric transform parameters (redefined in v9.3)
 * Contains geometric transform and opacity
 * Coexists with tween_transform: set_transform sets initial state, tween_transform tweens from that state
 */
export interface SetTransformParams {
  // Geometric properties
  x?: number          // X coordinate
  y?: number          // Y coordinate
  scaleX?: number     // X scale
  scaleY?: number     // Y scale
  rotation?: number   // Rotation angle (radians)
  // Opacity (instant or animated)
  alpha?: number      // Opacity (0-1)
  // Transform origin override (pixel offset, overrides SceneObjectBase baseline value)
  transformOriginX?: number
  transformOriginY?: number
}

/**
 * Visual property parameters (added in v9.3)
 * Controls object display properties, coexists with all Actions
 */
export interface SetVisualParams {
  visible?: boolean   // Visibility
  flipX?: boolean     // Horizontal flip
  zIndex?: number     // Z-index layer
  receiveLighting?: boolean // Whether affected by global lighting
  castShadow?: boolean // Whether to cast foot shadow
}

/**
 * Lifecycle parameters (added in v9.3)
 * Controls spawn and despawn of dynamic objects
 */
export interface SetLifecycleParams {
  spawned: boolean    // true=spawn, false=despawn
  /**
   * Automatically despawn after block ends (effective for spawn Action only)
   * - true (default): At block end, if object not manually despawned, despawns automatically
   * - false: Object persists after block ends, inherited into subsequent blocks
   */
  autoDespawnOnBlockEnd?: boolean
}

export type SceneStructureOperation =
  | GroupSceneStructureOperation
  | UngroupSceneStructureOperation
  | ReparentSceneStructureOperation

export interface BaseSceneStructureOperation {
  id: string
  kind: 'group' | 'ungroup' | 'reparent'
}

export interface GroupSceneStructureOperation extends BaseSceneStructureOperation {
  kind: 'group'
  groupId: string
  memberIds: string[]
  parentId: string | null
  /**
   * Automatically dismantle structure after block ends (effective for grouping only).
   * - undefined / true: Automatically disable structure object and restore member parents at block end
   * - false: Structure object and member hierarchy inherited into subsequent blocks
   */
  autoRestoreOnBlockEnd?: boolean
}

export interface UngroupSceneStructureOperation extends BaseSceneStructureOperation {
  kind: 'ungroup'
  groupId: string
  memberIds: string[]
  groupParentId: string | null
  restoreParentId: string | null
}

export interface ReparentSceneStructureOperation extends BaseSceneStructureOperation {
  kind: 'reparent'
  objectIds: string[]
  parentId: string | null
}

export interface SetSceneStructureParams {
  operations: SceneStructureOperation[]
}

/**
 * Instant geometric transform action (redefined in v9.3)
 * Used to instantly change object position, scale, rotation, and opacity
 * Coexists with tween_transform: sets instant values first, then begins tween transition
 */
export interface SetTransformAction extends BaseAction {
  type: 'set_transform'
  category: 'point'
  params: SetTransformParams
}

/**
 * Visual properties action (added in v9.3)
 * Instantly changes object display properties, coexists with all Actions
 */
export interface SetVisualAction extends BaseAction {
  type: 'set_visual'
  category: 'point'
  params: SetVisualParams
}

/**
 * Lifecycle action (added in v9.3)
 * Controls spawn and despawn of dynamic objects
 * Icon: 🌱 (spawn) / 🍂 (despawn)
 */
export interface SetLifecycleAction extends BaseAction {
  type: 'set_lifecycle'
  category: 'point'
  params: SetLifecycleParams
}

export interface SetSceneStructureAction extends BaseAction {
  type: 'set_scene_structure'
  category: 'point'
  target: typeof SCENE_ACTION_TARGET
  params: SetSceneStructureParams
}

/**
 * P2: Params for modifying composite object properties
 * Follows the "field-group-in-one" pattern (like set_visual groups visible/flipX/zIndex)
 */
export interface SetCompositeParams {
  compositeMode?: 'entity' | 'union'
  renderChain?: string[]  // Internal entity render chain ordering
}

/**
 * P2: Modify composite object properties (compositeMode, childIds ordering, etc.)
 * Target = composite object ID
 */
export interface SetCompositeAction extends BaseAction {
  type: 'set_composite'
  category: 'point'
  params: SetCompositeParams
}

/**
 * Clip-Mask Phase 1: Params for modifying mask object properties
 *
 * Unified field family (like set_composite / set_visual): aggregates all mask-specific fields into one Action type.
 * Mode omitted (Phase 1 locked to inside_visible, not exposed in UI).
 * width/height belong to mask geometry definition; transform still handled via set_transform.
 */
export interface SetMaskParams {
  /** Replace mask.targetIds (partial update: unchanged if omitted) */
  targetIds?: string[]
  /** Mask shape switch */
  shape?: 'rectangle' | 'ellipse'
  /** Mask raw width (partial update: unchanged if omitted) */
  width?: number
  /** Mask raw height (partial update: unchanged if omitted) */
  height?: number
}

/**
 * Clip-Mask Phase 1: Modify mask object properties (targetIds / shape / width / height)
 * Target = mask object ID
 */
export interface SetMaskAction extends BaseAction {
  type: 'set_mask'
  category: 'point'
  params: SetMaskParams
}



/**
 * Camera cut action
 */
export interface CameraCutAction extends BaseAction {
  type: 'camera_cut'
  category: 'point'
  target: 'camera' // Fixed
  params: {
    x: number
    y: number
    zoom: number
  }
}

/**
 * Set animation playback state action (v11.0)
 * Uniformly controls all animation types (frame sequences, transforms, effects, etc.)
 * 
 * References AnimationDefinition in target object asset via animName
 * 
 * v11.88: Added autoStopOnBlockEnd property to control auto-stop at block end (per animation item)
 *         Removed legacy backward compatibility properties
 * v12.x:  Restored loop override capability, controlled independently per animation item
 */
export interface SetAnimAction extends BaseAction {
  type: 'set_anim'
  category: 'point'
  params: {
    /**
     * v11.88: Multi-animation control
     * - animName: References Animation defined in target object asset
     * - action: Control instruction, default 'play'
     * - autoStopOnBlockEnd: Whether to stop automatically when block ends
     * - loop: Overrides AnimationDefinition.loop (undefined = follows definition)
     * - timingMode: Overrides AnimationDefinition.timingMode (undefined = follows definition)
     */
    animations: {
      animName: string
      action?: 'play' | 'stop'
      /**
       * v11.88: Stop after current block
       * - true (default): Automatically stop this animation when block ends
       * - false: Animation continues into subsequent blocks until explicitly stopped
       */
      autoStopOnBlockEnd?: boolean
      /**
       * v12.x: Loop override (tri-state)
       * - undefined (default): Follows AnimationDefinition.loop
       * - true: Force loop
       * - false: Force non-loop
       */
      loop?: boolean
      /**
       * v21: Playback mode override (tri-state)
       * - undefined (default): Follows AnimationDefinition.timingMode
       * - continuous: Continuous playback after action triggers
       * - tts_speech: Play only during TTS voiced segments
       */
      timingMode?: AnimationTimingMode
    }[]

    /**
     * Optional: playback parameters (applied to all animations)
     */
    reset?: boolean       // Whether to start from beginning on play, default true
  }
}

/**
 * Set audio playback state action (v7.5, renamed in v10.0)
 */
export interface SetAudioAction extends BaseAction {
  type: 'set_audio'
  category: 'point'
  params: {
    action: 'play' | 'stop' | 'pause' | 'resume'
    volume?: number
    loop?: boolean
    fadeIn?: number
    fadeOut?: number
  }
}

/**
 * Screen effect parameters (Phase 1 added)
 * Used for set_screen_effect and tween_screen_effect actions
 */
export interface SetScreenEffectParams {
  // Overlay opacity uniformly controlled by SceneObject.alpha, coverOpacity no longer used
  baseColor?: string          // Overlay color
  holeShape?: 'circle' | 'horizontal_ellipse' | 'vertical_ellipse' | 'rectangle'
  holeCenterX?: number
  holeCenterY?: number
  holeWidth?: number
  holeHeight?: number
  openRatio?: number          // Open/close ratio 0~1
  feather?: number            // Feather radius
  targetId?: string           // Follow target ID
  offsetX?: number
  offsetY?: number
}

/**
 * Instantly set screen effect parameters (Phase 1 added)
 */
export interface SetScreenEffectAction extends BaseAction {
  type: 'set_screen_effect'
  category: 'point'
  params: SetScreenEffectParams
}

/**
 * v16: Switch symbol material parameters
 */
export interface SetMaterialParams {
  materialId: string  // Target material ID
}

/**
 * v16: Switch symbol material action
 * Target must be a SymbolObject
 */
export interface SetMaterialAction extends BaseAction {
  type: 'set_material'
  category: 'point'
  params: SetMaterialParams
}

/**
 * Text property parameters (Text PRD Phase 0 + Phase 1)
 * Used for set_text action
 */
export interface SetTextParams {
  content?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
  color?: string
  align?: 'left' | 'center' | 'right'
  wordWrap?: boolean
  wordWrapWidth?: number
  // Phase 1: Visual enhancement
  stroke?: string
  strokeThickness?: number
  letterSpacing?: number
  lineHeight?: number
  textBoxMode?: 'auto-width' | 'auto-height' | 'auto-size' | 'fixed'
  writingMode?: 'horizontal' | 'vertical'
  dropShadow?: boolean
  dropShadowColor?: string
  dropShadowBlur?: number
  dropShadowAngle?: number
  dropShadowDistance?: number
  // Phase 2: Animation
  revealSpeed?: number
  fillType?: 'linear_gradient'
  gradientStops?: { offset: number; color: string }[]
  gradientAngle?: number
  textBackgroundEnabled?: boolean
  textBackgroundColor?: string
  textBackgroundAlpha?: number
  textBackgroundPaddingX?: number
  textBackgroundPaddingY?: number
  textBackgroundRadius?: number
}

/**
 * Instantly set text properties (Text PRD Phase 0)
 */
export interface SetTextAction extends BaseAction {
  type: 'set_text'
  category: 'point'
  params: SetTextParams
}

/**
 * Text reveal action
 * Used to trigger programmatic reveal effects on TextObject, e.g. typewriter.
 */
export interface SetTextRevealAction extends BaseAction {
  type: 'set_text_reveal'
  category: 'point'
  params: {
    action: 'play' | 'stop'
    mode?: 'typewriter'
  }
}

/**
 * Text tween parameters (Text PRD Phase 1)
 * Subset of interpolatable text properties
 */
export interface TweenTextParams {
  color?: string
  fontSize?: number
  letterSpacing?: number
  strokeThickness?: number
}

/**
 * Tween text properties action (Text PRD Phase 1)
 * Smoothly transitions text color/font size/letter spacing/stroke thickness
 */
export interface TweenTextAction extends BaseDurationAction {
  type: 'tween_text'
  params: TweenTextParams
}

/**
 * Light parameters (Point light PRD Phase 0.5)
 * Used for set_light and tween_light actions
 * Ambient and point lights share same interface, ignoring inapplicable fields at runtime based on lightType
 */
export interface SetLightParams {
  lightColor?: string       // Light color (hex), valid for ambient + point
  lightIntensity?: number   // Light intensity 0~2, valid for ambient + point
  lightRadius?: number      // Light radius (pixels), point only
  // Phase 1: Flicker and directionality
  flicker?: number          // Flicker intensity 0~1
  flickerSpeed?: number     // Flicker speed 0~1
  directionMode?: 'omni' | 'cone'  // Emission mode
  directionAngle?: number   // Direction angle (radians)
  coneAngle?: number        // Cone angle (degrees)
}

/**
 * Instantly set light parameters (Point light PRD Phase 0.5)
 */
export interface SetLightAction extends BaseAction {
  type: 'set_light'
  category: 'point'
  params: SetLightParams
}

// ==================== Duration Actions ====================

/**
 * Duration action base interface (v6.2)
 */
export interface BaseDurationAction extends BaseAction {
  category: 'duration'
  slotSpan: number     // Slot span, default 1, >1 indicates multi-slot action
  easing?: string      // Easing function name, e.g. 'linear', 'easeInOutQuad'
}

/**
 * Tween transform parameters (updated in v9.3)
 * Contains geometric transform and opacity for tween animations
 * Coexists with set_transform: set_transform sets initial state, tween_transform tweens towards target
 */
export interface TweenTransformParams {
  x?: number
  y?: number
  scaleX?: number
  scaleY?: number
  rotation?: number
  alpha?: number      // v9.3: Opacity animation transition (0-1)
}

/**
 * Tween transform action (v6.3)
 * Controls geometric property tweens of object
 */
export interface TweenTransformAction extends BaseDurationAction {
  type: 'tween_transform'
  params: TweenTransformParams
}

/**
 * Tween screen effect parameters action (Phase 1 added)
 * Controls smooth transition of effect parameters (e.g. openRatio, feather, etc.)
 */
export interface TweenScreenEffectAction extends BaseDurationAction {
  type: 'tween_screen_effect'
  params: SetScreenEffectParams
}

/**
 * Tween light parameters action (Point light PRD Phase 0.5)
 * Controls smooth transition of light color/intensity/radius
 */
export interface TweenLightAction extends BaseDurationAction {
  type: 'tween_light'
  params: SetLightParams
}

/**
 * Camera move action
 */
export interface CameraMoveAction extends BaseDurationAction {
  type: 'camera_move'
  target: 'camera'
  params: {
    x?: number
    y?: number
    zoom?: number
  }
}

/**
 * Camera shake action
 */
export interface CameraShakeAction extends BaseDurationAction {
  type: 'camera_shake'
  target: 'camera'
  params: {
    intensity: number // Shake intensity (pixels)
    decay: boolean    // Whether to decay over time
    frequency: number // Shake frequency (Hz)
  }
}

/**
 * Camera follow action (v6.5 added)
 * Locks camera center onto specified object
 */
export interface CameraFollowAction extends BaseDurationAction {
  type: 'camera_follow'
  target: 'camera'
  params: {
    followTarget: string  // Follow target (actor alias or object id)
    damping?: number      // Damping coefficient (0=rigid lock, >0=smooth follow), default 0
    offsetX?: number      // X offset, default 0
    offsetY?: number      // Y offset, default -50 (character slightly lower)
    zoom?: number         // Zoom level, maintains current zoom when omitted
    smoothEntry?: boolean      // v15: Smooth entry (default false), slides from current position to target
    smoothEntryDuration?: number // v15: Smooth entry duration (ms), default 300
    autoZoom?: boolean         // v15: Auto push-pull (default false), sine wave zoom oscillation
    autoZoomRange?: number     // v15: Push-pull range (% of base zoom), default 5
    autoZoomCycles?: number    // v15: Push-pull cycles (full cycles), default 0.5
    constrainBounds?: boolean  // v6.9: Boundary constraint, restricts camera within canvas bounds
  }
}

// ==================== Action Union Types ====================

/**
 * Union of all action types (updated in v9.3)
 */
export type Action =
  | SetSceneStructureAction
  | SetTransformAction
  | SetVisualAction      // Added in v9.3
  | SetLifecycleAction   // Added in v9.3
  | SetCompositeAction   // P2
  | SetMaskAction        // Clip-Mask Phase 1

  | SetAnimAction
  | SetAudioAction
  | SetScreenEffectAction  // Phase 1 added
  | SetLightAction         // Point light PRD Phase 0.5
  | SetMaterialAction      // Added in v16
  | SetTextAction          // Text PRD Phase 0
  | SetTextRevealAction
  | CameraCutAction
  | TweenTransformAction
  | TweenScreenEffectAction // Phase 1 added
  | TweenLightAction       // Point light PRD Phase 0.5
  | TweenTextAction        // Text PRD Phase 1
  | CameraMoveAction
  | CameraShakeAction
  | CameraFollowAction

/**
 * Point action types (for type guards) (updated in v9.3)
 */
export type PointAction =
  | SetSceneStructureAction
  | SetTransformAction
  | SetVisualAction      // Added in v9.3
  | SetLifecycleAction   // Added in v9.3
  | SetCompositeAction   // P2
  | SetMaskAction        // Clip-Mask Phase 1

  | SetAnimAction
  | SetAudioAction
  | SetScreenEffectAction  // Phase 1 added
  | SetLightAction         // Point light PRD Phase 0.5
  | SetMaterialAction      // Added in v16
  | SetTextAction          // Text PRD Phase 0
  | SetTextRevealAction
  | CameraCutAction

/**
 * Duration action types (for type guards)
 */
export type DurationAction =
  | TweenTransformAction
  | TweenScreenEffectAction // Phase 1 added
  | TweenLightAction       // Point light PRD Phase 0.5
  | TweenTextAction        // Text PRD Phase 1
  | CameraMoveAction
  | CameraShakeAction
  | CameraFollowAction

// ==================== Scene Container System (v5.0) ====================

/**
 * Scene container Setup data
 */
export interface SceneSetup {
  camera: {
    x: number
    y: number
    width: number
    height: number
    zoom: number
  }
  objects: SceneObject[]
  /** Root-level render chain (ordered ID list). Union composites omitted, children flattened. */
  renderChain: string[]
}

/**
 * Runtime camera state
 * Promoted from actionEvaluator.ts to types layer for unified definition
 */
export interface RuntimeCameraState {
  x: number
  y: number
  zoom: number
  shakeOffsetX: number
  shakeOffsetY: number
}

/**
 * Scene runtime snapshot (Runtime working copy)
 * Deep copied from SceneSetup and produced via Action chain evaluation.
 *
 * Three consumers each hold independent instances:
 * - Editor: sceneObjectStore.runtimeState (ref, reactive, Slot granularity)
 * - ScenePlayer: runtimeSnapshot (local variable, time granularity)
 * - FrameCapture: this.runtimeSnapshot (class member, time granularity)
 *
 * Lifecycle:
 * - Created: entering Action Mode / starting playback / starting export
 * - Updated: recomputed by applyBlockActionsToState on each Block switch
 * - Destroyed: discarded after exiting Action Mode / ending playback / ending export
 */
export interface RuntimeSceneSnapshot {
  /** runtime object list (state after Action evaluation) */
  objects: SceneObject[]
  /** runtime render chain (after reconcileRenderChain coordination) */
  renderChain: string[]
  /** runtime camera state */
  camera: RuntimeCameraState
}

/**
 * Create RuntimeSceneSnapshot from SceneSetup
 * The sole creation entry point in Runtime layer
 */
export function createRuntimeSnapshot(setup: SceneSetup): RuntimeSceneSnapshot {
  const cloned = JSON.parse(JSON.stringify(setup)) as SceneSetup
  return {
    objects: cloned.objects,
    renderChain: cloned.renderChain,
    camera: {
      x: cloned.camera.x,
      y: cloned.camera.y,
      zoom: cloned.camera.zoom,
      shakeOffsetX: 0,
      shakeOffsetY: 0,
    },
  }
}

/**
 * Playback information for a single Block
 * Precomputed by prepareBlockPlayInfos, shared across three consumers.
 */
export interface BlockPlayInfo {
  /** Scene runtime snapshot at start of Block */
  startSnapshot: RuntimeSceneSnapshot
  block: ScriptBlock
  startTime: number
  endTime: number
  duration: number
  slots: RuntimeSlot[]
  blockActions: Action[]
  audioUrl?: string
}

/**
 * Scene container
 */
export interface SceneContainer {
  id: string
  type: 'scene_container'
  title: string
  setup: SceneSetup
  script: ScriptBlock[] // DialogueBlock | NarrationBlock
}

// ==================== Script Block System ====================

/**
 * Script block types
 */
export type ScriptBlockType = 'dialogue' | 'narration' | 'action'

/**
 * Script block base interface
 */
export interface BaseScriptBlock {
  id: string // Unique identifier
  type: ScriptBlockType
}

/**
 * TTS configuration interface
 * Used for DialogueBlock and NarrationBlock
 * v12.8: audio changed to audioPath, TTS audio externalized to file system
 */
export interface TTSConfig {
  duration?: number // TTS estimated duration (ms)
  audioPath?: string // v12.8: Relative path to TTS audio file (e.g. "project_cache/tts/{hash}.mp3")
  timingAudioPath?: string // Original audio path retained after export preload, used to read TTS timing sidecar
  voiceId?: number // Used voice ID
  // Generation snapshot info, used to detect content changes
  generatedFrom?: {
    instanceId?: string // v7.0: Instance ID at generation (dialogue only)
    text: string // Text content at generation
    voiceId: number // Voice ID at generation
    speed: number // Speech speed at generation
    volume?: number // Volume at generation
  }
}


/**
 * Dialogue block
 * v7.0: actorAlias changed to instanceId, using character instance ID in scene
 */
export interface DialogueBlock extends BaseScriptBlock {
  type: 'dialogue'
  instanceId: string // v7.0: Character instance ID (SceneObject.id)
  text: string // Dialogue text
  state?: string // Character pose (pose key)
  expression?: string // Expression ID
  speed?: number // Speech speed multiplier, default 1.0
  ttsConfig?: TTSConfig
  actions: Action[] // Mounted action list
}

/**
 * Narration block
 */
export interface NarrationBlock extends BaseScriptBlock {
  type: 'narration'
  text: string // Narration text
  speed?: number // Speech speed multiplier, default 1.0
  ttsConfig?: TTSConfig
  actions: Action[] // Mounted action list
}

/**
 * Performance block (added in v11.1)
 * Pure action presentation, contains no text
 */
export interface ActionBlock extends BaseScriptBlock {
  type: 'action'
  duration: number
  actions: Action[]
}

/**
 * Union script block type
 */
export type ScriptBlock = DialogueBlock | NarrationBlock | ActionBlock



// ==================== Actor Configuration ====================

/**
 * Actor configuration
 * v7.0: Added id field, removed alias (alias moved to SceneObject)
 */
export interface ActorConfig {
  id: string // v7.0: Unique stable ID
  characterId: string // Character asset ID
  name: string // Display name, e.g. "Xiao Ming", "A Qiang"
  alias?: string // Alias in screenplay
  voice?: {
    // TTS config
    voiceId?: string
    speed?: number // Speech speed multiplier (0.5 - 2.0)
    volume?: number // Volume (-10 - 10)
  }
}

/**
 * Narrator configuration
 */
export interface NarratorConfig {
  voice?: {
    voiceId?: string
    speed?: number // Speech speed multiplier (0.5 - 2.0)
    volume?: number // Volume (-10 - 10)
  }
}



// ==================== Slot System (v6.2) ====================

/**
 * Slot type (added in v6.10)
 * - preroll: Period between Block start and first subtitle start
 * - subtitle: Period corresponding to subtitle
 * - postroll: Period between last subtitle end and Block end
 */
export type SlotType = 'preroll' | 'subtitle' | 'postroll'

/**
 * Runtime slot structure (updated in v6.10)
 * Slots are temporary runtime containers in the editor, generated dynamically from TTS data
 * Not stored directly in database
 * 
 * v6.10: Added type field to distinguish preroll/subtitle/postroll
 * v6.10: Added isEstimated field to indicate whether timing is estimated
 */
export interface RuntimeSlot {
  type: SlotType         // Slot type (added in v6.10)
  index: number          // Slot index (0, 1, 2...)
  text?: string          // Text content for sentence (empty for preroll/postroll)
  startTime: number      // Absolute time relative to Block start (ms)
  duration: number       // TTS duration for sentence (ms)
  isEstimated?: boolean  // Whether timing is estimated (added in v6.10, true when no TTS data)

  // UI state flags
  isMerged?: boolean     // Whether this is a merged slot
  parentIndex?: number   // If merged, points to primary slot index
  spanCount?: number     // If primary slot, indicates number of raw slots spanned
}

/**
 * Display slot (slot after processing merge logic)
 */
export interface DisplaySlot extends RuntimeSlot {
  spanCount: number      // Number of raw slots spanned, default 1
}

// ==================== Soundtrack Management (v7.5) ====================

/**
 * BGM track definition
 * Used for cross-scene background music management
 */
export interface BGMTrack {
  id: string             // Unique identifier
  assetId: string        // Associated audio asset ID (projectStore.assets)

  // Start position
  start: {
    sceneId: string
    blockId: string | null // null indicates scene start
  }

  // End position
  end: {
    sceneId: string
    blockId: string | null // null indicates scene end
  }

  volume: number         // 0.0 ~ 1.0
  loop: boolean          // Whether to loop

  // Reserved fields
  fadeIn?: number        // Fade-in duration (seconds)
  fadeOut?: number       // Fade-out duration (seconds)
}
