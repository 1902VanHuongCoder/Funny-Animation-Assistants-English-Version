/**
 * Action Handler type definitions
 * v11.0: Removed legacy AnimPartState/animStates
 * v11.8x: Removed activeAnimations (dead write, never read)
 * Phase 4e: Removed objectStateTypes dependency, referencing raw types from sceneObject.ts
 */

import type {
    CompositeObject,
    SceneObjectBase,
    ScreenEffectParams
} from '@/types/sceneObject'
import type { Action } from '@/types/screenplay'

// Subtype writeable fields slice
type CompositeWriteable = Partial<Pick<CompositeObject, 'compositeMode' | 'childIds' | 'renderChain'>>

// Clip-Mask Phase 1: mask subtype writeable fields
interface MaskWriteable {
    /** mask.targetIds — set_mask Handler replaces entire segment (partial update semantics) */
    targetIds?: string[]
    /** mask.shape — set_mask Handler toggles */
    shape?: 'rectangle' | 'ellipse'
}

/**
 * v11.0 Unified writeable state interface
 *
 * Based on SceneObjectBase + subtype Pick combinations,
 * covers all fields that Handlers may write to.
 */
export interface WriteableState extends
    Omit<Partial<SceneObjectBase>, 'parentId'>,
    CompositeWriteable,
    MaskWriteable {
    // parentId requires explicit override: Handler may assign null (move out of composite),
    // whereas SceneObjectBase.parentId?: string does not include null
    parentId?: string | null
    // camera
    zoom?: number
    shakeOffsetX?: number
    shakeOffsetY?: number
    // Screen effect parameters (Handler directly operates on nested structure, eliminating flat state intermediate layer)
    params?: ScreenEffectParams
    // v16: Symbol current material ID
    currentMaterialId?: string
    // Light parameters (Handler operates directly, Point Light PRD Phase 0.5)
    lightColor?: string
    lightIntensity?: number
    lightRadius?: number
    // Phase 1: Flicker and directionality
    flicker?: number
    flickerSpeed?: number
    directionMode?: 'omni' | 'cone'
    directionAngle?: number
    coneAngle?: number
    // Text properties (Text PRD Phase 0 + Phase 1)
    content?: string
    fontSize?: number
    fontFamily?: string
    fontWeight?: 'normal' | 'bold'
    fontStyle?: 'normal' | 'italic'
    color?: string
    align?: 'left' | 'center' | 'right'
    wordWrap?: boolean
    wordWrapWidth?: number
    stroke?: string
    strokeThickness?: number
    dropShadow?: boolean
    dropShadowColor?: string
    dropShadowBlur?: number
    dropShadowAngle?: number
    dropShadowDistance?: number
    lineHeight?: number
    letterSpacing?: number
    textBoxMode?: 'auto-width' | 'auto-height' | 'auto-size' | 'fixed'
    writingMode?: 'horizontal' | 'vertical'
    // Phase 2: Typewriter effect
    revealInitialState?: 'complete' | 'typewriter'
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
    revealProgress?: number  // 0~1, runtime-driven reveal progress
}

/**
 * Action Handler context
 */
export interface ActionHandlerContext {
    /**
     * P2: Get current accumulated state of target object (used for SetParentHandler coordinate compensation)
     * In sceneStateCalculator, returns object matching ID from newState.objects
     * Optional: when omitted SetParentHandler skips coordinate compensation (backward compatibility)
     */
    getObjectState?: (targetId: string) => WriteableState | undefined
    /**
     * Current runtime object list. Handlers should treat parentId as the
     * authoritative relationship and use this list to derive children when
     * needed. Optional for backward compatibility with unit tests and previews.
     */
    objects?: WriteableState[]
}

/**
 * Action Handler interface
 */
export interface ActionHandler<T extends Action = Action> {
    /** Action type identifier */
    readonly type: T['type']

    /** Whether this is a point/instant action (takes effect immediately) */
    readonly isPointAction: boolean

    /** Whether this is a duration action (requires interpolation) */
    readonly isDurationAction: boolean

    /** Whether this affects object state (used for filtering in prepareBlocks etc.) — false for camera Actions */
    readonly affectsObjectState: boolean

    /**
     * Apply action to state (instant effect)
     * @param state Target state object
     * @param action Action
     * @param context Optional context (for SceneObject mode etc.)
     */
    applyToState(state: WriteableState, action: T, context?: ActionHandlerContext): void

    /**
     * Calculate interpolated state (duration action)
     * @param state Target state object
     * @param action Action
     * @param progress Progress (0-1)
     * @param startState Start state
     */
    interpolate?(
        state: WriteableState,
        action: T,
        progress: number,
        startState: WriteableState,
        context?: ActionHandlerContext
    ): void

    /**
     * Get target state after action completes
     * @param state Current state object
     * @param action Action
     */
    getTargetState?(state: WriteableState, action: T): void
}

/**
 * Action type enum (v11.0 updated)
 */
export type ActionType =
    | 'set_scene_structure'
    | 'set_transform'
    | 'set_visual'      // v9.3
    | 'set_lifecycle'   // v9.3
    | 'set_composite'   // P2
    | 'set_mask'        // Clip-Mask Phase 1

    | 'set_anim'        // v10.0 renamed (formerly trigger_anim), handled directly by ScenePlayer
    | 'set_audio'       // v10.0 renamed (formerly trigger_audio)
    | 'set_screen_effect' // Phase 1 addition: instantaneously sets screen effect parameters
    | 'set_light'          // Point light PRD Phase 0.5: instantaneously sets light parameters
    | 'set_material'    // v16: switches SymbolObject current material
    | 'set_text'        // Text PRD Phase 0: instantaneously sets text properties
    | 'set_text_reveal' // TextObject procedural reveal playback control
    | 'tween_transform'
    | 'tween_screen_effect' // Phase 1 addition: tweens screen effect parameters
    | 'tween_light'        // Point light PRD Phase 0.5: tweens light parameters
    | 'tween_text'         // Text PRD Phase 1: tweens text properties
    | 'camera_cut'
    | 'camera_move'
    | 'camera_shake'
    | 'camera_follow'
