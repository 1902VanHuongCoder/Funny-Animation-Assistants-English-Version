import { describe, expect, it } from 'vitest'

import { accumulateRotationDelta, normalizeAngleDelta } from '../useInteraction'

describe('normalizeAngleDelta', () => {
  it('normalizes small angular rotations crossing +pi/-pi boundary to shortest arc', () => {
    const startAngle = 179 * Math.PI / 180
    const currentAngle = -171 * Math.PI / 180

    const normalized = normalizeAngleDelta(currentAngle - startAngle)

    expect(normalized).toBeCloseTo(10 * Math.PI / 180, 6)
  })

  it('preserves angular differences already within shortest arc range', () => {
    const normalized = normalizeAngleDelta(-20 * Math.PI / 180)

    expect(normalized).toBeCloseTo(-20 * Math.PI / 180, 6)
  })
})

describe('accumulateRotationDelta', () => {
  it('continuously accumulates positive rotation across +pi/-pi boundary', () => {
    const firstStep = accumulateRotationDelta(
      170 * Math.PI / 180,
      -170 * Math.PI / 180,
      0
    )
    const secondStep = accumulateRotationDelta(
      firstStep.currentAngle,
      -150 * Math.PI / 180,
      firstStep.accumulatedDelta
    )

    expect(firstStep.accumulatedDelta).toBeCloseTo(20 * Math.PI / 180, 6)
    expect(secondStep.accumulatedDelta).toBeCloseTo(40 * Math.PI / 180, 6)
  })

  it('supports single drag accumulation exceeding 180 degrees', () => {
    let state = {
      currentAngle: 0,
      accumulatedDelta: 0
    }

    state = accumulateRotationDelta(state.currentAngle, 100 * Math.PI / 180, state.accumulatedDelta)
    state = accumulateRotationDelta(state.currentAngle, 170 * Math.PI / 180, state.accumulatedDelta)
    state = accumulateRotationDelta(state.currentAngle, -120 * Math.PI / 180, state.accumulatedDelta)

    expect(state.accumulatedDelta).toBeCloseTo(240 * Math.PI / 180, 6)
  })
})
