/**
 * Funny Animation Assistant Project JSON Schema
 * Based on PRD v2.4
 */

import type { AnimationDefinition } from './animation'
import type { CompositeCharacter } from './compositeCharacter'
import type { PresetAnimationTemplate } from './presetAnimation'
import type { SceneTemplate } from './sceneTemplate'
import type { ActorConfig, NarratorConfig } from './screenplay'

// ===== Metadata =====
export interface ProjectMeta {
  name: string
  resolution: { w: number; h: number }
  fps: number
  version: string
}

// ===== Actor Definitions =====
// Uses ActorConfig and NarratorConfig from screenplay.ts


// ===== Asset Definitions =====

/**
 * Gender
 */
export type Gender = 'male' | 'female' | 'other'

// ===== Expression System (Independent Expression System) =====

/**
 * Expression frame definition
 * Each frame contains image URL and optional raw file object
 */
export interface ExpressionFrame {
  id: string                // UUID
  url: string               // Image address: path (e.g. "assets/expressions/expr_123/default.png") - persisted storage
  _runtimeUrl?: string      // [Non-persisted] Runtime Blob URL for frontend display
  file?: File              // Raw file object (only present during frontend upload)
}

/**
 * Anchor coordinates (relative ratio)
 */
export interface AnchorPoint {
  x: number                // 0.0 - 1.0 (default 0.5)
  y: number                // 0.0 - 1.0 (default 0.5)
}

/**
 * Expression asset definition (multi-frame expression animation system)
 * Supports single image (static expression) or multiple images (animated expression)
 */
export interface Expression {
  id: string                // Expression unique ID
  name: string              // Expression name, e.g. "Happy"
  tags: string[]            // Tag categories
  gender?: Gender           // Gender (added in v8.0)


  // Core assets
  defaultFrame: ExpressionFrame      // Default state (required): still frame when not speaking
  speakingFrames: ExpressionFrame[]  // Speaking state (optional): animation sequence while speaking

  // Core configuration
  anchor: AnchorPoint       // Anchor coordinates for face center alignment
  speakingFps: number       // Framerate, default 30
  speakingLoop: boolean     // Whether to loop, default true

  // Display transform properties (encapsulated, accessed externally via expressionStore methods)
  flipHorizontal: boolean   // Horizontal flip, default false
  blendMode?: 'normal' | 'multiply'  // Blend mode, default 'normal'; 'multiply' for white background expressions
  lockEdit?: boolean        // Whether edit locked (prohibit modifying dimensions/scale), default false
  defaultScale?: number     // Default scale ratio (0.1-5.0), always effective

  // v6.5: Still frame source indicator (meaningful only when speakingFrames.length > 0)
  // 'frame' = defaultFrame uses a frame from speakingFrames, synced when sequence frames change
  // 'custom' = defaultFrame is separately uploaded image, unaffected when sequence frames change
  stillFrameSource?: 'frame' | 'custom'
  stillFrameIndex?: number   // When stillFrameSource='frame', records index in speakingFrames

  // Metadata
  createdAt: number         // Creation timestamp (for sorting)
}

/**
 * Expression display transform parameters (encapsulated result)
 */
export interface ExpressionDisplayTransform {
  scale: number             // Effective scale ratio
  flipX: boolean            // Whether horizontal flip is needed
}

export interface PropAsset {
  id: string
  url?: string
  name?: string
  type: 'static' | 'animation'
  createdAt?: number
  tags?: string[]
  frames?: { url: string;[key: string]: unknown }[]
  fps?: number
  loop?: boolean
  _runtimeUrl?: string
  _runtimeStillUrl?: string
  stillFrameCustomUrl?: string
  stillFrameSource?: 'frame' | 'custom'
  stillFrameIndex?: number
  backgroundImage?: string // compat
  // v11.0: Animation preset library
  animations?: Record<string, AnimationDefinition>
  [key: string]: unknown
}

export interface SoundAsset {
  id: string
  url: string
  name: string
  type: 'bgm' | 'sfx'
  tags?: string[]
  duration?: number
  volume?: number
  loop?: boolean
  fadeIn?: number
  fadeOut?: number
  createdAt?: number
  _runtimeUrl?: string
  [key: string]: unknown
}

export interface Background {
  id: string
  name: string
  type: 'static' | 'animation'
  url?: string
  tags?: string[]
  createdAt?: number
  fps?: number
  loop?: boolean
  frames?: { url: string; _runtimeUrl?: string;[key: string]: unknown }[]
  _runtimeUrl?: string
  _runtimeStillUrl?: string
  stillFrameCustomUrl?: string
  stillFrameSource?: 'frame' | 'custom'
  stillFrameIndex?: number
  backgroundImage?: string // compat
  // v11.0: Animation preset library
  animations?: Record<string, AnimationDefinition>
  [key: string]: unknown
}

export interface Scene {
  id: string
  name: string
  duration?: number
  actors: ActorConfig[]
  script: TimelineNode[]

  [key: string]: unknown
}

export interface TimelineNode {
  id: string
  start: number
  duration: number
  [key: string]: unknown
}

export interface Assets {
  backgrounds: Background[]
  props: PropAsset[]
  musics: SoundAsset[]
  sounds: SoundAsset[]
  [key: string]: unknown
}

export interface ProjectData {
  meta: ProjectMeta
  assets?: {
    backgrounds?: Background[]
    props?: PropAsset[]
    sounds?: SoundAsset[]
    [key: string]: unknown
  }
  backgrounds?: Record<string, unknown> // Legacy compatibility
  expressions?: Record<string, Expression>
  episodes?: unknown[]
  actors?: ActorConfig[]
  narrator?: NarratorConfig
  sceneTemplates?: SceneTemplate[]
  compositeCharacters?: CompositeCharacter[]
  /** v20: User-defined preset action templates (project level) */
  customPresetAnimations?: PresetAnimationTemplate[]
  [key: string]: unknown
}
