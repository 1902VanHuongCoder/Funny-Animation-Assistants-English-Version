/**
 * configImporter Unit Tests
 *
 * Tests config.json parsing, path collection, coordinate transformation, hierarchy processing
 *
 * Note: convertConfigToSceneObjects creates a CompositeObject for root node,
 * so output always contains a root composite.
 */
import { describe, expect, it } from 'vitest'

import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from '@/constants/canvas'
import type { ConfigRoot, ConfigSymbolNode, ConfigCompositeNode } from '@/types/configImportTypes'
import type { CompositeObject, SymbolObject } from '@/types/sceneObject'
import {
  collectAllFramePaths,
  convertConfigToSceneObjects,
  isVersionSatisfied,
  parseConfigJson,
} from '@/utils/configImporter'

// ===== Helpers =====

function makeSymbolNode(overrides: Partial<ConfigSymbolNode> = {}): ConfigSymbolNode {
  return {
    name: 'TestSymbol',
    type: 'symbol',
    elementType: 'symbol',
    frameCount: 1,
    frames: [{
      frame: 0,
      keyframe: 0,
      label: null,
      path: 'file:///D:/exports/test.png',
      type: 'single',
    }],
    instanceTransform: {
      width: 100,
      height: 80,
      registrationPoint: { parentX: 200, parentY: 300, localX: 50, localY: 40 },
      scaleX: 1, scaleY: 1, rotation: 0,
    },
    scaleFactor: 1,
    ...overrides,
  }
}

function makeConfigRoot(children: (ConfigSymbolNode | ConfigCompositeNode)[]): ConfigRoot {
  return {
    name: 'Root',
    type: 'composite',
    elementType: 'group',
    version: 'ver2.0.0',
    children,
  }
}

// ===== Tests =====

describe('parseConfigJson', () => {
  it('should parse valid config.json correctly', () => {
    const config = makeConfigRoot([makeSymbolNode()])
    const result = parseConfigJson(JSON.stringify(config))
    expect(result.type).toBe('composite')
    expect(result.children.length).toBe(1)
  })

  it('should throw error when root node is not composite', () => {
    const badJson = JSON.stringify({ type: 'symbol', name: 'Bad' })
    expect(() => parseConfigJson(badJson)).toThrow('root node must be of type composite')
  })

  it('should throw error when children is missing', () => {
    const badJson = JSON.stringify({ type: 'composite', name: 'NoChildren', version: 'ver2.0.0' })
    expect(() => parseConfigJson(badJson)).toThrow('missing children array')
  })

  it('should throw error when version field is missing', () => {
    const noVersion = JSON.stringify({ type: 'composite', name: 'Root', children: [] })
    expect(() => parseConfigJson(noVersion)).toThrow('missing version field')
  })

  it('should throw error when version is empty string', () => {
    const emptyVersion = JSON.stringify({ type: 'composite', name: 'Root', version: '', children: [] })
    expect(() => parseConfigJson(emptyVersion)).toThrow('missing version field')
  })

  it('should throw error when version is below ver2.0.0', () => {
    const oldVersion = JSON.stringify({ type: 'composite', name: 'Root', version: 'ver1.0.0', children: [] })
    expect(() => parseConfigJson(oldVersion)).toThrow('version is too low')
  })

  it('should throw error when version format is invalid', () => {
    const badVersion = JSON.stringify({ type: 'composite', name: 'Root', version: '1.0', children: [] })
    expect(() => parseConfigJson(badVersion)).toThrow('version is too low')
  })

  it('should accept ver2.0.0 and higher', () => {
    const v200 = JSON.stringify({ type: 'composite', name: 'Root', version: 'ver2.0.0', children: [] })
    expect(() => parseConfigJson(v200)).not.toThrow()

    const v210 = JSON.stringify({ type: 'composite', name: 'Root', version: 'ver2.1.0', children: [] })
    expect(() => parseConfigJson(v210)).not.toThrow()

    const v300 = JSON.stringify({ type: 'composite', name: 'Root', version: 'ver3.0.0', children: [] })
    expect(() => parseConfigJson(v300)).not.toThrow()
  })
})

