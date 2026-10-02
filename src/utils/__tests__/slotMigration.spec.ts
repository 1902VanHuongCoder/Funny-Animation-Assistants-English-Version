/**
 * Unit tests for action migration logic on slot changes
 * Covers insertion (3 cases), deletion (4 cases), and change detection
 */
import { describe, expect, it } from 'vitest'

import type { Action, RuntimeSlot } from '@/types/screenplay'
import {
  detectSlotTextChanges,
  migrateActionsOnSlotDelete,
  migrateActionsOnSlotInsert,
} from '@/utils/slotUtils'

// ==================== Helper Factories ====================

function makePointAction(id: string, slotIndex: number, target = 'actor1'): Action {
  return {
    id,
    type: 'set_transform',
    category: 'point',
    target,
    slotIndex,
    params: { x: 0, y: 0 },
  } as Action
}

function makeDurationAction(id: string, slotIndex: number, slotSpan: number, target = 'actor1'): Action {
  return {
    id,
    type: 'tween_transform',
    category: 'duration',
    target,
    slotIndex,
    slotSpan,
    easing: 'linear',
    params: { x: 100 },
  } as Action
}

function makeSlot(index: number, type: 'preroll' | 'subtitle' | 'postroll', text?: string): RuntimeSlot {
  const slot: RuntimeSlot = {
    type,
    index,
    startTime: index * 500,
    duration: 500,
  }
  if (text !== undefined) {
    slot.text = text
  }
  return slot
}

// ==================== migrateActionsOnSlotInsert ====================

describe('migrateActionsOnSlotInsert', () => {
  it('Case 1: Point Action before insertion point -> unchanged', () => {
    const actions = [makePointAction('a1', 1)]
    migrateActionsOnSlotInsert(actions, 3, 1)
    expect(actions[0]!.slotIndex).toBe(1)
  })

  it('Case 2: Point Action after insertion point -> slotIndex += N', () => {
    const actions = [makePointAction('a1', 3)]
    migrateActionsOnSlotInsert(actions, 2, 1)
    expect(actions[0]!.slotIndex).toBe(4)
  })

  it('Case 1: Point Action exactly at insertion point -> unchanged (stays in first half after split)', () => {
    const actions = [makePointAction('a1', 2)]
    migrateActionsOnSlotInsert(actions, 2, 1)
    expect(actions[0]!.slotIndex).toBe(2)
  })

  it('Case 3: Duration Action exactly at insertion point -> span += N (covers both halves after split)', () => {
    const actions = [makeDurationAction('a1', 2, 1)]
    migrateActionsOnSlotInsert(actions, 2, 1)
    expect(actions[0]!.slotIndex).toBe(2) // start index unchanged
    expect((actions[0] as { slotSpan: number }).slotSpan).toBe(2) // span extended
  })

  it('Case 2: Duration Action completely after insertion point -> slotIndex += N, span unchanged', () => {
    const actions = [makeDurationAction('a1', 3, 2)]
    migrateActionsOnSlotInsert(actions, 2, 1)
    expect(actions[0]!.slotIndex).toBe(4)
    expect((actions[0] as { slotSpan: number }).slotSpan).toBe(2)
  })

  it('Case 3: Duration Action spanning insertion point -> slotSpan += N', () => {
    const actions = [makeDurationAction('a1', 1, 2)] // covers [1, 2]
    migrateActionsOnSlotInsert(actions, 2, 1) // insert at index=2
    expect(actions[0]!.slotIndex).toBe(1) // start index unchanged
    expect((actions[0] as { slotSpan: number }).slotSpan).toBe(3) // span extended
  })

  it('Case 1: Duration Action completely before insertion point and not spanning -> unchanged', () => {
    const actions = [makeDurationAction('a1', 0, 2)] // covers [0, 1]
    migrateActionsOnSlotInsert(actions, 2, 1) // insert at index=2
    expect(actions[0]!.slotIndex).toBe(0)
    expect((actions[0] as { slotSpan: number }).slotSpan).toBe(2)
  })

  it('insert insertCount > 1', () => {
    const actions = [
      makePointAction('a1', 3),
      makeDurationAction('a2', 1, 3), // covers [1, 2, 3]
    ]
    migrateActionsOnSlotInsert(actions, 2, 2) // insert 2 at index=2
    expect(actions[0]!.slotIndex).toBe(5) // 3 + 2
    expect(actions[1]!.slotIndex).toBe(1) // unchanged
    expect((actions[1] as { slotSpan: number }).slotSpan).toBe(5) // 3 + 2
  })

  it('Comprehensive example: multiple mixed actions', () => {
    const actions = [
      makePointAction('A', 1),           // teleport at "hello"
      makeDurationAction('B', 1, 2),     // tween from "hello" to "world"
      makePointAction('C', 2),           // spawn at "world"
      makeDurationAction('D', 2, 1),     // camera move at "world"
    ]
    // insert 1 slot ("Xiao Ming") at index=2
    migrateActionsOnSlotInsert(actions, 2, 1)

    expect(actions[0]!.slotIndex).toBe(1) // A: unchanged
    expect(actions[1]!.slotIndex).toBe(1) // B: unchanged
    expect((actions[1] as { slotSpan: number }).slotSpan).toBe(3) // B: span extended
    expect(actions[2]!.slotIndex).toBe(2) // C: exactly at insertion point -> unchanged (stays in first half)
    expect(actions[3]!.slotIndex).toBe(2) // D: exactly at insertion point -> unchanged
    expect((actions[3] as { slotSpan: number }).slotSpan).toBe(2) // D: span extended (covers both halves after split)
  })
})

