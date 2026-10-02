/**
 * RenderChainStage Unit Tests
 *
 * Verifies override render() scheme:
 * 1. Basic ordering: renderByRenderChain schedules render according to renderChain
 * 2. Cross-union interleaving: children inside union can interleave render with entity direct children
 * 3. Deep nesting: entity -> union -> union -> leaf
 * 4. installRenderChainRenderer correctly installs override
 */

import * as PIXI from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'

import {
    installRenderChainRenderer,
    installRootRenderChainRenderer,
    renderByRenderChain,
} from '../RenderChainStage'

// ============================================================================
// Helpers
// ============================================================================

function makeContainer(name: string): PIXI.Container {
    const c = new PIXI.Container()
    c.name = name
    return c
}

// ============================================================================
// renderByRenderChain
// ============================================================================

describe('renderByRenderChain', () => {
    it('should call render on containers in renderChain order', () => {
        const entity = new PIXI.Container()
        const a = makeContainer('objA')
        const b = makeContainer('objB')
        const c = makeContainer('objC')
        entity.addChild(a, b, c)

        const renderOrder: string[] = []
        const mockRenderer = {} as PIXI.Renderer

        // Mock render method records call order
        a.render = vi.fn(() => { renderOrder.push('objA') })
        b.render = vi.fn(() => { renderOrder.push('objB') })
        c.render = vi.fn(() => { renderOrder.push('objC') })

        const containerMap = new Map<string, PIXI.Container>([
            ['objA', a], ['objB', b], ['objC', c],
        ])

        renderByRenderChain(entity, ['objC', 'objA', 'objB'], containerMap, mockRenderer)

        expect(renderOrder).toEqual(['objC', 'objA', 'objB'])
    })

    it('should interleave union children with direct children', () => {
        // entity direct children: propC, union(childA, childB)
        // renderChain: ['childA', 'propC', 'childB']
        // Expected render order: childA -> propC -> childB (interleaved render)
        const entity = new PIXI.Container()
        const union = makeContainer('composite_union1')
        const childA = makeContainer('childA')
        const childB = makeContainer('childB')
        union.addChild(childA, childB)
        const propC = makeContainer('propC')
        entity.addChild(propC, union)

        const renderOrder: string[] = []
        const mockRenderer = {} as PIXI.Renderer

        childA.render = vi.fn(() => { renderOrder.push('childA') })
        childB.render = vi.fn(() => { renderOrder.push('childB') })
        propC.render = vi.fn(() => { renderOrder.push('propC') })
        union.render = vi.fn(() => { renderOrder.push('union') })

        const containerMap = new Map<string, PIXI.Container>([
            ['childA', childA], ['propC', propC], ['childB', childB],
        ])

        renderByRenderChain(entity, ['childA', 'propC', 'childB'], containerMap, mockRenderer)

        // union container should not be rendered (not in renderChain and children independently rendered)
        expect(renderOrder).toEqual(['childA', 'propC', 'childB'])
    })

    it('should handle deeply nested unions', () => {
        // entity → unionA → unionB → child1, entity → propD
        const entity = new PIXI.Container()
        const unionA = makeContainer('composite_unionA')
        const unionB = makeContainer('composite_unionB')
        const child1 = makeContainer('child1')
        const propD = makeContainer('propD')
        unionB.addChild(child1)
        unionA.addChild(unionB)
        entity.addChild(propD, unionA)

        const renderOrder: string[] = []
        const mockRenderer = {} as PIXI.Renderer

        child1.render = vi.fn(() => { renderOrder.push('child1') })
        propD.render = vi.fn(() => { renderOrder.push('propD') })
        unionA.render = vi.fn(() => { renderOrder.push('unionA') })
        unionB.render = vi.fn(() => { renderOrder.push('unionB') })

        const containerMap = new Map<string, PIXI.Container>([
            ['child1', child1], ['propD', propD],
        ])

        renderByRenderChain(entity, ['child1', 'propD'], containerMap, mockRenderer)

        // child1 renders first, propD renders after. union container should not be rendered.
        expect(renderOrder).toEqual(['child1', 'propD'])
    })

    it('should render union children NOT in renderChain (dynamic spawn fallback)', () => {
        // Scenario: PropNew dynamically added to union but renderChain not yet reconciled
        // stage → propA, union(charA, propNew), propB
        // renderChain: [propA, charA, propB] (missing propNew)
        // Expected: propNew is still rendered (via fallback logic of recursing union container)
        const stage = new PIXI.Container()
        const propA = makeContainer('propA')
        const union = makeContainer('composite_union1')
        const charA = makeContainer('charA')
        const propNew = makeContainer('propNew')
        const propB = makeContainer('propB')

        union.addChild(charA, propNew)
        stage.addChild(propA, union, propB)

        const renderOrder: string[] = []
        const mockRenderer = {} as PIXI.Renderer

        propA.render = vi.fn(() => { renderOrder.push('propA') })
        charA.render = vi.fn(() => { renderOrder.push('charA') })
        propNew.render = vi.fn(() => { renderOrder.push('propNew') })
        propB.render = vi.fn(() => { renderOrder.push('propB') })
        union.render = vi.fn(() => { renderOrder.push('union') })

        const containerMap = new Map<string, PIXI.Container>([
            ['propA', propA], ['charA', charA], ['propB', propB],
            // Note: propNew is not in containerMap (simulating absent from renderChain)
        ])

        renderByRenderChain(stage, ['propA', 'charA', 'propB'], containerMap, mockRenderer)

        // propNew is not in renderChain, but should be rendered via union fallback
        expect(renderOrder).toContain('propNew')
        // union container itself should not be rendered as a whole
        expect(renderOrder).not.toContain('union')
        // Objects in renderChain render in order first, propNew renders in fallback stage
        const propNewIdx = renderOrder.indexOf('propNew')
        const propBIdx = renderOrder.indexOf('propB')
        expect(propNewIdx).toBeGreaterThan(propBIdx) // propNew comes after renderChain objects
    })

    it('should NOT double-render leaf internals inside union (rendering order regression)', () => {
        // Regression test: entity -> union(head[spriteHead], backHair[spriteHair]) 
        // renderChain: [backHair, head] (backHair draws first, head covers backHair)
        // If fallback recursively enters leaf containers, sprites would redraw in PIXI children order,
        // causing render order to become head -> backHair (backHair mistakenly covering head)
        const entity = new PIXI.Container()
        const union = makeContainer('composite_head_group')
        const head = makeContainer('head')
        const spriteHead = makeContainer('sprite_head')
        head.addChild(spriteHead)  // head internally has sprite child node
        const backHair = makeContainer('back_hair')
        const spriteHair = makeContainer('sprite_hair')
        backHair.addChild(spriteHair)  // backHair internally has sprite child node
        union.addChild(head, backHair)
        entity.addChild(union)

        const renderOrder: string[] = []
        const mockRenderer = {} as PIXI.Renderer

        // Mock render for all containers
        head.render = vi.fn(() => { renderOrder.push('head') })
        backHair.render = vi.fn(() => { renderOrder.push('back_hair') })
        spriteHead.render = vi.fn(() => { renderOrder.push('sprite_head') })
        spriteHair.render = vi.fn(() => { renderOrder.push('sprite_hair') })
        union.render = vi.fn(() => { renderOrder.push('union') })

        const containerMap = new Map<string, PIXI.Container>([
            ['back_hair', backHair], ['head', head],
        ])

        // renderChain: backHair first, head after (covers backHair)
        renderByRenderChain(entity, ['back_hair', 'head'], containerMap, mockRenderer)

        // Core assertion: each leaf is rendered exactly once (not duplicated by fallback)
        expect(backHair.render).toHaveBeenCalledTimes(1)
        expect(head.render).toHaveBeenCalledTimes(1)
        // Internal sprites should not be independently rendered (handled recursively by leaf container)
        expect(spriteHead.render).not.toHaveBeenCalled()
        expect(spriteHair.render).not.toHaveBeenCalled()
        // Render order correct: backHair precedes head
        expect(renderOrder).toEqual(['back_hair', 'head'])
        // union container should not be rendered as a whole
        expect(renderOrder).not.toContain('union')
    })

    it('should render non-renderChain children (overlays) at the end', () => {
        const entity = new PIXI.Container()
        const a = makeContainer('objA')
        const overlay = makeContainer('overlay_selection')
        entity.addChild(a, overlay)

        const renderOrder: string[] = []
        const mockRenderer = {} as PIXI.Renderer

        a.render = vi.fn(() => { renderOrder.push('objA') })
        overlay.render = vi.fn(() => { renderOrder.push('overlay') })

        const containerMap = new Map<string, PIXI.Container>([
            ['objA', a],
        ])

        renderByRenderChain(entity, ['objA'], containerMap, mockRenderer)

        // overlay not in renderChain -> renders last
        expect(renderOrder).toEqual(['objA', 'overlay'])
    })

    it('should render clip wrapper instead of bypassing it for wrapped targets', () => {
        const entity = new PIXI.Container()
        const wrapper = makeContainer('__clip_mask_wrapper__targetA')
        const target = makeContainer('targetA')
        const sibling = makeContainer('siblingB')
        wrapper.addChild(target)
        entity.addChild(wrapper, sibling)

        const renderOrder: string[] = []
        const mockRenderer = {} as PIXI.Renderer

        wrapper.render = vi.fn(() => { renderOrder.push('wrapper') })
        target.render = vi.fn(() => { renderOrder.push('target') })
        sibling.render = vi.fn(() => { renderOrder.push('sibling') })

        const containerMap = new Map<string, PIXI.Container>([
            ['targetA', target], ['siblingB', sibling],
        ])

        renderByRenderChain(entity, ['targetA', 'siblingB'], containerMap, mockRenderer)

        expect(renderOrder).toEqual(['wrapper', 'sibling'])
        expect(wrapper.render).toHaveBeenCalledTimes(1)
        expect(target.render).not.toHaveBeenCalled()
    })

    it('should skip invisible containers', () => {
        const entity = new PIXI.Container()
        const a = makeContainer('objA')
        const b = makeContainer('objB')
        b.visible = false
        entity.addChild(a, b)

        const renderOrder: string[] = []
        const mockRenderer = {} as PIXI.Renderer

        a.render = vi.fn(() => { renderOrder.push('objA') })
        b.render = vi.fn(() => { renderOrder.push('objB') })

        const containerMap = new Map<string, PIXI.Container>([
            ['objA', a], ['objB', b],
        ])

        renderByRenderChain(entity, ['objA', 'objB'], containerMap, mockRenderer)

        expect(renderOrder).toEqual(['objA'])
    })

    it('should correctly interleave back-hair behind body (real-world)', () => {
        // Real scenario: entity -> [backSkirt, legs, body, backOrnament, union(head+backHair+expression), leftHand, rightHand]
        // renderChain: [backOrnament, backSkirt, backHair, legs, rightHand, body, head, expression, leftHand]
        const entity = new PIXI.Container()
        const backSkirt = makeContainer('back_skirt')
        const legs = makeContainer('legs')
        const body = makeContainer('body')
        const backOrnament = makeContainer('back_ornament')
        const union = makeContainer('composite_head_group')
        const head = makeContainer('head')
        const backHair = makeContainer('back_hair')
        const expression = makeContainer('expression')
        union.addChild(head, backHair, expression)
        const leftHand = makeContainer('left_hand')
        const rightHand = makeContainer('right_hand')
        entity.addChild(backSkirt, legs, body, backOrnament, union, leftHand, rightHand)

        const renderOrder: string[] = []
        const mockRenderer = {} as PIXI.Renderer

        for (const c of [backSkirt, legs, body, backOrnament, head, backHair, expression, leftHand, rightHand, union]) {
            const name = c.name!
            c.render = vi.fn(() => { renderOrder.push(name) })
        }

        const containerMap = new Map<string, PIXI.Container>([
            ['back_ornament', backOrnament], ['back_skirt', backSkirt], ['back_hair', backHair],
            ['legs', legs], ['right_hand', rightHand], ['body', body],
            ['head', head], ['expression', expression], ['left_hand', leftHand],
        ])

        renderByRenderChain(
            entity,
            ['back_ornament', 'back_skirt', 'back_hair', 'legs', 'right_hand', 'body', 'head', 'expression', 'left_hand'],
            containerMap,
            mockRenderer,
        )

        // Core verification: backHair renders before body (body covers backHair)
        const backHairIdx = renderOrder.indexOf('back_hair')
        const bodyIdx = renderOrder.indexOf('body')
        expect(backHairIdx).toBeLessThan(bodyIdx)

        // head and expression render after body
        const headIdx = renderOrder.indexOf('head')
        const expressionIdx = renderOrder.indexOf('expression')
        expect(headIdx).toBeGreaterThan(bodyIdx)
        expect(expressionIdx).toBeGreaterThan(bodyIdx)

        // union container should not be rendered individually
        expect(renderOrder).not.toContain('composite_head_group')

        // Full order
        expect(renderOrder).toEqual([
            'back_ornament', 'back_skirt', 'back_hair', 'legs', 'right_hand', 'body', 'head', 'expression', 'left_hand',
        ])
    })
})

