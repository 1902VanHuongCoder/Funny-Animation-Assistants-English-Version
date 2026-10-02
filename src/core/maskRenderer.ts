/**
 * Clip-Mask Phase 1 render pipeline
 *
 * See docs/features/clip-mask.md (v2.1).
 *
 * Implementation notes (differences from PRD §11.3):
 * The original PRD proposal inserted a wrapper container above target, placing mask Graphics and target together under wrapper.
 * Actual implementation adopts wrapper approach:
 *   - Inserts an identity wrapper in-place into target's original parent, moving target into wrapper.
 *   - mask Graphics is mounted as a sibling of wrapper under wrapper.parent, pairing with `wrapper.mask = MaskData(graphics)` for clipping.
 *   - Mathematically equivalent: `graphics.localTransform = inv(wrapper.parent.worldTransform) * maskContainer.worldTransform`,
 *     ensuring `graphics.worldTransform === maskContainer.worldTransform`, identical semantics to PRD.
 *   - target's existing `container.mask` (e.g. fixed text `text_box_mask`) is no longer overwritten;
 *     wrapper clip-mask and target internal mask naturally form nested clipping.
 *   - Key constraint: mask Graphics must be a descendant of a normal visible container, and cannot be a descendant of the masked wrapper.
 *     It cannot be mounted under maskContainer: renderPipeline sets mask container to `visible=false / renderable=false`
 *     (as masks themselves do not render to canvas), and its descendants would be culled early by PIXI StencilMaskPipe.execute
 *     visibility check, resulting in stencil buffer not being written => clipping fails.
 *   - Forced STENCIL mode: scene root (active_layer) has LightingFilter; PIXI automatically downgrades axis-aligned rectangular
 *     masks to SCISSOR; but SCISSOR uses screen coordinates, which mismatch filter internal framebuffer coordinates,
 *     causing the scissor rectangle to map incorrectly and leak to siblings (e.g. background). Using STENCIL works correctly
 *     inside framebuffer. Implemented via `MaskData` + `autoDetect=false`.
 *
 * Coexistence with existing `container.mask` (fixed text etc.):
 *   - clip-mask operates on wrapper.mask without overwriting target.mask.
 *   - target's own `text_box_mask` / screen-effect mask remain on target layer,
 *     naturally intersecting with outer wrapper clip-mask.
 *
 * Invocation contract:
 *   1. Each engine creates a normal `PIXI.Container` for `type: 'mask'` SceneObject (no visual content,
 *      `renderable=false`), writing x/y/scale/rotation/... via `applyObjectState` simple-transform path.
 *   2. Call `pixiApp.stage.updateTransform()` (or engine's equivalent update) before `pixiApp.renderer.render(stage)`,
 *      ensuring worldTransform of all objects is ready.
 *   3. Call `applyAllMasks(objects, getContainer, resources)`.
 *   4. Call `disposeMaskRendererResources(resources)` upon engine teardown to clean up Graphics.
 *   5. When deleting any object (mask or target), call `unwrapTarget(id, resources)` to release corresponding resources.
 */

import * as PIXI from 'pixi.js'

import type { MaskObject, MaskShape, SceneObject } from '@/types/sceneObject'
import { debugLog, debugWarn, isDebugEnabled } from '@/utils/debugLogger'

// ============================================================================
// Types
// ============================================================================

/**
 * Private resource bundle for mask renderer.
 * Held independently by each engine to avoid cross-engine PIXI resource conflicts.
 */
export interface MaskRendererResources {
    /** key = `${maskId}::${targetId}` -> Graphics (sibling of wrapper, mounted under wrapper.parent) */
    graphics: Map<string, PIXI.Graphics>
    /** key = `${maskId}::${targetId}` -> White Sprite used by SpriteMaskFilter (sibling of wrapper) */
    spriteMasks: Map<string, PIXI.Sprite>
    /** key = `${maskId}::${targetId}` -> Shape-aware Texture used by SpriteMaskFilter */
    spriteMaskTextures: Map<string, PIXI.Texture>
    /** key = `${maskId}::${targetId}` -> Shape/size signature corresponding to current texture */
    spriteMaskTextureKeys: Map<string, string>
    /** key = `${maskId}::${targetId}` -> Stably reused SpriteMaskFilter, bypassing stencil/scissor framebuffer issues */
    spriteFilters: Map<string, PIXI.SpriteMaskFilter>
    /** key = `${maskId}::${targetId}` -> Stably reused MaskData, avoiding refCount jitter from per-frame wrapper.mask replacement */
    maskData: Map<string, PIXI.MaskData>
    /** targetId -> Temporary wrapper (wraps target in-place to host clip mask) */
    wrappers: Map<string, PIXI.Container>
    /** targetId -> Currently active maskId (Phase 1 single mask exclusive) */
    claims: Map<string, string>
    /** targetId -> Prior target.filterArea before clip-mask takeover, restored upon stale release */
    priorFilterAreas: Map<string, PIXI.Rectangle | undefined>
    /**
     * targetId -> Prior target.mask value before clip-mask claim assignment (if any).
     * Restores built-in masks like fixed-text `text_box_mask` upon stale release,
     * rather than clearing them via `target.mask = null`.
     * Only records non-clip-mask prior values (i.e. not Graphics managed by this resource pool).
     */
    priorMasks: Map<string, PIXI.Container | PIXI.MaskData>
}

