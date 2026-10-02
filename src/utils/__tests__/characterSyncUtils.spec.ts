/**
 * characterSyncUtils unit tests
 * Verify flatten -> restructure character structure/animation sync copy logic
 */

import { describe, expect, it } from 'vitest'

import type { AnimationDefinition, TrackAnimationDefinition } from '@/types/animation'
import type { CompositeObject, SceneObject } from '@/types/sceneObject'

import {
    buildNameMatch,
    collectLeafNodes,
    remapAnimationDefinitions,
    syncCharacterStructure,
} from '../characterSyncUtils'

// ===== Helper factory functions =====

function makeLeaf(
    id: string,
    alias: string,
    overrides?: Partial<SceneObject>,
): SceneObject {
    return {
        id,
        type: 'symbol',
        name: alias,
        alias,
        refId: '',
        x: 0, y: 0,
        width: 100, height: 100,
        scaleX: 1, scaleY: 1,
        rotation: 0, alpha: 1,
        flipX: false, zIndex: 10,
        visible: true,
        ...overrides,
    } as SceneObject
}

function makeComposite(
    id: string,
    childIds: string[],
    overrides?: Partial<CompositeObject>,
): CompositeObject {
    return {
        id,
        type: 'composite',
        name: overrides?.name ?? `comp_${id}`,
        alias: overrides?.alias ?? `comp_${id}`,
        refId: '',
        childIds,
        compositeLocked: true,
        compositeMode: 'entity',
        x: 0, y: 0,
        width: 0, height: 0,
        scaleX: 1, scaleY: 1,
        rotation: 0, alpha: 1,
        flipX: false, zIndex: 10,
        visible: true,
        ...overrides,
    } as CompositeObject
}

function makeTrackAnimation(
    id: string,
    name: string,
    tracks: { targetObjectId?: string; trackType?: string; pivot?: { x: number; y: number } }[],
): TrackAnimationDefinition {
    return {
        type: 'track',
        id,
        name,
        loop: true,
        createdAt: 1000,
        updatedAt: 1000,
        tracks: tracks.map(t => ({
            trackType: t.trackType ?? 'transform',
            targetObjectId: t.targetObjectId,
            duration: 300,
            easing: 'linear' as const,
            keyframes: [{ time: 0 }, { time: 1 }],
            ...(t.pivot ? { pivot: t.pivot } : {}),
        })),
    } as TrackAnimationDefinition
}


// ===== collectLeafNodes =====

describe('collectLeafNodes', () => {
    it('correctly extracts leaf nodes and skips composite', () => {
        const leaf1 = makeLeaf('l1', 'head')
        const leaf2 = makeLeaf('l2', 'body')
        const comp = makeComposite('c1', ['l1', 'l2'])

        const result = collectLeafNodes([comp, leaf1, leaf2])

        expect(result.size).toBe(2)
        expect(result.has('head')).toBe(true)
        expect(result.has('body')).toBe(true)
        // composite is not in result
        expect(result.has('comp_c1')).toBe(false)
    })

    it('keeps only the first occurrence for duplicate aliases', () => {
        const leaf1 = makeLeaf('l1', 'head')
        const leaf2 = makeLeaf('l2', 'head')

        const result = collectLeafNodes([leaf1, leaf2])

        expect(result.size).toBe(1)
        expect(result.get('head')?.id).toBe('l1')
    })

    it('returns empty Map for empty list', () => {
        expect(collectLeafNodes([]).size).toBe(0)
    })

    it('prefers alias and falls back to name', () => {
        const leaf = makeLeaf('l1', '', { name: 'fallback_name', alias: '' })

        const result = collectLeafNodes([leaf])

        expect(result.has('fallback_name')).toBe(true)
    })
})

// ===== buildNameMatch =====

