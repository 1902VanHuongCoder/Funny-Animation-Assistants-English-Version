import { CAMERA_BASE_HEIGHT, CAMERA_BASE_WIDTH, CANVAS_CENTER_X, CANVAS_CENTER_Y } from '@/constants/canvas'
import { useProjectStore } from '@/stores/projectStore'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { SceneObject } from '@/types/sceneObject'
import type { SceneSetup } from '@/types/screenplay'
import { getActorByCharacterId } from '@/utils/actorUtils'
import { reconcileSetupHierarchy, warnHierarchyIssues } from '@/utils/hierarchyUtils'
import { reconcileRenderChain } from '@/utils/renderChainUtils'

/**
 * Load objects from SceneSetup to sceneObjectStore
 *
 * Phase 2: Object loading is delegated to sceneObjectStore.fromSetupObject(),
 * this function is only responsible for camera loading and injecting actor name resolution callback.
 *
 * v19: Initialize renderChain after loading (prioritizes persisted data, otherwise auto-builds)
 *
 * @param options.skipCamera Skip camera creation (character/template editor manages camera independently)
 * @param options.skipAmbientLight Skip ambient light creation (character/template editor does not need lighting)
 */
export function loadSetupToSceneObjects(
    setup: SceneSetup,
    options?: { skipCamera?: boolean; skipAmbientLight?: boolean },
) {
    const sceneObjectStore = useSceneObjectStore()
    const projectStore = useProjectStore()
    const hierarchyResult = reconcileSetupHierarchy(setup)
    warnHierarchyIssues('loadSetupToSceneObjects', hierarchyResult.warnings)

    // Dual-layer architecture: loadSetupToSceneObjects should load data into setupObjects (persistence layer).
    // Because addObject/fromSetupObject writes to runtimeObjects in Action Mode,
    // temporarily switch to Setup Mode to load, then restore Action Mode and rebuild runtimeObjects.
    const wasActionMode = sceneObjectStore.getIsActionMode()
    if (wasActionMode) {
        // Temporarily exit Action Mode (isActionMode=false, runtimeObjects cleared)
        sceneObjectStore.setActionMode(false)
    }

    sceneObjectStore.clearObjects()

    // v6.9: Load camera - only use center point and zoom, dimensions fixed to 1456 x 819
    if (!options?.skipCamera) {
        const camera = setup.camera
        if (camera) {
            sceneObjectStore.createCameraObject('Camera', {
                x: camera.x,
                y: camera.y
            }, camera.zoom ?? 1.0)
            const cameraObj = sceneObjectStore.objects.find(obj => obj.type === 'camera')
            if (cameraObj) {
                const zoom = camera.zoom ?? 1.0
                sceneObjectStore.updateObject(cameraObj.id, {
                    width: CAMERA_BASE_WIDTH / zoom,
                    height: CAMERA_BASE_HEIGHT / zoom
                })
            }
        }
    }

    // v25: Auto-create ambient light (if absent) — singleton pattern same as camera
    // v25.6: Character/template editor does not need lighting, skipped via skipAmbientLight
    if (!options?.skipAmbientLight) {
        const hasAmbientLight = setup.objects.some(
            (o: SceneObject) => o.type === 'light' && (o as import('@/types/sceneObject').LightObject).lightType === 'ambient'
        )
        if (!hasAmbientLight) {
            sceneObjectStore.createLightObject('ambient', 'Ambient Light', {
                lightColor: '#ffffff',
                lightIntensity: 1.0,
            })
        }
    }

    // Phase 2: Delegate deserialization to Store, eliminating scattered type switches
    // Actor name resolution injected via callback, avoiding Store coupling to projectStore/actorUtils
    const resolveActorName = (refId: string, actorId?: string) => {
        const actor = actorId ? projectStore.getActor(actorId) : getActorByCharacterId(refId)
        if (!actor && !actorId) return null
        return {
            displayName: actor?.name ?? 'Unknown Character',
            resolvedActorId: actorId ?? (actor?.id ?? '')
        }
    }

    for (const objData of setup.objects) {
        sceneObjectStore.fromSetupObject(objData, resolveActorName)
    }

    // Clip-Mask Phase 1: Backfill mask.targetIds after all objects are created and perform exclusive validation / dirty data cleanup.
    sceneObjectStore.finalizeMaskTargets()

    // v19: Initialize scene render chain
    if (setup.renderChain && setup.renderChain.length > 0) {
        // Restore from persisted data, incrementally adding objects that should be in chain under new rules (e.g. text).
        sceneObjectStore.setSceneRenderChain(
            reconcileRenderChain(setup.renderChain, sceneObjectStore.setupState.objects)
        )
    } else {
        // Legacy project migration: auto-build render chain
        sceneObjectStore.rebuildSceneRenderChain()
    }

    // v19: Rebuild for entity composites missing renderChain (legacy data migration + initial load)
    sceneObjectStore.rebuildEntityRenderChains()

    // v16: animations persisted to project file, restored uniformly by fromSetupObject on load
    // No longer requires runtime hydration

    // Dual-layer architecture: restore Action Mode, rebuild runtimeObjects
    if (wasActionMode) {
        sceneObjectStore.setActionMode(true) // Deep copy setupObjects -> runtimeObjects
    }
}

/**
 * Collect Setup data from sceneObjectStore
 *
 * Dual-layer architecture: Always serialize from setupObjects (persistence layer), ensuring Action Mode runtime state does not leak
 *
 * v19: Includes renderChain
 */
export function collectSetupFromSceneObjects(): SceneSetup {
    const sceneObjectStore = useSceneObjectStore()

    // Dual-layer architecture: read from persistence layer, not objects computed proxy
    const setupObjs = sceneObjectStore.setupState.objects as SceneObject[]
    const camera = setupObjs.find(obj => obj.type === 'camera')

    // PT Phase 8.2: Delegate serialization to Store, eliminating scattered type switches
    const objects: SceneObject[] = setupObjs
        .filter(obj => {
            if (obj.type === 'camera') return false
            // v25.1: Both ambient and point lights persist to setup.objects
            // Ambient light no longer excluded — user modified color/intensity needs saving for ScenePlayer
            return true
        })
        .map(obj => sceneObjectStore.toSetupObject(obj))

    return {
        camera: camera ? {
            x: camera.x,  // Directly use center coordinates
            y: camera.y,
            width: camera.width,
            height: camera.height,
            zoom: (camera as unknown as { zoom?: number }).zoom ?? 1.0  // Read zoom from camera object
        } : {
            x: CANVAS_CENTER_X,
            y: CANVAS_CENTER_Y,
            width: CAMERA_BASE_WIDTH,
            height: CAMERA_BASE_HEIGHT,
            zoom: 1.0
        },
        objects,
        renderChain: sceneObjectStore.getSceneRenderChain(),
    }
}