export function createMaskRendererResources(): MaskRendererResources {
    return {
        graphics: new Map(),
        spriteMasks: new Map(),
        spriteMaskTextures: new Map(),
        spriteMaskTextureKeys: new Map(),
        spriteFilters: new Map(),
        maskData: new Map(),
        wrappers: new Map(),
        claims: new Map(),
        priorFilterAreas: new Map(),
        priorMasks: new Map(),
    }
}

function safeDestroyTexture(texture: PIXI.Texture | undefined): void {
    if (!texture || texture === PIXI.Texture.WHITE || texture === PIXI.Texture.EMPTY) return
    try {
        texture.destroy(true)
    } catch { /* texture may already be disposed by PIXI; ignore */ }
}

// ============================================================================
// Internals
// ============================================================================

const MASK_GRAPHICS_NAME_PREFIX = '__clip_mask__'
const MASK_WRAPPER_NAME_PREFIX = '__clip_mask_wrapper__'
const DEFAULT_MASK_SIZE = 200

export function isClipMaskWrapper(container: PIXI.DisplayObject | null | undefined): container is PIXI.Container {
    const name = (container as PIXI.Container | null | undefined)?.name
    return typeof name === 'string' && name.startsWith(MASK_WRAPPER_NAME_PREFIX)
}

function makeKey(maskId: string, targetId: string): string {
    return `${maskId}::${targetId}`
}

function isOwnedClipMaskValue(value: PIXI.Container | PIXI.MaskData | null | undefined): boolean {
    if (!value) return false
    const maskObject = (value as PIXI.MaskData).isMaskData
        ? (value as PIXI.MaskData).maskObject
        : value
    const name = (maskObject as PIXI.Container | null)?.name
    return typeof name === 'string' && name.startsWith(MASK_GRAPHICS_NAME_PREFIX)
}

function makeWrapperName(targetId: string): string {
    return `${MASK_WRAPPER_NAME_PREFIX}${targetId}`
}

function resetIdentityTransform(container: PIXI.Container): void {
    container.position.set(0, 0)
    container.scale.set(1, 1)
    container.rotation = 0
    container.skew.set(0, 0)
    container.pivot.set(0, 0)
}

function resolvePositiveFiniteSize(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && (value ?? 0) > 0 ? value! : fallback
}

function resolveMaskDimensions(mask: MaskObject): { width: number; height: number; rawWidth: number; rawHeight: number } {
    return {
        width: resolvePositiveFiniteSize(mask.width, DEFAULT_MASK_SIZE),
        height: resolvePositiveFiniteSize(mask.height, DEFAULT_MASK_SIZE),
        rawWidth: mask.width,
        rawHeight: mask.height,
    }
}

function matrixToJson(matrix: PIXI.Matrix): Record<'a' | 'b' | 'c' | 'd' | 'tx' | 'ty', number> {
    return {
        a: matrix.a,
        b: matrix.b,
        c: matrix.c,
        d: matrix.d,
        tx: matrix.tx,
        ty: matrix.ty,
    }
}

function rectToJson(rect: PIXI.Rectangle): Record<'x' | 'y' | 'width' | 'height', number> {
    return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    }
}

function parentChain(node: PIXI.Container | null): string[] {
    const chain: string[] = []
    let current = node
    while (current) {
        chain.push(current.name ?? current.constructor.name)
        current = current.parent
    }
    return chain
}

function describePossibleCompositeOutput(container: PIXI.Container): Record<string, unknown> {
    const firstChild = container.children[0] as (PIXI.Sprite & { texture?: PIXI.Texture }) | undefined
    const baseTexture = firstChild?.texture?.baseTexture as ({ valid?: boolean; width?: number; height?: number } | undefined)
    return {
        name: container.name,
        childCount: container.children.length,
        firstChildName: firstChild?.name,
        firstChildType: firstChild?.constructor?.name,
        firstChildTextureValid: firstChild?.texture?.valid,
        firstChildBaseTextureValid: baseTexture?.valid,
        firstChildBaseTextureWidth: baseTexture?.width,
        firstChildBaseTextureHeight: baseTexture?.height,
    }
}

function removeOwnedSpriteMaskFilters(
    filters: PIXI.Filter[] | null | undefined,
    resources: MaskRendererResources,
): PIXI.Filter[] {
    if (!filters?.length) return []
    const owned = new Set<PIXI.SpriteMaskFilter>(resources.spriteFilters.values())
    return filters.filter(filter => !owned.has(filter as PIXI.SpriteMaskFilter))
}

