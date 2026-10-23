import { describe, expect, it } from 'vitest'

import { FEED_LOST_AFTER_MS, findLostFeeds, formatDownDuration } from '../feed-alerts'

describe('findLostFeeds', () => {
  const now = 1_000_000

  it('is empty when nothing is down', () => {
    expect(findLostFeeds({}, now)).toEqual([])
  })

  it('waits the full grace period before a feed counts as lost', () => {
    const downSince = { cot: now - (FEED_LOST_AFTER_MS - 1) }
    expect(findLostFeeds(downSince, now)).toEqual([])
    expect(findLostFeeds(downSince, now + 1)).toEqual([
      { cameraId: 'cot', downForMs: FEED_LOST_AFTER_MS },
    ])
  })

  it('reports how long each feed has been down, longest first', () => {
    const downSince = {
      cot: now - 45_000,
      nursery: now - 120_000,
      porch: now - 5_000,
    }
    expect(findLostFeeds(downSince, now)).toEqual([
      { cameraId: 'nursery', downForMs: 120_000 },
      { cameraId: 'cot', downForMs: 45_000 },
    ])
  })

  it('treats a clock that moved backwards as just down', () => {
    expect(findLostFeeds({ cot: now + 10_000 }, now)).toEqual([])
  })
})

describe('formatDownDuration', () => {
  it.each([
    [0, '0 s'],
    [30_000, '30 s'],
    [59_999, '59 s'],
    [60_000, '1 min'],
    [119_000, '1 min'],
    [5 * 60_000, '5 min'],
    [60 * 60_000, '1 h'],
    [65 * 60_000, '1 h 5 min'],
  ])('formats %i ms as %s', (ms, text) => {
    expect(formatDownDuration(ms)).toBe(text)
  })
})
