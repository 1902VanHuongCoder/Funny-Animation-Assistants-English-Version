/**
 * Block Player Composable
 * Unified encapsulation of TTS generation, playback control, timeline updates, etc.
 * 
 * Usage scenarios:
 * 1. SceneEditMode.vue - Action mode preview
 * 2. Screenplay edit page - Block preview
 * 3. Full script preview/export - Sequential playback of multiple Blocks
 */

import { computed, ref } from 'vue'

import { useAssetAudio } from '@/composables/useAssetAudio'
import { getPlaybackVolumeGain } from '@/constants/voiceOptions'
import { useEpisodeStore } from '@/stores/episodeStore'
import { useProjectStore } from '@/stores/projectStore'
import type { ScriptBlock } from '@/types/screenplay'

// Block type union
export type PlayableBlock = ScriptBlock

// Playback state
export interface PlaybackState {
  isPlaying: boolean
  isPaused: boolean
  currentTime: number      // Current playback time (ms)
  duration: number         // Total duration (ms)
  progress: number         // Playback progress 0-1
  error: string | null     // Error message
}

// Player configuration
export interface BlockPlayerOptions {
  episodeId: string
  sceneId: string
  blockId: string
  onTimeUpdate?: (time: number) => void  // Time update callback
  onPlayEnd?: () => void                  // Playback end callback
}

import { type AudioInstance, audioKit } from '@/utils/WebAudioKit'

/**
 * Block Player Composable
 * Only responsible for playback control, not asset generation
 */
