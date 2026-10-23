import { describe, expect, it } from 'vitest'

import {
  nextSubHealth,
  pickQuality,
  SUB_FAILURES_BEFORE_MAIN,
  type PickQualityInput,
} from '../stream-quality'

const pick = (overrides: Partial<PickQualityInput>) =>
  pickQuality({
    preference: 'auto',
    hasSub: true,
    physicalWidth: 1000,
    current: 'main',
    ...overrides,
  })

describe('pickQuality', () => {
  it('always plays main without a sub-stream', () => {
    expect(pick({ hasSub: false, physicalWidth: 100, current: 'sub' })).toBe('main')
    expect(pick({ hasSub: false, preference: 'sub', physicalWidth: 100 })).toBe('main')
  })

  it('follows an explicit preference regardless of size', () => {
    expect(pick({ preference: 'main', physicalWidth: 100, current: 'sub' })).toBe('main')
    expect(pick({ preference: 'sub', physicalWidth: 3000, current: 'main' })).toBe('sub')
  })

  it('uses the sub-stream below 960 physical pixels and main above 1280', () => {
    expect(pick({ physicalWidth: 959, current: 'main' })).toBe('sub')
    expect(pick({ physicalWidth: 1281, current: 'sub' })).toBe('main')
  })

  it('keeps the current stream between the thresholds, boundaries included', () => {
    for (const physicalWidth of [960, 1100, 1280]) {
      expect(pick({ physicalWidth, current: 'sub' })).toBe('sub')
      expect(pick({ physicalWidth, current: 'main' })).toBe('main')
    }
  })
})

describe('nextSubHealth', () => {
  it('falls back only after consecutive failures reach the limit', () => {
    let failures = 0
    for (let i = 1; i < SUB_FAILURES_BEFORE_MAIN; i++) {
      const health = nextSubHealth(failures, 'failed')
      expect(health.fallBack).toBe(false)
      failures = health.failures
    }
    expect(nextSubHealth(failures, 'failed')).toEqual({
      failures: SUB_FAILURES_BEFORE_MAIN,
      fallBack: true,
    })
  })

  it('restarts the streak when the sub-stream connects', () => {
    expect(nextSubHealth(2, 'connected')).toEqual({ failures: 0, fallBack: false })
  })

  it('falls back at once when the sub-stream carries no audio', () => {
    expect(nextSubHealth(0, 'no-audio')).toEqual({ failures: 0, fallBack: true })
  })
})