describe('isVersionSatisfied', () => {
  it('should compare version numbers correctly', () => {
    expect(isVersionSatisfied('ver2.0.0', '2.0.0')).toBe(true)
    expect(isVersionSatisfied('ver2.1.0', '2.0.0')).toBe(true)
    expect(isVersionSatisfied('ver3.0.0', '2.0.0')).toBe(true)
    expect(isVersionSatisfied('ver1.9.9', '2.0.0')).toBe(false)
    expect(isVersionSatisfied('ver2.0.0', '2.0.1')).toBe(false)
    expect(isVersionSatisfied('ver1.0.0', '2.0.0')).toBe(false)
  })

  it('should return false when format is invalid', () => {
    expect(isVersionSatisfied('1.0', '2.0.0')).toBe(false)
    expect(isVersionSatisfied('', '2.0.0')).toBe(false)
    expect(isVersionSatisfied('ver', '2.0.0')).toBe(false)
  })
})

describe('collectAllFramePaths', () => {
  it('should collect frame paths of all symbol nodes', () => {
    const config = makeConfigRoot([
      makeSymbolNode({ name: 'A', frames: [{ frame: 0, keyframe: 0, label: null, path: 'file:///a.png', type: 'single' }] }),
      makeSymbolNode({ name: 'B', frames: [
        { frame: 0, keyframe: 0, label: null, path: 'file:///b1.png', type: 'single' },
        { frame: 1, keyframe: 1, label: null, path: 'file:///b2.png', type: 'single' },
      ] }),
    ])

    const paths = collectAllFramePaths(config)
    expect(paths.size).toBe(3)
    expect(paths.has('file:///a.png')).toBe(true)
    expect(paths.has('file:///b1.png')).toBe(true)
    expect(paths.has('file:///b2.png')).toBe(true)
  })

  it('should recursively traverse symbols in nested composites', () => {
    const config = makeConfigRoot([
      {
        name: 'Group1',
        type: 'composite' as const,
        elementType: 'group',
        children: [
          makeSymbolNode({ name: 'Nested', frames: [{ frame: 0, keyframe: 0, label: null, path: 'file:///nested.png', type: 'single' }] }),
        ],
      },
    ])

    const paths = collectAllFramePaths(config)
    expect(paths.has('file:///nested.png')).toBe(true)
  })
})

describe('convertConfigToSceneObjects - Root node processing', () => {
  it('should create CompositeObject for root composite', async () => {
    const config = makeConfigRoot([makeSymbolNode()])

    const objects = await convertConfigToSceneObjects(
      config, CANVAS_CENTER_X, CANVAS_CENTER_Y,
      new Map(), new Map(), ''
    )

    // root composite + 1 symbol = 2 objects
    expect(objects.length).toBe(2)

    const rootComposite = objects[0]! as CompositeObject
    expect(rootComposite.type).toBe('composite')
    expect(rootComposite.name).toBe('Root')
    expect(rootComposite.childIds.length).toBe(1)

    const symbol = objects[1]!
    expect(symbol.type).toBe('symbol')
    expect(symbol.parentId).toBe(rootComposite.id)
  })

  it('root composite should center on canvas', async () => {
    const config = makeConfigRoot([makeSymbolNode()])

    const objects = await convertConfigToSceneObjects(
      config, CANVAS_CENTER_X, CANVAS_CENTER_Y,
      new Map(), new Map(), ''
    )

    // root composite is sole top-level object, should center
    const root = objects[0]!
    expect(root.parentId).toBeUndefined()
    expect(root.x).toBe(CANVAS_CENTER_X)
    expect(root.y).toBe(CANVAS_CENTER_Y)
  })
})

