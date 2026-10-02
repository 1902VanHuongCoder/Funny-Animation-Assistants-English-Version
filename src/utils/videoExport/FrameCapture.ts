import * as PIXI from 'pixi.js'

import { useAssetImage } from '@/composables/useAssetImage'
import { useAssetLoader } from '@/composables/useAssetLoader'
import { AnimationController, type AnimationHost } from '@/core/AnimationController'
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
import { type ObjectStateHost, SceneObjectRenderer } from '@/core/SceneObjectRenderer'
import { advanceAllObjectAnimations } from '@/core/spriteAnimationDriver'
import { computeTextRevealState } from '@/core/TextRevealController'
import type { TextureProvider } from '@/core/TextureProvider'
import { useAnimationStore } from '@/stores/animationStore'
import { useBackgroundStore } from '@/stores/backgroundStore'
import type { Episode } from '@/stores/episodeStore'
// v7.3: effectStore removed
import { useExpressionStore } from '@/stores/expressionStore'
import { useProjectStore } from '@/stores/projectStore'
import { usePropStore } from '@/stores/propStore'
// Phase 4e: ObjectStateSnapshot replaced by SceneObject
import type { CompositeObject, SceneObject, SymbolObject } from '@/types/sceneObject'
import type { Action, BlockPlayInfo, RuntimeSceneSnapshot, RuntimeSlot, SetSceneStructureAction } from '@/types/screenplay'
import {
    evaluateCameraState,
    evaluateObjectState,
    type RuntimeCameraState,
} from '@/utils/actionEvaluator'
import { type ActionType,getHandler } from '@/utils/actionHandlers'
import { isObjectStateAction } from '@/utils/actionHandlers/registry'
import type { ActionHandlerContext, WriteableState } from '@/utils/actionHandlers/types'
import { sortActionsForEvaluation } from '@/utils/actionOrder'
import { collectSceneFontPreloadObjects, ensureFontLoaded, preloadSceneFonts } from '@/utils/fontLoader'
import { rebuildChildIdsFromParentIds } from '@/utils/hierarchyUtils'
import { buildParentOverridesForTime, sortObjectsBySlotActionOrder, sortObjectsForEvaluation } from '@/utils/objectEvaluationOrder'
import { reconcileRenderChain, sortRenderChainByZIndex } from '@/utils/renderChainUtils'
import { prepareBlockPlayInfos as buildBlockPlayInfos } from '@/utils/scenePlaybackPipeline'
import { applyMaskPostPass } from '@/utils/sceneStateCalculator'
import { applySetSceneStructureActionToObjects } from '@/utils/setSceneStructureAction'
import { getSubtitleTextAtTime } from '@/utils/slotUtils'
import { FONT_SIZE_PRESETS } from '@/utils/textStylePresets'
import type { TTSTimingFile } from '@/utils/ttsTiming'

import { CAMERA_BASE_HEIGHT, CAMERA_BASE_WIDTH, CANVAS_HEIGHT, CANVAS_WIDTH, DEFAULT_SUBTITLE_STYLE } from './constants'
import type { SubtitleStyle, VideoExportConfig } from './types'

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
        },
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

// PlayableSprite interface extracted to spriteAnimationDriver shared module

// v11.80: AnimStateParam removed, inline type definitions used

/**
 * Frame capture module
 * Responsible for offscreen rendering and extracting video frames
 */
export class FrameCapture {
    private renderer: PIXI.Renderer | null = null
    private offscreenCanvas: OffscreenCanvas | null = null
    private config: VideoExportConfig
    private episode: Episode

    // Render container hierarchy
    private stage: PIXI.Container | null = null
    private scaleContainer: PIXI.Container | null = null
    private contentViewport: PIXI.Container | null = null
    private sceneStage: PIXI.Container | null = null

    // Stores
    private backgroundStore = useBackgroundStore()
    private propStore = usePropStore()
    // v7.3: effectStore removed
    private expressionStore = useExpressionStore()
    private projectStore = useProjectStore()

    // Asset helper
    private assetImage = useAssetImage()
    private getImageUrl = this.assetImage.getImageUrl
    private assetLoader = useAssetLoader()
    private getTexture = this.assetLoader.getTexture

    // Current scene cache
    private currentSceneIndex = -1
    private objectContainers = new Map<string, PIXI.Container>()

    private objectDimensions = new Map<string, {
        width: number, height: number,
        pivotX?: number, pivotY?: number,
        boundsX?: number, boundsY?: number
    }>()

    // v14.2: Track pose for each character at last bounds measurement
    private lastMeasuredPose = new Map<string, string>()

    // Block playback information (per scene)
    private blockPlayInfos: BlockPlayInfo[] = []
    private ttsTimingCache = new Map<string, TTSTimingFile | null>()
    private pendingTTSTimingLoads = new Map<string, Promise<TTSTimingFile | null>>()

    // camera_follow last follow position
    private lastFollowPosition: { x: number; y: number } | null = null
    private lastEvaluatedCameraState: RuntimeCameraState | null = null

    // Watermark
    private watermarkSprite: PIXI.Sprite | null = null

    // Subtitles
    private subtitleContainer: PIXI.Container | null = null
    private subtitleBackground: PIXI.Graphics | null = null
    private subtitleText: PIXI.Text | null = null

    // v11.60: Animation Player registry (unified Map, eliminating type-based if/else branches)
    private objectAnimationPlayers = new Map<string, GenericAnimationPlayer>()
    private triggeredAnimations = new Set<string>()


    // P2: Composite own mode offscreen render target
    private compositeRenderTargets = new Map<string, CompositeRenderTarget>()

    // Scheme B: camera_follow first frame BBox offset cache
    private followBBoxOffsets = new Map<string, { dx: number, dy: number }>()

    // v25: Lighting filter cache
    private lightingFilterCache: LightingFilterCache = {}

    // Clip-Mask Phase 1: Mask renderer resources (FrameCapture path)
    private maskRendererResources: MaskRendererResources = createMaskRendererResources()

    // RenderHost bridge (shared render pipeline dependency injection)
    private renderHost: RenderHost

    private animationStore = useAnimationStore()
    private lastFrameTimeInScene = 0  // Used to compute deltaTime
    // v11.82: Frame animation time accumulator (advances based on deltaTime, avoiding absolute time precision issues)
    private spriteAnimTimeAccumulator = new WeakMap<PIXI.AnimatedSprite, number>()
    // v11.88: Track previous Block for autoStopOnBlockEnd handling
    private previousBlockInfo: BlockPlayInfo | null = null

