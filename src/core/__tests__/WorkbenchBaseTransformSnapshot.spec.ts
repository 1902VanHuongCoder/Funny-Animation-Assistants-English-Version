/**
 * WorkbenchBaseTransformSnapshot.spec.ts
 *
 * Covers:
 * - snapshot returned by capture is independent copy (subsequent container modifications do not pollute snapshot)
 * - apply completely restores container position/scale/rotation/alpha/pivot
 * - Phase 0 smoke: simulates "load animation A -> user modifies pivot -> switch to empty animation B",
 *   container returns to mount snapshot (pivot must be restored, avoiding leftovers from track.pivot)
 */

import * as PIXI from 'pixi.js'
import { describe, expect, it } from 'vitest'

import {
    applyContainerBaseTransform,
    captureContainerBaseState,
} from '../WorkbenchBaseTransformSnapshot'

function makeContainer(opts: {
    position?: [number, number]
    scale?: [number, number]
    pivot?: [number, number]
    rotation?: number
    alpha?: number
}): PIXI.Container {
    const c = new PIXI.Container()
    if (opts.position) c.position.set(opts.position[0], opts.position[1])
    if (opts.scale) c.scale.set(opts.scale[0], opts.scale[1])
    if (opts.pivot) c.pivot.set(opts.pivot[0], opts.pivot[1])
    if (opts.rotation !== undefined) c.rotation = opts.rotation
    if (opts.alpha !== undefined) c.alpha = opts.alpha
    return c
}

describe('WorkbenchBaseTransformSnapshot — captureContainerBaseState', () => {
    it('completely reads geometric quantities of current container', () => {
        const c = makeContainer({
            position: [10, 20],
            scale: [1.5, 2],
            pivot: [5, 6],
            rotation: 0.3,
            alpha: 0.8,
        })

        const state = captureContainerBaseState(c, 'obj-A')

        expect(state.objectId).toBe('obj-A')
        expect(state.position).toEqual({ x: 10, y: 20 })
        expect(state.scale).toEqual({ x: 1.5, y: 2 })
        expect(state.pivot).toEqual({ x: 5, y: 6 })
        expect(state.rotation).toBe(0.3)
        expect(state.alpha).toBe(0.8)
    })

    it('returned snapshot is independent copy - subsequent container mutations do not affect snapshot', () => {
        const c = makeContainer({ position: [1, 2], pivot: [3, 4] })
        const state = captureContainerBaseState(c, null)

        c.position.set(999, 999)
        c.pivot.set(999, 999)

        expect(state.position).toEqual({ x: 1, y: 2 })
        expect(state.pivot).toEqual({ x: 3, y: 4 })
    })

    it('captures normally even when objectId = null', () => {
        const c = new PIXI.Container()
        const state = captureContainerBaseState(c, null)
        expect(state.objectId).toBeNull()
    })
})

describe('WorkbenchBaseTransformSnapshot — applyContainerBaseTransform', () => {
    it('completely writes all 5 quantities back to container', () => {
        const snapshot = captureContainerBaseState(
            makeContainer({
                position: [100, 200],
                scale: [0.5, 0.5],
                pivot: [10, 20],
                rotation: 0.7,
                alpha: 0.6,
            }),
            'obj-X',
        )

        const target = new PIXI.Container()
        applyContainerBaseTransform(target, snapshot)

        expect(target.position.x).toBe(100)
        expect(target.position.y).toBe(200)
        expect(target.scale.x).toBe(0.5)
        expect(target.scale.y).toBe(0.5)
        expect(target.pivot.x).toBe(10)
        expect(target.pivot.y).toBe(20)
        expect(target.rotation).toBe(0.7)
        expect(target.alpha).toBe(0.6)
    })

    it('does not touch filters and child nodes - restores geometric quantities only', () => {
        const target = new PIXI.Container()
        const child = new PIXI.Container()
        target.addChild(child)
        const dummyFilter = { padding: 0 } as unknown as PIXI.Filter
        target.filters = [dummyFilter]

        const snapshot = captureContainerBaseState(new PIXI.Container(), null)
        applyContainerBaseTransform(target, snapshot)

        expect(target.children).toContain(child)
        expect(target.filters).toEqual([dummyFilter])
    })
})

describe('WorkbenchBaseTransformSnapshot — Phase 0 smoke: container state returns after switching animation', () => {
    it('load A -> user modifies pivot -> switch to B (empty): restores to mount snapshot', () => {
        // 1) mount time (before loading A) - onContainerReady captures baseline snapshot
        const container = makeContainer({
            position: [50, 60],
            scale: [1, 1],
            pivot: [8, 9],
            rotation: 0,
            alpha: 1,
        })
        const mountSnapshot = captureContainerBaseState(container, 'root')

        // 2) Load animation A -> intermediate paths mutate container.pivot / position / rotation / scale
        //    User drags pivot to new position in PivotEditorPanel
        container.position.set(120, 140)
        container.scale.set(1.4, 1.4)
        container.pivot.set(35, 40)
        container.rotation = 0.9
        container.alpha = 0.5

        // 3) Switch to B (empty animation) - AnimationWorkbench.resetContainerToBaseStateWithKey path
        //    calls applyContainerBaseTransform(container, mountSnapshot)
        applyContainerBaseTransform(container, mountSnapshot)

        // 4) Assert: (position, scale, rotation, pivot, alpha) all return to mount snapshot
        expect(container.position.x).toBe(50)
        expect(container.position.y).toBe(60)
        expect(container.scale.x).toBe(1)
        expect(container.scale.y).toBe(1)
        expect(container.pivot.x).toBe(8)
        expect(container.pivot.y).toBe(9)
        expect(container.rotation).toBe(0)
        expect(container.alpha).toBe(1)
    })

    it('multiple consecutive apply calls remain idempotent', () => {
        const container = makeContainer({ position: [1, 2], pivot: [3, 4] })
        const snapshot = captureContainerBaseState(container, null)

        container.position.set(77, 88)
        applyContainerBaseTransform(container, snapshot)
        applyContainerBaseTransform(container, snapshot)
        applyContainerBaseTransform(container, snapshot)

        expect(container.position.x).toBe(1)
        expect(container.position.y).toBe(2)
        expect(container.pivot.x).toBe(3)
        expect(container.pivot.y).toBe(4)
    })
})