describe('buildNameMatch', () => {
    it('correctly matches leaf nodes with same name', () => {
        const sourceObjects: SceneObject[] = [
            makeComposite('sc', ['sl1', 'sl2']),
            makeLeaf('sl1', 'head', { parentId: 'sc' }),
            makeLeaf('sl2', 'body', { parentId: 'sc' }),
        ]
        const targetObjects: SceneObject[] = [
            makeComposite('tc', ['tl1', 'tl2']),
            makeLeaf('tl1', 'head', { parentId: 'tc' }),
            makeLeaf('tl2', 'body', { parentId: 'tc' }),
        ]

        const result = buildNameMatch(sourceObjects, targetObjects)

        expect(result.matched).toEqual(expect.arrayContaining(['head', 'body']))
        expect(result.sourceOnly).toHaveLength(0)
        expect(result.targetOnly).toHaveLength(0)
        expect(result.leafIdMap.get('sl1')).toBe('tl1')
        expect(result.leafIdMap.get('sl2')).toBe('tl2')
    })

    it('identifies sourceOnly and targetOnly', () => {
        const sourceObjects: SceneObject[] = [
            makeLeaf('sl1', 'head'),
            makeLeaf('sl2', 'back_skirt'),
        ]
        const targetObjects: SceneObject[] = [
            makeLeaf('tl1', 'head'),
            makeLeaf('tl2', 'hat'),
        ]

        const result = buildNameMatch(sourceObjects, targetObjects)

        expect(result.matched).toEqual(['head'])
        expect(result.sourceOnly).toEqual(['back_skirt'])
        expect(result.targetOnly).toEqual(['hat'])
    })

    it('cross-hierarchy matching: source has nested union, target is flat structure', () => {
        // Source: root -> union -> head
        const sourceObjects: SceneObject[] = [
            makeComposite('root', ['union1', 'sl2'], { compositeMode: 'entity' }),
            makeComposite('union1', ['sl1'], { parentId: 'root', compositeMode: 'union' }),
            makeLeaf('sl1', 'head', { parentId: 'union1' }),
            makeLeaf('sl2', 'body', { parentId: 'root' }),
        ]
        // Target: root -> head (flat)
        const targetObjects: SceneObject[] = [
            makeComposite('troot', ['tl1', 'tl2']),
            makeLeaf('tl1', 'head', { parentId: 'troot' }),
            makeLeaf('tl2', 'body', { parentId: 'troot' }),
        ]

        const result = buildNameMatch(sourceObjects, targetObjects)

        expect(result.matched).toEqual(expect.arrayContaining(['head', 'body']))
        expect(result.leafIdMap.get('sl1')).toBe('tl1')
        expect(result.leafIdMap.get('sl2')).toBe('tl2')
        // Source has 2 composites -> compositeIdMap should have 2 items
        expect(result.compositeIdMap.size).toBe(2)
    })

    it('generates new ID for source composite', () => {
        const sourceObjects: SceneObject[] = [
            makeComposite('root', ['l1']),
            makeLeaf('l1', 'head', { parentId: 'root' }),
        ]
        const targetObjects: SceneObject[] = [
            makeLeaf('tl1', 'head'),
        ]

        const result = buildNameMatch(sourceObjects, targetObjects)

        expect(result.compositeIdMap.size).toBe(1)
        const newId = result.compositeIdMap.get('root')
        expect(newId).toBeDefined()
        expect(newId).not.toBe('root')
        expect(newId).toMatch(/^sceneobject_/)
    })
})

// ===== remapAnimationDefinitions =====

describe('remapAnimationDefinitions', () => {
    it('_self remains unchanged', () => {
        const anims: Record<string, AnimationDefinition> = {
            a1: makeTrackAnimation('a1', 'frame_animation', [{ targetObjectId: '_self' }]),
        }
        const idMap = new Map<string, string>()

        const { remapped, skipped } = remapAnimationDefinitions(anims, idMap)

        expect(skipped).toHaveLength(0)
        const entries = Object.values(remapped)
        expect(entries).toHaveLength(1)
        const trackAnim = entries[0] as TrackAnimationDefinition
        expect(trackAnim.tracks[0]?.targetObjectId).toBe('_self')
    })

    it('mapped IDs are correctly replaced', () => {
        const anims: Record<string, AnimationDefinition> = {
            a1: makeTrackAnimation('a1', 'nod', [{ targetObjectId: 'src_obj' }]),
        }
        const idMap = new Map([['src_obj', 'target_obj']])

        const { remapped } = remapAnimationDefinitions(anims, idMap)

        const entries = Object.values(remapped)
        expect(entries).toHaveLength(1)
        const trackAnim = entries[0] as TrackAnimationDefinition
        expect(trackAnim.tracks[0]?.targetObjectId).toBe('target_obj')
    })

    it('tracks with unmapped IDs are removed', () => {
        const anims: Record<string, AnimationDefinition> = {
            a1: makeTrackAnimation('a1', 'mixed', [
                { targetObjectId: 'mapped_obj' },
                { targetObjectId: 'unmapped_obj' },
            ]),
        }
        const idMap = new Map([['mapped_obj', 'target_mapped']])

        const { remapped, trimmed } = remapAnimationDefinitions(anims, idMap)

        const entries = Object.values(remapped)
        expect(entries).toHaveLength(1)
        const trackAnim = entries[0] as TrackAnimationDefinition
        expect(trackAnim.tracks).toHaveLength(1)
        expect(trackAnim.tracks[0]?.targetObjectId).toBe('target_mapped')
        expect(trimmed).toContain('mixed')
    })

    it('all tracks unmappable -> entire animation is skipped', () => {
        const anims: Record<string, AnimationDefinition> = {
            a1: makeTrackAnimation('a1', 'isolated_anim', [{ targetObjectId: 'nonexistent' }]),
        }
        const idMap = new Map<string, string>()

        const { remapped, skipped } = remapAnimationDefinitions(anims, idMap)

        expect(Object.keys(remapped)).toHaveLength(0)
        expect(skipped).toContain('isolated_anim')
    })


    it('generates new animation IDs', () => {
        const anims: Record<string, AnimationDefinition> = {
            old_id: makeTrackAnimation('old_id', 'test', [{ targetObjectId: '_self' }]),
        }

        const { remapped } = remapAnimationDefinitions(anims, new Map())

        const newIds = Object.keys(remapped)
        expect(newIds).toHaveLength(1)
        expect(newIds[0]).not.toBe('old_id')
        expect(newIds[0]).toMatch(/^animation_/)
    })

    it('clears custom pivot of transform tracks when importing across characters', () => {
        const anims: Record<string, AnimationDefinition> = {
            a1: makeTrackAnimation('a1', 'wave', [
                { targetObjectId: 'src_hand', pivot: { x: 42, y: 88 } },
            ]),
        }
        const idMap = new Map([['src_hand', 'target_hand']])

        const { remapped } = remapAnimationDefinitions(anims, idMap)

        const trackAnim = Object.values(remapped)[0] as TrackAnimationDefinition
        const track = trackAnim.tracks[0]
        expect(track?.targetObjectId).toBe('target_hand')
        expect(track && 'pivot' in track).toBe(false)
    })
})

