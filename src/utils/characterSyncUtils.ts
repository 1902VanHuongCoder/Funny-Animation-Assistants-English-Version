/**
 * Cross-character structure / animation sync and copy utility
 *
 * "Flatten -> Recompose" strategy:
 * 1. Flatten target character into leaf nodes
 * 2. Match names (alias) with source character leaf nodes
 * 3. Copy source character's composite skeleton structure
 * 4. Fill matched leaf nodes into skeleton
 * 5. Copy animation definitions, remapping all ID references
 */

import type { AnimationDefinition, AnimationTrack, TrackAnimationDefinition } from '@/types/animation'
import type { CompositeObject, SceneObject } from '@/types/sceneObject'
import { generateId } from '@/utils/uuid'

// ===== Public Types =====

/** Name match result */
export interface NameMatchResult {
    /** Source leaf ID -> Target leaf ID */
    leafIdMap: Map<string, string>
    /** Source composite ID -> newly generated composite ID */
    compositeIdMap: Map<string, string>
    /** Comprehensive mapping: source any object ID -> target object ID (union of leafIdMap + compositeIdMap) */
    fullIdMap: Map<string, string>
    /** Leaf node aliases present only in source */
    sourceOnly: string[]
    /** Leaf node aliases present only in target */
    targetOnly: string[]
    /** Successfully matched aliases */
    matched: string[]
}

/** Synchronization result */
export interface CharacterSyncResult {
    /** Recomposed full object list (directly replaces CompositeCharacter.objects) */
    objects: SceneObject[]
    /** Match information (for UI preview) */
    matchResult: NameMatchResult
    /** Names of skipped animations (when all track targets cannot be mapped) */
    skippedAnimations: string[]
    /** Names of partially trimmed animations (unmappable tracks removed) */
    trimmedAnimations: string[]
}

// ===== Helper Utilities =====

/** Determine whether object is composite */
function isComposite(obj: SceneObject): obj is CompositeObject {
    return obj.type === 'composite'
}

/** Get matching name for object (prefers alias, falls back to name) */
function getMatchName(obj: SceneObject): string {
    const trimmed = obj.alias?.trim()
    return (trimmed && trimmed.length > 0) ? trimmed : obj.name
}

/** Generate new SceneObject ID */
function newObjectId(): string {
    return generateId('sceneobject')
}

/** Generate new Animation ID */
function newAnimationId(): string {
    return generateId('animation')
}

// ===== Core Functions =====

/**
 * Collect all leaf nodes (non-composite SceneObjects)
 *
 * @param objects Flat SceneObject list
 * @returns alias -> SceneObject map (duplicate aliases keep first occurrence only)
 */
export function collectLeafNodes(objects: readonly SceneObject[]): Map<string, SceneObject> {
    const result = new Map<string, SceneObject>()
    for (const obj of objects) {
        if (isComposite(obj)) continue
        const name = getMatchName(obj)
        if (!result.has(name)) {
            result.set(name, obj)
        }
    }
    return result
}

/**
 * Collect all composite nodes
 */
function collectCompositeNodes(objects: readonly SceneObject[]): CompositeObject[] {
    return objects.filter(isComposite)
}

/**
 * Build name matching
 *
 * @param sourceObjects Source character objects list
 * @param targetObjects Target character objects list
 * @returns Matching result
 */
export function buildNameMatch(
    sourceObjects: readonly SceneObject[],
    targetObjects: readonly SceneObject[],
): NameMatchResult {
    const sourceLeaves = collectLeafNodes(sourceObjects)
    const targetLeaves = collectLeafNodes(targetObjects)
    const sourceComposites = collectCompositeNodes(sourceObjects)

    const leafIdMap = new Map<string, string>()
    const matched: string[] = []
    const sourceOnly: string[] = []
    const targetOnly: string[] = []

    // 1. Match leaf nodes by alias
    for (const [alias, sourceObj] of sourceLeaves) {
        const targetObj = targetLeaves.get(alias)
        if (targetObj) {
            leafIdMap.set(sourceObj.id, targetObj.id)
            matched.push(alias)
        } else {
            sourceOnly.push(alias)
        }
    }

    // 2. Find leaf nodes present only in target
    for (const alias of targetLeaves.keys()) {
        if (!sourceLeaves.has(alias)) {
            targetOnly.push(alias)
        }
    }

    // 3. Generate new ID for each source composite
    const compositeIdMap = new Map<string, string>()
    for (const comp of sourceComposites) {
        compositeIdMap.set(comp.id, newObjectId())
    }

    // 4. Merge mappings
    const fullIdMap = new Map<string, string>([
        ...leafIdMap.entries(),
        ...compositeIdMap.entries(),
    ])

    return {
        leafIdMap,
        compositeIdMap,
        fullIdMap,
        sourceOnly,
        targetOnly,
        matched,
    }
}

