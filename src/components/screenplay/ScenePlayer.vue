<template>
  <div class="scene-player">
    <div
      ref="previewCanvas"
      class="preview-canvas"
    />
    
    <!-- Loading/Error state -->
    <div
      v-if="isLoading"
      class="loading-overlay"
    >
      <div class="loading-spinner" />
      <span>{{ loadingMessage }}</span>
    </div>
    <div
      v-if="errorMessage"
      class="error-overlay"
    >
      <span class="error-icon">⚠️</span>
      <span>{{ errorMessage }}</span>
    </div>
    
    <!-- Subtitle display -->
    <div
      v-if="currentSubtitle"
      class="subtitle-overlay"
    >
      <div class="subtitle-text">
        {{ currentSubtitle }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as PIXI from 'pixi.js'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useAssetAudio } from '@/composables/useAssetAudio'
import { useAssetImage } from '@/composables/useAssetImage'
import { useAssetLoader } from '@/composables/useAssetLoader'
import { CAMERA_BASE_HEIGHT,CAMERA_BASE_WIDTH, CANVAS_HEIGHT, CANVAS_WIDTH } from '@/constants/canvas'
import { getPlaybackVolumeGain } from '@/constants/voiceOptions'
import { AnimationController, type AnimationHost } from '@/core/AnimationController'
import { computeAudioState } from '@/core/AudioController'
import { CompositeRenderTarget } from '@/core/CompositeRenderTarget'
import { type GenericAnimationPlayer } from '@/core/GenericAnimationPlayer'
import {
  applyAllMasks,
  createMaskRendererResources,
  disposeMaskRendererResources,
  type MaskRendererResources,
} from '@/core/maskRenderer'
import { installRootRenderChainRenderer } from '@/core/RenderChainStage'
import {
  applyLightingFilter,
  type LightingFilterCache,
  type RenderHost,
  renderObject as sharedRenderObject,
  sortCompositeContainers as sharedSortCompositeContainers,
  syncObjectBoundsToPlayers as sharedSyncObjectBoundsToPlayers,
  updateCompositeRenderTargetsInOrder,
} from '@/core/renderPipeline'
import { type ObjectStateHost,SceneObjectRenderer } from '@/core/SceneObjectRenderer'
import { advanceAllObjectAnimations } from '@/core/spriteAnimationDriver'
import { computeTextRevealState } from '@/core/TextRevealController'
import type { TextureProvider } from '@/core/TextureProvider'
import { useAnimationStore } from '@/stores/animationStore'
import { useBackgroundStore } from '@/stores/backgroundStore'
import type { Episode } from '@/stores/episodeStore'
import { useExpressionStore } from '@/stores/expressionStore'
import { useProjectStore } from '@/stores/projectStore'
import { usePropStore } from '@/stores/propStore'
import { useSoundStore } from '@/stores/soundStore'
import type { CompositeObject } from '@/types/sceneObject'
import type {
  Action,
  BlockPlayInfo,
  RuntimeSceneSnapshot,
  RuntimeSlot,
  SceneContainer,
  SceneObject,
  SceneSetup,
  ScriptBlock,
  SetAnimAction,
  SetSceneStructureAction,
} from '@/types/screenplay'
import { evaluateCameraState, evaluateObjectState, type RuntimeCameraState } from '@/utils/actionEvaluator'
import { type ActionType,getHandler } from '@/utils/actionHandlers'
import { isObjectStateAction } from '@/utils/actionHandlers/registry'
import type { ActionHandlerContext, WriteableState } from '@/utils/actionHandlers/types'
import { sortActionsForEvaluation } from '@/utils/actionOrder'
import { restoreAnimatedSpriteStillFrame } from '@/utils/animationUtils'
import { collectSceneFontPreloadObjects, preloadSceneFonts } from '@/utils/fontLoader'
import { rebuildChildIdsFromParentIds } from '@/utils/hierarchyUtils'
import { buildParentOverridesForTime, sortObjectsBySlotActionOrder, sortObjectsForEvaluation } from '@/utils/objectEvaluationOrder'
import { reconcileRenderChain, sortRenderChainByZIndex } from '@/utils/renderChainUtils'
import { applyBlockActionsToState, applyMaskPostPass, calculatePrevContext } from '@/utils/sceneStateCalculator'
import { applySetSceneStructureActionToObjects } from '@/utils/setSceneStructureAction'
import { getSubtitleTextAtTime, parseBlockToSlots } from '@/utils/slotUtils'
import { buildObjectStateSnapshot } from '@/utils/stateUtils'
import type { TTSTimingFile } from '@/utils/ttsTiming'
import { type AudioInstance, audioKit } from '@/utils/WebAudioKit'


const props = withDefaults(defineProps<{
  episodeId: string
  sceneId: string
  episode: Episode
  autoPlay?: boolean
  seamless?: boolean
  currentSlotIndex?: number
  blockId?: string  // Single Block playback mode (used by ActionPreviewDialog)
}>(), {
  currentSlotIndex: 0,
  blockId: ''
})

const emit = defineEmits<{
  'playback-finished': []
  'progress': [number, number] // currentTime, totalDuration
  'ready': []
  'error': [string]
  'play-state-change': [boolean]
}>()

const { getImageUrl } = useAssetImage()
const { getAudioUrl, loadAudioUrl } = useAssetAudio()
const { getTexture } = useAssetLoader()

// const episodeStore = useEpisodeStore()
// const sceneObjectStore = useSceneObjectStore()

const backgroundStore = useBackgroundStore()
const propStore = usePropStore()
const expressionStore = useExpressionStore()
const soundStore = useSoundStore()
const projectStore = useProjectStore()

// v14.x: Unified renderer instance
const scenePlayerTextureProvider: TextureProvider = {
  getTexture: (url: string) => {
    const tex = getTexture(url)
    if (tex !== PIXI.Texture.EMPTY) return tex
    const fullUrl = getImageUrl(url)
    return fullUrl ? PIXI.Texture.from(fullUrl) : PIXI.Texture.EMPTY
  },
  getImageUrl: (url: string) => getImageUrl(url)
}
const sceneObjectRenderer = new SceneObjectRenderer(
  scenePlayerTextureProvider,
  { propStore, backgroundStore, expressionStore }
)

// P0: ObjectStateHost — Bridge local cache to unified renderer
const objectStateHost: ObjectStateHost = {
  getObjectDimensions: (id: string) => objectDimensions.get(id),
  setObjectDimensions: (id: string, dims: { width: number; height: number }) => objectDimensions.set(id, dims),
}

// Canvas reference
const previewCanvas = ref<HTMLElement | null>(null)

// State
const isLoading = ref(true)
const loadingMessage = ref('Preparing preview...')
const errorMessage = ref<string | null>(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const currentBlockIndex = ref(-1)
let previousBlockIndex = -1
const currentSubtitle = ref('')

// PIXI related
let pixiApp: PIXI.Application | null = null
let stage: PIXI.Container | null = null
let sceneLoadGeneration = 0
const objectContainers = new Map<string, PIXI.Container>()
const audioInstances = new Map<string, AudioInstance>()
const audioInstancePlayTimes = new Map<string, number>()  // Track playTime per instance to detect play action switch
const pendingAudioPlays = new Set<string>()
const pendingAudioPlayTimes = new Map<string, number>()  // Track playTime for pending play
const audioStopping = new Set<string>()

function isCurrentSceneLoad(generation: number): boolean {
  return generation === sceneLoadGeneration && !!pixiApp && !!contentViewport
}


// v11.60: Animation Player registry (unified Map eliminating type dispatch branches)
const objectAnimationPlayers = new Map<string, GenericAnimationPlayer>()
const triggeredAnimations = new Set<string>()


// P2: Composite own mode offscreen render target
const compositeRenderTargets = new Map<string, CompositeRenderTarget>()

// v25: Lighting filter cache (reuse instances to avoid creating every frame)
const lightingFilterCache: LightingFilterCache = {}

// Clip-Mask Phase 1: Apply all mask relations before rendering each frame
const maskRendererResources: MaskRendererResources = createMaskRendererResources()

function applyMasksBeforeRender(states: SceneObject[]): void {
  if (!stage) return
  // Ensure worldTransform is up to date (after applyObjectState, before render)
  // Root stage parent is null, update children individually to avoid NPE.
  for (const child of stage.children) {
    child.updateTransform()
  }
  applyAllMasks(states, (id) => objectContainers.get(id), maskRendererResources)
}

// Approach B: camera_follow first frame BBox offset cache
// key = action.id, value = { dx, dy } = BBox center - pivot center
const followBBoxOffsets = new Map<string, { dx: number, dy: number }>()

// === RenderHost Bridge (Shared Render Pipeline DI) ===
const renderHost: RenderHost = {
  sceneObjectRenderer,
  objectContainers,
  objectAnimationPlayers,

  compositeRenderTargets,
  getRenderer: () => pixiApp?.renderer as PIXI.Renderer | undefined,
  getSceneObjects: () => sceneSetup?.objects ?? [],
}

// === AnimationController Integration ===
const scenePlayerAnimationHost: AnimationHost = {

  getAnimationPlayer: (id: string) => objectAnimationPlayers.get(id) ?? null,
  getObjectContainer: (id: string) => objectContainers.get(id) ?? null,
  getSceneObjects: () => sceneSetup?.objects ?? [],
  getAnimationDefinition: (objectId: string, animName: string) => {
    const animationStore = useAnimationStore()
    // v16: Look up from SceneObject.animations uniformly (hydration guaranteed populated)
    const obj = sceneSetup?.objects.find(o => o.id === objectId)
    if (!obj) return null
    return animationStore.getObjectAnimationByName(obj, animName) ?? null
  },
  // Manual frame animation drive hooks:
  // 1. Reset accumulator, ensure frame sequence starts from frame 0
  // 2. Set _shouldPlay flag, replacing previous gotoAndPlay(0)
  //    (fallbackPlayPropSprite no longer runs after onAnimationTriggered, handled by hook)
  onAnimationTriggered: (objectId: string, _animName: string, cmd: 'play' | 'stop') => {
    const container = objectContainers.get(objectId)
    if (!container) return
    const spriteNames = ['prop_animation', 'bg_animation', 'symbol_animation', 'expression_animation']
    for (const name of spriteNames) {
      const sprite = container.getChildByName(name) as (PIXI.AnimatedSprite & { _shouldPlay?: boolean }) | undefined
      if (sprite) {
        if (cmd === 'play') {
          sprite._shouldPlay = true
          spriteAnimTimeAccumulator.set(sprite, 0)
        } else {
          sprite._shouldPlay = false
        }
        break
      }
    }
  },
}
const animationController = new AnimationController(scenePlayerAnimationHost, triggeredAnimations)

// Manual frame animation advance accumulator (replaces PIXI Ticker auto-update)
const spriteAnimTimeAccumulator = new WeakMap<PIXI.AnimatedSprite, number>()

// Camera viewport related
let contentViewport: PIXI.Container | null = null
let scaleContainer: PIXI.Container | null = null
let blackBackground: PIXI.Graphics | null = null

// Canvas dimensions and camera viewport (imported from constants file)

// Cache camera info
let cachedCameraInfo: { x: number; y: number; width: number; height: number; zoom: number } | null = null

// v7.3: camera_follow last followed position cache (for camera state calculation)
let lastFollowPosition: { x: number; y: number } | null = null
let lastEvaluatedCameraState: RuntimeCameraState | null = null

// Block playback related — using shared BlockPlayInfo type (types/screenplay.ts)

function cloneSceneObject<T extends SceneObject>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T
}

