/**
 * Cross-engine shared render pipeline
 *
 * Unifies the identical object rendering logic between ScenePlayer and FrameCapture.
 * Rendering steps for each object type (container creation -> AnimationPlayer -> registration)
 * are encapsulated in a single renderObject() entry point.
 *
 * Both engines inject their respective registries and renderer into the shared function by implementing the RenderHost interface.
 */

import * as PIXI from 'pixi.js'

import { CompositeRenderTarget } from '@/core/CompositeRenderTarget'
import type { AmbientLightData, LightSourceData } from '@/core/filters/LightingFilter'
import { hexToRgbArray,LightingFilter } from '@/core/filters/LightingFilter'
import { createGenericAnimationPlayer, type GenericAnimationPlayer } from '@/core/GenericAnimationPlayer'
import { installRenderChainRenderer, updateRenderChainRenderer } from '@/core/RenderChainStage'
import { SceneObjectRenderer } from '@/core/SceneObjectRenderer'
import type { CompositeObject, LightObject, ScreenEffectObject, ScreenEffectParams } from '@/types/sceneObject'
import type { SceneObject } from '@/types/screenplay'
import { evaluateLight, isPointLikeLight } from '@/utils/lightRuntime'
import { sortRenderChainByZIndex } from '@/utils/renderChainUtils'

function computeCanvasWorldFilterArea(target: PIXI.Container, width: number, height: number): PIXI.Rectangle {
    const p0 = target.toGlobal(new PIXI.Point(0, 0))
    const p1 = target.toGlobal(new PIXI.Point(width, 0))
    const p2 = target.toGlobal(new PIXI.Point(width, height))
    const p3 = target.toGlobal(new PIXI.Point(0, height))

    const minX = Math.min(p0.x, p1.x, p2.x, p3.x)
    const minY = Math.min(p0.y, p1.y, p2.y, p3.y)
    const maxX = Math.max(p0.x, p1.x, p2.x, p3.x)
    const maxY = Math.max(p0.y, p1.y, p2.y, p3.y)

    return new PIXI.Rectangle(minX, minY, maxX - minX, maxY - minY)
}

export interface LightingFilterCache {
    instance?: LightingFilter
    maskRT?: PIXI.RenderTexture
}

function supportsReceiveLightingControl(obj: SceneObject): boolean {
    if (obj.type === 'prop' || obj.type === 'symbol' || obj.type === 'expression' || obj.type === 'text') {
        return true
    }
    if (obj.type === 'composite') {
        return (obj as CompositeObject).compositeMode === 'entity'
    }
    return false
}

function copySharedDisplayProps(source: PIXI.DisplayObject, target: PIXI.DisplayObject): void {
    target.alpha = source.alpha
    target.visible = source.visible
    target.renderable = source.renderable
}

function copyLocalTransform(source: PIXI.DisplayObject, target: PIXI.DisplayObject): void {
    copySharedDisplayProps(source, target)
    target.position.copyFrom(source.position)
    target.scale.copyFrom(source.scale)
    target.skew.copyFrom(source.skew)
    target.pivot.copyFrom(source.pivot)
    target.rotation = source.rotation
}

function copyWorldTransform(source: PIXI.DisplayObject, target: PIXI.DisplayObject): void {
    copySharedDisplayProps(source, target)
    const transform = new PIXI.Transform()
    transform.setFromMatrix(source.worldTransform)
    target.position.copyFrom(transform.position)
    target.scale.copyFrom(transform.scale)
    target.skew.copyFrom(transform.skew)
    target.pivot.set(0, 0)
    target.rotation = transform.rotation
}

