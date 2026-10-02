/**
 * WorkbenchBaseTransformSnapshot
 *
 * Utility functions for "container base posture snapshot" required by animation workbench preview path.
 *
 * Responsibilities:
 * - capture: reads position / scale / rotation / alpha / pivot / localBounds of PIXI.Container,
 *   encapsulating into serializable ContainerBaseState.
 * - apply: writes snapshot back to container (restores only geometric properties, without touching filters / AnimatedSprite frames).
 *
 * Design points:
 * - Pure functions, side-effect free (except explicit container writes), no external state dependency, easy to unit test.
 * - Pivot in snapshot must be restored — when switching to an empty animation, if pivot is not restored,
 *   the container retains track.pivot of previous track, causing the object to shift.
 * - Filter cleanup and AnimatedSprite frame resets are business-side state (per-key filter bundle, asset loader),
 *   handled by the caller before/after capture/apply, and outside this module's scope.
 */

import type * as PIXI from 'pixi.js'

export interface ContainerBaseState {
    /** Object ID (null when TARGET_SELF) */
    objectId: string | null
    position: { x: number; y: number }
    scale: { x: number; y: number }
    pivot: { x: number; y: number }
    rotation: number
    alpha: number
    bounds: { width: number; height: number; x: number; y: number }
}

/**
 * Reads from container's current state and returns an independent base snapshot.
 *
 * All fields in returned object are newly created plain objects/numbers; subsequent changes to container will not affect snapshot.
 * localBounds is calculated via `container.getLocalBounds()` (PIXI has internal caching, multiple calls are low cost).
 */
export function captureContainerBaseState(
    container: PIXI.Container,
    objectId: string | null,
): ContainerBaseState {
    const localBounds = container.getLocalBounds()
    return {
        objectId,
        position: { x: container.position.x, y: container.position.y },
        scale: { x: container.scale.x, y: container.scale.y },
        pivot: { x: container.pivot.x, y: container.pivot.y },
        rotation: container.rotation,
        alpha: container.alpha,
        bounds: {
            width: localBounds.width,
            height: localBounds.height,
            x: localBounds.x,
            y: localBounds.y,
        },
    }
}

/**
 * Writes geometric properties from snapshot back to container.
 *
 * Restores only position / scale / rotation / alpha / pivot.
 * Does not handle filters, does not touch AnimatedSprite current frames — these two are business-side state;
 * if caller needs restoration, please handle before/after calling this function.
 */
export function applyContainerBaseTransform(
    container: PIXI.Container,
    state: ContainerBaseState,
): void {
    container.position.set(state.position.x, state.position.y)
    container.scale.set(state.scale.x, state.scale.y)
    container.rotation = state.rotation
    container.alpha = state.alpha
    container.pivot.set(state.pivot.x, state.pivot.y)
}