function getSlotIndexAtTime(slots: RuntimeSlot[], localTime: number): number {
  if (slots.length === 0) return -1
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    if (!slot) continue
    const slotEndTime = slot.startTime + slot.duration
    if (localTime >= slot.startTime && localTime < slotEndTime) {
      return i
    }
  }
  return slots.length - 1
}

function getActionTimeRangeForPreview(
  action: Action,
  slots: RuntimeSlot[],
): { start: number; end: number; duration: number } {
  let start = 0
  let duration = 0

  const slot = slots[action.slotIndex]
  if (slot) {
    start = slot.startTime
    if (action.category === 'duration') {
      const span = (action as { slotSpan?: number }).slotSpan ?? 1
      for (let i = 0; i < span; i++) {
        const currentSlot = slots[action.slotIndex + i]
        if (currentSlot) duration += currentSlot.duration
      }
    }
  }

  return { start, end: start + duration, duration }
}

function applyPreviewObjectAction(
  state: SceneObject,
  action: Action,
  stateMap: Map<string, SceneObject>,
): SceneObject {
  const nextState = cloneSceneObject(state)
  const handler = getHandler(action.type as ActionType)
  if (!handler) return nextState

  const context: ActionHandlerContext = {
    getObjectState: (id: string) => {
      const current = stateMap.get(id)
      return current ? (current as unknown as WriteableState) : undefined
    }
  }

  handler.applyToState(nextState as unknown as WriteableState, action, context)
  return nextState
}

function applyPreviewSceneStructureAction(
  stateMap: Map<string, SceneObject>,
  action: SetSceneStructureAction,
): void {
  const objects = [...stateMap.values()]
  applySetSceneStructureActionToObjects(objects, action)
  stateMap.clear()
  for (const obj of objects) {
    stateMap.set(obj.id, obj)
  }
}

const blockPlayInfos = ref<BlockPlayInfo[]>([])  // Made reactive
const ttsTimingCache = new Map<string, TTSTimingFile | null>()
const pendingTTSTimingLoads = new Map<string, Promise<TTSTimingFile | null>>()
let animationFrame: number | null = null
let playStartTime = 0
let playStartOffset = 0
let lastAnimationUpdateTime: number | null = null
const audioPlayRequestId = ref(0) // Playback request ID for race condition resolution
const audioPlayGeneration = ref(0) // Audio playback generation for Seek race condition resolution

// Scene initial config copy (copied from setup, read-only baseline)
let sceneSetup: SceneSetup | null = null

// Cache object original size (for visual center correction)
const objectDimensions = new Map<string, { 
  width: number
  height: number
  pivotX?: number
  pivotY?: number
  boundsX?: number
  boundsY?: number
}>()

// v14.2: Track pose of each character when measuring bounds last time
// Remeasure only on pose change, avoiding jitters during animation playback
const lastMeasuredPose = new Map<string, string>()

// Audio instances pending cleanup
const trackedAudioInstances = new Set<AudioInstance>()

function syncProgressState() {
  emit('progress', currentTime.value, totalDuration.value)
}

function buildSlotsForDuration(block: ScriptBlock, duration: number): RuntimeSlot[] {
  if (block.type === 'action') {
    return parseBlockToSlots(block)
  }

  const adjustedBlock: ScriptBlock = {
    ...block,
    ttsConfig: {
      ...(block.ttsConfig ?? {}),
      duration,
    },
  }
  return parseBlockToSlots(adjustedBlock)
}

function updateBlockTimelineFrom(index: number, duration: number) {
  const currentInfo = blockPlayInfos.value[index]
  if (!currentInfo || duration <= 0 || currentInfo.duration === duration) {
    return
  }

  const delta = duration - currentInfo.duration
  if (currentInfo.block.type !== 'action') {
    currentInfo.block.ttsConfig = {
      ...(currentInfo.block.ttsConfig ?? {}),
      duration,
    }
  }
  currentInfo.duration = duration
  currentInfo.endTime = currentInfo.startTime + duration
  currentInfo.slots = buildSlotsForDuration(currentInfo.block, duration)

  for (let i = index + 1; i < blockPlayInfos.value.length; i++) {
    const info = blockPlayInfos.value[i]
    if (!info) continue
    info.startTime += delta
    info.endTime += delta
  }

  syncProgressState()
}

async function resolvePlayableAudioUrl(audioUrl: string): Promise<string | null> {
  if (audioUrl.startsWith('blob:') || audioUrl.startsWith('data:') || audioUrl.startsWith('http')) {
    return audioUrl
  }

  const resolvedUrl = getAudioUrl(audioUrl)
  if (resolvedUrl) {
    return resolvedUrl
  }

  await loadAudioUrl(audioUrl)
  return getAudioUrl(audioUrl) ?? null
}

async function reconcileBlockAudioDurations() {
  for (let i = 0; i < blockPlayInfos.value.length; i++) {
    const info = blockPlayInfos.value[i]
    if (!info?.audioUrl) continue

    try {
      const playableUrl = await resolvePlayableAudioUrl(info.audioUrl)
      if (!playableUrl) continue

      const audioBuffer = await audioKit.load(playableUrl)
      const actualDurationMs = Math.round((audioBuffer?.duration ?? 0) * 1000)
      if (actualDurationMs > 0) {
        updateBlockTimelineFrom(i, Math.max(info.duration, actualDurationMs))
      }
    } catch (err) {
      console.warn('[ScenePlayer] Failed to correct audio duration:', err)
    }
  }
}

// Compute current scene
const currentScene = computed((): SceneContainer | null => {
  if (!props.episode) return null
  return props.episode.scenes.find(s => s.id === props.sceneId) || null
})

// blockId mode flag
const blockIdMode = computed(() => !!props.blockId)

// Current Block in blockId mode
const targetBlock = computed(() => {
  if (!blockIdMode.value || !currentScene.value) return null
  return currentScene.value.script.find(b => b.id === props.blockId) ?? null
})

// prevContext in blockId mode
const prevContext = computed((): RuntimeSceneSnapshot | null => {
  if (!blockIdMode.value || !currentScene.value || !props.blockId) return null
  return calculatePrevContext(currentScene.value, props.blockId)
})

// Total duration
const totalDuration = computed(() => {
  return blockPlayInfos.value.reduce((sum, info) => sum + info.duration, 0)
})

// Methods exposed to parent component
defineExpose({
  play,
  pause,
  reset,
  seek,
  currentTime,
  totalDuration,
  isPlaying
})

/**
 * Get default camera state
 */
function getDefaultCameraState(): RuntimeCameraState {
  const camera = cachedCameraInfo || {
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    zoom: 1
  }
  return {
    x: camera.x,
    y: camera.y,
    zoom: camera.zoom,
    shakeOffsetX: 0,
    shakeOffsetY: 0
  }
}

/**
 * Initialize PIXI App (once only)
 */
async function initPixiApp() {
  if (pixiApp) return

  if (!previewCanvas.value) {
    console.error('previewCanvas ref is null')
    errorMessage.value = 'Failed to initialize canvas container'
    return
  }

  try {
    const containerRect = previewCanvas.value.getBoundingClientRect()
    // Wait for container size
    if (containerRect.height < 100) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    // Re-fetch dimensions
    const finalRect = previewCanvas.value.getBoundingClientRect()
    
    // Calculate display scale: fit camera viewport to container with 5% margin
    const scaleX = finalRect.width / CAMERA_BASE_WIDTH
    const scaleY = finalRect.height / CAMERA_BASE_HEIGHT
    const displayScale = Math.min(scaleX, scaleY) * 0.95
    
    // Display size = camera viewport size * displayScale
    const displayWidth = CAMERA_BASE_WIDTH * displayScale
    const displayHeight = CAMERA_BASE_HEIGHT * displayScale
    
    // Initialize AudioContext
    await audioKit.init()

    // v12: Direct Projection architecture (aligned with FrameCapture)
    // Canvas size = camera viewport size, no large canvas + mask clipping
    pixiApp = new PIXI.Application({
      width: CAMERA_BASE_WIDTH,
      height: CAMERA_BASE_HEIGHT,
      backgroundColor: 0x000000,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    });

    // Disable PIXI internal Ticker auto-render, manually render at end of updateFrame()
    // Eliminate 1-frame latency where Ticker renders stale state before updateFrame
    pixiApp.ticker.autoStart = false
    pixiApp.ticker.stop()

    const canvas = pixiApp.view as HTMLCanvasElement
    canvas.style.width = `${displayWidth}px`
    canvas.style.height = `${displayHeight}px`
    
    // Simplified layout: canvas directly displays camera viewport without clipping
    const clipWrapper = document.createElement('div')
    clipWrapper.style.width = `${displayWidth}px`
    clipWrapper.style.height = `${displayHeight}px`
    clipWrapper.style.overflow = 'hidden'
    clipWrapper.style.position = 'absolute'
    clipWrapper.style.left = '50%'
    clipWrapper.style.top = '50%'
    clipWrapper.style.transform = 'translate(-50%, -50%)'
    clipWrapper.style.borderRadius = '4px'
    
    // Canvas aligns with container, no negative offset needed
    canvas.style.position = 'absolute'
    canvas.style.left = '0px'
    canvas.style.top = '0px'
    
    clipWrapper.appendChild(canvas)
    previewCanvas.value.appendChild(clipWrapper)
    
    // v12: Create viewport structure (aligned with FrameCapture)
    // 1. Black background layer
    blackBackground = new PIXI.Graphics()
    blackBackground.beginFill(0x000000)
    blackBackground.drawRect(0, 0, CAMERA_BASE_WIDTH, CAMERA_BASE_HEIGHT)
    blackBackground.endFill()
    blackBackground.zIndex = -1
    pixiApp.stage.addChild(blackBackground)
    
    // 2. Create scaleContainer
    scaleContainer = new PIXI.Container()
    scaleContainer.scale.set(1, 1)
    pixiApp.stage.addChild(scaleContainer)
    
    // 3. Create content viewport container
    contentViewport = new PIXI.Container()
    contentViewport.sortableChildren = true
    contentViewport.zIndex = 0
    scaleContainer.addChild(contentViewport)
    
    // v12: cameraMask no longer needed, content clipped naturally at canvas boundary
    
    pixiApp.stage.sortableChildren = true
    
  } catch (err) {
    console.error('[ScenePlayer] PIXI Init Failed:', err)
    errorMessage.value = 'Failed to initialize rendering engine'
  }
}