function createMaskMirror(source: PIXI.DisplayObject, useWorldTransform = false): PIXI.DisplayObject | null {
    let mirrored: PIXI.DisplayObject | null = null

    if (source instanceof PIXI.Text) {
        const sprite = new PIXI.Sprite(source.texture)
        sprite.anchor.copyFrom(source.anchor)
        sprite.tint = 0xFFFFFF
        mirrored = sprite
    } else if (source instanceof PIXI.AnimatedSprite) {
        const sprite = new PIXI.Sprite(source.texture)
        sprite.anchor.copyFrom(source.anchor)
        sprite.tint = 0xFFFFFF
        mirrored = sprite
    } else if (source instanceof PIXI.Sprite) {
        const sprite = new PIXI.Sprite(source.texture)
        sprite.anchor.copyFrom(source.anchor)
        sprite.tint = 0xFFFFFF
        mirrored = sprite
    } else if (source instanceof PIXI.Graphics) {
        const graphics = source.clone()
        graphics.tint = 0xFFFFFF
        mirrored = graphics
    } else if (source instanceof PIXI.Container) {
        const container = new PIXI.Container()
        for (const child of source.children as PIXI.DisplayObject[]) {
            const mirroredChild = createMaskMirror(child)
            if (mirroredChild) {
                container.addChild(mirroredChild)
            }
        }
        mirrored = container
    }

    if (!mirrored) return null

    if (useWorldTransform) {
        copyWorldTransform(source, mirrored)
    } else {
        copyLocalTransform(source, mirrored)
    }

    return mirrored
}

function syncExemptMask(
    sceneObjects: readonly SceneObject[],
    filterArea: PIXI.Rectangle,
    renderer: PIXI.Renderer | undefined,
    filterCache: LightingFilterCache | undefined,
    containerResolver: ((id: string) => PIXI.Container | undefined) | undefined,
): PIXI.RenderTexture | null {
    if (!renderer || !filterCache || !containerResolver) return null

    const exemptObjects = sceneObjects.filter(o =>
        supportsReceiveLightingControl(o)
        && o.receiveLighting === false
        && (o.spawned ?? true)
        && o.visible !== false
    )

    if (exemptObjects.length === 0) {
        return null
    }

    const width = Math.max(1, Math.ceil(filterArea.width))
    const height = Math.max(1, Math.ceil(filterArea.height))
    let maskRT = filterCache.maskRT
    if (!maskRT) {
        maskRT = PIXI.RenderTexture.create({
            width,
            height,
            resolution: renderer.resolution,
        })
        filterCache.maskRT = maskRT
    } else if (maskRT.width !== width || maskRT.height !== height) {
        maskRT.resize(width, height, true)
    }

    const maskStage = new PIXI.Container()
    for (const obj of exemptObjects) {
        const container = containerResolver(obj.id)
        if (!container?.worldVisible) continue
        const mirrored = createMaskMirror(container, true)
        if (mirrored) {
            maskStage.addChild(mirrored)
        }
    }

    if (maskStage.children.length === 0) {
        maskStage.destroy({ children: true })
        return null
    }

    renderer.render(maskStage, {
        renderTexture: maskRT,
        clear: true,
        transform: new PIXI.Matrix(1, 0, 0, 1, -filterArea.x, -filterArea.y),
    })
    maskStage.destroy({ children: true })

    return maskRT
}

// ============================================================================
// Types
// ============================================================================

/**
 * Render host interface — minimal dependency injection required by engine
 *
 * ScenePlayer and FrameCapture each construct a RenderHost instance,
 * bridging to their local Maps and renderer instances.
 */
export interface RenderHost {
    /** Unified renderer (container creation) */
    sceneObjectRenderer: SceneObjectRenderer
    /** Object container registry */
    objectContainers: Map<string, PIXI.Container>
    /** Animation player registry */
    objectAnimationPlayers: Map<string, GenericAnimationPlayer>
    /** Composite entity mode offscreen render target */
    compositeRenderTargets: Map<string, CompositeRenderTarget>
    /** Retrieve engine's PIXI Renderer (for compositeMode + CRT) */
    getRenderer(): PIXI.Renderer | undefined
    /** Retrieve all scene objects (needed to look up childObj when composite renders children) */
    getSceneObjects(): SceneObject[]
}

// ============================================================================
// renderObject — Unified object render entry point
// ============================================================================

/**
 * Unified object render entry point (shared cross-engine)
 *
 * Each object type completes full rendering environment creation in this function:
 * 1. Container creation (delegated to SceneObjectRenderer)
 * 2. GenericAnimationPlayer creation + registration (for types driven by animation)
 * 3. Registration to host's objectContainers / objectAnimationPlayers
 * 4. addChild to parentContainer
 *
 * Composite recursively calls this entry point for children, ensuring consistent render paths.
 */