// ===== syncCharacterStructure =====

describe('syncCharacterStructure', () => {
    it('full flow: nested source + flat target', () => {
        // Simulate male1 structure: root(entity) -> [body, union] -> union -> [head, expression]
        const sourceRoot = makeComposite('s_root', ['s_body', 's_union'], {
            compositeMode: 'entity',
            renderChain: ['s_body', 's_head', 's_expr'],
            animations: {
                a1: makeTrackAnimation('a1', 'nod', [{ targetObjectId: 's_union' }]),
                a2: makeTrackAnimation('a2', 'walk', [{ targetObjectId: 's_body' }]),
            },
        })
        const sourceUnion = makeComposite('s_union', ['s_head', 's_expr'], {
            parentId: 's_root',
            compositeMode: 'union',
            name: 'union_group',
            alias: 'union_group',
        })
        const sourceBody = makeLeaf('s_body', 'body', { parentId: 's_root' })
        const sourceHead = makeLeaf('s_head', 'head', { parentId: 's_union' })
        const sourceExpr = makeLeaf('s_expr', 'expression', {
            parentId: 's_union',
            type: 'expression',
        })
        const sourceObjects: SceneObject[] = [sourceRoot, sourceUnion, sourceBody, sourceHead, sourceExpr]

        // Target: flat structure root -> [body, head, expression]
        const targetRoot = makeComposite('t_root', ['t_body', 't_head', 't_expr'])
        const targetBody = makeLeaf('t_body', 'body', { parentId: 't_root' })
        const targetHead = makeLeaf('t_head', 'head', { parentId: 't_root' })
        const targetExpr = makeLeaf('t_expr', 'expression', {
            parentId: 't_root',
            type: 'expression',
        })
        const targetObjects: SceneObject[] = [targetRoot, targetBody, targetHead, targetExpr]

        const result = syncCharacterStructure(sourceObjects, targetObjects)

        // Match result
        expect(result.matchResult.matched).toEqual(expect.arrayContaining(['body', 'head', 'expression']))
        expect(result.matchResult.sourceOnly).toHaveLength(0)
        expect(result.matchResult.targetOnly).toHaveLength(0)

        // Object count: 2 composites + 3 leaves = 5
        expect(result.objects).toHaveLength(5)

        // Verify composite structure is copied
        const composites = result.objects.filter(o => o.type === 'composite') as CompositeObject[]
        expect(composites).toHaveLength(2)

        // Find new root (no parentId)
        const newRoot = composites.find(c => !c.parentId)
        expect(newRoot).toBeDefined()
        expect(newRoot!.compositeMode).toBe('entity')
        expect(newRoot!.childIds).toHaveLength(2) // body + union

        // Find new union
        const newUnion = composites.find(c => c.parentId === newRoot!.id)
        expect(newUnion).toBeDefined()
        expect(newUnion!.compositeMode).toBe('union')
        expect(newUnion!.childIds).toHaveLength(2) // head + expression

        // Verify leaf nodes parentId is correct
        const leaves = result.objects.filter(o => o.type !== 'composite')
        const bodyLeaf = leaves.find(l => getAlias(l) === 'body')
        expect(bodyLeaf?.parentId).toBe(newRoot!.id)

        const headLeaf = leaves.find(l => getAlias(l) === 'head')
        expect(headLeaf?.parentId).toBe(newUnion!.id)

        // Verify leaf nodes retain original target ID
        expect(bodyLeaf?.id).toBe('t_body')
        expect(headLeaf?.id).toBe('t_head')

        // Verify animation is copied
        expect(newRoot!.animations).toBeDefined()
        const animValues = Object.values(newRoot!.animations!)
        expect(animValues).toHaveLength(2)

        // Verify targetObjectId in animation is remapped
        const walkAnim = animValues.find(a => a.name === 'walk') as TrackAnimationDefinition
        expect(walkAnim).toBeDefined()
        expect(walkAnim.tracks[0]?.targetObjectId).toBe('t_body')

        // Nod animation target should be new union ID
        const nodAnim = animValues.find(a => a.name === 'nod') as TrackAnimationDefinition
        expect(nodAnim).toBeDefined()
        expect(nodAnim.tracks[0]?.targetObjectId).toBe(newUnion!.id)

        // renderChain is translated
        expect(newRoot!.renderChain).toBeDefined()
        expect(newRoot!.renderChain).toHaveLength(3)
    })

    it('appends leaf nodes only in target into root composite', () => {
        const sourceObjects: SceneObject[] = [
            makeComposite('s_root', ['s_body'], { compositeMode: 'entity' }),
            makeLeaf('s_body', 'body', { parentId: 's_root' }),
        ]
        const targetObjects: SceneObject[] = [
            makeComposite('t_root', ['t_body', 't_hat'], { compositeMode: 'entity' }),
            makeLeaf('t_body', 'body', { parentId: 't_root' }),
            makeLeaf('t_hat', 'hat', { parentId: 't_root' }),
        ]

        const result = syncCharacterStructure(sourceObjects, targetObjects)

        // 1 composite + 2 leaves = 3
        expect(result.objects).toHaveLength(3)

        const newRoot = result.objects.find(o => o.type === 'composite') as CompositeObject
        expect(newRoot.childIds).toHaveLength(2)

        // Hat should be inside root composite
        const hatLeaf = result.objects.find(o => getAlias(o) === 'hat')
        expect(hatLeaf).toBeDefined()
        expect(hatLeaf!.parentId).toBe(newRoot.id)
    })

    it('removes animation tracks referencing leaf nodes only in source', () => {
        const sourceObjects: SceneObject[] = [
            makeComposite('s_root', ['s_body', 's_skirt'], {
                compositeMode: 'entity',
                animations: {
                    a1: makeTrackAnimation('a1', 'walk', [
                        { targetObjectId: 's_body' },
                        { targetObjectId: 's_skirt' }, // back_skirt has no match
                    ]),
                },
            }),
            makeLeaf('s_body', 'body', { parentId: 's_root' }),
            makeLeaf('s_skirt', 'back_skirt', { parentId: 's_root' }),
        ]
        const targetObjects: SceneObject[] = [
            makeComposite('t_root', ['t_body']),
            makeLeaf('t_body', 'body', { parentId: 't_root' }),
        ]

        const result = syncCharacterStructure(sourceObjects, targetObjects)

        expect(result.matchResult.sourceOnly).toEqual(['back_skirt'])
        expect(result.trimmedAnimations).toContain('walk')

        // Animation still exists (has 1 valid track)
        const newRoot = result.objects.find(o => o.type === 'composite') as CompositeObject
        const anims = Object.values(newRoot.animations!)
        expect(anims).toHaveLength(1)
        const walkAnim = anims[0] as TrackAnimationDefinition
        expect(walkAnim.tracks).toHaveLength(1)
    })

    it('composite with empty animations', () => {
        const sourceObjects: SceneObject[] = [
            makeComposite('s_root', ['s_body'], { compositeMode: 'entity' }),
            makeLeaf('s_body', 'body', { parentId: 's_root' }),
        ]
        const targetObjects: SceneObject[] = [
            makeComposite('t_root', ['t_body']),
            makeLeaf('t_body', 'body', { parentId: 't_root' }),
        ]

        const result = syncCharacterStructure(sourceObjects, targetObjects)

        expect(result.objects).toHaveLength(2)
        expect(result.skippedAnimations).toHaveLength(0)
    })
})

// ===== Helpers =====

function getAlias(obj: SceneObject): string {
    return obj.alias?.trim() || obj.name
}
