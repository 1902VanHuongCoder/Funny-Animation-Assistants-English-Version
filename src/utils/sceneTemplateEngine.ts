/**
 * Scene template engine
 * v17: Multi-root flat list — Snapshot (Canvas -> Template) and Instantiation (Template -> Canvas)
 */

import type { CompositeObject, MaskObject, SceneObject, ScreenEffectObject } from '@/types/sceneObject'
import type { SceneTemplate } from '@/types/sceneTemplate'

/**
 * Generate unique ID (consistent with Store ID generation rules)
 */
function generateObjectId(): string {
    return `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Deep clones scene object, removing runtime fields and internal architecture state
 *
 * Cleanup rules:
 * - `_` prefix fields: PIXI runtime state (e.g. _runtimeUrl)
 * - `spawned`: Internal dual-layer architecture flag (Setup/Action lifecycle state).
 *   Templates are self-contained reusable object collections, all objects inherently "alive".
 *   This field must not leak into template data.
 */
function cloneObjectClean(obj: SceneObject): SceneObject {
    // Deep clone via JSON serialization (skips undefined values, compatible with exactOptionalPropertyTypes)
    const raw = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>
    // Remove runtime fields
    for (const key of Object.keys(raw)) {
        if (key.startsWith('_')) {
            delete raw[key]
        }
    }
    // Remove internal architecture state
    delete raw['spawned']

    // v19 fix: normalize composite locked state
    // Prevents leftover compositeLocked: false from contaminating instantiated state
    if (raw['type'] === 'composite') {
        raw['compositeLocked'] = true
    }

    return raw as unknown as SceneObject
}

/**
 * Recursively collects all child objects of composite (including nested composites)
 *
 * @param rootId Root composite object ID
 * @param allObjects All objects in current scene
 * @returns Array of child objects in topological order (parent first)
 */
function collectChildObjects(rootId: string, allObjects: SceneObject[]): SceneObject[] {
    const result: SceneObject[] = []
    const visited = new Set<string>()

    function collect(parentId: string): void {
        const composite = allObjects.find(o => o.id === parentId)
        if (composite?.type !== 'composite') return

        const comp = composite as CompositeObject
        for (const childId of comp.childIds) {
            if (visited.has(childId)) continue
            visited.add(childId)

            const child = allObjects.find(o => o.id === childId)
            if (!child) continue

            result.push(child)
            // Recursively collect nested composites
            if (child.type === 'composite') {
                collect(child.id)
            }
        }
    }

    collect(rootId)
    return result
}

/**
 * v17: Remap objectId references in animation definitions on object
 * - track type: targetObjectId on each track
 * '_self' remains unchanged; UUIDs remapped via idMap
 */
function remapAnimationObjectIds(obj: SceneObject, idMap: Map<string, string>): void {
    const animations = obj.animations
    if (!animations) return
    for (const anim of Object.values(animations)) {
        if (anim.type === 'track') {
            // v19 Fix: targetObjectId in track animation also needs remapping
            for (const track of anim.tracks) {
                if (track.targetObjectId && track.targetObjectId !== '_self' && idMap.has(track.targetObjectId)) {
                    (track as { targetObjectId: string }).targetObjectId = idMap.get(track.targetObjectId)!
                }
            }
        }
    }
}

function remapSceneObjectInternalRefs(obj: SceneObject, idMap: Map<string, string>): void {
    if (obj.type === 'mask') {
        const mask = obj as MaskObject
        mask.targetIds = (mask.targetIds ?? []).map(id => idMap.get(id) ?? id)
    }

    if (obj.type === 'screen_effect') {
        const effect = obj as ScreenEffectObject
        if (effect.params?.targetId && idMap.has(effect.params.targetId)) {
            effect.params = {
                ...effect.params,
                targetId: idMap.get(effect.params.targetId)!,
            }
        }
    }

    if (obj.type === 'composite') {
        const comp = obj as CompositeObject
        if (comp.instanceRootCompositeId && idMap.has(comp.instanceRootCompositeId)) {
            comp.instanceRootCompositeId = idMap.get(comp.instanceRootCompositeId)!
        }
    }
}

/**
 * Calculates geometric bounding box center of object collection
 */
function computeBoundingBoxCenter(objects: SceneObject[]): { cx: number; cy: number } {
    if (objects.length === 0) return { cx: 0, cy: 0 }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const obj of objects) {
        // Use visual bounds: center point +/- half-width/half-height (accounting for scale)
        const halfW = (obj.width * Math.abs(obj.scaleX ?? 1)) / 2
        const halfH = (obj.height * Math.abs(obj.scaleY ?? 1)) / 2
        const left = obj.x - halfW
        const right = obj.x + halfW
        const top = obj.y - halfH
        const bottom = obj.y + halfH
        if (left < minX) minX = left
        if (top < minY) minY = top
        if (right > maxX) maxX = right
        if (bottom > maxY) maxY = bottom
    }

    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

// ===== Snapshot (Save as Template) =====

/**
 * Creates scene template snapshot from selected objects in scene
 *
 * v17: Supports multi-root — receives multiple top-level objects, recursively collects children,
 * deduplicates and merges into flat list. Coordinates zeroed relative to bounding box center.
 *
 * @param selectedObjects List of selected top-level objects
 * @param allSceneObjects All objects in current scene (for recursively collecting composite children)
 * @param name Template name
 * @param tags Tag list
 * @param renderChain Optional scene-level render chain
 * @returns Scene template
 */
export function snapshotToTemplate(
    selectedObjects: SceneObject[],
    allSceneObjects: SceneObject[],
    name: string,
    tags?: string[],
    renderChain?: string[],
): SceneTemplate {
    // 1. Collect all objects to include (selected + recursive children), deduplicated
    const collectedIds = new Set<string>()
    const allCollected: SceneObject[] = []

    for (const obj of selectedObjects) {
        if (collectedIds.has(obj.id)) continue
        collectedIds.add(obj.id)
        allCollected.push(obj)

        // Recursively collect composite/symbol child objects
        if (obj.type === 'composite') {
            const children = collectChildObjects(obj.id, allSceneObjects)
            for (const child of children) {
                if (!collectedIds.has(child.id)) {
                    collectedIds.add(child.id)
                    allCollected.push(child)
                }
            }
        }
    }

    // 2. Deep clone all objects
    const clonedObjects = allCollected.map(obj => cloneObjectClean(obj))

    // 3. Normalize coordinates: zeroed against bounding box center of **top-level objects**
    // Composite children use local coordinates (relative to parent), do not participate in bounds calculation or offset
    const selectedIds = new Set(selectedObjects.map(o => o.id))
    const topLevelCloned = clonedObjects.filter(o => selectedIds.has(o.id))
    const { cx, cy } = computeBoundingBoxCenter(topLevelCloned)
    for (const obj of topLevelCloned) {
        obj.x -= cx
        obj.y -= cy
    }

    // 4. Clear parentId of top-level objects (templates are independent reusable units)
    for (const obj of clonedObjects) {
        if (selectedIds.has(obj.id)) {
            delete (obj as unknown as Record<string, unknown>)['parentId']
        }
    }

    // 5. Generate template ID
    const templateId = `stpl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const result: SceneTemplate = {
        id: templateId,
        name,
        createdAt: Date.now(),
        objects: clonedObjects,
        editorAnchor: { x: cx, y: cy },
    }

    // v19: Save scene-level render chain (passed from caller)
    if (renderChain && renderChain.length > 0) {
        const templateObjIds = new Set(clonedObjects.map(o => o.id))
        const filteredChain = renderChain.filter(id => templateObjIds.has(id))
        if (filteredChain.length > 0) {
            result.renderChain = filteredChain
        }
    }

    if (tags && tags.length > 0) {
        result.tags = tags
    }
    return result
}