export async function renderObject(
    obj: SceneObject,
    parentContainer: PIXI.Container,
    host: RenderHost,
): Promise<void> {
    switch (obj.type) {
        case 'prop': {
            const container = host.sceneObjectRenderer.createPropContainer(obj)
            parentContainer.addChild(container)
            host.objectContainers.set(obj.id, container)

            const player = createGenericAnimationPlayer({
                target: container,
                ownerObjectId: obj.id,
                objectType: 'prop',
                objectId: obj.refId,
            })
            player.cacheBaseTransform()
            host.objectAnimationPlayers.set(obj.id, player)
            break
        }

        case 'background': {
            const container = host.sceneObjectRenderer.createBackgroundContainer(obj)
            parentContainer.addChild(container)
            host.objectContainers.set(obj.id, container)

            const player = createGenericAnimationPlayer({
                target: container,
                ownerObjectId: obj.id,
                objectType: 'background',
                objectId: obj.refId,
            })
            player.cacheBaseTransform()
            host.objectAnimationPlayers.set(obj.id, player)
            break
        }



        case 'audio': {
            const container = new PIXI.Container()
            container.name = obj.id
            container.visible = false
            parentContainer.addChild(container)
            host.objectContainers.set(obj.id, container)
            break
        }

        case 'symbol': {
            const container = host.sceneObjectRenderer.createSymbolContainer(obj)
            SceneObjectRenderer.applyBasicTransform(container, obj)
            parentContainer.addChild(container)
            host.objectContainers.set(obj.id, container)

            // v16: Symbols also need AnimationPlayer to support initialAnimations / set_anim frame animation playback
            const symPlayer = createGenericAnimationPlayer({
                target: container,
                ownerObjectId: obj.id,
            })
            symPlayer.cacheBaseTransform()
            host.objectAnimationPlayers.set(obj.id, symPlayer)
            break
        }

        case 'text': {
            const container = host.sceneObjectRenderer.createTextContainer(obj)
            SceneObjectRenderer.applyBasicTransform(container, obj)
            parentContainer.addChild(container)
            host.objectContainers.set(obj.id, container)

            const textPlayer = createGenericAnimationPlayer({
                target: container,
                ownerObjectId: obj.id,
            })
            textPlayer.cacheBaseTransform()
            host.objectAnimationPlayers.set(obj.id, textPlayer)
            break
        }

        case 'screen_effect': {
            const effectObj = obj as ScreenEffectObject
            const effectParams: ScreenEffectParams = effectObj.params ?? {}
            const effectWidth = obj.width ?? Math.round(1456 * 1.1)
            const effectHeight = obj.height ?? Math.round(819 * 1.1)
            const { container } = host.sceneObjectRenderer.createScreenEffectContainer(
                obj.id, effectParams, effectWidth, effectHeight, obj.zIndex ?? 1000,
            )
            container.visible = obj.visible ?? true
            parentContainer.addChild(container)
            host.objectContainers.set(obj.id, container)
            break
        }

        case 'composite': {
            const composite = obj as CompositeObject
            const container = new PIXI.Container()
            container.name = `composite_${obj.id}`

            // v20: union containers do not need renderable=false.
            // In old architecture children were flattened into upper container, union itself wasn't rendered so set renderable=false.
            // In new architecture children are addChild-ed into union container, renderable=false would block whole subtree rendering.
            // union container has no visual content (just Container), causing no extra draws.

            // Composite with spawned=false does not render children:
            // - If children survive, upper syncResources renders them independently as top-level objects
            // - Prevents children from being rendered simultaneously in composite and top-level containers causing duplication
            if (obj.spawned !== false) {
                // v20: entity/union traverse children uniformly via renderChain or childIds
                const allObjects = host.getSceneObjects()
                const childOrder = (composite.renderChain && composite.renderChain.length > 0)
                    ? composite.renderChain
                    : (composite.childIds ?? [])
                for (const childId of childOrder) {
                    const childObj = allObjects.find(o => o.id === childId)
                    if (!childObj) continue
                    // Defensive skip — if child was already rendered beforehand by syncResources,
                    // do not re-create container (avoids orphan containers on stage)
                    if (host.objectContainers.has(childId)) continue
                    // v20: union/entity uniformly addChild to own container
                    await renderObject(childObj, container, host)
                }

                // v20: When union is nested inside entity, union container has been traversed as entity child,
                // but union container itself is not in renderChain.
                // Need to ensure union container is registered in objectContainers to prevent syncResources duplicate creation.
                // (This is automatically handled in the recursive renderObject call above)
            }

            // v21: Install override render for entity/union, scheduling leaf containers individually by renderChain
            if (composite.renderChain && composite.renderChain.length > 0) {
                installRenderChainRenderer(container, composite.renderChain, host.objectContainers)
            }
            SceneObjectRenderer.applyBasicTransform(container, obj)

            // entity mode: enable offscreen rendering
            if (composite.compositeMode === 'entity') {
                parentContainer.addChild(container) // enable() requires source.parent
                const renderer = host.getRenderer()
                if (renderer) {
                    const crt = new CompositeRenderTarget({ source: container, renderer })
                    crt.enable()
                    host.compositeRenderTargets.set(obj.id, crt)
                    host.objectContainers.set(obj.id, crt.getOutputContainer())
                } else {
                    host.objectContainers.set(obj.id, container)
                }
            } else {
                parentContainer.addChild(container)
                host.objectContainers.set(obj.id, container)
            }

            // v20: composite object creates AnimationPlayer (delegation mode)
            // With union children inside container, getLocalBounds() works naturally, custom boundsProvider no longer needed
            const compositeContainer = host.objectContainers.get(obj.id)
            if (compositeContainer) {
                const compositePlayer = createGenericAnimationPlayer({
                    target: compositeContainer,
                    ownerObjectId: obj.id,
                    playerResolver: (targetId: string) => {
                        return host.objectAnimationPlayers.get(targetId) ?? null
                    },
                })
                compositePlayer.cacheBaseTransform()
                host.objectAnimationPlayers.set(obj.id, compositePlayer)
            }
            break
        }

        // v18: Independent expression object
        case 'expression': {
            const container = host.sceneObjectRenderer.createExpressionContainer(obj)
            SceneObjectRenderer.applyBasicTransform(container, obj)
            parentContainer.addChild(container)
            host.objectContainers.set(obj.id, container)

            const exprPlayer = createGenericAnimationPlayer({
                target: container,
                ownerObjectId: obj.id,
            })
            exprPlayer.cacheBaseTransform()
            host.objectAnimationPlayers.set(obj.id, exprPlayer)
            break
        }

        // v25: Light object — register container so applyObjectState updates position
        // Includes visual indicator (small dot) to help positioning/dragging in editor
        // ScenePlayer/FrameCapture forces container.visible = false to hide
        case 'light': {
            const container = new PIXI.Container()
            container.name = `light_${obj.id}`

            // Visual indicator: white circle + dark stroke
            const dot = new PIXI.Graphics()
            dot.beginFill(0xFFFFFF, 0.85)
            dot.drawCircle(0, 0, 6)
            dot.endFill()
            dot.lineStyle(1.5, 0x333333, 0.7)
            dot.drawCircle(0, 0, 6)
            container.addChild(dot)

            parentContainer.addChild(container)
            host.objectContainers.set(obj.id, container)
            break
        }

        // Clip-Mask Phase 1: mask container serves only as worldTransform anchor, no visual content.
        // True clipping geometry (PIXI.Graphics) is created by maskRenderer per frame under target container by (mask.id, target.id).
        case 'mask': {
            const container = new PIXI.Container()
            container.name = `mask_${obj.id}`
            container.renderable = false
            container.visible = false
            parentContainer.addChild(container)
            host.objectContainers.set(obj.id, container)
            break
        }
    }
}