    // v14.x: Unified renderer instance
    private sceneObjectRenderer: SceneObjectRenderer

    // Export path temporarily overrides PIXI resolution settings, restored on destroy to avoid affecting editor/preview
    private previousPixiResolution = PIXI.settings.RESOLUTION
    private didOverridePixiSettings = false

    // PA: AnimationController integration
    private currentScene: Episode['scenes'][number] | null = null
    private animationController: AnimationController

    // P0: ObjectStateHost — bridge local cache to unified renderer
    private objectStateHost: ObjectStateHost

    private createAnimationHost(): AnimationHost {
        return {
            getAnimationPlayer: (id: string) => this.objectAnimationPlayers.get(id) ?? null,
            getObjectContainer: (id: string) => this.objectContainers.get(id) ?? null,
            getSceneObjects: () => this.currentScene?.setup.objects ?? [],
            getAnimationDefinition: (objectId: string, animName: string) => {
                // v16: Find from SceneObject.animations (hydration guarantees populated)
                const obj = this.currentScene?.setup.objects.find(o => o.id === objectId)
                if (!obj) return null
                return this.animationStore.getObjectAnimationByName(obj, animName) ?? null
            },
            onAnimationTriggered: (objectId: string, animName: string, cmd: 'play' | 'stop') => {
                this.handleAnimationTriggered(objectId, animName, cmd)
            },
        }
    }

    /**
     * Uniformly get GenericAnimationPlayer for an object
     * Eliminates type-based if/else dispatch chain
     */
    private getAnimationPlayerForObject(objId: string): GenericAnimationPlayer | null {
        return this.objectAnimationPlayers.get(objId) ?? null
    }

    constructor(episode: Episode, config: VideoExportConfig) {
        this.episode = episode
        this.config = config

        // v14.x: Initialize unified renderer
        const textureProvider: TextureProvider = {
            getTexture: (url: string) => {
                const tex = this.getTexture(url)
                if (tex !== PIXI.Texture.EMPTY) return tex
                const fullUrl = this.getImageUrl(url)
                return fullUrl ? PIXI.Texture.from(fullUrl) : PIXI.Texture.EMPTY
            },
            getImageUrl: (url: string) => this.getImageUrl(url)
        }
        this.sceneObjectRenderer = new SceneObjectRenderer(
            textureProvider,
            {
                propStore: this.propStore,
                backgroundStore: this.backgroundStore,
                expressionStore: this.expressionStore
            }
        )

        // PA: Initialize AnimationController
        this.animationController = new AnimationController(this.createAnimationHost(), this.triggeredAnimations)

        // P0: Construct ObjectStateHost
        this.objectStateHost = {
            getObjectDimensions: (id: string) => this.objectDimensions.get(id),
            setObjectDimensions: (id: string, dims: { width: number; height: number }) => this.objectDimensions.set(id, dims),
        }

        // Construct RenderHost (shared render pipeline dependency injection)
        this.renderHost = {
            sceneObjectRenderer: this.sceneObjectRenderer,
            objectContainers: this.objectContainers,
            objectAnimationPlayers: this.objectAnimationPlayers,

            compositeRenderTargets: this.compositeRenderTargets,
            getRenderer: () => this.renderer ?? undefined,
            getSceneObjects: () => this.currentScene?.setup.objects ?? [],
        }
    }

    /**
     * Initialize
     */
    async initialize(): Promise<void> {

        if (typeof OffscreenCanvas === 'undefined') {
            throw new Error('Current browser does not support OffscreenCanvas')
        }

        // Scheme D: Render directly to target video resolution, avoiding 1456x819x2 -> 1920x1080
        // non-integer downsampling introducing sampling phase flicker. Do not enable ROUND_PIXELS:
        // When camera/character animation has subpixel movement, pixel rounding turns smooth motion into 1px stepping.
        const exportPixelRatio = this.config.resolution.width / CAMERA_BASE_WIDTH

        this.previousPixiResolution = PIXI.settings.RESOLUTION
        this.didOverridePixiSettings = true
        PIXI.settings.RESOLUTION = exportPixelRatio

        this.offscreenCanvas = new OffscreenCanvas(
            this.config.resolution.width,
            this.config.resolution.height
        )

        this.renderer = new PIXI.Renderer({
            view: this.offscreenCanvas as unknown as HTMLCanvasElement,
            width: CAMERA_BASE_WIDTH,
            height: CAMERA_BASE_HEIGHT,
            resolution: exportPixelRatio,
            backgroundColor: 0x000000,
            backgroundAlpha: 1,
            antialias: true,
            preserveDrawingBuffer: false,
            autoDensity: false,
            powerPreference: 'high-performance',
            // Disable event system, as OffscreenCanvas does not need to handle DOM events
            // This prevents "lastObjectRendered" error after renderer is destroyed
            eventMode: 'none',
            eventFeatures: {
                move: false,
                globalMove: false,
                click: false,
                wheel: false,
            },
        })

        // Manually disable event system to ensure no DOM event listeners are registered
        const rendererWithEvents = this.renderer as unknown as { events: { destroy: () => void } }
        if (rendererWithEvents.events) {
            try {
                rendererWithEvents.events.destroy()
            } catch (e) {
                // Ignore
            }
        }

        this.stage = new PIXI.Container()
        this.stage.name = 'frame-capture-root-stage'
        this.stage.sortableChildren = true

        // resolution already handles pixel density scaling, scaleContainer no longer needs extra scaling
        this.scaleContainer = new PIXI.Container()
        this.scaleContainer.name = 'frame-capture-scale-container'
        this.scaleContainer.scale.set(1, 1)

        this.contentViewport = new PIXI.Container()
        this.contentViewport.sortableChildren = true

        this.scaleContainer.addChild(this.contentViewport)
        this.stage.addChild(this.scaleContainer)

        // Only load when watermark is explicitly enabled
        if (this.config.showWatermark === true) {
            await this.loadWatermark()
        }

        if (this.config.showSubtitles === true) {
            await ensureFontLoaded(this.getSubtitleStyle().fontFamily, this.collectSubtitleFontSample())
            this.createSubtitleOverlay()
        }
    }

