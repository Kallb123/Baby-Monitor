import { describe, expect, it } from 'vitest'

import { pickQuality, type PickQualityInput } from '../stream-quality'

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