// ============================================================================
// Composite Helper Functions
// ============================================================================

/**
 * Update offscreen render textures for all composite entity modes in topological order (inside-out)
 *
 * Composites with greater depth are updated first, ensuring nested composite RenderTextures
 * are ready before the parent renders.
 */
export function updateCompositeRenderTargetsInOrder(
    targets: Map<string, CompositeRenderTarget>,
    sceneObjects: readonly SceneObject[],
): void {
    if (targets.size === 0) return
    const sorted = getCompositeUpdateOrder(targets, sceneObjects)
    for (const id of sorted) {
        targets.get(id)?.updateRenderTexture()
    }
}

/**
 * Get composite offscreen render update order (leaf nodes first)
 * Computes depth via parentId chain, sorted in descending order of depth
 */
function getCompositeUpdateOrder(
    targets: Map<string, CompositeRenderTarget>,
    sceneObjects: readonly SceneObject[],
): string[] {
    const depthMap = new Map<string, number>()

    function getDepth(id: string): number {
        const cached = depthMap.get(id)
        if (cached !== undefined) return cached
        const obj = sceneObjects.find(o => o.id === id)
        if (!obj?.parentId) {
            depthMap.set(id, 0)
            return 0
        }
        const depth = getDepth(obj.parentId) + 1
        depthMap.set(id, depth)
        return depth
    }

    const ids = Array.from(targets.keys())
    for (const id of ids) {
        getDepth(id)
    }
    // Depth descending: leaf nodes update first
    return ids.sort((a, b) => (depthMap.get(b) ?? 0) - (depthMap.get(a) ?? 0))
}

