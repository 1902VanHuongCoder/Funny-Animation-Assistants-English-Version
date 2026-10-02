/**
 * Export adapter (v6.0)
 * Converts Episode structure to formats required for export
 */

import type { Episode } from '@/stores/episodeStore'
import type { Action, ActorConfig, SceneContainer, ScriptBlock } from '@/types/screenplay'

export function getBlockDurationMs(block: ScriptBlock): number {
  if (block.type === 'dialogue' || block.type === 'narration') {
    return block.ttsConfig?.duration ?? 1000
  }

  if (block.type === 'action') {
    return block.duration || 0
  }

  return 1000
}

/**
 * Iterator traversing all scenes and script blocks during export
 * Used by video export system
 */
export function* iterateScenesForExport(episode: Episode) {
  for (const scene of episode.scenes) {
    // Reset scene state (apply scene.setup)
    yield {
      type: 'scene_setup' as const,
      sceneId: scene.id,
      sceneTitle: scene.title,
      setup: scene.setup
    }

    // Traverse all script blocks in scene
    for (const block of scene.script) {
      yield {
        type: 'script_block' as const,
        sceneId: scene.id,
        blockId: block.id,
        blockType: block.type,
        block: block
      }
    }
  }
}

/**
 * Calculate total export duration (ms)
 * Traverses all scenes and script blocks, accumulating TTS duration and action duration
 */
export function calculateExportDuration(episode: Episode): number {
  let totalDuration = 0

  for (const scene of episode.scenes) {
    for (const block of scene.script) {
      totalDuration += getBlockDurationMs(block)
    }
  }

  return totalDuration
}

/**
 * Get all asset IDs required during export
 */
export function getExportAssetIds(episode: Episode, _actors: ActorConfig[]): {
  backgrounds: string[]
  bgms: string[]
} {
  const backgrounds = new Set<string>()
  const bgms = new Set<string>()


  for (const scene of episode.scenes) {
    // Collect assets from setup
    for (const obj of scene.setup.objects) {
      if (obj.type === 'background' && obj.refId) {
        // Unify to use refId for background as well (v6.0 standard)
        backgrounds.add(obj.refId)
      } else if (((obj.type as string) === 'bgm' || obj.type === 'audio') && obj.refId) {
        bgms.add(obj.refId)
      }
    }

    // v7.0: Collect assets from script blocks (look up instance via instanceId to get associated character)
    for (const block of scene.script) {
      if (block.type === 'dialogue') {
        // Character instance lookup removed — character type deleted
      }
    }
  }

  return {
    backgrounds: Array.from(backgrounds),
    bgms: Array.from(bgms),
  }
}

/**
 * Scene state snapshot during export
 */
export interface ExportSceneSnapshot {
  sceneId: string
  sceneTitle: string
  setup: SceneContainer['setup']
  currentTime: number // Scene start time (seconds)
}

/**
 * Script block execution info during export
 */
export interface ExportBlockExecution {
  sceneId: string
  blockId: string
  blockType: ScriptBlock['type']
  startTime: number // Block start time (seconds)
  duration: number // Block duration (seconds)
  actions: Action[] // Action list in block
}

/**
 * Generate export timeline
 * Returns chronologically ordered scene snapshots and script block execution info
 */
export function generateExportTimeline(episode: Episode): {
  snapshots: ExportSceneSnapshot[]
  executions: ExportBlockExecution[]
} {
  const snapshots: ExportSceneSnapshot[] = []
  const executions: ExportBlockExecution[] = []
  let currentTime = 0

  for (const scene of episode.scenes) {
    // Scene snapshot (at start of scene)
    snapshots.push({
      sceneId: scene.id,
      sceneTitle: scene.title,
      setup: scene.setup,
      currentTime
    })

    // Traverse all script blocks in scene
    for (const block of scene.script) {
      const blockDuration = getBlockDurationMs(block)

      executions.push({
        sceneId: scene.id,
        blockId: block.id,
        blockType: block.type,
        startTime: currentTime,
        duration: blockDuration,
        actions: block.actions
      })

      currentTime += blockDuration
    }
  }

  return { snapshots, executions }
}
