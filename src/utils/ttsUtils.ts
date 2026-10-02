/**
 * TTS preprocessing shared utility functions
 *
 * Unifies duplicate TTS logic across ActionPreviewDialog / ScenePreviewDialog / ScriptPreviewDialog,
 * allowing all consumers (including video export) to share the same pipeline.
 *
 * Core design principles:
 * - Pure functions, independent of any Store (data passed via TTSContext parameter)
 * - Uniformly uses scene.setup.objects as data source (actorId is setup-level property)
 * - Single Block granularity, caller controls looping
 */

import { DEFAULT_VOLUME, FALLBACK_VOICE_ID, getValidSpeedValue, getValidVolumeValue, getVoiceEngine } from '@/constants/voiceOptions'
import { useEpisodeStore } from '@/stores/episodeStore'
import { useProjectStore } from '@/stores/projectStore'
import type { SceneObject } from '@/types/sceneObject'
import type { ActorConfig, NarratorConfig, SceneContainer, ScriptBlock, TTSConfig } from '@/types/screenplay'

import { ttsClient } from './ttsClient'
import { decodeBase64AudioToAudioBuffer } from './ttsTiming'

// ─────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────

/** TTS processing context (pure data, no Store dependency) */
export interface TTSContext {
    sceneObjects: SceneObject[]       // Scene setup.objects (used to look up character → actor)
    actors: ActorConfig[]             // Project actors list
    narrator: NarratorConfig | null   // Narrator configuration
    episodeId: string
    sceneId: string
    onProgress?: ((msg: string) => void) | undefined // Progress callback
}

/** ensureBlockTTS return value: null indicates block does not require TTS (such as action block) */
export interface TTSResult {
    ttsConfig: TTSConfig
    regenerated: boolean
}

// ─────────────────────────────────────────────────────────────
// Pure Functions: Voice / Speed Resolution
// ─────────────────────────────────────────────────────────────

/**
 * Look up actor associated with specified sceneObject in actors list.
 * Prioritizes extraInfo (v20) exact match, falls back to refId for backwards compatibility.
 */
function findActorForInstance(
    instance: SceneObject,
    actors: ActorConfig[]
): ActorConfig | undefined {
    // v20: Exact match via extraInfo (highest priority)
    const info = instance.extraInfo
    if (info?.kind === 'actor') {
        const actor = actors.find(a => a.id === info.actorId)
        if (actor) return actor
    }

    // Match characterId via refId (backwards compatibility)
    if (instance.refId) {
        return actors.find(a => a.characterId === instance.refId)
    }

    return undefined
}

/**
 * Resolve VoiceId corresponding to Block (pure function, no Store dependency)
 */
export function resolveVoiceId(
    block: ScriptBlock,
    sceneObjects: SceneObject[],
    actors: ActorConfig[],
    narrator: NarratorConfig | null
): number {
    if (block.type === 'dialogue') {
        const instance = sceneObjects.find(o => o.id === block.instanceId)
        if (instance) {
            const actor = findActorForInstance(instance, actors)
            if (actor?.voice?.voiceId) {
                return parseInt(String(actor.voice.voiceId))
            }
        }
        return FALLBACK_VOICE_ID
    }

    if (block.type === 'narration') {
        return narrator?.voice?.voiceId
            ? parseInt(String(narrator.voice.voiceId))
            : FALLBACK_VOICE_ID
    }

    return FALLBACK_VOICE_ID
}

/**
 * Resolve voice speed corresponding to Block (pure function, no Store dependency)
 */
export function resolveVoiceSpeed(
    block: ScriptBlock,
    sceneObjects: SceneObject[],
    actors: ActorConfig[],
    narrator: NarratorConfig | null
): number {
    if (block.type === 'dialogue') {
        const instance = sceneObjects.find(o => o.id === block.instanceId)
        if (instance) {
            const actor = findActorForInstance(instance, actors)
            if (actor?.voice?.speed !== undefined) {
                return getValidSpeedValue(actor.voice.speed)
            }
        }
        return 0
    }

    if (block.type === 'narration') {
        if (narrator?.voice?.speed !== undefined) {
            return getValidSpeedValue(narrator.voice.speed)
        }
        return 0
    }

    return 0
}