function ensureWrapper(resources: MaskRendererResources, targetId: string, target: PIXI.Container): PIXI.Container | null {
    let wrapper = resources.wrappers.get(targetId)
    if (wrapper && target.parent === wrapper) {
        wrapper.zIndex = target.zIndex
        resetIdentityTransform(wrapper)
        wrapper.updateTransform()
        return wrapper
    }

    const parent = target.parent
    if (!parent) return null

    if (!wrapper || (wrapper as unknown as { destroyed?: boolean }).destroyed) {
        wrapper = new PIXI.Container()
        wrapper.name = makeWrapperName(targetId)
        wrapper.sortableChildren = true
        resources.wrappers.set(targetId, wrapper)
    } else if (wrapper.parent && wrapper.parent !== parent) {
        wrapper.parent.removeChild(wrapper)
    }

    wrapper.mask = null
    wrapper.zIndex = target.zIndex
    wrapper.visible = true
    wrapper.renderable = true
    wrapper.alpha = 1
    resetIdentityTransform(wrapper)

    const insertAt = parent.getChildIndex(target)
    parent.removeChild(target)
    parent.addChildAt(wrapper, insertAt)
    wrapper.addChild(target)

    wrapper.updateTransform()
    target.updateTransform()
    return wrapper
}

function unwrapClaimWrapper(resources: MaskRendererResources, targetId: string, target?: PIXI.Container | null): void {
    const wrapper = resources.wrappers.get(targetId)
    if (!wrapper) return

    wrapper.mask = null
    wrapper.filters = null
    delete (wrapper as Partial<PIXI.Container>).filterArea
    if (target?.parent === wrapper) {
        const parent = wrapper.parent
        if (parent) {
            const insertAt = parent.getChildIndex(wrapper)
            wrapper.removeChild(target)
            parent.addChildAt(target, insertAt)
            target.updateTransform()
        }
    }
    try {
        wrapper.parent?.removeChild(wrapper)
    } catch { /* wrapper already unlinked; ignore */ }
    try {
        wrapper.destroy({ children: false })
    } catch { /* wrapper already destroyed by parent cascade; ignore */ }
    resources.wrappers.delete(targetId)
}

/**
 * Redraw mask shape onto Graphics.
 *
 * Shape is centered at the Graphics origin (the mask container position represents the mask center, see applySimpleTransform).
 * Rectangle / ellipse width/height come from MaskObject.
 *
 * scaleX/scaleY is already reflected via `mask.worldTransform` scale, so geometry on Graphics only draws raw width * height.
 */
function drawMaskShape(g: PIXI.Graphics, mask: MaskObject): void {
    const { width, height } = resolveMaskDimensions(mask)
    g.clear()
    // Mask fill color can be arbitrary (only used as mask alpha), but must be opaque
    g.beginFill(0xFFFFFF, 1)
    const halfW = width / 2
    const halfH = height / 2
    const shape: MaskShape = mask.shape
    if (shape === 'ellipse') {
        g.drawEllipse(0, 0, halfW, halfH)
    } else {
        // Default / rectangle
        g.drawRect(-halfW, -halfH, width, height)
    }
    g.endFill()
}

function ensureSpriteMaskTexture(
    resources: MaskRendererResources,
    key: string,
    mask: MaskObject,
    dimensions: { width: number; height: number },
): PIXI.Texture {
    const width = Math.max(1, Math.ceil(dimensions.width))
    const height = Math.max(1, Math.ceil(dimensions.height))
    const textureKey = `${mask.shape}:${width}:${height}`
    const existingKey = resources.spriteMaskTextureKeys.get(key)
    const existingTexture = resources.spriteMaskTextures.get(key)
    if (existingKey === textureKey && existingTexture) return existingTexture

    safeDestroyTexture(existingTexture)

    let texture: PIXI.Texture = PIXI.Texture.WHITE
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
    const ctx = canvas?.getContext?.('2d')
    if (canvas && ctx) {
        canvas.width = width
        canvas.height = height
        ctx.clearRect(0, 0, width, height)
        ctx.fillStyle = '#ffffff'
        if (mask.shape === 'ellipse') {
            ctx.beginPath()
            ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
            ctx.fill()
        } else {
            ctx.fillRect(0, 0, width, height)
        }
        texture = PIXI.Texture.from(canvas)
    }

    resources.spriteMaskTextures.set(key, texture)
    resources.spriteMaskTextureKeys.set(key, textureKey)
    return texture
}

/**
 * Extract all mask SceneObjects from array in stable index order.
 * Ascending index guarantees "first-come-first-served" exclusive semantics,
 * consistent with deserialization / SetMaskHandler / evaluator slot merging conventions.
 */
function getOrderedMasks(objects: SceneObject[]): { mask: MaskObject; index: number }[] {
    const result: { mask: MaskObject; index: number }[] = []
    for (let i = 0; i < objects.length; i++) {
        const o = objects[i]!
        if (o.type === 'mask') {
            result.push({ mask: o as MaskObject, index: i })
        }
    }
    return result
}

/**
 * Whether the mask is active in the current frame (participating in clipping).
 * Phase 1 rules: mode must be inside_visible (other values downgraded by serializer), visible=true, and spawned !== false.
 */
