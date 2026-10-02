/**
 * SetScreenEffectHandler unit test (Phase 1)
 * Note: Handler directly operates on state.params (eliminating flat state intermediate layer)
 * coverOpacity deleted, overlay opacity is uniformly controlled by SceneObject.alpha
 */

import { describe, expect, it } from 'vitest'

import type { ScreenEffectParams } from '@/types/sceneObject'
import type { SetScreenEffectAction } from '@/types/screenplay'

import { SetScreenEffectHandler } from '../handlers/SetScreenEffectHandler'
import type { WriteableState } from '../types'

describe('SetScreenEffectHandler', () => {
    function createInitialState(): WriteableState {
        return {
            params: {
                baseColor: '#000000',
                openRatio: 1.0,
                feather: 0,
                holeCenterX: 960,
                holeCenterY: 540,
                holeWidth: 400,
                holeHeight: 300
            } as ScreenEffectParams
        }
    }

    function createAction(params: SetScreenEffectAction['params']): SetScreenEffectAction {
        return {
            id: 'action_1',
            type: 'set_screen_effect',
            category: 'point',
            target: 'obj_1',
            slotIndex: 0,
            params
        }
    }

    describe('Coverage parameters', () => {
        it('applies baseColor', () => {
            const state = createInitialState()
            SetScreenEffectHandler.applyToState(state, createAction({ baseColor: '#ff0000' }))
            expect(state.params!.baseColor).toBe('#ff0000')
        })
    })

    describe('Hole parameters', () => {
        it('applies openRatio', () => {
            const state = createInitialState()
            SetScreenEffectHandler.applyToState(state, createAction({ openRatio: 0.3 }))
            expect(state.params!.openRatio).toBe(0.3)
        })

        it('applies holeShape', () => {
            const state = createInitialState()
            SetScreenEffectHandler.applyToState(state, createAction({ holeShape: 'vertical_ellipse' }))
            expect(state.params!.holeShape).toBe('vertical_ellipse')
        })

        it('applies feather', () => {
            const state = createInitialState()
            SetScreenEffectHandler.applyToState(state, createAction({ feather: 80 }))
            expect(state.params!.feather).toBe(80)
        })
    })

    describe('Target following parameters', () => {
        it('applies targetId and offset', () => {
            const state = createInitialState()
            SetScreenEffectHandler.applyToState(state, createAction({
                targetId: 'char_1',
                offsetX: 50,
                offsetY: -100
            }))
            expect(state.params!.targetId).toBe('char_1')
            expect(state.params!.offsetX).toBe(50)
            expect(state.params!.offsetY).toBe(-100)
        })
    })

    describe('Applying multiple parameters simultaneously', () => {
        it('mixes coverage and hole parameters', () => {
            const state = createInitialState()
            SetScreenEffectHandler.applyToState(state, createAction({
                baseColor: '#ff0000',
                holeShape: 'horizontal_ellipse',
                openRatio: 0.5,
                feather: 40
            }))
            expect(state.params!.baseColor).toBe('#ff0000')
            expect(state.params!.holeShape).toBe('horizontal_ellipse')
            expect(state.params!.openRatio).toBe(0.5)
            expect(state.params!.feather).toBe(40)
        })
    })

    describe('Edge cases', () => {
        it('does not modify state when params is empty', () => {
            const state = createInitialState()
            SetScreenEffectHandler.applyToState(state, createAction({}))
            expect(state.params!.baseColor).toBe('#000000')
            expect(state.params!.openRatio).toBe(1.0)
        })

        it('handles 0 value openRatio', () => {
            const state = createInitialState()
            SetScreenEffectHandler.applyToState(state, createAction({ openRatio: 0 }))
            expect(state.params!.openRatio).toBe(0)
        })

        it('automatically initializes params when missing on state', () => {
            const state: WriteableState = {}
            SetScreenEffectHandler.applyToState(state, createAction({ openRatio: 0.5 }))
            expect(state.params!.openRatio).toBe(0.5)
        })
    })

    describe('Handler metadata', () => {
        it('type is set_screen_effect', () => {
            expect(SetScreenEffectHandler.type).toBe('set_screen_effect')
        })

        it('is Point Action', () => {
            expect(SetScreenEffectHandler.isPointAction).toBe(true)
        })

        it('is not Duration Action', () => {
            expect(SetScreenEffectHandler.isDurationAction).toBe(false)
        })
    })
})
