/**
 * Animation Store (v11.0)
 * Animation management Store, providing CRUD operations for resource-level Animations
 */

import { defineStore } from 'pinia'

import type {
    AnimationDefinition,
    AnimationDefinitionInput,
    AnimationListItem,
    AnimationResourceType,
    AnimationTrack,
    TrackAnimationDefinition,
} from '@/types/animation'
import type { SceneObject, SymbolObject } from '@/types/sceneObject'

import { useBackgroundStore } from './backgroundStore'
import { usePropStore } from './propStore'

/**
 * Estimate Animation duration
 * Max value based on duration of each track
 */
function estimateAnimationDuration(tracks: AnimationTrack[]): number {
    let maxDuration = 0
    for (const track of tracks) {
        if (track.trackType === 'transform' || track.trackType === 'visibility') {
            const duration = track.duration ?? 1000
            if (typeof duration === 'number' && duration > maxDuration) {
                maxDuration = duration
            }
        } else if (track.trackType === 'frame_sequence') {
            // Frame sequence track has no fixed duration, use default value
            maxDuration = Math.max(maxDuration, 1000)
        } else if (track.trackType === 'effect') {
            // Effect tracks are usually continuous, use default value
            maxDuration = Math.max(maxDuration, 1000)
        }
    }
    return maxDuration || 1000
}

/**
 * Convert AnimationDefinition to list item
 */
function toListItem(anim: AnimationDefinition): AnimationListItem {
    const tracks = anim.type === 'track' ? anim.tracks : []
    return {
        id: anim.id,
        name: anim.name,
        loop: anim.loop,
        trackCount: tracks.length,
        estimatedDuration: estimateAnimationDuration(tracks),
    }
}

