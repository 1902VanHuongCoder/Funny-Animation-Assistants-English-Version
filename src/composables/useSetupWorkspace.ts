/**
 * useSetupWorkspace.ts
 *
 * Universal canvas workspace logic extracted from SetupEditor.vue.
 * Shared by SetupEditor (scene editing Setup mode) and SceneTemplateEditor (template editor).
 *
 * Responsibilities:
 * - Canvas render management (useSceneRenderer)
 * - Object operations (select/update/delete/duplicate/z-order)
 * - Right panel control (collapse/width resize/tab switch)
 * - Asset Picker management (7 asset addition types)
 * - Grouping mode (create/addTo)
 * - Alias management (InstanceAliasDialog)
 * - Animation triggering
 * - Fullscreen toggle
 * - Confirmation dialog / Save confirmation dialog
 * - Modification state tracking
 */

import { computed, type Ref, ref, watch } from 'vue'

import { useSceneRenderer } from '@/composables/useSceneRenderer'
import { useToast } from '@/composables/useToast'
import { CANVAS_CENTER_X, CANVAS_CENTER_Y, CANVAS_HEIGHT, CANVAS_WIDTH } from '@/constants/canvas'
import { getAnimationResourceType, getTypeIcon } from '@/core/sceneObjectProviders/metadata'
import { useAnimationStore } from '@/stores/animationStore'
import { useBackgroundStore } from '@/stores/backgroundStore'
import { useExpressionStore } from '@/stores/expressionStore'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import { useSoundStore } from '@/stores/soundStore'
import type { AnimationTimingMode } from '@/types/animation'
import type { CompositeCharacter } from '@/types/compositeCharacter'
import type { Background, PropAsset, SoundAsset } from '@/types/project'
import type { CompositeExtraInfo, CompositeObject, SceneObject, ScreenEffectPreset } from '@/types/sceneObject'
import type { SceneTemplate } from '@/types/sceneTemplate'
import { debugLog } from '@/utils/debugLogger'
import { applyMeasuredDefaultSize } from '@/utils/sceneObjectDefaultSize'
import { instantiateTemplate } from '@/utils/sceneTemplateEngine'

// ===== Type Definitions =====

/** Grouping mode state */
type GroupingState =
  | { mode: 'create'; pendingIds: string[] }
  | { mode: 'addTo'; compositeId: string; pendingIds: string[] }
  | null

/** Grouping mode object tree node */
export interface GroupingTreeNode {
  id: string
  name: string
  type: string
  icon: string
  depth: number
  parentId: string | undefined
  children: GroupingTreeNode[]
}

/** useSceneRenderer extra parameters (required by scene editor, not template editor) */
export interface RendererExtras {
  episodeId?: string
  sceneId?: string
  blockId?: string | null
}

/** Composable configuration */
export interface SetupWorkspaceOptions {
  /** Canvas container DOM ref */
  canvasContainer: Ref<HTMLElement | undefined>
  /** Editor root container DOM ref (for fullscreen) */
  editorContainer: Ref<HTMLElement | undefined>
  /** useSceneRenderer extra options */
  rendererExtras?: RendererExtras
  /** Callback when data changes (e.g. projectStore.markAsUnsaved) */
  onDataChange?: () => void
  /** Save data (implemented by consumer) */
  onSave: () => Promise<void>
  /** Exit editor (implemented by consumer) */
  onExit: () => void
}

// ===== Composable Implementation =====