function isMaskActive(mask: MaskObject): boolean {
    if (mask.mode !== 'inside_visible') return false
    if (mask.visible === false) return false
    if ((mask as SceneObject).spawned === false) return false
    return true
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Apply all masks to the current frame.
 *
 * Invocation timing: Final step before each frame render (after applyObjectState / parent-migration / camera transform,
 * before `renderer.render(stage)`), ensuring mask container and target container worldTransforms are updated.
 *
 * Algorithm:
 * 1) Collect active claims for this frame: for each id in targetIds of each mask (ordered ascending by objects array index),
 *    if the id has not been claimed by any mask in the same frame -> record active(targetId -> maskId); else warn and skip (first-come first-served).
 * 2) Tear down stale claims: entries in resources.claims that do not exist in active or have mismatched maskId, tear down wrapper and remove Graphics.
 * 3) Create / update active claims: create in-place wrapper around target, create missing Graphics and addChild to wrapper container;
 *    redraw shape each frame (cheap, idempotent), set Graphics localTransform to `inv(wrapper.worldTransform) * mask.worldTransform`.
 *
 * Math: local = inverse(wrapperWorld) * maskWorld, same semantics as PRD §11.3.
 */
export function applyAllMasks(
    objects: SceneObject[],
    getContainer: (id: string) => PIXI.Container | undefined | null,
    resources: MaskRendererResources,
): void {
    // Diagnostic log is silent by default. To debug in browser console:
    // localStorage.setItem('funny-animation-assistant.debug.mask', '1')
    const maskDebugEnabled = isDebugEnabled('mask')
    const w = maskDebugEnabled && typeof window !== 'undefined'
        ? window as unknown as { __MASK_LAST__?: string }
        : {} as { __MASK_LAST__?: string }
    const masksInObjects = objects.filter(o => o.type === 'mask') as MaskObject[]
    const sig = JSON.stringify(masksInObjects.map(m => ({
        id: m.id,
        t: m.targetIds,
        s: m.shape,
        w: m.width,
        h: m.height,
        x: m.x,
        y: m.y,
        sx: m.scaleX,
        sy: m.scaleY,
        r: m.rotation,
        ox: m.transformOriginX,
        oy: m.transformOriginY,
        v: m.visible,
        sp: (m as SceneObject).spawned,
    })))
    const sigChanged = maskDebugEnabled && sig !== w.__MASK_LAST__ && masksInObjects.length > 0
    if (sigChanged) {
        w.__MASK_LAST__ = sig
        const masksDump = masksInObjects.map(m => ({
            id: m.id,
            alias: m.alias,
            targetIds: [...(m.targetIds ?? [])],
            shape: m.shape,
            width: m.width,
            height: m.height,
            x: m.x,
            y: m.y,
            scaleX: m.scaleX,
            scaleY: m.scaleY,
            rotation: m.rotation,
            transformOriginX: m.transformOriginX,
            transformOriginY: m.transformOriginY,
            visible: m.visible,
            spawned: m.spawned,
        }))
        debugLog('mask', '[MASK-CHANGE] mask state changed\n' + JSON.stringify(masksDump, null, 2))
        const topLevel = objects.filter(o => !o.parentId).map(o => ({
            id: o.id,
            type: o.type,
            alias: (o as unknown as { alias?: string }).alias,
            parentId: o.parentId,
            childCount: ((o as unknown as { childIds?: string[] }).childIds ?? []).length,
        }))
        debugLog('mask', '[MASK-CHANGE] scene top-level object list (clipped objects should only be those in targetIds and their children)\n' + JSON.stringify(topLevel, null, 2))
    }
    // Step 1: build active claims from current frame
    const active = new Map<string, string>() // targetId → winning maskId
    const orderedMasks = getOrderedMasks(objects)
    if (sigChanged) debugLog('mask', '[mask-dbg] orderedMasks\n' + JSON.stringify(orderedMasks.map(m => ({ id: m.mask.id, targets: m.mask.targetIds, active: isMaskActive(m.mask) })), null, 2))
    for (const { mask } of orderedMasks) {
        if (!isMaskActive(mask)) continue
        const targetIds = Array.isArray(mask.targetIds) ? mask.targetIds : []
        for (const tid of targetIds) {
            if (active.has(tid)) {
                console.warn(`[mask] target ${tid} contested; granted to ${active.get(tid)} (mask ${mask.id} skipped)`)
                continue
            }
            // Verify target exists
            const tgtContainer = getContainer(tid)
            if (!tgtContainer) {
                debugWarn('mask', '[mask-dbg] target container missing\n' + JSON.stringify({ targetId: tid }, null, 2))
                continue
            }
            active.set(tid, mask.id)
        }
    }
    if (sigChanged && active.size > 0) debugLog('mask', '[mask-dbg] active claims\n' + JSON.stringify(Array.from(active.entries()), null, 2))

    // Step 2: tear down stale claims
    const stale: string[] = []
    for (const [targetId, currentMaskId] of resources.claims) {
        if (active.get(targetId) !== currentMaskId) {
            stale.push(targetId)
        }
    }
    for (const targetId of stale) {
        const currentMaskId = resources.claims.get(targetId)
        if (!currentMaskId) continue
        const target = getContainer(targetId)
        unwrapClaimWrapper(resources, targetId, target)
        if (target && isOwnedClipMaskValue(target.mask)) target.mask = resources.priorMasks.get(targetId) ?? null
        if (target) {
            const restoredFilters = removeOwnedSpriteMaskFilters(target.filters, resources)
            target.filters = restoredFilters.length > 0 ? restoredFilters : null
            if (resources.priorFilterAreas.has(targetId)) {
                const priorFilterArea = resources.priorFilterAreas.get(targetId)
                if (priorFilterArea) target.filterArea = priorFilterArea
                else delete (target as Partial<PIXI.Container>).filterArea
            }
        }
        resources.priorFilterAreas.delete(targetId)
        resources.priorMasks.delete(targetId)
        const key = makeKey(currentMaskId, targetId)
        const g = resources.graphics.get(key)
        if (g) {
            safeDestroyGraphics(g)
            resources.graphics.delete(key)
        }
        const spriteMask = resources.spriteMasks.get(key)
        if (spriteMask) {
            safeDestroySprite(spriteMask)
            resources.spriteMasks.delete(key)
        }
        const spriteFilter = resources.spriteFilters.get(key)
        if (spriteFilter) {
            spriteFilter.destroy()
            resources.spriteFilters.delete(key)
        }
        resources.maskData.delete(key)
        resources.claims.delete(targetId)
    }

    // Step 3: create / update active claims
    for (const [targetId, maskId] of active) {
        const target = getContainer(targetId)
        const maskContainer = getContainer(maskId)
        const maskObj = objects.find(o => o.id === maskId) as MaskObject | undefined
        if (!target || !maskContainer || !maskObj) {
            debugWarn('mask', '[mask-dbg] step3 missing\n' + JSON.stringify({ targetId, maskId, hasTarget: !!target, hasMaskContainer: !!maskContainer, hasObj: !!maskObj }, null, 2))
            continue
        }

        const wrapper = ensureWrapper(resources, targetId, target)
        if (!wrapper) {
            debugWarn('mask', '[mask-dbg] step3 missing target parent\n' + JSON.stringify({ targetId, maskId }, null, 2))
            continue
        }
        // Compatibility with prior temporary solution: if target still has residual SpriteMaskFilter from this pool, remove it and restore filterArea first.
        restoreTargetFilterState(resources, targetId, target)
        const maskGraphicsHost = wrapper.parent
        if (!maskGraphicsHost) {
            debugWarn('mask', '[mask-dbg] step3 missing wrapper parent\n' + JSON.stringify({ targetId, maskId }, null, 2))
            continue
        }

        const key = makeKey(maskId, targetId)
        let g = resources.graphics.get(key)
        if (!g) {
            g = new PIXI.Graphics()
            g.name = `${MASK_GRAPHICS_NAME_PREFIX}${key}`
            g.renderable = false
            // Cache preexisting mask on target (typically `text_box_mask` for fixed text),
            // restored when stale; only cache masks "not owned by this resource pool".
            if (target.mask && !resources.priorMasks.has(targetId)) {
                if (!isOwnedClipMaskValue(target.mask)) {
                    resources.priorMasks.set(targetId, target.mask)
                }
            }
            // mask Graphics must be attached to a visible parent container, and cannot be a descendant of the masked wrapper.
            // Attached here to wrapper.parent (usually content_layer) as a sibling of wrapper.
            maskGraphicsHost.addChild(g)
            resources.graphics.set(key, g)
            if (maskDebugEnabled) {
                const ancestors: string[] = []
                let cur: PIXI.Container | null = target
                while (cur) {
                    ancestors.push(cur.name ?? cur.constructor.name)
                    cur = cur.parent
                }
                const targetObj = objects.find(o => o.id === targetId)
                const mountInfo = {
                    targetId,
                    targetType: targetObj?.type,
                    targetAlias: (targetObj as unknown as { alias?: string })?.alias,
                    targetContainerName: target.name,
                    targetChildCount: target.children.length,
                    wrapperName: wrapper.name,
                    wrapperChildCount: wrapper.children.length,
                    ancestorChain: ancestors,
                    graphicsKey: key,
                    graphicsParent: maskGraphicsHost.name,
                }
                debugLog('mask', '[MASK-DEBUG] mask mounted (graphics parent = wrapper.parent)\n' + JSON.stringify(mountInfo, null, 2))
                try {
                    const dumpTree = (n: PIXI.DisplayObject, depth: number): string => {
                        const pad = '  '.repeat(depth)
                        const c = n as PIXI.Container
                        const tag = `${pad}${c.name ?? c.constructor.name}${c === target ? '  <<<TARGET>>>' : ''}${c.mask ? '  [HAS_MASK]' : ''}${(c as unknown as { isMask?: boolean }).isMask ? '  [IS_MASK]' : ''}`
                        const children = c.children.slice(0, 30)
                        return [tag, ...children.map(ch => dumpTree(ch, depth + 1))].join('\n')
                    }
                    let root: PIXI.Container = target
                    while (root.parent) root = root.parent
                    debugLog('mask', '[MASK-DEBUG] PIXI container tree:\n' + dumpTree(root, 0))
                } catch (e) {
                    debugWarn('mask', '[MASK-DEBUG] dumpTree failed', e)
                }
            }
        } else if (g.parent !== maskGraphicsHost) {
            // wrapper / target container destroyed and rebuilt: remount
            g.parent?.removeChild(g)
            maskGraphicsHost.addChild(g)
        }

        let spriteMask = resources.spriteMasks.get(key)
        if (!spriteMask) {
            spriteMask = new PIXI.Sprite(PIXI.Texture.WHITE)
            spriteMask.name = `${MASK_GRAPHICS_NAME_PREFIX}sprite__${key}`
            spriteMask.anchor.set(0.5)
            spriteMask.visible = true
            spriteMask.alpha = 1
            maskGraphicsHost.addChild(spriteMask)
            resources.spriteMasks.set(key, spriteMask)
        } else if (spriteMask.parent !== maskGraphicsHost) {
            spriteMask.parent?.removeChild(spriteMask)
            maskGraphicsHost.addChild(spriteMask)
        }

        // Redraw shape (cheap, idempotent; any change in shape/width/height will be overridden)
        g.visible = true
        g.alpha = 1
        drawMaskShape(g, maskObj)

        // local := inverse(maskGraphicsHost.worldTransform) × maskContainer.worldTransform
        // ⇒ g.worldTransform === maskGraphicsHost.worldTransform · local === maskContainer.worldTransform
        // Same semantics as PRD §11.3 "graphics.worldTransform equals mask container worldTransform".
        // In PIXI v7+, Matrix.append(other) semantics is this = this * other.
        if (maskGraphicsHost.parent) maskGraphicsHost.updateTransform()
        const hostWorldInv = maskGraphicsHost.worldTransform.clone().invert()
        const local = hostWorldInv.append(maskContainer.worldTransform)
        g.transform.setFromMatrix(local)
        // Force immediate update of worldTransform (PIXI MaskSystem reads g.worldTransform on push,
        // must take effect prior to this frame's render)
        g.updateTransform()

        const dimensions = resolveMaskDimensions(maskObj)
        const spriteMaskTexture = ensureSpriteMaskTexture(resources, key, maskObj, dimensions)
        if (spriteMask.texture !== spriteMaskTexture) {
            spriteMask.texture = spriteMaskTexture
        }
        const textureWidth = spriteMask.texture.orig.width || 1
        const textureHeight = spriteMask.texture.orig.height || 1
        const spriteLocal = local.clone().append(new PIXI.Matrix(
            dimensions.width / textureWidth,
            0,
            0,
            dimensions.height / textureHeight,
            0,
            0,
        ))
        spriteMask.transform.setFromMatrix(spriteLocal)
        spriteMask.updateTransform()

        // ⚠️ Crucial: Do not use DisplayObject.mask STENCIL/SCISSOR pipeline.
        //
        // active_layer has LightingFilter, verified in previous versions:
        //   - SCISSOR leaks to background due to screen-space / framebuffer coordinate mismatch.
        //   - After forcing STENCIL, Pixi binding, geometry, bounds are correct, but browser testing reveals wrapper still unclipped,
        //     indicating that under current filtered framebuffer path, stencil write/test does not affect wrapper subtree as expected.
        //
        // Hence we use SpriteMaskFilter attached to clip wrapper: RenderChainStage now renders the wrapper
        // when finding that target is wrapped by clip wrapper, rather than rendering target directly.
        // This ensures the filter only clips wrapper subtree, without leaking to background; and avoids stencil/scissor dependency.
        let spriteFilter = resources.spriteFilters.get(key)
        if (!spriteFilter) {
            spriteFilter = new PIXI.SpriteMaskFilter(spriteMask)
            resources.spriteFilters.set(key, spriteFilter)
        }
        spriteFilter.maskSprite = spriteMask
        wrapper.mask = null
        wrapper.filters = [spriteFilter]
        wrapper.filterArea = wrapper.getBounds(true)
        const maskDebugKey = `__MASK_POST_ASSIGN__${key}`
        if (maskDebugEnabled && (sigChanged || (w as unknown as Record<string, unknown>)[maskDebugKey] !== sig)) {
            ;(w as unknown as Record<string, unknown>)[maskDebugKey] = sig
            const wrapperMask = wrapper.mask as PIXI.MaskData | PIXI.Container | null
            const wrapperInternalMask = (wrapper as unknown as { _mask?: PIXI.MaskData | PIXI.Container | null })._mask
            const graphicsInternals = g as unknown as { _maskRefCount?: number; _geometry?: { graphicsData?: unknown[] } }
            const wrapperFilters = (wrapper as unknown as { filters?: PIXI.Filter[] | null }).filters
            const targetFilters = (target as unknown as { filters?: PIXI.Filter[] | null }).filters
            const diagnostic = {
                targetId,
                maskId,
                key,
                maskObject: {
                    shape: maskObj.shape,
                    rawWidth: dimensions.rawWidth,
                    rawHeight: dimensions.rawHeight,
                    drawWidth: dimensions.width,
                    drawHeight: dimensions.height,
                    x: maskObj.x,
                    y: maskObj.y,
                    scaleX: maskObj.scaleX,
                    scaleY: maskObj.scaleY,
                    rotation: maskObj.rotation,
                    transformOriginX: maskObj.transformOriginX,
                    transformOriginY: maskObj.transformOriginY,
                    visible: maskObj.visible,
                    spawned: maskObj.spawned,
                    aspectRatio: dimensions.height !== 0 ? dimensions.width / dimensions.height : null,
                },
                targetObject: objects.find(o => o.id === targetId) ? {
                    type: objects.find(o => o.id === targetId)?.type,
                    alias: (objects.find(o => o.id === targetId) as unknown as { alias?: string })?.alias,
                    compositeMode: (objects.find(o => o.id === targetId) as unknown as { compositeMode?: string })?.compositeMode,
                    width: (objects.find(o => o.id === targetId) as unknown as { width?: number })?.width,
                    height: (objects.find(o => o.id === targetId) as unknown as { height?: number })?.height,
                    x: objects.find(o => o.id === targetId)?.x,
                    y: objects.find(o => o.id === targetId)?.y,
                    scaleX: objects.find(o => o.id === targetId)?.scaleX,
                    scaleY: objects.find(o => o.id === targetId)?.scaleY,
                } : null,
                possibleCompositeOutput: describePossibleCompositeOutput(target),
                pixiMaskBinding: {
                    wrapperMaskIsMaskData: (wrapperMask as PIXI.MaskData | null)?.isMaskData === true,
                    wrapperMaskIsNull: wrapperMask === null,
                    wrapperInternalMaskIsNull: wrapperInternalMask === null,
                    wrapperFilterCount: wrapperFilters?.length ?? 0,
                    wrapperFilterIsSpriteMask: wrapperFilters?.[0] === spriteFilter,
                    targetFilterCount: targetFilters?.length ?? 0,
                    targetFilterIncludesSpriteMask: targetFilters?.includes(spriteFilter) === true,
                    spriteFilterMaskSpriteEqualsSprite: spriteFilter.maskSprite === spriteMask,
                    graphicsIsMask: g.isMask,
                    graphicsMaskRefCount: graphicsInternals._maskRefCount,
                    graphicsRenderable: g.renderable,
                    graphicsVisible: g.visible,
                    graphicsAlpha: g.alpha,
                    graphicsDataCount: graphicsInternals._geometry?.graphicsData?.length,
                    spriteRenderable: spriteMask.renderable,
                    spriteVisible: spriteMask.visible,
                    spriteAlpha: spriteMask.alpha,
                    spriteTextureValid: spriteMask.texture.valid,
                },
                parents: {
                    wrapper: parentChain(wrapper),
                    target: parentChain(target),
                    graphics: parentChain(g),
                    maskContainer: parentChain(maskContainer),
                },
                transforms: {
                    wrapperWorld: matrixToJson(wrapper.worldTransform),
                    targetWorld: matrixToJson(target.worldTransform),
                    maskContainerWorld: matrixToJson(maskContainer.worldTransform),
                    graphicsWorld: matrixToJson(g.worldTransform),
                    graphicsLocal: matrixToJson(g.localTransform),
                    spriteWorld: matrixToJson(spriteMask.worldTransform),
                    spriteLocal: matrixToJson(spriteMask.localTransform),
                    hostWorld: matrixToJson(maskGraphicsHost.worldTransform),
                },
                bounds: {
                    wrapper: rectToJson(wrapper.getBounds(true)),
                    target: rectToJson(target.getBounds(true)),
                    maskContainer: rectToJson(maskContainer.getBounds(true)),
                    graphics: rectToJson(g.getBounds(true)),
                    sprite: rectToJson(spriteMask.getBounds(true)),
                    host: rectToJson(maskGraphicsHost.getBounds(true)),
                    wrapperFilterArea: wrapper.filterArea ? rectToJson(wrapper.filterArea) : null,
                    targetFilterArea: target.filterArea ? rectToJson(target.filterArea) : null,
                },
            }
            debugLog('mask', '[MASK-DEBUG] post mask bind diagnostics\n' + JSON.stringify(diagnostic, null, 2))
        }
        if (sigChanged) debugLog('mask', '[mask-dbg] applied\n' + JSON.stringify({
            key,
            filter: 'spriteMask',
            wrapperWorld: { tx: wrapper.worldTransform.tx, ty: wrapper.worldTransform.ty },
            targetWorld: { tx: target.worldTransform.tx, ty: target.worldTransform.ty },
            maskWorld: { tx: maskContainer.worldTransform.tx, ty: maskContainer.worldTransform.ty },
            hostWorld: { tx: maskGraphicsHost.worldTransform.tx, ty: maskGraphicsHost.worldTransform.ty },
            spriteWorld: { tx: spriteMask.worldTransform.tx, ty: spriteMask.worldTransform.ty },
            shape: maskObj.shape,
            width: maskObj.width,
            height: maskObj.height,
        }, null, 2))
        resources.claims.set(targetId, maskId)
    }
}