// ============================================================================
// General Helper Functions
// ============================================================================

/**
 * Synchronize objectDimensions to all GenericAnimationPlayers
 * Used for pivot position compensation calculation
 */
export function syncObjectBoundsToPlayers(
    dimensions: Map<string, { width: number; height: number; boundsX?: number; boundsY?: number }>,
    players: Map<string, GenericAnimationPlayer>,
): void {
    for (const [objId, dims] of dimensions) {
        const player = players.get(objId)
        if (!player) continue
        player.setObjectBounds(dims.width, dims.height, dims.boundsX, dims.boundsY)
    }
}

/**
 * Manually sort children of entity composite container (renderChain driven)
 *
 * Root-level union render order is handled uniformly by stage's installRootRenderChainRenderer,
 * no need to control via setChildIndex in this function.
 *
 * entity: Updates override render by renderChain + runtime zIndex (including union expanded children)
 * union (inside entity): Cross-container scheduled by parent entity's renderByRenderChain, skipped
 * union (root-level): Scheduled uniformly by stage's renderByRenderChain, skipped
 *
 * v19 Fix: Under entity CRT mode, sort source container (where actual children reside), rather than output.
 */
export function sortCompositeContainers(
    sceneObjects: readonly SceneObject[],
    objectContainers: Map<string, PIXI.Container>,
    compositeRenderTargets?: Map<string, CompositeRenderTarget>,
    getZIndex?: (id: string) => number,
): void {
    for (const objSetup of sceneObjects) {
        if (objSetup.type !== 'composite') continue
        const comp = objSetup as CompositeObject

        const compositeMode = comp.compositeMode ?? 'entity'

        if (compositeMode === 'entity') {
            // v20: entity CRT sorts source container (where actual children reside) rather than output
            const crt = compositeRenderTargets?.get(objSetup.id)
            const compositeContainer = crt
                ? crt.getSourceContainer()
                : objectContainers.get(objSetup.id)
            if (!compositeContainer) continue

            if (comp.renderChain && comp.renderChain.length > 0) {
                // v22: When consumed, sort by runtime zIndex, updating entity override render
                const chain = getZIndex
                    ? sortRenderChainByZIndex(comp.renderChain, getZIndex)
                    : comp.renderChain
                updateRenderChainRenderer(compositeContainer, chain, objectContainers)
            }
        }
        // union composite (root-level or inside entity):
        // Render order is dispatched uniformly by parent container (stage or entity) renderByRenderChain, no separate handling needed
    }
}
// v20: propagateUnionAnimations has been removed
// union children reside inside container (genuine PIXI parent-child relation), animation transforms propagate automatically without manual synchronization

// ============================================================================
// v25: Lighting Filter Application
// ============================================================================

