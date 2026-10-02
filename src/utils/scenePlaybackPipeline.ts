/**
 * Scene playback pipeline — shared precomputation logic
 *
 * Extracts duplicated prepareBlockPlayInfos across ScenePlayer and FrameCapture into a unified entry point.
 * Core design:
 * - Uses applyBlockActionsToState as the sole state advancement engine
 * - Records RuntimeSceneSnapshot at the start of each Block during iteration
 * - Outputs BlockPlayInfo[] for three consumers (editor / ScenePlayer / FrameCapture)
 */

import type { Action, BlockPlayInfo, RuntimeSceneSnapshot, SceneContainer, ScriptBlock } from '@/types/screenplay'
import { applyBlockActionsToState } from '@/utils/sceneStateCalculator'
import { parseBlockToSlots } from '@/utils/slotUtils'

/**
 * Block duration resolution callback
 * Consumers can inject custom logic (e.g. FrameCapture fetching duration from pre-rendered TTS)
 */
export interface BlockDurationResolver {
  /** Get Block duration (ms). Returning 0 indicates using default value. */
  getDuration(block: ScriptBlock): number
  /** Get Block audio URL (optional) */
  getAudioUrl?(block: ScriptBlock): string | undefined
}

/**
 * Default Block duration resolver
 * Reads from ScriptBlock ttsConfig.duration or action block duration field
 */
export const defaultDurationResolver: BlockDurationResolver = {
  getDuration(block: ScriptBlock): number {
    if (block.type === 'action') {
      return block.duration || 0
    }
    return block.ttsConfig?.duration ?? 0
  },
}

/**
 * Build Block playback info list
 *
 * @param initialSnapshot Initial scene RuntimeSceneSnapshot
 * @param blocks List of blocks to process
 * @param scene Scene container (optional, used for actor lookup)
 * @param resolver Duration / audio resolver (defaults to reading from ttsConfig)
 * @param startTimeOffset Start time offset (ms), defaults to 0
 * @returns BlockPlayInfo[] — Playback info for each Block (including startSnapshot)
 */
export function prepareBlockPlayInfos(
  initialSnapshot: RuntimeSceneSnapshot,
  blocks: ScriptBlock[],
  scene?: SceneContainer,
  resolver: BlockDurationResolver = defaultDurationResolver,
  startTimeOffset = 0,
): BlockPlayInfo[] {
  const result: BlockPlayInfo[] = []
  let accumulatedTime = startTimeOffset

  // Current iteration state
  let currentState: RuntimeSceneSnapshot = JSON.parse(JSON.stringify(initialSnapshot)) as RuntimeSceneSnapshot

  for (const block of blocks) {
    // 1. Resolve duration
    let duration = resolver.getDuration(block)
    if (duration <= 0) {
      duration = 1000 // Default 1 second
    }

    // 2. Resolve audio
    const audioUrl = resolver.getAudioUrl?.(block)

    // 3. Resolve slots
    const slots = parseBlockToSlots(block)
    const blockActions: Action[] = block.actions || []

    // 4. Record current state snapshot as startSnapshot of this Block
    const startSnapshot: RuntimeSceneSnapshot = JSON.parse(JSON.stringify(currentState)) as RuntimeSceneSnapshot

    const startTime = accumulatedTime
    const endTime = accumulatedTime + duration

    result.push({
      startSnapshot,
      block,
      startTime,
      endTime,
      duration,
      slots,
      blockActions,
      ...(audioUrl ? { audioUrl } : {}),
    })

    // 5. Advance state to end of this Block (using applyBlockActionsToState, including autoDespawn + renderChain coordination)
    currentState = applyBlockActionsToState(currentState, block, scene)

    accumulatedTime += duration
  }

  return result
}

/**
 * Build Map<string, SceneObject> from BlockPlayInfo.startSnapshot
 * Compatibility layer: for consumers not yet migrated to RuntimeSceneSnapshot
 */
export function snapshotToObjectMap(snapshot: RuntimeSceneSnapshot): Map<string, import('@/types/sceneObject').SceneObject> {
  const map = new Map<string, import('@/types/sceneObject').SceneObject>()
  for (const obj of snapshot.objects) {
    map.set(obj.id, obj)
  }
  return map
}