/**
 * Remove mask associations for a single object.
 * Usage:
 *   - When removing target: unwrap wrapper + clean references from resources.
 *   - When removing mask: iterate claims, remove all graphics owned by this mask.
 */
export function unwrapTarget(
    objectId: string,
    resources: MaskRendererResources,
    getContainer?: (id: string) => PIXI.Container | undefined | null,
): void {
    // Case A: Removed as a target
    const claimingMask = resources.claims.get(objectId)
    if (claimingMask) {
        const key = makeKey(claimingMask, objectId)
        const target = getContainer?.(objectId)
        unwrapClaimWrapper(resources, objectId, target)
        if (target) restoreTargetFilterState(resources, objectId, target)
        const g = resources.graphics.get(key)
        if (g) {
            safeDestroyGraphics(g)
            resources.graphics.delete(key)
        }
        const spriteMask = resources.spriteMasks.get(key)
        if (spriteMask) {
            safeDestroySprite(spriteMask)
            resources.spriteMasks.delete(key)
        }
        safeDestroyTexture(resources.spriteMaskTextures.get(key))
        resources.spriteMaskTextures.delete(key)
        resources.spriteMaskTextureKeys.delete(key)
        const spriteFilter = resources.spriteFilters.get(key)
        if (spriteFilter) {
            spriteFilter.destroy()
            resources.spriteFilters.delete(key)
        }
        resources.maskData.delete(key)
        if (target && isOwnedClipMaskValue(target.mask)) target.mask = resources.priorMasks.get(objectId) ?? null
        resources.priorMasks.delete(objectId)
        resources.priorFilterAreas.delete(objectId)
        resources.claims.delete(objectId)
    }
    // Case B: Removed as a mask (id is mask)
    const tids: string[] = []
    for (const [tid, mid] of resources.claims) {
        if (mid === objectId) tids.push(tid)
    }
    for (const tid of tids) {
        const key = makeKey(objectId, tid)
        const target = getContainer?.(tid)
        unwrapClaimWrapper(resources, tid, target)
        if (target) restoreTargetFilterState(resources, tid, target)
        const g = resources.graphics.get(key)
        if (g) {
            safeDestroyGraphics(g)
            resources.graphics.delete(key)
        }
        const spriteMask = resources.spriteMasks.get(key)
        if (spriteMask) {
            safeDestroySprite(spriteMask)
            resources.spriteMasks.delete(key)
        }
        safeDestroyTexture(resources.spriteMaskTextures.get(key))
        resources.spriteMaskTextures.delete(key)
        resources.spriteMaskTextureKeys.delete(key)
        const spriteFilter = resources.spriteFilters.get(key)
        if (spriteFilter) {
            spriteFilter.destroy()
            resources.spriteFilters.delete(key)
        }
        resources.maskData.delete(key)
        if (target && isOwnedClipMaskValue(target.mask)) target.mask = resources.priorMasks.get(tid) ?? null
        resources.priorMasks.delete(tid)
        resources.priorFilterAreas.delete(tid)
        resources.claims.delete(tid)
    }
}

