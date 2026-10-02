/**
 * Font loading service (Text PRD Phase 0)
 *
 * Manages on-demand loading of preset fonts, ensuring fonts are available before rendering.
 *
 * Integration points:
 * - useSceneGraph.createTextContainer/updateObjectContainer: Block and wait before creating/rebuilding text texture
 * - ObjectPropertiesPanel: Call ensureFontLoaded() after user changes font
 * - ScenePlayer.loadScene(): await preloadSceneFonts(objects)
 * - FrameCapture.loadScene(): await preloadSceneFonts(objects), block export
 * - applyObjectState text branch: Fire-and-forget when fontFamily change is detected
 */

import type { SceneObject, TextObject } from '@/types/sceneObject'
import type { ScriptBlock } from '@/types/screenplay'
import { sortActionsForEvaluation } from '@/utils/actionOrder'
import { normalizeTextContent } from '@/utils/textUtils'

// === Preset Font Directory Mapping ===
const PRESET_FONTS: Record<string, string> = {
    'Noto Sans SC': '/fonts/noto-sans-sc/result.css',
    'Noto Serif SC': '/fonts/noto-serif-sc/result.css',
    'LXGW WenKai': '/fonts/lxgw-wenkai/result.css',
    'ZCOOL QingKe HuangYou': '/fonts/zcool-qingke-huangyou/result.css',
    'Ma Shan Zheng': '/fonts/ma-shan-zheng/result.css',
}

// Loaded CSS cache (avoids duplicate <link> injection)
const loadedCssUrls = new Set<string>()

// In-progress loading Promise cache (avoids duplicate concurrent requests)
const loadingPromises = new Map<string, Promise<boolean>>()

/**
 * Determine whether font is a preset font
 */
export function isPresetFont(fontFamily: string): boolean {
    return fontFamily in PRESET_FONTS
}

/**
 * Get list of preset fonts (for UI components)
 */
export function getPresetFontList(): { name: string; cssUrl: string }[] {
    return Object.entries(PRESET_FONTS).map(([name, cssUrl]) => ({ name, cssUrl }))
}

/**
 * Collect text font states that may appear during playback/export.
 *
 * Scene setup only saves the initial font; Action Mode font modifications reside in set_text actions.
 * If only setup fonts are preloaded, Pixi.Text would first render textures using browser fallback fonts upon action trigger.
 */
export function collectSceneFontPreloadObjects(
    objects: readonly SceneObject[],
    blocks: readonly ScriptBlock[] = [],
): SceneObject[] {
    const preloadObjects: SceneObject[] = [...objects]
    if (blocks.length === 0) return preloadObjects

    const textStates = new Map<string, TextObject>()
    for (const obj of objects) {
        if (obj.type !== 'text') continue
        textStates.set(obj.id, { ...(obj as TextObject) })
    }

    for (const block of blocks) {
        const actions = block.actions ?? []
        if (actions.length === 0) continue

        const objectIndexMap = new Map<string, number>()
        const orderedTextStates = [...textStates.values()]
        orderedTextStates.forEach((obj, idx) => {
            objectIndexMap.set(obj.id, idx)
        })

        for (const action of sortActionsForEvaluation(actions, objectIndexMap)) {
            if (action.type !== 'set_text') continue

            const target = resolveTextPreloadTarget(action.target, textStates)
            if (!target) continue

            const params = action.params
            const next: TextObject = { ...target }
            if (params.content !== undefined) next.content = params.content
            if (params.fontFamily !== undefined) next.fontFamily = params.fontFamily

            textStates.set(next.id, next)
            preloadObjects.push(next)
        }
    }

    return preloadObjects
}

function resolveTextPreloadTarget(
    target: string,
    textStates: Map<string, TextObject>,
): TextObject | null {
    const byId = textStates.get(target)
    if (byId) return byId

    for (const textState of textStates.values()) {
        if (textState.alias === target || textState.name === target) return textState
    }

    return null
}

/**
 * Ensure specified font CSS is loaded into DOM, and wait until font is available.
 *
 * - Preset fonts: Dynamically insert <link> tag to load result.css (cn-font-split on-demand chunks)
 * - Non-preset fonts: Rely on local installation, only attempt document.fonts.load()
 *
 * @returns true if font is confirmed available, false if unavailable (non-preset and not installed locally)
 */
export async function ensureFontLoaded(fontFamily: string, sampleText?: string): Promise<boolean> {
    // Check if loading is already in progress
    const loadingKey = `${fontFamily}::${normalizeTextContent(sampleText) || '__default__'}`
    const existing = loadingPromises.get(loadingKey)
    if (existing) return existing

    const promise = _doEnsureFontLoaded(fontFamily, sampleText)
    loadingPromises.set(loadingKey, promise)

    try {
        return await promise
    } finally {
        loadingPromises.delete(loadingKey)
    }
}

async function _doEnsureFontLoaded(fontFamily: string, sampleText?: string): Promise<boolean> {
    const cssUrl = PRESET_FONTS[fontFamily]
    const normalizedSample = normalizeTextContent(sampleText).trim()
    const probeText = normalizedSample || 'The quick brown fox jumps over the lazy dog ABC123'

    if (cssUrl) {
        // Preset font: insert CSS <link>
        if (!loadedCssUrls.has(cssUrl)) {
            await loadFontCss(cssUrl)
            loadedCssUrls.add(cssUrl)
        }
    }

    // Wait until font is available (attempt for both preset and custom)
    try {
        // Pass actual text content to ensure unicode-range sliced fonts warm up glyphs in advance.
        await document.fonts.load(`16px "${fontFamily}"`, probeText)
        await document.fonts.ready
        return true
    } catch (e) {
        console.warn(`[fontLoader] Failed to load font: ${fontFamily}`, e)
        return false
    }
}

/**
 * Dynamically insert <link> tag to load font CSS
 */
function loadFontCss(url: string): Promise<void> {
    return new Promise((resolve) => {
        // Check if link already exists
        const existing = document.querySelector(`link[href="${url}"]`)
        if (existing) {
            resolve()
            return
        }

        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = url
        link.onload = () => resolve()
        link.onerror = () => {
            console.error(`[fontLoader] Failed to load CSS: ${url}`)
            // Do not reject, allow fallback to system fonts
            resolve()
        }
        document.head.appendChild(link)
    })
}

/**
 * Preload fonts used by all text objects in the scene.
 *
 * 1. Traverse objects to collect fontFamily of all TextObjects (deduplicated)
 * 2. Call ensureFontLoaded() for each fontFamily
 * 3. Finally await document.fonts.ready
 *
 * Invocation timing:
 * - On ScenePlayer.loadScene()
 * - On FrameCapture.loadScene() (blocks before export)
 * - On set_text changing fontFamily
 */
export async function preloadSceneFonts(objects: SceneObject[]): Promise<void> {
    // Collect fonts used by all text objects in the scene
    const fontSamples = new Map<string, string>()
    for (const obj of objects) {
        if (obj.type === 'text') {
            const textObj = obj as TextObject
            const fontFamily = textObj.fontFamily
            const sample = normalizeTextContent(textObj.content).slice(0, 200)
            const prev = fontSamples.get(fontFamily) ?? ''
            const merged = `${prev}${prev && sample ? '\n' : ''}${sample}`.slice(0, 500)
            fontSamples.set(fontFamily, merged)
        }
    }

    if (fontSamples.size === 0) return

    // Preload all fonts in parallel
    const loadPromises = [...fontSamples.entries()].map(([font, sample]) => ensureFontLoaded(font, sample))
    await Promise.all(loadPromises)

    // Final confirmation
    await document.fonts.ready
}
