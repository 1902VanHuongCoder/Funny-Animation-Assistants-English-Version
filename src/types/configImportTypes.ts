/**
 * config.json import type definitions
 * Tree structure node types used for scene template import
 */

/** Frame information in config.json */
export interface ExportFrame {
  frame: number
  keyframe: number
  label: string | null
  path: string
  type: 'single' | 'keyframe' | 'tween'
  subIndex?: number
}

/** Registration point information in config.json */
export interface ExportRegistrationPoint {
  parentX: number
  parentY: number
  localX: number
  localY: number
}

/** Transform information in config.json */
export interface ExportInstanceTransform {
  width: number
  height: number
  registrationPoint: ExportRegistrationPoint
  scaleX: number
  scaleY: number
  rotation: number
}

/** Part information in config.json */
export interface ExportPart {
  partName: string
  instanceName?: string
  elementType?: 'symbol' | 'group' | 'bitmap' | 'text' | 'shape'
  parentPart?: string
  rootPart?: string
  folderName: string
  frameCount: number
  instanceTransform: ExportInstanceTransform
  frames: ExportFrame[]
  scaleFactor?: number
  alpha?: number
}

/** Root structure of config.json */
export interface ExportConfig {
  character: string
  exportLevel: number
  parts: ExportPart[]
}

/** Leaf node in config.json (symbol) */
export interface ConfigSymbolNode {
  name: string
  type: 'symbol'
  elementType: string
  frameCount: number
  frames: ExportFrame[]
  instanceTransform: ExportInstanceTransform
  scaleFactor: number
  alpha?: number
}

/** Container node in config.json (composite) */
export interface ConfigCompositeNode {
  name: string
  type: 'composite'
  elementType: string
  instanceTransform?: ExportInstanceTransform
  children: ConfigNode[]
  alpha?: number
}

/** Root node in config.json (with version) */
export interface ConfigRoot extends ConfigCompositeNode {
  version: string
}

/** Tree node in config.json (union type) */
export type ConfigNode = ConfigSymbolNode | ConfigCompositeNode