/**
 * Load current scene
 * v11.66: Changed to async, await renderInitialFrame
 */
async function loadScene() {
  if (!pixiApp || !contentViewport) return
  const loadGeneration = ++sceneLoadGeneration
  
  try {
    // Show loading mask only in non-seamless mode
    if (!props.seamless) {
      isLoading.value = true
      loadingMessage.value = 'Preparing scene...'
    }
    errorMessage.value = null
    
    const scene = currentScene.value
    if (!scene) {
      if (isCurrentSceneLoad(loadGeneration)) {
        errorMessage.value = 'Scene does not exist'
        isLoading.value = false
      }
      return
    }
    
    // P1: In blockId mode use prevContext as initial state
    if (blockIdMode.value && prevContext.value) {
      sceneSetup = JSON.parse(JSON.stringify(prevContext.value)) as SceneSetup
    } else {
      // Use scene setup as initial state
      sceneSetup = JSON.parse(JSON.stringify(scene.setup)) as SceneSetup
    }

    // v16: animations persisted, no runtime hydration needed
    
    // Prepare new Stage
    const newStage = new PIXI.Container()
    newStage.sortableChildren = true
    
    // Clean old state (keep PIXI App and Viewport)
    stopAllAudio()

    objectContainers.clear()
    blockPlayInfos.value = []
    
    // Point stage to new container
    if (stage) {
      contentViewport.removeChild(stage)
      stage.destroy({ children: true })
    }
    stage = newStage
    contentViewport.addChild(stage)
    
    // Initialize camera info
    // P1: Get camera initial state from prevContext.camera in blockId mode
    const cameraSource = blockIdMode.value && prevContext.value
      ? prevContext.value.camera
      : sceneSetup?.camera
    const cameraInfo = cameraSource || {
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2,
      zoom: 1
    }
    cachedCameraInfo = { 
      x: cameraInfo.x, 
      y: cameraInfo.y, 
      width: CAMERA_BASE_WIDTH,
      height: CAMERA_BASE_HEIGHT,
      zoom: cameraInfo.zoom || 1 
    }
    
    // v11.66: await renderInitialFrame to ensure all characters are initialized
    const rendered = await renderInitialFrame(loadGeneration)
    if (!rendered || !isCurrentSceneLoad(loadGeneration)) return
    
    // Prepare Block info
    prepareBlockPlayInfos()
    if (!isCurrentSceneLoad(loadGeneration)) return
    loadingMessage.value = 'Preparing TTS timing...'
    await preloadTTSTimingsForBlockInfos()
    if (!isCurrentSceneLoad(loadGeneration)) return
    renderCurrentFrameWithoutAudio()
    await reconcileBlockAudioDurations()
    if (!isCurrentSceneLoad(loadGeneration)) return
    renderCurrentFrameWithoutAudio()
    syncProgressState()
    
    // Done
    isLoading.value = false
    emit('ready')
    
    if (props.autoPlay) {
      void play()
    }
    
  } catch (err) {
    if (!isCurrentSceneLoad(loadGeneration)) return
    console.error('[ScenePlayer] Load Scene Failed:', err)
    errorMessage.value = `Failed to load scene: ${err instanceof Error ? err.message : 'Unknown error'}`
    isLoading.value = false
  }
}

async function initRenderer() {
  await initPixiApp()
  await loadScene()
}

/**
 * Prepare Block playback info
 */
function prepareBlockPlayInfos() {
  const scene = currentScene.value
  if (!scene) {
    return
  }
  
  let accumulatedTime = 0
  ttsTimingCache.clear()
  pendingTTSTimingLoads.clear()
  
  // P1: In blockId mode generate playback info for target Block only
  const blocksToProcess = blockIdMode.value && targetBlock.value
    ? [targetBlock.value]
    : scene.script
  
  let currentSnapshot: RuntimeSceneSnapshot = JSON.parse(JSON.stringify({
    objects: sceneSetup!.objects,
    renderChain: sceneSetup!.renderChain ?? [],
    camera: {
      x: cachedCameraInfo?.x ?? CANVAS_WIDTH / 2,
      y: cachedCameraInfo?.y ?? CANVAS_HEIGHT / 2,
      zoom: cachedCameraInfo?.zoom ?? 1,
      shakeOffsetX: 0,
      shakeOffsetY: 0,
    },
  })) as RuntimeSceneSnapshot

  for (const block of blocksToProcess) {
    // Ensure TTS is generated
    let duration = 0
    let audioUrl: string | undefined

    // ScriptBlock types have ttsConfig property
    if (block.type === 'action') {
      duration = block.duration
    } else if (block.ttsConfig) {
      duration = block.ttsConfig.duration || 0
      // v12.8: audioPath replaces audio, using lazy loading
      audioUrl = block.ttsConfig.audioPath ? getAudioUrl(block.ttsConfig.audioPath) : undefined
    }
    
    // If duration missing, provide default
    if (duration <= 0) {
      duration = 1000
    }
    
    const slots = parseBlockToSlots(block)
    const blockActions: Action[] = block.actions || []
    
    const startSnapshot: RuntimeSceneSnapshot = JSON.parse(JSON.stringify(currentSnapshot)) as RuntimeSceneSnapshot
    
    const startTime = accumulatedTime
    const endTime = accumulatedTime + duration
    
    const playInfo: BlockPlayInfo = {
      block,
      startTime: startTime,
      endTime: endTime,
      duration,
      slots,
      blockActions,
      startSnapshot,
      ...(audioUrl ? { audioUrl } : {})
    }
    blockPlayInfos.value.push(playInfo)
    const timingAudioPath = getBlockTTSAudioPath(block)
    if (timingAudioPath) {
      void loadTTSTimingForAudioPath(timingAudioPath)
    }

    accumulatedTime += duration
    currentSnapshot = applyBlockActionsToState(currentSnapshot, block, scene)
  }
}

function getBlockPlaybackVolume(block: ScriptBlock): number {
  if (block.type === 'dialogue') {
    const scene = currentScene.value
    const instance = scene?.setup.objects.find((o) => o.id === block.instanceId)
    const actorId = instance?.extraInfo?.kind === 'actor' ? instance.extraInfo.actorId : undefined
    const actor = actorId
      ? projectStore.actors.find((item) => item.id === actorId)
      : (instance?.refId ? projectStore.actors.find((item) => item.characterId === instance.refId) : undefined)
    return getPlaybackVolumeGain(actor?.voice?.volume)
  }

  if (block.type === 'narration') {
    return getPlaybackVolumeGain(projectStore.narrator?.voice?.volume)
  }

  return 1
}

function getBlockTTSAudioPath(block: ScriptBlock): string | undefined {
  if (block.type === 'action') return undefined
  return block.ttsConfig?.audioPath
}

async function preloadTTSTimingsForBlockInfos(): Promise<void> {
  const audioPaths = new Set<string>()
  for (const info of blockPlayInfos.value) {
    const audioPath = getBlockTTSAudioPath(info.block)
    if (audioPath) audioPaths.add(audioPath)
  }
  await Promise.all([...audioPaths].map(audioPath => loadTTSTimingForAudioPath(audioPath)))
}

function getTTSTimingForBlock(block: ScriptBlock): TTSTimingFile | null | undefined {
  const audioPath = getBlockTTSAudioPath(block)
  if (!audioPath) return null
  if (ttsTimingCache.has(audioPath)) {
    const timing = ttsTimingCache.get(audioPath) ?? null
    return timing
  }
  void loadTTSTimingForAudioPath(audioPath)
  return undefined
}

async function loadTTSTimingForAudioPath(audioPath: string): Promise<TTSTimingFile | null> {
  if (ttsTimingCache.has(audioPath)) return ttsTimingCache.get(audioPath) ?? null

  const pending = pendingTTSTimingLoads.get(audioPath)
  if (pending) return pending

  const promise = projectStore.loadTTSTiming(audioPath)
    .then(timing => {
      ttsTimingCache.set(audioPath, timing)
      return timing
    })
    .catch(error => {
      console.warn('[ScenePlayer] Failed to load TTS timing, fallback to continuous playback:', audioPath, error)
      ttsTimingCache.set(audioPath, null)
      return null
    })
    .finally(() => {
      pendingTTSTimingLoads.delete(audioPath)
    })

  pendingTTSTimingLoads.set(audioPath, promise)
  return promise
}



/**
 * Render initial frame (using 5-phase pipeline)
 * Render logic consistent with updateFrame
 * v11.66: Changed to async, consistent with ActionPreviewDialog.resetToPrev
 */
