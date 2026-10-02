import { describe, expect, it } from 'vitest'

import type { Action, RuntimeSlot } from '@/types/screenplay'
import type { SceneObject } from '@/types/sceneObject'
import type { ActionHandlerContext, WriteableState } from '@/utils/actionHandlers/types'

import { evaluateObjectState, evaluateObjectStateBySlot } from '../actionEvaluator'
import { globalToLocal, localToGlobal } from '../actionHandlers/matrixUtils'
import { topologicalSortByParent } from '../evaluationOrder'

// ==================== Test Fixtures ====================

/** Create base object without parent */
function makeObj(id: string, overrides?: Partial<SceneObject>): SceneObject {
    return {
        id, type: 'prop', name: id, refId: `ref_${id}`,
        x: 0, y: 0, width: 100, height: 100,
        scaleX: 1, scaleY: 1, rotation: 0, alpha: 1,
        visible: true, flipX: false, zIndex: 0,
        ...overrides,
    } as SceneObject
}

/** Build ActionHandlerContext (from Map<id, SceneObject>) */
function makeContext(objects: SceneObject[]): ActionHandlerContext {
    const map = new Map(objects.map(o => [o.id, o]))
    return {
        getObjectState: (id: string) => {
            const obj = map.get(id)
            return obj ? (obj as unknown as WriteableState) : undefined
        }
    }
}

// ==================== matrixUtils ====================

describe('globalToLocal / localToGlobal', () => {

    it('no parent -> global = local (pass-through)', () => {
        const state = makeObj('a', { x: 100, y: 200 }) as unknown as WriteableState
        const result = globalToLocal({ x: 300, y: 400 }, state)
        expect(result.x).toBe(300)
        expect(result.y).toBe(400)
    })

    it('with parent (translation only) -> converts correctly', () => {
        const parent = makeObj('p', { x: 200, y: 300 })
        const child = makeObj('c', { x: 50, y: 0, parentId: 'p' })

        const ctx = makeContext([parent, child])
        const childState = child as unknown as WriteableState

        // Global (400, 500) -> relative to parent(200, 300) -> local (200, 200)
        const result = globalToLocal({ x: 400, y: 500 }, childState, ctx.getObjectState)
        expect(result.x).toBeCloseTo(200, 5)
        expect(result.y).toBeCloseTo(200, 5)
    })

    it('with parent (translation + scale) -> converts correctly', () => {
        const parent = makeObj('p', { x: 100, y: 100, scaleX: 2, scaleY: 2 })
        const child = makeObj('c', { x: 50, y: 50, parentId: 'p' })

        const ctx = makeContext([parent, child])
        const childState = child as unknown as WriteableState

        // parent world: x=100, y=100, scale=2x
        // Global (300, 300) -> parent local = (300-100)/2 = 100, (300-100)/2 = 100
        const result = globalToLocal({ x: 300, y: 300 }, childState, ctx.getObjectState)
        expect(result.x).toBeCloseTo(100, 5)
        expect(result.y).toBeCloseTo(100, 5)
    })

    it('localToGlobal without parent', () => {
        const state = makeObj('a', { x: 150, y: 250 }) as unknown as WriteableState
        const result = localToGlobal(state)
        expect(result.x).toBe(150)
        expect(result.y).toBe(250)
    })

    it('localToGlobal with parent (translation)', () => {
        const parent = makeObj('p', { x: 200, y: 300 })
        const child = makeObj('c', { x: 50, y: 100, parentId: 'p' })

        const ctx = makeContext([parent, child])
        const childState = child as unknown as WriteableState

        // Local (50, 100) + parent(200, 300) = Global (250, 400)
        const result = localToGlobal(childState, ctx.getObjectState)
        expect(result.x).toBeCloseTo(250, 5)
        expect(result.y).toBeCloseTo(400, 5)
    })

    it('globalToLocal -> localToGlobal round-trip consistent', () => {
        // Note: Non-uniform scaling (scaleX!=scaleY) + rotation matrix decomposition has inherent precision limits
        // This test uses uniform scaling to ensure round-trip precision
        const parent = makeObj('p', { x: 200, y: 100, scaleX: 1.5, scaleY: 1.5, rotation: 0.3 })
        const child = makeObj('c', { x: 30, y: 40, parentId: 'p' })

        const ctx = makeContext([parent, child])
        const childState = child as unknown as WriteableState

        const globalParams = { x: 500, y: 400, scaleX: 2, scaleY: 2, rotation: 0.5 }

        // Global -> Local
        const localResult = globalToLocal(globalParams, childState, ctx.getObjectState)

        // Update child state to local result, then convert back to global
        const updatedChild = {
            ...childState,
            x: localResult.x,
            y: localResult.y,
            scaleX: localResult.scaleX,
            scaleY: localResult.scaleY,
            rotation: localResult.rotation,
        } as WriteableState

        const globalResult = localToGlobal(updatedChild, ctx.getObjectState)
        expect(globalResult.x).toBeCloseTo(globalParams.x, 3)
        expect(globalResult.y).toBeCloseTo(globalParams.y, 3)
        expect(globalResult.scaleX).toBeCloseTo(globalParams.scaleX, 3)
        expect(globalResult.scaleY).toBeCloseTo(globalParams.scaleY, 3)
        expect(globalResult.rotation).toBeCloseTo(globalParams.rotation, 3)
    })
})