/**
 * Remap all ID references in animation definitions
 *
 * @param animations Source animation dictionary
 * @param idMap Full ID mapping table
 * @returns Remapped animations and list of skipped/trimmed animation names
 */
export function remapAnimationDefinitions(
    animations: Record<string, AnimationDefinition>,
    idMap: Map<string, string>,
): { remapped: Record<string, AnimationDefinition>; skipped: string[]; trimmed: string[] } {
    const remapped: Record<string, AnimationDefinition> = {}
    const skipped: string[] = []
    const trimmed: string[] = []

    for (const [_oldId, anim] of Object.entries(animations)) {
        const newAnimId = newAnimationId()
        const now = Date.now()

        if (anim.type === 'track') {
            const result = remapTrackAnimation(anim, newAnimId, now, idMap)
            if (result === null) {
                skipped.push(anim.name)
            } else {
                if (result.trimmed) {
                    trimmed.push(anim.name)
                }
                remapped[newAnimId] = result.animation
            }
        }
    }

    return { remapped, skipped, trimmed }
}

/** Remap track animation */
function remapTrackAnimation(
    anim: TrackAnimationDefinition,
    newId: string,
    now: number,
    idMap: Map<string, string>,
): { animation: TrackAnimationDefinition; trimmed: boolean } | null {
    const newTracks: AnimationTrack[] = []
    let trimmedCount = 0

    for (const track of anim.tracks) {
        const targetId = track.targetObjectId
        if (targetId === undefined || targetId === '_self') {
            // No target or self reference -> copy directly
            newTracks.push(deepCopyTrack(track))
        } else {
            const mappedId = idMap.get(targetId)
            if (mappedId !== undefined) {
                const newTrack = deepCopyTrack(track)
                newTrack.targetObjectId = mappedId
                newTracks.push(newTrack)
            } else {
                // Target unmappable -> remove track
                trimmedCount++
            }
        }
    }

    if (newTracks.length === 0) {
        return null // All tracks unmappable -> skip entire animation
    }

    return {
        animation: {
            ...JSON.parse(JSON.stringify(anim)) as TrackAnimationDefinition,
            id: newId,
            tracks: newTracks,
            createdAt: now,
            updatedAt: now,
        },
        trimmed: trimmedCount > 0,
    }
}

/** Deep copy single track */
function deepCopyTrack(track: AnimationTrack): AnimationTrack {
    const copied = JSON.parse(JSON.stringify(track)) as AnimationTrack
    // When importing across characters, transform track pivot uses source object local pixel coordinates.
    // Different characters have different part sizes/offsets; retaining it causes pivot misalignments.
    // Deleting it lets runtime fall back to target object's own default transform origin.
    if (copied.trackType === 'transform') {
        delete copied.pivot
    }
    return copied
}

/**
 * Execute cross-character structure/animation sync copy (main pipeline)
 *
 * Coordinate handling strategy (preserves target character part canvas positions):
 * 1. Flatten stage: convert target leaf local coordinates to global coordinates
 * 2. Skeleton copy: duplicate source composite hierarchy (without coordinates)
 * 3. Rebuild stage: bottom-up calculation of composite centroid, converting child global coords to local
 *
 * @param sourceObjects Source character objects list
 * @param targetObjects Target character objects list
 * @returns Sync result (including recomposed objects list)
 */
