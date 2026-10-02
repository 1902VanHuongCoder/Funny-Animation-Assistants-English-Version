/**
 * useSceneGraph - Layer and object management module
 * 
 * Responsibilities:
 * 1. Create, update, and remove Pixi containers for scene objects
 * 2. Manage renderCache (object ID -> Pixi container mapping)
 * 3. Apply object transforms (position, scale, rotation, etc.)
 * 
 * Decoupling notes:
 * - Transforms data into Pixi objects only; does not handle interactions
 * - Does not depend on Store watch; renderObjects is invoked externally
 */

import * as PIXI from 'pixi.js'
import { reactive } from 'vue'

import { useAssetImage } from '@/composables/useAssetImage'
import { useAssetLoader } from '@/composables/useAssetLoader'
import { CANVAS_CENTER_X, CANVAS_CENTER_Y, CANVAS_HEIGHT, CANVAS_WIDTH } from '@/constants/canvas'
import { Z_INDEX_BACKGROUND, Z_INDEX_CAMERA_OVERLAY, Z_INDEX_DEFAULT, Z_INDEX_GHOST } from '@/constants/zIndex'
import { createGenericAnimationPlayer, GenericAnimationPlayer } from '@/core/GenericAnimationPlayer'
import { registerCompositeContainerFactory } from '@/core/sceneObjectProviders/compositeProvider'
import { getContainerFactory, registerContainerFactory } from '@/core/sceneObjectProviders/index'
import { SceneObjectRenderer } from '@/core/SceneObjectRenderer'
import type { TextureProvider } from '@/core/TextureProvider'
import { useBackgroundStore } from '@/stores/backgroundStore'
import { useExpressionStore } from '@/stores/expressionStore'
import { usePropStore } from '@/stores/propStore'
import { type BackgroundObject, type CameraObject, type PropObject, type SceneObject, type ScreenEffectObject, type SymbolObject, type TextObject, useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { LightObject } from '@/types/sceneObject'
import type { SceneObjectProvider } from '@/types/SceneObjectProvider'
import type { RuntimeSceneSnapshot, RuntimeSlot, SceneContainer, ScriptBlock } from '@/types/screenplay'
import { collectSceneFontPreloadObjects, ensureFontLoaded, preloadSceneFonts } from '@/utils/fontLoader'
import { addPixiDebugInfo, updatePixiDebugInfo } from '@/utils/pixiDebug'
import { applyBlockActionsToState, calculatePrevContext, calculateSlotStates, type RuntimeCameraState, type SlotStatesResult } from '@/utils/sceneStateCalculator'
import { drawScreenEffectGraphics } from '@/utils/screenEffectRenderer'
import { getAutoTextLeading, normalizeTextContent, resolveTextGradient, resolveTextLineHeight } from '@/utils/textUtils'

export interface UseSceneGraphOptions {
  mode: 'setup' | 'action'
  /** Optional store override for data-isolated scenes (e.g. animation editing). Uses global sceneObjectStore if omitted */
  storeOverride?: SceneObjectProvider
}

export function useSceneGraph(options: UseSceneGraphOptions) {
  const { mode } = options
  const PIXI_TREE_DEBUG_FLAG = '__AITALK_PIXI_TREE_DEBUG__'

  function isPixiTreeDebugEnabled(): boolean {
    if (typeof window === 'undefined') return false
    const globalEnabled = (window as unknown as Record<string, unknown>)[PIXI_TREE_DEBUG_FLAG] === true
    const localEnabled = window.localStorage?.getItem('aitalk:pixi-tree-debug') === '1'
    return globalEnabled || localEnabled
  }

  function logPixiTree(event: string, payload: Record<string, unknown>): void {
    if (!isPixiTreeDebugEnabled()) return
    console.warn(`[PixiTreeDebug][SceneGraph] ${event}`, payload)
  }

  const backgroundStore = useBackgroundStore()
  const propStore = usePropStore()
  // v7.3: effectStore removed
  const _globalStore = useSceneObjectStore()
  const sceneObjectStore: SceneObjectProvider = options.storeOverride ?? _globalStore

  // v14.x: Unified renderer
  const { getTexture: _getTexture } = useAssetLoader()
  const { getImageUrl: _getImageUrl } = useAssetImage()
  const textureProvider: TextureProvider = {
    getTexture: (url: string) => _getTexture(url),
    getImageUrl: (url: string) => _getImageUrl(url)
  }
  const sceneObjectRenderer = new SceneObjectRenderer(
    textureProvider,
    {
      propStore,
      backgroundStore,
      expressionStore: useExpressionStore()
    }
  )
  const noOpObjectStateHost = {
    getObjectDimensions: () => undefined,
    setObjectDimensions: () => undefined,
  }
  const textFontRenderTokens = new WeakMap<PIXI.Container, number>()

  async function ensureTextFontForRender(container: PIXI.Container, textObj: TextObject): Promise<boolean> {
    const token = (textFontRenderTokens.get(container) ?? 0) + 1
    textFontRenderTokens.set(container, token)
    await ensureFontLoaded(textObj.fontFamily ?? 'Noto Sans SC', textObj.content)
    return !container.destroyed && textFontRenderTokens.get(container) === token
  }

  function isAmbientLightObject(obj: SceneObject | undefined | null): obj is LightObject {
    return !!obj && obj.type === 'light' && (obj as LightObject).lightType === 'ambient'
  }

  // P1: Register container factories for each type (lightweight registration: reuse local functions)
  registerContainerFactory('background', (obj) => createBackgroundContainer(obj as BackgroundObject))
  registerContainerFactory('camera', (obj) => Promise.resolve(createCameraContainer(obj as CameraObject)))
  registerContainerFactory('text', async (obj) => {
    const textObj = obj as TextObject
    await ensureFontLoaded(textObj.fontFamily ?? 'Noto Sans SC', textObj.content)
    return createTextContainer(textObj)
  })
  registerContainerFactory('prop', (obj) => createPropContainer(obj as PropObject))
  registerContainerFactory('screen_effect', (obj) => Promise.resolve(createScreenEffectContainer(obj as ScreenEffectObject)))
  // Clip-Mask Phase 1: mask object itself does not render any content; only needs an empty Container to hold
  // worldTransform for maskRenderer.applyAllMasks geometry computation.
  registerContainerFactory('mask', (obj) => {
    const container = new PIXI.Container()
    container.name = `mask_container_${obj.id}`
    container.visible = true
    return Promise.resolve(container)
  })
  registerContainerFactory('symbol', async (obj) => {
    // v16: Preload material textures before creating container
    const symbolObj = obj as SymbolObject
    const materialId = symbolObj.currentMaterialId
    const material = materialId
      ? symbolObj.materials?.find(m => m.id === materialId)
      : symbolObj.materials?.[0]
    if (material) {
      await preloadEditorSymbolMaterialTextures(material)
    }
    const container = createEditorSymbolContainer(obj)
    return container
  })
  // v18: Independent expression container factory (preloads expression textures)
  registerContainerFactory('expression', async (obj) => {
    const expressionStore = useExpressionStore()
    const expr = expressionStore.getExpression(obj.refId)
    if (expr) {
      const urls = new Set<string>()
      if (expr.defaultFrame?.url) urls.add(expr.defaultFrame.url)
      expr.speakingFrames?.forEach(frame => {
        if (frame?.url) urls.add(frame.url)
      })
      if (urls.size > 0) {
        const { loadAssets } = useAssetLoader()
        await loadAssets(urls, new Set(), `SceneGraph.expression.create(${obj.id})`)
      }
    }
    return sceneObjectRenderer.createExpressionContainer(obj)
  })
  // v25: Light source container factory (editor indicator, does not participate in actual rendering)
  registerContainerFactory('light', (obj) => {
    const container = new PIXI.Container()
    container.name = `light_container_${obj.id}`
    // Light source uses fixed rectangular hit area matching selection box to avoid only hitting the icon itself
    container.eventMode = 'static'
    container.hitArea = new PIXI.Rectangle(-96, -96, 192, 192)
    return Promise.resolve(container)
  })
  // P2: composite container factory (registered via compositeProvider, injects getObjects callback)
  registerCompositeContainerFactory(() => sceneObjectStore.objects)

  /**
   * v16: Preload Symbol material textures into global textureCache
   * Blob URLs create PIXI.Texture directly via Image; project file paths use standard loadAssets pipeline
   */
  function collectAnimatedFirstPaintUrls(options: {
    url?: string | undefined
    backgroundImage?: string | undefined
    stillFrameCustomUrl?: string | undefined
    frames?: { url?: string }[] | undefined
  }): string[] {
    const urls: string[] = []
    if (options.stillFrameCustomUrl) urls.push(options.stillFrameCustomUrl)
    if (options.url) urls.push(options.url)
    if (options.backgroundImage) urls.push(options.backgroundImage)
    const firstFrameUrl = options.frames?.find(frame => frame.url)?.url
    if (firstFrameUrl) urls.push(firstFrameUrl)
    return Array.from(new Set(urls))
  }

  async function preloadSymbolMaterialTextures(material: { type: string; url?: string; frames?: { url?: string }[] }) {
    const urls = new Set<string>()
    if (material.type === 'static') {
      if (material.url) urls.add(material.url)
    } else if (material.frames) {
      for (const frame of material.frames) {
        if (frame.url) urls.add(frame.url)
      }
      // Still frame URL
      if (material.url) urls.add(material.url)
    }
    if (urls.size === 0) return

    const { loadAssets } = useAssetLoader()
    await loadAssets(urls, new Set(), 'SceneGraph.symbol.fullMaterial')
  }

  async function preloadEditorSymbolMaterialTextures(material: { type: string; url?: string; frames?: { url?: string }[] }) {
    const urls = new Set<string>(collectAnimatedFirstPaintUrls({
      url: material.url,
      frames: material.frames
    }))
    if (material.type === 'static' && material.url) {
      urls.add(material.url)
    }
    if (urls.size === 0) return

    const { loadAssets } = useAssetLoader()
    await loadAssets(urls, new Set(), 'SceneGraph.symbol.firstPaintMaterial')
  }

  function resolveEditorAnimationStillUrl(options: {
    stillFrameSource: 'frame' | 'custom' | undefined
    stillFrameIndex: number | undefined
    customUrl: string | undefined
    posterUrl: string | undefined
    frames: { url?: string }[] | undefined
  }): string | undefined {
    if (options.stillFrameSource === 'custom' && options.customUrl) {
      return options.customUrl
    }

    if (options.stillFrameSource === 'frame') {
      const indexedUrl = options.frames?.[options.stillFrameIndex ?? 0]?.url
      if (indexedUrl) return indexedUrl
    }

    return options.frames?.find(frame => frame.url)?.url ?? options.posterUrl
  }

  function createEditorAnimationSpriteContainer(options: {
    objectId: string
    zIndex: number | undefined
    stillUrl: string | undefined
  }): PIXI.Container {
    const container = new PIXI.Container()
    container.name = options.objectId
    container.zIndex = options.zIndex ?? 0

    if (options.stillUrl) {
      const resolvedUrl = textureProvider.getImageUrl(options.stillUrl)
      const texture = textureProvider.getTexture(resolvedUrl || options.stillUrl)
      const sprite = new PIXI.Sprite(texture)
      sprite.name = 'editor_still_sprite'
      sprite.anchor.set(0.5)
      container.addChild(sprite)
    }

    return container
  }

  function createEditorSymbolContainer(obj: SceneObject): PIXI.Container {
    const symbolObj = obj as SymbolObject
    const materialId = symbolObj.currentMaterialId
    const material = materialId
      ? symbolObj.materials?.find(m => m.id === materialId)
      : symbolObj.materials?.[0]

    if (material?.type !== 'animation') {
      return sceneObjectRenderer.createSymbolContainer(obj)
    }

    const stillUrl = resolveEditorAnimationStillUrl({
      stillFrameSource: material.stillFrameSource,
      stillFrameIndex: material.stillFrameIndex,
      customUrl: material.stillFrameSource === 'custom' ? material.url : undefined,
      posterUrl: material.url,
      frames: material.frames,
    })

    const container = createEditorAnimationSpriteContainer({
      objectId: obj.id,
      zIndex: obj.zIndex,
      stillUrl,
    })

    ; (container as PIXI.Container & { _renderedMaterialId?: string })._renderedMaterialId = material.id
    return container
  }

  function createEditorPropContainer(obj: PropObject): PIXI.Container {
    const propData = propStore.getProp(obj.refId)
    if (propData?.type !== 'animation') {
      return sceneObjectRenderer.createPropContainer(obj as unknown as import('@/types/sceneObject').SceneObject)
    }

    const stillUrl = resolveEditorAnimationStillUrl({
      stillFrameSource: propData.stillFrameSource,
      stillFrameIndex: propData.stillFrameIndex,
      customUrl: propData.stillFrameCustomUrl,
      posterUrl: propData.url,
      frames: propData.frames,
    })

    return createEditorAnimationSpriteContainer({
      objectId: obj.id,
      zIndex: obj.zIndex,
      stillUrl,
    })
  }

  // v11.0: Generic animation player cache (supports Prop and Background)
  const genericAnimationPlayerCache = new Map<string, GenericAnimationPlayer>()

  // Render cache (objectId -> PIXI container)
  const renderCache = new Map<string, PIXI.Container>()



  // Render locks
  let isRendering = false
  let pendingRender = false

  // Action Mode state cache
  let currentScene: SceneContainer | null = null
  let currentBlock: ScriptBlock | null = null
  let cachedPrevContext: RuntimeSceneSnapshot | null = null
  let cachedPrevContextBlockId: string | null = null
  const slotStatesCache = new Map<number, SlotStatesResult>()

  // ==================== Ghost Mode State ====================
  // Ghost Container cache (objectId -> ghost PIXI.Container)
  const ghostContainerCache = new Map<string, PIXI.Container>()
  // Ghost Camera Container
  let ghostCameraContainer: PIXI.Container | null = null
  // Current Slot index (used for Ghost calculation)
  let currentSlotIndex = 0
  // v8.6: Current Block's Slots (migrated here from Renderer)
  let currentSlots: RuntimeSlot[] = []
  // Current Slot states result cache
  let currentSlotStates: SlotStatesResult | null = null

  /**
   * Get calculated object state for current Slot in Action Mode
   *
   * v21: applySlotState writes evaluation results into runtimeObjects,
   * sceneObjectStore.getObject(obj.id) returns runtime values directly in Action Mode.
   * The obj argument may already be an object from runtimeObjects (from sceneObjectStore.objects),
   * in which case returning it directly suffices.
   */
  function getActionModeSlotObjectState(obj: SceneObject): SceneObject {
    return sceneObjectStore.getObject(obj.id) ?? obj
  }

  function clearActionModeCaches() {
    cachedPrevContext = null
    cachedPrevContextBlockId = null
    slotStatesCache.clear()
    currentSlotStates = null
  }

  function getPrevContext(): RuntimeSceneSnapshot | null {
    if (!currentScene || !currentBlock) return null

    if (cachedPrevContext && cachedPrevContextBlockId === currentBlock.id) {
      return cachedPrevContext
    }

    cachedPrevContext = calculatePrevContext(currentScene, currentBlock.id)
    cachedPrevContextBlockId = currentBlock.id
    return cachedPrevContext
  }

  /**
   * Set Action Mode context (async version, preloads assets)
   */
  async function setActionModeContext(scene: SceneContainer, block: ScriptBlock) {
    currentScene = scene
    currentBlock = block
    // Clear state cache, forcing recalculation
    clearActionModeCaches()

    // Preload overlay assets in Action Mode
    await preloadActionModeAssets(scene, block)
  }

  /**
   * Clear Action Mode context
   */
  function clearActionModeContext() {
    currentScene = null
    currentBlock = null
    clearActionModeCaches()
    clearGhostContainers()
  }

  // ==================== Ghost Mode Functions ====================

  /**
   * Update current Slot index and recalculate Ghost state
   * @param slotIndex New Slot index
   */
  function updateSlotIndex(slotIndex: number) {
    // console.log('[Ghost Debug] updateSlotIndex called:', slotIndex)
    // console.log('[Ghost Debug] currentScene:', currentScene ? 'exists' : 'null')
    // console.log('[Ghost Debug] currentBlock:', currentBlock ? currentBlock.id : 'null')

    currentSlotIndex = slotIndex
    const cachedSlotStates = slotStatesCache.get(slotIndex)
    if (cachedSlotStates) {
      currentSlotStates = cachedSlotStates
      return
    }

    // Clear previous Ghost state cache
    currentSlotStates = null

    // If there is valid context, recalculate state
    if (currentScene && currentBlock) {
      // console.log('[Ghost Debug] Calculating slot states...')
      const prevContext = getPrevContext()
      currentSlotStates = calculateSlotStates(currentScene, currentBlock, slotIndex, prevContext ?? undefined)
      slotStatesCache.set(slotIndex, currentSlotStates)
      // console.log('[Ghost Debug] Calculated states:', currentSlotStates)
      // console.log('[Ghost Debug] Objects with ghost:',
      //   Array.from(currentSlotStates.objects.entries())
      //     .filter(([_, v]) => v.ghost !== null)
      //     .map(([k, _]) => k)
      // )
    } else {
      // console.log('[Ghost Debug] No context, skipping calculation')
    }
  }

  /**
   * Get Ghost/Real state for current Slot (write pipeline dedicated)
   * For use only by write paths such as applySlotState / applySlotStateSilently.
   * Render layer should use getGhostData() to obtain ghost-specific data.
   */
  function getGhostStates(): SlotStatesResult | null {
    return currentSlotStates
  }

  /**
   * v21: Get Ghost-specific data (for ghost rendering only)
   *
   * Extracts ghost portion from currentSlotStates without real state.
   * Render layer should use this API rather than getGhostStates()
   * to avoid accidental reads of slotStates.real causing state branching.
   */
  function getGhostData(): {
    objects: Map<string, import('@/types/sceneObject').SceneObject | null>
    camera: import('@/utils/sceneStateCalculator').RuntimeCameraState | null
  } | null {
    if (!currentSlotStates) return null
    const ghostObjects = new Map<string, import('@/types/sceneObject').SceneObject | null>()
    for (const [id, result] of currentSlotStates.objects) {
      ghostObjects.set(id, result.ghost)
    }
    return {
      objects: ghostObjects,
      camera: currentSlotStates.camera.ghost,
    }
  }

  /**
   * Get current Slot index
   */
  function getCurrentSlotIndex(): number {
    return currentSlotIndex
  }

  // ==================== v8.6: P0 Unified State Management ====================

  /**
   * Set current Block's Slots
   * @param slots RuntimeSlot array
   */
  function setSlots(slots: RuntimeSlot[]): void {
    currentSlots = slots
  }

  /**
   * Get current Block's Slots
   */
  function getSlots(): RuntimeSlot[] {
    return currentSlots
  }

  /**
   * Get current Block's Actions
   * Single source of truth: reads from currentBlock without keeping a copy
   */
  function getCurrentActions(): import('@/types/screenplay').Action[] {
    return [...(currentBlock?.actions ?? [])]
  }

  /**
   * Get current Block
   */
  function getCurrentBlock(): ScriptBlock | null {
    return currentBlock
  }

  /**
   * Get current Scene
   */
  function getCurrentScene(): SceneContainer | null {
    return currentScene
  }

  /**
   * Create Ghost container (translucent)
   * @param originalContainer Original object container
   * @param objectId Object ID
   */
  function createGhostContainer(originalContainer: PIXI.Container, objectId: string): PIXI.Container {
    // Check if already in cache
    const existingGhost = ghostContainerCache.get(objectId)
    if (existingGhost) {
      return existingGhost
    }

    // Create Ghost container
    const ghostContainer = new PIXI.Container()
    ghostContainer.name = `ghost_${objectId}`
    ghostContainer.alpha = 0.4

    // Guard: check if originalContainer is destroyed (position is null)
    if (!originalContainer.position) {
      ghostContainerCache.set(objectId, ghostContainer)
      return ghostContainer
    }

    // Copy position and transform
    ghostContainer.position.copyFrom(originalContainer.position)
    ghostContainer.scale.copyFrom(originalContainer.scale)
    ghostContainer.rotation = originalContainer.rotation
    ghostContainer.pivot.copyFrom(originalContainer.pivot)

    // Deep clone child elements
    cloneChildrenRecursive(originalContainer, ghostContainer)

    // Ghost does not use grayscale filter, only translucent effect

    // Mark non-interactive
    ghostContainer.eventMode = 'none'
    ghostContainer.interactiveChildren = false

    // Set Ghost zIndex
    ghostContainer.zIndex = Z_INDEX_GHOST

    // console.log('[Ghost Debug] Created ghost with', ghostContainer.children.length, 'children')

    ghostContainerCache.set(objectId, ghostContainer)
    return ghostContainer
  }

  /**
   * Recursively clone child elements of a container
   */
  function cloneChildrenRecursive(source: PIXI.Container, target: PIXI.Container) {
    for (const child of source.children) {
      let clonedChild: PIXI.DisplayObject | null = null

      if (child instanceof PIXI.Sprite) {
        // Clone Sprite
        const sprite = new PIXI.Sprite(child.texture)
        sprite.position.copyFrom(child.position)
        sprite.scale.copyFrom(child.scale)
        sprite.rotation = child.rotation
        sprite.anchor.copyFrom(child.anchor)
        sprite.alpha = child.alpha
        sprite.visible = child.visible
        sprite.pivot.copyFrom(child.pivot)
        clonedChild = sprite
      } else if (child instanceof PIXI.Graphics) {
        // Clone Graphics (simplified: copy geometry only)
        const graphics = child.clone()
        clonedChild = graphics
      } else if (child instanceof PIXI.Container) {
        // Recursively clone container
        const container = new PIXI.Container()
        container.position.copyFrom(child.position)
        container.scale.copyFrom(child.scale)
        container.rotation = child.rotation
        container.alpha = child.alpha
        container.visible = child.visible
        container.pivot.copyFrom(child.pivot)
        cloneChildrenRecursive(child as PIXI.Container, container)
        clonedChild = container
      }

      if (clonedChild) {
        clonedChild.name = child.name
        target.addChild(clonedChild)
      }
    }
  }

  /**
   * Create Ghost camera container
   * v8.3: Renders with solid line, thickness matching actual camera
   * @param cameraState Camera state
   * @param baseWidth Base width
   * @param baseHeight Base height
   */
  function createGhostCameraContainer(cameraState: RuntimeCameraState, baseWidth: number, baseHeight: number): PIXI.Container {
    if (ghostCameraContainer) {
      // Update position
      const graphics = ghostCameraContainer.getChildByName('ghost_camera_border') as unknown as PIXI.Graphics
      if (graphics) {
        graphics.clear()
        const scaledWidth = baseWidth / cameraState.zoom
        const scaledHeight = baseHeight / cameraState.zoom

        // v8.3: Draw solid line with line width matching actual camera (20)
        graphics.lineStyle(20, 0x888888, 0.6)
        graphics.drawRect(0, 0, scaledWidth, scaledHeight)

        ghostCameraContainer.position.set(
          cameraState.x - scaledWidth / 2,
          cameraState.y - scaledHeight / 2
        )
      }
      return ghostCameraContainer
    }

    const container = new PIXI.Container()
    container.name = 'ghost_camera_container'

    const scaledWidth = baseWidth / cameraState.zoom
    const scaledHeight = baseHeight / cameraState.zoom

    const graphics = new PIXI.Graphics()
    graphics.name = 'ghost_camera_border'
    // v8.3: Draw solid line with line width matching actual camera (20)
    graphics.lineStyle(20, 0x888888, 0.6)
    graphics.drawRect(0, 0, scaledWidth, scaledHeight)

    container.addChild(graphics)
    container.position.set(
      cameraState.x - scaledWidth / 2,
      cameraState.y - scaledHeight / 2
    )
    container.alpha = 0.6
    container.eventMode = 'none'

    ghostCameraContainer = container
    return container
  }


  /**
   * Clear all Ghost containers
   */
  function clearGhostContainers() {
    for (const [_id, container] of ghostContainerCache) {
      if (container.parent) {
        container.parent.removeChild(container)
      }
      container.destroy({ children: true })
    }
    ghostContainerCache.clear()

    if (ghostCameraContainer) {
      if (ghostCameraContainer.parent) {
        ghostCameraContainer.parent.removeChild(ghostCameraContainer)
      }
      ghostCameraContainer.destroy({ children: true })
      ghostCameraContainer = null
    }
  }

  /**
   * Get Ghost container cache
   */
  function getGhostContainer(objectId: string): PIXI.Container | undefined {
    return ghostContainerCache.get(objectId)
  }

  /**
   * Get Ghost camera container
   */
  function getGhostCameraContainer(): PIXI.Container | null {
    return ghostCameraContainer
  }

  /**
   * Preload overlay assets for set_character action in Action Mode
   * Resolves the issue where overlay assets did not render when first entering Action Mode
   */
  async function preloadActionModeAssets(scene: SceneContainer, block: ScriptBlock) {
    const { collectEditorFirstPaintAssets, loadAssets } = useAssetLoader()
    // v8.2: Pass prevContext to correctly preload expressions in set_character action
    // Otherwise collectAssets cannot find character info via action.target
    const prevContext = getPrevContext()
    if (!prevContext) {
      return
    }
    const { imageUrls, audioUrls } = collectEditorFirstPaintAssets(prevContext, block)
    const fontPreloadObjects = collectSceneFontPreloadObjects(prevContext.objects, [block])
    const preloadTasks: Promise<unknown>[] = [
      preloadSceneFonts(fontPreloadObjects),
    ]

    if (imageUrls.size > 0 || audioUrls.size > 0) {
      preloadTasks.push(loadAssets(imageUrls, audioUrls, `SceneGraph.preloadActionModeAssets(${scene.id}/${block.id})`))
    }

    await Promise.all(preloadTasks)
  }


  /**
   * Create object container
   * P1: Dispatched via ContainerFactory registry instead of switch(obj.type)
   */
  async function createObjectContainer(obj: SceneObject): Promise<PIXI.Container | null> {
    const factory = getContainerFactory(obj.type)
    let container: PIXI.Container | null = null

    if (factory) {
      container = await factory(obj)
    } else {
      console.warn('[SceneGraph] Unregistered object type:', obj.type)
    }

    if (container) {
      const latestObj = sceneObjectStore.getObject(obj.id) ?? obj
      if (latestObj.type === 'light') {
        sceneObjectRenderer.applyObjectState(container, latestObj, latestObj, noOpObjectStateHost)
      } else {
        applyTransform(container, latestObj)
      }
      
      const isSpawned = (latestObj as unknown as { spawned?: boolean }).spawned !== false
      if (isSpawned) {
        // Check pass-through list
        const ptEntry = passThroughMap.get(latestObj.id)
        if (ptEntry) {
          container.visible = ptEntry.visible
          container.eventMode = 'none'
          container.interactiveChildren = false
        } else {
          container.visible = latestObj.visible
          // Restore normal interactive state (in case removed from pass-through list)
          container.eventMode = 'static'
          container.interactiveChildren = true
        }
      }

      addPixiDebugInfo(container, latestObj)

      // v20: composite object creates GenericAnimationPlayer (delegation pattern)
      // With union child objects inside container, getLocalBounds() works naturally without boundsProvider
      if (latestObj.type === 'composite') {
        const player = createGenericAnimationPlayer({
          target: container,
          ownerObjectId: latestObj.id,
          playerResolver: (targetId: string) => {
            return genericAnimationPlayerCache.get(targetId) ?? null
          },
        })
        player.cacheBaseTransform()
        genericAnimationPlayerCache.set(latestObj.id, player)
      } else if (latestObj.type === 'symbol' || latestObj.type === 'expression') {
        // v18: symbol/expression objects also need GenericAnimationPlayer
        // Supports standalone animations and targetObjectId dispatch when acting as composite descendants
        const player = createGenericAnimationPlayer({
          target: container,
          ownerObjectId: latestObj.id,
        })
        player.cacheBaseTransform()
        genericAnimationPlayerCache.set(latestObj.id, player)
      }
    }
    return container
  }

  /**
   * Phase 3: Create screen effect container - delegated to SOR entrypoint
   */
  function createScreenEffectContainer(obj: ScreenEffectObject): PIXI.Container {
    const { container } = sceneObjectRenderer.createScreenEffectContainer(
      `screen_effect_container_${obj.id}`,
      obj.params,
      obj.width,
      obj.height,
      obj.zIndex ?? 1000
    )
    return container
  }

  /**
   * Phase 1: Draw screen effect graphics - extracted to @/utils/screenEffectRenderer.ts
   * createScreenEffectContainer / updateScreenEffectByState directly use drawScreenEffectGraphics imported above
   */

  /**
   * Create background container
   */
  async function createBackgroundContainer(obj: BackgroundObject): Promise<PIXI.Container> {
    const container = new PIXI.Container()
    const canvasWidth = CANVAS_WIDTH
    const canvasHeight = CANVAS_HEIGHT

    const shouldAutoSize = obj.width <= 0 || obj.height <= 0
    const shouldAutoPosition = (obj.x === 0 && obj.y === 0) ||
      (obj.x === CANVAS_CENTER_X && obj.y === CANVAS_CENTER_Y)
    const shouldDefaultFullCanvas =
      obj.width === canvasWidth &&
      obj.height === canvasHeight &&
      shouldAutoPosition &&
      obj.scaleX === 1 &&
      obj.scaleY === 1 &&
      obj.rotation === 0
    const shouldAutoLayout = shouldAutoSize || shouldDefaultFullCanvas

    const backgroundData = backgroundStore.getBackground(obj.refId)
    if (!backgroundData) {
      console.warn('[SceneGraph] Background not found:', obj.refId)
      return container
    }

    // 1. Animated background
    if (backgroundData.type === 'animation') {
      const frames = backgroundData.frames ?? []

      if (frames.length > 0) {
        const frameUrls = collectAnimatedFirstPaintUrls({
          url: backgroundData.url,
          backgroundImage: backgroundData.backgroundImage,
          stillFrameCustomUrl: backgroundData.stillFrameCustomUrl,
          frames
        })
        const urlsToLoad = new Set(frameUrls)

        if (urlsToLoad.size > 0) {
          const { loadAssets, getTexture } = useAssetLoader()
          await loadAssets(urlsToLoad, new Set(), `SceneGraph.background.create(${obj.id})`)

          // Create texture array
          const textures = frameUrls.map(url => getTexture(url))

          // Wait for first frame to load to obtain dimensions
          const firstTexture = textures[0]
          if (firstTexture && !firstTexture.valid) {
            await new Promise<void>(resolve => {
              firstTexture.baseTexture.once('loaded', () => resolve())
            })
          }

          const animatedSprite = new PIXI.AnimatedSprite(textures)
          animatedSprite.name = 'background_animation'
          animatedSprite.anchor.set(0) // Backgrounds typically use (0, 0) anchor
          animatedSprite.animationSpeed = (backgroundData.fps ?? 25) / 60
          animatedSprite.loop = backgroundData.loop ?? true

          const validTx = textures.find(t => t?.valid)
          if (validTx) {
            if (shouldAutoLayout) {
              // Only scale to canvas height if original image height >= canvas height
              // Backgrounds smaller than canvas height retain original dimensions to avoid blurriness
              const needsScale = validTx.height >= canvasHeight
              const scale = needsScale ? canvasHeight / validTx.height : 1
              const scaledWidth = validTx.width * scale
              const scaledHeight = validTx.height * scale
              const updates: Record<string, number> = {
                width: scaledWidth,
                height: scaledHeight
              }
              if (shouldAutoPosition) {
                // x, y are center point coordinates (pivot in applyTransform is set to geometric center)
                updates['x'] = CANVAS_CENTER_X
                updates['y'] = CANVAS_CENTER_Y
              }
              // v24: updateSetupObject writes both setupState + runtimeState + episode
              sceneObjectStore.updateSetupObject(obj.id, updates as Partial<SceneObject>)

              animatedSprite.width = scaledWidth
              animatedSprite.height = scaledHeight
            } else if (obj.width > 0 && obj.height > 0) {
              animatedSprite.width = obj.width
              animatedSprite.height = obj.height
            }
          }

          // v11.1: Default stop at frame 0
          animatedSprite.gotoAndStop(0)

          container.addChild(animatedSprite)
        }
      }
    }

    // 2. Static background (or fallback when animated background fails/has no frames, or regular static background)
    // Executed only when container has no children (i.e. animation creation above didn't succeed)
    if (container.children.length === 0) {
      if (backgroundData.url) {
        // Refactored to use useAssetLoader
        const { loadAssets, getTexture } = useAssetLoader()
        await loadAssets(new Set([backgroundData.url]), new Set(), `SceneGraph.background.fallback(${obj.id})`)

        // getTexture handles blob URLs internally if loaded via loadAssets
        const texture = getTexture(backgroundData.url)
        if (texture && texture !== PIXI.Texture.EMPTY) {
          const sprite = new PIXI.Sprite(texture)
          sprite.name = 'background_sprite'
          sprite.anchor.set(0)

          // Update dimensions logic
          // v7.21: Auto-calculate center position only on first creation (when width and height are 0)
          // If user dragged the background already and changed position, preserve user's position
          if (texture.valid) {
            // Only scale to canvas height if original image height >= canvas height
            // Backgrounds smaller than canvas height retain original dimensions to avoid blurriness in video export
            const needsScale = texture.height >= canvasHeight
            const scale = needsScale ? canvasHeight / texture.height : 1
            const scaledWidth = texture.width * scale
            const scaledHeight = texture.height * scale

            if (shouldAutoLayout) {
              const updates: Record<string, number> = {
                width: scaledWidth,
                height: scaledHeight
              }
              if (shouldAutoPosition) {
                // x, y are center point coordinates (pivot in applyTransform is set to geometric center)
                updates['x'] = CANVAS_CENTER_X
                updates['y'] = CANVAS_CENTER_Y
              }
              // v24: updateSetupObject writes both setupState + runtimeState + episode
              sceneObjectStore.updateSetupObject(obj.id, updates as Partial<SceneObject>)

              // Force sprite size to match desired visual size
              // This is critical because container.scale is usually 1
              sprite.width = scaledWidth
              sprite.height = scaledHeight
            } else {
              if (obj.width > 0 && obj.height > 0) {
                sprite.width = obj.width
                sprite.height = obj.height
              } else {
                sprite.width = scaledWidth
                sprite.height = scaledHeight
              }
            }
          }

          container.addChild(sprite)
        }
      }


      if (container.children.length === 0) {
        if (!backgroundData.url) {
          console.warn('[SceneGraph] Background has no URL, using placeholder:', backgroundData)
        } else {
          console.warn('[SceneGraph] Background image load failed, using placeholder:', backgroundData.url)
        }

        // Create placeholder graphics to prevent object invisibility
        const graphics = new PIXI.Graphics()
        graphics.name = 'background_placeholder'
        graphics.beginFill(0x333333)
        graphics.drawRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT) // Use default canvas dimensions
        graphics.endFill()

        const text = new PIXI.Text(backgroundData.url ? 'Background Load Failed' : 'No Image', {
          fontFamily: 'Arial',
          fontSize: 48,
          fill: 0xffffff,
          align: 'center'
        })
        text.anchor.set(0.5)
        text.position.set(CANVAS_CENTER_X, CANVAS_CENTER_Y)
        graphics.addChild(text)

        container.addChild(graphics)

        // Update object dimensions to make it selectable
        sceneObjectStore.updateObject(obj.id, {
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT
        })
      }
    }

    // v11.0: Create GenericAnimationPlayer for background
    // Whether static or animation, player is created for unified control (e.g. Transform tracks)
    // and stored in genericAnimationPlayerCache for centralized management
    const player = createGenericAnimationPlayer({
      target: container,
      ownerObjectId: obj.id,
      objectType: 'background',
      objectId: obj.refId,
    })
    // Cache the base transforms that applyTransform set up (e.g. initial rotation/scale)
    player.cacheBaseTransform()

    genericAnimationPlayerCache.set(obj.id, player)

    return container
  }



  /**
   * Create camera container
   */
  function createCameraContainer(obj: CameraObject): PIXI.Container {
    const container = new PIXI.Container()
    container.name = `camera_container_${obj.id}`

    const graphics = new PIXI.Graphics()
    graphics.name = 'camera_border'
    graphics.lineStyle(20, 0x00ff00)
    graphics.beginFill(0x000000, 0.001)
    graphics.drawRect(0, 0, obj.width, obj.height)
    graphics.endFill()

    container.addChild(graphics)

    return container
  }

  /**
   * Create text container
   */
  function createTextContainer(obj: TextObject): PIXI.Container {
    const container = new PIXI.Container()
    const normalizedContent = normalizeTextContent(obj.content)
    const effectiveWordWrap = obj.wordWrap ?? true
    const boxMode = obj.textBoxMode ?? 'auto-size'
    const lineHeightInfo = resolveTextLineHeight(obj.fontFamily, obj.fontSize, obj.lineHeight)
    const gradient = obj.fillType === 'linear_gradient'
      ? resolveTextGradient(obj.gradientStops, obj.gradientAngle)
      : null
    const fillValue = gradient ? gradient.colors : (obj.color ?? '#ffffff')

    const styleOpts: Partial<PIXI.ITextStyle> = {
      fontFamily: obj.fontFamily,
      fontSize: obj.fontSize,
      fill: fillValue,
      align: obj.align,
      // Force break words to prevent extra-wide tokens (especially CJK/space-free strings) causing unexpected line breaks looking like empty lines
      breakWords: true,
      // Preserve newlines but collapse redundant whitespace to avoid trailing spaces taking up an entire line
      whiteSpace: 'pre-line',
      fontWeight: obj.fontWeight ?? 'normal',
      fontStyle: obj.fontStyle ?? 'normal',
      // Phase 1: Stroke
      strokeThickness: obj.strokeThickness ?? 0,
      // Phase 1: Drop shadow
      dropShadow: obj.dropShadow ?? false,
      dropShadowColor: obj.dropShadowColor ?? '#000000',
      dropShadowBlur: obj.dropShadowBlur ?? 4,
      dropShadowAngle: obj.dropShadowAngle ?? Math.PI / 4,
      dropShadowDistance: obj.dropShadowDistance ?? 4,
      // Phase 1: Letter spacing
      letterSpacing: obj.letterSpacing ?? 0,
    }
    if (boxMode === 'auto-width' || boxMode === 'auto-size') {
      styleOpts.wordWrap = false
    } else {
      const wrapWidth = boxMode === 'fixed'
        ? Math.max(50, obj.width ?? 400)
        : Math.max(50, obj.wordWrapWidth ?? 400)
      styleOpts.wordWrap = effectiveWordWrap
      styleOpts.wordWrapWidth = wrapWidth
    }
    if (gradient) {
      styleOpts.fillGradientType = gradient.gradientType
      styleOpts.fillGradientStops = gradient.gradientStops
    }
    if (obj.stroke) styleOpts.stroke = obj.stroke
    // Always set lineHeight: auto and explicit are unified via resolveTextLineHeight
    styleOpts.lineHeight = lineHeightInfo.lineHeight
    styleOpts.leading = getAutoTextLeading(
      obj.fontFamily,
      obj.fontSize,
      lineHeightInfo.source === 'explicit' ? lineHeightInfo.lineHeight : undefined,
    )
    const text = new PIXI.Text(normalizedContent, styleOpts)
    text.name = 'text_content'
    text.anchor.set(0.5)
    container.addChild(text)
    syncTextBackground(container, obj, text, boxMode)
    const existingMask = container.getChildByName('text_box_mask') as PIXI.Graphics | undefined
    if (boxMode === 'fixed' && obj.width > 0 && obj.height > 0) {
      const mask = existingMask ?? new PIXI.Graphics()
      if (!existingMask) {
        mask.name = 'text_box_mask'
      }
      mask.clear()
      mask.beginFill(0xffffff)
      mask.drawRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height)
      mask.endFill()
      if (!existingMask) container.addChild(mask)
      container.mask = mask
    } else if (existingMask) {
      container.mask = null
      container.removeChild(existingMask)
    }
    return container
  }

  function syncTextBackground(
    container: PIXI.Container,
    textObj: TextObject,
    contentNode: PIXI.Container | PIXI.Text | undefined,
    boxMode: 'auto-width' | 'auto-height' | 'auto-size' | 'fixed',
  ) {
    const enabled = textObj.textBackgroundEnabled === true
    const existing = container.getChildByName('text_background_fill') as PIXI.Graphics | undefined
    if (!enabled) {
      if (existing) {
        container.removeChild(existing)
        existing.destroy()
      }
      return
    }

    const bg = existing ?? new PIXI.Graphics()
    if (!existing) bg.name = 'text_background_fill'
    bg.clear()

    const colorHex = (textObj.textBackgroundColor ?? '#000000').replace('#', '')
    const colorNum = Number.parseInt(colorHex, 16)
    const alpha = Math.max(0, Math.min(1, textObj.textBackgroundAlpha ?? 0.35))
    const padX = Math.max(0, textObj.textBackgroundPaddingX ?? 16)
    const padY = Math.max(0, textObj.textBackgroundPaddingY ?? 10)
    const radius = Math.max(0, textObj.textBackgroundRadius ?? 8)

    let width = 0
    let height = 0
    let cx = 0
    let cy = 0
    if (boxMode === 'fixed' && textObj.width > 0 && textObj.height > 0) {
      width = textObj.width
      height = textObj.height
    } else {
      const bounds = (contentNode ?? container).getLocalBounds()
      width = bounds.width + padX * 2
      height = bounds.height + padY * 2
      cx = bounds.x + bounds.width / 2
      cy = bounds.y + bounds.height / 2
    }

    if (width <= 0 || height <= 0) {
      if (existing) {
        container.removeChild(existing)
        existing.destroy()
      }
      return
    }

    bg.beginFill(Number.isNaN(colorNum) ? 0x000000 : colorNum, alpha)
    bg.drawRoundedRect(cx - width / 2, cy - height / 2, width, height, radius)
    bg.endFill()
    if (!existing) container.addChildAt(bg, 0)
  }



  /**
   * Create prop container
   * v14.x: Core sprite creation delegated to SceneObjectRenderer, keeping editor-specific preloading and size tracking
   */
  async function createPropContainer(obj: PropObject): Promise<PIXI.Container> {
    const propData = propStore.getProp(obj.refId)

    if (!propData) {
      console.warn('[SceneGraph] Prop not found:', obj.refId)
      return new PIXI.Container()
    }

    // Editor-specific: asynchronously preload assets first
    const { loadAssets } = useAssetLoader()
    if (propData.type === 'static' && propData.url) {
      await loadAssets(new Set([propData.url]), new Set(), `SceneGraph.prop.createStatic(${obj.id})`)
    } else if (propData.type === 'animation' && propData.frames && propData.frames.length > 0) {
      const urlsToLoad = new Set(collectAnimatedFirstPaintUrls({
        url: propData.url,
        stillFrameCustomUrl: propData.stillFrameCustomUrl,
        frames: propData.frames
      }))
      if (urlsToLoad.size > 0) {
        await loadAssets(urlsToLoad, new Set(), `SceneGraph.prop.createAnimation(${obj.id})`)
      }
    }

    // v14.x: Delegate to unified renderer to create container
    const container = createEditorPropContainer(obj)

    // Props in editing mode creation phase do not write back store dimensions, avoiding deep watch triggering first-paint render jitter.
    const measureStart = performance.now()

    // v11.0: Create GenericAnimationPlayer for all props (if needed)
    // Only animation-type props truly need it, or static types that might be controlled by subsequent animations
    // For consistency, we attempt creating player for all prop containers
    void measureStart
    const player = createGenericAnimationPlayer({
      target: container,
      ownerObjectId: obj.id,
      objectType: 'prop',
      objectId: (obj).refId,
    })
    player.cacheBaseTransform()
    genericAnimationPlayerCache.set(obj.id, player)

    return container
  }

  // v7.3: createEffectContainer removed, effects merged into props

  /**
   * Update object container
   */
  async function updateObjectContainer(container: PIXI.Container, obj: SceneObject): Promise<void> {
    if (obj.type === 'light') {
      const latestObj = sceneObjectStore.getObject(obj.id) ?? obj
      sceneObjectRenderer.applyObjectState(container, latestObj, latestObj, noOpObjectStateHost)

      const isSpawned = (latestObj as unknown as { spawned?: boolean }).spawned !== false
      if (isSpawned) {
        const ptEntry = passThroughMap.get(latestObj.id)
        if (ptEntry) {
          container.visible = ptEntry.visible
          container.eventMode = 'none'
          container.interactiveChildren = false
        } else {
          container.visible = latestObj.visible
          container.eventMode = 'static'
          container.interactiveChildren = true
          container.hitArea = new PIXI.Rectangle(-96, -96, 192, 192)
        }
      }

      updatePixiDebugInfo(container, {
        position: { x: latestObj.x, y: latestObj.y },
        size: { width: latestObj.width, height: latestObj.height },
        transform: {
          scaleX: latestObj.scaleX,
          scaleY: latestObj.scaleY,
          rotation: latestObj.rotation,
          alpha: latestObj.alpha,
          flipX: latestObj.flipX
        }
      })
      return
    }

    let transformApplied = true

    if (obj.type === 'prop') {
      // v11.0: Prop animation state migrated to AnimationPlayer system
      transformApplied = applyTransform(container, obj)
      // v7.3: effect type removed
    } else {
      applyTransform(container, obj)
    }

    // v19 Fix: visible setting and union proxy propagation must immediately follow applyTransform,
    // executing synchronously before any await.
    // updateObjectContainer is an async function called concurrently via fire-and-forget void.
    // If ProxyChain executed after await, the second watcher round's applyTransform would reset position,
    // causing the first round's ProxyChain to execute again on an already transformed position -> double transformation.
    if (transformApplied) {
      const isSpawned = (obj as unknown as { spawned?: boolean }).spawned !== false
      if (isSpawned) {
        // Check pass-through list: replaces legacy cameraEditorVisible logic
        const ptEntry = passThroughMap.get(obj.id)
        if (ptEntry) {
          container.visible = ptEntry.visible
          container.eventMode = 'none'
          container.interactiveChildren = false
        } else {
          container.visible = obj.visible
          // Restore normal interactive state (in case removed from pass-through list)
          container.eventMode = 'static'
          container.interactiveChildren = true
        }
      }
    }

    // v20: union child objects inside container (real PIXI parent-child), transforms propagate automatically, no applyUnionProxyChain needed

    // Type-specific updates (may contain await, must follow proxy propagation)
    if (obj.type !== 'prop') {
      if (obj.type === 'background') {
        const sprite = container.getChildByName('background_sprite') as PIXI.Sprite | undefined
        if (sprite?.texture.valid) {
          sprite.width = obj.width
          sprite.height = obj.height
          sprite.anchor.set(0, 0)  // Background uses top-left anchor
        }
      } else if (obj.type === 'camera') {
        const graphics = container.getChildByName('camera_border') as PIXI.Graphics | undefined
        if (graphics) {
          graphics.clear()
          graphics.lineStyle(20, 0x00ff00)
          graphics.beginFill(0x000000, 0.001)
          graphics.drawRect(0, 0, obj.width, obj.height)
          graphics.endFill()
        }
      } else if (obj.type === 'screen_effect') {
        // Handler directly operates on params; state returned by applyBlockActionsToState already contains correct params
        const effectiveObj = (mode === 'action'
          ? getActionModeSlotObjectState(obj)
          : obj) as ScreenEffectObject
        const graphics = container.getChildByName('screen_effect_graphics') as PIXI.Graphics | undefined
        if (graphics) {
          drawScreenEffectGraphics(graphics, effectiveObj.params, effectiveObj.width, effectiveObj.height, container)
        }
      } else if (obj.type === 'symbol') {
        // v16: When currentMaterialId changes, preload textures and rebuild sprite inside container
        const symbolObj = obj as SymbolObject
        const currentRenderedId =
          (container as unknown as Record<string, string>)['_renderedMaterialId']
          ?? (container as unknown as Record<string, string>)['_symbolMaterialId']
        const targetId = symbolObj.currentMaterialId ?? symbolObj.materials?.[0]?.id
        if (currentRenderedId !== targetId) {
          // Preload target material textures
          const material = targetId
            ? symbolObj.materials?.find(m => m.id === targetId)
            : symbolObj.materials?.[0]
          if (material) {
            await preloadEditorSymbolMaterialTextures(material)
          }
          // Clear old children
          container.removeChildren()
          // Rebuild via renderer
          const newContainer = createEditorSymbolContainer(obj)
          // Move children from new container to existing one
          while (newContainer.children.length > 0) {
            container.addChild(newContainer.children[0]!)
          }
          // Track which material is rendered
          ; (container as unknown as Record<string, string>)['_renderedMaterialId'] = targetId ?? ''
          ; (container as unknown as Record<string, string>)['_symbolMaterialId'] = targetId ?? ''
        }
      } else if (obj.type === 'expression') {
        // v18: When refId changes, preload textures and rebuild sprite inside container
        const currentRenderedRefId = (container as unknown as Record<string, string>)['_renderedRefId']
        if (currentRenderedRefId !== obj.refId) {
          // Preload target expression textures
          const expressionStore = useExpressionStore()
          const expr = expressionStore.getExpression(obj.refId)
          if (expr) {
            const urls = new Set<string>()
            if (expr.defaultFrame?.url) urls.add(expr.defaultFrame.url)
            expr.speakingFrames?.forEach(frame => {
              if (frame?.url) urls.add(frame.url)
            })
            if (urls.size > 0) {
              const { loadAssets } = useAssetLoader()
              await loadAssets(urls, new Set(), `SceneGraph.expression.update(${obj.id})`)
            }
          }
          // Clear old children
          container.removeChildren()
          // Rebuild via renderer
          const newContainer = sceneObjectRenderer.createExpressionContainer(obj)
          while (newContainer.children.length > 0) {
            container.addChild(newContainer.children[0]!)
          }
          ;(container as unknown as Record<string, string>)['_renderedRefId'] = obj.refId
        }
      } else if (obj.type === 'text') {
        // Text PRD Phase 0 + Phase 1: Update text content and styles
        const textObj = obj as import('@/types/sceneObject').TextObject
        if (!(await ensureTextFontForRender(container, textObj))) return
        const normalizedContent = normalizeTextContent(textObj.content)
        const effectiveWordWrap = textObj.wordWrap ?? true
        const boxMode = textObj.textBoxMode ?? 'auto-size'
        const gradient = textObj.fillType === 'linear_gradient'
          ? resolveTextGradient(textObj.gradientStops, textObj.gradientAngle)
          : null
        const fillValue = gradient ? gradient.colors : (textObj.color ?? '#ffffff')
        const isVertical = textObj.writingMode === 'vertical'
        const hasHorizontal = container.getChildByName('text_content') !== null
        const hasVertical = container.getChildByName('text_vertical_group') !== null

        // Rebuild child structure when writingMode toggles
        if (isVertical && hasHorizontal) {
          container.removeChildren()
          const newContainer = sceneObjectRenderer.createTextContainer(obj)
          while (newContainer.children.length > 0) {
            container.addChild(newContainer.children[0]!)
          }
        } else if (!isVertical && hasVertical) {
          container.removeChildren()
          const newContainer = sceneObjectRenderer.createTextContainer(obj)
          while (newContainer.children.length > 0) {
            container.addChild(newContainer.children[0]!)
          }
        } else if (isVertical && hasVertical) {
          // Vertical text content update: rebuild
          container.removeChildren()
          const newContainer = sceneObjectRenderer.createTextContainer(obj)
          while (newContainer.children.length > 0) {
            container.addChild(newContainer.children[0]!)
          }
      } else {
          // Horizontal text update
          const textChild = container.getChildByName('text_content') as PIXI.Text | undefined
          if (textChild) {
            const lineHeightInfo = resolveTextLineHeight(textObj.fontFamily, textObj.fontSize, textObj.lineHeight)
            const styleOpts: Partial<PIXI.ITextStyle> = {
              fontFamily: textObj.fontFamily ?? 'Noto Sans SC',
              fontSize: textObj.fontSize ?? 72,
              fill: fillValue,
              align: textObj.align ?? 'center',
              breakWords: true,
              whiteSpace: 'pre-line',
              fontWeight: textObj.fontWeight ?? 'normal',
              fontStyle: textObj.fontStyle ?? 'normal',
              strokeThickness: textObj.strokeThickness ?? 0,
              dropShadow: textObj.dropShadow ?? false,
              dropShadowColor: textObj.dropShadowColor ?? '#000000',
              dropShadowBlur: textObj.dropShadowBlur ?? 4,
              dropShadowAngle: textObj.dropShadowAngle ?? Math.PI / 4,
              dropShadowDistance: textObj.dropShadowDistance ?? 4,
              letterSpacing: textObj.letterSpacing ?? 0,
              lineHeight: lineHeightInfo.lineHeight,
              leading: getAutoTextLeading(
                textObj.fontFamily,
                textObj.fontSize,
                lineHeightInfo.source === 'explicit' ? lineHeightInfo.lineHeight : undefined,
              ),
            }
            if (boxMode === 'auto-width' || boxMode === 'auto-size') {
              styleOpts.wordWrap = false
            } else {
              const wrapWidth = boxMode === 'fixed'
                ? Math.max(50, textObj.width ?? 400)
                : Math.max(50, textObj.wordWrapWidth ?? 400)
              styleOpts.wordWrap = effectiveWordWrap
              styleOpts.wordWrapWidth = wrapWidth
            }
            if (gradient) {
              styleOpts.fillGradientType = gradient.gradientType
              styleOpts.fillGradientStops = gradient.gradientStops
            }
            if (textObj.stroke) styleOpts.stroke = textObj.stroke
            const rebuiltText = new PIXI.Text(normalizedContent, new PIXI.TextStyle(styleOpts))
            rebuiltText.name = 'text_content'
            rebuiltText.anchor.set(0.5)
            container.removeChild(textChild)
            textChild.destroy()
            container.addChild(rebuiltText)
            syncTextBackground(container, textObj, rebuiltText, boxMode)
          }
        }
        if (isVertical) {
          const verticalGroup = container.getChildByName('text_vertical_group') as PIXI.Container | undefined
          syncTextBackground(container, textObj, verticalGroup, boxMode)
        }
        const existingMask = container.getChildByName('text_box_mask') as PIXI.Graphics | undefined
        if (boxMode === 'fixed' && obj.width > 0 && obj.height > 0) {
          const mask = existingMask ?? new PIXI.Graphics()
          if (!existingMask) {
            mask.name = 'text_box_mask'
          }
          mask.clear()
          mask.beginFill(0xffffff)
          mask.drawRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height)
          mask.endFill()
          if (!existingMask) container.addChild(mask)
          container.mask = mask
        } else if (existingMask) {
          container.mask = null
          container.removeChild(existingMask)
        }
      }
    }

    updatePixiDebugInfo(container, {
      position: { x: obj.x, y: obj.y },
      size: { width: obj.width, height: obj.height },
      transform: {
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
        rotation: obj.rotation,
        alpha: obj.alpha,
        flipX: obj.flipX
      }
    })
  }

  /**
   * Apply transforms
   */
  function applyTransform(container: PIXI.Container, obj: SceneObject): boolean {
    // In Action Mode use object state evaluated for current Slot
    const finalObj = mode === 'action' ? getActionModeSlotObjectState(obj) : obj

    // v9.3: In Setup Mode check spawned state
    // Objects with spawned=false (dynamic objects) should not render in Setup mode
    if (mode === 'setup' && obj.type !== 'camera') {
      const setupSpawned = (obj as unknown as { spawned?: boolean }).spawned
      if (setupSpawned === false) {
        container.visible = false
        container.eventMode = 'none'
        container.interactiveChildren = false
        return true
      }
    }

    // v9.2: Check if object has despawned in current Slot
    // Camera and non-Action Mode do not check
    if (mode === 'action' && obj.type !== 'camera') {
      // v12.7: Use obj (from sceneObjectStore.objects = runtimeState.objects) spawned property.
      // This property is precisely cascaded and computed per current Slot by calculateSlotStates + applySlotState.
      // Note: do not use finalObj.spawned, to avoid carrying lifecycle results outside the current slot into display logic
      // (including autoDespawnOnBlockEnd), which could prematurely hide objects that are still alive in the current Slot.
      const isAlive = obj.spawned !== false
      if (!isAlive) {
        container.visible = false
        container.eventMode = 'none'
        container.interactiveChildren = false
        return true
      } else {
        // Pass-through list priority: pass-through objects remain visible but non-interactive
        const ptEntry = passThroughMap.get(obj.id)
        if (ptEntry) {
          container.visible = ptEntry.visible
          container.eventMode = 'none'
          container.interactiveChildren = false
        } else {
          container.visible = true
          container.eventMode = 'static'
          container.interactiveChildren = true
        }
      }
    }

    let pivotX = 0
    let pivotY = 0

    // v7.13 Fix: Get local bounds for subsequent Pivot and Offset calculation
    // Lifted to function top level to prevent ReferenceError
    const localBounds = container.getLocalBounds()

    // v7.13: Unified anchor/Pivot definition
    // Rule: All objects uniformly use Top-Left as coordinate origin.
    // Exception: Camera object uses Center.
    // 
    // PIXI's pivot property defines object's rotation and scale center, while also affecting meaning of position.
    // If pivot=(0,0) (Top-Left), container.position sets the object's top-left corner.
    // If pivot=(w/2, h/2) (Center), container.position sets the object's center point.

    if (finalObj.type === 'camera') {
      // Camera: Pivot = Center
      pivotX = finalObj.width / 2
      pivotY = finalObj.height / 2
    } else if (finalObj.type === 'screen_effect') {
      // Screen Effect: Graphics draws centered on origin drawRect(-halfW, -halfH, w, h)
      // Pivot fixed to (0, 0) to avoid feathered Sprite changing localBounds and causing size drift
      pivotX = 0
      pivotY = 0
    } else if (finalObj.type === 'composite') {
      // Composite is a pure transform container, pivot is always (0, 0)
      // union PIXI container is empty proxy, pivot/position doesn't affect child rendering
      // Child flipX flipping base point correction is handled in applyUnionProxyChain
      pivotX = 0
      pivotY = 0
    } else if (finalObj.type === 'mask') {
      // Mask container has no visible children; clipping geometry and bounding boxes are centered on local (0, 0).
      // Cannot fall into width/height fallback below, otherwise pivot becomes bottom-right.
      pivotX = 0
      pivotY = 0
    } else {
      // General (Background, Prop, Text, BGM): use localBounds to compute geometric center
      if (localBounds.width > 0 && localBounds.height > 0) {
        pivotX = localBounds.x + localBounds.width / 2
        pivotY = localBounds.y + localBounds.height / 2
      } else {
        // Fallback: If no Bounds, guess based on object type
        if (finalObj.type === 'prop') {
          // Center-aligned object
          pivotX = 0
          pivotY = 0
        } else {
          // Top-left aligned object (Background, Text)
          pivotX = finalObj.width / 2
          pivotY = finalObj.height / 2
        }
      }
    }

    container.pivot.set(pivotX, pivotY)

    // Transform Origin compensation (pixel offset scheme)
    // transformOriginX/Y is pixel offset relative to PivotBase, default 0 = rotate around PivotBase
    // Unified formula applies to all object types (including composite) without bounds computation
    const originX = finalObj.transformOriginX ?? 0
    const originY = finalObj.transformOriginY ?? 0
    let posCompX = 0
    let posCompY = 0

    if (originX !== 0 || originY !== 0) {
      container.pivot.set(pivotX + originX, pivotY + originY)

      if (finalObj.type === 'composite') {
        // v21: Simple offset compensation (consistent with non-composite)
        // position does not change with rotation -> pivot fixed in world -> rotate/scale around pivot
        posCompX = finalObj.flipX ? -originX : originX
        posCompY = originY
      } else {
        // Non-composite types (prop/bg/text etc.): uses bounds center pivot,
        // compensation only needs originX/Y delta (bounds center handled by coordinate model)
        posCompX = finalObj.flipX ? -originX : originX
        posCompY = originY
      }
    }

    // Scale settings
    {
      // General scale handling (Background, Prop, etc)
      const scaleX = finalObj.scaleX * (finalObj.flipX ? -1 : 1)
      const scaleY = finalObj.scaleY
      container.scale.set(scaleX, scaleY)
    }

    // v2.0.0: Coordinate settings (unified center coordinates + Transform Origin compensation)
    // obj.x/y of all objects are center coordinates, pivot also in center, plus transform origin compensation
    const finalPosX = Math.round(finalObj.x + posCompX)
    const finalPosY = Math.round(finalObj.y + posCompY)
    container.position.set(finalPosX, finalPosY)





    // Camera does not rotate
    if (finalObj.type === 'camera') {
      container.rotation = 0
    }

    // v11.3 Fix: After applying transforms, if GenericAnimationPlayer exists, its BaseTransform must be updated
    // Prevents animation player from using outdated BaseTransform in next frame update (causing jump back to 0,0)
    // Critical for real-time dragging while playing animations in Setup mode
    const player = getGenericAnimationPlayer(obj.id)
    if (player) {
      // v19: Inject virtual bounds for composite (especially union proxy)
      // Allows GenericAnimationPlayer.applyOutputs track.pivot compensation to take effect in editor
      if (finalObj.type === 'composite') {
        const comp = finalObj as import('@/types/sceneObject').CompositeObject
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const childId of comp.childIds) {
          const cc = renderCache.get(childId)
          if (!cc || cc.destroyed) continue
          const cl = cc.getLocalBounds()
          if (cl.width <= 0 || cl.height <= 0) continue
          const corners = [
            new PIXI.Point(cl.x, cl.y),
            new PIXI.Point(cl.x + cl.width, cl.y),
            new PIXI.Point(cl.x + cl.width, cl.y + cl.height),
            new PIXI.Point(cl.x, cl.y + cl.height),
          ]
          for (const corner of corners) {
            const g = cc.toGlobal(corner)
            const l = container.toLocal(g)
            minX = Math.min(minX, l.x)
            minY = Math.min(minY, l.y)
            maxX = Math.max(maxX, l.x)
            maxY = Math.max(maxY, l.y)
          }
        }
        if (isFinite(minX)) {
          player.setObjectBounds(maxX - minX, maxY - minY, minX, minY)
        }
      }

      player.cacheBaseTransform()
    }

    // Update selection state
    // const isSelected = sceneObjectStore.selectedObjectId === obj.id
    container.rotation = finalObj.rotation

    container.alpha = finalObj.alpha

    // Set default zIndex based on object type
    let effectiveZIndex: number
    if (finalObj.type === 'background') {
      effectiveZIndex = finalObj.zIndex ?? Z_INDEX_BACKGROUND
    } else if (finalObj.type === 'camera') {
      // Camera displayed on top (10000) for easy view of camera bounds
      effectiveZIndex = Z_INDEX_CAMERA_OVERLAY
    } else {
      effectiveZIndex = finalObj.zIndex ?? Z_INDEX_DEFAULT
    }

    container.zIndex = effectiveZIndex

    // Action Mode: Handler directly operates on params; bypass cache to compute latest state
    if (mode === 'action' && finalObj.type === 'screen_effect' && currentScene && currentBlock) {
      const graphics = container.getChildByName('screen_effect_graphics') as PIXI.Graphics | undefined
      if (graphics) {
        // Calculate latest state directly (bypass cache)
        const prevCtx = calculatePrevContext(currentScene, currentBlock.id)
        const freshState = applyBlockActionsToState(prevCtx, currentBlock, currentScene)
        const freshObjState = freshState.objects.find(o => o.id === obj.id) as ScreenEffectObject | undefined
        const effectiveParams = freshObjState?.params ?? (finalObj as ScreenEffectObject).params
        drawScreenEffectGraphics(graphics, effectiveParams, finalObj.width, finalObj.height, container)
      }
    }

    return true
  }

  /**
   * Get container from cache
   */
  function getContainer(objectId: string): PIXI.Container | undefined {
    return renderCache.get(objectId)
  }

  /**
   * Set container to cache
   */
  function setContainer(objectId: string, container: PIXI.Container): void {
    renderCache.set(objectId, container)
  }

  /**
   * Remove container from cache
   */
  function removeContainer(objectId: string): void {
    const container = renderCache.get(objectId)
    if (container) {
      if (container.destroyed) {
        logPixiTree('remove_container_already_destroyed', {
          objectId,
          containerName: container.name,
          parentName: container.parent?.name ?? null,
        })
        // Container was already cascaded and destroyed by parent composite's destroy({children:true})
        // Only clean up cache, do not call destroy again
        renderCache.delete(objectId)
      } else {
        logPixiTree('remove_container_begin', {
          objectId,
          containerName: container.name,
          parentName: container.parent?.name ?? null,
          childrenCount: container.children.length,
          destroyed: container.destroyed,
        })
        if (container.parent) {
          container.parent.removeChild(container)
        }
        container.destroy({ children: true })
        logPixiTree('remove_container_done', {
          objectId,
          containerName: container.name,
          parentName: container.parent?.name ?? null,
          destroyed: container.destroyed,
        })
        renderCache.delete(objectId)
      }
    }



    // Clean up animation player
    const propPlayer = genericAnimationPlayerCache.get(objectId)
    if (propPlayer) {
      // (Optional) stop/destroy player logic if needed
      genericAnimationPlayerCache.delete(objectId)
    }
  }

  /**
   * Get all cached object IDs
   */
  function getCachedIds(): string[] {
    return Array.from(renderCache.keys())
  }



  /**
   * Get generic animation player
   */
  function getGenericAnimationPlayer(objectId: string): GenericAnimationPlayer | undefined {
    return genericAnimationPlayerCache.get(objectId)
  }

  /**
   * Get all generic animation players
   */
  function getGenericAnimationPlayers(): Map<string, GenericAnimationPlayer> {
    return genericAnimationPlayerCache
  }

  /**
   * Clear all caches
   */
  function clearAll(): void {
    renderCache.forEach((container, _id) => {
      logPixiTree('clear_all_destroy_container', {
        objectId: _id,
        containerName: container.name,
        parentName: container.parent?.name ?? null,
        childrenCount: container.children.length,
        destroyed: container.destroyed,
      })
      if (container.parent && typeof container.parent.removeChild === 'function') {
        container.parent.removeChild(container)
      }
      container.destroy({ children: true })
    })
    renderCache.clear()



    genericAnimationPlayerCache.clear()
  }

  /**
   * Rendering lock state
   */
  function getIsRendering(): boolean {
    return isRendering
  }

  function setIsRendering(value: boolean): void {
    isRendering = value
  }

  function getPendingRender(): boolean {
    return pendingRender
  }

  function setPendingRender(value: boolean): void {
    pendingRender = value
  }

  // ===== Editor-only: event pass-through list (does not affect data layer, not persisted) =====

  interface PassThroughEntry {
    visible: boolean  // true: pass-through + render  |  false: pass-through + hide
  }

  const passThroughMap = reactive(new Map<string, PassThroughEntry>())

  function addPassThrough(objectId: string, visible = true): void {
    passThroughMap.set(objectId, { visible })
  }

  function removePassThrough(objectId: string): void {
    passThroughMap.delete(objectId)
  }

  function setPassThroughVisible(objectId: string, visible: boolean): void {
    const entry = passThroughMap.get(objectId)
    if (entry) {
      entry.visible = visible
    }
  }

  function isPassThrough(objectId: string): boolean {
    return passThroughMap.has(objectId)
  }

  function getPassThroughEntry(objectId: string): PassThroughEntry | undefined {
    return passThroughMap.get(objectId)
  }

  function getPassThroughEntries(): ReadonlyMap<string, PassThroughEntry> {
    return passThroughMap
  }

  /** Initialize pass-through list defaults: automatically add camera object (visible=true) */
  function initPassThroughDefaults(): void {
    const camera = sceneObjectStore.objects.find(o => o.type === 'camera')
    if (camera && !passThroughMap.has(camera.id)) {
      passThroughMap.set(camera.id, { visible: true })
    }

    for (const obj of sceneObjectStore.objects) {
      if (isAmbientLightObject(obj)) {
        passThroughMap.set(obj.id, { visible: false })
      }
    }
  }

  return {
    // Container creation and update
    createObjectContainer,
    updateObjectContainer,
    applyTransform,

    // Cache management
    getContainer,
    setContainer,
    removeContainer,
    getCachedIds,

    getGenericAnimationPlayer,
    getGenericAnimationPlayers,
    clearAll,

    // Render lock
    getIsRendering,
    setIsRendering,
    getPendingRender,
    setPendingRender,

    // Action Mode support
    setActionModeContext,
    clearActionModeContext,
    getActionModeSlotObjectState,

    // v8.6: P0 Unified State Management
    setSlots,
    getSlots,
    getCurrentActions,
    getCurrentBlock,
    getCurrentScene,
    getActionModePrevContext: () => getPrevContext(),

    // Ghost Mode support
    updateSlotIndex,
    getCurrentSlotIndex,
    getGhostStates,
    getGhostData,
    createGhostContainer,
    createGhostCameraContainer,
    getGhostContainer,
    getGhostCameraContainer,
    clearGhostContainers,

    // v16: Symbol material preloading
    preloadSymbolMaterialTextures,
    preloadEditorSymbolMaterialTextures,

    // Editor-only: event pass-through list
    addPassThrough,
    removePassThrough,
    setPassThroughVisible,
    isPassThrough,
    getPassThroughEntry,
    getPassThroughEntries,
    initPassThroughDefaults,
  }
}
