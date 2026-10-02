/**
 * Clip-Mask Phase 1 — maskSerializer Serialization + finalizeMaskTargets Unit Tests
 *
 * See docs/features/clip-mask.md (v2.1) §11, §14.1 (Stage A).
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MaskObject } from '@/types/sceneObject'

import { useSceneObjectStore } from '../sceneObjectStore'

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

const noopResolveActor = () => null

describe('Clip-Mask Phase 1 — maskSerializer + finalizeMaskTargets', () => {
    let store: ReturnType<typeof useSceneObjectStore>
    let warnSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        setActivePinia(createPinia())
        store = useSceneObjectStore()
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ })
    })

    describe('createMaskObject', () => {
        it('creates mask with default mode=inside_visible and targetIds=[]', () => {
            const m = store.createMaskObject('Mask 1', 'rectangle')
            expect(m.type).toBe('mask')
            expect(m.shape).toBe('rectangle')
            expect(m.mode).toBe('inside_visible')
            expect(m.targetIds).toEqual([])
            expect(m.refId).toBe('')
        })
    })

    describe('round-trip preserves non-empty targetIds', () => {
        it('1 mask + 3 prop targets: fields intact after serialization-deserialization', () => {
            const p1 = store.createPropObject('p1', 'Prop 1')
            const p2 = store.createPropObject('p2', 'Prop 2')
            const p3 = store.createPropObject('p3', 'Prop 3')
            const mask = store.createMaskObject('Mask', 'ellipse', { width: 300, height: 200 })
            store.updateObject<MaskObject>(mask.id, { targetIds: [p1.id, p2.id, p3.id] })

            // Serialize
            const dtos = [p1, p2, p3, mask].map(o => store.toSetupObject(store.getObject(o.id)!))

            // Deserialize after resetting store
            setActivePinia(createPinia())
            store = useSceneObjectStore()
            for (const d of dtos) store.fromSetupObject(d, noopResolveActor)
            store.finalizeMaskTargets()

            const restored = store.getObject(mask.id) as MaskObject
            expect(restored).toBeTruthy()
            expect(restored.type).toBe('mask')
            expect(restored.shape).toBe('ellipse')
            expect(restored.mode).toBe('inside_visible')
            expect(restored.width).toBe(300)
            expect(restored.height).toBe(200)
            expect(new Set(restored.targetIds)).toEqual(new Set([p1.id, p2.id, p3.id]))
        })
    })

    describe('Dirty data cleanup', () => {
        it('dead reference: nonexistent IDs in targetIds silently pruned', () => {
            const p1 = store.createPropObject('p1', 'Prop 1')
            const mask = store.createMaskObject('Mask', 'rectangle')
            store.updateObject<MaskObject>(mask.id, { targetIds: [p1.id, 'ghost-id'] })

            const dtos = [p1, mask].map(o => store.toSetupObject(store.getObject(o.id)!))

            setActivePinia(createPinia())
            store = useSceneObjectStore()
            for (const d of dtos) store.fromSetupObject(d, noopResolveActor)
            store.finalizeMaskTargets()

            const restored = store.getObject(mask.id) as MaskObject
            expect(restored.targetIds).toEqual([p1.id])
            expect(warnSpy).toHaveBeenCalled()
        })

        it('mask->mask nesting pruned', () => {
            const innerMask = store.createMaskObject('Inner Mask', 'rectangle')
            const outerMask = store.createMaskObject('Outer Mask', 'rectangle')
            store.updateObject<MaskObject>(outerMask.id, { targetIds: [innerMask.id] })

            const dtos = [innerMask, outerMask].map(o => store.toSetupObject(store.getObject(o.id)!))

            setActivePinia(createPinia())
            store = useSceneObjectStore()
            for (const d of dtos) store.fromSetupObject(d, noopResolveActor)
            store.finalizeMaskTargets()

            const restored = store.getObject(outerMask.id) as MaskObject
            expect(restored.targetIds).toEqual([])
        })

        it('illegal target type pruned', () => {
            const cam = store.createCameraObject('Camera')
            const mask = store.createMaskObject('Mask', 'rectangle')
            // Bypass UI to write illegal targetIds directly
            store.updateObject<MaskObject>(mask.id, { targetIds: [cam.id] })

            const dtos = [cam, mask].map(o => store.toSetupObject(store.getObject(o.id)!))

            setActivePinia(createPinia())
            store = useSceneObjectStore()
            for (const d of dtos) store.fromSetupObject(d, noopResolveActor)
            store.finalizeMaskTargets()

            const restored = store.getObject(mask.id) as MaskObject | undefined
            // Camera not loaded via fromSetupObject (no serializer); restored is still mask itself
            expect(restored?.targetIds ?? []).toEqual([])
        })

        it('multiple masks on same target: mask with smaller starting index wins', () => {
            const p = store.createPropObject('p', 'Prop')
            const maskA = store.createMaskObject('A', 'rectangle')
            const maskB = store.createMaskObject('B', 'rectangle')
            store.updateObject<MaskObject>(maskA.id, { targetIds: [p.id] })
            store.updateObject<MaskObject>(maskB.id, { targetIds: [p.id] })

            const dtos = [p, maskA, maskB].map(o => store.toSetupObject(store.getObject(o.id)!))

            setActivePinia(createPinia())
            store = useSceneObjectStore()
            for (const d of dtos) store.fromSetupObject(d, noopResolveActor)
            store.finalizeMaskTargets()

            const a = store.getObject(maskA.id) as MaskObject
            const b = store.getObject(maskB.id) as MaskObject
            expect(a.targetIds).toEqual([p.id])
            expect(b.targetIds).toEqual([])
        })

        it('unknown shape downgrades to rectangle with warning', () => {
            const dto = {
                id: 'mask-x',
                type: 'mask',
                name: 'Mask',
                refId: '',
                x: 0, y: 0, width: 100, height: 100,
                scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, flipX: false,
                zIndex: 0, visible: true,
                shape: 'star',
                mode: 'inside_visible',
                targetIds: [],
            } as unknown as Parameters<typeof store.fromSetupObject>[0]

            store.fromSetupObject(dto, noopResolveActor)
            store.finalizeMaskTargets()

            const restored = store.getObject('mask-x') as MaskObject
            expect(restored.shape).toBe('rectangle')
            expect(warnSpy).toHaveBeenCalled()
        })

        it('unsupported mode downgrades to inside_visible with warning', () => {
            const dto = {
                id: 'mask-y',
                type: 'mask',
                name: 'Mask',
                refId: '',
                x: 0, y: 0, width: 100, height: 100,
                scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, flipX: false,
                zIndex: 0, visible: true,
                shape: 'rectangle',
                mode: 'outside_visible',
                targetIds: [],
            } as unknown as Parameters<typeof store.fromSetupObject>[0]

            store.fromSetupObject(dto, noopResolveActor)
            store.finalizeMaskTargets()

            const restored = store.getObject('mask-y') as MaskObject
            expect(restored.mode).toBe('inside_visible')
            expect(warnSpy).toHaveBeenCalled()
        })
    })
})