describe('convertConfigToSceneObjects - Coordinate transformation', () => {
  it('should correctly use registrationPoint to compute center coordinates', async () => {
    // registrationPoint: parentX=200, parentY=300, localX=50, localY=40
    // centerX = 200 + (100/2 - 50) = 200
    // centerY = 300 + (80/2 - 40) = 300
    // root composite center = child mean = (200, 300)
    // child local coordinates = (200-200, 300-300) = (0, 0)
    const config = makeConfigRoot([makeSymbolNode()])

    const objects = await convertConfigToSceneObjects(
      config, CANVAS_CENTER_X, CANVAS_CENTER_Y,
      new Map(), new Map(), ''
    )

    const symbol = objects.find(o => o.type === 'symbol')!
    // Single child object, local coordinates (0, 0)
    expect(symbol.x).toBe(0)
    expect(symbol.y).toBe(0)
  })

  it('should correctly calculate offset with asymmetric registrationPoint', async () => {
    // registrationPoint: parentX=0, parentY=0, localX=0, localY=0
    // width=200, height=100
    // centerX = 0 + (200/2 - 0) = 100
    // centerY = 0 + (100/2 - 0) = 50
    const node = makeSymbolNode({
      instanceTransform: {
        width: 200, height: 100,
        registrationPoint: { parentX: 0, parentY: 0, localX: 0, localY: 0 },
        scaleX: 1, scaleY: 1, rotation: 0,
      },
    })
    const config = makeConfigRoot([node])

    const objects = await convertConfigToSceneObjects(
      config, CANVAS_CENTER_X, CANVAS_CENTER_Y,
      new Map(), new Map(), ''
    )

    // root composite centered on canvas
    const root = objects[0]!
    expect(root.x).toBe(CANVAS_CENTER_X)
    expect(root.y).toBe(CANVAS_CENTER_Y)

    // child local coordinates = (0, 0)
    const symbol = objects.find(o => o.type === 'symbol')!
    expect(symbol.x).toBe(0)
    expect(symbol.y).toBe(0)
  })
})

describe('convertConfigToSceneObjects - Hierarchy processing', () => {
  it('should create full hierarchy for nested composites', async () => {
    const config = makeConfigRoot([
      {
        name: 'MyGroup',
        type: 'composite' as const,
        elementType: 'group',
        children: [
          makeSymbolNode({ name: 'Child1' }),
          makeSymbolNode({ name: 'Child2' }),
        ],
      },
    ])

    const objects = await convertConfigToSceneObjects(
      config, CANVAS_CENTER_X, CANVAS_CENTER_Y,
      new Map(), new Map(), ''
    )

    // root composite + nested composite + 2 symbols = 4 objects
    expect(objects.length).toBe(4)

    const composites = objects.filter(o => o.type === 'composite') as CompositeObject[]
    expect(composites.length).toBe(2)

    const rootComposite = composites.find(c => c.name === 'Root')!
    const nestedComposite = composites.find(c => c.name === 'MyGroup')!
    const symbols = objects.filter(o => o.type === 'symbol')

    // nested composite is child of root
    expect(nestedComposite.parentId).toBe(rootComposite.id)
    expect(rootComposite.childIds).toContain(nestedComposite.id)

    // symbol is child of nested composite
    expect(nestedComposite.childIds.length).toBe(2)
    for (const sym of symbols) {
      expect(sym.parentId).toBe(nestedComposite.id)
      expect(nestedComposite.childIds).toContain(sym.id)
    }
  })

  it('child coordinates should be local to composite', async () => {
    // Both child symbols identical position: centerX=200, centerY=300
    // nested composite center = (200, 300)
    // child local coordinates = (0, 0)
    const config = makeConfigRoot([
      {
        name: 'Group',
        type: 'composite' as const,
        elementType: 'group',
        children: [
          makeSymbolNode({ name: 'A' }),
          makeSymbolNode({ name: 'B' }),
        ],
      },
    ])

    const objects = await convertConfigToSceneObjects(
      config, CANVAS_CENTER_X, CANVAS_CENTER_Y,
      new Map(), new Map(), ''
    )

    const symbols = objects.filter(o => o.type === 'symbol')
    for (const sym of symbols) {
      expect(sym.x).toBe(0)
      expect(sym.y).toBe(0)
    }
  })
})