/**
 * Resolve voice volume corresponding to Block (pure function, no Store dependency)
 */
export function resolveVoiceVolume(
    block: ScriptBlock,
    sceneObjects: SceneObject[],
    actors: ActorConfig[],
    narrator: NarratorConfig | null
): number {
    if (block.type === 'dialogue') {
        const instance = sceneObjects.find(o => o.id === block.instanceId)
        if (instance) {
            const actor = findActorForInstance(instance, actors)
            if (actor?.voice?.volume !== undefined) {
                return getValidVolumeValue(actor.voice.volume)
            }
        }
        return 0
    }

    if (block.type === 'narration') {
        if (narrator?.voice?.volume !== undefined) {
            return getValidVolumeValue(narrator.voice.volume)
        }
        return 0
    }

    return 0
}

// ─────────────────────────────────────────────────────────────
// Core Pipeline: Single Block TTS Guarantee
// ─────────────────────────────────────────────────────────────

/**
 * Check whether a single Block needs TTS regeneration.
 * Returns true if regeneration is needed.
 */
async function checkNeedRegenerate(
    originalBlock: ScriptBlock,
    voiceId: number,
    speed: number,
    checkAudioExists: (audioPath: string) => Promise<boolean>
): Promise<boolean> {
    if (originalBlock.type !== 'dialogue' && originalBlock.type !== 'narration') {
        return false
    }

    const existingConfig = originalBlock.ttsConfig

    // 1. Missing audioPath or blob:/data: dirty data
    if (
        !existingConfig?.audioPath ||
        existingConfig.audioPath.startsWith('blob:') ||
        existingConfig.audioPath.startsWith('data:')
    ) {
        return true
    }

    // 2. Disk file does not exist
    const audioFileExists = await checkAudioExists(existingConfig.audioPath)
    if (!audioFileExists) {
        return true
    }

    // 3. Missing duration
    if (!existingConfig.duration) {
        return true
    }

    // 4. Content change detection
    if (existingConfig.generatedFrom) {
        const gen = existingConfig.generatedFrom
        const currentText = originalBlock.text
        if (
            gen.text !== currentText ||
            String(gen.voiceId) !== String(voiceId) ||
            gen.speed !== speed 
        ) {
            return true
        }

        // Dialogue Block checks instanceId change
        if (originalBlock.type === 'dialogue' && gen.instanceId !== originalBlock.instanceId) {
            return true
        }
    } else {
        // Legacy data without generatedFrom: force regeneration
        return true
    }

    return false
}

/**
 * Ensure TTS for a single Block has been generated.
 *
 * @param originalBlock  Original Block in Store (for reading/comparing ttsConfig)
 * @param copyBlock      Block in copy (for updating copy data)
 * @param ctx            TTS context
 *
 * @returns TTSResult or null (action block or empty text does not require TTS)
 * @throws  Throws error if TTS synthesis fails
 */
