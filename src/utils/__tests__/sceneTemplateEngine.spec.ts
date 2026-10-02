/**
 * sceneTemplateEngine Unit Tests
 * v17: Multi-root flat list structure
 */

import { describe, expect, it } from 'vitest'

import type { CompositeObject, SceneObject } from '@/types/sceneObject'

import {
    buildTemplateFromObjects,
    instantiateTemplate,
    snapshotToTemplate,
} from '../sceneTemplateEngine'

// ===== Helper factory functions =====

function makeObject(overrides: Partial<SceneObject> & { id: string; type: SceneObject['type'] }): SceneObject {
    return {
        name: overrides.name ?? `obj-${overrides.id}`,
        refId: '',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        flipX: false,
        visible: true,
        opacity: 1,
        zIndex: 0,
        initialAnimations: [],
        ...overrides,
    } as SceneObject
}

function makeComposite(id: string, childIds: string[], overrides?: Partial<CompositeObject>): CompositeObject {
    return {
        ...makeObject({ id, type: 'composite', ...overrides }),
        type: 'composite',
        childIds,
        compositeMode: 'union',
    } as CompositeObject
}

// ===== snapshotToTemplate =====

describe('snapshotToTemplate', () => {
    it('single object snapshot -> objects.length === 1', () => {
        const obj = makeObject({ id: 'a', type: 'prop', x: 100, y: 200 })
        const template = snapshotToTemplate([obj], [obj], 'test_template')

        expect(template.objects).toHaveLength(1)
        expect(template.name).toBe('test_template')
        expect(template.id).toMatch(/^stpl_/)
        expect(template.createdAt).toBeGreaterThan(0)
    })

    it('zero coordinates: single object -> center is (0, 0)', () => {
        const obj = makeObject({ id: 'a', type: 'prop', x: 300, y: 400 })
        const template = snapshotToTemplate([obj], [obj], 'test')

        expect(template.objects[0]!.x).toBe(0)
        expect(template.objects[0]!.y).toBe(0)
    })

    it('zero coordinates: multiple objects use bounding box center', () => {
        const a = makeObject({ id: 'a', type: 'prop', x: 0, y: 0 })
        const b = makeObject({ id: 'b', type: 'prop', x: 200, y: 100 })
        const template = snapshotToTemplate([a, b], [a, b], 'test')

        // Bounding box center: (100, 50)
        expect(template.objects[0]!.x).toBe(-100) // 0 - 100
        expect(template.objects[0]!.y).toBe(-50)   // 0 - 50
        expect(template.objects[1]!.x).toBe(100)    // 200 - 100
        expect(template.objects[1]!.y).toBe(50)     // 100 - 50
    })

    it('composite snapshot -> automatically collects child objects', () => {
        const child1 = makeObject({ id: 'c1', type: 'prop', parentId: 'comp' })
        const child2 = makeObject({ id: 'c2', type: 'prop', parentId: 'comp' })
        const composite = makeComposite('comp', ['c1', 'c2'])

        const allObjects = [composite, child1, child2]
        const template = snapshotToTemplate([composite], allObjects, 'composite_template')

        expect(template.objects).toHaveLength(3) // composite + 2 children
    })

    it('nested composite -> recursively collects', () => {
        const leaf = makeObject({ id: 'leaf', type: 'prop', parentId: 'inner' })
        const inner = makeComposite('inner', ['leaf'], { parentId: 'outer' } as Partial<CompositeObject>)
        const outer = makeComposite('outer', ['inner'])

        const allObjects: SceneObject[] = [outer, inner, leaf]
        const template = snapshotToTemplate([outer], allObjects, 'nested_template')

        expect(template.objects).toHaveLength(3)
    })

    it('deduplication: duplicate objects are not collected twice', () => {
        const obj = makeObject({ id: 'a', type: 'prop' })
        const template = snapshotToTemplate([obj, obj], [obj], 'dedup_test')

        expect(template.objects).toHaveLength(1)
    })

    it('tags are saved correctly', () => {
        const obj = makeObject({ id: 'a', type: 'prop' })
        const template = snapshotToTemplate([obj], [obj], 'tag_test', ['indoor', 'dialogue'])

        expect(template.tags).toEqual(['indoor', 'dialogue'])
    })

    it('tags field does not exist when there are no tags', () => {
        const obj = makeObject({ id: 'a', type: 'prop' })
        const template = snapshotToTemplate([obj], [obj], 'no_tags')

        expect(template.tags).toBeUndefined()
    })

    it('clears spawned field', () => {
        const obj = makeObject({ id: 'a', type: 'prop' }) as SceneObject & { spawned?: boolean }
        obj.spawned = false
        const template = snapshotToTemplate([obj], [obj as SceneObject], 'test')

        const result = template.objects[0] as unknown as Record<string, unknown>
        expect(result['spawned']).toBeUndefined()
    })

    it('top-level object parentId is cleared', () => {
        const obj = makeObject({ id: 'a', type: 'prop', parentId: 'external' })
        const template = snapshotToTemplate([obj], [obj], 'test')

        expect(template.objects[0]!.parentId).toBeUndefined()
    })

    it('records editorAnchor (bounding box center before zeroing)', () => {
        const a = makeObject({ id: 'a', type: 'prop', x: 300, y: 400 })
        const b = makeObject({ id: 'b', type: 'prop', x: 500, y: 600 })
        const template = snapshotToTemplate([a, b], [a, b], 'anchor_test')

        // Bounding box center: (400, 500)
        expect(template.editorAnchor).toEqual({ x: 400, y: 500 })
    })

    it('composite child local coordinates unaffected by zeroing (regression test)', () => {
        // Simulation: composite at canvas center (3360, 700), two children at local coordinates (-100, 0) and (100, 0)
        const child1 = makeObject({ id: 'c1', type: 'prop', x: -100, y: 0, parentId: 'comp' })
        const child2 = makeObject({ id: 'c2', type: 'prop', x: 100, y: 0, parentId: 'comp' })
        const composite = makeComposite('comp', ['c1', 'c2'], { x: 3360, y: 700 })

        const allObjects: SceneObject[] = [composite, child1, child2]
        const template = snapshotToTemplate([composite], allObjects, 'position_test')

        // editorAnchor should be world coordinate of composite (only 1 top object, center is itself)
        expect(template.editorAnchor).toEqual({ x: 3360, y: 700 })

        // composite zeroed -> (0, 0)
        const tplComp = template.objects.find(o => o.type === 'composite')!
        expect(tplComp.x).toBe(0)
        expect(tplComp.y).toBe(0)

        // Local coordinates of children should remain completely unchanged
        const tplChild1 = template.objects.find(o => o.id === 'c1')!
        const tplChild2 = template.objects.find(o => o.id === 'c2')!
        expect(tplChild1.x).toBe(-100)
        expect(tplChild1.y).toBe(0)
        expect(tplChild2.x).toBe(100)
        expect(tplChild2.y).toBe(0)

        // After instantiating to canvas center, composite returns to (3360, 700)
        const result = instantiateTemplate(template, 3360, 700, { autoWrapComposite: false })
        const instComp = result.objects.find(o => o.type === 'composite')!
        expect(instComp.x).toBe(3360)
        expect(instComp.y).toBe(700)

        // Child local coordinates still unchanged
        const instChildren = result.objects.filter(o => o.parentId === instComp.id)
        expect(instChildren).toHaveLength(2)
        const instChild1 = instChildren.find(o => o.x < 0)
        const instChild2 = instChildren.find(o => o.x > 0)
        expect(instChild1).toBeDefined()
        expect(instChild2).toBeDefined()
        expect(instChild1!.x).toBe(-100)
        expect(instChild1!.y).toBe(0)
        expect(instChild2!.x).toBe(100)
        expect(instChild2!.y).toBe(0)
    })
})

