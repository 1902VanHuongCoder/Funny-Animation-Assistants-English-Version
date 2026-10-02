/**
 * renderChain Tests
 * Simulates character editor import workflow, verifying renderChain helper correctness
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { CompositeObject, ScreenEffectObject, SymbolObject, TextObject } from '@/types/sceneObject'

/**
 * Simulates output structure of convertConfigToSceneObjects:
 * entity composite (no parentId) + symbol child objects (with parentId)
 */
function createImportedCharacterObjects() {
    const compositeId = 'sceneobject_composite_1'
    const child1Id = 'sceneobject_symbol_1'
    const child2Id = 'sceneobject_symbol_2'
    const child3Id = 'sceneobject_symbol_3'

    const composite: CompositeObject = {
        id: compositeId,
        type: 'composite',
        name: 'Imported Character',
        alias: 'Imported Character',
        refId: '',
        childIds: [child1Id, child2Id, child3Id],
        compositeLocked: true,
        compositeMode: 'entity',
        x: 3360,
        y: 700,
        width: 0,
        height: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        alpha: 1,
        flipX: false,
        zIndex: 10,
        visible: true,
    }

    const child1: SymbolObject = {
        id: child1Id,
        type: 'symbol',
        name: 'Back Hair',
        alias: 'Back Hair',
        refId: '',
        parentId: compositeId,
        materials: [],
        x: 0,
        y: -50,
        width: 100,
        height: 100,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        alpha: 1,
        flipX: false,
        zIndex: 10,
        visible: true,
    }

    const child2: SymbolObject = {
        id: child2Id,
        type: 'symbol',
        name: 'Body',
        alias: 'Body',
        refId: '',
        parentId: compositeId,
        materials: [],
        x: 0,
        y: 0,
        width: 200,
        height: 300,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        alpha: 1,
        flipX: false,
        zIndex: 10,
        visible: true,
    }

    const child3: SymbolObject = {
        id: child3Id,
        type: 'symbol',
        name: 'Front Hair',
        alias: 'Front Hair',
        refId: '',
        parentId: compositeId,
        materials: [],
        x: 0,
        y: -40,
        width: 120,
        height: 80,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        alpha: 1,
        flipX: false,
        zIndex: 10,
        visible: true,
    }

    // configImporter returned order: composite first, child objects after (DFS order)
    return {
        compositeId,
        child1Id,
        child2Id,
        child3Id,
        objects: [composite, child1, child2, child3],
    }
}

