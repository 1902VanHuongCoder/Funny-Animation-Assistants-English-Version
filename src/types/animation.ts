/**
 * Animation System Types (v11.0)
 * Reusable animation system type definitions for Funny Animation Assistant
 */

// ===== Base Types =====

/**
 * Track type enum
 */
export type AnimationTrackType = 'frame_sequence' | 'transform' | 'visibility' | 'effect'

/**
 * Easing function types
 */
export type EasingType =
    | 'linear'
    | 'step'  // v11.1: Step function, no interpolation, holds preceding frame value until next frame
    | 'easeIn' | 'easeOut' | 'easeInOut'
    | 'easeInQuad' | 'easeOutQuad' | 'easeInOutQuad'
    | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'
    | 'easeInSine' | 'easeOutSine' | 'easeInOutSine'
    | 'easeInElastic' | 'easeOutElastic' | 'easeInOutElastic'
    | 'easeInBounce' | 'easeOutBounce' | 'easeInOutBounce'

/**
 * Dynamic effect types (Phase 1: 5 types)
 */
export type DynamicEffectType = 'wave' | 'ribbon' | 'breathe' | 'float' | 'glow' | 'motion_blur' | 'jelly' | 'squash' | 'shake' | 'petrify' | 'shatter'

/**
 * Initial animation config item (v11.x)
 * Used in Setup mode to configure initial playback animation of scene objects
 */
export interface InitialAnimationItem {
    name: string      // Animation name (name of asset-level or scene-level Animation)
    loop: boolean     // Whether to loop playback
}

// ===== Keyframe Types =====

/**
 * Transform keyframe
 * All properties are deltas relative to baseline
 *
 * v13 (Scheme B) Split keyframe:
 * - Top-level fields (x/y/...) represent valueIn —— value seen when entering this keyframe from the left segment (segment end value)
 * - Optional `out` overrides valueOut —— starting value when continuing from this keyframe into the right segment
 * - When `out` is not set, valueIn === valueOut (continuous keyframe, fully equivalent to legacy data)
 * - `out` only needs to declare changed fields: non-overridden fields inherit top-level (fall-through)
 */
export interface TransformKeyframe {
    time: number              // Normalized time (0-1)
    x?: number                // X offset (pixels)
    y?: number                // Y offset (pixels)
    scaleX?: number           // X scale multiplier (1.0 = no change)
    scaleY?: number           // Y scale multiplier
    rotation?: number         // Rotation angle (radians)
    flipX?: boolean           // v11.1: Horizontal flip (discrete state, no interpolation)
    /** v13: Optional valueOut override; presence of any field treats this keyframe as having a jump on the timeline */
    out?: {
        x?: number
        y?: number
        scaleX?: number
        scaleY?: number
        rotation?: number
        flipX?: boolean
    }
}

/**
 * Visibility keyframe
 * v13 (Scheme B) Split: top-level = valueIn, `out` = valueOut override
 */
export interface VisibilityKeyframe {
    time: number              // Normalized time (0-1)
    alpha?: number            // Opacity (0-1)
    /** v13: Optional valueOut override */
    out?: {
        alpha?: number
    }
}

// ===== Track Target Constants =====

/**
 * Track target object ID sentinel for "self"
 * When targetObjectId === TARGET_SELF, transform applies to the animation's owning object itself
 */
export const TARGET_SELF = '_self' as const

// ===== Track Types =====

/**
 * Frame sequence track
 * Supports two modes:
 * 1. Reference mode: references animated material from legacy asset model via assetId
 * 2. Direct definition mode: defines frame sequence directly via frames
 */
export interface FrameSequenceTrack {
    trackType: 'frame_sequence'
    displayName?: string     // Track display name (editor presentation only; does not alter target object name)
    targetObjectId?: string   // Target object ID ('_self' = self, or descendant object ID)

    assetId?: string          // Referenced frame animation asset ID
    // === General settings (overrides asset default values) ===
    fps?: number              // Framerate; if omitted, uses asset definition or default 25
    loop?: boolean            // Whether to loop; if omitted, uses asset definition or default true
    // Duration is calculated automatically via frames.length / fps or frameCount / fps
}

/**
 * Transform track
 * Defines keyframes using keyframes (minimum 2 frames)
 */
export interface TransformTrack {
    trackType: 'transform'
    displayName?: string     // Track display name (editor presentation only; does not alter target object name)
    targetObjectId?: string   // Target object ID ('_self' = self, or descendant object ID)
    duration?: number | 'auto' // Animation duration (ms), default 1000; 'auto' = resolved automatically at runtime
    easing?: EasingType       // Easing function, default 'linear'
    keyframes: TransformKeyframe[]  // Keyframe list (minimum 2 frames)

    // Rotation/scale transform origin (optional, pixel values in object local space, same space as PIXI container.pivot)
    // When unset, indicates not overriding object default pivot (keeps current container.pivot unchanged, no position compensation).
    pivot?: {
        x: number   // Object local coordinate X (pixels)
        y: number   // Object local coordinate Y (pixels)
    }
}