// ===== buildTemplateFromObjects =====

describe('buildTemplateFromObjects', () => {
    it('multiple top objects -> does not auto create wrapper composite', () => {
        const a = makeObject({ id: 'a', type: 'prop' })
        const b = makeObject({ id: 'b', type: 'prop' })
        const template = buildTemplateFromObjects([a, b], [a, b], 'multi_root_template')

        expect(template.objects).toHaveLength(2)
        // Ensure no auto-created composite
        expect(template.objects.every(o => o.type !== 'composite')).toBe(true)
    })

    it('empty array -> empty template', () => {
        const template = buildTemplateFromObjects([], [], 'empty_template')
        expect(template.objects).toHaveLength(0)
    })

    it('mixed top and child objects -> only top level as entry', () => {
        const child = makeObject({ id: 'c1', type: 'prop', parentId: 'comp' })
        const composite = makeComposite('comp', ['c1'])
        const standalone = makeObject({ id: 'alone', type: 'prop' })

        const allObjects = [composite, child, standalone]
        const template = buildTemplateFromObjects(allObjects, allObjects, 'mixed_template')

        // Top level: composite + standalone = 2 selected; composite recursively collects child
        // Total: composite + child + standalone = 3
        expect(template.objects).toHaveLength(3)
    })
})

// ===== instantiateTemplate =====