describe('renderChain: Character editor import workflow', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('RC-IMPORT-01: after import sceneRenderChain contains root composite only', () => {
        const store = useSceneObjectStore()
        store.setActionMode(false)
        store.clearObjects()

        const { compositeId, child1Id, child2Id, child3Id, objects } = createImportedCharacterObjects()

        // Simulate import: addObject one by one
        for (const obj of objects) {
            store.addObject(obj)
        }

        const chain = store.getSceneRenderChain()
        console.log('[RC-IMPORT-01] sceneRenderChain:', chain)

        // renderChain should contain root composite only
        expect(chain).toContain(compositeId)
        expect(chain).not.toContain(child1Id)
        expect(chain).not.toContain(child2Id)
        expect(chain).not.toContain(child3Id)
        expect(chain.length).toBe(1)
    })

    it('RC-IMPORT-02: getSortedObjects must return all objects (including children)', () => {
        const store = useSceneObjectStore()
        store.setActionMode(false)
        store.clearObjects()

        const { compositeId, child1Id, child2Id, child3Id, objects } = createImportedCharacterObjects()

        for (const obj of objects) {
            store.addObject(obj)
        }

        const sorted = store.getSortedObjects()
        const sortedIds = sorted.map(o => o.id)
        console.log('[RC-IMPORT-02] getSortedObjects ids:', sortedIds)
        console.log('[RC-IMPORT-02] getSortedObjects types:', sorted.map(o => o.type))
        console.log('[RC-IMPORT-02] getSortedObjects parentIds:', sorted.map(o => o.parentId ?? 'ROOT'))

        // Must include all 4 objects
        expect(sorted.length).toBe(4)
        expect(sortedIds).toContain(compositeId)
        expect(sortedIds).toContain(child1Id)
        expect(sortedIds).toContain(child2Id)
        expect(sortedIds).toContain(child3Id)
    })

    it('RC-IMPORT-03: getChildObjects returns child objects of entity', () => {
        const store = useSceneObjectStore()
        store.setActionMode(false)
        store.clearObjects()

        const { compositeId, child1Id, child2Id, child3Id, objects } = createImportedCharacterObjects()

        for (const obj of objects) {
            store.addObject(obj)
        }

        const children = store.getChildObjects(compositeId)
        const childIds = children.map(o => o.id)
        console.log('[RC-IMPORT-03] getChildObjects ids:', childIds)

        expect(children.length).toBe(3)
        expect(childIds).toContain(child1Id)
        expect(childIds).toContain(child2Id)
        expect(childIds).toContain(child3Id)
    })

    it('RC-IMPORT-04: edit mode loading (instantiateTemplate workflow)', () => {
        const store = useSceneObjectStore()
        store.setActionMode(false)
        store.clearObjects()

        const { objects } = createImportedCharacterObjects()

        // Simulate edit mode loading: consistent with CompositeCharacterEditor onMounted
        for (const obj of objects) {
            store.addObject(obj)
        }

        // Verify store.objects contains all objects
        const allObjects = store.objects
        console.log('[RC-IMPORT-04] store.objects count:', allObjects.length)
        console.log('[RC-IMPORT-04] store.objects ids:', allObjects.map(o => o.id))
        expect(allObjects.length).toBe(4)

        // Verify getSortedObjects returns all objects
        const sorted = store.getSortedObjects()
        console.log('[RC-IMPORT-04] getSortedObjects count:', sorted.length)
        expect(sorted.length).toBe(4)

        // Verify renderChain
        const chain = store.getSceneRenderChain()
        console.log('[RC-IMPORT-04] renderChain:', chain)
        expect(chain.length).toBe(1)

        // Simulate render loop: iterate getSortedObjects, every object should process normally
        for (const obj of sorted) {
            if (obj.parentId) {
                // Child object: should locate parent object
                const parent = store.getObject(obj.parentId)
                expect(parent).toBeDefined()
                console.log(`[RC-IMPORT-04] Child ${obj.id} (${obj.type}) -> Parent ${obj.parentId} (${parent?.type})`)
            } else {
                console.log(`[RC-IMPORT-04] Root object ${obj.id} (${obj.type})`)
            }
        }
    })

    it('RC-IMPORT-05: getRootObjects excludes child objects', () => {
        const store = useSceneObjectStore()
        store.setActionMode(false)
        store.clearObjects()

        const { compositeId, objects } = createImportedCharacterObjects()

        for (const obj of objects) {
            store.addObject(obj)
        }

        const rootObjects = store.getRootObjects()
        const rootIds = rootObjects.map(o => o.id)
        console.log('[RC-IMPORT-05] rootObjects ids:', rootIds)

        // Root object has only composite (object without parentId)
        expect(rootIds).toContain(compositeId)
        // Child objects should not appear in root list
        expect(rootIds.length).toBe(1)
    })
})