describe('convertConfigToSceneObjects - Overall centering', () => {
  it('root composite with multiple children should center on canvas', async () => {
    const sym1 = makeSymbolNode({
      name: 'Left',
      instanceTransform: {
        width: 100, height: 80,
        registrationPoint: { parentX: 0, parentY: 0, localX: 50, localY: 40 },
        scaleX: 1, scaleY: 1, rotation: 0,
      },
    })
    const sym2 = makeSymbolNode({
      name: 'Right',
      instanceTransform: {
        width: 100, height: 80,
        registrationPoint: { parentX: 400, parentY: 0, localX: 50, localY: 40 },
        scaleX: 1, scaleY: 1, rotation: 0,
      },
    })
    const config = makeConfigRoot([sym1, sym2])

    const objects = await convertConfigToSceneObjects(
      config, CANVAS_CENTER_X, CANVAS_CENTER_Y,
      new Map(), new Map(), ''
    )

    // root composite centered on canvas center
    const root = objects[0]!
    expect(root.type).toBe('composite')
    expect(root.x).toBe(CANVAS_CENTER_X)
    expect(root.y).toBe(CANVAS_CENTER_Y)

    // sym1 original centerX = 0; sym2 original centerX = 400
    // composite center = (0+400)/2 = 200
    // sym1 local = 0 - 200 = -200; sym2 local = 400 - 200 = 200
    const symbols = objects.filter(o => o.type === 'symbol')
    const left = symbols.find(s => s.name === 'Left')!
    const right = symbols.find(s => s.name === 'Right')!
    expect(left.x).toBe(-200)
    expect(right.x).toBe(200)
  })

  it('optional fitTo should uniformly scale root composite inside target viewport', async () => {
    const large = makeSymbolNode({
      name: 'LargeScene',
      instanceTransform: {
        width: 4000, height: 2000,
        registrationPoint: { parentX: 0, parentY: 0, localX: 0, localY: 0 },
        scaleX: 1, scaleY: 1, rotation: 0,
      },
    })
    const config = makeConfigRoot([large])

    const objects = await convertConfigToSceneObjects(
      config, CANVAS_CENTER_X, CANVAS_CENTER_Y,
      new Map(), new Map(), '',
      'entity',
      { width: 1000, height: 500 }
    )

    const root = objects[0]!
    expect(root.x).toBe(CANVAS_CENTER_X)
    expect(root.y).toBe(CANVAS_CENTER_Y)
    expect(root.width).toBe(4000)
    expect(root.height).toBe(2000)
    expect(root.scaleX).toBe(0.25)
    expect(root.scaleY).toBe(0.25)
  })
})

describe('convertConfigToSceneObjects - symbol properties', () => {
  it('should create SymbolObject and preserve scaleX/scaleY/rotation/alpha', async () => {
    const node = makeSymbolNode({
      alpha: 0.65,
      instanceTransform: {
        width: 200, height: 150,
        registrationPoint: { parentX: 0, parentY: 0, localX: 0, localY: 0 },
        scaleX: 0.5, scaleY: 0.8, rotation: 45,
      },
    })
    const config = makeConfigRoot([node])

    const objects = await convertConfigToSceneObjects(
      config, CANVAS_CENTER_X, CANVAS_CENTER_Y,
      new Map(), new Map(), ''
    )

    const sym = objects.find(o => o.type === 'symbol')! as SymbolObject
    expect(sym.type).toBe('symbol')
    expect(sym.width).toBe(200)
    expect(sym.height).toBe(150)
    expect(sym.scaleX).toBe(0.5)
    expect(sym.scaleY).toBe(0.8)
    expect(sym.rotation).toBe(45 * Math.PI / 180)
    expect(sym.alpha).toBe(0.65)
    expect(sym.materials.length).toBe(1)
    expect(sym.materials[0]!.type).toBe('static')
    expect(sym.materials[0]!.url).toBe('')
  })
})