/**
 * Unmount / reset renderer: Destroy all Graphics, clear indexes.
 *
 * Fault tolerance: In Vue beforeUnmount -> cleanup pipeline, PIXI stage usually cascade-destroys
 * child nodes (including Graphics in this pool) beforehand. Calling `g.destroy()` again would throw
 * `Cannot read properties of null (reading 'refCount')`.
 * Therefore we use try/catch fallback; and check destroyed flags where possible.
 */
export function disposeMaskRendererResources(resources: MaskRendererResources): void {
    for (const targetId of resources.wrappers.keys()) {
        unwrapClaimWrapper(resources, targetId)
    }
    for (const g of resources.graphics.values()) {
        safeDestroyGraphics(g)
    }
    for (const spriteMask of resources.spriteMasks.values()) {
        safeDestroySprite(spriteMask)
    }
    for (const texture of resources.spriteMaskTextures.values()) {
        safeDestroyTexture(texture)
    }
    for (const spriteFilter of resources.spriteFilters.values()) {
        spriteFilter.destroy()
    }
    resources.graphics.clear()
    resources.spriteMasks.clear()
    resources.spriteMaskTextures.clear()
    resources.spriteMaskTextureKeys.clear()
    resources.spriteFilters.clear()
    resources.maskData.clear()
    resources.wrappers.clear()
    resources.claims.clear()
    resources.priorFilterAreas.clear()
    resources.priorMasks.clear()
}

