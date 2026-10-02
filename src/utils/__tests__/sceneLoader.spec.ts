import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { SceneSetup } from '@/types/screenplay'
import { loadSetupToSceneObjects, collectSetupFromSceneObjects } from '../sceneLoader'
import { CANVAS_CENTER_X, CANVAS_CENTER_Y, CAMERA_BASE_WIDTH, CAMERA_BASE_HEIGHT } from '@/constants/canvas'

describe('sceneLoader', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('collectSetupFromSceneObjects should save background width/height', () => {
    const sceneObjectStore = useSceneObjectStore()
    const bg = sceneObjectStore.createBackgroundObject('bg_test', 'Background')
    sceneObjectStore.updateObject(bg.id, {
      x: 123,
      y: 456,
      width: 1111,
      height: 2222,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      zIndex: -10
    })

    const setup = collectSetupFromSceneObjects()
    const savedBg = setup.objects.find(o => o.id === bg.id)

    expect(savedBg).toBeDefined()
    expect(savedBg?.type).toBe('background')
    expect(savedBg?.x).toBe(123)
    expect(savedBg?.y).toBe(456)
    expect(savedBg?.width).toBe(1111)
    expect(savedBg?.height).toBe(2222)
  })

  it('loadSetupToSceneObjects should load background width/height if present', () => {
    const setup: SceneSetup = {
      camera: { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y, width: CAMERA_BASE_WIDTH, height: CAMERA_BASE_HEIGHT, zoom: 1 },
      objects: [
        {
          id: 'sceneobject_bg_1',
          type: 'background',
          refId: 'bg_test',
          name: 'bg_test',
          x: 10,
          y: 20,
          width: 1000,
          height: 1400,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          zIndex: -10,
          alpha: 1,
          flipX: false,
          visible: true
        }
      ],
      renderChain: ['sceneobject_bg_1'],
    }

    loadSetupToSceneObjects(setup)

    const sceneObjectStore = useSceneObjectStore()
    const bg = sceneObjectStore.getObject('sceneobject_bg_1') as any

    expect(bg).toBeDefined()
    expect(bg.type).toBe('background')
    expect(bg.x).toBe(10)
    expect(bg.y).toBe(20)
    expect(bg.width).toBe(1000)
    expect(bg.height).toBe(1400)
  })

  it('loadSetupToSceneObjects should load prop width/height if present', () => {
    const setup: SceneSetup = {
      camera: { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y, width: CAMERA_BASE_WIDTH, height: CAMERA_BASE_HEIGHT, zoom: 1 },
      objects: [
        {
          id: 'sceneobject_prop_1',
          type: 'prop',
          refId: 'prop_test',
          name: 'prop_test',
          x: 10,
          y: 20,
          width: 333,
          height: 444,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          zIndex: 0,
          alpha: 1,
          flipX: false,
          visible: true
        }
      ],
      renderChain: ['sceneobject_prop_1'],
    }

    loadSetupToSceneObjects(setup)

    const sceneObjectStore = useSceneObjectStore()
    const prop = sceneObjectStore.getObject('sceneobject_prop_1') as any

    expect(prop).toBeDefined()
    expect(prop.type).toBe('prop')
    expect(prop.width).toBe(333)
    expect(prop.height).toBe(444)
  })

  it('loadSetupToSceneObjects should backfill text objects for legacy renderChain', () => {
    const setup: SceneSetup = {
      camera: { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y, width: CAMERA_BASE_WIDTH, height: CAMERA_BASE_HEIGHT, zoom: 1 },
      objects: [
        {
          id: 'sceneobject_text_1',
          type: 'text',
          refId: '',
          name: 'Text',
          alias: 'Text',
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
          zIndex: 100,
          alpha: 1,
          flipX: false,
          visible: true,
        } as SceneSetup['objects'][number],
        {
          id: 'sceneobject_effect_1',
          type: 'screen_effect',
          refId: 'fullscreen_cover',
          effectClass: 'fullscreen_cover',
          name: 'Black Screen',
          alias: 'Black Screen',
          params: { baseColor: '#000000', openRatio: 1 },
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          zIndex: 1000,
          alpha: 1,
          flipX: false,
          visible: true,
        } as SceneSetup['objects'][number],
      ],
      // Text was previously excluded from chain in legacy data; should auto-backfill and sort by zIndex on load.
      renderChain: ['sceneobject_effect_1'],
    }

    loadSetupToSceneObjects(setup)

    const sceneObjectStore = useSceneObjectStore()
    expect(sceneObjectStore.getSceneRenderChain()).toEqual(['sceneobject_text_1', 'sceneobject_effect_1'])
  })

  it('collectSetupFromSceneObjects should preserve refId for all object types', () => {
    const sceneObjectStore = useSceneObjectStore()

    // Background
    const bg = sceneObjectStore.createBackgroundObject('bg_ref_123', 'Test Background')
    // Prop
    const prop = sceneObjectStore.createPropObject('prop_ref_456', 'Test Prop')

    const setup = collectSetupFromSceneObjects()

    const savedBg = setup.objects.find(o => o.id === bg.id)
    expect(savedBg?.refId).toBe('bg_ref_123')

    const savedProp = setup.objects.find(o => o.id === prop.id)
    expect(savedProp?.refId).toBe('prop_ref_456')
  })

  it('loadSetupToSceneObjects should restore parentId correctly when composite precedes children', () => {
    // Regression test: when composite precedes children in scene templates,
    // children parentId must be restored properly after save & reload
    const setup: SceneSetup = {
      camera: { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y, width: CAMERA_BASE_WIDTH, height: CAMERA_BASE_HEIGHT, zoom: 1 },
      objects: [
        // composite precedes children (fixed order from scene template addition)
        {
          id: 'composite_1',
          type: 'composite',
          refId: '',
          name: 'Composite',
          alias: 'Composite',
          childIds: ['prop_child', 'bg_child'],
          compositeMode: 'entity',
          x: 3360, y: 700,
          width: 0, height: 0,
          scaleX: 1, scaleY: 1, rotation: 0,
          alpha: 1, flipX: false, zIndex: 10,
          visible: true, spawned: true,
        } as SceneSetup['objects'][number],
        {
          id: 'prop_child',
          type: 'prop',
          refId: 'prop_test',
          name: 'Prop',
          alias: 'Prop',
          parentId: 'composite_1',
          x: 10, y: 20,
          width: 100, height: 100,
          scaleX: 1, scaleY: 1, rotation: 0,
          alpha: 1, flipX: false, zIndex: 10,
          visible: true, spawned: true,
        },
        {
          id: 'bg_child',
          type: 'background',
          refId: 'bg_test',
          name: 'Background',
          alias: 'Background',
          parentId: 'composite_1',
          x: 0, y: 0,
          width: 500, height: 300,
          scaleX: 1, scaleY: 1, rotation: 0,
          alpha: 1, flipX: false, zIndex: -10,
          visible: true, spawned: true,
        },
      ],
      renderChain: ['composite_1'],
    }

    loadSetupToSceneObjects(setup)

    const sceneObjectStore = useSceneObjectStore()

    // Verify composite loaded correctly
    const composite = sceneObjectStore.getObject('composite_1')
    expect(composite).toBeDefined()
    expect(composite?.type).toBe('composite')

    // Key assertion: children parentId must point to composite
    const prop = sceneObjectStore.getObject('prop_child')
    expect(prop).toBeDefined()
    expect(prop?.parentId).toBe('composite_1')

    const bg = sceneObjectStore.getObject('bg_child')
    expect(bg).toBeDefined()
    expect(bg?.parentId).toBe('composite_1')
  })

  it('collectSetupFromSceneObjects -> loadSetupToSceneObjects round-trip preserves parentId', () => {
    const sceneObjectStore = useSceneObjectStore()

    // Create composite object and children
    const prop = sceneObjectStore.createPropObject('prop_ref', 'Prop')
    const bg = sceneObjectStore.createBackgroundObject('bg_ref', 'Background')
    const composite = sceneObjectStore.createCompositeObject('Composite', [prop.id, bg.id])

    // Confirm parentId is correct upon creation
    expect(sceneObjectStore.getObject(prop.id)?.parentId).toBe(composite.id)
    expect(sceneObjectStore.getObject(bg.id)?.parentId).toBe(composite.id)

    // Save
    const setup = collectSetupFromSceneObjects()

    // Clear and reload
    sceneObjectStore.clearObjects()
    loadSetupToSceneObjects(setup)

    // Key assertion: parentId must be preserved after round-trip
    const reloadedProp = sceneObjectStore.getObject(prop.id)
    expect(reloadedProp).toBeDefined()
    expect(reloadedProp?.parentId).toBe(composite.id)

    const reloadedBg = sceneObjectStore.getObject(bg.id)
    expect(reloadedBg).toBeDefined()
    expect(reloadedBg?.parentId).toBe(composite.id)
  })

  it('collectSetupFromSceneObjects -> loadSetupToSceneObjects round-trip preserves receiveLighting and castShadow', () => {
    const sceneObjectStore = useSceneObjectStore()

    const prop = sceneObjectStore.createPropObject('prop_ref_light', 'Test Prop')
    sceneObjectStore.updateObject(prop.id, {
      receiveLighting: false,
      castShadow: true,
    })

    const setup = collectSetupFromSceneObjects()
    const savedProp = setup.objects.find(o => o.id === prop.id)

    expect(savedProp).toBeDefined()
    expect(savedProp?.receiveLighting).toBe(false)
    expect(savedProp?.castShadow).toBe(true)

    sceneObjectStore.clearObjects()
    loadSetupToSceneObjects(setup)

    const reloadedProp = sceneObjectStore.getObject(prop.id)
    expect(reloadedProp).toBeDefined()
    expect(reloadedProp?.receiveLighting).toBe(false)
    expect(reloadedProp?.castShadow).toBe(true)
  })

  it('collectSetupFromSceneObjects -> loadSetupToSceneObjects round-trip preserves light spawned=false', () => {
    const sceneObjectStore = useSceneObjectStore()

    const light = sceneObjectStore.createLightObject('point', 'Test Point Light', {
      x: 320,
      y: 480,
      lightRadius: 280,
      lightIntensity: 0.9,
    })
    sceneObjectStore.updateObject(light.id, {
      spawned: false,
    })

    const setup = collectSetupFromSceneObjects()
    const savedLight = setup.objects.find(o => o.id === light.id)

    expect(savedLight).toBeDefined()
    expect(savedLight?.type).toBe('light')
    expect(savedLight?.spawned).toBe(false)

    sceneObjectStore.clearObjects()
    loadSetupToSceneObjects(setup)

    const reloadedLight = sceneObjectStore.getObject(light.id)
    expect(reloadedLight).toBeDefined()
    expect(reloadedLight?.type).toBe('light')
    expect(reloadedLight?.spawned).toBe(false)
  })
})
