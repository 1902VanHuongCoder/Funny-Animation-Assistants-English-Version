/**
 * Action utility functions
 * Provides semantic Action type predicates to improve code readability
 * 
 * v9.3: Lifecycle checks use SetLifecycleAction
 */

import type { Action, SetLifecycleAction } from '@/types/screenplay'

// ==================== Lifecycle Action Predicates ====================

/**
 * Determine whether action is a Birth Action
 * 
 * v9.3: Use set_lifecycle action to determine birth
 * When set_lifecycle action contains spawned: true, the object "births" into the scene at this moment.
 * 
 * @param action - Action to check
 * @returns True if birth action
 * 
 * @example
 * ```ts
 * if (isBirthAction(action)) {
 *   // Display 🌱 icon
 * }
 * ```
 */
export function isBirthAction(action: Action): action is SetLifecycleAction {
    if (action.type !== 'set_lifecycle') return false
    return action.params.spawned === true
}

/**
 * Determine whether action is a Death Action
 * 
 * v9.3: Use set_lifecycle action to determine death
 * When set_lifecycle action contains spawned: false, the object exits the scene at this moment.
 * 
 * @param action - Action to check
 * @returns True if death action
 * 
 * @example
 * ```ts
 * if (isDeathAction(action)) {
 *   // Display 🍂 icon
 * }
 * ```
 */
export function isDeathAction(action: Action): action is SetLifecycleAction {
    if (action.type !== 'set_lifecycle') return false
    return action.params.spawned === false
}

/**
 * Determine whether action is a lifecycle action (Birth or Death)
 * 
 * @param action - Action to check
 * @returns True if lifecycle-related action
 */
export function isLifecycleAction(action: Action): action is SetLifecycleAction {
    return isBirthAction(action) || isDeathAction(action)
}

// ==================== Geometric Transform Action Predicates ====================

/**
 * Determine whether set_transform action contains geometry property mutations
 * 
 * Geometry properties include: x, y, scaleX, scaleY, rotation
 * Used to detect mutual exclusion conflicts with tween_transform.
 * 
 * @param action - Action to check
 * @returns True if containing geometry properties
 */
export function hasGeometryParams(action: Action): boolean {
    if (action.type !== 'set_transform') return false
    const params = action.params
    return (
        params.x !== undefined ||
        params.y !== undefined ||
        params.scaleX !== undefined ||
        params.scaleY !== undefined ||
        params.rotation !== undefined
    )
}

// ==================== Lifecycle Action Icons ====================

/** Birth Action Icon - Sprout/Germination 🌱 */
export const BIRTH_ACTION_ICON = '🌱'

/** Death Action Icon - Withered/Fallen Leaf 🍂 */
export const DEATH_ACTION_ICON = '🍂'