/**
 * Visibility track
 * Defines keyframes using keyframes
 */
export interface VisibilityTrack {
    trackType: 'visibility'
    displayName?: string     // Track display name (editor presentation only; does not alter target object name)
    targetObjectId?: string   // Target object ID ('_self' = self, or descendant object ID)
    duration?: number | 'auto' // Animation duration (ms), default 1000; 'auto' = resolved automatically at runtime
    easing?: EasingType
    keyframes: VisibilityKeyframe[]
}

// ===== Effect Parameter Types =====

/**
 * Wave effect parameters (undulating wave)
 */
export interface WaveEffectParams {
    type: 'wave'
    speed?: number            // Wave speed, default 1.0
    amplitude?: number        // Wave amplitude, default 10
    frequency?: number        // Wave frequency, default 0.5
    direction?: 'horizontal' | 'vertical' | 'both'  // Wave direction, default 'horizontal'
}

/**
 * Ribbon effect parameters (flowing ribbon)
 */
export interface RibbonEffectParams {
    type: 'ribbon'
    speed?: number            // Speed (default 1.0)
    amplitude?: number        // Maximum amplitude (default 10)
    frequency?: number        // Frequency (default 0.5)
    direction?: 'horizontal' | 'vertical' | 'both'
    segments?: number         // Mesh segments (default 10)
    damping?: number          // Damping exponent (default 1.5)
    phaseScale?: number       // Phase accumulation (default 0.5)
}

/**
 * Breathe effect parameters (breathing scaling)
 */
export interface BreatheEffectParams {
    type: 'breathe'
    intensity?: number        // Breathing intensity (scale amplitude), default 0.02
    speed?: number            // Breathing speed, default 1.0
}

/**
 * Float effect parameters (floating hover)
 */
export interface FloatEffectParams {
    type: 'float'
    amplitude?: number        // Float amplitude (pixels), default 5
    speed?: number            // Float speed, default 1.0
}

/**
 * Glow effect parameters (glowing outline)
 */
export interface GlowEffectParams {
    type: 'glow'
    color?: string            // Glow color, default '#ffffff'
    intensity?: number        // Glow intensity, default 1.0
    size?: number             // Glow size (pixels), default 4
}

/**
 * MotionBlur effect parameters (motion blur)
 */
export interface MotionBlurEffectParams {
    type: 'motion_blur'
    velocity?: number         // Blur velocity, default 20
    angle?: number            // Blur angle (degrees), default 0 (horizontal)
    kernelSize?: number       // Kernel size, default 5
}

/**
 * Jelly effect parameters (jelly bounce)
 * v11.70: Added duration property to support custom decay duration
 */
export interface JellyEffectParams {
    type: 'jelly'
    stiffness?: number        // Stiffness, default 8
    damping?: number          // Damping, default 0.3
    intensity?: number        // Intensity, default 0.3
    duration?: number         // Effect duration (ms), default 1000
}

/**
 * Squash effect parameters (squash & stretch)
 * v11.70: Added duration property to support custom effect duration
 */
export interface SquashEffectParams {
    type: 'squash'
    intensity?: number        // Intensity, default 0.2
    speed?: number            // Speed, default 2
    duration?: number         // Effect duration (ms), default 1000
}

/**
 * Shake effect parameters (shake / nod)
 */
export interface ShakeEffectParams {
    type: 'shake'
    speed?: number            // Shake speed, default 5
    range?: number            // Shake range (degrees or pixels), default 10
    axis?: 'x' | 'y' | 'rotation'  // Shake axis, default rotation
}

/**
 * Petrify effect parameters (petrification)
 */
export interface PetrifyEffectParams {
    type: 'petrify'
    duration?: number         // Petrification process duration (ms), default 1000
    intensity?: number        // Final hardening degree (0-1), default 1.0
    grayScale?: boolean       // (Legacy) Whether to desaturate, default true
    seed?: number             // (New) Random seed for texture noise; generated randomly if omitted
}

/**
 * Shatter effect parameters (shattering)
 */
export interface ShatterEffectParams {
    type: 'shatter'
    pieceCount?: number       // Fragment density (1-10), default 5
    explodeForce?: number     // Explosion spread force, default 10.0
    duration?: number         // Total animation duration (ms), default 1500
}

/**
 * Effect parameters union type
 */
export type EffectParams =
    | WaveEffectParams
    | RibbonEffectParams
    | BreatheEffectParams
    | FloatEffectParams
    | GlowEffectParams
    | MotionBlurEffectParams
    | JellyEffectParams
    | SquashEffectParams
    | ShakeEffectParams
    | PetrifyEffectParams
    | ShatterEffectParams

/**
 * Effect track
 * Uses engine built-in algorithms, manual keyframes not required
 */
