/**
 * P2: Composite Object Unit Tests
 *
 * Covers:
 * - createCompositeObject factory function
 * - removeObject cascade deletion
 * - getChildObjects / getRootObjects queries
 * - toSetupObject / fromSetupObject serialization cycle
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CompositeObject } from '@/types/sceneObject'
import { localToGlobal as resolveActionWorldTransform } from '@/utils/actionHandlers/matrixUtils'
import { resolveWorldMatrix } from '@/utils/actionHandlers/handlers/SetParentHandler'
import type { WriteableState } from '@/utils/actionHandlers/types'

import { useSceneObjectStore } from '../sceneObjectStore'

function expectWorldMatrixClose(
    actual: ReturnType<typeof resolveWorldMatrix>,
    expected: ReturnType<typeof resolveWorldMatrix>,
    digits = 5
): void {
    expect(actual.a).toBeCloseTo(expected.a, digits)
    expect(actual.b).toBeCloseTo(expected.b, digits)
    expect(actual.c).toBeCloseTo(expected.c, digits)
    expect(actual.d).toBeCloseTo(expected.d, digits)
    expect(actual.tx).toBeCloseTo(expected.tx, digits)
    expect(actual.ty).toBeCloseTo(expected.ty, digits)
}

// Mock stores that sceneObjectStore depends on
vi.mock('../characterStore', () => ({
    useCharacterStore: vi.fn(() => ({
        getCharacter: vi.fn(),
        characters: [],
    })),
}))

vi.mock('../projectStore', () => ({
    useProjectStore: vi.fn(() => ({
        markAsUnsaved: vi.fn(),
    })),
}))

describe('Composite Object - sceneObjectStore', () => {
    let store: ReturnType<typeof useSceneObjectStore>

    beforeEach(() => {
        setActivePinia(createPinia())
        store = useSceneObjectStore()
    })

    // ==================== createCompositeObject ====================

    describe('createCompositeObject', () => {
        it('should create a composite object with correct fields', () => {
            const composite = store.createCompositeObject('test_group', [])

            expect(composite.type).toBe('composite')
            expect(composite.name).toBe('test_group')
            expect(composite.childIds).toEqual([])
            expect(composite.id).toContain('sceneobject')
            expect(composite.refId).toBe('')
        })

        it('should set parentId on child objects', () => {
            // Create child objects first
            const prop = store.createPropObject('prop1', 'prop1')
            const bg = store.createBackgroundObject('bg1', 'bg1')

            // Create composite, specify children
            const composite = store.createCompositeObject('group1', [prop.id, bg.id])

            expect(composite.childIds).toContain(prop.id)
            expect(composite.childIds).toContain(bg.id)

            // Verify child parentId is set
            const updatedProp = store.getObject(prop.id)
            const updatedBg = store.getObject(bg.id)
            expect(updatedProp?.parentId).toBe(composite.id)
            expect(updatedBg?.parentId).toBe(composite.id)
        })

        it('should generate unique alias', () => {
            const c1 = store.createCompositeObject('group')
            const c2 = store.createCompositeObject('group')

            expect(c1.alias).toBe('group')
            expect(c2.alias).toBe('group1')
        })

        it('should generate unique alias inside an entity namespace', () => {
            const entity = store.createCompositeObject('Gu Yanzhou', [], undefined, undefined, 'entity')
            const existingGroup = store.createCompositeObject('group', [], undefined, undefined, 'union')
            existingGroup.parentId = entity.id
            entity.childIds = [existingGroup.id]

            const nextGroup = store.createCompositeObject('group', [], undefined, undefined, 'union', entity.id)

            expect(existingGroup.alias).toBe('group')
            expect(nextGroup.alias).toBe('group1')
        })

        it('should use custom id and alias when provided', () => {
            const composite = store.createCompositeObject('test', [], 'custom-id', 'custom-alias')

            expect(composite.id).toBe('custom-id')
            expect(composite.alias).toBe('custom-alias')
        })
    })

    // ==================== removeObject (cascade) ====================

    describe('removeObject (cascade delete)', () => {
        it('should cascade delete child objects when composite is removed', () => {
            const prop1 = store.createPropObject('p1', 'prop1')
            const prop2 = store.createPropObject('p2', 'prop2')
            const composite = store.createCompositeObject('group', [prop1.id, prop2.id], undefined, undefined, 'entity')

            expect(store.objects.length).toBe(3)

            // Delete composite object
            store.removeObject(composite.id)

            // All objects are deleted
            expect(store.objects.length).toBe(0)
            expect(store.getObject(prop1.id)).toBeUndefined()
            expect(store.getObject(prop2.id)).toBeUndefined()
            expect(store.getObject(composite.id)).toBeUndefined()
        })

        it('should remove child from parent childIds when deleting a child directly', () => {
            const prop = store.createPropObject('p1', 'prop1')
            const composite = store.createCompositeObject('group', [prop.id])

            // Delete child object directly
            store.removeObject(prop.id)

            // Child object is deleted
            expect(store.getObject(prop.id)).toBeUndefined()

            // Parent childIds is updated
            const parent = store.getObject(composite.id) as CompositeObject
            expect(parent.childIds).toEqual([])
        })

        it('should handle nested composite cascade', () => {
            const innerProp = store.createPropObject('p1', 'inner_prop')
            const innerComposite = store.createCompositeObject('inner_group', [innerProp.id], undefined, undefined, 'entity')
            const outerComposite = store.createCompositeObject('outer_group', [innerComposite.id], undefined, undefined, 'entity')

            expect(store.objects.length).toBe(3)

            // Delete outer composite
            store.removeObject(outerComposite.id)

            // All nested objects are deleted
            expect(store.objects.length).toBe(0)
        })

        it('should clear selectedObjectId when deleted object was selected', () => {
            const composite = store.createCompositeObject('group', [])
            store.selectObject(composite.id)

            expect(store.selectedObjectId).toBe(composite.id)

            store.removeObject(composite.id)
            expect(store.selectedObjectId).toBeNull()
        })

        it('should clear child parentId in setup state when removing a union composite in action mode', () => {
            const childA = store.createPropObject('p1', 'child1')
            const childB = store.createAudioObject('a1', 'child2')
            const unionComposite = store.createCompositeObject('group', [childA.id, childB.id], undefined, undefined, 'union')

            expect(store.getSetupObject(childA.id)?.parentId).toBe(unionComposite.id)
            expect(store.getSetupObject(childB.id)?.parentId).toBe(unionComposite.id)

            store.setActionMode(true)
            store.removeSetupObject(unionComposite.id)

            expect(store.getSetupObject(unionComposite.id)).toBeUndefined()
            expect(store.getSetupObject(childA.id)?.parentId).toBeUndefined()
            expect(store.getSetupObject(childB.id)?.parentId).toBeUndefined()

            store.setActionMode(false)
            store.setActionMode(true)

            expect(store.getObject(childA.id)?.parentId).toBeUndefined()
            expect(store.getObject(childB.id)?.parentId).toBeUndefined()
        })
    })

    describe('selectObject auto-relock', () => {
        it('should relock an unlocked composite when clearing selection in setup mode', () => {
            const prop = store.createPropObject('p1', 'prop1')
            const composite = store.createCompositeObject('group', [prop.id]) as CompositeObject

            store.updateObject(composite.id, { compositeLocked: false } as Partial<CompositeObject>)
            expect((store.getObject(composite.id) as CompositeObject).compositeLocked).toBe(false)

            store.selectObject(null)

            expect((store.getObject(composite.id) as CompositeObject).compositeLocked).toBe(true)
        })

        it('should relock an unlocked composite when clearing selection in action mode', () => {
            const prop = store.createPropObject('p1', 'prop1')
            const composite = store.createCompositeObject('group', [prop.id]) as CompositeObject

            store.setActionMode(true)
            store.updateSetupObject(composite.id, { compositeLocked: false } as Partial<CompositeObject>)
            expect((store.getSetupObject(composite.id) as CompositeObject).compositeLocked).toBe(false)
            expect((store.getObject(composite.id) as CompositeObject).compositeLocked).toBe(false)

            store.selectObject(null)

            expect((store.getSetupObject(composite.id) as CompositeObject).compositeLocked).toBe(true)
            expect((store.getObject(composite.id) as CompositeObject).compositeLocked).toBe(true)
        })
    })

    describe('getChildObjects', () => {
        it('should return children of a composite object', () => {
            const prop1 = store.createPropObject('p1', 'prop1')
            const prop2 = store.createPropObject('p2', 'prop2')
            const standalone = store.createPropObject('p3', 'standalone_prop')
            const composite = store.createCompositeObject('group', [prop1.id, prop2.id])

            const children = store.getChildObjects(composite.id)
            expect(children.length).toBe(2)
            expect(children.map(c => c.id)).toContain(prop1.id)
            expect(children.map(c => c.id)).toContain(prop2.id)
            expect(children.map(c => c.id)).not.toContain(standalone.id)
        })

        it('should return children in childIds order', () => {
            const prop1 = store.createPropObject('p1', 'prop1')
            const prop2 = store.createPropObject('p2', 'prop2')
            const prop3 = store.createPropObject('p3', 'prop3')
            const composite = store.createCompositeObject('group', [prop2.id, prop3.id, prop1.id])

            const children = store.getChildObjects(composite.id)
            expect(children.map(c => c.id)).toEqual([prop2.id, prop3.id, prop1.id])
        })

        it('should return empty array for objects without children', () => {
            const prop = store.createPropObject('p1', 'prop')
            expect(store.getChildObjects(prop.id)).toEqual([])
        })
    })

    // ==================== reorderChild ====================

    describe('reorderChild', () => {
        it('should move child from one position to another', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            const p2 = store.createPropObject('p2', 'prop2')
            const p3 = store.createPropObject('p3', 'prop3')
            // v19: Must be entity to have independent renderChain
            const composite = store.createCompositeObject('group', [p1.id, p2.id, p3.id], undefined, undefined, 'entity')
            // Manually populate renderChain (createCompositeObject only does base construct)
            const comp = store.getObject(composite.id) as CompositeObject
            comp.renderChain = [p1.id, p2.id, p3.id]

            // Move p1 (index 0) to index 2
            store.reorderChild(composite.id, 0, 2)

            expect(comp.renderChain).toEqual([p2.id, p3.id, p1.id])
        })

        it('should move child backward', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            const p2 = store.createPropObject('p2', 'prop2')
            const p3 = store.createPropObject('p3', 'prop3')
            const composite = store.createCompositeObject('group', [p1.id, p2.id, p3.id], undefined, undefined, 'entity')
            const comp = store.getObject(composite.id) as CompositeObject
            comp.renderChain = [p1.id, p2.id, p3.id]

            // Move p3 (index 2) to index 0
            store.reorderChild(composite.id, 2, 0)

            expect(comp.renderChain).toEqual([p3.id, p1.id, p2.id])
        })

        it('should be no-op for same index', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            const p2 = store.createPropObject('p2', 'prop2')
            const composite = store.createCompositeObject('group', [p1.id, p2.id], undefined, undefined, 'entity')
            const comp = store.getObject(composite.id) as CompositeObject
            comp.renderChain = [p1.id, p2.id]

            store.reorderChild(composite.id, 1, 1)

            expect(comp.renderChain).toEqual([p1.id, p2.id])
        })

        it('should be no-op for invalid indices', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            const composite = store.createCompositeObject('group', [p1.id], undefined, undefined, 'entity')
            const comp = store.getObject(composite.id) as CompositeObject
            comp.renderChain = [p1.id]

            store.reorderChild(composite.id, -1, 0)
            store.reorderChild(composite.id, 0, 5)
            store.reorderChild(composite.id, 10, 0)

            expect(comp.renderChain).toEqual([p1.id])
        })

        it('should be no-op for non-composite object', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            // Should not throw
            store.reorderChild(p1.id, 0, 1)
        })
    })

    describe('getRootObjects', () => {
        it('should return only objects without parentId', () => {
            const prop = store.createPropObject('p1', 'prop')
            const composite = store.createCompositeObject('group', [prop.id])
            const standalone = store.createPropObject('p2', 'standalone_prop')

            const roots = store.getRootObjects()
            expect(roots.length).toBe(2) // composite + standalone
            expect(roots.map(r => r.id)).toContain(composite.id)
            expect(roots.map(r => r.id)).toContain(standalone.id)
            expect(roots.map(r => r.id)).not.toContain(prop.id) // prop has parentId
        })
    })

    // ==================== toSetupObject (parentId persistence) ====================

    describe('toSetupObject (parentId)', () => {
        it('should serialize parentId when present', () => {
            const prop = store.createPropObject('p1', 'prop')
            const composite = store.createCompositeObject('group', [prop.id])

            const propData = store.toSetupObject(store.getObject(prop.id)!)
            const compositeData = store.toSetupObject(store.getObject(composite.id)!)

            // prop has parentId
            expect(propData.parentId).toBe(composite.id)
            // composite has no parentId
            expect(compositeData.parentId).toBeUndefined()
        })

        it('should serialize childIds for composite', () => {
            const prop = store.createPropObject('p1', 'prop')
            const composite = store.createCompositeObject('group', [prop.id])

            const data = store.toSetupObject(store.getObject(composite.id)!)
            const compositeData = data as unknown as { childIds: string[] }
            expect(compositeData.childIds).toContain(prop.id)
        })
    })

    // ==================== duplicateObject (recursive) ====================

    describe('duplicateObject (recursive)', () => {
        it('should recursively duplicate composite with children', () => {
            const prop = store.createPropObject('p1', 'prop')
            const composite = store.createCompositeObject('group', [prop.id])

            const dup = store.duplicateObject(composite.id)
            expect(dup).toBeDefined()
            expect(dup!.type).toBe('composite')
            expect(dup!.id).not.toBe(composite.id)

            // New composite object has new children
            const dupComposite = dup as CompositeObject
            expect(dupComposite.childIds.length).toBe(1)
            expect(dupComposite.childIds[0]).not.toBe(prop.id)

            // Children parentId points to new composite
            const dupChild = store.getObject(dupComposite.childIds[0]!)
            expect(dupChild).toBeDefined()
            expect(dupChild!.parentId).toBe(dup!.id)

            // Original objects unaffected
            expect(store.getObject(prop.id)?.parentId).toBe(composite.id)
        })

        it('should not have parentId on duplicated top-level object', () => {
            const prop = store.createPropObject('p1', 'prop')
            store.createCompositeObject('group', [prop.id])

            const dup = store.duplicateObject(prop.id)
            // Cloned child should be top-level object (no parentId)
            expect(dup!.parentId).toBeUndefined()
        })

        it('should preserve entity renderChain order with duplicated child ids only', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            const p2 = store.createPropObject('p2', 'prop2')
            const entity = store.groupObjects([p1.id, p2.id], 'entity') as CompositeObject
            const entityInStore = store.getObject(entity.id) as CompositeObject
            entityInStore.renderChain = [p2.id, p1.id]

            const dup = store.duplicateObject(entityInStore.id) as CompositeObject
            expect(dup).toBeDefined()
            expect(dup.type).toBe('composite')
            expect(dup.compositeMode).toBe('entity')
            const dupInStore = store.getObject(dup.id) as CompositeObject

            const dupChildIds = new Set(dup.childIds)
            expect(dupChildIds.size).toBe(2)
            expect(dupChildIds.has(p1.id)).toBe(false)
            expect(dupChildIds.has(p2.id)).toBe(false)

            const duplicatedP1Id = dup.childIds[0]!
            const duplicatedP2Id = dup.childIds[1]!

            // New entity renderChain must only reference new child IDs and preserve custom order
            expect(dup.renderChain).toBeDefined()
            expect(new Set(dup.renderChain ?? [])).toEqual(dupChildIds)
            expect(dup.renderChain).toEqual([duplicatedP2Id, duplicatedP1Id])
            expect(dupInStore.renderChain).toEqual([duplicatedP2Id, duplicatedP1Id])
            expect((dup.renderChain ?? []).includes(p1.id)).toBe(false)
            expect((dup.renderChain ?? []).includes(p2.id)).toBe(false)

            // Root renderChain should not retain entity children
            const sceneChain = store.getSceneRenderChain()
            for (const childId of dup.childIds) {
                expect(sceneChain.includes(childId)).toBe(false)
            }
        })
    })
})

// ==================== Phase A: compositeLocked / compositeMode ====================

describe('Phase A: CompositeObject new fields', () => {
    let store: ReturnType<typeof useSceneObjectStore>

    beforeEach(() => {
        setActivePinia(createPinia())
        store = useSceneObjectStore()
    })

    it('should have compositeLocked=true by default', () => {
        const composite = store.createCompositeObject('group') as CompositeObject
        expect(composite.compositeLocked).toBe(true)
    })

    it('should have compositeMode=union by default', () => {
        const composite = store.createCompositeObject('group') as CompositeObject
        expect(composite.compositeMode).toBe('union')
    })

    it('should allow toggling compositeLocked', () => {
        const composite = store.createCompositeObject('group') as CompositeObject
        store.updateObject(composite.id, { compositeLocked: false } as Partial<CompositeObject>)
        const updated = store.getObject(composite.id) as CompositeObject
        expect(updated.compositeLocked).toBe(false)
    })
})

// ==================== Phase B: Store batch operations ====================

describe('Phase B: groupObjects / ungroupAll / addToComposite / removeFromComposite', () => {
    let store: ReturnType<typeof useSceneObjectStore>

    beforeEach(() => {
        setActivePinia(createPinia())
        store = useSceneObjectStore()
    })

    describe('groupObjects', () => {
        it('should create a composite and set parentId on children', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            const p2 = store.createPropObject('p2', 'prop2')

            const composite = store.groupObjects([p1.id, p2.id])

            expect(composite.type).toBe('composite')
            expect(composite.childIds).toContain(p1.id)
            expect(composite.childIds).toContain(p2.id)
            expect(store.getObject(p1.id)?.parentId).toBe(composite.id)
            expect(store.getObject(p2.id)?.parentId).toBe(composite.id)
        })

        it('should accept compositeMode parameter', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            const composite = store.groupObjects([p1.id], 'union') as CompositeObject

            expect(composite.compositeMode).toBe('union')
        })

        it('should group siblings under the same parent composite', () => {
            // Create parent composite A with p1, p2, p3
            const p1 = store.createPropObject('p1', 'prop1')
            const p2 = store.createPropObject('p2', 'prop2')
            const p3 = store.createPropObject('p3', 'prop3')
            const parentA = store.createCompositeObject('parentGroup', [p1.id, p2.id, p3.id])

            // Group p1 and p2 as sub-composite B
            const subComposite = store.groupObjects([p1.id, p2.id])

            // New composite B inherits parentA id as parentId
            expect(subComposite.parentId).toBe(parentA.id)

            // New composite B contains p1 and p2
            expect(subComposite.childIds).toContain(p1.id)
            expect(subComposite.childIds).toContain(p2.id)

            // p1 and p2 parentId becomes new composite B
            expect(store.getObject(p1.id)?.parentId).toBe(subComposite.id)
            expect(store.getObject(p2.id)?.parentId).toBe(subComposite.id)

            // Parent A childIds no longer contains p1, p2, but subComposite and p3
            const updatedA = store.getObject(parentA.id) as CompositeObject
            expect(updatedA.childIds).not.toContain(p1.id)
            expect(updatedA.childIds).not.toContain(p2.id)
            expect(updatedA.childIds).toContain(subComposite.id)
            expect(updatedA.childIds).toContain(p3.id)
        })

        it('should throw when grouping objects with different parentIds', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            const p2 = store.createPropObject('p2', 'prop2')
            store.createCompositeObject('groupA', [p1.id])
            // p2 is root object (parentId = undefined), p1 is child (parentId = groupA.id)

            expect(() => {
                store.groupObjects([p1.id, p2.id])
            }).toThrow(/same parentId/)
        })
    })

    describe('ungroupAll', () => {
        it('should remove parentId from all children and delete composite', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            const p2 = store.createPropObject('p2', 'prop2')
            const composite = store.groupObjects([p1.id, p2.id])

            store.ungroupAll(composite.id)

            expect(store.getObject(p1.id)?.parentId).toBeUndefined()
            expect(store.getObject(p2.id)?.parentId).toBeUndefined()
            expect(store.getObject(composite.id)).toBeUndefined()
        })

        it('should preserve child objects after ungroup', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            const composite = store.groupObjects([p1.id])

            store.ungroupAll(composite.id)

            // Child objects still exist
            expect(store.getObject(p1.id)).toBeDefined()
        })
    })

    describe('addToComposite', () => {
        it('should add objects to existing composite', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            const composite = store.groupObjects([p1.id])

            const p2 = store.createPropObject('p2', 'prop2')
            store.addToComposite(composite.id, [p2.id])

            const updated = store.getObject(composite.id) as CompositeObject
            expect(updated.childIds).toContain(p2.id)
            expect(store.getObject(p2.id)?.parentId).toBe(composite.id)
        })

        it('should preserve world position when adding a root object into a nested union composite', () => {
            const arm = store.createPropObject('arm', 'left_arm')
            store.updateObject(arm.id, { x: 120, y: 80 })

            const sword = store.createPropObject('sword', 'sword')
            store.updateObject(sword.id, { x: 180, y: 90 })

            const entity = store.groupObjects([arm.id, sword.id], 'entity') as CompositeObject
            store.updateObject(entity.id, {
                x: 1000,
                y: 600,
                scaleX: 1.2,
                scaleY: 1.1,
                rotation: Math.PI / 9,
            })

            const union = store.groupObjects([arm.id, sword.id], 'union') as CompositeObject
            store.updateObject(union.id, {
                x: 150,
                y: 40,
                rotation: Math.PI / 12,
            })

            const prop = store.createPropObject('dynamic', 'dynamic_prop')
            store.updateObject(prop.id, {
                x: 1320,
                y: 760,
                scaleX: 0.9,
                scaleY: 1.05,
                rotation: Math.PI / 7,
            })

            const before = store.getObject(prop.id)!
            store.addToComposite(union.id, [prop.id])
            const after = store.getObject(prop.id)!

            expect(after.parentId).toBe(union.id)

            // After attaching to nested union, canvas world coordinates should not jump
            const entityAfter = store.getObject(entity.id)!
            const unionAfter = store.getObject(union.id)!
            const worldAfter = resolveActionWorldTransform(
                {
                    id: after.id,
                    x: after.x,
                    y: after.y,
                    scaleX: after.scaleX,
                    scaleY: after.scaleY,
                    rotation: after.rotation,
                    flipX: after.flipX,
                    parentId: after.parentId ?? null,
                } as WriteableState,
                (id: string) => {
                    if (id === unionAfter.id) {
                        return {
                            id: unionAfter.id,
                            x: unionAfter.x,
                            y: unionAfter.y,
                            scaleX: unionAfter.scaleX,
                            scaleY: unionAfter.scaleY,
                            rotation: unionAfter.rotation,
                            flipX: unionAfter.flipX,
                            parentId: unionAfter.parentId ?? null,
                        } as WriteableState
                    }
                    if (id === entityAfter.id) {
                        return {
                            id: entityAfter.id,
                            x: entityAfter.x,
                            y: entityAfter.y,
                            scaleX: entityAfter.scaleX,
                            scaleY: entityAfter.scaleY,
                            rotation: entityAfter.rotation,
                            flipX: entityAfter.flipX,
                            parentId: entityAfter.parentId ?? null,
                        } as WriteableState
                    }
                    return undefined
                },
            )

            expect(Math.abs(worldAfter.x - before.x)).toBeLessThan(2)
            expect(Math.abs(worldAfter.y - before.y)).toBeLessThan(2)
        })
    })

    describe('removeFromComposite', () => {
        it('should remove child from composite and clear parentId', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            const p2 = store.createPropObject('p2', 'prop2')
            const composite = store.groupObjects([p1.id, p2.id])

            store.removeFromComposite([p1.id])

            expect(store.getObject(p1.id)?.parentId).toBeUndefined()
            const updated = store.getObject(composite.id) as CompositeObject
            expect(updated.childIds).not.toContain(p1.id)
            expect(updated.childIds).toContain(p2.id)
        })
    })

    describe('compositeMode=bind delete behavior', () => {
        it('should bubble children when bind-mode composite is deleted', () => {
            const p1 = store.createPropObject('p1', 'prop1')
            const composite = store.groupObjects([p1.id], 'union')

            store.removeObject(composite.id)

            // bind mode: children should survive (bubble up), parentId cleared
            expect(store.getObject(p1.id)).toBeDefined()
            expect(store.getObject(p1.id)?.parentId).toBeUndefined()
        })

        it('should bubble children to grandparent when nested bind-mode composite is deleted', () => {
            // Grandparent A -> Father B(bind) -> Grandchild C
            const propC = store.createPropObject('pC', 'grandchildProp')
            const compositeB = store.groupObjects([propC.id], 'union')
            const compositeA = store.createCompositeObject('grandparent', [compositeB.id])

            // Delete B -> C should bubble to A (not undefined)
            store.removeObject(compositeB.id)

            expect(store.getObject(propC.id)).toBeDefined()
            expect(store.getObject(propC.id)?.parentId).toBe(compositeA.id)
        })

        it('should propagate flipX when union composite with flipX is deleted (onBeforeDelete)', () => {
            // v19.2: union composite flipX bubbling fix regression test
            const p1 = store.createPropObject('p1', 'prop1')
            const composite = store.groupObjects([p1.id], 'union')

            // Set composite flipX=true
            store.updateObject(composite.id, { flipX: true } as Partial<import('@/types/sceneObject').SceneObject>)

            // Delete composite -> children bubble up
            store.removeObject(composite.id)

            // Children should inherit flipX=true
            expect(store.getObject(p1.id)).toBeDefined()
            expect(store.getObject(p1.id)?.flipX).toBe(true)
        })

        it('should propagate flipX when dissolving union composite with flipX', () => {
            // v19.2: dissolveComposite path flipX regression protection
            const p1 = store.createPropObject('p1', 'prop1')
            const composite = store.groupObjects([p1.id], 'union')

            // Set composite flipX=true
            store.updateObject(composite.id, { flipX: true } as Partial<import('@/types/sceneObject').SceneObject>)

            // Dissolve composite -> children bubble up
            store.dissolveComposite(composite.id)

            // Children should inherit flipX=true
            expect(store.getObject(p1.id)).toBeDefined()
            expect(store.getObject(p1.id)?.flipX).toBe(true)
        })

        it('should keep render matrix when dissolving nested entity composite with transform origin child', () => {
            const parent = store.createCompositeObject('parent')
            store.updateObject(parent.id, {
                x: 4507.540983606557,
                y: 1594.0387481371088,
                scaleX: 2.2898676009569847,
                scaleY: 2.2898676009569847,
                rotation: 0,
                flipX: false,
            } as Partial<CompositeObject>)

            const child = store.createPropObject('child', 'child_with_pivot')
            store.updateObject(child.id, {
                x: 8.679135962929422,
                y: -29.78506891273628,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                flipX: false,
                transformOriginX: -17.5,
                transformOriginY: -63.333335876464844,
            } as Partial<import('@/types/sceneObject').SceneObject>)

            const entity = store.createCompositeObject('entity_to_delete', [child.id], undefined, undefined, 'entity')
            store.updateObject(entity.id, {
                parentId: parent.id,
                x: 55.485864037070996,
                y: 22.270068912736463,
                scaleX: 1,
                scaleY: 1,
                rotation: 1.3252758981866675,
                flipX: false,
            } as Partial<CompositeObject>)
            ;(store.getObject(parent.id) as CompositeObject).childIds.push(entity.id)

            const getObjectState = (id: string): WriteableState | undefined => {
                const obj = store.getObject(id)
                return obj ? ({ ...obj, parentId: obj.parentId ?? null } as WriteableState) : undefined
            }
            const beforeWorldMatrix = resolveWorldMatrix(
                getObjectState(child.id)!,
                getObjectState,
            )

            store.dissolveComposite(entity.id)
            store.removeObject(entity.id)

            const updatedChild = store.getObject(child.id)
            expect(updatedChild).toBeDefined()
            expect(updatedChild?.parentId).toBe(parent.id)
            expect(store.getObject(entity.id)).toBeUndefined()

            const afterWorldMatrix = resolveWorldMatrix(
                getObjectState(child.id)!,
                getObjectState,
            )
            expectWorldMatrixClose(afterWorldMatrix, beforeWorldMatrix)
        })

        it('should propagate flipX when ungrouping union composite with flipX', () => {
            // v19.2: ungroupAll path flipX regression protection
            const p1 = store.createPropObject('p1', 'prop1')
            const composite = store.groupObjects([p1.id], 'union')

            // Set composite flipX=true
            store.updateObject(composite.id, { flipX: true } as Partial<import('@/types/sceneObject').SceneObject>)

            // Ungroup -> children become standalone
            store.ungroupAll(composite.id)

            // Children should inherit flipX=true
            expect(store.getObject(p1.id)).toBeDefined()
            expect(store.getObject(p1.id)?.flipX).toBe(true)
        })
    })

    describe('ungroupAll nesting bubble', () => {
        it('should bubble children to parent composite when ungrouping nested composite', () => {
            // A -> B -> C, ungroup B -> C returns to A
            const propC = store.createPropObject('pC', 'grandchild')
            const compositeB = store.groupObjects([propC.id])
            const compositeA = store.createCompositeObject('grandparent', [compositeB.id])

            store.ungroupAll(compositeB.id)

            expect(store.getObject(propC.id)).toBeDefined()
            expect(store.getObject(propC.id)?.parentId).toBe(compositeA.id)
            expect(store.getObject(compositeB.id)).toBeUndefined()
        })
    })

    describe('removeFromComposite nesting bubble', () => {
        it('should bubble child to parent composite when removing from nested composite', () => {
            const propC = store.createPropObject('pC', 'grandchild')
            const compositeB = store.groupObjects([propC.id])
            const compositeA = store.createCompositeObject('grandparent', [compositeB.id])

            store.removeFromComposite([propC.id])

            expect(store.getObject(propC.id)).toBeDefined()
            // C removed from B -> bubbles to B's parentId (= A.id)
            expect(store.getObject(propC.id)?.parentId).toBe(compositeA.id)
        })

        it('should keep world position when bubbling child to parent composite', () => {
            const compositeA = store.createCompositeObject('grandparent')
            store.updateObject(compositeA.id, { x: 100, y: 200 } as Partial<CompositeObject>)

            const compositeB = store.createCompositeObject('parent')
            store.updateObject(compositeB.id, {
                parentId: compositeA.id,
                x: 10,
                y: 20,
            } as Partial<CompositeObject>)
            ;(store.getObject(compositeA.id) as CompositeObject).childIds.push(compositeB.id)

            const propC = store.createPropObject('pC', 'grandchild')
            store.updateObject(propC.id, {
                parentId: compositeB.id,
                x: 5,
                y: 6,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                flipX: false,
            } as Partial<import('@/types/sceneObject').SceneObject>)
            ;(store.getObject(compositeB.id) as CompositeObject).childIds.push(propC.id)

            store.removeFromComposite([propC.id])

            const updated = store.getObject(propC.id)
            expect(updated?.parentId).toBe(compositeA.id)
            expect(updated?.x).toBeCloseTo(15, 5)
            expect(updated?.y).toBeCloseTo(26, 5)
        })
    })

    describe('cycle detection', () => {
        it('should throw error when adding ancestor to descendant composite', () => {
            // A contains B -> attempt to add A to B -> should throw Error
            const compositeB = store.createCompositeObject('B')
            const compositeA = store.createCompositeObject('A', [compositeB.id])

            expect(() => {
                store.addToComposite(compositeB.id, [compositeA.id])
            }).toThrow(/Circular reference/)
        })

        it('should throw error for deep cycle: A→B→C, try to add A into C', () => {
            const compositeC = store.createCompositeObject('C')
            const compositeB = store.createCompositeObject('B', [compositeC.id])
            const compositeA = store.createCompositeObject('A', [compositeB.id])

            expect(() => {
                store.addToComposite(compositeC.id, [compositeA.id])
            }).toThrow(/Circular reference/)
        })

        it('should allow adding unrelated object (no cycle)', () => {
            const compositeA = store.createCompositeObject('A')
            const prop = store.createPropObject('p1', 'prop')

            expect(() => {
                store.addToComposite(compositeA.id, [prop.id])
            }).not.toThrow()
        })
    })
})