    private collectSubtitleFontSample(): string {
        const samples: string[] = []
        for (const scene of this.episode.scenes) {
            for (const block of scene.script ?? []) {
                if (block.type === 'dialogue' || block.type === 'narration') {
                    samples.push(block.text ?? '')
                }
            }
        }

        const sample = samples.join('\n').replace(/#/g, '')
        return sample.trim() || 'Sample Subtitle'
    }

    /**
     * Render frame for specified scene and timestamp
     * v11.81: Converted to async to ensure scene is fully loaded
     */
    async renderFrame(sceneIndex: number, timeInScene: number, absoluteTime: number): Promise<VideoFrame> {
        if (!this.renderer || !this.offscreenCanvas || !this.stage || !this.contentViewport) {
            throw new Error('FrameCapture not initialized')
        }

        const scene = this.episode.scenes[sceneIndex]
        if (!scene) {
            throw new Error(`Scene ${sceneIndex} not found`)
        }

        // If switching scene, recreate objects
        if (sceneIndex !== this.currentSceneIndex) {
            // v11.81: await loadScene to ensure scene is fully loaded
            await this.loadScene(scene)
            this.prepareBlockPlayInfos(scene)
            await this.preloadTTSTimingsForBlockInfos()
            this.currentSceneIndex = sceneIndex
            // PA: Update currentScene for AnimationController use
            this.currentScene = scene
            // v11.60: Apply initial animation states
            this.applyInitialAnimationStates(scene)
            this.lastFrameTimeInScene = 0
        }

        // Find Block corresponding to current time
        const currentInfo = this.getBlockAtTime(timeInScene)
        let blockLocalTime = 0
        let currentPivotCenters: Map<string, { x: number; y: number }> | null = null
        // Phase 2 Fix: Hoist states to outer scope so lighting filter uses Action-evaluated object states
        let evaluatedStates: Map<string, SceneObject> | null = null

        if (currentInfo) {
            // v11.88: Detect Block switch, handle autoStopOnBlockEnd
            if (this.previousBlockInfo && this.previousBlockInfo !== currentInfo) {
                this.applyAutoStopOnBlockEnd(this.previousBlockInfo)
                // v11.88: Clear animation trigger state on Block switch to ensure animations trigger properly in new Block
                this.triggeredAnimations.clear()
                this.followBBoxOffsets.clear()
            }
            this.previousBlockInfo = currentInfo

            blockLocalTime = timeInScene - currentInfo.startTime

            // 1. Evaluate all object states
            const states = this.evaluateStates(currentInfo, blockLocalTime)
            evaluatedStates = states
            currentPivotCenters = this.applyStates(states, scene, currentInfo.startSnapshot.renderChain)

            // 1.5: When object just becomes visible, immediately trigger delayed initial animations,
            // reducing stillness on the spawn frame.
            this.animationController.syncDeferredInitialAnimations()

            // 2. Update animation state (handle set_anim)
            this.updateAnimationStates(currentInfo, blockLocalTime)
        } else {
            // No Block, use initial state
            this.applyInitialCameraTransform(scene)
            this.lastEvaluatedCameraState = null
        }

        // 5. Compute deltaTime (must precede frame animation update)
        const deltaTime = timeInScene - this.lastFrameTimeInScene
        this.lastFrameTimeInScene = timeInScene

        // 6. Update all frame animations (advance AnimatedSprite based on deltaTime)
        // v11.82: Use deltaTime accumulation mechanism, avoiding absolute time precision issues and frame skips
        this.updateAnimations(Math.max(0, deltaTime))

        // 7. Update animation Player (manually advance deltaTime)
        this.objectAnimationPlayers.forEach(player => player.update(Math.max(0, deltaTime)))

        // v20: union child objects are inside container, transforms propagate automatically, no sharedPropagateUnionAnimations needed

        // P2: Update offscreen render texture for composite own mode (must occur after player.update and before renderer.render)
        updateCompositeRenderTargetsInOrder(
            this.compositeRenderTargets,
            evaluatedStates ? [...evaluatedStates.values()] : (this.currentScene?.setup?.objects ?? [])
        )

        if (currentInfo && currentPivotCenters) {
            // Scheme B: Compute stable follow point via first-frame BBox offset
            const followCenters = this.computeFollowVisualCenters(currentPivotCenters, currentInfo.blockActions, evaluatedStates)
            this.updateCamera(currentInfo, blockLocalTime, followCenters, Math.max(0, deltaTime))
        }

        this.updateSubtitleOverlay(currentInfo, blockLocalTime)

        // 6. Show watermark
        if (this.watermarkSprite) {
            this.watermarkSprite.visible = true
        }

        // v25.3: Lighting filter — get precise screen coordinates via updateTransform + toGlobal
        // Phase 2 Fix: Use evaluatedStates (including lighting changes from Actions) + absoluteTime (video timeline)
        if (this.sceneStage && this.contentViewport && scene) {
            this.contentViewport.updateTransform()
            const lightObjects = evaluatedStates
                ? [...evaluatedStates.values()]
                : scene.setup.objects
            applyLightingFilter(
                lightObjects,
                this.sceneStage,
                CANVAS_WIDTH,
                CANVAS_HEIGHT,
                this.lightingFilterCache,
                new PIXI.Rectangle(0, 0, CAMERA_BASE_WIDTH, CAMERA_BASE_HEIGHT),
                (id) => this.objectContainers.get(id),
                absoluteTime,
                this.renderer ?? undefined,
                this.compositeRenderTargets,
            )
        }

        // Clip-Mask Phase 1: Update worldTransform and apply all masks before render
        if (this.stage && scene) {
            // Root stage has no parent, direct updateTransform causes NPE, refresh children individually.
            for (const child of this.stage.children) {
                child.updateTransform()
            }
            const maskStateObjects = evaluatedStates ? [...evaluatedStates.values()] : scene.setup.objects
            applyAllMasks(maskStateObjects, (id) => this.objectContainers.get(id), this.maskRendererResources)
        }

        // Render
        this.renderer.render(this.stage)

        // Hide watermark (avoid affecting next frame)
        if (this.watermarkSprite) {
            this.watermarkSprite.visible = false
        }

        const timestamp = (absoluteTime / 1000) * 1_000_000
        const frameDuration = (1 / this.config.frameRate) * 1_000_000

        try {
            return new VideoFrame(this.offscreenCanvas, {
                timestamp: timestamp,
                duration: frameDuration,
            })
        } catch (e) {
            try {
                const bitmap = await createImageBitmap(this.offscreenCanvas)
                const videoFrame = new VideoFrame(bitmap, {
                    timestamp: timestamp,
                    duration: frameDuration,
                })
                bitmap.close()
                return videoFrame
            } catch (fallbackError) {
                console.error('[FrameCapture] Failed to create VideoFrame:', fallbackError)
                throw fallbackError
            }
        }
    }

    /**
     * Prepare Block playback information
     */
    private prepareBlockPlayInfos(scene: Episode['scenes'][number]): void {
        this.ttsTimingCache.clear()
        this.pendingTTSTimingLoads.clear()
        const initialSnapshot: RuntimeSceneSnapshot = {
            objects: scene.setup.objects.map(obj => cloneSceneObject(obj)),
            renderChain: reconcileRenderChain(scene.setup.renderChain ? [...scene.setup.renderChain] : [], scene.setup.objects),
            camera: {
                x: scene.setup.camera.x ?? CANVAS_WIDTH / 2,
                y: scene.setup.camera.y ?? CANVAS_HEIGHT / 2,
                zoom: scene.setup.camera.zoom ?? 1,
                shakeOffsetX: 0,
                shakeOffsetY: 0,
            },
        }

        this.blockPlayInfos = buildBlockPlayInfos(initialSnapshot, scene.script ?? [], scene, {
            getDuration: (block) => {
                if (block.type === 'action') return block.duration ?? 0
                return block.ttsConfig?.duration ?? 0
            },
        })
    }

    private async preloadTTSTimingsForBlockInfos(): Promise<void> {
        const audioPaths = new Set<string>()
        for (const info of this.blockPlayInfos) {
            const audioPath = this.getBlockTTSAudioPath(info.block)
            if (audioPath) audioPaths.add(audioPath)
        }
        await Promise.all([...audioPaths].map(audioPath => this.loadTTSTimingForAudioPath(audioPath)))
    }

    private getBlockTTSAudioPath(block: BlockPlayInfo['block']): string | undefined {
        if (block.type === 'action') return undefined
        const config = block.ttsConfig
        if (!config) return undefined
        if (config.timingAudioPath) return config.timingAudioPath

        const audioPath = config.audioPath
        if (!audioPath || audioPath.startsWith('blob:') || audioPath.startsWith('data:')) {
            return undefined
        }
        return audioPath
    }

    private getTTSTimingForBlock(block: BlockPlayInfo['block']): TTSTimingFile | null | undefined {
        const audioPath = this.getBlockTTSAudioPath(block)
        if (!audioPath) return null
        if (this.ttsTimingCache.has(audioPath)) return this.ttsTimingCache.get(audioPath) ?? null
        void this.loadTTSTimingForAudioPath(audioPath)
        return undefined
    }

    private async loadTTSTimingForAudioPath(audioPath: string): Promise<TTSTimingFile | null> {
        if (this.ttsTimingCache.has(audioPath)) return this.ttsTimingCache.get(audioPath) ?? null

        const pending = this.pendingTTSTimingLoads.get(audioPath)
        if (pending) return pending

        const promise = this.projectStore.loadTTSTiming(audioPath)
            .then(timing => {
                this.ttsTimingCache.set(audioPath, timing)
                return timing
            })
            .catch(error => {
                console.warn('[FrameCapture] Failed to load TTS timing, falling back to continuous playback:', audioPath, error)
                this.ttsTimingCache.set(audioPath, null)
                return null
            })
            .finally(() => {
                this.pendingTTSTimingLoads.delete(audioPath)
            })

        this.pendingTTSTimingLoads.set(audioPath, promise)
        return promise
    }

    /**
     * Get Block corresponding to current time
     */
    private getBlockAtTime(timeInScene: number): BlockPlayInfo | null {
        for (const info of this.blockPlayInfos) {
            if (timeInScene >= info.startTime && timeInScene < info.endTime) {
                return info
            }
        }
        // If out of range, return last
        if (this.blockPlayInfos.length > 0) {
            const lastInfo = this.blockPlayInfos[this.blockPlayInfos.length - 1]
            if (lastInfo && timeInScene >= lastInfo.endTime) {
                return lastInfo
            }
        }
        return this.blockPlayInfos[0] ?? null
    }

    /**
     * Evaluate all object states
     */
    private evaluateStates(
        currentInfo: BlockPlayInfo,
        blockLocalTime: number,
    ): Map<string, SceneObject> {
        const objectIndexMap = new Map<string, number>()
        currentInfo.startSnapshot.objects.forEach((obj, idx) => {
            objectIndexMap.set(obj.id, idx)
        })
        const orderedBlockActions = sortActionsForEvaluation(currentInfo.blockActions, objectIndexMap)
        const objectStateActions = orderedBlockActions.filter((action) =>
            action.target !== 'camera' && isObjectStateAction(action)
        )
        const currentSlotIndex = getSlotIndexAtTime(currentInfo.slots, blockLocalTime)

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

        // Clip-Mask Phase 1 — D1.5 mask post-pass (consistent with ScenePlayer.evaluateStates / applyBlockActionsToState)
        if (currentSlotIndex !== -1) {
            const setMaskActionsThroughCurrentSlot = orderedBlockActions.filter(
                a => a.type === 'set_mask' && a.slotIndex <= currentSlotIndex,
            )
            if (setMaskActionsThroughCurrentSlot.length > 0) {
                const prevSnapshot = {
                    ...currentInfo.startSnapshot,
                    objects: currentInfo.startSnapshot.objects,
                }
                const newSnapshot = {
                    ...currentInfo.startSnapshot,
                    objects: [...pointStates.values()],
                }
                applyMaskPostPass(prevSnapshot, newSnapshot, setMaskActionsThroughCurrentSlot)
            }
        }

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
                    const candidate = pointStates.get(id)
                    return candidate ? (candidate as unknown as WriteableState) : undefined
                },
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

        this.rebuildCompositeChildIdsInStateMap(states)
        this.reconcileEntityRenderChainsInStateMap(states)

        // Text reveal actions — inject revealProgress
        for (const [, state] of states) {
            if (state.type !== 'text') continue
            const textState = state as import('@/types/sceneObject').TextObject
            const currentAbsTime = currentInfo.startTime + blockLocalTime
            const revealState = computeTextRevealState(
                this.blockPlayInfos,
                currentInfo,
                state.id,
                currentAbsTime,
            )
            if (!revealState) continue
            textState.content = revealState.content
            ;(state as unknown as WriteableState).revealProgress = revealState.progress
        }

        return states
    }