// ==================== migrateActionsOnSlotDelete ====================

describe('migrateActionsOnSlotDelete', () => {
  it('Case 1: Point Action before deletion interval -> unchanged', () => {
    const actions = [makePointAction('a1', 1)]
    migrateActionsOnSlotDelete(actions, 3, 1)
    expect(actions[0]!.slotIndex).toBe(1)
  })

  it('Case 2: Point Action after deletion interval -> slotIndex -= N', () => {
    const actions = [makePointAction('a1', 4)]
    migrateActionsOnSlotDelete(actions, 2, 1)
    expect(actions[0]!.slotIndex).toBe(3)
  })

  it('Case 3a: Duration completely spanning deletion interval -> slotSpan -= N', () => {
    const actions = [makeDurationAction('a1', 1, 3)] // covers [1, 2, 3]
    migrateActionsOnSlotDelete(actions, 2, 1) // delete index=2
    expect(actions[0]!.slotIndex).toBe(1)
    expect((actions[0] as { slotSpan: number }).slotSpan).toBe(2)
  })

  it('Case 3b: Duration tail falls into deletion interval -> slotSpan truncated', () => {
    const actions = [makeDurationAction('a1', 1, 2)] // covers [1, 2]
    migrateActionsOnSlotDelete(actions, 2, 2) // delete [2, 3]
    expect(actions[0]!.slotIndex).toBe(1)
    expect((actions[0] as { slotSpan: number }).slotSpan).toBe(1) // truncated to deleteIndex - startIdx = 1
  })

  it('Case 4 Point: on deleted slot -> shifted and merged', () => {
    const actions = [makePointAction('a1', 2)]
    migrateActionsOnSlotDelete(actions, 2, 1) // delete index=2
    expect(actions[0]!.slotIndex).toBe(2) // shifted to new index=2 (formerly index=3)
  })

  it('Case 4 Duration: starts at deleted slot, span partially extends beyond -> shifted + residual span', () => {
    const actions = [makeDurationAction('a1', 2, 2)] // covers [2, 3]
    migrateActionsOnSlotDelete(actions, 2, 1) // delete index=2
    expect(actions[0]!.slotIndex).toBe(2) // shifted and merged
    expect((actions[0] as { slotSpan: number }).slotSpan).toBe(1) // max(1, 4-3) = 1
  })

  it('Case 4 Duration: span completely inside deletion interval -> shifted + fallback span 1 (never deletes action)', () => {
    const actions = [makeDurationAction('a1', 2, 1)] // covers [2]
    migrateActionsOnSlotDelete(actions, 2, 1) // delete index=2
    expect(actions).toHaveLength(1) // never delete!
    expect(actions[0]!.slotIndex).toBe(2)
    expect((actions[0] as { slotSpan: number }).slotSpan).toBe(1) // max(1, 0) = 1
  })

  it('deleteCount > 1', () => {
    const actions = [
      makePointAction('a1', 1),
      makePointAction('a2', 3),
      makeDurationAction('a3', 2, 1), // completely inside deletion interval
    ]
    migrateActionsOnSlotDelete(actions, 2, 2) // delete [2, 3]
    expect(actions).toHaveLength(3)
    expect(actions[0]!.slotIndex).toBe(1)  // Case 1: unchanged
    expect(actions[1]!.slotIndex).toBe(2)  // Case 4: shifted and merged (startIdx=3 within [2,3])
    expect(actions[2]!.slotIndex).toBe(2)  // Case 4: shifted and merged
    expect((actions[2] as { slotSpan: number }).slotSpan).toBe(1) // fallback minimum
  })

  it('Invariant: action count remains strictly unchanged', () => {
    const actions = [
      makePointAction('a1', 0),
      makePointAction('a2', 1),
      makeDurationAction('a3', 1, 3),
      makePointAction('a4', 2),
      makeDurationAction('a5', 2, 1),
      makePointAction('a6', 3),
    ]
    const originalCount = actions.length
    migrateActionsOnSlotDelete(actions, 2, 1)
    expect(actions).toHaveLength(originalCount) // never delete
  })

  it('Comprehensive example verification', () => {
    const actions = [
      makePointAction('A', 1),           // teleport at "hello"
      makeDurationAction('B', 1, 3),     // tween from "hello" through "Xiao Ming" to "world"
      makePointAction('C', 2),           // spawn at "Xiao Ming"
      makeDurationAction('D', 3, 1),     // camera move at "world"
      makeDurationAction('E', 2, 2),     // tween from "Xiao Ming" to "world"
      makeDurationAction('F', 2, 1),     // screen shake at "Xiao Ming"
    ]
    // delete index=2 ("Xiao Ming")
    migrateActionsOnSlotDelete(actions, 2, 1)

    // A: Case 1, unchanged
    expect(actions[0]!.slotIndex).toBe(1)
    // B: Case 3a, span contracts 3-1=2
    expect(actions[1]!.slotIndex).toBe(1)
    expect((actions[1] as { slotSpan: number }).slotSpan).toBe(2)
    // C: Case 4 Point, shifted and merged to 2
    expect(actions[2]!.slotIndex).toBe(2)
    // D: Case 2, shifted forward 3-1=2
    expect(actions[3]!.slotIndex).toBe(2)
    expect((actions[3] as { slotSpan: number }).slotSpan).toBe(1)
    // E: Case 4 Duration, shifted + residual span=max(1, 4-3)=1
    expect(actions[4]!.slotIndex).toBe(2)
    expect((actions[4] as { slotSpan: number }).slotSpan).toBe(1)
    // F: Case 4 Duration, shifted + fallback span=1
    expect(actions[5]!.slotIndex).toBe(2)
    expect((actions[5] as { slotSpan: number }).slotSpan).toBe(1)
  })
})

