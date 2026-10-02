import { describe, expect, it } from 'vitest'

import type { RuntimeSlot, ScriptBlock } from '@/types/screenplay'
import { buildSubtitleDisplaySlots, getSubtitleTextAtTime, parseBlockToSlots } from '@/utils/slotUtils'

function makeNarration(text: string, duration = 6000): ScriptBlock {
    return {
        id: 'test_block',
        type: 'narration',
        text,
        ttsConfig: { duration },
        actions: [],
    }
}

function subtitleSlots(slots: RuntimeSlot[]): RuntimeSlot[] {
    return slots.filter(slot => slot.type === 'subtitle')
}

describe('slotUtils subtitle segmentation', () => {
    it('# splits runtime slots and is hidden from preview subtitle text', () => {
        const block = makeNarration('First part#second part.')
        const slots = parseBlockToSlots(block)
        const rawSubtitleTexts = subtitleSlots(slots).map(slot => slot.text)
        const displaySubtitleTexts = buildSubtitleDisplaySlots(slots).map(slot => slot.text)

        expect(rawSubtitleTexts).toEqual(['First part#', 'second part.'])
        expect(displaySubtitleTexts).toEqual(['First part#second part.'])
        const displaySlots = buildSubtitleDisplaySlots(slots)
        expect(getSubtitleTextAtTime(block, slots, displaySlots[0]!.startTime)).toBe('First partsecond part.')
    })

    it('keeps a Chinese period as display break even when # follows it', () => {
        const block = makeNarration('The group stood on the cliff looking down.#Seeing the direction of the village,')
        const slots = parseBlockToSlots(block)
        const displaySlots = buildSubtitleDisplaySlots(slots)

        expect(displaySlots.map(slot => slot.text)).toEqual([
            'The group stood on the cliff looking down.#',
            'Seeing the direction of the village,',
        ])
        expect(getSubtitleTextAtTime(block, slots, displaySlots[0]!.startTime)).toBe('The group stood on the cliff looking down.')
        expect(getSubtitleTextAtTime(block, slots, displaySlots[1]!.startTime)).toBe('Seeing the direction of the village,')
    })

    it('splits display subtitles at a normal Chinese period', () => {
        const block = makeNarration('Rushing out,standing on the cliff looking down. Seeing the direction of the village,')
        const slots = parseBlockToSlots(block)
        const displaySlots = buildSubtitleDisplaySlots(slots)

        expect(displaySlots.map(slot => slot.text)).toEqual([
            'Rushing out,standing on the cliff looking down.',
            'Seeing the direction of the village,',
        ])
        expect(getSubtitleTextAtTime(block, slots, displaySlots[0]!.startTime)).toBe('Rushing out,standing on the cliff looking down.')
        expect(getSubtitleTextAtTime(block, slots, displaySlots[1]!.startTime)).toBe('Seeing the direction of the village,')
    })

    it('splits runtime slots at every supported punctuation mark for action anchoring', () => {
        const block = makeNarration('Entering into the shed, looking at the smoking stove and cleared space, filled with admiration.', 6372)
        const slots = parseBlockToSlots(block)
        const rawSubtitleTexts = subtitleSlots(slots).map(slot => slot.text)

        expect(rawSubtitleTexts).toEqual([
            'Entering into the shed,',
            'looking at the smoking stove and cleared space,',
            'filled with admiration.',
        ])
        expect(slots).toHaveLength(5)
    })
})