    private rebuildCompositeChildIdsInStateMap(states: Map<string, SceneObject>): void {
        rebuildChildIdsFromParentIds([...states.values()])
    }

    private reconcileEntityRenderChainsInStateMap(states: Map<string, SceneObject>): void {
        const runtimeObjects = [...states.values()]
        for (const state of runtimeObjects) {
            if (state.type !== 'composite') continue
            const comp = state as CompositeObject
            if ((comp.compositeMode ?? 'entity') !== 'entity') continue
            comp.renderChain = reconcileRenderChain(comp.renderChain ?? [], runtimeObjects, comp.id)
        }
    }

    /**
     * Apply object states and return visual center position
     */
    private applyStates(
        states: Map<string, SceneObject>,
        scene: Episode['scenes'][number],
        renderChain?: readonly string[],
    ): Map<string, { x: number; y: number }> {
        const pivotCenters = new Map<string, { x: number; y: number }>()

        if (this.sceneStage && this.contentViewport) {
            for (const objSetup of scene.setup.objects) {
                const container = this.objectContainers.get(objSetup.id)
                if (!container) continue
                const state = states.get(objSetup.id)
                if (!state) continue

                const newParentId = state.parentId ?? null
                // v20: union/entity attach to container corresponding to parentId
                let targetParent: PIXI.Container
                if (!newParentId) {
                    targetParent = this.sceneStage
                } else {
                    const parentCrt = this.compositeRenderTargets.get(newParentId)
                    targetParent = parentCrt?.getSourceContainer() ?? (this.objectContainers.get(newParentId) ?? this.sceneStage)
                }

                if (container.parent !== targetParent) {
                    if (container.parent) container.parent.removeChild(container)
                    targetParent.addChild(container)
                }
            }
        }

        for (const objSetup of scene.setup.objects) {
            const container = this.objectContainers.get(objSetup.id)
            const state = states.get(objSetup.id)
            if (!container || !state) continue

            const center = this.applyObjectState(container, state, objSetup, states)
            if (center) {
                pivotCenters.set(objSetup.id, center)
            }

            // Light objects: renderable=false hides rendering, retains transform updates
            if (objSetup.type === 'light') {
                container.renderable = false
            }

            // v11.82: Consistent with ScenePlayer.applyStatesAndCacheTransforms
            const player = this.getAnimationPlayerForObject(objSetup.id)
            if (player) player.cacheBaseTransform()
        }

        // v23: Install/update renderChain-driven rendering logic for root-level containers
        // Render order is entirely determined by renderChain + sortRenderChainByZIndex
        const activeRenderChain = reconcileRenderChain(
            renderChain ?? scene.setup.renderChain ?? [],
            [...states.values()],
        )
        if (this.sceneStage && activeRenderChain.length > 0) {
            const capturedChain = activeRenderChain
            const capturedStates = states
            const capturedObjects = scene.setup.objects
            installRootRenderChainRenderer(
                this.sceneStage,
                () => sortRenderChainByZIndex(
                    capturedChain,
                    (id) => capturedStates.get(id)?.zIndex ?? capturedObjects.find(o => o.id === id)?.zIndex ?? 0
                ),
                (id) => this.objectContainers.get(id),
            )
        }
        // Critical: export also sorts entity internal renderChain based on runtime state to match preview behavior
        const runtimeObjectsToSort = scene.setup.objects.map(obj => states.get(obj.id) ?? obj)
        // v22: entity composite internal sort + root-level union sort, pass getZIndex
        sharedSortCompositeContainers(
            runtimeObjectsToSort, this.objectContainers, this.compositeRenderTargets,
            (id) => states.get(id)?.zIndex ?? scene.setup.objects.find(o => o.id === id)?.zIndex ?? 0,
        )

        // P2: Convert child local visual center to scene world coordinates
        if (this.contentViewport) {
            this.contentViewport.updateTransform()
            for (const objSetup of scene.setup.objects) {
                const state = states.get(objSetup.id)
                if (!state?.parentId) continue
                const container = this.objectContainers.get(objSetup.id)
                if (!container) continue
                const localCenter = pivotCenters.get(objSetup.id)
                if (!localCenter) continue
                const scenePoint = this.projectContainerParentPointToScene(
                    objSetup.id,
                    container,
                    new PIXI.Point(localCenter.x, localCenter.y),
                    states,
                )
                pivotCenters.set(objSetup.id, { x: scenePoint.x, y: scenePoint.y })
            }
        }

        return pivotCenters
    }