export const useAnimationStore = defineStore('animation', () => {
    // ===== Read Operations =====

    // --- v16: Object-level animation read API ---

    /**
     * Get animation list from SceneObject.animations
     */
    function getObjectAnimations(object: SceneObject): AnimationDefinition[] {
        return Object.values(object.animations ?? {})
    }

    /**
     * Get animation by name from SceneObject.animations
     */
    function getObjectAnimationByName(
        object: SceneObject,
        animName: string,
    ): AnimationDefinition | undefined {
        return Object.values(object.animations ?? {})
            .find(a => a.name === animName)
    }

    // --- Resource-level animation read API ---

    /**
     * Get Animation list of resource
     */
    function getAnimations(
        resourceType: AnimationResourceType,
        resourceId: string
    ): AnimationDefinition[] {
        const animations = getAnimationsRecord(resourceType, resourceId)
        return Object.values(animations)
    }

    /**
     * Get Animation list items of resource (for UI display)
     */
    function getAnimationListItems(
        resourceType: AnimationResourceType,
        resourceId: string
    ): AnimationListItem[] {
        const animations = getAnimations(resourceType, resourceId)
        return animations.map(toListItem)
    }

    /**
     * Get single Animation
     */
    function getAnimation(
        resourceType: AnimationResourceType,
        resourceId: string,
        animationId: string
    ): AnimationDefinition | undefined {
        const animations = getAnimationsRecord(resourceType, resourceId)
        return animations[animationId]
    }

    /**
     * Get Animation by name
     */
    function getAnimationByName(
        resourceType: AnimationResourceType,
        resourceId: string,
        animationName: string
    ): AnimationDefinition | undefined {
        const animations = getAnimations(resourceType, resourceId)
        return animations.find(a => a.name === animationName)
    }


    // ===== Write Operations =====

    /**
     * Add Animation
     */
    function addAnimation(
        resourceType: AnimationResourceType,
        resourceId: string,
        animation: AnimationDefinitionInput
    ): AnimationDefinition {
        const now = Date.now()
        // type discriminant is preserved through spread; TS can't narrow unions
        // through spread so we assert — the input's `type` field guarantees correctness
        const newAnimation = {
            ...animation,
            id: `animation_${crypto.randomUUID()}`,
            createdAt: now,
            updatedAt: now,
        } as AnimationDefinition

        const animations = getAnimationsRecord(resourceType, resourceId)
        animations[newAnimation.id] = newAnimation
        setAnimationsRecord(resourceType, resourceId, animations)

        return newAnimation
    }

    /**
     * Update Animation
     */
    function updateAnimation(
        resourceType: AnimationResourceType,
        resourceId: string,
        animationId: string,
        updates: Partial<Omit<AnimationDefinition, 'id' | 'createdAt'>>
    ): AnimationDefinition | undefined {
        const animations = getAnimationsRecord(resourceType, resourceId)
        const existing = animations[animationId]
        if (!existing) {
            return undefined
        }

        // type discriminant is preserved through spread; TS can't narrow unions
        // through spread so we assert — the existing record's `type` guarantees correctness
        const updated = {
            ...existing,
            ...updates,
            id: animationId, // Ensure ID is not overwritten
            createdAt: existing.createdAt, // Ensure createdAt is not overwritten
            updatedAt: Date.now(),
        } as AnimationDefinition

        animations[animationId] = updated
        setAnimationsRecord(resourceType, resourceId, animations)

        return updated
    }

    /**
     * Delete Animation
     */
    function deleteAnimation(
        resourceType: AnimationResourceType,
        resourceId: string,
        animationId: string
    ): boolean {
        const animations = getAnimationsRecord(resourceType, resourceId)
        if (!(animationId in animations)) {
            return false
        }

        delete animations[animationId]
        setAnimationsRecord(resourceType, resourceId, animations)

        return true
    }

    /**
     * Import Animation from other resource (copy + source tracking)
     */
    function importAnimation(
        targetResourceType: AnimationResourceType,
        targetResourceId: string,
        sourceResourceType: AnimationResourceType,
        sourceResourceId: string,
        sourceAnimationId: string
    ): AnimationDefinition | undefined {
        // Get source Animation
        const sourceAnimation = getAnimation(
            sourceResourceType,
            sourceResourceId,
            sourceAnimationId
        )
        if (!sourceAnimation) {
            return undefined
        }

        // Copy Animation (deep copy tracks and other data)
        // v11.52: Removed sourceRef
        const copiedAnimation: Omit<TrackAnimationDefinition, 'id' | 'createdAt' | 'updatedAt'> = {
            type: 'track',
            name: sourceAnimation.name,
            loop: sourceAnimation.loop,
            tracks: sourceAnimation.type === 'track'
                ? JSON.parse(JSON.stringify(sourceAnimation.tracks)) as AnimationTrack[]
                : [],
            ...(sourceAnimation.description !== undefined && { description: sourceAnimation.description }),
            ...(sourceAnimation.tags !== undefined && { tags: [...sourceAnimation.tags] }),
        }

        return addAnimation(targetResourceType, targetResourceId, copiedAnimation)
    }

    // ===== Utility Methods =====

    /**
     * Get all resources containing Animations (for import selector)
     */
    function getAllResourcesWithAnimations(): {
        resourceType: AnimationResourceType
        resourceId: string
        resourceName: string
        animations: AnimationListItem[]
    }[] {
        const result: {
            resourceType: AnimationResourceType
            resourceId: string
            resourceName: string
            animations: AnimationListItem[]
        }[] = []

        const propStore = usePropStore()
        const backgroundStore = useBackgroundStore()

        // Traverse props
        const props = propStore.props
        for (const prop of props) {
            const animationsRecord = (prop as unknown as { animations?: Record<string, AnimationDefinition> }).animations
            if (animationsRecord && Object.keys(animationsRecord).length > 0) {
                result.push({
                    resourceType: 'prop',
                    resourceId: prop.id,
                    resourceName: prop.name ?? prop.id,
                    animations: Object.values(animationsRecord).map(toListItem),
                })
            }
        }

        // Traverse backgrounds
        const backgrounds = backgroundStore.backgrounds
        for (const bg of backgrounds) {
            const animationsRecord = (bg as unknown as { animations?: Record<string, AnimationDefinition> }).animations
            if (animationsRecord && Object.keys(animationsRecord).length > 0) {
                result.push({
                    resourceType: 'background',
                    resourceId: bg.id,
                    resourceName: bg.name,
                    animations: Object.values(animationsRecord).map(toListItem),
                })
            }
        }

        return result
    }

    // ===== Private Helper Functions =====

    /**
     * @deprecated v16: Resource-level switch dispatch will be replaced by object-level SceneObject.animations
     */
    function getAnimationsRecord(
        resourceType: AnimationResourceType,
        resourceId: string
    ): Record<string, AnimationDefinition> {
        const propStore = usePropStore()
        const backgroundStore = useBackgroundStore()

        switch (resourceType) {
            case 'prop': {
                const prop = propStore.props.find((p) => p.id === resourceId)
                const propData = prop as {
                    animations?: Record<string, AnimationDefinition>
                } | undefined
                return propData?.animations ?? {}
            }
            case 'background': {
                const bg = backgroundStore.backgrounds.find((b) => b.id === resourceId)
                const bgData = bg as {
                    animations?: Record<string, AnimationDefinition>
                } | undefined
                return bgData?.animations ?? {}
            }
            default:
                throw new Error(`Unknown resource type: ${resourceType as string}`)
        }
    }

    /**
     * @deprecated v16: Resource-level switch dispatch will be replaced by object-level SceneObject.animations
     */
    function setAnimationsRecord(
        resourceType: AnimationResourceType,
        resourceId: string,
        animations: Record<string, AnimationDefinition>
    ): void {
        const propStore = usePropStore()
        const backgroundStore = useBackgroundStore()

        switch (resourceType) {
            case 'prop': {
                const prop = propStore.props.find((p) => p.id === resourceId)
                if (prop) {
                    (prop as { animations?: Record<string, AnimationDefinition> }).animations = animations
                }
                break
            }
            case 'background': {
                const bg = backgroundStore.backgrounds.find((b) => b.id === resourceId)
                if (bg) {
                    (bg as { animations?: Record<string, AnimationDefinition> }).animations = animations
                }
                break
            }
            default:
                throw new Error(`Unknown resource type: ${resourceType as string}`)
        }
    }

    // v11.52: Removed getResourceName function (no longer used)





    /**
 * v16: Inject resource-level animation definitions into SceneObject.animations
 *
 * Called upon object creation to ensure each object's animations field is populated:
 * - character -> resource-level character.animations
 * - prop -> resource-level prop.animations + inline frame animation discovery
 * - background -> resource-level bg.animations + inline frame animation discovery
 *
 * v16 G4: Frame animation auto-discovery results are written directly to object-level animations,
 * no longer relying on resource-level _runtimeAnimations intermediate layer.
 */
    function hydrateObjectAnimations(obj: SceneObject): void {
        if (obj.type !== 'prop' && obj.type !== 'background' && obj.type !== 'symbol' && obj.type !== 'expression') return

        // Symbols have no external resource-level animations (assets are self-contained), skip resource merge, go directly to frame animation discovery
        if (obj.type === 'symbol') {
            const existingAnims = obj.animations ?? {}
            // Check if frame sequence animation with origin='auto' already exists
            const hasAutoFrameAnim = Object.values(existingAnims).some(
                a => a.origin === 'auto' && a.type === 'track' && (a).tracks.some(t => t.trackType === 'frame_sequence')
            )
            if (!hasAutoFrameAnim) {
                // Always create default frame animation (even if currently no frame animation assets), automatically available once user adds frame animation assets
                const symbolObj = obj as SymbolObject
                const firstAnimMat = symbolObj.materials.find(
                    m => m.type === 'animation' && m.frames && m.frames.length > 0
                )
                const now = Date.now()
                const frameAnim: TrackAnimationDefinition = {
                    type: 'track',
                    id: `animation_${crypto.randomUUID()}`,
                    name: `${symbolObj.alias ?? symbolObj.name ?? 'Symbol'}_FrameAnimation`,
                    origin: 'auto',
                    loop: firstAnimMat?.loop ?? true,
                    tracks: [{
                        trackType: 'frame_sequence' as const,
                        assetId: '_self',
                    }],
                    createdAt: now,
                    updatedAt: now,
                }
                existingAnims[frameAnim.id] = frameAnim
            }
            obj.animations = existingAnims
            return
        }

        // v18: expression object - query speakingFrames from expressionStore to create frame animation
        if (obj.type === 'expression') {
            const existingAnims = obj.animations ?? {}
            const hasAutoFrameAnim = Object.values(existingAnims).some(
                a => a.origin === 'auto' && a.type === 'track' && (a).tracks.some(t => t.trackType === 'frame_sequence')
            )
            if (!hasAutoFrameAnim) {
                const now = Date.now()
                const frameAnim: TrackAnimationDefinition = {
                    type: 'track',
                    id: `animation_${crypto.randomUUID()}`,
                    name: `${obj.alias ?? obj.name ?? 'Expression'}_SpeechAnimation`,
                    origin: 'auto',
                    loop: true,
                    tracks: [{
                        trackType: 'frame_sequence' as const,
                        assetId: '_self',
                    }],
                    createdAt: now,
                    updatedAt: now,
                }
                existingAnims[frameAnim.id] = frameAnim
            }
            obj.animations = existingAnims
            return
        }

        if (!obj.refId) return

        // 1. Read resource-level user-created animations (persisted .animations)
        const resourceAnims = getAnimationsRecord(obj.type, obj.refId)

        // 2. Merge resource-level animations into object (preserve existing object-level definitions, resource-level as supplement)
        const existingAnims = obj.animations ?? {}
        const mergedAnims: Record<string, AnimationDefinition> = { ...existingAnims }
        for (const [id, def] of Object.entries(resourceAnims)) {
            if (!(id in mergedAnims)) {
                mergedAnims[id] = def
            }
        }

        // 3. v16 G4: Inline frame animation auto-discovery - directly write to object level
        if (obj.type === 'prop' || obj.type === 'background') {
            // Check if frame sequence animation with origin='auto' already exists
            const hasAutoFrameAnim = Object.values(mergedAnims).some(
                a => a.origin === 'auto' && a.type === 'track' && (a).tracks.some(
                    t => t.trackType === 'frame_sequence'
                )
            )
            if (!hasAutoFrameAnim) {
                // Always create default frame animation (regardless of whether asset is frame animation type)
                const propStore = usePropStore()
                const backgroundStore = useBackgroundStore()
                const resource = obj.type === 'prop'
                    ? propStore.props.find(p => p.id === obj.refId)
                    : backgroundStore.backgrounds.find(b => b.id === obj.refId)
                const resData = resource as { type?: string; frames?: { url: string }[]; name?: string; fps?: number; loop?: boolean } | undefined
                const now = Date.now()
                const frameAnim: TrackAnimationDefinition = {
                    type: 'track',
                    id: `animation_${crypto.randomUUID()}`,
                    name: `${resData?.name ?? obj.name ?? obj.refId}_FrameAnimation`,
                    origin: 'auto',
                    loop: resData?.loop ?? true,
                    tracks: [{
                        trackType: 'frame_sequence' as const,
                        assetId: '_self',
                    }],
                    createdAt: now,
                    updatedAt: now,
                }
                mergedAnims[frameAnim.id] = frameAnim
            }
        }

        obj.animations = mergedAnims
    }

    return {
        // v16: Object-level read API
        getObjectAnimations,
        getObjectAnimationByName,
        // Resource-level read operations
        getAnimations,
        getAnimationListItems,
        getAnimation,
        getAnimationByName,

        // Write operations
        addAnimation,
        updateAnimation,
        deleteAnimation,
        importAnimation,
        // Utility methods
        getAllResourcesWithAnimations,
        hydrateObjectAnimations,
    }
})