export async function ensureBlockTTS(
    originalBlock: ScriptBlock,
    copyBlock: ScriptBlock,
    ctx: TTSContext
): Promise<TTSResult | null> {
    // Only process dialogue and narration
    if (originalBlock.type !== 'dialogue' && originalBlock.type !== 'narration') {
        return null
    }
    if (copyBlock.type !== 'dialogue' && copyBlock.type !== 'narration') {
        return null
    }

    const projectStore = useProjectStore()
    const episodeStore = useEpisodeStore()

    const voiceId = resolveVoiceId(originalBlock, ctx.sceneObjects, ctx.actors, ctx.narrator)
    const speed = resolveVoiceSpeed(originalBlock, ctx.sceneObjects, ctx.actors, ctx.narrator)

    const needRegenerate = await checkNeedRegenerate(
        originalBlock,
        voiceId,
        speed,
        (audioPath) => projectStore.checkTTSAudioExists(audioPath)
    )

    if (needRegenerate) {
        const text = originalBlock.text
        if (!text || text.trim().length === 0) {
            throw new Error('Text content is empty')
        }

        ctx.onProgress?.(`Generating speech: ${text.substring(0, 10)}...`)

        const result = await ttsClient.synthesize({
            text,
            engine: getVoiceEngine(voiceId),
            voiceType: voiceId,
            volume: DEFAULT_VOLUME,
            speed,
        })

        let actualDuration = result.duration
        if (!actualDuration || actualDuration <= 0) {
            actualDuration = await ttsClient.estimateDuration(text, speed)
        }

        if (!result.audioBase64) {
            throw new Error('TTS generation result missing Base64 data, cannot save')
        }

        const cacheKey = `${text}_${voiceId}_${speed}`
        const audioPath = await projectStore.saveTTSAudio(result.audioBase64, cacheKey)
        await ensureTimingSidecar(audioPath, result.audioBase64, projectStore.ensureTTSTiming)

        const generatedFrom: NonNullable<TTSConfig['generatedFrom']> = {
            text,
            voiceId,
            speed
        }
        if (originalBlock.type === 'dialogue') {
            generatedFrom.instanceId = originalBlock.instanceId
        }

        const ttsConfig: TTSConfig = {
            audioPath,
            duration: actualDuration,
            voiceId,
            generatedFrom
        }

        // Update original Store (persistence)
        episodeStore.updateBlockInScene(ctx.episodeId, ctx.sceneId, originalBlock.id, { ttsConfig })

        // Synchronously update copy
        copyBlock.ttsConfig = JSON.parse(JSON.stringify(ttsConfig)) as TTSConfig

        return { ttsConfig, regenerated: true }
    }

    // No regeneration needed: ensure copy also has Config
    const existingConfig = originalBlock.ttsConfig
    if (existingConfig) {
        copyBlock.ttsConfig = JSON.parse(JSON.stringify(existingConfig)) as TTSConfig
    }

    return existingConfig
        ? { ttsConfig: existingConfig, regenerated: false }
        : null
}

async function ensureTimingSidecar(
    audioPath: string,
    audioBase64: string,
    ensureTTSTiming: (audioPath: string, audioBuffer: AudioBuffer) => Promise<string>
): Promise<void> {
    const audioBuffer = await decodeBase64AudioToAudioBuffer(audioBase64)
    if (!audioBuffer) return

    try {
        await ensureTTSTiming(audioPath, audioBuffer)
    } catch (error) {
        console.warn('[TTS] timing sidecar generation failed, continuing with audio:', error)
    }
}

/**
 * Ensure all Blocks in the entire scene have completed TTS.
 *
 * @param originalScene Scene in original Store
 * @param copyScene     Scene in copy
 * @param ctx           TTS context (sceneId retrieved from ctx)
 */
export async function ensureSceneTTS(
    originalScene: SceneContainer,
    copyScene: SceneContainer,
    ctx: Omit<TTSContext, 'sceneId'>
): Promise<void> {
    const sceneCtx: TTSContext = {
        ...ctx,
        sceneId: originalScene.id
    }

    ctx.onProgress?.('Checking voice resources...')

    for (let i = 0; i < originalScene.script.length; i++) {
        const originalBlock = originalScene.script[i]
        const copyBlock = copyScene.script[i]
        if (!originalBlock || !copyBlock) continue

        await ensureBlockTTS(originalBlock, copyBlock, sceneCtx)
    }
}

/**
 * Ensure all scenes in the entire Episode have completed TTS (used for video export).
 *
 * @param episode     Original Episode (original Store data)
 * @param episodeCopy Copy Episode
 * @param ctx         Simplified context
 */
export async function ensureEpisodeTTS(
    episode: { id: string; scenes: SceneContainer[] },
    episodeCopy: { scenes: SceneContainer[] },
    ctx: {
        actors: ActorConfig[]
        narrator: NarratorConfig | null
        onProgress?: (msg: string) => void
    }
): Promise<void> {
    for (let i = 0; i < episode.scenes.length; i++) {
        const originalScene = episode.scenes[i]
        const copyScene = episodeCopy.scenes[i]
        if (!originalScene || !copyScene) continue

        ctx.onProgress?.(`Processing scene ${i + 1}/${episode.scenes.length}: ${originalScene.title || 'Untitled'}`)

        await ensureSceneTTS(originalScene, copyScene, {
            sceneObjects: originalScene.setup.objects,
            actors: ctx.actors,
            narrator: ctx.narrator,
            episodeId: episode.id,
            onProgress: ctx.onProgress
        })
    }
}
