import { describe, expect, it } from 'vitest'

import type { TweenTransformAction } from '@/types/screenplay'

import { TweenTransformHandler } from '../handlers/TweenTransformHandler'
import type { ActionHandlerContext, WriteableState } from '../types'

describe('TweenTransformHandler', () => {
    it('interpolates child rotation tween using local values when parent and child rotate simultaneously, unaffected by parent current rotation', () => {
        const parentCurrent: WriteableState = {
            id: 'parent',
            x: 0,
            y: 0,
            rotation: Math.PI / 4,
            scaleX: 1,
            scaleY: 1,
        }

        const childState: WriteableState = {
            id: 'child',
            parentId: 'parent',
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
        }

        const action: TweenTransformAction = {
            id: 'tween_child_rotation',
            type: 'tween_transform',
            category: 'duration',
            target: 'child',
            slotIndex: 0,
            slotSpan: 1,
            params: {
                rotation: Math.PI / 2,
            },
        }

        const currentFrameState: WriteableState = { ...childState }
        const startState: WriteableState = { ...childState }

        const ctx: ActionHandlerContext = {
            getObjectState: (id) => {
                if (id === 'parent') return parentCurrent
                if (id === 'child') return currentFrameState
                return undefined
            },
        }

        TweenTransformHandler.interpolate?.(
            currentFrameState,
            action,
            0.5,
            startState,
            ctx,
        )

        expect(currentFrameState.rotation).toBeCloseTo(Math.PI / 4, 6)
    })
})