export interface EffectTrack {
    trackType: 'effect'
    displayName?: string     // Track display name (editor presentation only; does not alter target object name)
    targetObjectId?: string   // Target object ID ('_self' = self, or descendant object ID)
    effectParams: EffectParams
}

/**
 * Animation track union type
 */
export type AnimationTrack = FrameSequenceTrack | TransformTrack | VisibilityTrack | EffectTrack

// ===== Animation Definitions =====

export type AnimationTimingMode = 'continuous' | 'tts_speech'

/**
 * Animation definition base class: fields shared across all animation types
 */
export interface AnimationDefinitionBase {
    type: string              // Discriminator field ('track')
    id: string                // UUID
    name: string              // Semantic name (e.g. "speak", "idle")
    description?: string | undefined      // Description
    tags?: string[] | undefined           // Tag categories
    loop: boolean             // Whether to loop, default false
    timingMode?: AnimationTimingMode // Default playback mode, defaults to continuous
    origin?: 'auto' | 'user'  // 'auto' = frame animation auto-generated on object creation, 'user' = created manually by user

    // Metadata (required, auto-generated on creation)
    createdAt: number
    updatedAt: number
}

/**
 * Track animation (directly drives property changes)
 * Note: No global duration; duration is determined by individual tracks
 */
export interface TrackAnimationDefinition extends AnimationDefinitionBase {
    type: 'track'
    tracks: AnimationTrack[]
    duration?: number         // Optional explicit total duration (ms)
    /**
     * Fill behavior after animation ends
     * - 'none' (default): deltas reset to zero after stop, returning to baseline
     * - 'forwards': keeps final frame delta values after stop
     */
    fillMode?: 'none' | 'forwards'
}

/**
 * Animation definition type
 *
 * Legacy data compatibility: old AnimationDefinition without type field
 * should auto-inject type: 'track' during deserialization (see sceneLoader.ts migration logic).
 */
export type AnimationDefinition = TrackAnimationDefinition

/**
 * Input type when creating AnimationDefinition (omits auto-generated fields)
 */
export type AnimationDefinitionInput = Omit<TrackAnimationDefinition, 'id' | 'createdAt' | 'updatedAt'>



// ===== Runtime Types =====

/**
 * Animation play state
 */
export type AnimationPlayState = 'stopped' | 'playing' | 'paused' | 'filled'

/**
 * Animation play parameters
 */
export interface AnimationPlayParams {
    speed?: number            // Playback speed, default 1.0
    loop?: boolean            // Overrides default loop setting
    reset?: boolean           // Whether to start from beginning, default true
    // v11.52: Runtime frame count used by frame sequence track to calculate correct frame index
    // Provided by GenericAnimationPlayer from AnimatedSprite.textures.length
    runtimeFrameCount?: number
    // v12.x: Actual duration (ms) resolved from Auto Duration
    // Injected by playback engine when track duration === 'auto'
    runtimeDuration?: number
}

/**
 * Track output result (transform)
 */
export interface TransformTrackOutput {
    targetObjectId?: string | undefined
    x: number
    y: number
    scaleX: number
    scaleY: number
    rotation: number
    flipX?: boolean | undefined  // v11.1: Horizontal flip (discrete state)
    pivot: { x: number; y: number } | undefined
}

/**
 * Track output result (visibility)
 */
export interface VisibilityTrackOutput {
    targetObjectId?: string | undefined
    alpha: number
}

// v11.52: FrameSequenceTrackOutput removed
// Frame animation plays directly via AnimatedSprite.play()

/**
 * Track output result (effect)
 * v11.70: Added precomputed result fields for progress-driven mode
 */
export interface EffectTrackOutput {
    targetObjectId?: string | undefined
    effectType: DynamicEffectType
    effectParams: EffectParams
    active: boolean

    // v11.70: Precomputed result for progress-driven mode (jelly/squash and other damped effects)
    deltaScaleX?: number
    deltaScaleY?: number
    deltaX?: number
    deltaY?: number
    deltaRotation?: number
}

/**
 * Track output union type
 */
export type TrackOutput =
    | TransformTrackOutput
    | VisibilityTrackOutput
    | EffectTrackOutput

/**
 * Animation output state
 * Computed and output by AnimationPlayer
 * v11.52: frameSequences removed; frame animation plays directly via AnimatedSprite.play()
 */
export interface AnimationOutput {
    transforms: TransformTrackOutput[]
    visibilities: VisibilityTrackOutput[]
    effects: EffectTrackOutput[]
}

// ===== Helper Types =====

/**
 * Resource type (used for Animation management)
 */
export type AnimationResourceType = 'character' | 'prop' | 'background' | 'scene' | 'composite'

/**
 * Animation list item (used for UI display)
 */
export interface AnimationListItem {
    id: string
    name: string
    loop: boolean
    trackCount: number
    estimatedDuration: number  // Estimated duration (ms)
}