export function useSetupWorkspace(options: SetupWorkspaceOptions) {
  // ----- Stores -----
  const sceneObjectStore = useSceneObjectStore()
  const backgroundStore = useBackgroundStore()
  const soundStore = useSoundStore()
  const toast = useToast()

  // ===== 1. Modification State Tracking =====
  const hasLocalChanges = ref(false)

  function markLocalChange() {
    hasLocalChanges.value = true
    options.onDataChange?.()
  }

  function resetLocalChanges() {
    hasLocalChanges.value = false
  }

  // ===== 2. Canvas Rendering Management =====
  const renderer = ref<ReturnType<typeof useSceneRenderer> | null>(null)

  async function initCanvas(): Promise<void> {
    const container = options.canvasContainer.value
    if (!container) {
      console.error('[useSetupWorkspace] Canvas container not found')
      return
    }

    const rendererInstance = useSceneRenderer({
      canvasContainer: container,
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT,
      mode: 'setup',
      episodeId: options.rendererExtras?.episodeId ?? '',
      sceneId: options.rendererExtras?.sceneId ?? '',
      blockId: options.rendererExtras?.blockId ?? null,
      onSetupChange: () => markLocalChange(),
    })

    renderer.value = rendererInstance
    await rendererInstance.initRenderer()
    
    // Initialize pass-through list defaults (camera automatically added)
    rendererInstance.getSceneGraph().initPassThroughDefaults()

    setTimeout(() => {
      rendererInstance.scrollToCanvasCenter()
    }, 100)
  }

  function destroyCanvas(): void {
    if (renderer.value) {
      renderer.value.destroyRenderer()
      renderer.value = null
    }
  }

  // ===== 3. Right Panel Control =====
  const rightPanelCollapsed = ref(false)
  const rightPanelWidth = ref(320)


  let isResizingRightPanel = false

  function startResizeRightPanel(event: MouseEvent): void {
    isResizingRightPanel = true
    event.preventDefault()

    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingRightPanel) {
        const newWidth = Math.max(250, Math.min(600, window.innerWidth - e.clientX))
        rightPanelWidth.value = newWidth
      }
    }

    const handleMouseUp = () => {
      isResizingRightPanel = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)

      if (renderer.value) {
        renderer.value.updateTransformParams()
        void renderer.value.renderObjects()
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  // ===== 4. Object Operations =====

  function handleSelectObject(objectId: string | null): void {
    sceneObjectStore.selectObject(objectId)
  }

  function handleUpdateObject(updates: Partial<SceneObject>): void {
    const selected = sceneObjectStore.getSelectedObject()
    if (!selected) return
    if (selected.type === 'mask' || (updates as Partial<{ type: string }>).type === 'mask') {
      debugLog('mask', '[MASK-DEBUG] useSetupWorkspace.handleUpdateObject\n' + JSON.stringify({ selectedId: selected.id, updates }, null, 2))
    }
    sceneObjectStore.updateObject(selected.id, updates)
    markLocalChange()
    if (renderer.value) {
      void renderer.value.renderObjects()
    }
  }

  function handleDeleteObject(objectId?: string): void {
    const idToDelete = objectId ?? sceneObjectStore.selectedObjectId
    if (!idToDelete) return

    const obj = sceneObjectStore.getObject(idToDelete)
    if (!obj) return

    // v25: Ambient light cannot be deleted
    if (obj.type === 'light' && (obj as import('@/types/sceneObject').LightObject).lightType === 'ambient') return

    const alias = (obj as unknown as { alias?: string }).alias ?? obj.name ?? 'Object'

    // Check if composite with children → three-option dialog (unified for entity/union)
    const isCompositeWithChildren = obj.type === 'composite'
      && (obj as unknown as { childIds?: string[] }).childIds?.length

    if (isCompositeWithChildren) {
      const childCount = (obj as unknown as { childIds: string[] }).childIds.length
      confirmDialogConfig.value = {
        title: 'Delete Grouped Object',
        message: `Are you sure you want to delete "${alias}"? This group contains ${childCount} child object(s).\n\nDelete Group Only: Child objects bubble up to parent level\nDelete Group and Descendants: Delete all`,
        confirmText: 'Delete Group Only',
        cancelText: 'Cancel',
        isDanger: false,
        showSecondaryConfirm: true,
        secondaryConfirmText: 'Delete Group and Descendants',
        onConfirm: () => {
          sceneObjectStore.dissolveComposite(idToDelete)
          sceneObjectStore.removeObject(idToDelete)
          showConfirmDialog.value = false
          markLocalChange()
        },
        onSecondaryConfirm: () => {
          sceneObjectStore.removeObjectWithDescendants(idToDelete)
          showConfirmDialog.value = false
          markLocalChange()
        },
      }
    } else {
      confirmDialogConfig.value = {
        title: 'Delete Object',
        message: `Are you sure you want to delete "${alias}"? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        isDanger: true,
        showSecondaryConfirm: false,
        secondaryConfirmText: '',
        onConfirm: () => {
          sceneObjectStore.removeObject(idToDelete)
          showConfirmDialog.value = false
          markLocalChange()
        },
        onSecondaryConfirm: () => undefined as void,
      }
    }
    showConfirmDialog.value = true
  }

  function handleCopyObject(): void {
    const selected = sceneObjectStore.getSelectedObject()
    if (!selected) return

    const duplicate = sceneObjectStore.duplicateObject(selected.id)
    if (!duplicate) return

    sceneObjectStore.selectObject(duplicate.id)
    markLocalChange()
  }

  function handleMoveUp(): void {
    const selected = sceneObjectStore.getSelectedObject()
    if (!selected) return
    sceneObjectStore.updateObject(selected.id, { zIndex: selected.zIndex + 1 })
    markLocalChange()
    if (renderer.value) {
      void renderer.value.renderObjects()
    }
  }

  function handleMoveDown(): void {
    const selected = sceneObjectStore.getSelectedObject()
    if (!selected) return
    const newZIndex = Math.max(-10, selected.zIndex - 1)
    sceneObjectStore.updateObject(selected.id, { zIndex: newZIndex })
    markLocalChange()
    if (renderer.value) {
      void renderer.value.renderObjects()
    }
  }

  function handleInitialStateUpdate(_pose?: string, _expression?: string): void {
    // character type removed, this function does nothing
    return
  }

  // ===== 5. Asset Picker Management =====
  const showCharacterPicker = ref(false)
  const showBackgroundPicker = ref(false)
  const showPropPicker = ref(false)
  const showSoundPicker = ref(false)
  const showScreenEffectPicker = ref(false)
  const showTemplatePicker = ref(false)
  const showExpressionPicker = ref(false)
  const showActorPicker = ref(false)
  const showLightPicker = ref(false)
  const showAddMenu = ref(false)

  function toggleAddMenu(): void {
    showAddMenu.value = !showAddMenu.value
  }

  function handleMenuItemClick(type: string): void {
    showAddMenu.value = false

    switch (type) {
      case 'characters':
        showCharacterPicker.value = true
        break
      case 'backgrounds':
        showBackgroundPicker.value = true
        break
      case 'props':
        showPropPicker.value = true
        break
      case 'sounds':
        showSoundPicker.value = true
        break
      case 'screen_effects':
        showScreenEffectPicker.value = true
        break
      case 'scene_templates':
        showTemplatePicker.value = true
        break
      case 'symbol': {
        const symbolName = sceneObjectStore.generateUniqueAlias('Symbol')
        const symbolObj = sceneObjectStore.createSymbolObject(symbolName)
        sceneObjectStore.selectObject(symbolObj.id)
        markLocalChange()
        break
      }
      case 'expression':
        showExpressionPicker.value = true
        break
      case 'actors':
        showActorPicker.value = true
        break
      case 'light':
        showLightPicker.value = true
        break
      case 'text': {
        const textObj = sceneObjectStore.createTextObject('Text')
        sceneObjectStore.selectObject(textObj.id)
        markLocalChange()
        break
      }
      case 'mask_rectangle':
      case 'mask_ellipse': {
        const shape = type === 'mask_ellipse' ? 'ellipse' : 'rectangle'
        const maskName = sceneObjectStore.generateUniqueAlias(shape === 'ellipse' ? 'Ellipse Mask' : 'Rectangle Mask')
        const maskObj = sceneObjectStore.createMaskObject(maskName, shape)
        sceneObjectStore.selectObject(maskObj.id)
        markLocalChange()
        break
      }
    }
  }

  function handleLightSelect(result: { lightType: 'point' | 'spot'; params?: { lightColor?: string; lightIntensity?: number; lightRadius?: number; flicker?: number; flickerSpeed?: number; directionAngle?: number; coneAngle?: number } }): void {
    const isSpot = result.lightType === 'spot'
    const p = result.params
    const lightObj = sceneObjectStore.createLightObject(isSpot ? 'spot' : 'point', isSpot ? 'Spotlight' : 'Point Light', {
      lightColor: p?.lightColor ?? '#ffffff',
      lightIntensity: p?.lightIntensity ?? 1.0,
      lightRadius: p?.lightRadius ?? (isSpot ? 420 : 300),
      flicker: p?.flicker ?? 0,
      flickerSpeed: p?.flickerSpeed ?? 0.35,
      directionMode: isSpot ? 'cone' : 'omni',
      directionAngle: p?.directionAngle ?? 0,
      coneAngle: p?.coneAngle ?? (isSpot ? 70 : 100),
      x: CANVAS_CENTER_X,
      y: CANVAS_CENTER_Y,
    })
    sceneObjectStore.selectObject(lightObj.id)
    showLightPicker.value = false
    markLocalChange()
  }


  function handleCharacterSelect(actorData: { actorId: string; name: string; characterId: string }): void {
    pendingActorData.value = actorData
    pendingCanvasCenter.value = { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y }
    showCharacterPicker.value = false
    showAliasDialog.value = true
  }

  async function handleBackgroundSelect(background: Background): Promise<void> {
    const newObject = sceneObjectStore.createBackgroundObject(background.id, background.name)
    await applyMeasuredDefaultSize(newObject, sceneObjectStore.updateObject)
    useAnimationStore().hydrateObjectAnimations(newObject)
    // v21: Only UI creation path auto-plays frame animations (deserialization path does not trigger)
    sceneObjectStore.autoPopulateInitialAnimations(newObject)
    sceneObjectStore.selectObject(newObject.id)
    showBackgroundPicker.value = false
    markLocalChange()
  }

  async function handlePropSelect(prop: PropAsset): Promise<void> {
    if (typeof sceneObjectStore.createPropObject !== 'function') {
      console.error('[useSetupWorkspace] sceneObjectStore.createPropObject is not a function.')
      return
    }
    const newObject = sceneObjectStore.createPropObject(prop.id, prop.name ?? 'Untitled Prop')
    await applyMeasuredDefaultSize(newObject, sceneObjectStore.updateObject)
    // v21: Only UI creation path auto-plays frame animations (deserialization path does not trigger)
    sceneObjectStore.autoPopulateInitialAnimations(newObject)
    sceneObjectStore.selectObject(newObject.id)
    showPropPicker.value = false
    markLocalChange()
  }

  function handleSoundSelect(sound: SoundAsset): void {
    if (typeof sceneObjectStore.createAudioObject !== 'function') {
      console.error('[useSetupWorkspace] sceneObjectStore.createAudioObject is not a function.')
      return
    }

    const isBgm = sound.type === 'bgm'
    const initialProps = {
      volume: 1.0,
      loop: isBgm,
      autoPlay: isBgm,
      fadeIn: 0,
      fadeOut: 0,
    }

    const newObject = sceneObjectStore.createAudioObject(
      sound.id,
      sound.name,
      initialProps,
    )

    sceneObjectStore.selectObject(newObject.id)
    showSoundPicker.value = false
    markLocalChange()
  }

  function handleScreenEffectSelect(preset: ScreenEffectPreset): void {
    showScreenEffectPicker.value = false
    const effectObj = sceneObjectStore.createScreenEffectObject(
      preset.effectClass,
      preset.name,
      preset.params,
    )
    if (preset.defaultAlpha !== undefined) {
      sceneObjectStore.updateObject(effectObj.id, { alpha: preset.defaultAlpha })
    }
    sceneObjectStore.selectObject(effectObj.id)
    markLocalChange()
  }

  /**
   * Set alias and extraInfo of top-level root object in instantiated result.
   * Finds first object without parentId and updates it whether single-root or multi-root (wrapper).
   */
  function setRootIdentity(objects: SceneObject[], targetName: string, extraInfo: CompositeExtraInfo): void {
    const root = objects.find(o => !o.parentId)
    if (!root) return
    const nsRoot = sceneObjectStore.resolveNamespaceRoot(root.id)
    const uniqueAlias = sceneObjectStore.generateUniqueAlias(targetName, nsRoot, root.id)
    sceneObjectStore.updateObject(root.id, { alias: uniqueAlias, extraInfo })
  }

  function handleTemplateSelect(template: SceneTemplate): void {
    showTemplatePicker.value = false

    const result = instantiateTemplate(template, CANVAS_CENTER_X, CANVAS_CENTER_Y, {
      wrapperCompositeMode: 'entity',
    })

    // v17: Add objects one by one and regenerate unique alias (namespace-aware)
    for (const obj of result.objects) {
      sceneObjectStore.addObject(obj)
      // After addition, regenerate unique alias based on current namespace
      const nsRoot = sceneObjectStore.resolveNamespaceRoot(obj.id)
      const uniqueAlias = sceneObjectStore.generateUniqueAlias(obj.alias ?? obj.name, nsRoot, obj.id)
      if (uniqueAlias !== obj.alias) {
        sceneObjectStore.updateObject(obj.id, { alias: uniqueAlias })
      }
    }

    // Set alias and extraInfo of top-level root object
    setRootIdentity(result.objects, template.name, { kind: 'template', templateId: template.id })

    if (result.objects.length > 0 && result.objects[0]) {
      sceneObjectStore.selectObject(result.objects[0].id)
    }

    markLocalChange()

    if (renderer.value) {
      void renderer.value.renderObjects()
    }
  }

  // v18: Expression selection
  async function handleExpressionSelect(expressionId: string): Promise<void> {
    showExpressionPicker.value = false
    const expressionStore = useExpressionStore()
    const expr = expressionStore.getExpression(expressionId)
    const name = expr?.name ?? 'Expression'
    const exprObj = sceneObjectStore.createExpressionObject(expressionId, name)
    await applyMeasuredDefaultSize(exprObj, sceneObjectStore.updateObject)
    sceneObjectStore.selectObject(exprObj.id)
    markLocalChange()
  }

  // v18: Composite character selection — instantiate as composite object in entity mode
  function handleCompositeCharacterSelect(character: CompositeCharacter, displayName?: string, extraInfo?: CompositeExtraInfo): void {
    showCharacterPicker.value = false

    // CompositeCharacter and SceneTemplate share objects structure
    const pseudoTemplate: SceneTemplate = {
      id: character.id,
      name: character.name,
      objects: character.objects,
      createdAt: character.createdAt,
      ...(character.tags ? { tags: character.tags } : {}),
      ...(character.editorAnchor ? { editorAnchor: character.editorAnchor } : {}),
      ...(character.renderChain ? { renderChain: character.renderChain } : {}),
    }

    const result = instantiateTemplate(pseudoTemplate, CANVAS_CENTER_X, CANVAS_CENTER_Y, {
      wrapperCompositeMode: 'entity',
    })

    for (const obj of result.objects) {
      sceneObjectStore.addObject(obj)
      const nsRoot = sceneObjectStore.resolveNamespaceRoot(obj.id)
      const uniqueAlias = sceneObjectStore.generateUniqueAlias(obj.alias ?? obj.name, nsRoot, obj.id)
      if (uniqueAlias !== obj.alias) {
        sceneObjectStore.updateObject(obj.id, { alias: uniqueAlias })
      }
    }

    // Set alias and extraInfo of top-level root object
    const resolvedExtraInfo = extraInfo ?? { kind: 'character' as const, characterId: character.id }
    setRootIdentity(result.objects, displayName ?? character.name, resolvedExtraInfo)

    // Remap rootCompositeId (use idMap to convert template object ID to scene instance ID)
    if (character.rootCompositeId) {
      const remappedRoot = result.idMap.get(character.rootCompositeId)
      const rootObj = result.objects.find(o => !o.parentId)
      if (remappedRoot && rootObj?.type === 'composite') {
        sceneObjectStore.updateObject(rootObj.id, {
          instanceRootCompositeId: remappedRoot,
        } as Partial<SceneObject>)
      }
    }

    if (result.objects.length > 0 && result.objects[0]) {
      sceneObjectStore.selectObject(result.objects[0].id)
    }

    markLocalChange()

    if (renderer.value) {
      void renderer.value.renderObjects()
    }
  }

  // Actor selection
  function handleActorSelect(character: CompositeCharacter, actorName: string, actorId: string): void {
    showActorPicker.value = false
    handleCompositeCharacterSelect(character, actorName, { kind: 'actor', actorId })
  }

  // ===== 6. Grouping Mode =====
  const groupingState = ref<GroupingState>(null)

  function getObjectDisplayName(objectId: string): string {
    const obj = sceneObjectStore.getObject(objectId)
    if (!obj) return objectId
    return (obj as unknown as { alias?: string }).alias ?? obj.name ?? 'Untitled'
  }

  function getCompositeDisplayName(compositeId: string | undefined): string {
    if (!compositeId) return 'Unknown'
    return getObjectDisplayName(compositeId)
  }

  function handleStartGrouping(): void {
    groupingState.value = { mode: 'create', pendingIds: [] }
  }

  function handleCompositeAction(payload: { action: string; compositeId?: string; childId?: string }): void {
    if (payload.action === 'addMember' && payload.compositeId) {
      groupingState.value = { mode: 'addTo', compositeId: payload.compositeId, pendingIds: [] }
    }
  }

  function handleCanvasClickForGrouping(): void {
    if (!groupingState.value) return

    const selectedObj = sceneObjectStore.getSelectedObject()
    if (!selectedObj || selectedObj.type === 'camera') return

    const objectId = selectedObj.id
    const pendingIds = groupingState.value.pendingIds

    if (groupingState.value.mode === 'addTo') {
      const compositeId = groupingState.value.compositeId
      if (objectId === compositeId) {
        toast.warning('Cannot add a grouped object to itself as a member')
        return
      }
      let current = selectedObj
      while (current.parentId) {
        if (current.parentId === compositeId) {
          toast.warning('This object is already a descendant of this grouped object and cannot be added again')
          return
        }
        const parent = sceneObjectStore.getObject(current.parentId)
        if (!parent) break
        current = parent
      }
    }

    const idx = pendingIds.indexOf(objectId)
    if (idx !== -1) {
      pendingIds.splice(idx, 1)
    } else {
      if (pendingIds.length > 0) {
        const firstObj = sceneObjectStore.getObject(pendingIds[0]!)
        const requiredParentId = firstObj?.parentId
        if (selectedObj.parentId !== requiredParentId) {
          toast.warning('Grouping is only supported for sibling objects')
          return
        }
      }
      pendingIds.push(objectId)
    }
  }

  function handleGroupingConfirm(compositeMode: 'entity' | 'union' = 'union'): void {
    if (!groupingState.value) return

    if (groupingState.value.mode === 'create') {
      if (groupingState.value.pendingIds.length < 2) return
      const composite = sceneObjectStore.groupObjects(groupingState.value.pendingIds, compositeMode)
      sceneObjectStore.selectObject(composite.id)
      markLocalChange()
    } else if (groupingState.value.mode === 'addTo') {
      if (groupingState.value.pendingIds.length === 0) return
      sceneObjectStore.addToComposite(groupingState.value.compositeId, groupingState.value.pendingIds)
      markLocalChange()
    }

    groupingState.value = null
    groupingBarOffset.value = { x: 0, y: 0 }
  }

  /**
   * Toggle checked state of object in grouping pending list by ID (called by checkbox list).
   * Reuses validation logic from handleCanvasClickForGrouping without relying on canvas selection.
   */
  function handleGroupingToggleById(objectId: string): void {
    if (!groupingState.value) return

    const obj = sceneObjectStore.getObject(objectId)
    if (!obj || obj.type === 'camera') return

    const pendingIds = groupingState.value.pendingIds

    // addTo mode validation
    if (groupingState.value.mode === 'addTo') {
      const compositeId = groupingState.value.compositeId
      if (objectId === compositeId) {
        toast.warning('Cannot add a grouped object to itself as a member')
        return
      }
      let current = obj
      while (current.parentId) {
        if (current.parentId === compositeId) {
          toast.warning('This object is already a descendant of this grouped object and cannot be added again')
          return
        }
        const parent = sceneObjectStore.getObject(current.parentId)
        if (!parent) break
        current = parent
      }
    }

    // Toggle logic
    const idx = pendingIds.indexOf(objectId)
    if (idx !== -1) {
      pendingIds.splice(idx, 1)
    } else {
      // Sibling check
      if (pendingIds.length > 0) {
        const firstObj = sceneObjectStore.getObject(pendingIds[0]!)
        const requiredParentId = firstObj?.parentId
        if (obj.parentId !== requiredParentId) {
          toast.warning('Grouping is only supported for sibling objects')
          return
        }
      }
      pendingIds.push(objectId)
    }
  }

  /** Currently locked parentId (determined by first pending object) */
  const lockedParentId = computed<string | undefined | null>(() => {
    if (!groupingState.value) return null
    const ids = groupingState.value.pendingIds
    if (ids.length === 0) return null // null = unlocked
    const firstObj = sceneObjectStore.getObject(ids[0]!)
    return firstObj?.parentId // undefined = root level
  })

  /**
   * Build object tree for grouping mode (non-camera objects only).
   * Composite nodes contain child node lists, flat objects are leaf nodes.
   */
  const groupingEligibleObjects = computed<GroupingTreeNode[]>(() => {
    const objects = sceneObjectStore.objects

    function buildNode(obj: SceneObject, depth: number): GroupingTreeNode {
      const displayName = (obj as unknown as { alias?: string }).alias ?? obj.name ?? 'Untitled'
      const children: GroupingTreeNode[] = []

      if (obj.type === 'composite') {
        const comp = obj as unknown as CompositeObject
        for (const childId of comp.childIds) {
          const child = sceneObjectStore.getObject(childId)
          if (child && child.type !== 'camera') {
            children.push(buildNode(child, depth + 1))
          }
        }
      }

      return {
        id: obj.id,
        name: displayName,
        type: obj.type,
        icon: getTypeIcon(obj.type),
        depth,
        parentId: obj.parentId,
        children,
      }
    }

    // Only take root level objects (no parentId)
    return objects
      .filter(o => o.type !== 'camera' && !o.parentId)
      .sort((a, b) => b.zIndex - a.zIndex)
      .map(o => buildNode(o, 0))
  })

  // ===== 6b. Grouping Floating Bar Dragging =====
  const groupingBarOffset = ref({ x: 0, y: 0 })

  function startDragGroupingBar(e: MouseEvent): void {
    // Ignore mousedown on button/checkbox
    const target = e.target as HTMLElement
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT') return

    e.preventDefault()
    const startX = e.clientX - groupingBarOffset.value.x
    const startY = e.clientY - groupingBarOffset.value.y

    function onMove(ev: MouseEvent) {
      groupingBarOffset.value = {
        x: ev.clientX - startX,
        y: ev.clientY - startY,
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Reset grouping bar position on cancel
  function handleGroupingCancel(): void {
    groupingState.value = null
    groupingBarOffset.value = { x: 0, y: 0 }
  }

  // ===== 7. Alias Management =====
  const showAliasDialog = ref(false)
  const pendingActorData = ref<{ actorId: string; name: string; characterId: string } | null>(null)
  const pendingCanvasCenter = ref<{ x: number; y: number } | null>(null)
  const editingAliasObjectId = ref<string | null>(null)

  const aliasDialogActorName = computed(() => {
    if (editingAliasObjectId.value) {
      const obj = sceneObjectStore.getObject(editingAliasObjectId.value)
      if (!obj) return ''

      if (obj.type === 'background') {
        const bgObj = obj as unknown as { refId: string }
        const bg = backgroundStore.getBackground(bgObj.refId)
        return bg?.name ?? obj.name ?? 'Background'
      } else if (obj.type === 'audio') {
        const audioObj = obj as unknown as { refId: string }
        const sound = soundStore.getSound(audioObj.refId)
        return sound?.name ?? obj.name ?? 'Sound'
      }
      return obj.name ?? 'Untitled'
    }
    return pendingActorData.value?.name ?? ''
  })

  const aliasDialogSuggestedAlias = computed(() => {
    if (editingAliasObjectId.value) {
      const obj = sceneObjectStore.getObject(editingAliasObjectId.value)
      if (obj) {
        return obj.alias ?? obj.name ?? ''
      }
    }
    return suggestedAlias.value
  })

  const aliasDialogCurrentAlias = computed(() => {
    if (editingAliasObjectId.value) {
      const obj = sceneObjectStore.getObject(editingAliasObjectId.value)
      if (obj) {
        return obj.alias ?? ''
      }
    }
    return undefined
  })

  const aliasDialogObjectType = computed(() => {
    if (editingAliasObjectId.value) {
      const obj = sceneObjectStore.getObject(editingAliasObjectId.value)
      if (obj) {
        return obj.type as 'background' | 'bgm' | 'prop' | 'text'
      }
    }
    return 'prop'
  })

  const suggestedAlias = computed(() => {
    if (!pendingActorData.value) return ''
    const baseName = pendingActorData.value.name
    const existing = existingAliases.value

    if (!existing.includes(baseName)) {
      return baseName
    }

    let counter = 2
    while (existing.includes(`${baseName}${counter}`)) {
      counter++
    }
    return `${baseName}${counter}`
  })

  const existingAliases = computed(() => {
    // v17: Namespace-aware — collect aliases within the namespace of the object being edited
    const nsRoot = editingAliasObjectId.value
      ? sceneObjectStore.resolveNamespaceRoot(editingAliasObjectId.value)
      : null
    return sceneObjectStore.getExistingAliases(nsRoot)
  })

  function handleAliasConfirm(alias: string): void {
    // Edit mode: update existing object's alias
    if (editingAliasObjectId.value) {
      const obj = sceneObjectStore.getObject(editingAliasObjectId.value)
      if (obj && obj.type !== 'camera') {
        sceneObjectStore.updateObject(obj.id, {
          alias: alias,
        } as unknown as Partial<SceneObject>)
        markLocalChange()
      }
      editingAliasObjectId.value = null
      showAliasDialog.value = false
      return
    }

    // Character creation removed — this branch no longer used
    showAliasDialog.value = false
  }

  function handleAliasCancel(): void {
    pendingActorData.value = null
    pendingCanvasCenter.value = null
    editingAliasObjectId.value = null
    showAliasDialog.value = false
  }

  function handleEditAlias(objectId: string): void {
    const obj = sceneObjectStore.getObject(objectId)
    if (!obj || obj.type === 'camera') return

    editingAliasObjectId.value = objectId
    pendingActorData.value = null
    pendingCanvasCenter.value = null
    showAliasDialog.value = true
  }

  // ===== 8. Animation Triggering =====

  function handleTriggerAnim(payload: { action: 'play' | 'stop'; animName: string; loop?: boolean; speed?: number; timingMode?: AnimationTimingMode }): void {
    const selected = sceneObjectStore.getSelectedObject()

    if (!selected || !renderer.value) return
    if (!payload.animName) return

    const sceneGraph = renderer.value.getSceneGraph()

    interface IAnimationPlayer {
      playAnimation(animName: string, definition: unknown, params?: { loop?: boolean; speed?: number; reset?: boolean }): void
      stopAnimation(animName: string): void
    }

    // v18: All object types possessing GenericAnimationPlayer can play animation
    const player: IAnimationPlayer | undefined = sceneGraph.getGenericAnimationPlayer(selected.id)

    if (!player) return

    const animationStore = useAnimationStore()
    const resourceType = getAnimationResourceType(selected.type)
    if (!resourceType) return

    // v18: composite uses its own id as resourceId (no refId)
    const resourceId = selected.type === 'composite' ? selected.id : selected.refId
    if (!resourceId) return

    const animation = animationStore.getAnimation(resourceType, resourceId, payload.animName)
    if (!animation) return

    if (payload.action === 'play') {
      player.playAnimation(payload.animName, animation, {
        loop: payload.loop ?? true,
        speed: payload.speed ?? 1,
      })
    } else {
      player.stopAnimation(payload.animName)
    }
  }

  // ===== 9. Pass-through List Management =====
  const showPassThroughTip = ref(true)

  function addToPassThrough(objectId: string): void {
    if (renderer.value) {
      const sceneGraph = renderer.value.getSceneGraph()
      sceneGraph.addPassThrough(objectId)
      void renderer.value.renderObjects()
    }
  }

  function removeFromPassThrough(objectId: string): void {
    if (renderer.value) {
      const sceneGraph = renderer.value.getSceneGraph()
      sceneGraph.removePassThrough(objectId)
      void renderer.value.renderObjects()
    }
  }

  function togglePassThroughVisible(objectId: string): void {
    if (renderer.value) {
      const sceneGraph = renderer.value.getSceneGraph()
      const entry = sceneGraph.getPassThroughEntry(objectId)
      if (entry) {
        sceneGraph.setPassThroughVisible(objectId, !entry.visible)
        void renderer.value.renderObjects()
      }
    }
  }

  function getPassThroughEntries(): ReadonlyMap<string, { visible: boolean }> {
    if (renderer.value) {
      return renderer.value.getSceneGraph().getPassThroughEntries()
    }
    return new Map()
  }

  function isObjectPassThrough(objectId: string): boolean {
    if (renderer.value) {
      return renderer.value.getSceneGraph().isPassThrough(objectId)
    }
    return false
  }

  // ===== 10. Fullscreen Toggle =====
  const isFullscreen = ref(false)

  function toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      const container = options.editorContainer.value
      if (container) {
        container.requestFullscreen().then(() => {
          isFullscreen.value = true
        }).catch((err) => {
          console.error('[useSetupWorkspace] Failed to enter fullscreen:', err)
        })
      }
    } else {
      document.exitFullscreen().then(() => {
        isFullscreen.value = false
      }).catch((err) => {
        console.error('[useSetupWorkspace] Failed to exit fullscreen:', err)
      })
    }
  }

  function handleFullscreenChange(): void {
    isFullscreen.value = !!document.fullscreenElement
    setTimeout(() => {
      if (renderer.value) {
        renderer.value.updateTransformParams()
        void renderer.value.renderObjects()
      }
    }, 100)
  }

  // ===== 10. Confirmation Dialog / Save Confirmation =====
  const showConfirmDialog = ref(false)
  const confirmDialogConfig = ref({
    title: 'Confirm',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    isDanger: false,
    showSecondaryConfirm: false,
    secondaryConfirmText: '',
    onConfirm: () => undefined as void,
    onSecondaryConfirm: () => undefined as void,
  })

  const showSaveConfirmDialog = ref(false)

  /** Toolbar return button: prompt SaveConfirmDialog when unsaved changes exist */
  function handleReturn(): void {
    if (hasLocalChanges.value) {
      showSaveConfirmDialog.value = true
    } else {
      options.onExit()
    }
  }

  /** SaveConfirmDialog: save and exit */
  async function handleSaveAndExit(): Promise<void> {
    showSaveConfirmDialog.value = false
    await options.onSave()
    hasLocalChanges.value = false
    options.onExit()
  }

  /** SaveConfirmDialog: discard changes */
  function handleDiscardAndExit(): void {
    showSaveConfirmDialog.value = false
    options.onExit()
  }

  // ===== 11. Event Listeners =====

  function handleKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return
    }
  }

  function handleClickOutside(event: MouseEvent): void {
    const target = event.target as HTMLElement
    if (!target.closest('.add-menu-container')) {
      showAddMenu.value = false
    }
  }

  function setupEventListeners(): void {
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('click', handleClickOutside)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
  }

  function cleanupEventListeners(): void {
    document.removeEventListener('keydown', handleKeyDown)
    document.removeEventListener('click', handleClickOutside)
    document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }

  // ===== 12. Watchers =====

  /** Setup all common Watchers. Called by consumer after data is loaded in onMounted. */
  function setupWatchers(): void {
    // Object count changed → re-render
    watch(
      () => sceneObjectStore.objects.length,
      () => {
        if (renderer.value) {
          void renderer.value.renderObjects()
        }
      },
    )

    // Object property changed (expression, pose, visible, symbol material) → re-render
    watch(
      () => sceneObjectStore.objects.map(o => ({
        id: o.id,
        expression: undefined,
        pose: undefined,
        visible: o.visible,
        currentMaterialId: o.type === 'symbol' ? (o as unknown as { currentMaterialId?: string }).currentMaterialId : undefined,
        materialsLen: o.type === 'symbol' ? (o as unknown as { materials?: unknown[] }).materials?.length : undefined,
        exprRefId: o.type === 'expression' ? o.refId : undefined,
      })),
      () => {
        if (renderer.value) {
          void renderer.value.renderObjects()
        }
      },
      { deep: true },
    )

    // Right panel collapsed → update layout
    watch([rightPanelCollapsed], () => {
      setTimeout(() => {
        if (renderer.value) {
          renderer.value.updateTransformParams()
          void renderer.value.renderObjects()
        }
      }, 300)
    })

    // Right panel width → update layout
    watch([rightPanelWidth], () => {
      requestAnimationFrame(() => {
        if (renderer.value) {
          renderer.value.updateTransformParams()
          void renderer.value.renderObjects()
        }
      })
    })

    // Grouping highlight sync
    watch(
      () => groupingState.value?.pendingIds.slice() ?? [],
      (ids) => {
        if (renderer.value) {
          renderer.value.setGroupingPendingIds(ids)
        }
      },
      { deep: true },
    )
  }

  // ===== Return =====

  return {
    // Stores (for template direct usage)
    sceneObjectStore,

    // Canvas
    renderer,
    initCanvas,
    destroyCanvas,

    // Modification state
    hasLocalChanges,
    markLocalChange,
    resetLocalChanges,

    // Right panel
    rightPanelCollapsed,
    rightPanelWidth,

    startResizeRightPanel,

    // Object operations
    handleSelectObject,
    handleUpdateObject,
    handleDeleteObject,
    handleCopyObject,
    handleMoveUp,
    handleMoveDown,
    handleInitialStateUpdate,

    // Asset Picker
    showCharacterPicker,
    showBackgroundPicker,
    showPropPicker,
    showSoundPicker,
    showScreenEffectPicker,
    showTemplatePicker,
    showExpressionPicker,
    showActorPicker,
    showLightPicker,
    showAddMenu,
    toggleAddMenu,
    handleMenuItemClick,
    handleLightSelect,
    handleCharacterSelect,
    handleBackgroundSelect,
    handlePropSelect,
    handleSoundSelect,
    handleScreenEffectSelect,
    handleTemplateSelect,
    handleExpressionSelect,
    handleCompositeCharacterSelect,
    handleActorSelect,

    // Grouping
    groupingState,
    getObjectDisplayName,
    getCompositeDisplayName,
    handleStartGrouping,
    handleCompositeAction,
    handleCanvasClickForGrouping,
    handleGroupingConfirm,
    handleGroupingCancel,
    handleGroupingToggleById,
    groupingEligibleObjects,
    lockedParentId,
    groupingBarOffset,
    startDragGroupingBar,

    // Alias
    showAliasDialog,
    aliasDialogActorName,
    aliasDialogSuggestedAlias,
    aliasDialogCurrentAlias,
    aliasDialogObjectType,
    existingAliases,
    handleAliasConfirm,
    handleAliasCancel,
    handleEditAlias,

    // Animation trigger
    handleTriggerAnim,

    // Pass-through list management
    showPassThroughTip,
    addToPassThrough,
    removeFromPassThrough,
    togglePassThroughVisible,
    getPassThroughEntries,
    isObjectPassThrough,

    // Fullscreen
    isFullscreen,
    toggleFullscreen,

    // Confirmation dialog
    showConfirmDialog,
    confirmDialogConfig,

    // Save confirmation
    showSaveConfirmDialog,
    handleReturn,
    handleSaveAndExit,
    handleDiscardAndExit,

    // Watchers & events
    setupWatchers,
    setupEventListeners,
    cleanupEventListeners,
  }
}