async function renderInitialFrame(loadGeneration: number): Promise<boolean> {
  if (!stage) {
      throw new Error('[ScenePlayer] renderInitialFrame aborted: stage is null')
  }
  if (!sceneSetup) {
      throw new Error('[ScenePlayer] renderInitialFrame aborted: sceneSetup is null')
  }
  const renderStage = stage
  const renderSetup = sceneSetup

  // Clean old state
  renderStage.removeChildren()
  objectContainers.clear()
  objectDimensions.clear()

  // P2: Clean offscreen render targets first to prevent leaks and re-renders
  compositeRenderTargets.forEach(crt => crt.destroy())
  compositeRenderTargets.clear()

  lastMeasuredPose.clear()
  
  // P1: Use getActiveObjects in blockId mode to include Shadow Objects
  const objectsToRender = getActiveObjects()
  if (objectsToRender.length === 0) {
      console.warn('[ScenePlayer] renderInitialFrame warning: no objects to render')
      return true
  }
  
  // Phase 1: Resource sync (create all objects, await character initialization)
  const synced = await syncResources(loadGeneration, renderStage, renderSetup)
  if (!synced || !isCurrentSceneLoad(loadGeneration) || stage !== renderStage || sceneSetup !== renderSetup) {
    return false
  }
  

  
  // Phase 1.5: Apply initial animation state (ensure character state before measuring)
  applyInitialAnimationStates()
  
  // P1: Replay cross-block animations in blockId mode
  replayCarriedOverAnimations()
  
  // Phase 2: Real-time measurement (character state now determined)
  measureObjects()
  sharedSyncObjectBoundsToPlayers(objectDimensions, objectAnimationPlayers)
  
  // Phase 3: Evaluate state (build initial state)
  const states = new Map<string, SceneObject>()
  for (const objSetup of objectsToRender) {
    const state = buildObjectStateSnapshot(objSetup)
    
    states.set(objSetup.id, state)
  }
  
  // Phase 3.5: Parent container migration (align PIXI hierarchy with data parentId)
  // v22: union containers may not be created in right place when renderChain walks children,
  // this step migrates PIXI containers to correct parent based on state.parentId
  for (const objSetup of objectsToRender) {
    const container = objectContainers.get(objSetup.id)
    if (!container) continue
    const state = states.get(objSetup.id)
    if (!state) continue
    const newParentId = state.parentId ?? null
    let targetParent: PIXI.Container
    if (!newParentId) {
      targetParent = renderStage
    } else {
      const parentCrt = compositeRenderTargets.get(newParentId)
      targetParent = parentCrt?.getSourceContainer() ?? (objectContainers.get(newParentId) ?? renderStage)
    }
    if (container.parent !== targetParent) {
      if (container.parent) container.parent.removeChild(container)
      targetParent.addChild(container)
    }
  }
  
  // Phase 4: Layout objects (apply state)
  const visualCenters = new Map<string, { x: number, y: number }>()
  
  for (const objSetup of objectsToRender) {
    const container = objectContainers.get(objSetup.id)
    if (!container) continue
    
    const state = states.get(objSetup.id)
    if (!state) continue
    
    // Apply state
    const visualCenter = applyObjectState(container, state, objSetup, states)
    if (visualCenter) {
      visualCenters.set(objSetup.id, visualCenter)
    }
      // Light object containers need to participate in updateTransform (toGlobal relies on accurate worldTransform),
    // but should not render visible pixels. Use renderable=false (does not block transform updates),
    // instead of visible=false (which causes PIXI to skip updateTransform).
    if (objSetup.type === 'light') {
      container.renderable = false
    }

    objectAnimationPlayers.get(objSetup.id)?.cacheBaseTransform()
  }
  
  // v23: Install renderChain-driven rendering logic for the root stage
  // Render order is entirely determined by renderChain + sortRenderChainByZIndex
  if (renderSetup.renderChain && renderSetup.renderChain.length > 0) {
    const setupChain = reconcileRenderChain(
      renderSetup.renderChain,
      [...states.values()],
    )
    installRootRenderChainRenderer(
      renderStage,
      () => sortRenderChainByZIndex(
        setupChain,
        (id) => states.get(id)?.zIndex ?? renderSetup.objects.find(o => o.id === id)?.zIndex ?? 0
      ),
      (id) => objectContainers.get(id),
    )
  }
  // Recursively sort composite containers (entity internal renderChain)
  // v22: Pass getZIndex to sort entity internal renderChain
  sharedSortCompositeContainers(renderSetup.objects, objectContainers, compositeRenderTargets,
    (id) => states.get(id)?.zIndex ?? renderSetup.objects.find(o => o.id === id)?.zIndex ?? 0
  )
  
  // v19 Fix: Initial frame CRT update - child objects were not positioned when crt.enable() was called in syncResources,
  // CRT's RenderTexture must be refreshed after Phase 4 positioning completes
  updateCompositeRenderTargetsInOrder(compositeRenderTargets, [...states.values()])
  
  // Phase 5: Camera update
  applyCameraTransform(getDefaultCameraState())

  // Phase 6: Lighting filter
  if (contentViewport && isCurrentSceneLoad(loadGeneration) && stage === renderStage && sceneSetup === renderSetup) {
    contentViewport.updateTransform()
    applyLightingFilter(
      [...states.values()],
      renderStage,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
      lightingFilterCache,
      new PIXI.Rectangle(0, 0, CAMERA_BASE_WIDTH, CAMERA_BASE_HEIGHT),
      (id) => objectContainers.get(id),
      undefined,
      pixiApp?.renderer as PIXI.Renderer | undefined,
      compositeRenderTargets,
    )
  }

  // Clip-Mask Phase 1: Update worldTransform and apply all masks before render
  applyMasksBeforeRender([...states.values()])

  // Manually render initial frame (Ticker is disabled)
  if (pixiApp) {
    pixiApp.renderer.render(pixiApp.stage)
  }
  return true
}

function applyInitialAnimationStates() {
  if (!sceneSetup) return
  
  // v16: Initial animations are delegated uniformly to AnimationController.
  // This allows spawned=false objects to delay starting initial animations until truly visible, avoiding "playing before spawn".
  animationController.processInitialAnimationStates()
  
  // ScenePlayer specific: Only handle stillFrame restoration when "no initial animation".
  for (const objSetup of sceneSetup.objects) {
    if (objSetup.type !== 'prop') continue
    const container = objectContainers.get(objSetup.id)
    if (!container) continue
    
    // v16: Directly access SceneObjectBase.initialAnimations
    const initialAnims = objSetup.initialAnimations
    
    if (!initialAnims || initialAnims.length === 0) {
      const animatedSprite = container.getChildByName('prop_animation') as PIXI.AnimatedSprite | undefined
      if (animatedSprite?.playing) {
        const propData = propStore.getProp(objSetup.refId)
        restoreAnimatedSpriteStillFrame(animatedSprite, {
          stillFrameSource: propData?.stillFrameSource,
          stillFrameIndex: propData?.stillFrameIndex,
          url: propData?.stillFrameCustomUrl,
        }, getTexture)
      }
    }
  }
}

/**
 * P1: Get active object list (includes Shadow Objects in blockId mode)
 * Shadow Object: Objects defined in scene Setup with spawned=false, activated in current Block by set_lifecycle { spawned: true }
 */
function getActiveObjects(): SceneObject[] {
  if (!blockIdMode.value || !sceneSetup) {
    return sceneSetup?.objects ?? []
  }
  
  const scene = currentScene.value
  const block = targetBlock.value
  if (!scene || !block) return sceneSetup.objects
  
  const prevObjIds = new Set(sceneSetup.objects.map(o => o.id))
  const activeObjects = [...sceneSetup.objects]
  
  // Collect all target IDs of current Block actions
  const actionTargets = new Set<string>()
  for (const action of block.actions ?? []) {
    if (action.target && action.target !== 'camera') {
      actionTargets.add(action.target)
    }
  }
  
  // Look up objects from scene Setup that are not in prevContext but referenced by current Block actions
  for (const objSetup of scene.setup.objects) {
    if (actionTargets.has(objSetup.id) && !prevObjIds.has(objSetup.id)) {
      const shadowObj: SceneObject = {
        ...objSetup,
        spawned: false  // Shadow Object unspawned by default
      }
      activeObjects.push(shadowObj)
    }
  }
  
  return activeObjects
}

/**
 * P1: Replay animations persisting across Blocks
 * Trace back set_anim actions from all Blocks before current Block,
 * find animations with autoStopOnBlockEnd === false not overridden by subsequent stops,
 * and re-trigger these animations during Block preview initialization.
 */
function replayCarriedOverAnimations() {
  if (!blockIdMode.value) return
  const scene = currentScene.value
  const block = targetBlock.value
  if (!scene || !block) return

  const script = scene.script
  if (!script || script.length === 0) return

  const blockIndex = script.findIndex(b => b.id === block.id)
  if (blockIndex <= 0) return // First block has no preceding animations

  interface CarriedAnimation {
    targetId: string
    animName: string
    loop: boolean | undefined
  }
  const carriedAnimations = new Map<string, CarriedAnimation>()

  for (let i = 0; i < blockIndex; i++) {
    const prevBlock = script[i]
    if (!prevBlock) continue
    const blockActions = prevBlock.actions ?? []

    const setAnimActions = blockActions.filter(
      (a): a is SetAnimAction => a.type === 'set_anim'
    )

    for (const action of setAnimActions) {
      const targetId = action.target

      for (const animItem of (action.params.animations ?? [])) {
        const animName = animItem.animName
        const cmd = animItem.action ?? 'play'
        const key = `${targetId}:${animName}`

        if (cmd === 'play' && animItem.autoStopOnBlockEnd === false) {
          // v16: Only validate object existence, no longer filter by type whitelist
          // Animation definitions are uniformly looked up via AnimationHost.getAnimationDefinition(objectId, animName)
          const objSetup = scene.setup.objects.find(o => o.id === targetId)
          if (!objSetup) continue

          carriedAnimations.set(key, { targetId, animName, loop: animItem.loop })
        } else if (cmd === 'play') {
          carriedAnimations.delete(key)
        } else if (cmd === 'stop') {
          carriedAnimations.delete(key)
        }
      }
    }
  }

  if (carriedAnimations.size === 0) return

  for (const carried of carriedAnimations.values()) {
    const { targetId, animName, loop } = carried

    // v16: Uniformly look up via AnimationHost.getAnimationDefinition (hydrate ensures obj.animations is populated)
    const definition = scenePlayerAnimationHost.getAnimationDefinition(targetId, animName)
    if (!definition) continue
    const player = objectAnimationPlayers.get(targetId)
    if (!player) continue
    player.playAnimation(animName, definition, { loop: loop ?? definition.loop, reset: false })
  }
}

/**
 * Unified object render entry (delegated to shared render pipeline)
 */
async function renderObject(obj: SceneObject, parentContainer: PIXI.Container): Promise<void> {
  await sharedRenderObject(obj, parentContainer, renderHost)
}

function getMainSprite(container: PIXI.Container, type: string): PIXI.Sprite | PIXI.AnimatedSprite | null {
  if (type === 'background') return container.getChildByName('background_sprite')!
  else if (type === 'prop') return container.getChildByName('prop_sprite')! || container.getChildByName('prop_animation')!
  // v7.3: effect type removed

  return null
}

async function syncResources(
  loadGeneration?: number,
  targetStage: PIXI.Container | null = stage,
  targetSetup: SceneSetup | null = sceneSetup,
): Promise<boolean> {
  if (!targetSetup || !targetStage) return false
  const activeIds = new Set<string>()
  // P1: Use getActiveObjects in blockId mode to include Shadow Objects
  const objectsToSync = blockIdMode.value ? getActiveObjects() : targetSetup.objects

  // Text PRD Phase 0: Preload setup fonts, and set_text font switching in Action Mode
  const blocksForFontPreload = blockIdMode.value && targetBlock.value
    ? [targetBlock.value]
    : (currentScene.value?.script ?? [])
  await preloadSceneFonts(collectSceneFontPreloadObjects(objectsToSync, blocksForFontPreload))
  if (
    loadGeneration !== undefined
    && (!isCurrentSceneLoad(loadGeneration) || stage !== targetStage || sceneSetup !== targetSetup)
  ) {
    return false
  }

  for (const objSetup of objectsToSync) {
    activeIds.add(objSetup.id)
    const container = objectContainers.get(objSetup.id)
    if (!container) {
      try {
        await renderObject(objSetup, targetStage)
        if (
          loadGeneration !== undefined
          && (!isCurrentSceneLoad(loadGeneration) || stage !== targetStage || sceneSetup !== targetSetup)
        ) {
          return false
        }
      } catch (err) { /* ignore */ }
      continue
    }
    syncObjectTexture(objSetup, container)
  }
  for (const [id, container] of objectContainers) {
    if (!activeIds.has(id)) container.visible = false
  }
  return true
}