// ============================================================================
// installRenderChainRenderer
// ============================================================================

describe('installRenderChainRenderer', () => {
    it('should mark container with _hasRenderChainOverride', () => {
        const entity = new PIXI.Container()
        installRenderChainRenderer(entity, ['a'], new Map())
        expect((entity as PIXI.Container & { _hasRenderChainOverride?: boolean })._hasRenderChainOverride).toBe(true)
    })

    it('should not install on empty renderChain', () => {
        const entity = new PIXI.Container()
        const originalRender = entity.render
        installRenderChainRenderer(entity, [], new Map())
        expect(entity.render).toBe(originalRender)
    })
})

// ============================================================================
// installRootRenderChainRenderer - root stage scenario
// ============================================================================

describe('installRootRenderChainRenderer', () => {
    it('should mark container with _hasRootRenderChainOverride', () => {
        const stage = new PIXI.Container()
        installRootRenderChainRenderer(stage, () => [], () => undefined)
        expect((stage as PIXI.Container & { _hasRootRenderChainOverride?: boolean })._hasRootRenderChainOverride).toBe(true)
    })

    it('should cross-render root-level union children with direct stage children', () => {
        // Root scenario: stage has propA, unionContainer(charA, charB), propB
        // sceneRenderChain: [propA, charA, propB, charB]
        // Expected render order: propA -> charA -> propB -> charB (cross-container interleaving)
        const stage = new PIXI.Container()
        const propA = makeContainer('propA')
        const unionContainer = makeContainer('composite_union1')
        const charA = makeContainer('charA')
        const charB = makeContainer('charB')
        const propB = makeContainer('propB')

        unionContainer.addChild(charA, charB)
        stage.addChild(propA, unionContainer, propB)

        const renderOrder: string[] = []
        const mockRenderer = {} as PIXI.Renderer

        propA.render = vi.fn(() => { renderOrder.push('propA') })
        propB.render = vi.fn(() => { renderOrder.push('propB') })
        charA.render = vi.fn(() => { renderOrder.push('charA') })
        charB.render = vi.fn(() => { renderOrder.push('charB') })
        unionContainer.render = vi.fn(() => { renderOrder.push('union') })

        const containerMap = new Map<string, PIXI.Container>([
            ['propA', propA], ['charA', charA], ['propB', propB], ['charB', charB],
        ])
        const renderChain = ['propA', 'charA', 'propB', 'charB']

        installRootRenderChainRenderer(
            stage,
            () => renderChain,
            (id: string) => containerMap.get(id),
        )

        stage.render(mockRenderer)

        // union container should not be rendered individually
        expect(renderOrder).not.toContain('union')
        // Interleaved correctly according to renderChain
        expect(renderOrder).toEqual(['propA', 'charA', 'propB', 'charB'])
    })

    it('should use latest chain from resolver on each render call', () => {
        // Simulate renderChain reordering after zIndex change (resolver dynamic mode)
        const stage = new PIXI.Container()
        const a = makeContainer('objA')
        const b = makeContainer('objB')
        stage.addChild(a, b)

        const renderOrder: string[] = []
        const mockRenderer = {} as PIXI.Renderer

        let currentChain = ['objA', 'objB']
        const containerMap = new Map<string, PIXI.Container>([['objA', a], ['objB', b]])

        a.render = vi.fn(() => { renderOrder.push('objA') })
        b.render = vi.fn(() => { renderOrder.push('objB') })

        installRootRenderChainRenderer(
            stage,
            () => currentChain,
            (id: string) => containerMap.get(id),
        )

        // First render: order A -> B
        stage.render(mockRenderer)
        expect(renderOrder).toEqual(['objA', 'objB'])

        // Simulate zIndex change, renderChain inverted
        renderOrder.length = 0
        currentChain = ['objB', 'objA']

        // Second render: should use new chain, order B -> A
        stage.render(mockRenderer)
        expect(renderOrder).toEqual(['objB', 'objA'])
    })
})