// ==================== evaluateObjectStateBySlot（Action Mode）====================

describe('evaluateObjectStateBySlot — Global Coordinate Transformation', () => {

    it('set_transform on object without parent -> behavior unchanged', () => {
        const obj = makeObj('a', { x: 100, y: 100 })
        const actions: Action[] = [{
            id: 'st1', type: 'set_transform', category: 'point',
            target: 'a', slotIndex: 0,
            params: { x: 500, y: 300 }
        } as unknown as Action]

        const result = evaluateObjectStateBySlot(obj, actions, 0)
        expect(result.x).toBe(500)
        expect(result.y).toBe(300)
    })

    it('set_transform on object with parent -> converts global coords to parent local', () => {
        const parent = makeObj('p', { x: 200, y: 300 })
        const child = makeObj('c', { x: 0, y: 0, parentId: 'p' })

        const ctx = makeContext([parent, child])

        // Action stores global coordinates (400, 500)
        const actions: Action[] = [{
            id: 'st1', type: 'set_transform', category: 'point',
            target: 'c', slotIndex: 0,
            params: { x: 400, y: 500 }
        } as unknown as Action]

        const result = evaluateObjectStateBySlot(child, actions, 0, undefined, ctx)
        // Expected: relative to parent(200, 300) -> (200, 200)
        expect(result.x).toBeCloseTo(200, 5)
        expect(result.y).toBeCloseTo(200, 5)
    })

    it('tween_transform x/y on object with parent -> converts global coords to parent local', () => {
        const parent = makeObj('p', { x: 100, y: 100 })
        const child = makeObj('c', { x: 50, y: 50, parentId: 'p' })

        const ctx = makeContext([parent, child])

        // Action stores global target coordinates (500, 400)
        const actions: Action[] = [{
            id: 'tt1', type: 'tween_transform', category: 'duration',
            target: 'c', slotIndex: 0, slotSpan: 1,
            params: { x: 500, y: 400 }
        } as unknown as Action]

        const result = evaluateObjectStateBySlot(child, actions, 0, undefined, ctx)
        // Expected: (500-100, 400-100) = (400, 300)
        expect(result.x).toBeCloseTo(400, 5)
        expect(result.y).toBeCloseTo(300, 5)
    })
})

// ==================== evaluateObjectState (Preview Mode interpolation) ====================