/**
 * v25.7: Light source coordinate projection helper inside CRT
 *
 * Entity Composite's CRT detaches the source container from the Stage tree and resets its transform.
 * When the light source is a child of the entity, light container's toGlobal() cannot obtain correct screen coordinates.
 *
 * This function searches for the nearest CRT entity ancestor along the parentId chain,
 * computes the local coordinates of the light within the entity source container, and returns the entity's outputContainer
 * (still in Stage tree), for caller to get correct screen coordinates via outputContainer.toGlobal(localPoint).
 */
function resolveCRTProjection(
    lightObj: LightObject,
    sceneObjects: readonly SceneObject[],
    compositeRenderTargets: Map<string, CompositeRenderTarget>,
): { outputContainer: PIXI.Container; localX: number; localY: number } | null {
    // Search for nearest CRT entity ancestor along parentId chain
    let currentId: string | undefined = lightObj.parentId
    while (currentId) {
        const crt = compositeRenderTargets.get(currentId)
        if (crt) {
            // Found CRT entity ancestor
            // Compute light local coordinates within entity source container
            // applyLightState sets container.position = (state.x, state.y)
            // For entity children, this is local coordinates relative to the entity
            // The CRT source container transform has been reset to identity,
            // so light's source-local coordinate is container.position
            const outputContainer = crt.getOutputContainer()

            // Get compositeSprite for coordinate mapping
            // CRT.updateRenderTexture sets:
            //   renderRoot.position = (-bounds.x + padding, -bounds.y + padding)
            //   compositeSprite.position = (bounds.x - padding, bounds.y - padding)
            // Coordinates of light in source container = (lightObj.x, lightObj.y)
            // compositeSprite maps the entire renderTexture back to entity local space
            // So directly use light model coordinates: compositeSprite already aligned with source bounds
            const localX = lightObj.x ?? 0
            const localY = lightObj.y ?? 0

            return { outputContainer, localX, localY }
        }
        // Continue searching upwards
        const parentObj = sceneObjects.find(o => o.id === currentId)
        currentId = parentObj?.parentId
    }
    // Not inside any CRT entity, but might be in root-level union where containerResolver doesn't work
    // Check if container's parent chain reached stage (simple heuristic)
    // No CRT ancestor -> return null, use default toGlobal path
    return null
}


/**
 * Aggregate light source objects in the scene, create/update LightingFilter, and mount to target container
 *
 * Called by ScenePlayer and FrameCapture during syncResources / updateFrame
 */
