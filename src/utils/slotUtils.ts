/**
 * Slot utility functions (v6.2)
 * Responsible for converting Block text and TTS configuration into RuntimeSlot lists
 */

import type { Action, BaseDurationAction, DisplaySlot, RuntimeSlot, ScriptBlock } from '@/types/screenplay'

/**
 * Clean subtitle display text: removes internal control characters only, preserving punctuation to avoid changing semantics
 * Used for subtitle rendering in preview/playback
 */
export function cleanTextForSubtitle(text: string): string {
  return text.replace(/#/g, '')
}

const STRONG_SUBTITLE_BREAK_REGEX = /[。.！!？?…]/
const SUBTITLE_LENGTH_PUNCTUATION_REGEX = /[，,。.！!？?…;；:：#\s]/g
const DISPLAY_SEPARATOR_SUFFIX_REGEX = /[，,。.！!？?…;；:：\n#]+$/
const MIN_STRONG_SEGMENT_CHARS = 4
const MIN_WEAK_SEGMENT_CHARS = 14
const MAX_SEGMENT_CHARS = 24

function getSubtitleReadableLength(text: string): number {
  return text.replace(SUBTITLE_LENGTH_PUNCTUATION_REGEX, '').length
}

function shouldFlushDisplaySegment(buffer: string, separator: string): boolean {
  const length = getSubtitleReadableLength(buffer)
  if (length === 0) return false
  if (separator.includes('\n')) return true
  if (length >= MAX_SEGMENT_CHARS) return true
  if (STRONG_SUBTITLE_BREAK_REGEX.test(separator)) return length >= MIN_STRONG_SEGMENT_CHARS
  if (separator.replace(/#/g, '').length === 0) return false
  return length >= MIN_WEAK_SEGMENT_CHARS
}

/**
 * Build subtitle display slots.
 * Displays subtitle slots only. '#' acts as hidden control character without affecting display segmentation/merging.
 */
export function buildSubtitleDisplaySlots(slots: RuntimeSlot[]): RuntimeSlot[] {
  const subtitleSlots = slots.filter(slot => slot.type === 'subtitle')
  const displaySlots: RuntimeSlot[] = []
  let bufferText = ''
  let bufferStartTime = 0
  let bufferDuration = 0

  const pushDisplaySlot = (): void => {
    const text = bufferText.trim()
    if (!text) return

    const length = getSubtitleReadableLength(text)
    const previous = displaySlots[displaySlots.length - 1]
    const shouldMergeTrailingShortSegment = Boolean(previous)
      && length > 0
      && length < MIN_STRONG_SEGMENT_CHARS
      && getSubtitleReadableLength(previous?.text ?? '') + length <= MAX_SEGMENT_CHARS

    if (shouldMergeTrailingShortSegment && previous) {
      previous.text = `${previous.text ?? ''}${text}`
      previous.duration += bufferDuration
    } else {
      displaySlots.push({
        type: 'subtitle',
        index: displaySlots.length,
        text,
        startTime: bufferStartTime,
        duration: bufferDuration,
        isEstimated: true,
      })
    }

    bufferText = ''
    bufferDuration = 0
  }

  for (const slot of subtitleSlots) {
    if (!bufferText) {
      bufferStartTime = slot.startTime
    }

    bufferText += slot.text ?? ''
    bufferDuration += slot.duration

    const separator = (DISPLAY_SEPARATOR_SUFFIX_REGEX.exec(bufferText))?.[0] ?? ''
    if (shouldFlushDisplaySegment(bufferText, separator)) {
      pushDisplaySlot()
    }
  }

  pushDisplaySlot()
  return displaySlots
}

/**
 * Get subtitle text that should be displayed at local time of specified Block.
 * Shared between ScenePlayer and video export to avoid split/clean rule drift.
 */
export function getSubtitleTextAtTime(block: ScriptBlock, slots: RuntimeSlot[], localTime: number): string {
  if (block.type === 'action') {
    return ''
  }

  const subtitleSlots = buildSubtitleDisplaySlots(slots)
  if (subtitleSlots.length === 0) {
    return cleanTextForSubtitle(block.text ?? '')
  }

  for (const slot of subtitleSlots) {
    const slotEndTime = slot.startTime + slot.duration
    if (localTime >= slot.startTime && localTime < slotEndTime) {
      return cleanTextForSubtitle(slot.text ?? '')
    }
  }

  return ''
}

/**
 * Split text into slots
 * Splits text into multiple clauses according to punctuation, each clause corresponding to a slot
 * v6.10: Automatically adds preroll and postroll slots
 * 
 * @param block Script block
 * @returns RuntimeSlot array
 */
export function parseBlockToSlots(block: ScriptBlock): RuntimeSlot[] {
  if (block.type === 'action') {
    // ActionBlock has only one slot by default
    return [{
      type: 'subtitle',
      index: 0,
      startTime: 0,
      duration: block.duration,
      text: ''
    }]
  }

  const text = block.text || ''
  const ttsConfig = block.ttsConfig as unknown as { duration?: number }
  const totalDuration = ttsConfig?.duration ?? (text.length * 250) // Baseline duration: 250ms per character

  // If text is empty, return empty array
  if (!text.trim()) {
    return []
  }

  // Unified estimation mode: punctuation segmentation + proportional character allocation
  const subtitleSlots = splitTextToSlotsByPunctuation(text, totalDuration)
  return addPrerollPostrollEstimated(subtitleSlots, totalDuration)
}

/**
 * Add preroll and postroll slots to estimated subtitle slots
 * Reserves fixed time for preroll/postroll
 * @param subtitleSlots Subtitle slots array
 * @param totalDuration Block total duration
 */
function addPrerollPostrollEstimated(subtitleSlots: RuntimeSlot[], totalDuration: number): RuntimeSlot[] {
  if (subtitleSlots.length === 0) return []

  // Default fixed duration of 100ms for preroll/postroll
  const estimatedDuration = 100

  const result: RuntimeSlot[] = []
  let currentIndex = 0

  // 1. Add preroll slot
  result.push({
    type: 'preroll',
    index: currentIndex++,
    startTime: 0,
    duration: estimatedDuration,
    isEstimated: true
  })

  // 2. Add subtitle slots (update index, adjust startTime)
  const availableDuration = totalDuration - estimatedDuration * 2
  const originalTotalDuration = subtitleSlots.reduce((sum, s) => sum + s.duration, 0)
  const ratio = availableDuration / originalTotalDuration

  let currentTime = estimatedDuration
  for (const slot of subtitleSlots) {
    const adjustedDuration = Math.floor(slot.duration * ratio)
    result.push({
      ...slot,
      type: 'subtitle',
      index: currentIndex++,
      startTime: currentTime,
      duration: adjustedDuration,
      isEstimated: true
    })
    currentTime += adjustedDuration
  }

  // 3. Add postroll slot
  result.push({
    type: 'postroll',
    index: currentIndex++,
    startTime: currentTime,
    duration: totalDuration - currentTime,
    isEstimated: true
  })

  return result
}

/**
 * Punctuation segmentation + proportional character duration estimation.
 * Slot serves as action time anchor; split rules must be stable: all clause punctuation and silent separator # create Slots.
 */
function splitTextToSlotsByPunctuation(text: string, totalDuration: number): RuntimeSlot[] {
  const punctuationRegex = /[，,。.！!？?…;；:：\n#]+/
  const parts = text.split(punctuationRegex)
  const separators = text.match(new RegExp(punctuationRegex.source, 'g')) ?? []
  const contentSegments: string[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = (parts[i] ?? '').trim()
    if (!part) continue

    const separator = separators[i] ?? ''
    contentSegments.push(part + separator)
  }

  // If no valid clauses, treat entire text as single Slot
  if (contentSegments.length === 0 && text.trim()) {
    return [{
      type: 'subtitle',
      index: 0,
      text: text,
      startTime: 0,
      duration: totalDuration
    }]
  }

  // Calculate duration of each slot proportionally by character count
  const totalLength = contentSegments.reduce((sum, s) => sum + s.length, 0)
  let currentTime = 0

  return contentSegments.map((seg, index) => {
    const ratio = seg.length / totalLength
    const dur = Math.floor(totalDuration * ratio)
    const slot: RuntimeSlot = {
      type: 'subtitle',
      index,
      text: seg,
      startTime: currentTime,
      duration: dur
    }
    currentTime += dur
    return slot
  })
}

/**
 * Calculate display slots based on Actions in Block
 * Handles slot merging logic, merging display for DurationActions where slotSpan > 1
 * 
 * @param rawSlots Raw slots list
 * @param actions Actions list in Block
 * @returns DisplaySlot array
 */
export function calculateDisplaySlots(rawSlots: RuntimeSlot[], actions: Action[]): DisplaySlot[] {
  if (rawSlots.length === 0) return []

  const displaySlots: DisplaySlot[] = []
  const skipIndices = new Set<number>()

  // Find all span DurationActions
  const spanActions = actions.filter(
    a => a.category === 'duration' && (a as unknown as { slotSpan: number }).slotSpan > 1
  )

  // Map slot index to span
  const spanMap = new Map<number, number>()
  for (const action of spanActions) {
    const span = (action as unknown as { slotSpan: number }).slotSpan ?? 1
    const currentSpan = spanMap.get(action.slotIndex) ?? 1
    // Take maximum span
    spanMap.set(action.slotIndex, Math.max(currentSpan, span))
  }

  for (let i = 0; i < rawSlots.length; i++) {
    if (skipIndices.has(i)) continue

    const slot = rawSlots[i]
    if (!slot) continue
    const span = spanMap.get(i) ?? 1

    // Mark subsequent slots as skipped
    for (let k = 1; k < span; k++) {
      if (i + k < rawSlots.length) {
        skipIndices.add(i + k)
      }
    }

    // Compute merged total duration and text
    let mergedText = slot.text
    let mergedDuration = slot.duration

    for (let k = 1; k < span; k++) {
      const next = rawSlots[i + k]
      if (next) {
        mergedText = (mergedText ?? '') + (next.text ?? '')
        mergedDuration += next.duration
      }
    }

    displaySlots.push({
      ...slot,
      text: mergedText ?? '',
      duration: mergedDuration,
      spanCount: span,
      isMerged: span > 1
    })
  }

  return displaySlots
}

/**
 * Calculate timing information of action based on slot index and span
 * 
 * @param action Action object
 * @param allSlots All raw slots
 * @returns Object containing startTime and duration, or null (if slot does not exist)
 */
export function getActionTiming(
  action: Action,
  allSlots: RuntimeSlot[]
): { startTime: number; duration: number } | null {
  const startSlot = allSlots[action.slotIndex]

  if (!startSlot) {
    // Fault tolerance: slot not found (text might have changed)
    console.warn(`[slotUtils] Slot ${action.slotIndex} not found, total slots: ${allSlots.length}`)
    return null
  }

  const startTime = startSlot.startTime
  let duration = 0

  if (action.category === 'duration') {
    const span = (action as unknown as { slotSpan: number }).slotSpan ?? 1
    // Accumulate duration across all spanned slots
    for (let i = 0; i < span; i++) {
      const s = allSlots[action.slotIndex + i]
      if (s) duration += s.duration
    }
  }

  return { startTime, duration }
}

/**
 * Check whether action is point action
 */
export function isPointAction(action: Action): boolean {
  return action.category === 'point'
}

/**
 * Check whether action is duration action
 */
export function isDurationAction(action: Action): boolean {
  return action.category === 'duration'
}

/**
 * Get point actions for specified slot
 */
export function getPointActionsForSlot(slotIndex: number, actions: Action[]): Action[] {
  return actions.filter(a => a.category === 'point' && a.slotIndex === slotIndex)
}

/**
 * Get duration actions for specified slot
 */
export function getDurationActionsForSlot(slotIndex: number, actions: Action[]): Action[] {
  return actions.filter(a => a.category === 'duration' && a.slotIndex === slotIndex)
}

/**
 * Validate whether action slot index is valid
 * 
 * @param action Action object
 * @param totalSlots Total slot count
 * @returns Whether valid
 */
export function isActionSlotValid(action: Action, totalSlots: number): boolean {
  if (action.slotIndex < 0 || action.slotIndex >= totalSlots) {
    return false
  }

  if (action.category === 'duration') {
    const span = (action as unknown as { slotSpan?: number }).slotSpan ?? 1
    // Check if span extends beyond boundary
    if (action.slotIndex + span > totalSlots) {
      return false
    }
  }

  return true
}

/**
 * Clean invalid actions (actions with slot index out of bounds)
 * 
 * @param actions Actions list
 * @param totalSlots Total slot count
 * @returns Filtered valid actions list
 */
export function cleanInvalidActions(actions: Action[], totalSlots: number): Action[] {
  return actions.filter(action => isActionSlotValid(action, totalSlots))
}

/**
 * Check whether slot selection is continuous
 * 
 * @param indices Selected slot indices array
 * @returns Whether continuous
 */
export function isSelectionContinuous(indices: number[]): boolean {
  if (indices.length <= 1) return true

  const sorted = [...indices].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const prev = sorted[i - 1]
    if (current === undefined || prev === undefined) continue;
    if (current - prev !== 1) {
      return false
    }
  }
  return true
}

/**
 * Create new point action
 */
export function createPointAction(
  type: Action['type'],
  target: string,
  slotIndex: number,
  params: Record<string, unknown> = {}
): Action {
  return {
    id: generateActionId(),
    type,
    category: 'point',
    target,
    slotIndex,
    ...params
  } as Action
}

/**
 * Create new duration action
 */
export function createDurationAction(
  type: Action['type'],
  target: string,
  slotIndex: number,
  slotSpan = 1,
  params: Record<string, unknown> = {},
  easing = 'linear'
): Action {
  return {
    id: generateActionId(),
    type,
    category: 'duration',
    target,
    slotIndex,
    slotSpan,
    easing,
    params
  } as Action
}

/**
 * Generate action ID
 */
function generateActionId(): string {
  return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// ==================== Action Migration on Slot Changes ====================

/**
 * Slot change detection result
 */
export type SlotChange =
  | { type: 'insert'; index: number; count: number }
  | { type: 'delete'; index: number; count: number }
  | { type: 'complex' }

/**
 * Action migration on slot insertion
 *
 * Three cases:
 * - Case 1: Start point before insertion point (inclusive) and not spanning -> unchanged
 * - Case 2: Start point after insertion point (strictly greater) -> slotIndex += insertCount
 * - Case 3: Duration Action start point at or before insertion point, span crosses insertion point -> slotSpan += insertCount
 *
 * @param actions All actions in Block (in-place modification)
 * @param insertIndex Position where new slots are inserted
 * @param insertCount Number of inserted slots
 */
export function migrateActionsOnSlotInsert(
  actions: Action[],
  insertIndex: number,
  insertCount: number
): void {
  for (const action of actions) {
    if (action.slotIndex > insertIndex) {
      // Case 2: Start point after insertion point -> shift forward
      action.slotIndex += insertCount
    } else if (action.category === 'duration') {
      // Start point at or before insertion point, check if span crosses insertion point
      const dAction = action as BaseDurationAction
      const span = dAction.slotSpan ?? 1
      if (action.slotIndex + span > insertIndex) {
        // Case 3: Span crosses insertion point -> expand span
        dAction.slotSpan = span + insertCount
      }
    }
    // Case 1: Start point before insertion point and not spanning -> unchanged
  }
}

/**
 * Action migration on slot deletion
 *
 * Core constraint: Never delete any action; only adjust slotIndex and slotSpan
 *
 * Four cases:
 * - Case 1: Start point before deletion interval and not spanning -> unchanged
 * - Case 2: Start point after deletion interval -> slotIndex -= deleteCount
 * - Case 3: Duration crosses deletion interval -> slotSpan contracts (min 1)
 * - Case 4: Start point falls within deleted slots -> shift forward + Duration span min 1
 *
 * @param actions All actions in Block (in-place modification)
 * @param deleteIndex Start index of deleted slots
 * @param deleteCount Number of deleted slots
 */
export function migrateActionsOnSlotDelete(
  actions: Action[],
  deleteIndex: number,
  deleteCount: number
): void {
  const deleteEnd = deleteIndex + deleteCount // exclusive

  for (const action of actions) {
    const startIdx = action.slotIndex

    if (startIdx >= deleteEnd) {
      // Case 2: Start point after deletion interval -> shift backward
      action.slotIndex -= deleteCount

    } else if (startIdx >= deleteIndex) {
      // Case 4: Start point falls inside deleted range -> shift to first surviving slot
      action.slotIndex = deleteIndex

      if (action.category === 'duration') {
        const dAction = action as BaseDurationAction
        const span = dAction.slotSpan ?? 1
        const originalEnd = startIdx + span
        dAction.slotSpan = Math.max(1, originalEnd - deleteEnd)
      }

    } else if (action.category === 'duration') {
      // Start point before deletion interval, check if span crosses
      const dAction = action as BaseDurationAction
      const span = dAction.slotSpan ?? 1
      const endIdx = startIdx + span // exclusive

      if (endIdx > deleteEnd) {
        // Case 3a: Span completely spans deletion interval -> contract span
        dAction.slotSpan = span - deleteCount
      } else if (endIdx > deleteIndex) {
        // Case 3b: Span tail falls within deletion interval -> truncate, minimum 1
        dAction.slotSpan = Math.max(1, deleteIndex - startIdx)
      }
    }
    // Case 1: Point Action before deletion interval -> unchanged
  }
}

/**
 * Get text fingerprint of slot for change detection
 * preroll/postroll uses type, subtitle uses text
 */
function getSlotFingerprint(slot: RuntimeSlot): string {
  if (slot.type === 'preroll' || slot.type === 'postroll') {
    return `__${slot.type}__`
  }
  return slot.text ?? ''
}

/**
 * Detect insert/delete changes based on slot text content comparison
 *
 * Uses prefix-suffix matching algorithm:
 * 1. Find first mismatch position from head (common prefix length P)
 * 2. Find last mismatch position from tail (common suffix length S)
 * 3. Intermediate difference interval decides change type
 *
 * Naturally supports slot splitting (# or punctuation inserted in middle)
 * and slot merging (punctuation removed merging two slots into one).
 *
 * @param oldSlots Slot list before editing
 * @param newSlots Slot list after editing
 * @returns Change description, or null if no changes
 */
export function detectSlotTextChanges(
  oldSlots: RuntimeSlot[],
  newSlots: RuntimeSlot[]
): SlotChange | null {
  const oldLen = oldSlots.length
  const newLen = newSlots.length

  // Equal length: verify whether contents match identically
  if (oldLen === newLen) {
    const allMatch = oldSlots.every(
      (s, i) => getSlotFingerprint(s) === getSlotFingerprint(newSlots[i]!)
    )
    return allMatch ? null : { type: 'complex' }
  }

  const minLen = Math.min(oldLen, newLen)

  // Match from head: common prefix length
  let prefixLen = 0
  while (prefixLen < minLen &&
         getSlotFingerprint(oldSlots[prefixLen]!) === getSlotFingerprint(newSlots[prefixLen]!)) {
    prefixLen++
  }

  // Match from tail: common suffix length
  let suffixLen = 0
  while (suffixLen < (minLen - prefixLen) &&
         getSlotFingerprint(oldSlots[oldLen - 1 - suffixLen]!) === getSlotFingerprint(newSlots[newLen - 1 - suffixLen]!)) {
    suffixLen++
  }

  // Divergent range
  // oldDivergent = old[prefixLen .. oldLen - suffixLen)
  // newDivergent = new[prefixLen .. newLen - suffixLen)
  const changeIndex = prefixLen

  if (newLen > oldLen) {
    // New has more slots -> insertion (including slot splitting)
    return { type: 'insert', index: changeIndex, count: newLen - oldLen }
  } else {
    // Old has more slots -> deletion (including slot merging)
    return { type: 'delete', index: changeIndex, count: oldLen - newLen }
  }
}