function restoreTargetFilterState(resources: MaskRendererResources, targetId: string, target: PIXI.Container): void {
    const restoredFilters = removeOwnedSpriteMaskFilters(target.filters, resources)
    target.filters = restoredFilters.length > 0 ? restoredFilters : null
    if (resources.priorFilterAreas.has(targetId)) {
        const priorFilterArea = resources.priorFilterAreas.get(targetId)
        if (priorFilterArea) target.filterArea = priorFilterArea
        else delete (target as Partial<PIXI.Container>).filterArea
    }
}

function safeDestroyGraphics(g: PIXI.Graphics): void {
    const destroyed = (g as unknown as { destroyed?: boolean }).destroyed
    if (destroyed) return
    try {
        g.parent?.removeChild(g)
    } catch { /* PIXI internal already unlinked; ignore */ }
    try {
        g.destroy()
    } catch { /* Resource already destroyed by parent cascade; ignore */ }
}

function safeDestroySprite(sprite: PIXI.Sprite): void {
    const destroyed = (sprite as unknown as { destroyed?: boolean }).destroyed
    if (destroyed) return
    try {
        sprite.parent?.removeChild(sprite)
    } catch { /* PIXI internal already unlinked; ignore */ }
    try {
        sprite.destroy({ texture: false, baseTexture: false })
    } catch { /* Resource already destroyed by parent cascade; ignore */ }
}