export function useBlockPlayer(options: BlockPlayerOptions) {
  // Playback state
  const isPlaying = ref(false)
  const isPaused = ref(false)
  const currentTime = ref(0)
  const error = ref<string | null>(null)

  // Internal state
  let animationFrame: number | null = null
  let playStartTime = 0
  let playStartOffset = 0
  let audioInstance: AudioInstance | null = null

  const projectStore = useProjectStore()

  function getBlockPlaybackVolume(block: ScriptBlock): number {
    if (block.type === 'dialogue') {
      const episode = useEpisodeStore().getEpisode(options.episodeId)
      const scene = episode?.scenes.find((s) => s.id === options.sceneId)
      const instance = scene?.setup.objects.find((o) => o.id === block.instanceId)
      const actorId = instance?.extraInfo?.kind === 'actor' ? instance.extraInfo.actorId : undefined
      const actor = actorId
        ? projectStore.actors.find((item) => item.id === actorId)
        : (instance?.refId ? projectStore.actors.find((item) => item.characterId === instance.refId) : undefined)
      return getPlaybackVolumeGain(actor?.voice?.volume)
    }

    if (block.type === 'narration') {
      return getPlaybackVolumeGain(projectStore.narrator?.voice?.volume)
    }

    return 1
  }

  // Get current Block
  const currentBlock = computed((): PlayableBlock | null => {
    const episodeStore = useEpisodeStore()
    const episode = episodeStore.getEpisode(options.episodeId)
    if (!episode) return null

    const scene = episode.scenes.find((s) => s.id === options.sceneId)
    if (!scene) return null

    return scene.script.find((b) => b.id === options.blockId) ?? null
  })

  // Get Block duration
  const duration = computed((): number => {
    const block = currentBlock.value
    if (!block) return 0

    // Prefer action type duration
    if (block.type === 'action') {
      return block.duration || 0
    }

    // Dialogue/narration uses TTS duration
    return block.ttsConfig?.duration ?? 0
  })

  // Playback progress
  const progress = computed((): number => {
    if (duration.value <= 0) return 0
    return Math.min(currentTime.value / duration.value, 1)
  })

  // Aggregated state
  const state = computed((): PlaybackState => ({
    isPlaying: isPlaying.value,
    isPaused: isPaused.value,
    currentTime: currentTime.value,
    duration: duration.value,
    progress: progress.value,
    error: error.value
  }))

  /**
   * Start playback
   * @param audioUrl Optional audio address (if omitted, loads from block.ttsConfig.audioPath)
   */
  async function play(audioUrl?: string): Promise<void> {
    // If already playing, ignore
    if (isPlaying.value) return

    error.value = null

    // Check duration
    if (duration.value <= 0) {
      error.value = 'Block duration is 0, cannot play'
      return
    }

    // If already played to the end, reset to start
    if (currentTime.value >= duration.value) {
      currentTime.value = 0
    }

    // If paused, resume playback
    if (isPaused.value) {
      isPaused.value = false
    }

    isPlaying.value = true
    playStartTime = performance.now()
    playStartOffset = currentTime.value

    // Play audio (if any)
    const block = currentBlock.value
    if (block && (block.type === 'dialogue' || block.type === 'narration')) {
      // v12.8: Prefer passed URL, otherwise lazy load via audioPath
      let finalAudioUrl = audioUrl
      if (!finalAudioUrl && block.ttsConfig?.audioPath) {
        const { loadAudioUrl, getAudioUrl } = useAssetAudio()
        await loadAudioUrl(block.ttsConfig.audioPath)
        finalAudioUrl = getAudioUrl(block.ttsConfig.audioPath) || undefined
      }

      if (finalAudioUrl) {
        try {
          // Ensure AudioContext is initialized
          await audioKit.init()

          // Load audio (if Blob URL, loading is fast)
          await audioKit.load(finalAudioUrl)

          // Calculate playback offset (currentTime is ms, audioKit needs seconds)
          const startOffset = Math.max(0, currentTime.value / 1000)

          // Play
          audioInstance = await audioKit.play(finalAudioUrl, {
            volume: getBlockPlaybackVolume(block),
            loop: false,
            startOffset: startOffset
          })

        } catch (err) {
          console.error('[BlockPlayer] Failed to play audio:', err)
          audioInstance = null
        }
      }
    }

    // Start animation loop
    startPlaybackLoop()
  }

  /**
   * Pause playback
   */
  function pause(): void {
    if (!isPlaying.value) return

    isPlaying.value = false
    isPaused.value = true

    // Stop animation loop
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }

    // Pause audio
    if (audioInstance) {
      audioInstance.stop()
      audioInstance = null
    }

    // Record paused position
    playStartOffset = currentTime.value
  }

  /**
   * Stop playback (reset to start)
   */
  function stop(): void {
    isPlaying.value = false
    isPaused.value = false
    currentTime.value = 0

    // Stop animation loop
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }

    // Stop audio
    if (audioInstance) {
      audioInstance.stop()
      audioInstance = null
    }

    playStartOffset = 0
  }

  /**
   * Seek to specified time
   */
  function seek(time: number): void {
    currentTime.value = Math.max(0, Math.min(time, duration.value))

    // If currently playing, update start time
    if (isPlaying.value) {
      playStartTime = performance.now()
      playStartOffset = currentTime.value

      // Sync audio (AudioKit does not support seeking instances, must stop and re-play)
      // Stop current audio
      if (audioInstance) {
        audioInstance.stop()
        audioInstance = null
      }

      // Reset playStartTime to match new offset
      playStartTime = performance.now()
      playStartOffset = currentTime.value

      // v12.8: Re-trigger audio if playing (lazy load using audioPath)
      const block = currentBlock.value
      if (block && (block.type === 'dialogue' || block.type === 'narration') && block.ttsConfig?.audioPath) {
        const { loadAudioUrl, getAudioUrl } = useAssetAudio()
        const audioPath = block.ttsConfig.audioPath
        void loadAudioUrl(audioPath).then(() => {
          const finalAudioUrl = getAudioUrl(audioPath)
          if (finalAudioUrl) {
            void audioKit.play(finalAudioUrl, {
              volume: getBlockPlaybackVolume(block),
              loop: false,
              startOffset: currentTime.value / 1000
            }).then(inst => audioInstance = inst)
          }
        })
      }
    }

    // Trigger time update callback
    options.onTimeUpdate?.(currentTime.value)
  }

  /**
   * Toggle play/pause
   */
  async function toggle(): Promise<void> {
    if (isPlaying.value) {
      pause()
    } else {
      await play()
    }
  }

  /**
   * Playback animation loop
   */
  function startPlaybackLoop(): void {
    function loop() {
      if (!isPlaying.value) return

      const elapsed = performance.now() - playStartTime
      const newTime = playStartOffset + elapsed

      // Add 500ms buffer time to avoid abrupt interruption
      const bufferTime = 500
      const effectiveDuration = duration.value + bufferTime

      if (newTime >= effectiveDuration) {
        // Playback finished
        currentTime.value = duration.value
        isPlaying.value = false
        isPaused.value = false

        // Trigger callbacks
        options.onTimeUpdate?.(duration.value)
        options.onPlayEnd?.()

        // Stop audio
        if (audioInstance) {
          audioInstance.stop()
          audioInstance = null
        }
      } else {
        currentTime.value = newTime
        options.onTimeUpdate?.(newTime)
        animationFrame = requestAnimationFrame(loop)
      }
    }

    animationFrame = requestAnimationFrame(loop)
  }

  /**
   * Destroy player
   */
  function destroy(): void {
    stop()

    if (audioInstance) {
      audioInstance.stop()
      audioInstance = null
    }
  }

  return {
    // State
    state,
    isPlaying,
    isPaused,
    currentTime,
    duration,
    progress,
    error,
    currentBlock,

    // Methods
    play,
    pause,
    stop,
    seek,
    toggle,
    destroy
  }
}
