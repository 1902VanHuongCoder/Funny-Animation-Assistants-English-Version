/**
 * @vitest-environment happy-dom
 *
 * maskRenderer Unit Tests (Clip-Mask Phase 1)
 *
 * Covers 5 core scenarios:
 * 1. Stable first-come-first-served in ascending index: when same target claimed by two masks, smaller index in objects array wins.
 * 2. Idempotent repeated invocations: consecutive applyAllMasks should not accumulate Graphics / claims.
 * 3. Matrix correct under composite hierarchy: when target is in nested container (offset+scale), graphics.worldTransform === maskContainer.worldTransform.
 * 4. Matrix correct under camera zoom: after stage overall scaling, geometric clipping positions remain aligned.
 * 5. Conflict warning: subsequent masks trigger console.warn.
 */

import * as PIXI from 'pixi.js'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
    applyAllMasks,
    createMaskRendererResources,
    disposeMaskRendererResources,
} from '../maskRenderer'

import type { MaskObject, SceneObject } from '@/types/sceneObject'

// happy-dom has no canvas 2d context; PIXI.Graphics construction reads Texture.WHITE,
// which creates a 16x16 canvas and calls fillRect. Redirect WHITE to EMPTY here to bypass.
beforeAll(() => {
    Object.defineProperty(PIXI.Texture, 'WHITE', {
        get() { return PIXI.Texture.EMPTY },
        configurable: true,
    })
})

// ============================================================================
// Helpers
// ============================================================================

function makeProp(id: string, x = 0, y = 0): SceneObject {
    return {
        id,
        type: 'prop',
        refId: 'r',
        alias: id,
        x,
        y,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        alpha: 1,
        flipX: false,
        zIndex: 0,
        visible: true,
        width: 100,
        height: 100,
    } as unknown as SceneObject
}

function makeMask(
    id: string,
    targetIds: string[],
    overrides: Partial<MaskObject> = {},
): MaskObject {
    return {
        id,
        type: 'mask',
        refId: '',
        alias: id,
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        alpha: 1,
        flipX: false,
        zIndex: 0,
        visible: true,
        width: 200,
        height: 200,
        shape: 'rectangle',
        mode: 'inside_visible',
        targetIds,
        ...overrides,
    } as unknown as MaskObject
}

interface RootSetup {
    root: PIXI.Container
    containers: Map<string, PIXI.Container>
}

/**
 * Creates target container under root (position = obj.x/y) and mask container (position = mask.x/y).
 * Returns container mapping.
 */
function makeScene(
    objects: SceneObject[],
    rootScale = 1,
    rootOffset: { x: number; y: number } = { x: 0, y: 0 },
): RootSetup {
    const root = new PIXI.Container()
    root.scale.set(rootScale)
    root.position.set(rootOffset.x, rootOffset.y)
    const containers = new Map<string, PIXI.Container>()
    for (const obj of objects) {
        const c = new PIXI.Container()
        c.name = obj.id
        c.position.set(obj.x ?? 0, obj.y ?? 0)
        // For mask container we don't render anything, that's fine.
        root.addChild(c)
        containers.set(obj.id, c)
    }
    return { root, containers }
}

function getContainerFn(map: Map<string, PIXI.Container>) {
    return (id: string) => map.get(id)
}

/**
 * Manually drive PIXI Transform to compute worldTransform.
 * PIXI Container.updateTransform() assumes container has a parent; in tests root parent=null would throw.
 * Recursively computes worldTransform = parentWorld * localTransform.
 */
function pumpWorldTransforms(root: PIXI.Container, parentWorld: PIXI.Matrix = PIXI.Matrix.IDENTITY): void {
    root.transform.updateLocalTransform()
    const local = root.transform.localTransform
    const world = root.transform.worldTransform
    world.copyFrom(parentWorld).append(local)
    for (const child of root.children) {
        pumpWorldTransforms(child as PIXI.Container, world)
    }
}

// ============================================================================
// Tests
// ============================================================================

afterEach(() => {
    vi.restoreAllMocks()
})

