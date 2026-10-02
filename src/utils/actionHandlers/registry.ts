/**
 * Action Handler Registry
 * v8.6 P2: Unified Action handling logic
 */

import type { Action } from '@/types/screenplay'

import type { ActionHandler, ActionType } from './types'

/**
 * Handler registry
 */
const handlerRegistry = new Map<ActionType, ActionHandler>()

/**
 * Register Handler
 */
export function registerHandler<T extends Action>(handler: ActionHandler<T>): void {
    handlerRegistry.set(handler.type as ActionType, handler as ActionHandler)
}

/**
 * Get Handler
 */
export function getHandler(type: ActionType): ActionHandler | undefined {
    return handlerRegistry.get(type)
}

/**
 * Get all registered Handlers
 */
export function getAllHandlers(): ActionHandler[] {
    return Array.from(handlerRegistry.values())
}

/**
 * Determine whether Action is a point action (instantaneous)
 */
export function isPointAction(action: Action): boolean {
    const handler = getHandler(action.type as ActionType)
    return handler?.isPointAction ?? false
}

/**
 * Determine whether Action is a duration action
 */
export function isDurationAction(action: Action): boolean {
    const handler = getHandler(action.type as ActionType)
    return handler?.isDurationAction ?? false
}

/**
 * Determine whether Action affects the target object
 */
export function isActionForTarget(action: Action, targetId: string): boolean {
    return action.target === targetId
}

/**
 * Determine whether Action is a camera action
 */
export function isCameraAction(action: Action): boolean {
    const cameraTypes: ActionType[] = ['camera_cut', 'camera_move', 'camera_shake', 'camera_follow']
    return cameraTypes.includes(action.type as ActionType)
}

/**
 * Determine whether Action affects object state
 * Determined via the affectsObjectState metadata in the Handler registry, eliminating hardcoded type enums.
 */
export function isObjectStateAction(action: Action): boolean {
    const handler = getHandler(action.type as ActionType)
    return handler?.affectsObjectState ?? false
}