describe('renderChain: Render order after union grouping', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    /**
     * Simulated scenario: entity composite contains 3 children (back hair, head, body)
     * User selects 2 of them (back hair, head) to create union
     */
    it('RC-UNION-01: renderChain preserves child object original order after union grouping', () => {
        const store = useSceneObjectStore()
        store.setActionMode(false)
        store.clearObjects()

        // Create 3 root objects (simulating entity children flattened at root)
        const obj1: SymbolObject = {
            id: 'obj_hair_back', type: 'symbol', name: 'Back Hair', alias: 'Back Hair',
            refId: '', materials: [],
            x: 0, y: -50, width: 100, height: 100,
            scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, flipX: false,
            zIndex: 10, visible: true,
        }
        const obj2: SymbolObject = {
            id: 'obj_head', type: 'symbol', name: 'Head', alias: 'Head',
            refId: '', materials: [],
            x: 0, y: 0, width: 200, height: 200,
            scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, flipX: false,
            zIndex: 10, visible: true,
        }
        const obj3: SymbolObject = {
            id: 'obj_body', type: 'symbol', name: 'Body', alias: 'Body',
            refId: '', materials: [],
            x: 0, y: 100, width: 200, height: 300,
            scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, flipX: false,
            zIndex: 10, visible: true,
        }

        store.addObject(obj1)
        store.addObject(obj2)
        store.addObject(obj3)

        const chainBefore = [...store.getSceneRenderChain()]
        console.log('[RC-UNION-01] renderChain BEFORE:', chainBefore)
        // Before grouping: all 3 objects in renderChain
        expect(chainBefore).toEqual(['obj_hair_back', 'obj_head', 'obj_body'])

        // Group: back hair + head -> union
        const union = store.groupObjects(['obj_hair_back', 'obj_head'], 'union')
        console.log('[RC-UNION-01] union created:', union.id, 'compositeMode:', union.compositeMode)

        const chainAfter = [...store.getSceneRenderChain()]
        console.log('[RC-UNION-01] renderChain AFTER:', chainAfter)

        // Key assertion: union should not appear in renderChain
        expect(chainAfter).not.toContain(union.id)

        // Key assertion: child objects stay in renderChain with order preserved
        // Back hair remains before head, body at end
        const hairIdx = chainAfter.indexOf('obj_hair_back')
        const headIdx = chainAfter.indexOf('obj_head')
        const bodyIdx = chainAfter.indexOf('obj_body')
        console.log('[RC-UNION-01] positions: hair=%d, head=%d, body=%d', hairIdx, headIdx, bodyIdx)

        expect(hairIdx).toBeGreaterThanOrEqual(0)
        expect(headIdx).toBeGreaterThanOrEqual(0)
        expect(bodyIdx).toBeGreaterThanOrEqual(0)
        expect(hairIdx).toBeLessThan(headIdx)  // Back hair before head
        expect(headIdx).toBeLessThan(bodyIdx)  // Head before body
    })

    it('RC-UNION-02: getSortedObjects order remains unchanged after union grouping', () => {
        const store = useSceneObjectStore()
        store.setActionMode(false)
        store.clearObjects()

        const obj1: SymbolObject = {
            id: 'A', type: 'symbol', name: 'A', alias: 'A',
            refId: '', materials: [],
            x: 0, y: 0, width: 10, height: 10,
            scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, flipX: false,
            zIndex: 10, visible: true,
        }
        const obj2: SymbolObject = {
            id: 'B', type: 'symbol', name: 'B', alias: 'B',
            refId: '', materials: [],
            x: 10, y: 0, width: 10, height: 10,
            scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, flipX: false,
            zIndex: 10, visible: true,
        }
        const obj3: SymbolObject = {
            id: 'C', type: 'symbol', name: 'C', alias: 'C',
            refId: '', materials: [],
            x: 20, y: 0, width: 10, height: 10,
            scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, flipX: false,
            zIndex: 10, visible: true,
        }

        store.addObject(obj1)
        store.addObject(obj2)
        store.addObject(obj3)

        // getSortedObjects order before grouping
        const sortedBefore = store.getSortedObjects().map(o => o.id)
        console.log('[RC-UNION-02] sortedObjects BEFORE:', sortedBefore)

        // B + C → union
        const union = store.groupObjects(['B', 'C'], 'union')

        const sortedAfter = store.getSortedObjects().map(o => o.id)
        console.log('[RC-UNION-02] sortedObjects AFTER:', sortedAfter)

        // Relative order of A, B, C should remain unchanged (union placed at end as off-chain object)
        const aIdx = sortedAfter.indexOf('A')
        const bIdx = sortedAfter.indexOf('B')
        const cIdx = sortedAfter.indexOf('C')
        console.log('[RC-UNION-02] positions: A=%d, B=%d, C=%d, union=%d', aIdx, bIdx, cIdx, sortedAfter.indexOf(union.id))

        expect(aIdx).toBeLessThan(bIdx)
        expect(bIdx).toBeLessThan(cIdx)
    })
})

describe('renderChain: Text object participation in scene ordering', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('RC-TEXT-01: text should enter renderChain and position below screen effects by zIndex', () => {
        const store = useSceneObjectStore()
        store.setActionMode(false)
        store.clearObjects()

        const text: TextObject = {
            id: 'text_1',
            type: 'text',
            name: 'Text',
            alias: 'Text',
            refId: '',
            content: 'Test Text',
            fontSize: 72,
            fontFamily: 'Noto Sans SC',
            fontWeight: 'normal',
            fontStyle: 'normal',
            color: '#ffffff',
            align: 'center',
            wordWrap: false,
            wordWrapWidth: 400,
            x: 0,
            y: 0,
            width: 400,
            height: 100,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            alpha: 1,
            flipX: false,
            zIndex: 100,
            visible: true,
        }
        const effect: ScreenEffectObject = {
            id: 'effect_1',
            type: 'screen_effect',
            name: 'Screen Effect',
            alias: 'Screen Effect',
            refId: 'screen_effect',
            effectClass: 'screen_effect',
            params: { baseColor: '#000000', openRatio: 1 },
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            alpha: 1,
            flipX: false,
            zIndex: 1000,
            visible: true,
        }

        store.addObject(effect)
        store.addObject(text)

        const chain = store.getSceneRenderChain()
        expect(chain).toEqual(['text_1', 'effect_1'])
    })
})