export function applyLightingFilter(
    sceneObjects: readonly SceneObject[],
    targetContainer: PIXI.Container,
    canvasWidth: number,
    canvasHeight: number,
    filterCache?: LightingFilterCache,
    filterAreaOverride?: PIXI.Rectangle,
    containerResolver?: (id: string) => PIXI.Container | undefined,
    timeMs?: number,
    renderer?: PIXI.Renderer,
    compositeRenderTargets?: Map<string, CompositeRenderTarget>,
): void {
    const lightObjects = sceneObjects.filter(
        o => o.type === 'light' && (o as SceneObject & { spawned?: boolean }).spawned !== false
    ) as LightObject[]
    const ambientObj = lightObjects.find(l => l.lightType === 'ambient')
    const ambient: AmbientLightData = {
        color: hexToRgbArray(ambientObj?.lightColor ?? '#ffffff'),
        intensity: ambientObj?.lightIntensity ?? 1.0,
    }
    const filterArea = filterAreaOverride ?? computeCanvasWorldFilterArea(targetContainer, canvasWidth, canvasHeight)
    const now = timeMs ?? Date.now()
    const evaluatedLights = lightObjects
        .filter(l => isPointLikeLight(l) && l.visible !== false)
        .map(light => ({ light, ev: evaluateLight(light, now) }))
        .sort((a, b) => b.ev.intensity - a.ev.intensity)
        .slice(0, 8)

    // v25.6: Light source coordinate projection -> output frame local UV space (0..1)
    // First obtain screen coordinates via toGlobal or linear mapping, then normalize to current output frame area.
    // Shader maps this 0..1 local UV to UV space of real input texture,
    // ensuring ScenePlayer / FrameCapture / multi-resolution export share the same reference frame.
    let points: LightSourceData[]
    if (containerResolver) {
        points = evaluatedLights.map(({ light: l, ev }) => {
            const coneHalfCos = Math.cos((ev.coneAngle / 2) * Math.PI / 180)
            const container = containerResolver(l.id)
            if (container) {
                // v25.7: Entity Composite CRT fix
                // When light source is a child of entity composite, CRT.enable() detaches source container
                // from Stage tree into independent renderRoot. At this point container.toGlobal()
                // returns local coordinates of offscreen render texture, not correct screen coordinates.
                // Fix: Find nearest CRT entity ancestor, project light's local coordinates to screen space
                // via outputContainer (which is still in Stage tree).
                const crtProjection = compositeRenderTargets
                    ? resolveCRTProjection(l, sceneObjects, compositeRenderTargets)
                    : null

                let p0: PIXI.Point
                let p1: PIXI.Point
                if (crtProjection) {
                    p0 = crtProjection.outputContainer.toGlobal(new PIXI.Point(crtProjection.localX, crtProjection.localY))
                    p1 = crtProjection.outputContainer.toGlobal(new PIXI.Point(crtProjection.localX, crtProjection.localY + ev.radius))
                } else {
                    p0 = container.toGlobal(new PIXI.Point(0, 0))
                    p1 = container.toGlobal(new PIXI.Point(0, ev.radius))
                }
                const screenRadius = Math.hypot(p1.x - p0.x, p1.y - p0.y)
                return {
                    // Screen coordinates -> output frame local UV space
                    x: (p0.x - filterArea.x) / filterArea.width,
                    y: (p0.y - filterArea.y) / filterArea.height,
                    radius: screenRadius / filterArea.height,
                    color: hexToRgbArray(ev.color),
                    intensity: ev.intensity,
                    directionMode: ev.directionMode === 'cone' ? 1 : 0,
                    directionAngle: ev.directionAngle,
                    coneHalfCos,
                    softness: ev.softness,
                } as LightSourceData
            }
            // fallback: World coordinates -> output frame local UV space
            return {
                x: ev.x / canvasWidth,
                y: ev.y / canvasHeight,
                radius: ev.radius / canvasHeight,
                color: hexToRgbArray(ev.color),
                intensity: ev.intensity,
                directionMode: ev.directionMode === 'cone' ? 1 : 0,
                directionAngle: ev.directionAngle,
                coneHalfCos,
                softness: ev.softness,
            }
        })
    } else {
        // Without containerResolver: World coordinates -> output frame local UV space
        points = evaluatedLights.map(({ ev }) => {
            const coneHalfCos = Math.cos((ev.coneAngle / 2) * Math.PI / 180)
            return {
                x: ev.x / canvasWidth,
                y: ev.y / canvasHeight,
                radius: ev.radius / canvasHeight,
                color: hexToRgbArray(ev.color),
                intensity: ev.intensity,
                directionMode: ev.directionMode === 'cone' ? 1 : 0,
                directionAngle: ev.directionAngle,
                coneHalfCos,
                softness: ev.softness,
            }
        })
    }

    // Reuse or create filter instance
    let filter = filterCache?.instance
    if (!filter) {
        filter = new LightingFilter()
        if (filterCache) filterCache.instance = filter
    }

    filter.updateFromSceneObjects(points, ambient)
    filter.setExemptMask(syncExemptMask(sceneObjects, filterArea, renderer, filterCache, containerResolver))

    if (!filter.isNoop()) {
        targetContainer.filterArea = filterArea
        const existing = (targetContainer.filters ?? [])
        const withoutLighting = existing.filter(f => !(f instanceof LightingFilter))
        targetContainer.filters = [...withoutLighting, filter]
    } else {
        delete (targetContainer as Partial<PIXI.Container>).filterArea
        const existing = (targetContainer.filters ?? [])
        const withoutLighting = existing.filter(f => !(f instanceof LightingFilter))
        targetContainer.filters = withoutLighting.length > 0 ? withoutLighting : null
    }
}