/**
 * Builds template from canvas object collection (overall snapshot)
 *
 * v17: Directly saves all top-level objects as template without auto-wrapping composite.
 *
 * @param objects Objects on canvas (camera excluded)
 * @param allObjects All scene objects (including camera, for composite child recursion)
 * @param name Template name
 * @param tags Tag list
 * @param renderChain Scene render chain
 * @returns Scene template
 */
export function buildTemplateFromObjects(
    objects: SceneObject[],
    allObjects: SceneObject[],
    name: string,
    tags?: string[],
    renderChain?: string[],
): SceneTemplate {
    // Empty template
    if (objects.length === 0) {
        const templateId = `stpl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        const result: SceneTemplate = {
            id: templateId,
            name,
            createdAt: Date.now(),
            objects: [],
        }
        if (tags && tags.length > 0) {
            result.tags = tags
        }
        return result
    }

    // Find top-level objects (no parentId, or parentId points outside list)
    const objectIds = new Set(objects.map(o => o.id))
    const topLevelObjects = objects.filter(o => !o.parentId || !objectIds.has(o.parentId))

    // Directly use snapshotToTemplate without auto-wrapping composite
    return snapshotToTemplate(topLevelObjects, allObjects, name, tags, renderChain)
}

// ===== Instantiation (Create Objects from Template) =====

/** Instantiation result */
export interface InstantiateResult {
    /** Objects array in topological order (root first, children next) */
    objects: SceneObject[]
    /** Missing asset refId list (dependency validation failures) */
    missingRefs: string[]
    /** v19: Remapped scene-level render chain (valid when wrapper is not applied) */
    renderChain?: string[]
    /** Template object ID -> scene instance object ID mapping table */
    idMap: Map<string, string>
}

/**
 * Checks whether asset referenced by refId exists
 *
 * @param type Object type
 * @param refId Asset reference ID
 * @returns Whether asset exists
 */
type ResourceChecker = (type: string, refId: string) => boolean

/**
 * Instantiates scene objects from scene template
 *
 * v17: Traverses template.objects flat list, generates new ID for each object, and remaps references.
 * When autoWrapComposite is true and top-level objects > 1, creates entity composite wrapper automatically.
 *
 * @param template Scene template
 * @param dropX Drop target X coordinate
 * @param dropY Drop target Y coordinate
 * @param options Instantiation options
 * @returns Instantiation result
 */
export function instantiateTemplate(
    template: SceneTemplate,
    dropX: number,
    dropY: number,
    options?: {
        /** Asset existence checker function (skips validation if omitted) */
        resourceChecker?: ResourceChecker
        /** Whether multi-root template automatically wraps composite (default true) */
        autoWrapComposite?: boolean
        /** Outer wrapper composite mode (default 'union') */
        wrapperCompositeMode?: 'union' | 'entity'
    },
): InstantiateResult {
    const resourceChecker = options?.resourceChecker
    const autoWrapComposite = options?.autoWrapComposite ?? true

    // Empty template
    if (template.objects.length === 0) {
        return { objects: [], missingRefs: [], idMap: new Map() }
    }

    // 1. ID remapping table: old ID -> new ID
    const idMap = new Map<string, string>()
    for (const obj of template.objects) {
        idMap.set(obj.id, generateObjectId())
    }

    // 2. Deep clone and remap
    const objects: SceneObject[] = []
    const missingRefs: string[] = []

    for (const obj of template.objects) {
        const cloned = cloneObjectClean(obj)
        const newId = idMap.get(obj.id)
        if (!newId) {
            throw new Error(`[sceneTemplateEngine] Internal error: object ${obj.id} not found in ID mapping table`)
        }
        cloned.id = newId

        // Coordinate restoration: apply drop offset to top-level objects (no parentId) only
        // Composite children use local coordinates, should not add dropX/dropY
        if (!cloned.parentId) {
            cloned.x += dropX
            cloned.y += dropY
        }

        // Remap parentId
        if (cloned.parentId) {
            cloned.parentId = idMap.get(cloned.parentId) ?? cloned.parentId
        }

        // Remap childIds and renderChain (for Composite)
        if (cloned.type === 'composite') {
            const comp = cloned as CompositeObject
            comp.childIds = comp.childIds.map(oldId => idMap.get(oldId) ?? oldId)
            // v19: entity renderChain also needs remapping
            if (comp.renderChain) {
                comp.renderChain = comp.renderChain.map(oldId => idMap.get(oldId) ?? oldId)
            }
        }

        // v17: Remap objectId in animation definitions
        remapAnimationObjectIds(cloned, idMap)

        // v26: Remap object fields referencing internal template objects
        remapSceneObjectInternalRefs(cloned, idMap)

        // Dependency validation
        if (resourceChecker && cloned.refId) {
            if (!resourceChecker(cloned.type, cloned.refId)) {
                missingRefs.push(cloned.refId)
            }
        }

        objects.push(cloned)
    }

    // v19: Remap scene-level renderChain of template
    let remappedRenderChain: string[] | undefined
    if (template.renderChain && template.renderChain.length > 0) {
        remappedRenderChain = template.renderChain
            .map(oldId => idMap.get(oldId))
            .filter((id): id is string => id !== undefined)
    }

    // 3. Auto wrapping: create entity composite wrapper when top-level objects > 1 or single root is union composite
    if (autoWrapComposite) {
        const topLevelObjects = objects.filter(o => !o.parentId)
        const singleUnionRoot = topLevelObjects.length === 1
            && topLevelObjects[0]!.type === 'composite'
            && (topLevelObjects[0] as CompositeObject).compositeMode === 'union'
        if (topLevelObjects.length > 1 || singleUnionRoot) {
            const wrapperComposite: CompositeObject = {
                id: generateObjectId(),
                type: 'composite',
                name: template.name,
                alias: template.name,
                refId: '',
                x: dropX,
                y: dropY,
                width: 0,
                height: 0,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                alpha: 1,
                flipX: false,
                visible: true,
                zIndex: 0,
                childIds: topLevelObjects.map(o => o.id),
                compositeLocked: true,
                // Wrapper layer fixed to entity mode (ensures lifecycle cascade)
                compositeMode: 'entity',
            }

            // v19: entity wrapper sets renderChain (converted from template scene-level renderChain)
            if (remappedRenderChain && remappedRenderChain.length > 0) {
                wrapperComposite.renderChain = remappedRenderChain
            }

            // Set parentId for all top-level objects and convert to local coordinates
            // Composite scale=1, rotation=0, simplifies to subtracting composite position
            for (const obj of topLevelObjects) {
                obj.parentId = wrapperComposite.id
                obj.x -= wrapperComposite.x
                obj.y -= wrapperComposite.y
            }

            // Prepend wrapper to head (topological order: root first, children after)
            objects.unshift(wrapperComposite)
        }
    }

    const result: InstantiateResult = { objects, missingRefs, idMap }
    if (remappedRenderChain) {
        result.renderChain = remappedRenderChain
    }
    return result
}

/**
 * Generate unique alias (avoids duplicate naming)
 *
 * @param baseName Base name
 * @param existingAliases List of existing aliases
 * @returns Unique alias
 */
export function generateUniqueAlias(baseName: string, existingAliases: string[]): string {
    if (!existingAliases.includes(baseName)) return baseName

    for (let i = 1; i <= 999; i++) {
        const candidate = `${baseName}${i}`
        if (!existingAliases.includes(candidate)) return candidate
    }

    return `${baseName}_${Date.now()}`
}

// ===== Thumbnail Generation =====

/**
 * v16: Generates template thumbnail from PIXI renderer
 *
 * @param pixiApp PIXI.Application instance
 * @param maxSize Maximum thumbnail size (default 256px)
 * @returns base64 data URL (image/png)
 */
export function generateTemplateThumbnail(
    pixiApp: { renderer: { extract: { canvas: (target: unknown) => HTMLCanvasElement } }; stage: unknown },
    maxSize = 256,
): string {
    // Extract canvas from PIXI stage
    const canvas = pixiApp.renderer.extract.canvas(pixiApp.stage)

    // Scale to max size
    const thumbCanvas = document.createElement('canvas')
    const scale = Math.min(maxSize / canvas.width, maxSize / canvas.height, 1)
    thumbCanvas.width = Math.round(canvas.width * scale)
    thumbCanvas.height = Math.round(canvas.height * scale)

    const ctx = thumbCanvas.getContext('2d')
    if (!ctx) {
        throw new Error('[sceneTemplateEngine] Failed to create 2D Canvas Context')
    }
    ctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height)

    return thumbCanvas.toDataURL('image/png')
}
