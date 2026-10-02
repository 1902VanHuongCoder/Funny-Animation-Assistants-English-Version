
import * as PIXI from 'pixi.js'

import { useAssetAudio } from '@/composables/useAssetAudio'
import { useAssetImage } from '@/composables/useAssetImage'
import { useBackgroundStore } from '@/stores/backgroundStore'
import { useExpressionStore } from '@/stores/expressionStore'
import { usePropStore } from '@/stores/propStore'
import { useSoundStore } from '@/stores/soundStore'
import type { SymbolMaterial, SymbolObject } from '@/types/sceneObject'
import type { SceneSetup, ScriptBlock } from '@/types/screenplay'

// Global texture cache (module-level singleton, shared across all components)
const textureCache = new Map<string, PIXI.Texture>()
const pendingAssetLoads = new Map<string, Promise<void>>()
// Global audio cache (Set of Blob URLs)
// const audioCache = new Set<string>()


/** v16: Collect all persisted image URLs of a single SymbolMaterial */
function collectSymbolMaterialUrls(material: SymbolMaterial, addImg: (url?: string) => void) {
    if (material.type === 'static') {
        addImg(material.url)
    } else if (material.frames) {
        for (const frame of material.frames) {
            addImg(frame.url)
        }
        // Still frame
        addImg(material.url)
    }
}

function collectSymbolMaterialFirstPaintUrls(material: SymbolMaterial, addImg: (url?: string) => void) {
    if (material.type === 'static') {
        addImg(material.url)
        return
    }

    addImg(material.url)
    addImg(material.frames?.[0]?.url)
}

