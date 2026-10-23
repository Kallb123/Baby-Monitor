import { describe, expect, it } from 'vitest'

import { soundStatus, stirringThresholdDb, type Sensitivity } from '../sound-status'

describe('soundStatus', () => {
  it('reports crying from Home Assistant even without a live feed', () => {
    expect(soundStatus({ crying: true, stirring: false, live: false })).toBe('crying')
  })

  it('never calls a dead feed quiet', () => {
    expect(soundStatus({ crying: false, stirring: false, live: false })).toBe('no-feed')
  })

  it('distinguishes stirring from quiet on a live feed', () => {
    expect(soundStatus({ crying: false, stirring: true, live: true })).toBe('stirring')
    expect(soundStatus({ crying: false, stirring: false, live: true })).toBe('quiet')
  })
})

describe('stirringThresholdDb', () => {
  it('uses the minimum alone until a background is known', () => {
    expect(stirringThresholdDb(undefined, 'low')).toBe(-38)
    expect(stirringThresholdDb(undefined, 'medium')).toBe(-43)
    expect(stirringThresholdDb(undefined, 'high')).toBe(-48)
  })

  it('stays at the minimum in a quiet room', () => {
    expect(stirringThresholdDb(-70, 'medium')).toBe(-43)
    expect(stirringThresholdDb(-53, 'medium')).toBe(-43)
  })

  it('sits a margin above a noisy background', () => {
    expect(stirringThresholdDb(-30, 'low')).toBe(-15)
    expect(stirringThresholdDb(-30, 'medium')).toBe(-20)
    expect(stirringThresholdDb(-30, 'high')).toBe(-24)
  })

  it('orders sensitivities from least to most easily triggered', () => {
    const order: Sensitivity[] = ['low', 'medium', 'high']
    for (const floor of [undefined, -60, -45, -30]) {
      const [low, medium, high] = order.map((s) => stirringThresholdDb(floor, s))
      expect(low).toBeGreaterThan(medium!)
      expect(medium).toBeGreaterThan(high!)
    }
  })
})