function syncObjectTexture(objSetup: SceneObject, container: PIXI.Container) {
  if (objSetup.type === 'prop' ) {
    const mainSprite = getMainSprite(container, objSetup.type)
    if (!mainSprite?.texture?.valid) {
       // logic to retry loading if needed
    }
  }
}

function measureObjects() {
  if (!sceneSetup) return
  sceneObjectRenderer.measureObjectBounds(sceneSetup.objects, objectContainers, objectStateHost)
}

/**
 * Sync objectDimensions to all GenericAnimationPlayer instances
 * Used for pivot position compensation calculation
 */
function syncObjectBoundsToPlayers() {
  sharedSyncObjectBoundsToPlayers(objectDimensions, objectAnimationPlayers)
}

function evaluateStates(currentInfo: BlockPlayInfo, blockLocalTime: number): Map<string, SceneObject> {
  if (!sceneSetup) return new Map()
  const objectIndexMap = new Map<string, number>()
  currentInfo.startSnapshot.objects.forEach((obj, idx) => {
    objectIndexMap.set(obj.id, idx)
  })
  const orderedBlockActions = sortActionsForEvaluation(currentInfo.blockActions, objectIndexMap)
  const objectStateActions = orderedBlockActions.filter((action) =>
    action.target !== 'camera' && isObjectStateAction(action)
  )
  const currentSlotIndex = getSlotIndexAtTime(currentInfo.slots, blockLocalTime)

  // 1) Build base state before current slot starts:
  //    Preceding point actions and completed duration actions are settled once and frozen into base.
  const baseStates = new Map<string, SceneObject>()
  for (const obj of currentInfo.startSnapshot.objects) {
    baseStates.set(obj.id, cloneSceneObject(obj))
  }

  for (const action of orderedBlockActions) {
    if (currentSlotIndex === -1) continue

    if (action.type === 'set_scene_structure') {
      if (action.slotIndex < currentSlotIndex) {
        applyPreviewSceneStructureAction(baseStates, action)
      }
      continue
    }

    if (action.target === 'camera' || !isObjectStateAction(action)) continue

    const currentState = baseStates.get(action.target)
    if (!currentState) continue

    if (action.category === 'point') {
      if (action.slotIndex < currentSlotIndex) {
        baseStates.set(action.target, applyPreviewObjectAction(currentState, action, baseStates))
      }
      continue
    }

    const span = (action as { slotSpan?: number }).slotSpan ?? 1
    const endSlot = action.slotIndex + span
    if (endSlot <= currentSlotIndex) {
      baseStates.set(action.target, applyPreviewObjectAction(currentState, action, baseStates))
    }
  }

  // 2) Apply only current slot's point actions:
  //    Pose actions first obtain the current slot's final frame, set_scene_structure then back-calculates local,
  //    subsequent slots will not recompute according to new parent world matrix.
  const pointStates = new Map<string, SceneObject>()
  for (const [id, state] of baseStates) {
    pointStates.set(id, cloneSceneObject(state))
  }

  for (const action of orderedBlockActions) {
    if (action.category !== 'point' || action.slotIndex !== currentSlotIndex) continue

    if (action.type === 'set_scene_structure') {
      applyPreviewSceneStructureAction(pointStates, action)
      continue
    }

    if (action.target === 'camera' || !isObjectStateAction(action)) continue

    const currentState = pointStates.get(action.target)
    if (!currentState) continue
    pointStates.set(action.target, applyPreviewObjectAction(cloneSceneObject(currentState), action, pointStates))
  }

  const parentOverrides = buildParentOverridesForTime(orderedBlockActions, blockLocalTime, currentInfo.slots)
  const sortedObjects = sortObjectsForEvaluation(
    sortObjectsBySlotActionOrder([...pointStates.values()], orderedBlockActions, currentSlotIndex),
    parentOverrides,
  )

  // 2.5) Clip-Mask Phase 1 — D1.5 mask post-pass
  //   applyPreviewObjectAction -> SetMaskHandler only performs single mask field collapsing,
  //   lacking cross-mask exclusive arbitration / order-independent transfer / "no implicit release" semantics;
  //   here we rerun a shared post-pass on pointStates to ensure ScenePlayer's real-time preview
  //   matches the block end state computed by applyBlockActionsToState.
  //   Only process set_mask with slotIndex <= currentSlotIndex (those already triggered).
  if (currentSlotIndex !== -1) {
    const setMaskActionsThroughCurrentSlot = orderedBlockActions.filter(
      a => a.type === 'set_mask' && a.slotIndex <= currentSlotIndex,
    )
    if (setMaskActionsThroughCurrentSlot.length > 0) {
      // Construct RuntimeSceneSnapshot compatible wrapper; applyMaskPostPass only reads prevState.objects,
      // writes targetIds / shape of mask objects into newState.objects.
      const prevSnapshot = {
        ...currentInfo.startSnapshot,
        objects: currentInfo.startSnapshot.objects,
      }
      const newSnapshotObjects = [...pointStates.values()]
      const newSnapshot = {
        ...currentInfo.startSnapshot,
        objects: newSnapshotObjects,
      }
      applyMaskPostPass(prevSnapshot, newSnapshot, setMaskActionsThroughCurrentSlot)
      // newSnapshotObjects element references are identical to pointStates; mutations automatically sync back to Map.
    }
  }

  // 3) On the basis of point state, interpolate time only for currently active duration actions.
  //    Point actions from preceding slots no longer participate in per-frame recomputation.
  const states = new Map<string, SceneObject>()
  for (const objSetup of sortedObjects) {
    const targetId = objSetup.id
    const pointState = pointStates.get(targetId)
    if (!pointState) continue

    const activeDurationActions = objectStateActions.filter((action) => {
      if (action.target !== targetId || action.category !== 'duration') return false
      const { start, end, duration } = getActionTimeRangeForPreview(action, currentInfo.slots)
      const isBlockEndFrame = blockLocalTime === currentInfo.duration && end === currentInfo.duration
      return duration > 0 && blockLocalTime >= start && (blockLocalTime < end || isBlockEndFrame)
    })

    if (activeDurationActions.length === 0) {
      states.set(targetId, cloneSceneObject(pointState))
      continue
    }

    const ctx: ActionHandlerContext = {
      getObjectState: (id: string) => {
        const evaluated = states.get(id)
        if (evaluated) return evaluated as unknown as WriteableState
        const pointState = pointStates.get(id)
        return pointState ? (pointState as unknown as WriteableState) : undefined
      }
    }

    const currentState = evaluateObjectState(
      pointState,
      activeDurationActions,
      blockLocalTime,
      currentInfo.duration,
      currentInfo.slots,
      -1,
      ctx
    )
    states.set(targetId, currentState)
  }

  rebuildCompositeChildIdsInStateMap(states)
  reconcileEntityRenderChainsInStateMap(states)

  // Text reveal actions - inject revealProgress
  for (const [, state] of states) {
    if (state.type !== 'text') continue
    const textState = state as import('@/types/sceneObject').TextObject
    const currentAbsTime = currentInfo.startTime + blockLocalTime
    const revealState = computeTextRevealState(
      blockPlayInfos.value,
      currentInfo,
      state.id,
      currentAbsTime,
    )
    if (!revealState) continue
    textState.content = revealState.content
    ;(state as unknown as import('@/utils/actionHandlers/types').WriteableState).revealProgress = revealState.progress
  }

  return states
}

function rebuildCompositeChildIdsInStateMap(states: Map<string, SceneObject>): void {
  rebuildChildIdsFromParentIds([...states.values()])
}

function reconcileEntityRenderChainsInStateMap(states: Map<string, SceneObject>): void {
  const runtimeObjects = [...states.values()]
  for (const state of runtimeObjects) {
    if (state.type !== 'composite') continue
    const comp = state as CompositeObject
    if ((comp.compositeMode ?? 'entity') !== 'entity') continue
    comp.renderChain = reconcileRenderChain(comp.renderChain ?? [], runtimeObjects, comp.id)
  }
}

function layoutObjects(
  states: Map<string, SceneObject>,
  renderChain?: readonly string[],
): Map<string, { x: number, y: number }> {
  if (!sceneSetup || !stage) return new Map()

  const visualCenters = new Map<string, { x: number, y: number }>()

  // P1: Use getActiveObjects in blockId mode to include Shadow Objects
  const objectsToLayout = getActiveObjects()
  
  // P2: Detect parentId change, migrate PIXI container to correct parent
  // v20: union/entity uniformly mounted to container corresponding to parentId
  for (const objSetup of objectsToLayout) {
    const container = objectContainers.get(objSetup.id)
    if (!container) continue
    const state = states.get(objSetup.id)
    if (!state) continue
    
    const newParentId = state.parentId ?? null
    // Determine target parent container
    // P2: If target parent is own mode composite (owns CRT),
    // child container should be added to CRT source (render subtree) instead of outputContainer,
    // otherwise child objects will not be rendered into RenderTexture.
    let targetParent: PIXI.Container
    if (!newParentId) {
      targetParent = stage
    } else {
      const parentCrt = compositeRenderTargets.get(newParentId)
      targetParent = parentCrt?.getSourceContainer() ?? (objectContainers.get(newParentId) ?? stage)
    }
    
    // Migrate if current parent container does not match
    if (container.parent !== targetParent) {
      if (container.parent) container.parent.removeChild(container)
      targetParent.addChild(container)
    }
  }
  
  for (const objSetup of objectsToLayout) {
    const container = objectContainers.get(objSetup.id)
    if (!container) continue
    const state = states.get(objSetup.id)
    if (!state) continue
    
    const visualCenter = applyObjectState(container, state, objSetup, states)
    if (visualCenter) visualCenters.set(objSetup.id, visualCenter)
    // Light objects: renderable=false hides rendering, but preserves transform updates
    if (objSetup.type === 'light') {
      container.renderable = false
    }

    objectAnimationPlayers.get(objSetup.id)?.cacheBaseTransform()
  }

  // P2: Convert child object local visual center to scene world coordinates
  // applyObjectState returns parent container local coordinates, camera_follow requires world coordinates
  if (contentViewport) {
    contentViewport.updateTransform()
    for (const objSetup of objectsToLayout) {
      const state = states.get(objSetup.id)
      if (!state?.parentId) continue
      const container = objectContainers.get(objSetup.id)
      if (!container) continue
      const localCenter = visualCenters.get(objSetup.id)
      if (!localCenter) continue
      const scenePoint = projectContainerParentPointToScene(
        objSetup.id,
        container,
        new PIXI.Point(localCenter.x, localCenter.y),
        states,
      )
      visualCenters.set(objSetup.id, { x: scenePoint.x, y: scenePoint.y })
    }
  }

  // v23: Install/update renderChain-driven rendering logic for root stage
  // Use latest activeRenderChain every frame (including runtime zIndex)
  const activeRenderChain = reconcileRenderChain(
    renderChain ?? sceneSetup?.renderChain ?? [],
    [...states.values()],
  )
  if (stage && activeRenderChain.length > 0) {
    const capturedChain = activeRenderChain
    installRootRenderChainRenderer(
      stage,
      () => sortRenderChainByZIndex(
        capturedChain,
        (id) => states.get(id)?.zIndex ?? objectsToLayout.find(o => o.id === id)?.zIndex ?? 0
      ),
      (id) => objectContainers.get(id),
    )
  }
  // Crucial: entity internal sorting must be based on current frame runtime state (set_scene_structure/set_lifecycle modified parentId/childIds)
  const runtimeObjectsToSort = objectsToLayout.map(obj => states.get(obj.id) ?? obj)
  // Recursively sort entity composite internal renderChain
  sharedSortCompositeContainers(runtimeObjectsToSort, objectContainers, compositeRenderTargets,
    (id) => states.get(id)?.zIndex ?? objectsToLayout.find(o => o.id === id)?.zIndex ?? 0,
  )
  return visualCenters
}

