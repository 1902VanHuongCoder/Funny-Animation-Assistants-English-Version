/**
 * SetTransformHandler unit test
 * v9.3 update: Only tests geometric properties (x, y, scaleX, scaleY, rotation) and opacity (alpha)
 * 
 * Note: visible/flipX/zIndex have been moved to SetVisualHandler
 *       spawned has been moved to SetLifecycleHandler
 */

import { describe, expect, it } from 'vitest'

import type { SetTransformAction } from '@/types/screenplay'

import { localToGlobal } from '../matrixUtils'
import { SetTransformHandler } from '../handlers/SetTransformHandler'
import type { ActionHandlerContext, WriteableState } from '../types'

describe('SetTransformHandler', () => {
    // Create initial state
    function createInitialState(): WriteableState {
        return {
            x: 100,
            y: 100,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            alpha: 1,
            visible: true,
            flipX: false,
            zIndex: 10
        }
    }

    describe('Opacity properties', () => {
        it('applies alpha property', () => {
            const state = createInitialState()
            const action: SetTransformAction = {
                id: 'action_1',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: { alpha: 0.5 }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.alpha).toBe(0.5)
            // Other properties remain unchanged
            expect(state.x).toBe(100)
            expect(state.y).toBe(100)
        })
    })

    describe('Geometric properties', () => {
        it('applies x, y position transforms', () => {
            const state = createInitialState()
            const action: SetTransformAction = {
                id: 'action_1',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: { x: 500, y: 300 }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.x).toBe(500)
            expect(state.y).toBe(300)
            // Other properties remain unchanged
            expect(state.scaleX).toBe(1)
            expect(state.scaleY).toBe(1)
        })

        it('applies scaleX, scaleY scaling transforms', () => {
            const state = createInitialState()
            const action: SetTransformAction = {
                id: 'action_1',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: { scaleX: 2.0, scaleY: 1.5 }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.scaleX).toBe(2.0)
            expect(state.scaleY).toBe(1.5)
        })

        it('applies rotation transform', () => {
            const state = createInitialState()
            const action: SetTransformAction = {
                id: 'action_1',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: { rotation: 45 }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.rotation).toBe(45)
        })

        it('applies rotation using local values even when parent exists', () => {
            const state: WriteableState = {
                ...createInitialState(),
                id: 'child',
                parentId: 'parent',
                rotation: 0,
            }
            const ctx: ActionHandlerContext = {
                getObjectState: (id) => id === 'parent'
                    ? {
                        id: 'parent',
                        x: 0,
                        y: 0,
                        rotation: Math.PI / 3,
                        scaleX: 1,
                        scaleY: 1,
                    }
                    : undefined
            }
            const action: SetTransformAction = {
                id: 'action_parent_local_rotation',
                type: 'set_transform',
                category: 'point',
                target: 'child',
                slotIndex: 0,
                params: { rotation: Math.PI / 2 }
            }

            SetTransformHandler.applyToState(state, action, ctx)

            expect(state.rotation).toBe(Math.PI / 2)
        })

        it('applies multiple geometric properties simultaneously', () => {
            const state = createInitialState()
            const action: SetTransformAction = {
                id: 'action_1',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: {
                    x: 200,
                    y: 150,
                    scaleX: 0.8,
                    scaleY: 0.8,
                    rotation: 90
                }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.x).toBe(200)
            expect(state.y).toBe(150)
            expect(state.scaleX).toBe(0.8)
            expect(state.scaleY).toBe(0.8)
            expect(state.rotation).toBe(90)
        })

        it('mixes geometric and opacity properties', () => {
            const state = createInitialState()
            const action: SetTransformAction = {
                id: 'action_1',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: {
                    x: 300,
                    y: 200,
                    alpha: 0.7
                }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.x).toBe(300)
            expect(state.y).toBe(200)
            expect(state.alpha).toBe(0.7)
        })
    })

    describe('Edge cases', () => {
        it('does not modify state when params is empty', () => {
            const state = createInitialState()
            const action: SetTransformAction = {
                id: 'action_1',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: {}
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.x).toBe(100)
            expect(state.y).toBe(100)
            expect(state.alpha).toBe(1)
        })

        it('setting only x does not affect y', () => {
            const state = createInitialState()
            const action: SetTransformAction = {
                id: 'action_1',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: { x: 999 }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.x).toBe(999)
            expect(state.y).toBe(100) // Original value unchanged
        })

        it('handles negative coordinates', () => {
            const state = createInitialState()
            const action: SetTransformAction = {
                id: 'action_1',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: { x: -100, y: -50 }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.x).toBe(-100)
            expect(state.y).toBe(-50)
        })

        it('handles 0 value rotation', () => {
            const state = createInitialState()
            state.rotation = 45 // Set non-zero value first
            const action: SetTransformAction = {
                id: 'action_1',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: { rotation: 0 }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.rotation).toBe(0)
        })

        it('performs runtime position compensation when only changing transform origin, without requiring explicit x/y in action', () => {
            const state = createInitialState()
            state.rotation = Math.PI / 4

            const action: SetTransformAction = {
                id: 'action_origin_only',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: {
                    transformOriginX: 10,
                    transformOriginY: 0
                }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.transformOriginX).toBe(10)
            expect(state.transformOriginY).toBe(0)
            expect(state.x).toBeCloseTo(97.0710678, 5)
            expect(state.y).toBeCloseTo(107.0710678, 5)
        })

        it('does not double compensate transform origin when explicit x/y are provided', () => {
            const state = createInitialState()
            state.rotation = Math.PI / 4

            const action: SetTransformAction = {
                id: 'action_origin_with_position',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: {
                    x: 320,
                    y: 240,
                    transformOriginX: 10,
                    transformOriginY: 0
                }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.x).toBe(320)
            expect(state.y).toBe(240)
            expect(state.transformOriginX).toBe(10)
            expect(state.transformOriginY).toBe(0)
        })

        it('does not perform position compensation when changing transform origin and rotation simultaneously', () => {
            const state = createInitialState()
            state.rotation = Math.PI / 4

            const action: SetTransformAction = {
                id: 'action_origin_with_rotation',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: {
                    rotation: Math.PI / 2,
                    transformOriginX: 10,
                    transformOriginY: 0
                }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.x).toBe(100)
            expect(state.y).toBe(100)
            expect(state.rotation).toBe(Math.PI / 2)
            expect(state.transformOriginX).toBe(10)
            expect(state.transformOriginY).toBe(0)
        })

        it('does not perform position compensation when changing transform origin and scale simultaneously', () => {
            const state = createInitialState()
            state.rotation = Math.PI / 4

            const action: SetTransformAction = {
                id: 'action_origin_with_scale',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: {
                    scaleX: 2,
                    scaleY: 1.5,
                    transformOriginX: 10,
                    transformOriginY: 0
                }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.x).toBe(100)
            expect(state.y).toBe(100)
            expect(state.scaleX).toBe(2)
            expect(state.scaleY).toBe(1.5)
            expect(state.transformOriginX).toBe(10)
            expect(state.transformOriginY).toBe(0)
        })

        it('applies all fields when simultaneously setting x/y, rotation, scale, and transform origin', () => {
            const state = createInitialState()

            const action: SetTransformAction = {
                id: 'action_full_transform_with_origin',
                type: 'set_transform',
                category: 'point',
                target: 'obj_1',
                slotIndex: 0,
                params: {
                    x: 320,
                    y: 240,
                    rotation: Math.PI / 2,
                    scaleX: 2,
                    scaleY: 1.5,
                    transformOriginX: 10,
                    transformOriginY: -5
                }
            }

            SetTransformHandler.applyToState(state, action)

            expect(state.x).toBe(320)
            expect(state.y).toBe(240)
            expect(state.rotation).toBe(Math.PI / 2)
            expect(state.scaleX).toBe(2)
            expect(state.scaleY).toBe(1.5)
            expect(state.transformOriginX).toBe(10)
            expect(state.transformOriginY).toBe(-5)
        })

        it('evaluates position using the new local rotation when the same action sets global x/y and rotation simultaneously', () => {
            const parent: WriteableState = {
                id: 'parent',
                type: 'composite',
                x: 2985.398782411442,
                y: 1485.7918595697022,
                scaleX: 1.5,
                scaleY: 1.5,
                rotation: 0,
                flipX: false,
            }
            const state: WriteableState = {
                id: 'child',
                type: 'symbol',
                parentId: 'parent',
                x: 72.50790723415938,
                y: -4.19332253894693,
                scaleX: 1,
                scaleY: 1,
                rotation: 1.5500334092032622,
                flipX: false,
                transformOriginX: -17.5,
                transformOriginY: -63.333335876464844,
            }
            const ctx: ActionHandlerContext = {
                getObjectState: (id) => id === 'parent' ? parent : undefined
            }
            const targetGlobal = {
                x: 3291.5453209074863,
                y: 1516.1281780045538,
            }
            const action: SetTransformAction = {
                id: 'action_position_and_rotation',
                type: 'set_transform',
                category: 'point',
                target: 'child',
                slotIndex: 0,
                params: {
                    ...targetGlobal,
                    rotation: 0,
                }
            }

            SetTransformHandler.applyToState(state, action, ctx)

            expect(state.rotation).toBe(0)
            const resolvedGlobal = localToGlobal(state, ctx.getObjectState)
            expect(resolvedGlobal.x).toBeCloseTo(targetGlobal.x, 5)
            expect(resolvedGlobal.y).toBeCloseTo(targetGlobal.y, 5)
        })
    })

    describe('Handler metadata', () => {
        it('type is set_transform', () => {
            expect(SetTransformHandler.type).toBe('set_transform')
        })

        it('is Point Action', () => {
            expect(SetTransformHandler.isPointAction).toBe(true)
        })

        it('is not Duration Action', () => {
            expect(SetTransformHandler.isDurationAction).toBe(false)
        })
    })
})