export function syncCharacterStructure(
    sourceObjects: readonly SceneObject[],
    targetObjects: readonly SceneObject[],
): CharacterSyncResult {
    // Step 1: Name matching
    const matchResult = buildNameMatch(sourceObjects, targetObjects)

    // Step 2: Flatten target -> leaf node pool (indexed by alias), convert coordinates to global
    const targetLeafPool = collectLeafNodes(targetObjects)
    const targetObjMap = new Map<string, SceneObject>()
    for (const obj of targetObjects) {
        targetObjMap.set(obj.id, obj)
    }

    // Convert all leaf coordinates to global coordinates
    const worldCoords = new Map<string, { x: number; y: number; scaleX: number; scaleY: number; rotation: number }>()
    for (const [alias, leaf] of targetLeafPool) {
        const world = computeWorldTransform(leaf, targetObjMap)
        worldCoords.set(alias, world)
    }

    // Step 3: Copy source composite skeleton (coordinates calculated bottom-up later)
    const sourceComposites = collectCompositeNodes(sourceObjects)
    const newComposites: CompositeObject[] = []

    for (const sourceComp of sourceComposites) {
        const newId = matchResult.compositeIdMap.get(sourceComp.id)
        if (newId === undefined) {
            throw new Error(`[characterSyncUtils] composite ID ${sourceComp.id} not found in mapping`)
        }

        // Deep copy composite, replace ID
        const newComp = JSON.parse(JSON.stringify(sourceComp)) as CompositeObject

        newComp.id = newId

        // Zero out coordinates (recomputed bottom-up later)
        newComp.x = 0
        newComp.y = 0
        newComp.scaleX = 1
        newComp.scaleY = 1
        newComp.rotation = 0

        // Replace parentId
        if (newComp.parentId) {
            const mappedParent = matchResult.fullIdMap.get(newComp.parentId)
            if (mappedParent !== undefined) {
                newComp.parentId = mappedParent
            } else {
                // Parent unmappable -> clear parentId (make top-level)
                delete newComp.parentId
            }
        }

        // Replace childIds — keep only mappable ones
        newComp.childIds = sourceComp.childIds
            .map(childId => matchResult.fullIdMap.get(childId))
            .filter((id): id is string => id !== undefined)

        // Replace renderChain
        if (sourceComp.renderChain) {
            newComp.renderChain = sourceComp.renderChain
                .map(id => matchResult.fullIdMap.get(id))
                .filter((id): id is string => id !== undefined)
        }

        // Clear animations on source composite (copied later with remapping)
        delete newComp.animations

        newComposites.push(newComp)
    }

    // Step 4: Populate matched leaf nodes into new skeleton (using global coordinates)
    const sourceLeaves = collectLeafNodes(sourceObjects)
    const placedLeaves: SceneObject[] = []
    const placedLeafAliases = new Set<string>()

    for (const [alias, sourceLeaf] of sourceLeaves) {
        const targetLeaf = targetLeafPool.get(alias)
        if (!targetLeaf) continue // sourceOnly -> skip

        // Deep copy target leaf node (preserving assets and styling)
        const newLeaf = JSON.parse(JSON.stringify(targetLeaf)) as SceneObject

        // Write global coordinates first (converted to local during bottom-up step)
        const world = worldCoords.get(alias)
        if (world) {
            newLeaf.x = world.x
            newLeaf.y = world.y
            newLeaf.scaleX = world.scaleX
            newLeaf.scaleY = world.scaleY
            newLeaf.rotation = world.rotation
        }

        // Update parentId to recomposed parent
        if (sourceLeaf.parentId) {
            const mappedParent = matchResult.fullIdMap.get(sourceLeaf.parentId)
            if (mappedParent !== undefined) {
                newLeaf.parentId = mappedParent
            } else {
                delete newLeaf.parentId
            }
        } else {
            delete newLeaf.parentId
        }

        placedLeaves.push(newLeaf)
        placedLeafAliases.add(alias)
    }

    // Step 5: Copy animations on source composite nodes (with ID remapping)
    const allSkipped: string[] = []
    const allTrimmed: string[] = []

    for (const sourceComp of sourceComposites) {
        if (!sourceComp.animations || Object.keys(sourceComp.animations).length === 0) continue

        const newCompId = matchResult.compositeIdMap.get(sourceComp.id)
        if (newCompId === undefined) continue

        const targetComp = newComposites.find(c => c.id === newCompId)
        if (!targetComp) continue

        const { remapped, skipped, trimmed } = remapAnimationDefinitions(
            sourceComp.animations,
            matchResult.fullIdMap,
        )

        targetComp.animations = remapped
        allSkipped.push(...skipped)
        allTrimmed.push(...trimmed)
    }

    // Step 6: Handle target-only leaf nodes -> append to root composite
    const targetOnlyLeaves: SceneObject[] = []
    for (const alias of matchResult.targetOnly) {
        const leaf = targetLeafPool.get(alias)
        if (!leaf) continue

        const newLeaf = JSON.parse(JSON.stringify(leaf)) as SceneObject

        // Write global coordinates
        const world = worldCoords.get(alias)
        if (world) {
            newLeaf.x = world.x
            newLeaf.y = world.y
            newLeaf.scaleX = world.scaleX
            newLeaf.scaleY = world.scaleY
            newLeaf.rotation = world.rotation
        }

        targetOnlyLeaves.push(newLeaf)
    }

    // Find root composite (composite without parentId)
    const rootComposite = newComposites.find(c => !c.parentId)
    if (rootComposite && targetOnlyLeaves.length > 0) {
        // Append to root composite childIds and renderChain (preserving single root)
        for (const leaf of targetOnlyLeaves) {
            leaf.parentId = rootComposite.id
            rootComposite.childIds.push(leaf.id)
            if (rootComposite.renderChain) {
                rootComposite.renderChain.push(leaf.id)
            }
        }
    } else if (targetOnlyLeaves.length > 0) {
        // Source itself has multiple roots -> targetOnly leaves also become top-level
        for (const leaf of targetOnlyLeaves) {
            delete leaf.parentId
        }
    }

    // Step 7: Bottom-up coordinate transform — calculate composite centroid, child global -> local
    // Build id -> object index
    const allObjects = [...newComposites, ...placedLeaves, ...targetOnlyLeaves]
    const objIndex = new Map<string, SceneObject>()
    for (const obj of allObjects) {
        objIndex.set(obj.id, obj)
    }

    // Topological sort (bottom-up): leaf nodes and childless composites processed first
    const sortedComposites = topologicalSortBottomUp(newComposites)

    for (const comp of sortedComposites) {
        // Collect direct children (currently possessing global coordinates)
        const children: SceneObject[] = []
        for (const childId of comp.childIds) {
            const child = objIndex.get(childId)
            if (child) children.push(child)
        }

        if (children.length === 0) continue

        // Calculate composite position = centroid of children global coordinates
        let sumX = 0
        let sumY = 0
        for (const child of children) {
            sumX += child.x
            sumY += child.y
        }
        comp.x = sumX / children.length
        comp.y = sumY / children.length
        // Composite scale/rotation remains 1/0 (pure structural container)

        // Convert child global coordinates to local coordinates relative to composite
        for (const child of children) {
            child.x -= comp.x
            child.y -= comp.y
            // scale/rotation invariant (composite has scale=1, rotation=0)
        }
    }

    // Step 8: Assemble final objects list
    // Order: composites first, leaves second (matches character storage convention)
    const finalObjects: SceneObject[] = [
        ...newComposites,
        ...placedLeaves,
        ...targetOnlyLeaves,
    ]

    return {
        objects: finalObjects,
        matchResult,
        skippedAnimations: allSkipped,
        trimmedAnimations: allTrimmed,
    }
}