function findCompositeRenderTargetChain(
  objectId: string,
  states: Map<string, SceneObject>,
): { id: string, source: PIXI.Container, output: PIXI.Container }[] {
  const chain: { id: string, source: PIXI.Container, output: PIXI.Container }[] = []
  let currentId = states.get(objectId)?.parentId

  while (currentId) {
    const crt = compositeRenderTargets.get(currentId)
    if (crt) {
      chain.push({
        id: currentId,
        source: crt.getSourceContainer(),
        output: crt.getOutputContainer(),
      })
    }
    currentId = states.get(currentId)?.parentId
  }

  return chain
}

function projectGlobalPointThroughCompositeChain(
  objectId: string,
  globalPoint: PIXI.Point,
  states: Map<string, SceneObject>,
): PIXI.Point | null {
  if (!contentViewport) return globalPoint

  let projectedGlobalPoint = globalPoint
  let didProject = false

  for (const crtProjection of findCompositeRenderTargetChain(objectId, states)) {
    const sourceLocalPoint = crtProjection.source.toLocal(projectedGlobalPoint)
    projectedGlobalPoint = crtProjection.output.toGlobal(sourceLocalPoint)
    didProject = true
  }

  if (!didProject) return null

  const scenePoint = contentViewport.toLocal(projectedGlobalPoint)
  return new PIXI.Point(scenePoint.x, scenePoint.y)
}

function projectContainerParentPointToScene(
  objectId: string,
  container: PIXI.Container,
  pointInParent: PIXI.Point,
  states: Map<string, SceneObject>,
): PIXI.Point {
  if (!contentViewport) return pointInParent

  const globalPoint = container.parent.toGlobal(pointInParent)
  const scenePoint = projectGlobalPointThroughCompositeChain(objectId, globalPoint, states)
    ?? contentViewport.toLocal(globalPoint)
  return new PIXI.Point(scenePoint.x, scenePoint.y)
}

function projectContainerLocalPointToScene(
  objectId: string,
  container: PIXI.Container,
  pointInContainer: PIXI.Point,
  states: Map<string, SceneObject>,
): PIXI.Point {
  if (!contentViewport) return pointInContainer

  const globalPoint = container.toGlobal(pointInContainer)
  const scenePoint = projectGlobalPointThroughCompositeChain(objectId, globalPoint, states)
    ?? contentViewport.toLocal(globalPoint)
  return new PIXI.Point(scenePoint.x, scenePoint.y)
}

/**
 * Solution B: Unified first-frame BBox offset locking
 * For follow target of each camera_follow action, compute deviation between BBox center and pivot center on first frame and cache it,
 * subsequent frames use cached offset + real-time pivot position to ensure follow point is stable without jumping.
 * For simple objects offset ≈ 0 (equivalent to original pivot behavior); for composites it corrects visual center offset.
 */
function computeFollowVisualCenters(
  pivotCenters: Map<string, { x: number, y: number }>,
  blockActions: Action[],
  states: Map<string, SceneObject>,
): Map<string, { x: number, y: number }> {
  const result = new Map(pivotCenters)
  if (!contentViewport) return result
  contentViewport.updateTransform()

  const followActions = blockActions.filter(
    (a: Action) => a.target === 'camera' && a.type === 'camera_follow'
  )

  for (const action of followActions) {
    const followTarget = (action.params as { followTarget?: string })?.followTarget
    if (!followTarget) continue

    const pivotCenter = pivotCenters.get(followTarget)
    if (!pivotCenter) continue

    // Check cache: use directly if first-frame offset exists
    if (followBBoxOffsets.has(action.id)) {
      const offset = followBBoxOffsets.get(action.id)!
      result.set(followTarget, {
        x: pivotCenter.x + offset.dx,
        y: pivotCenter.y + offset.dy,
      })
      continue
    }

    // First frame: compute BBox center offset from PIXI container
    const container = objectContainers.get(followTarget)
    if (!container) continue

    const bounds = container.getLocalBounds()
    if (bounds.width <= 0 || bounds.height <= 0) continue

    const bboxLocalCenter = new PIXI.Point(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    )
    const bboxSceneCenter = projectContainerLocalPointToScene(
      followTarget,
      container,
      bboxLocalCenter,
      states,
    )

    const dx = bboxSceneCenter.x - pivotCenter.x
    const dy = bboxSceneCenter.y - pivotCenter.y

    // Cache offset
    followBBoxOffsets.set(action.id, { dx, dy })

    // Apply offset
    result.set(followTarget, {
      x: pivotCenter.x + dx,
      y: pivotCenter.y + dy,
    })
  }

  return result
}

// P0: Delegate to unified renderer
function applyObjectState(
  container: PIXI.Container,
  state: SceneObject,
  objSetup: SceneObject,
  _runtimeStates?: Map<string, SceneObject>
): { x: number, y: number } | null {
  const result = sceneObjectRenderer.applyObjectState(container, state, objSetup, objectStateHost)

  // v20: union child objects are inside container (real PIXI parent-child relationship), transforms propagate automatically, no applyUnionProxyChain needed

  return result
}

function updateCamera(
  currentInfo: BlockPlayInfo,
  blockLocalTime: number,
  centers: Map<string, { x: number, y: number }>,
  frameDeltaMs: number,
) {
  const blockActions = currentInfo.blockActions
  const cameraActions = blockActions.filter((a: Action) => a.target === 'camera')

  for (const action of cameraActions) {
    if (action.type === 'camera_follow') {
      const params = action.params as { followTarget?: string; offsetX?: number; offsetY?: number }
      const followTarget = params?.followTarget
      if (followTarget && centers.has(followTarget)) {
        const targetCenter = centers.get(followTarget)!
        const offsetX = params?.offsetX ?? 0
        const offsetY = params?.offsetY ?? -50
        lastFollowPosition = {
          x: targetCenter.x + offsetX,
          y: targetCenter.y + offsetY,
        }
      }
    }
  }

  const cameraState = evaluateCameraState(
    currentInfo.startSnapshot.camera,
    blockActions,
    blockLocalTime,
    currentInfo.duration,
    currentInfo.slots,
    centers,
    lastFollowPosition,
    frameDeltaMs,
    lastEvaluatedCameraState,
  )
  lastEvaluatedCameraState = { ...cameraState }
  applyCameraTransform(cameraState)
}

function applyCameraTransform(cameraState: RuntimeCameraState) {
  if (!contentViewport) return
  SceneObjectRenderer.applyCameraTransform(contentViewport, cameraState)
}

function updateSubtitle(currentInfo: BlockPlayInfo, localTime: number) {
  currentSubtitle.value = getSubtitleTextAtTime(currentInfo.block, currentInfo.slots, localTime)
}

function applyAnimationControl(currentInfo: BlockPlayInfo, currentTime: number) {
    animationController.processSetAnimActions(
      currentInfo.blockActions,
      currentInfo.slots,
      currentTime,
      currentInfo.duration,
      {
        blockId: currentInfo.block.id,
        ttsTiming: getTTSTimingForBlock(currentInfo.block),
      },
    )
}

/**
 * v11.88: Automatically stop animations at Block end
 * Traverse all set_anim actions of this Block, execute stop on animations with autoStopOnBlockEnd !== false
 */
function applyAutoStopOnBlockEnd(prevBlockInfo: BlockPlayInfo): void {
    animationController.processAutoStopOnBlockEnd(prevBlockInfo.blockActions)
}