    private findCompositeRenderTargetChain(
        objectId: string,
        states: Map<string, SceneObject>,
    ): { source: PIXI.Container; output: PIXI.Container }[] {
        const chain: { source: PIXI.Container; output: PIXI.Container }[] = []
        let currentId = states.get(objectId)?.parentId

        while (currentId) {
            const crt = this.compositeRenderTargets.get(currentId)
            if (crt) {
                chain.push({
                    source: crt.getSourceContainer(),
                    output: crt.getOutputContainer(),
                })
            }
            currentId = states.get(currentId)?.parentId
        }

        return chain
    }

    private projectGlobalPointThroughCompositeChain(
        objectId: string,
        globalPoint: PIXI.Point,
        states: Map<string, SceneObject>,
    ): PIXI.Point {
        if (!this.contentViewport) return globalPoint

        let projectedGlobalPoint = globalPoint
        for (const crtProjection of this.findCompositeRenderTargetChain(objectId, states)) {
            const sourceLocalPoint = crtProjection.source.toLocal(projectedGlobalPoint)
            projectedGlobalPoint = crtProjection.output.toGlobal(sourceLocalPoint)
        }

        return this.contentViewport.toLocal(projectedGlobalPoint)
    }

    private projectContainerParentPointToScene(
        objectId: string,
        container: PIXI.Container,
        pointInParent: PIXI.Point,
        states: Map<string, SceneObject>,
    ): PIXI.Point {
        if (!this.contentViewport) return pointInParent

        const globalPoint = container.parent.toGlobal(pointInParent)
        if (this.findCompositeRenderTargetChain(objectId, states).length > 0) {
            return this.projectGlobalPointThroughCompositeChain(objectId, globalPoint, states)
        }

        return this.contentViewport.toLocal(globalPoint)
    }