export function useAssetLoader() {
    const backgroundStore = useBackgroundStore()
    const propStore = usePropStore()
    const expressionStore = useExpressionStore()
    const soundStore = useSoundStore()

    const { getImageUrl, loadImageUrl } = useAssetImage()
    const { loadAudioUrl } = useAssetAudio()

    function buildAssetLoadKey(imageUrls: Set<string>, audioUrls: Set<string>): string {
        const imageKey = Array.from(imageUrls).sort().join('|')
        const audioKey = Array.from(audioUrls).sort().join('|')
        return `img:${imageKey}::audio:${audioKey}`
    }

    function isTextureCached(url: string): boolean {
        if (!url) return true
        if (textureCache.has(url)) return true
        const blobUrl = getImageUrl(url)
        return !!blobUrl && textureCache.has(blobUrl)
    }

    function collectEditorFirstPaintAssets(sceneSetup: { objects: SceneSetup['objects'] } | null, currentBlock: ScriptBlock | null) {
        const imageUrls = new Set<string>()
        const audioUrls = new Set<string>()

        const addImg = (url?: string) => {
            if (url) imageUrls.add(url)
        }

        type SceneObjectLike = SceneSetup['objects'][number]

        const collectBackgroundFirstPaint = (obj: SceneObjectLike) => {
            const bg = backgroundStore.getBackground(obj.refId)
            if (!bg) return

            addImg(bg.stillFrameCustomUrl)
            addImg(bg.url ?? bg.backgroundImage)
            addImg(bg.frames?.[0]?.url)
        }

        const collectPropFirstPaint = (obj: SceneObjectLike) => {
            const prop = propStore.getProp(obj.refId)
            if (!prop) return

            addImg(prop.stillFrameCustomUrl)
            addImg(prop.url)
            addImg(prop.frames?.[0]?.url)
        }

        const collectSymbolFirstPaint = (obj: SceneObjectLike) => {
            const symbolObj = obj as unknown as SymbolObject
            if (!symbolObj.materials?.length) return

            const currentMaterial = symbolObj.currentMaterialId
                ? symbolObj.materials.find(m => m.id === symbolObj.currentMaterialId)
                : symbolObj.materials[0]
            if (!currentMaterial) return

            collectSymbolMaterialFirstPaintUrls(currentMaterial, addImg)
        }

        const collectExpressionFirstPaint = (expressionId?: string) => {
            if (!expressionId) return
            const expr = expressionStore.getExpression(expressionId)
            if (!expr) return

            addImg(expr.defaultFrame?.url)
        }

        if (sceneSetup) {
            for (const obj of sceneSetup.objects) {
                switch (obj.type) {
                    case 'background':
                        collectBackgroundFirstPaint(obj)
                        break
                    case 'prop':
                        collectPropFirstPaint(obj)
                        break
                    case 'symbol':
                        collectSymbolFirstPaint(obj)
                        break
                    case 'expression':
                        collectExpressionFirstPaint(obj.refId)
                        break
                    default:
                        break
                }
            }
        }

        if (currentBlock?.actions) {
            for (const action of currentBlock.actions) {
                if (action.type !== 'set_material') continue

                const materialAction = action
                const newMaterialId = materialAction.params?.materialId
                if (!newMaterialId) continue

                const targetObj = sceneSetup?.objects.find(o => o.id === materialAction.target)
                if (targetObj?.type === 'expression' || !targetObj) {
                    collectExpressionFirstPaint(newMaterialId)
                    continue
                }

                if (targetObj.type === 'symbol') {
                    const symbolObj = targetObj as unknown as SymbolObject
                    const targetMaterial = symbolObj.materials?.find(material => material.id === newMaterialId)
                    if (targetMaterial) {
                        collectSymbolMaterialFirstPaintUrls(targetMaterial, addImg)
                    }
                }
            }
        }

        return { imageUrls, audioUrls }
    }

    /**
     * Collect all asset URLs that need to be loaded in the scene and Block
     * @param sceneSetup Evaluated scene context (prevContext)
     * @param currentBlock Block currently being edited/previewed (optional, for extracting dynamic overrides)
     */
    function collectAssets(sceneSetup: { objects: SceneSetup['objects'] } | null, currentBlock: ScriptBlock | null) {
        const imageUrls = new Set<string>()
        const audioUrls = new Set<string>()

        // Helper: add image URL
        const addImg = (url?: string) => {
            if (url) imageUrls.add(url)
        }

        interface CollectorContext {
            addImg: (url?: string) => void
            addAudio: (url: string) => void
        }

        type SceneObjectLike = SceneSetup['objects'][number]

        const assetCollectors: Record<string, (obj: SceneObjectLike, ctx: CollectorContext) => void> = {
            // character collector removed

            prop(obj, ctx) {
                // PT Phase 6: propId removed, use refId uniformly
                const propId = obj.refId
                const prop = propStore.getProp(propId)
                if (prop) {
                    ctx.addImg(prop.url)
                    // v11.52: Preload custom still image
                    ctx.addImg(prop.stillFrameCustomUrl)
                    prop.frames?.forEach((f) => ctx.addImg(f.url))
                }
            },

            background(obj, ctx) {
                const bg = backgroundStore.getBackground(obj.refId)
                if (bg) {
                    ctx.addImg(bg.url ?? bg.backgroundImage)
                    // v11.52: Preload custom still image
                    ctx.addImg(bg.stillFrameCustomUrl)
                    bg.frames?.forEach((f) => ctx.addImg(f.url))
                }
            },

            audio(obj, ctx) {
                const snd = soundStore.getSound(obj.refId)
                if (snd?.url) ctx.addAudio(snd.url)
            },

            // v16: Symbol assets (self-contained, does not depend on external Store)
            symbol(obj, ctx) {
                const symbolObj = obj as unknown as SymbolObject
                if (!symbolObj.materials) return
                for (const material of symbolObj.materials) {
                    collectSymbolMaterialUrls(material, ctx.addImg)
                }
            },

            // v18: Independent expression object (references expressionStore)
            expression(obj, ctx) {
                const expr = expressionStore.getExpression(obj.refId)
                if (!expr) return
                ctx.addImg(expr.defaultFrame?.url)
                expr.speakingFrames?.forEach(f => ctx.addImg(f?.url))
            },
        }

        // 1. Scan Scene Setup (static state + initial state)
        if (sceneSetup) {
            const ctx: CollectorContext = {
                addImg,
                addAudio: (url: string) => audioUrls.add(url),
            }
            for (const obj of sceneSetup.objects) {
                const collector = assetCollectors[obj.type]
                if (collector) collector(obj, ctx)
            }
        }

        // 2. Scan Current Block Actions (dynamic overrides)
        // Specially for dynamic instructions such as set_material
        if (currentBlock?.actions) {

            for (const action of currentBlock.actions) {
                // v18 Dynamic interception: parse materialId (expression refId) in set_material
                if (action.type === 'set_material') {
                    const materialAction = action
                    const newMaterialId = materialAction.params?.materialId
                    if (!newMaterialId) continue

                    // Determine if target object is expression type
                    // First search from sceneSetup.objects;
                    // If target object was dynamically spawned (not in setup), query expressionStore directly
                    const targetObj = sceneSetup?.objects.find(o => o.id === materialAction.target)
                    const isExpression = targetObj?.type === 'expression'

                    // For non-expression types (such as symbol), setup scan already covers all materials, no extra handling needed
                    if (isExpression || !targetObj) {
                        const expr = expressionStore.getExpression(newMaterialId)
                        if (expr) {
                            addImg(expr.defaultFrame?.url)
                            expr.speakingFrames?.forEach(f => addImg(f?.url))
                        }
                    }
                }

                // set_character handling removed
                if (action.type === 'set_audio') {
                    // Trigger audio usually uses the Audio Object, which is already scanned in Step 1.
                    // Unless we allow dynamic URL injection (unlikely in current design).
                }
            }
        }

        return { imageUrls, audioUrls }
    }

    /**
     * Unified loader executor
     * Uses Image object to load images for robust Blob URL support, then converts to PIXI Texture
     */
    async function loadAssets(imageUrls: Set<string>, audioUrls: Set<string>, traceLabel = 'AssetLoader.loadAssets') {
        void traceLabel
        const uncachedImageUrls = new Set(
            Array.from(imageUrls).filter(url => !isTextureCached(url))
        )

        if (uncachedImageUrls.size === 0 && audioUrls.size === 0) {
            return
        }

        const requestKey = buildAssetLoadKey(uncachedImageUrls, audioUrls)
        const pendingLoad = pendingAssetLoads.get(requestKey)
        if (pendingLoad) {
            await pendingLoad
            return
        }

        const loadTask = (async () => {
        const imagesToLoad = Array.from(uncachedImageUrls)
        const audiosToLoad = Array.from(audioUrls)

        // 1. Concurrently load all Blobs to local storage (IndexedDB/Cache) and get Blob URLs
        // This step ensures blob: protocol URLs are valid
        const validImageUrls = new Map<string, string>() // Original -> BlobURL

        await Promise.all(imagesToLoad.map(async (url) => {
            try {
                await loadImageUrl(url)
                const blobUrl = getImageUrl(url)
                if (blobUrl) {
                    validImageUrls.set(url, blobUrl)
                }
            } catch (e) {
                console.warn('[AssetLoader] Image Fetch Failed:', url, e)
            }
        }))

        // 2. Concurrently create PIXI Textures
        // Use Image tag method to bypass potential Blob parsing issues in PIXI loader
        const texturePromises = Array.from(validImageUrls.entries()).map(async ([originalUrl, blobUrl]) => {
            // Fast path: Check cache
            if (textureCache.has(blobUrl)) return
            if (textureCache.has(originalUrl)) return

            try {
                const img = new Image()
                img.crossOrigin = 'anonymous'

                await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve()
                    img.onerror = () => reject(new Error('Image Element Error'))
                    img.src = blobUrl
                })

                const baseTexture = PIXI.BaseTexture.from(img)
                const texture = new PIXI.Texture(baseTexture)

                if (texture?.baseTexture.valid) {
                    textureCache.set(originalUrl, texture)
                    textureCache.set(blobUrl, texture)
                }
            } catch (e) {
                console.warn('[AssetLoader] Texture Create Failed:', originalUrl)
            }
        })

        // 3. Concurrently load Audio
        const audioPromises = audiosToLoad.map(async (url) => {
            try {
                await loadAudioUrl(url)
                // AudioKit load is lazy. ActionPreviewDialog uses audioKit.load(blobUrl).
                // Here we only ensure the blob is available.
            } catch (e) {
                console.warn('[AssetLoader] Audio Fetch Failed:', url)
            }
        })

        await Promise.all([...texturePromises, ...audioPromises])
        })()

        pendingAssetLoads.set(requestKey, loadTask)
        try {
            await loadTask
        } finally {
            if (pendingAssetLoads.get(requestKey) === loadTask) {
                pendingAssetLoads.delete(requestKey)
            }
        }
    }

    /**
     * Get cached texture
     * Use this method in CharacterSprite or other rendering components to get synchronous textures
     */
    function getTexture(url: string): PIXI.Texture {
        if (!url) return PIXI.Texture.EMPTY

        // 1. Try Cache with Original URL
        if (textureCache.has(url)) return textureCache.get(url)!

        // 2. Try Cache with Blob URL
        // (This requires calling getImageUrl which might be slow if reactive? No, it's usually fast)
        const blobUrl = getImageUrl(url)
        if (textureCache.has(blobUrl)) return textureCache.get(blobUrl)!

        return PIXI.Texture.EMPTY
    }

    return {
        collectAssets,
        collectEditorFirstPaintAssets,
        loadAssets,
        getTexture,
        textureCache // Expose for advanced usage
    }
}