function updateAudio(currentInfo: BlockPlayInfo, blockLocalTime: number, states: Map<string, SceneObject>) {
    if (!sceneSetup) return
    const currentAbsTime = currentInfo.startTime + blockLocalTime
    
    for (const objSetup of sceneSetup.objects) {
        if (objSetup.type !== 'audio') continue

        // Check lifecycle: if object has despawned, stop its audio and skip
        const objState = states.get(objSetup.id)
        if (objState?.spawned === false) {
            const instance = audioInstances.get(objSetup.id)
            if (instance?.isPlaying) {
                instance.stop()
                audioInstances.delete(objSetup.id)
                audioInstancePlayTimes.delete(objSetup.id)
                audioStopping.delete(objSetup.id)
            }
            continue
        }

        if (pendingAudioPlays.has(objSetup.id)) {
            // Compute expected current audioState to detect if playTime has switched
            const pendingPlayTime = pendingAudioPlayTimes.get(objSetup.id)
            const peekState = computeAudioState(objSetup, blockPlayInfos.value, currentAbsTime, 0)
            if (peekState.shouldPlay && pendingPlayTime === peekState.playTime) {
                continue  // Same play action, wait for pending to finish
            }
            // playTime switched or no longer needs to play, discard in-flight pending play
            // Note: Cannot increment global audioPlayGeneration here, otherwise in-flight loads of other objects would be killed
            // Use audioInstancePlayTimes for per-object invalidation: new play below writes new playTime,
            // old .then() callback is automatically discarded via capturedPlayTime comparison
            pendingAudioPlays.delete(objSetup.id)
            pendingAudioPlayTimes.delete(objSetup.id)
            audioInstancePlayTimes.delete(objSetup.id)
            // Continue executing logic below
        }
        
        // PA: Compute audio state using computeAudioState pure function
        let instance = audioInstances.get(objSetup.id)
        const audioDurationSec = instance?.duration ?? 0
        const audioState = computeAudioState(
            objSetup,
            blockPlayInfos.value,
            currentAbsTime,
            audioDurationSec,
        )
        
        let { shouldPlay } = audioState
        const { targetVolume, loop, playTime, fadeIn, inFadeOutTail, fadeOutDuration, stopTime } = audioState
        
        if (!isPlaying.value) if (shouldPlay) shouldPlay = false

        // Detect if playTime has switched (new play action effective), if so stop old instance
        if (shouldPlay && instance?.isPlaying) {
            const cachedPlayTime = audioInstancePlayTimes.get(objSetup.id)
            if (cachedPlayTime !== playTime) {
                // Play action corresponding to old instance expired, stop and clear
                instance.stop()
                audioInstances.delete(objSetup.id)
                audioInstancePlayTimes.delete(objSetup.id)
                audioStopping.delete(objSetup.id)
                instance = undefined  // Let logic below take creation branch
            }
        }

        if (shouldPlay) {
            if (!instance?.isPlaying) {
                const sound = soundStore.getSound(objSetup.refId)
                if (!sound?.url) continue
                const blobUrl = getAudioUrl(sound.url)
                if (!blobUrl) continue
                
                const startOffset = (currentAbsTime - playTime) / 1000
                let initialVol = targetVolume
                let initialFadeIn = fadeIn
                if (inFadeOutTail) {
                    const t = (currentAbsTime - stopTime) / 1000
                    const d = fadeOutDuration
                    const progress = Math.min(1, Math.max(0, t / d))
                    initialVol = targetVolume * (1 - progress)
                    initialFadeIn = 0
                }
                
                const currentGeneration = audioPlayGeneration.value
                const capturedPlayTime = playTime  // per-object invalidation token
                pendingAudioPlays.add(objSetup.id)
                pendingAudioPlayTimes.set(objSetup.id, playTime)
                audioInstancePlayTimes.set(objSetup.id, playTime)
                audioKit.play(blobUrl, {
                    volume: initialVol, loop: loop, fadeIn: initialFadeIn, startOffset: startOffset
                }).then(inst => {
                    pendingAudioPlays.delete(objSetup.id)
                    pendingAudioPlayTimes.delete(objSetup.id)

                    // Global invalidation: requests initiated during Seek/Stop are discarded
                    if (currentGeneration !== audioPlayGeneration.value) {
                        inst?.stop()
                        return
                    }

                    // Per-object invalidation: another play action has replaced this request
                    if (audioInstancePlayTimes.get(objSetup.id) !== capturedPlayTime) {
                        inst?.stop()
                        return
                    }

                    if (inst) {
                        audioInstances.set(objSetup.id, inst)
                        if (inFadeOutTail) {
                            const remaining = fadeOutDuration - (currentAbsTime - stopTime) / 1000
                            inst.stop(Math.max(0, remaining))
                            audioStopping.add(objSetup.id)
                        } else {
                            audioStopping.delete(objSetup.id)
                        }
                        if (!isPlaying.value) {
                            inst.stop()
                            audioInstances.delete(objSetup.id)
                            audioInstancePlayTimes.delete(objSetup.id)
                        }
                    }
                }).catch(() => { /* ignore */ })
            } else {
                if (inFadeOutTail) {
                    if (!audioStopping.has(objSetup.id)) {
                        const remaining = fadeOutDuration - (currentAbsTime - stopTime) / 1000
                        instance.stop(Math.max(0, remaining))
                        audioStopping.add(objSetup.id)
                    }
                } else {
                    audioStopping.delete(objSetup.id)
                    instance.setVolume(targetVolume, 0.1)
                }
            }
        } else {
            if (instance?.isPlaying) {
                instance.stop()
                audioInstances.delete(objSetup.id)
                audioInstancePlayTimes.delete(objSetup.id)
                audioStopping.delete(objSetup.id)
            }
        }
    }
}

// preloadAllAssets removed as requested. Resources should be preloaded by parent (ScriptPreviewDialog/ScenePreviewDialog).
// async function preloadAllAssets() {
//    // Empty stub or removed implementation
// }


/**
 * Load and decode audio (Removed, ScenePlayer is not responsible for loading)
 */
// async function loadAndDecodeAudio(path: string) {
//   // 1. Load Blob URL
//   await loadAudioUrl(path)
//   const blobUrl = getAudioUrl(path)
//   
//   if (!blobUrl) {
//     console.warn('[ScenePlayer] Failed to load audio blob:', path)
//     return
//   }
//
//   // 2. WebAudioKit Load
//   await audioKit.load(blobUrl)
// }

/**
 * Update current frame (main loop entry)
 * Follow 5-stage render pipeline:
 * ```mermaid
 * graph TD
 *     A[Start Frame] --> B[Phase 1: Sync Resources]
 *     B --> C[Phase 2: Measure Objects]
 *     C --> D[Phase 3: Evaluate States]
 *     D --> E[Phase 4: Layout Objects]
 *     E --> F[Phase 5: Update Camera]
 *     F --> G[End Frame]
 * ```
 */
function updateFrame(time: number, options: { updateAudio?: boolean } = {}) {
  const shouldUpdateAudio = options.updateAudio !== false
  if (!sceneSetup) {
    throw new Error('[ScenePlayer] updateFrame aborted: sceneSetup is null')
  }
  if (blockPlayInfos.value.length === 0) {
    throw new Error('[ScenePlayer] updateFrame aborted: blockPlayInfos is empty')
  }
  
  // Find currently playing block
  let currentInfo: BlockPlayInfo | null = null
  let blockLocalTime = 0
  
  for (let i = 0; i < blockPlayInfos.value.length; i++) {
    const info = blockPlayInfos.value[i]
    if (!info) continue

    if (time >= info.startTime && time < info.endTime) {
      currentInfo = info
      currentBlockIndex.value = i
      blockLocalTime = time - info.startTime
      break
    } else if (time >= info.endTime && i === blockPlayInfos.value.length - 1) {
      currentInfo = info
      currentBlockIndex.value = i
      blockLocalTime = info.duration
    }
  }
  
  if (!currentInfo) {
    throw new Error(`[ScenePlayer] Failed to find valid block information (Time: ${time})`)
  }
  
  // Detect Block switch
  if (currentBlockIndex.value !== previousBlockIndex) {
    // v11.88: Handle autoStopOnBlockEnd - stop animations from previous Block that need to auto-stop
    if (previousBlockIndex >= 0 && previousBlockIndex < blockPlayInfos.value.length) {
      const prevBlockInfo = blockPlayInfos.value[previousBlockIndex]
      if (prevBlockInfo) {
        applyAutoStopOnBlockEnd(prevBlockInfo)
      }
    }
    // v11.88: Clear animation trigger state on Block switch to ensure animations in new Block trigger normally
    triggeredAnimations.clear()
    followBBoxOffsets.clear()
    previousBlockIndex = currentBlockIndex.value
  }
  
  // Update subtitles
  updateSubtitle(currentInfo, blockLocalTime)
  
  // Phase 1: Resource sync (Completed in loadScene/renderInitialFrame, not repeated in updateFrame)
  // v11.66: Keep consistent with ActionPreviewDialog
  // syncResources()
  
  // Phase 2: Real-time measurement (Moved to initialization phase, no longer executed per-frame, ensures stable position anchors)
  // measureObjects()
  
  // Phase 3: Evaluate state
  const states = evaluateStates(currentInfo, blockLocalTime)
  
  // Phase 4: Layout objects
  // v22: Read renderChain from snapshot
  const pivotCenters = layoutObjects(states, currentInfo.startSnapshot.renderChain)

  // Phase 4.5: Objects that just became visible immediately trigger delayed initial animations,
  // avoiding waiting until subsequent set_anim processing stage to enter playing state.
  animationController.syncDeferredInitialAnimations()

  // Phase 5: Audio update
  if (shouldUpdateAudio) {
    updateAudio(currentInfo, blockLocalTime, states)
  }

  // Phase 6: Animation control (handle set_anim actions)
  applyAnimationControl(currentInfo, blockLocalTime)

  // Phase 7: Update animation Player (v11.60)
  const deltaTime = isPlaying.value
    ? (lastAnimationUpdateTime === null ? 16.67 : Math.min(50, Math.max(0, time - lastAnimationUpdateTime)))
    : 0
  if (isPlaying.value) {
    lastAnimationUpdateTime = time
  }

  objectAnimationPlayers.forEach(player => player.update(deltaTime))

  // Phase 7.5: Manually advance all AnimatedSprite frame indices
  // Replaces PIXI Ticker auto-update to ensure spawn frame plays on the same frame
  advanceAllObjectAnimations(objectContainers, deltaTime, spriteAnimTimeAccumulator)

  // v20: union child objects are inside container, animation transforms propagate automatically, no sharedPropagateUnionAnimations needed

  // P2: Update offscreen render texture for composite own mode (must be after player.update and before renderer.render)
  updateCompositeRenderTargetsInOrder(compositeRenderTargets, [...states.values()])

  // Solution B: Compute stable follow point uniformly via first-frame BBox offset
  const followCenters = computeFollowVisualCenters(pivotCenters, currentInfo.blockActions, states)

  // Phase 8: Camera update
  updateCamera(currentInfo, blockLocalTime, followCenters, deltaTime)

  // Phase 9: Lighting filter
  // updateTransform ensures worldTransform is up to date, toGlobal yields accurate screen coordinates
  if (stage && contentViewport) {
    contentViewport.updateTransform()
    applyLightingFilter(
      [...states.values()],
      stage,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
      lightingFilterCache,
      new PIXI.Rectangle(0, 0, CAMERA_BASE_WIDTH, CAMERA_BASE_HEIGHT),
      (id) => objectContainers.get(id),
      undefined,
      pixiApp?.renderer as PIXI.Renderer | undefined,
      compositeRenderTargets,
    )
  }

  // Clip-Mask Phase 1: Update worldTransform and apply all masks before render
  applyMasksBeforeRender([...states.values()])

  // Phase 10: Manual render
  // After disabling PIXI Ticker auto-rendering, synchronously render at end of updateFrame,
  // ensuring state update and rendering complete in same call stack (consistent with FrameCapture)
  if (pixiApp) {
    pixiApp.renderer.render(pixiApp.stage)
  }
}

function renderCurrentFrameWithoutAudio(): void {
  if (blockPlayInfos.value.length === 0) return

  try {
    updateFrame(currentTime.value, { updateAudio: false })
  } catch (e) {
    console.warn('[ScenePlayer] Initial evaluated frame render failed:', e)
  }
}

/**
 * Stop all audio
 */
function stopAllAudio() {
  // Increment generation to invalidate in-flight BGM/SFX play requests
  audioPlayGeneration.value++

  // Stop all tracked instances
  for (const [_, instance] of audioInstances) {
    try {
      instance.stop()
    } catch (e) {
      console.warn('[ScenePlayer] Failed to stop audio instance:', e)
    }
  }
  audioInstances.clear()
  audioInstancePlayTimes.clear()
  
  // Also clear tracking sets
  pendingAudioPlays.clear()
  pendingAudioPlayTimes.clear()
  audioStopping.clear()
  
  // Stop main block audio
  // Stop main block audio
  trackedAudioInstances.forEach(inst => {
      try { inst.stop() } catch { /* ignore */ }
  })
  trackedAudioInstances.clear()

}