    private projectContainerLocalPointToScene(
        objectId: string,
        container: PIXI.Container,
        pointInContainer: PIXI.Point,
        states: Map<string, SceneObject>,
    ): PIXI.Point {
        if (!this.contentViewport) return pointInContainer

        const globalPoint = container.toGlobal(pointInContainer)
        if (this.findCompositeRenderTargetChain(objectId, states).length > 0) {
            return this.projectGlobalPointThroughCompositeChain(objectId, globalPoint, states)
        }

        return this.contentViewport.toLocal(globalPoint)
    }

    /**
     * Apply single object state
     * P0: Delegate to unified renderer
     */
    private applyObjectState(
        container: PIXI.Container,
        state: SceneObject,
        objSetup: SceneObject,
        _runtimeStates?: Map<string, SceneObject>
    ): { x: number; y: number } | null {
        const result = this.sceneObjectRenderer.applyObjectState(container, state, objSetup, this.objectStateHost)

        // v20: union children are inside container (real PIXI hierarchy), transforms propagate automatically, no applyUnionProxyChain needed

        return result
    }

    /**
     * Scheme B: Unified first-frame BBox offset lock
     */
    private computeFollowVisualCenters(
        pivotCenters: Map<string, { x: number; y: number }>,
        blockActions: Action[],
        states: Map<string, SceneObject> | null,
    ): Map<string, { x: number; y: number }> {
        const result = new Map(pivotCenters)
        if (!this.contentViewport) return result
        this.contentViewport.updateTransform()

        const followActions = blockActions.filter(
            (a: Action) => a.target === 'camera' && a.type === 'camera_follow'
        )

        for (const action of followActions) {
            const followTarget = (action.params as { followTarget?: string })?.followTarget
            if (!followTarget) continue

            const pivotCenter = pivotCenters.get(followTarget)
            if (!pivotCenter) continue

            // Check cache
            if (this.followBBoxOffsets.has(action.id)) {
                const offset = this.followBBoxOffsets.get(action.id)!
                result.set(followTarget, {
                    x: pivotCenter.x + offset.dx,
                    y: pivotCenter.y + offset.dy,
                })
                continue
            }

            // First frame: compute BBox center offset from PIXI container
            const container = this.objectContainers.get(followTarget)
            if (!container) continue

            const bounds = container.getLocalBounds()
            if (bounds.width <= 0 || bounds.height <= 0) continue

            const bboxLocalCenter = new PIXI.Point(
                bounds.x + bounds.width / 2,
                bounds.y + bounds.height / 2,
            )
            const bboxSceneCenter = states
                ? this.projectContainerLocalPointToScene(followTarget, container, bboxLocalCenter, states)
                : this.contentViewport.toLocal(container.toGlobal(bboxLocalCenter))

            const dx = bboxSceneCenter.x - pivotCenter.x
            const dy = bboxSceneCenter.y - pivotCenter.y

            this.followBBoxOffsets.set(action.id, { dx, dy })

            result.set(followTarget, {
                x: pivotCenter.x + dx,
                y: pivotCenter.y + dy,
            })
        }

        return result
    }

    /**
     * Update camera
     */
    private updateCamera(
        currentInfo: BlockPlayInfo,
        blockLocalTime: number,
        centers: Map<string, { x: number; y: number }>,
        frameDeltaMs: number,
    ): void {
        // Handle camera_follow
        const cameraActions = currentInfo.blockActions.filter((a: Action) => a.target === 'camera')

        // Traverse all camera_follow actions, update lastFollowPosition
        for (const action of cameraActions) {
            if (action.type === 'camera_follow') {
                const followTarget = action.params?.followTarget
                if (followTarget && centers.has(followTarget)) {
                    const targetCenter = centers.get(followTarget)!
                    const offsetX = action.params?.offsetX ?? 0
                    const offsetY = action.params?.offsetY ?? -50
                    this.lastFollowPosition = {
                        x: targetCenter.x + offsetX,
                        y: targetCenter.y + offsetY,
                    }
                }
            }
        }

        const cameraState = evaluateCameraState(
            currentInfo.startSnapshot.camera,
            currentInfo.blockActions,
            blockLocalTime,
            currentInfo.duration,
            currentInfo.slots,
            centers,
            this.lastFollowPosition,
            frameDeltaMs,
            this.lastEvaluatedCameraState,
        )

        this.lastEvaluatedCameraState = { ...cameraState }
        this.applyCameraTransform(cameraState)
    }

    /**
     * Apply camera transform — P0 delegated to unified renderer
     */
    private applyCameraTransform(cameraState: RuntimeCameraState): void {
        if (!this.contentViewport) return
        SceneObjectRenderer.applyCameraTransform(this.contentViewport, cameraState)
    }

    /**
     * Apply initial camera transform
     */
    private applyInitialCameraTransform(scene: Episode['scenes'][number]): void {
        if (!this.contentViewport) return

        const camera = scene.setup.camera
        this.contentViewport.position.set(
            -camera.x + (CAMERA_BASE_WIDTH / 2),
            -camera.y + (CAMERA_BASE_HEIGHT / 2)
        )
        this.contentViewport.scale.set(camera.zoom, camera.zoom)
    }

    /**
     * Load scene objects
     * v11.81: Converted to async to ensure character fully initialized
     */
    private async loadScene(scene: Episode['scenes'][number]): Promise<void> {
        if (!this.contentViewport) return

        this.clearScene()

        this.sceneStage = new PIXI.Container()
        this.sceneStage.name = 'frame-capture-scene-stage'
        this.sceneStage.sortableChildren = true
        this.contentViewport.addChild(this.sceneStage)

        // v19: Prioritize renderChain sort, fallback to zIndex
        const objects = scene.setup.objects

        // Text PRD Phase 0: Preload setup fonts and Action Mode set_text font switching
        // Block export to ensure fonts are available before rendering (consistent with ScenePlayer.syncResources)
        await preloadSceneFonts(collectSceneFontPreloadObjects(objects, scene.script ?? []))

        // v16: animations persisted, no longer requires runtime hydration

        for (const obj of objects) {
            try {
                await sharedRenderObject(obj, this.sceneStage, this.renderHost)
            } catch (e) {
                console.error(`[FrameCapture] Failed to render object: ${obj.type} ${obj.id}`, e)
            }
        }

        // v11.81: Measure after all objects created (consistent with ScenePlayer.measureObjects)
        this.measureObjects(scene)
        sharedSyncObjectBoundsToPlayers(this.objectDimensions, this.objectAnimationPlayers)

        const initialStates = new Map<string, SceneObject>()
        for (const objSetup of scene.setup.objects) {
            initialStates.set(objSetup.id, { ...objSetup })
        }
        this.applyStates(initialStates, scene, scene.setup.renderChain)
    }