/**
 * Calculate object global transform (accumulated upward along parentId chain)
 */
function computeWorldTransform(
    obj: SceneObject,
    objMap: Map<string, SceneObject>,
): { x: number; y: number; scaleX: number; scaleY: number; rotation: number } {
    // Collect parent chain from child to root
    const chain: SceneObject[] = []
    let current: SceneObject | undefined = obj
    while (current) {
        chain.push(current)
        current = current.parentId ? objMap.get(current.parentId) : undefined
    }

    // Accumulate transform from root to child
    // chain[chain.length-1] is root (no parent), chain[0] is target object
    let worldX = 0
    let worldY = 0
    let worldScaleX = 1
    let worldScaleY = 1
    let worldRotation = 0

    // Traverse root to leaf
    for (let i = chain.length - 1; i >= 0; i--) {
        const node = chain[i]!
        // localToGlobal: globalPos = parentPos + rotate(parentRot, scale(parentScale, localPos))
        const sx = node.x * worldScaleX
        const sy = node.y * worldScaleY

        const cosR = Math.cos(worldRotation)
        const sinR = Math.sin(worldRotation)

        worldX += sx * cosR - sy * sinR
        worldY += sx * sinR + sy * cosR

        worldScaleX *= node.scaleX
        worldScaleY *= node.scaleY
        worldRotation += node.rotation
    }

    return { x: worldX, y: worldY, scaleX: worldScaleX, scaleY: worldScaleY, rotation: worldRotation }
}

/**
 * Topologically sort composite list (bottom-up)
 * Leaf-level composites (no child composites) come first, root comes last
 */
function topologicalSortBottomUp(composites: CompositeObject[]): CompositeObject[] {
    const idSet = new Set(composites.map(c => c.id))
    const childCompositeCount = new Map<string, number>()

    // Count how many child composites each composite has (excluding leaf nodes)
    for (const comp of composites) {
        let count = 0
        for (const childId of comp.childIds) {
            if (idSet.has(childId)) count++
        }
        childCompositeCount.set(comp.id, count)
    }

    const result: CompositeObject[] = []
    const processed = new Set<string>()

    // BFS: starting from leaf level
    const queue = composites.filter(c => childCompositeCount.get(c.id) === 0)

    while (queue.length > 0) {
        const comp = queue.shift()!
        if (processed.has(comp.id)) continue
        processed.add(comp.id)
        result.push(comp)

        // Update parent count
        if (comp.parentId && idSet.has(comp.parentId)) {
            const parentCount = (childCompositeCount.get(comp.parentId) ?? 1) - 1
            childCompositeCount.set(comp.parentId, parentCount)
            if (parentCount === 0) {
                const parent = composites.find(c => c.id === comp.parentId)
                if (parent) queue.push(parent)
            }
        }
    }

    return result
}