describe('maskRenderer.applyAllMasks', () => {
    it('grants contested target to mask with smaller stable index', () => {
        const target = makeProp('t1', 50, 50)
        const maskA = makeMask('mA', ['t1'])
        const maskB = makeMask('mB', ['t1'])
        const objects: SceneObject[] = [target, maskA, maskB]
        const { root, containers } = makeScene(objects)
        pumpWorldTransforms(root)

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const res = createMaskRendererResources()

        applyAllMasks(objects, getContainerFn(containers), res)

        expect(res.claims.get('t1')).toBe('mA')
        expect(res.graphics.size).toBe(1)
        expect(warnSpy).toHaveBeenCalled()
        const wrapper = res.wrappers.get('t1')!
        expect(wrapper.mask).toBeNull()
        expect(wrapper.filters?.[0]).toBe(res.spriteFilters.get('mA::t1'))
        expect(containers.get('t1')!.filters).toBeNull()
        expect(res.spriteFilters.get('mA::t1')?.maskSprite).toBe(res.spriteMasks.get('mA::t1'))
        expect(containers.get('t1')!.parent).toBe(wrapper)
        expect(res.graphics.get('mA::t1')!.parent).toBe(root)
        expect(res.spriteMasks.get('mA::t1')!.parent).toBe(root)
        expect(wrapper.children.includes(res.graphics.get('mA::t1')!)).toBe(false)

        disposeMaskRendererResources(res)
    })

    it('is idempotent on repeated invocations', () => {
        const target = makeProp('t1', 0, 0)
        const mask = makeMask('m1', ['t1'])
        const objects: SceneObject[] = [target, mask]
        const { root, containers } = makeScene(objects)
        pumpWorldTransforms(root)

        const res = createMaskRendererResources()
        applyAllMasks(objects, getContainerFn(containers), res)
        const firstSize = res.graphics.size
        const firstGraphics = res.graphics.get('m1::t1')

        // Repeat 3 times
        for (let i = 0; i < 3; i++) {
            pumpWorldTransforms(root)
            applyAllMasks(objects, getContainerFn(containers), res)
        }

        expect(res.graphics.size).toBe(firstSize)
        expect(res.graphics.get('m1::t1')).toBe(firstGraphics)
        expect(res.claims.size).toBe(1)

        disposeMaskRendererResources(res)
    })

    it('produces graphics whose worldTransform equals mask worldTransform under composite parent', () => {
        // Simulate composite: target in nested container under root (offset 100,50, scale 0.5)
        const compositeRoot = new PIXI.Container()
        compositeRoot.position.set(100, 50)
        compositeRoot.scale.set(0.5, 0.5)

        const target = makeProp('t1', 20, 30)
        const targetContainer = new PIXI.Container()
        targetContainer.name = 't1'
        targetContainer.position.set(20, 30)
        compositeRoot.addChild(targetContainer)

        const mask = makeMask('m1', ['t1'], { x: 10, y: 5, width: 80, height: 60 })
        const maskContainer = new PIXI.Container()
        maskContainer.name = 'm1'
        maskContainer.position.set(10, 5)
        // mask is at root (not composite child), as is the case for non-composite-parented masks
        const stage = new PIXI.Container()
        stage.addChild(compositeRoot)
        stage.addChild(maskContainer)
        pumpWorldTransforms(stage)

        const containers = new Map<string, PIXI.Container>([
            ['t1', targetContainer],
            ['m1', maskContainer],
        ])

        const res = createMaskRendererResources()
        applyAllMasks([target, mask], getContainerFn(containers), res)

        const g = res.graphics.get('m1::t1')!
        // graphics.worldTransform should match maskContainer.worldTransform
        const gw = g.worldTransform
        const mw = maskContainer.worldTransform
        const eps = 1e-3
        expect(Math.abs(gw.a - mw.a)).toBeLessThan(eps)
        expect(Math.abs(gw.b - mw.b)).toBeLessThan(eps)
        expect(Math.abs(gw.c - mw.c)).toBeLessThan(eps)
        expect(Math.abs(gw.d - mw.d)).toBeLessThan(eps)
        expect(Math.abs(gw.tx - mw.tx)).toBeLessThan(0.5)
        expect(Math.abs(gw.ty - mw.ty)).toBeLessThan(0.5)

        disposeMaskRendererResources(res)
    })

    it('matrix remains correct under camera zoom (stage scaled)', () => {
        const stage = new PIXI.Container()
        stage.scale.set(2, 2) // camera zoom-in

        const target = makeProp('t1', 100, 80)
        const targetC = new PIXI.Container()
        targetC.name = 't1'
        targetC.position.set(100, 80)
        stage.addChild(targetC)

        const mask = makeMask('m1', ['t1'], { x: 50, y: 40, width: 30, height: 20 })
        const maskC = new PIXI.Container()
        maskC.name = 'm1'
        maskC.position.set(50, 40)
        stage.addChild(maskC)

        pumpWorldTransforms(stage)

        const containers = new Map<string, PIXI.Container>([
            ['t1', targetC],
            ['m1', maskC],
        ])

        const res = createMaskRendererResources()
        applyAllMasks([target, mask], getContainerFn(containers), res)

        const g = res.graphics.get('m1::t1')!
        const gw = g.worldTransform
        const mw = maskC.worldTransform
        expect(Math.abs(gw.tx - mw.tx)).toBeLessThan(0.5)
        expect(Math.abs(gw.ty - mw.ty)).toBeLessThan(0.5)
        expect(Math.abs(gw.a - mw.a)).toBeLessThan(1e-3)
        expect(Math.abs(gw.d - mw.d)).toBeLessThan(1e-3)

        disposeMaskRendererResources(res)
    })

    it('tears down stale claims when mask becomes invisible', () => {
        const target = makeProp('t1', 0, 0)
        const mask = makeMask('m1', ['t1'])
        const objects: SceneObject[] = [target, mask]
        const { root, containers } = makeScene(objects)
        pumpWorldTransforms(root)

        const res = createMaskRendererResources()
        applyAllMasks(objects, getContainerFn(containers), res)
        expect(res.claims.size).toBe(1)
        expect(res.wrappers.get('t1')?.mask).toBeNull()
        expect(res.wrappers.get('t1')?.filters?.[0]).toBe(res.spriteFilters.get('m1::t1'))
        expect(containers.get('t1')!.filters).toBeNull()
        expect(containers.get('t1')!.parent).toBe(res.wrappers.get('t1'))

        // Make mask invisible -> should release on next frame
        ;(mask as SceneObject).visible = false
        applyAllMasks(objects, getContainerFn(containers), res)
        expect(res.claims.size).toBe(0)
        expect(res.graphics.size).toBe(0)
        expect(res.spriteMasks.size).toBe(0)
        expect(res.spriteFilters.size).toBe(0)
        expect(res.wrappers.size).toBe(0)
        expect(containers.get('t1')!.mask).toBeNull()
        expect(containers.get('t1')!.parent).toBe(root)

        disposeMaskRendererResources(res)
    })
})