    /**
     * Measure object dimensions — P0 delegated to unified renderer
     */
    private measureObjects(scene: Episode['scenes'][number]): void {
        this.sceneObjectRenderer.measureObjectBounds(
            scene.setup.objects,
            this.objectContainers,
            this.objectStateHost
        )
    }

    /**
     * Load watermark
     */
    private async loadWatermark(): Promise<void> {
        try {
            const watermarkUrl = '/watermark.svg'
            const img = new Image()
            img.crossOrigin = 'anonymous'

            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve()
                img.onerror = (e) => reject(new Error(`Failed to load watermark image${typeof e === 'string' ? ': ' + e : ''}`))
                img.src = watermarkUrl
            })

            const texture = PIXI.Texture.from(img)
            this.watermarkSprite = new PIXI.Sprite(texture)

            const padding = 15
            // Watermark size based on output scale ratio (not internal supersampling pixelRatio)
            const outputScale = this.config.resolution.width / CAMERA_BASE_WIDTH
            const watermarkWidth = 480 / outputScale
            const watermarkHeight = 96 / outputScale
            const scale = watermarkWidth / img.width
            this.watermarkSprite.scale.set(scale)
            this.watermarkSprite.x = CAMERA_BASE_WIDTH - watermarkWidth - padding
            this.watermarkSprite.y = CAMERA_BASE_HEIGHT - watermarkHeight - padding
            this.watermarkSprite.visible = false
            this.watermarkSprite.zIndex = 10000
            this.stage!.addChild(this.watermarkSprite)
        } catch (error) {
            console.warn('[FrameCapture] Watermark load failed, continuing export without watermark:', error)
            this.watermarkSprite = null
        }
    }

    /**
     * Create export subtitle overlay.
     * Coordinates use CAMERA_BASE_* logical dimensions, mapped to actual video pixels by renderer resolution.
     */
    private createSubtitleOverlay(): void {
        if (!this.stage) return

        const style = this.getSubtitleStyle()
        const paddingX = 16
        const wordWrapWidth = CAMERA_BASE_WIDTH * (style.maxWidthPercent / 100) - paddingX * 2

        const container = new PIXI.Container()
        container.name = 'frame-capture-subtitle-overlay'
        container.visible = false
        container.zIndex = 9000

        const background = new PIXI.Graphics()
        const text = new PIXI.Text('', new PIXI.TextStyle({
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fill: style.textColor,
            align: 'center',
            wordWrap: true,
            wordWrapWidth: Math.max(120, wordWrapWidth),
            lineHeight: Math.round(style.fontSize * 1.33),
        }))

        container.addChild(background)
        container.addChild(text)
        this.stage.addChild(container)

        this.subtitleContainer = container
        this.subtitleBackground = background
        this.subtitleText = text
    }

    private updateSubtitleOverlay(currentInfo: BlockPlayInfo | null, blockLocalTime: number): void {
        if (
            this.config.showSubtitles !== true
            || !this.subtitleContainer
            || !this.subtitleBackground
            || !this.subtitleText
        ) {
            return
        }

        const subtitle = currentInfo
            ? getSubtitleTextAtTime(currentInfo.block, currentInfo.slots, blockLocalTime)
            : ''

        if (!subtitle) {
            this.subtitleContainer.visible = false
            return
        }

        const style = this.getSubtitleStyle()
        const paddingX = 16
        const paddingY = 8
        const radius = 4

        this.subtitleText.text = subtitle
        this.subtitleText.position.set(paddingX, paddingY)

        const boxWidth = this.subtitleText.width + paddingX * 2
        const boxHeight = this.subtitleText.height + paddingY * 2

        this.subtitleBackground.clear()
        this.subtitleBackground.beginFill(
            this.parseHexColor(style.backgroundColor, DEFAULT_SUBTITLE_STYLE.backgroundColor),
            this.clampNumber(style.backgroundOpacity, 0, 1, DEFAULT_SUBTITLE_STYLE.backgroundOpacity)
        )
        this.subtitleBackground.drawRoundedRect(0, 0, boxWidth, boxHeight, radius)
        this.subtitleBackground.endFill()

        this.subtitleContainer.position.set(
            (CAMERA_BASE_WIDTH - boxWidth) / 2,
            CAMERA_BASE_HEIGHT * (1 - style.bottomPercent / 100) - boxHeight
        )
        this.subtitleContainer.visible = true
    }

    private getSubtitleStyle(): SubtitleStyle {
        const style = {
            ...DEFAULT_SUBTITLE_STYLE,
            ...(this.config.subtitleStyle ?? {}),
        }

        return {
            ...style,
            fontSize: this.clampNumber(
                style.fontSize,
                FONT_SIZE_PRESETS[0] ?? 8,
                FONT_SIZE_PRESETS[FONT_SIZE_PRESETS.length - 1] ?? 500,
                DEFAULT_SUBTITLE_STYLE.fontSize
            ),
            backgroundOpacity: this.clampNumber(
                style.backgroundOpacity,
                0,
                1,
                DEFAULT_SUBTITLE_STYLE.backgroundOpacity
            ),
            maxWidthPercent: this.clampNumber(
                style.maxWidthPercent,
                50,
                95,
                DEFAULT_SUBTITLE_STYLE.maxWidthPercent
            ),
            bottomPercent: this.clampNumber(
                style.bottomPercent,
                2,
                20,
                DEFAULT_SUBTITLE_STYLE.bottomPercent
            ),
        }
    }

    private clampNumber(value: number, min: number, max: number, fallback: number): number {
        if (!Number.isFinite(value)) return fallback
        return Math.min(max, Math.max(min, value))
    }

    private parseHexColor(value: string, fallback: string): number {
        const normalized = /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
        return Number.parseInt(normalized.slice(1), 16)
    }

    /**
     * PA: Update animation state — delegated to AnimationController
    */
    private updateAnimationStates(
        currentInfo: BlockPlayInfo,
        blockLocalTime: number,
    ): void {
        this.animationController.processSetAnimActions(
            currentInfo.blockActions,
            currentInfo.slots,
            blockLocalTime,
            currentInfo.duration,
            {
                blockId: currentInfo.block.id,
                ttsTiming: this.getTTSTimingForBlock(currentInfo.block),
            },
        )
    }

    /**
     * PA: Auto-stop animation at block end — delegated to AnimationController
     */
    private applyAutoStopOnBlockEnd(prevBlockInfo: BlockPlayInfo): void {
        this.animationController.processAutoStopOnBlockEnd(prevBlockInfo.blockActions)
    }

    /**
     * PA: Apply initial animation state — delegated to AnimationController
     * Retain FrameCapture-specific prop _shouldPlay management
     */
    private applyInitialAnimationStates(scene: Episode['scenes'][number]): void {
        this.currentScene = scene
        // v16: Asset animations deep cloned to obj.animations at creation (PRD 7.5)
        this.animationController.processInitialAnimationStates()
        // FrameCapture specific: prop initial animation _shouldPlay management
        // Handled by handleAnimationTriggered hook inside processInitialAnimationStates
    }

    /**
     * PA: Handle animation triggered FrameCapture-specific behavior
     * Primarily manages _shouldPlay flag (PIXI ticker does not run during offscreen rendering)
     * Character animations managed internally by CharacterSprite, no handling needed
     *
     * v16: Deduce objectType and refId from scene objects, no longer passed by caller
     */
    private handleAnimationTriggered(
        objectId: string,
        _animName: string,
        cmd: 'play' | 'stop',
    ): void {
        // Get objectType and refId from scene objects
        const obj = this.currentScene?.setup.objects.find(o => o.id === objectId)
        if (!obj) return

        const objectType = obj.type

        // Frame animation child node name mapping
        const spriteNameMap: Record<string, string> = {
            prop: 'prop_animation',
            background: 'bg_animation',
            symbol: 'symbol_animation',
            expression: 'expression_animation',
        }
        const spriteName = spriteNameMap[objectType]
        if (!spriteName) return

        const container = this.objectContainers.get(objectId)
        if (!container) return
        const animatedSprite = container.getChildByName(spriteName) as
            | (PIXI.AnimatedSprite & { _shouldPlay?: boolean })
            | undefined
        if (!animatedSprite) return

        if (cmd === 'play') {
            const fps = this.getAssetFps(obj)
            animatedSprite.animationSpeed = fps / 60
            ; (animatedSprite as PIXI.AnimatedSprite & { _shouldPlay?: boolean })._shouldPlay = true
            this.spriteAnimTimeAccumulator.set(animatedSprite, 0)
        } else {
            ; (animatedSprite as PIXI.AnimatedSprite & { _shouldPlay?: boolean })._shouldPlay = false
        }
    }

    /** Get asset framerate */
    private getAssetFps(obj: SceneObject): number {
        const objectType = obj.type
        const refId = obj.refId

        if (objectType === 'prop') {
            return this.propStore.getProp(refId)?.fps ?? 25
        }
        if (objectType === 'background') {
            return this.backgroundStore.getBackground(refId)?.fps ?? 25
        }
        if (objectType === 'symbol') {
            const symbol = obj as SymbolObject
            const material = symbol.currentMaterialId
                ? symbol.materials.find(item => item.id === symbol.currentMaterialId)
                : symbol.materials[0]
            return material?.fps ?? 12
        }
        if (objectType === 'expression') {
            return this.expressionStore.getExpression(refId)?.speakingFps ?? 12
        }
        return 25
    }

    /**
     * Update all frame animations (manually advance AnimatedSprite)
     * v11.82: Uses deltaTime accumulation mechanism, consistent with ScenePlayer ticker behavior
     * @param deltaTime Time difference from previous frame (ms)
     */
    private updateAnimations(deltaTime: number): void {
        advanceAllObjectAnimations(this.objectContainers, deltaTime, this.spriteAnimTimeAccumulator)
    }

    /**
     * Clean up all resources for current scene
     */
    private clearScene(): void {
        if (!this.contentViewport) return

        // P2: Clean up offscreen render targets first
        this.compositeRenderTargets.forEach(crt => crt.destroy())
        this.compositeRenderTargets.clear()

        // Clip-Mask Phase 1: Clean up mask render resources
        disposeMaskRendererResources(this.maskRendererResources)

        // v11.60: Destroy Animation Player instances
        this.objectAnimationPlayers.forEach(player => player.destroy())
        this.objectAnimationPlayers.clear()

        this.triggeredAnimations.clear()
        this.objectContainers.forEach(container => {
            container.removeFromParent()
            container.destroy({ children: true })
        })
        this.objectContainers.clear()
        this.objectDimensions.clear()
        this.lastMeasuredPose.clear()
        this.blockPlayInfos = []
        this.lastFollowPosition = null
        this.lastEvaluatedCameraState = null
        this.followBBoxOffsets.clear()
        this.previousBlockInfo = null

        this.contentViewport.removeChildren()
        this.sceneStage = null
    }


    /**
     * Clean up resources
     */
    destroy(): void {
        this.clearScene()

        if (this.renderer) {
            try {
                // OffscreenCanvas has no style property, requires special handling
                // Manually destroy event system first to prevent it accessing canvas.style
                const renderer = this.renderer as unknown as { events?: { domElement: object | null; destroy: () => void } }
                const events = renderer.events
                if (events) {
                    // Clear event system target element reference to prevent accessing canvas.style
                    if (events.domElement) {
                        events.domElement = null
                    }
                    // Destroy event system
                    try {
                        events.destroy()
                    } catch (e) {
                        // Ignore event system destruction error
                    }
                }

                // Now safe to destroy renderer
                // Pass false to avoid attempting to remove view
                this.renderer.destroy(false)
            } catch (error) {
                console.warn('[FrameCapture] Warning destroying renderer:', error)
            }
            this.renderer = null
        }

        if (this.stage) {
            this.stage.destroy({ children: true, texture: true, baseTexture: true })
            this.stage = null
        }

        this.offscreenCanvas = null
        this.scaleContainer = null
        this.contentViewport = null
        this.sceneStage = null
        this.subtitleContainer = null
        this.subtitleBackground = null
        this.subtitleText = null

        // v25: Clean up lighting filter cache
        if (this.lightingFilterCache.instance) {
            this.lightingFilterCache.instance.destroy()
            delete this.lightingFilterCache.instance
        }
        if (this.lightingFilterCache.maskRT) {
            this.lightingFilterCache.maskRT.destroy(true)
            delete this.lightingFilterCache.maskRT
        }

        if (this.didOverridePixiSettings) {
            PIXI.settings.RESOLUTION = this.previousPixiResolution
            this.didOverridePixiSettings = false
        }
    }
}