describe('instantiateTemplate', () => {
    it('all object IDs renewed (do not duplicate template IDs)', () => {
        const obj = makeObject({ id: 'original', type: 'prop' })
        const template = snapshotToTemplate([obj], [obj], 'test')

        const result = instantiateTemplate(template, 500, 300)

        expect(result.objects).toHaveLength(1)
        expect(result.objects[0]!.id).not.toBe('original')
        expect(result.objects[0]!.id).toMatch(/^obj_/)
    })

    it('coordinates restored to drop point (children are local after auto wrap)', () => {
        const a = makeObject({ id: 'a', type: 'prop', x: 0, y: 0 })
        const b = makeObject({ id: 'b', type: 'prop', x: 200, y: 100 })
        const template = snapshotToTemplate([a, b], [a, b], 'test')

        const result = instantiateTemplate(template, 500, 400)

        // wrapper composite at (500, 400)
        const wrapper = result.objects[0]!
        expect(wrapper.x).toBe(500)
        expect(wrapper.y).toBe(400)

        // Children store local coordinates (relative to composite)
        // In template a: (-100, -50), b: (100, 50)
        // World = template offset + drop = (400,350) / (600,450)
        // Local = world - composite = (-100,-50) / (100,50) - equals template offset
        expect(result.objects[1]!.x).toBe(-100)
        expect(result.objects[1]!.y).toBe(-50)
        expect(result.objects[2]!.x).toBe(100)
        expect(result.objects[2]!.y).toBe(50)
    })

    it('parentId / childIds correctly remapped', () => {
        const child = makeObject({ id: 'c1', type: 'prop', parentId: 'comp' })
        const composite = makeComposite('comp', ['c1'])
        const allObjects: SceneObject[] = [composite, child]

        const template = snapshotToTemplate([composite], allObjects, 'composite_test')
        const result = instantiateTemplate(template, 0, 0, { autoWrapComposite: false })

        const newComposite = result.objects.find(o => o.type === 'composite') as CompositeObject
        const newChild = result.objects.find(o => o.type === 'prop')

        expect(newComposite).toBeDefined()
        expect(newChild).toBeDefined()
        expect(newComposite.childIds).toContain(newChild!.id)
        expect(newChild!.parentId).toBe(newComposite.id)
    })

    it('internal object references remapped upon instantiation', () => {
        const target = makeObject({ id: 'target', type: 'prop', parentId: 'comp' })
        const mask = {
            ...makeObject({ id: 'mask', type: 'mask', parentId: 'comp' }),
            type: 'mask',
            shape: 'rectangle',
            mode: 'inside_visible',
            targetIds: ['target', 'external'],
        } as SceneObject & { targetIds: string[] }
        const effect = {
            ...makeObject({ id: 'effect', type: 'screen_effect', parentId: 'comp' }),
            type: 'screen_effect',
            effectClass: 'spotlight',
            params: { targetId: 'target' },
        } as SceneObject & { params: { targetId: string } }
        const composite = makeComposite('comp', ['target', 'mask', 'effect'], {
            instanceRootCompositeId: 'target',
        } as Partial<CompositeObject>)
        const allObjects: SceneObject[] = [composite, target, mask, effect]

        const template = snapshotToTemplate([composite], allObjects, 'ref_remap')
        const result = instantiateTemplate(template, 0, 0, { autoWrapComposite: false })
        const newTargetId = result.idMap.get('target')!
        const newMask = result.objects.find(o => o.id === result.idMap.get('mask')) as SceneObject & { targetIds: string[] }
        const newEffect = result.objects.find(o => o.id === result.idMap.get('effect')) as SceneObject & { params: { targetId: string } }
        const newComposite = result.objects.find(o => o.id === result.idMap.get('comp')) as CompositeObject

        expect(newMask.targetIds).toEqual([newTargetId, 'external'])
        expect(newEffect.params.targetId).toBe(newTargetId)
        expect(newComposite.instanceRootCompositeId).toBe(newTargetId)
    })

    it('empty template instantiation -> empty result', () => {
        const template = buildTemplateFromObjects([], [], 'empty_template')
        const result = instantiateTemplate(template, 100, 100)
        expect(result.objects).toHaveLength(0)
        expect(result.missingRefs).toHaveLength(0)
    })

    it('resource validation: detects missing refId', () => {
        const obj = makeObject({ id: 'a', type: 'prop', refId: 'missing-prop' })
        const template = snapshotToTemplate([obj], [obj], 'test')

        const checker = (_type: string, refId: string) => refId !== 'missing-prop'
        const result = instantiateTemplate(template, 0, 0, { resourceChecker: checker })

        expect(result.missingRefs).toContain('missing-prop')
    })

    it('multi-root template defaults to auto-wrapping entity composite', () => {
        const a = makeObject({ id: 'a', type: 'prop' })
        const b = makeObject({ id: 'b', type: 'prop' })
        const template = snapshotToTemplate([a, b], [a, b], 'multi_root_template')

        const result = instantiateTemplate(template, 500, 300)

        // Original 2 objects + 1 wrapper composite = 3
        expect(result.objects).toHaveLength(3)

        const wrapper = result.objects[0] as CompositeObject
        expect(wrapper.type).toBe('composite')
        expect(wrapper.compositeMode).toBe('entity')
        expect(wrapper.compositeLocked).toBe(true)
        expect(wrapper.childIds).toHaveLength(2)

        // Child parentId points to wrapper
        const child1 = result.objects[1]!
        const child2 = result.objects[2]!
        expect(child1.parentId).toBe(wrapper.id)
        expect(child2.parentId).toBe(wrapper.id)
        expect(wrapper.childIds).toContain(child1.id)
        expect(wrapper.childIds).toContain(child2.id)
    })

    it('single root template does not wrap composite', () => {
        const obj = makeObject({ id: 'a', type: 'prop' })
        const template = snapshotToTemplate([obj], [obj], 'single_root_template')

        const result = instantiateTemplate(template, 500, 300)

        expect(result.objects).toHaveLength(1)
        expect(result.objects[0]!.type).toBe('prop')
    })

    it('does not wrap when autoWrapComposite: false', () => {
        const a = makeObject({ id: 'a', type: 'prop' })
        const b = makeObject({ id: 'b', type: 'prop' })
        const template = snapshotToTemplate([a, b], [a, b], 'no_wrap')

        const result = instantiateTemplate(template, 500, 300, { autoWrapComposite: false })

        expect(result.objects).toHaveLength(2)
        expect(result.objects.every(o => o.type !== 'composite')).toBe(true)
    })

    it('multi-root template with existing composite: wraps only top level', () => {
        const child = makeObject({ id: 'c1', type: 'prop', parentId: 'comp' })
        const composite = makeComposite('comp', ['c1'])
        const standalone = makeObject({ id: 'alone', type: 'prop' })

        const allObjects: SceneObject[] = [composite, child, standalone]
        const template = snapshotToTemplate([composite, standalone], allObjects, 'mixed')

        const result = instantiateTemplate(template, 0, 0)

        // 3 original objects + 1 wrapper = 4
        expect(result.objects).toHaveLength(4)

        const wrapper = result.objects[0] as CompositeObject
        expect(wrapper.type).toBe('composite')
        expect(wrapper.compositeMode).toBe('entity')
        // wrapper childIds only contains 2 top objects (composite and standalone)
        expect(wrapper.childIds).toHaveLength(2)
    })

    it('coordinates restored (autoWrapComposite: false)', () => {
        const a = makeObject({ id: 'a', type: 'prop', x: 0, y: 0 })
        const b = makeObject({ id: 'b', type: 'prop', x: 200, y: 100 })
        const template = snapshotToTemplate([a, b], [a, b], 'test')

        const result = instantiateTemplate(template, 500, 400, { autoWrapComposite: false })

        // In template a: (-100, -50), b: (100, 50)
        // After placement a: (400, 350), b: (600, 450)
        expect(result.objects[0]!.x).toBe(400)
        expect(result.objects[0]!.y).toBe(350)
        expect(result.objects[1]!.x).toBe(600)
        expect(result.objects[1]!.y).toBe(450)
    })
})
