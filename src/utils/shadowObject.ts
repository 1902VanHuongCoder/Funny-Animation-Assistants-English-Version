/**
 * Shadow Object Management Module
 * 
 * Implements dynamic object injection features:
 * - Dynamically add scene objects at any Slot in Action Mode
 * - Uses Shadow Pool strategy: objects created with spawned=false at Setup level
 * - Controls object spawn timing and position via Actions
 * 
 * @version v9.2 - Separates lifecycle and visibility using spawned property
 */

import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from '@/constants/canvas'
import { Z_INDEX_BACKGROUND, Z_INDEX_DEFAULT, Z_INDEX_LIGHT } from '@/constants/zIndex'

/**
 * Shadow Prop default dimensions (consistent with sceneObjectStore.createPropObject)
 * Updated with actual texture dimensions during rendering
 */
const SHADOW_PROP_DEFAULT_WIDTH = 200
const SHADOW_PROP_DEFAULT_HEIGHT = 200
import type { SceneObject } from '@/types/sceneObject'
import type {
    SceneContainer,
    ScriptBlock,
    SetLifecycleAction
} from '@/types/screenplay'
import { generateId } from '@/utils/uuid'

/**
 * Parameters for adding a Shadow Object
 */
export interface AddShadowObjectParams {
    /** Scene container */
    scene: SceneContainer
    /** Current script block */
    block: ScriptBlock
    /** Current slot index */
    slotIndex: number
    /** Object type */
    objectType: 'prop' | 'audio' | 'background' | 'symbol' | 'expression' | 'light'
    /** Resource ID (propId, audioId, backgroundId) */
    resourceId: string
    /** Resource name */
    resourceName: string
    /** Camera center X coordinate */
    cameraCenterX: number
    /** Camera center Y coordinate */
    cameraCenterY: number
    /** Optional: alias */
    alias?: string
}

/**
 * Result of adding a Shadow Object
 */
export interface AddShadowObjectResult {
    /** Created Setup object */
    setupObject: SceneObject
    /** Spawn Action (v9.3: type changed to SetLifecycleAction) */
    spawnAction: SetLifecycleAction
}

/**
 * Create Shadow Object and its spawn Action
 * 
 * @param params Parameters
 * @returns Created Setup object and spawn Action
 */
export function createShadowObject(params: AddShadowObjectParams): AddShadowObjectResult {
    const {
        slotIndex,
        objectType,
        resourceId,
        resourceName,
        // v9.3: cameraCenterX/cameraCenterY no longer needed; position set by subsequent set_transform
    } = params

    const objectId = generateId('sceneobject')  // v9.2: Consistent with Scene Mode

    // 1. Create shadow object (spawned: false, positioned at canvas center)
    // v2.0.0: Uniformly use center coordinate semantics for all objects, consistent with create*Object in sceneObjectStore
    const initialX = CANVAS_CENTER_X
    const initialY = CANVAS_CENTER_Y

    const setupObject: SceneObject = {
        id: objectId,
        refId: resourceId,
        type: objectType,
        name: resourceName,
        x: initialX,
        y: initialY,
        width: objectType === 'background' ? 0 : objectType === 'light' ? 96 : (objectType === 'prop' || objectType === 'symbol' || objectType === 'expression' ? SHADOW_PROP_DEFAULT_WIDTH : 0),
        height: objectType === 'background' ? 0 : objectType === 'light' ? 96 : (objectType === 'prop' || objectType === 'symbol' || objectType === 'expression' ? SHADOW_PROP_DEFAULT_HEIGHT : 0),
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        zIndex: objectType === 'background' ? Z_INDEX_BACKGROUND : objectType === 'light' ? Z_INDEX_LIGHT : Z_INDEX_DEFAULT,
        flipX: false,
        visible: true,   // v9.2: visible restored to true (visibility)
        spawned: false,  // v9.2: Key - not yet spawned
        alpha: 1,
        ...(params.alias ? { alias: params.alias } : { alias: resourceName }),
        // Audio object default properties
        ...(objectType === 'audio' ? {
            volume: 1.0,
            loop: false,
            playbackState: 'stop' as const
        } : {}),
        // v16: Symbol object default properties
        ...(objectType === 'symbol' ? {
            materials: []
        } : {}),
        // v25: Light object default properties (consistent with sceneObjectStore.createLightObject)
        ...(objectType === 'light' ? {
            lightType: 'point' as const,
            lightColor: '#ffffff',
            lightIntensity: 1.0,
            lightRadius: 300,
            flicker: 0,
            flickerSpeed: 0.35,
            directionMode: 'omni' as const,
            directionAngle: 0,
            coneAngle: 100,
        } : {}),
    }

    // 2. Create spawn Action (v9.3: using SetLifecycleAction)
    const spawnAction: SetLifecycleAction = {
        id: generateId(),
        type: 'set_lifecycle',
        category: 'point',
        target: objectId,
        slotIndex,
        params: {
            spawned: true,
            autoDespawnOnBlockEnd: true
        }
    }

    return { setupObject, spawnAction }
}

/**
 * Determine whether object is dynamic object (Shadow Object)
 * 
 * Criteria for dynamic objects:
 * - spawned=false in Setup
 * - spawned=true controlled via Action
 * 
 * @param obj Setup object
 * @returns Whether dynamic object
 */
export function isShadowObject(obj: SceneObject): boolean {
    return obj.spawned === false
}

/**
 * Find object's spawn slot index
 * 
 * v9.3: Uses SetLifecycleAction to look up spawn action
 * 
 * @param objectId Object ID
 * @param actions Current Block's actions list
 * @returns Spawn slot index, or -1 if not found
 */
export function findBirthSlotIndex(objectId: string, actions: SetLifecycleAction[]): number {
    // Look up the first set_lifecycle action with spawned: true
    const birthAction = actions
        .filter(a =>
            a.type === 'set_lifecycle' &&
            a.target === objectId &&
            a.params.spawned === true
        )
        .sort((a, b) => a.slotIndex - b.slotIndex)[0]

    return birthAction ? birthAction.slotIndex : -1
}

/**
 * Check whether object is alive at specified slot (spawned and not despawned)
 * 
 * v9.3: Uses SetLifecycleAction to check spawned state
 * 
 * @param objectId Object ID
 * @param slotIndex Slot index
 * @param actions Actions list
 * @param isSetupSpawned spawned value in Setup
 * @returns Whether alive (spawned state)
 */
export function isObjectAliveAtSlot(
    objectId: string,
    slotIndex: number,
    actions: SetLifecycleAction[],
    isSetupSpawned: boolean
): boolean {
    // Get all spawned changes for this object at or before specified slot
    const lifecycleActions = actions
        .filter(a =>
            a.type === 'set_lifecycle' &&
            a.target === objectId &&
            a.slotIndex <= slotIndex
        )
        .sort((a, b) => a.slotIndex - b.slotIndex)

    // If no spawned changes, use value from Setup
    if (lifecycleActions.length === 0) {
        return isSetupSpawned
    }

    // Return the value from the last spawned change
    const lastAction = lifecycleActions[lifecycleActions.length - 1]
    return lastAction?.params.spawned === true
}