/**
 * Start playback
 */
async function play() {
  if (isPlaying.value) {
    return
  }
  
  // Ensure AudioContext is active
  await audioKit.init()

  if (blockPlayInfos.value.length === 0) {
    return
  }
  
  // If playback already finished, reset
  if (currentTime.value >= totalDuration.value) {
    currentTime.value = 0
  }
  
  isPlaying.value = true
  emit('play-state-change', true)
  lastAnimationUpdateTime = currentTime.value
  
  // First attempt audio playback, start animation timeline after audio is ready
  await playCurrentBlockAudio()
  
  playStartTime = performance.now()
  playStartOffset = currentTime.value
  
  // Start animation loop
  startPlaybackLoop()
}

/**
 * Pause
 */
function pause() {
  if (!isPlaying.value) return
  
  isPlaying.value = false
  emit('play-state-change', false)
  lastAnimationUpdateTime = null
  
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
  
  stopCurrentAudio()
  
  playStartOffset = currentTime.value
}

/**
 * Reset
 */
function reset() {
  isPlaying.value = false
  emit('play-state-change', false)
  currentTime.value = 0
  currentBlockIndex.value = -1
  currentSubtitle.value = ''
  lastAnimationUpdateTime = null
  
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
  
  stopCurrentAudio()
  
  // Stop all audio
  stopAllAudio()
  
  // Do not suspend AudioContext, otherwise subsequent playback will be silent
  // const ctx = audioKit.getContext()
  // if (ctx) {
  //   await ctx.suspend()
  // }

  playStartOffset = 0
  lastFollowPosition = null
  lastEvaluatedCameraState = null
  followBBoxOffsets.clear()
  triggeredAnimations.clear()  // v11.60: Clear animation trigger state on reset
  // v11.66: resetSceneToSetup is now async, use void to avoid blocking
  void resetSceneToSetup()
}

/**
 * Seek time
 */
async function seek(time: number) {
  currentTime.value = time

  // Force pause immediately to stop noise
  // Force pause immediately to stop noise
  trackedAudioInstances.forEach(inst => {
      try { inst.stop() } catch { /* ignore */ }
  })
  trackedAudioInstances.clear()
  
  // Stop all sound effects
  stopAllAudio()
  
  // If playing, resync
  if (isPlaying.value) {
    playStartTime = performance.now()
    playStartOffset = currentTime.value
    lastAnimationUpdateTime = currentTime.value
    // Replay audio for current Block
    await playCurrentBlockAudio()
  } else {
    // If paused, update visual only
    try {
        updateFrame(time)
    } catch(e) {
        console.warn('[ScenePlayer] Seek update failed:', e)
    }
  }
}

/**
 * Animation playback loop
 */
function startPlaybackLoop() {
  let lastBlockIndex = -1
  
  function loop() {
    if (!isPlaying.value) {
      return
    }
    
    const elapsed = performance.now() - playStartTime
    const newTime = playStartOffset + elapsed
    
    if (newTime >= totalDuration.value) {
      currentTime.value = totalDuration.value
      isPlaying.value = false
      emit('play-state-change', false)
      lastAnimationUpdateTime = null

      try {
        updateFrame(totalDuration.value, { updateAudio: false })
      } catch (e) {
        console.warn('[ScenePlayer] Final frame render failed:', e)
      }

      currentSubtitle.value = ''
      
      if (trackedAudioInstances.size > 0) {
        trackedAudioInstances.forEach(inst => {
             try { inst.stop() } catch { /* ignore */ }
        })
        trackedAudioInstances.clear()
      }

      emit('playback-finished')
      return
    }
    
    currentTime.value = newTime
    emit('progress', currentTime.value, totalDuration.value)
    
    // Check if switched to a new block
    const currentInfo = blockPlayInfos.value.find(
      i => newTime >= i.startTime && newTime < i.endTime
    )
    if (currentInfo) {
      const newBlockIndex = blockPlayInfos.value.indexOf(currentInfo)
      if (newBlockIndex !== lastBlockIndex) {
        lastBlockIndex = newBlockIndex
        // Switched to new block, play new audio
        void playCurrentBlockAudio()
      }
    }
    
    try {
        updateFrame(newTime)
    } catch (e) {
        console.error(e)
        void pause()
    }
    animationFrame = requestAnimationFrame(() => { void loop() })
  }
  
  animationFrame = requestAnimationFrame(() => { void loop() })
}

/**
 * Play current block audio
 */
async function playCurrentBlockAudio() {
  audioPlayRequestId.value++
  const currentRequestId = audioPlayRequestId.value

  stopCurrentAudio()
  
  if (currentRequestId !== audioPlayRequestId.value) return

  const info = blockPlayInfos.value.find(
    i => currentTime.value >= i.startTime && currentTime.value < i.endTime
  )
  
  if (!info?.audioUrl) {
    return
  }

  const infoIndex = blockPlayInfos.value.indexOf(info)
  
  try {
    const audioUrl = await resolvePlayableAudioUrl(info.audioUrl)
    if (!audioUrl) {
      console.warn('[ScenePlayer] Unable to resolve audio path:', info.audioUrl)
      return
    }

    if (currentRequestId !== audioPlayRequestId.value) return

    // Play with AudioKit
    const localTime = currentTime.value - info.startTime
    const startOffset = Math.max(0, localTime / 1000)
    
    const audioBuffer = await audioKit.load(audioUrl)
    
    if (currentRequestId !== audioPlayRequestId.value) return

    const actualDurationMs = Math.round((audioBuffer?.duration ?? 0) * 1000)
    if (infoIndex >= 0 && actualDurationMs > 0 && actualDurationMs !== info.duration) {
      updateBlockTimelineFrom(infoIndex, Math.max(info.duration, actualDurationMs))
    }
    
    const instance = await audioKit.play(audioUrl, {
        volume: getBlockPlaybackVolume(info.block),
        loop: false,
        startOffset: startOffset
    })
    
    if (instance) {
        trackedAudioInstances.add(instance)
        // Listen for end to clean up? AudioKit instance stops automatically.
        // But we need to track it so seek/pause can stop it.
    }

  } catch (err: unknown) {
    if ((err as Error).name !== 'AbortError') {
      console.warn('[ScenePlayer] Audio playback failed:', err)
    }
  }
}

/**
 * Safely stop current audio
 */
function stopCurrentAudio() {
  trackedAudioInstances.forEach(inst => {
      try { inst.stop() } catch { /* ignore */ }
  })
  trackedAudioInstances.clear()
}

/**
 * Reset scene to Setup state
 * v11.66: Changed to async, matching renderInitialFrame pipeline
 */
async function resetSceneToSetup() {
  if (!sceneSetup) return

  // v11.60: Reset animation trigger state
  triggeredAnimations.clear()
  objectDimensions.clear()

  // v11.66: await syncResources to ensure characters are fully initialized
  await syncResources()
  

  
  // Apply initial animation state (before measurement)
  applyInitialAnimationStates()
  
  // P1: Replay cross-block animations in blockId mode
  replayCarriedOverAnimations()
  
  // Measure (character state is now determined)
  measureObjects()
  syncObjectBoundsToPlayers()

  // P1: Traverse objects using getActiveObjects
  const objectsToApply = getActiveObjects()
  const states = new Map<string, SceneObject>()

  for (const objSetup of objectsToApply) {
    const getInitialObjectState = (objSetup: SceneObject): SceneObject => buildObjectStateSnapshot(objSetup)
    states.set(objSetup.id, getInitialObjectState(objSetup))
  }

  // Phase 4: Layout objects (identical logic to updateFrame, including parent migration and sorting)
  // v22: Pass scene setup renderChain
  layoutObjects(states, sceneSetup.renderChain)

  applyCameraTransform(getDefaultCameraState())

  // P2: Update offscreen render texture for composite own mode
  updateCompositeRenderTargetsInOrder(compositeRenderTargets, [...states.values()])

  // Clip-Mask Phase 1: Update worldTransform and apply all masks before render
  applyMasksBeforeRender([...states.values()])

  // Manual render (Ticker is disabled)
  if (pixiApp) {
    pixiApp.renderer.render(pixiApp.stage)
  }
}

// Cleanup
function cleanup() {
  isPlaying.value = false
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }

  // P2: Clean up offscreen render targets first (before Player, since Player.destroy restores container hierarchy)
  compositeRenderTargets.forEach(crt => crt.destroy())
  compositeRenderTargets.clear()

  // Clip-Mask Phase 1: Clean up mask render resources (must be before container destruction)
  disposeMaskRendererResources(maskRendererResources)

  // v11.60: Clean up animation Players (they need access to containers to remove filters)
  objectAnimationPlayers.forEach(player => player.destroy())
  objectAnimationPlayers.clear()
  triggeredAnimations.clear()
  followBBoxOffsets.clear()

  // Clean up remaining resources
  if (pixiApp) {
    pixiApp.stop() // Stop ticker before destroy
    pixiApp.destroy(true, { children: true, texture: false, baseTexture: false })
    pixiApp = null
    stage = null
    contentViewport = null
    scaleContainer = null
    blackBackground = null
  }
  stopAllAudio()
  objectContainers.clear()

  if (lightingFilterCache.instance) {
    lightingFilterCache.instance.destroy()
    delete lightingFilterCache.instance
  }
  if (lightingFilterCache.maskRT) {
    lightingFilterCache.maskRT.destroy(true)
    delete lightingFilterCache.maskRT
  }

  lastMeasuredPose.clear()
}

onMounted(() => {
    void initRenderer()
})

onBeforeUnmount(() => {
    cleanup()
})

watch(() => props.sceneId, () => {
    // When switching scenes, only reset state and load new scene without destroying PIXI App
    isPlaying.value = false
    currentTime.value = 0
    currentBlockIndex.value = -1
    currentSubtitle.value = ''
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
    // Async switch
    void loadScene()
})

</script>

<style scoped>
.scene-player {
  width: 100%;
  height: 100%;
  position: relative;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.preview-canvas {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.loading-overlay, .error-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.8);
  color: white;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.subtitle-overlay {
  position: absolute;
  bottom: 5%;
  left: 50%;
  transform: translateX(-50%);
  width: 80%;
  text-align: center;
  pointer-events: none;
}

.subtitle-text {
  background: rgba(0,0,0,0.6);
  color: white;
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 24px;
  display: inline-block;
}

.loading-spinner {
  width: 40px; height: 40px;
  border: 4px solid #333;
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 10px;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
