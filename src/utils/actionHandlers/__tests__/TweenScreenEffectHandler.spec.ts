/**
 * TweenScreenEffectHandler unit test (Phase 1)
 * Note: Handler directly operates on state.params (eliminating flat state intermediate layer)
 * coverOpacity deleted, overlay opacity is uniformly controlled by SceneObject.alpha
 */

import { describe, expect, it } from 'vitest'

import type { ScreenEffectParams } from '@/types/sceneObject'
import type { TweenScreenEffectAction } from '@/types/screenplay'

import { TweenScreenEffectHandler } from '../handlers/TweenScreenEffectHandler'
import type { WriteableState } from '../types'

describe('TweenScreenEffectHandler', () => {
    function createInitialState(): WriteableState {
        return {
            params: {
                baseColor: '#000000',
                openRatio: 1.0,
                feather: 0,
                holeCenterX: 960,
                holeCenterY: 540,
                holeWidth: 400,
                holeHeight: 300,
                offsetX: 0,
                offsetY: 0
            } as ScreenEffectParams
        }
    }

    function createAction(params: TweenScreenEffectAction['params']): TweenScreenEffectAction {
        return {
            id: 'action_1',
            type: 'tween_screen_effect',
            category: 'duration',
            target: 'obj_1',
            slotIndex: 0,
            slotSpan: 2,
            params
        }
    }

    describe('applyToState (instantaneously applies target values)', () => {
        it('sets openRatio target value', () => {
            const state = createInitialState()
            TweenScreenEffectHandler.applyToState(state, createAction({ openRatio: 0.2 }))
            expect(state.params!.openRatio).toBe(0.2)
        })

        it('sets multiple target values', () => {
            const state = createInitialState()
            TweenScreenEffectHandler.applyToState(state, createAction({
                openRatio: 0.5,
                feather: 60
            }))
            expect(state.params!.openRatio).toBe(0.5)
            expect(state.params!.feather).toBe(60)
        })
    })

    describe('interpolate (linear interpolation)', () => {
        it('returns initial state at progress=0', () => {
            const state = createInitialState()
            const startState = createInitialState()
            const action = createAction({ openRatio: 0 })

            TweenScreenEffectHandler.interpolate!(state, action, 0, startState)
            expect(state.params!.openRatio).toBe(1.0) // Start value
        })

        it('returns target state at progress=1', () => {
            const state = createInitialState()
            const startState = createInitialState()
            const action = createAction({ openRatio: 0 })

            TweenScreenEffectHandler.interpolate!(state, action, 1, startState)
            expect(state.params!.openRatio).toBe(0) // Target value
        })

        it('returns intermediate value at progress=0.5', () => {
            const state = createInitialState()
            const startState = createInitialState()
            const action = createAction({ openRatio: 0 })

            TweenScreenEffectHandler.interpolate!(state, action, 0.5, startState)
            expect(state.params!.openRatio).toBeCloseTo(0.5) // (1.0 + 0) / 2
        })

        it('interpolates feather', () => {
            const state = createInitialState()
            const startState = createInitialState()
            const action = createAction({ feather: 100 })

            TweenScreenEffectHandler.interpolate!(state, action, 0.5, startState)
            expect(state.params!.feather).toBeCloseTo(50) // (0 + 100) / 2
        })

        it('interpolates multiple parameters simultaneously', () => {
            const state = createInitialState()
            const startState = createInitialState()
            const action = createAction({
                openRatio: 0,
                feather: 100
            })

            TweenScreenEffectHandler.interpolate!(state, action, 0.5, startState)
            expect(state.params!.openRatio).toBeCloseTo(0.5)
            expect(state.params!.feather).toBeCloseTo(50)
        })

        it('only interpolates specified fields for partial parameters', () => {
            const state = createInitialState()
            const startState = createInitialState()
            const action = createAction({ openRatio: 0 })

            TweenScreenEffectHandler.interpolate!(state, action, 0.5, startState)
            expect(state.params!.openRatio).toBeCloseTo(0.5)
            // Unspecified fields remain unchanged
            expect(state.params!.feather).toBe(0)
        })

        it('does not switch non-numeric parameters when progress < 1', () => {
            const state = createInitialState()
            const startState = createInitialState()
            const action = createAction({ baseColor: '#ff0000' })

            TweenScreenEffectHandler.interpolate!(state, action, 0.5, startState)
            expect(state.params!.baseColor).toBe('#000000') // Not switched
        })

        it('switches non-numeric parameters when progress >= 1', () => {
            const state = createInitialState()
            const startState = createInitialState()
            const action = createAction({ baseColor: '#ff0000' })

            TweenScreenEffectHandler.interpolate!(state, action, 1, startState)
            expect(state.params!.baseColor).toBe('#ff0000') // Switched
        })
    })

    describe('getTargetState', () => {
        it('matches applyToState behavior', () => {
            const state = createInitialState()
            TweenScreenEffectHandler.getTargetState!(state, createAction({ openRatio: 0.3 }))
            expect(state.params!.openRatio).toBe(0.3)
        })
    })

    describe('Handler metadata', () => {
        it('type is tween_screen_effect', () => {
            expect(TweenScreenEffectHandler.type).toBe('tween_screen_effect')
        })

        it('is not Point Action', () => {
            expect(TweenScreenEffectHandler.isPointAction).toBe(false)
        })

        it('is Duration Action', () => {
            expect(TweenScreenEffectHandler.isDurationAction).toBe(true)
        })
    })
})