describe('evaluateObjectState — Global space tween interpolation', () => {

    const slots: RuntimeSlot[] = [
        { type: 'subtitle', index: 0, startTime: 0, duration: 1000 },
        { type: 'subtitle', index: 1, startTime: 1000, duration: 1000 }
    ]

    it('tween interpolation without parent -> behavior unchanged', () => {
        const obj = makeObj('a', { x: 0, y: 0 })
        const actions: Action[] = [{
            id: 'tt1', type: 'tween_transform', category: 'duration',
            target: 'a', slotIndex: 0, slotSpan: 1, easing: 'linear',
            params: { x: 100, y: 200 }
        } as unknown as Action]

        // Middle frame (50%)
        const result = evaluateObjectState(obj, actions, 500, 2000, slots)
        expect(result.x).toBeCloseTo(50, 1)
        expect(result.y).toBeCloseTo(100, 1)
    })

    it('tween interpolation with parent -> global space lerp then to local', () => {
        const parent = makeObj('p', { x: 200, y: 0 })
        const child = makeObj('c', { x: 0, y: 0, parentId: 'p' })
        // child global initial position = (200, 0)

        const ctx = makeContext([parent, child])

        // Global target (400, 0)
        const actions: Action[] = [{
            id: 'tt1', type: 'tween_transform', category: 'duration',
            target: 'c', slotIndex: 0, slotSpan: 1, easing: 'linear',
            params: { x: 400, y: 0 }
        } as unknown as Action]

        // 50% -> Global (300, 0) -> Local (300-200, 0) = (100, 0)
        const result = evaluateObjectState(child, actions, 500, 2000, slots, -1, ctx)
        expect(result.x).toBeCloseTo(100, 1)
        expect(result.y).toBeCloseTo(0, 1)
    })

    it('tween_transform rotation with parent -> interpolates by local value', () => {
        const parent = makeObj('p', { rotation: Math.PI / 4 })
        const child = makeObj('c', { rotation: 0, parentId: 'p' })

        const ctx = makeContext([parent, child])

        const actions: Action[] = [{
            id: 'tt_rotation', type: 'tween_transform', category: 'duration',
            target: 'c', slotIndex: 0, slotSpan: 1, easing: 'linear',
            params: { rotation: Math.PI / 2 }
        } as unknown as Action]

        const result = evaluateObjectState(child, actions, 500, 2000, slots, -1, ctx)
        expect(result.rotation).toBeCloseTo(Math.PI / 4, 6)
    })
})

// ==================== topologicalSortByParent ====================

describe('topologicalSortByParent', () => {

    it('keeps original order without parent', () => {
        const objects = [
            { id: 'a' },
            { id: 'b' },
            { id: 'c' },
        ]
        const sorted = topologicalSortByParent(objects)
        expect(sorted.map(o => o.id)).toEqual(['a', 'b', 'c'])
    })

    it('parent precedes child', () => {
        const objects = [
            { id: 'child', parentId: 'parent' },
            { id: 'parent' },
            { id: 'standalone' },
        ]
        const sorted = topologicalSortByParent(objects)
        const parentIdx = sorted.findIndex(o => o.id === 'parent')
        const childIdx = sorted.findIndex(o => o.id === 'child')
        expect(parentIdx).toBeLessThan(childIdx)
    })

    it('correctly sorts multi-level nesting', () => {
        const objects = [
            { id: 'grandchild', parentId: 'child' },
            { id: 'child', parentId: 'parent' },
            { id: 'parent' },
        ]
        const sorted = topologicalSortByParent(objects)
        const ids = sorted.map(o => o.id)
        expect(ids.indexOf('parent')).toBeLessThan(ids.indexOf('child'))
        expect(ids.indexOf('child')).toBeLessThan(ids.indexOf('grandchild'))
    })

    it('orphans (parentId pointing to nonexistent object) treated as depth 0', () => {
        const objects = [
            { id: 'orphan', parentId: 'nonexistent' },
            { id: 'root' },
        ]
        const sorted = topologicalSortByParent(objects)
        // Both have depth 0, preserving original order
        expect(sorted.map(o => o.id)).toEqual(['orphan', 'root'])
    })

    it('parentId null / undefined treated as no parent', () => {
        const objects = [
            { id: 'a', parentId: null },
            { id: 'b', parentId: undefined },
            { id: 'c' },
        ]
        const sorted = topologicalSortByParent(objects)
        expect(sorted.map(o => o.id)).toEqual(['a', 'b', 'c'])
    })

    it('circular parentId should throw Error (Fail-Fast)', () => {
        const objects = [
            { id: 'a', parentId: 'b' },
            { id: 'b', parentId: 'a' },
        ]
        expect(() => topologicalSortByParent(objects)).toThrow('Circular parent-child relationship detected')
    })
})