// ==================== detectSlotTextChanges ====================

describe('detectSlotTextChanges', () => {
  it('no change -> null', () => {
    const slots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello, '),
      makeSlot(2, 'subtitle', 'world'),
      makeSlot(3, 'postroll'),
    ]
    expect(detectSlotTextChanges(slots, slots)).toBeNull()
  })

  it('insert 1 slot in middle -> insert', () => {
    const oldSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello, '),
      makeSlot(2, 'subtitle', 'world'),
      makeSlot(3, 'postroll'),
    ]
    const newSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello, '),
      makeSlot(2, 'subtitle', 'Xiao Ming, '),
      makeSlot(3, 'subtitle', 'world'),
      makeSlot(4, 'postroll'),
    ]
    const result = detectSlotTextChanges(oldSlots, newSlots)
    expect(result).toEqual({ type: 'insert', index: 2, count: 1 })
  })

  it('insert at end -> insert at end', () => {
    const oldSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello, '),
      makeSlot(2, 'postroll'),
    ]
    const newSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello, '),
      makeSlot(2, 'subtitle', 'world'),
      makeSlot(3, 'postroll'),
    ]
    const result = detectSlotTextChanges(oldSlots, newSlots)
    expect(result).toEqual({ type: 'insert', index: 2, count: 1 })
  })

  it('delete 1 slot in middle -> delete', () => {
    const oldSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello, '),
      makeSlot(2, 'subtitle', 'Xiao Ming, '),
      makeSlot(3, 'subtitle', 'world'),
      makeSlot(4, 'postroll'),
    ]
    const newSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello, '),
      makeSlot(2, 'subtitle', 'world'),
      makeSlot(3, 'postroll'),
    ]
    const result = detectSlotTextChanges(oldSlots, newSlots)
    expect(result).toEqual({ type: 'delete', index: 2, count: 1 })
  })

  it('insert multiple sequentially -> insert with count > 1', () => {
    const oldSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello, '),
      makeSlot(2, 'subtitle', 'world'),
      makeSlot(3, 'postroll'),
    ]
    const newSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello, '),
      makeSlot(2, 'subtitle', 'Xiao Ming, '),
      makeSlot(3, 'subtitle', 'Xiao Hong, '),
      makeSlot(4, 'subtitle', 'world'),
      makeSlot(5, 'postroll'),
    ]
    const result = detectSlotTextChanges(oldSlots, newSlots)
    expect(result).toEqual({ type: 'insert', index: 2, count: 2 })
  })

  it('same length but content changed -> complex', () => {
    const oldSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello, '),
      makeSlot(2, 'postroll'),
    ]
    const newSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Goodbye, '),
      makeSlot(2, 'postroll'),
    ]
    const result = detectSlotTextChanges(oldSlots, newSlots)
    expect(result).toEqual({ type: 'complex' })
  })

  it('evaluates subtitle changes when preroll/postroll unchanged', () => {
    const oldSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello'),
      makeSlot(2, 'postroll'),
    ]
    const newSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello'),
      makeSlot(2, 'subtitle', 'world'),
      makeSlot(3, 'postroll'),
    ]
    const result = detectSlotTextChanges(oldSlots, newSlots)
    expect(result).toEqual({ type: 'insert', index: 2, count: 1 })
  })

  it('slot split: user inserts # in middle of text -> detected as insert', () => {
    // User inserts # in middle of "rather I Lu Changsheng do not deign to #", splitting into two slots
    const oldSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Today it is not you casting me out, '),
      makeSlot(2, 'subtitle', 'rather I Lu Changsheng do not deign to #'),
      makeSlot(3, 'subtitle', 'associate with you.'),
      makeSlot(4, 'postroll'),
    ]
    const newSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Today it is not you casting me out, '),
      makeSlot(2, 'subtitle', 'rather #'),
      makeSlot(3, 'subtitle', 'I Lu Changsheng do not deign to #'),
      makeSlot(4, 'subtitle', 'associate with you.'),
      makeSlot(5, 'postroll'),
    ]
    const result = detectSlotTextChanges(oldSlots, newSlots)
    expect(result).toEqual({ type: 'insert', index: 2, count: 1 })
  })

  it('slot merge: user deletes punctuation -> detected as delete', () => {
    // User deletes comma, causing two slots to merge into one
    const oldSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello, '),
      makeSlot(2, 'subtitle', 'Xiao Ming, '),
      makeSlot(3, 'subtitle', 'world'),
      makeSlot(4, 'postroll'),
    ]
    const newSlots = [
      makeSlot(0, 'preroll'),
      makeSlot(1, 'subtitle', 'Hello Xiao Ming, '),
      makeSlot(2, 'subtitle', 'world'),
      makeSlot(3, 'postroll'),
    ]
    const result = detectSlotTextChanges(oldSlots, newSlots)
    expect(result).toEqual({ type: 'delete', index: 1, count: 1 })
  })
})
