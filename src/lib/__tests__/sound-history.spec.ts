import { describe, expect, it } from 'vitest'

import {
  addSample,
  BUCKET_MS,
  bucketsInRange,
  bucketStart,
  HISTORY_RETENTION_MS,
  normalizeHistory,
  pruneCameras,
  pruneHistory,
  soundHistorySchema,
  type SoundHistory,
} from '../sound-history'

const T0 = Date.UTC(2026, 9, 23, 2, 0, 0)

describe('addSample', () => {
  it('groups samples of the same minute into one bucket with the peak', () => {
    const history: SoundHistory = {}
    expect(addSample(history, 'nursery', T0 + 1_000, -40, false)).toBe(true)
    expect(addSample(history, 'nursery', T0 + 2_000, -22.26, false)).toBe(false)
    expect(addSample(history, 'nursery', T0 + 59_000, -50, false)).toBe(false)
    expect(history).toEqual({ nursery: [[T0, -22.3, 0]] })
  })

  it('starts a new bucket each minute', () => {
    const history: SoundHistory = {}
    addSample(history, 'nursery', T0, -30, false)
    addSample(history, 'nursery', T0 + BUCKET_MS, -45, false)
    expect(history.nursery).toEqual([
      [T0, -30, 0],
      [T0 + BUCKET_MS, -45, 0],
    ])
  })

  it('flags a minute as stirred when any sample in it stirred', () => {
    const history: SoundHistory = {}
    addSample(history, 'nursery', T0, -50, false)
    addSample(history, 'nursery', T0 + 10_000, -45, true)
    addSample(history, 'nursery', T0 + 20_000, -50, false)
    expect(history.nursery).toEqual([[T0, -45, 1]])
  })

  it('keeps cameras apart', () => {
    const history: SoundHistory = {}
    addSample(history, 'a', T0, -30, true)
    addSample(history, 'b', T0, -50, false)
    expect(history).toEqual({ a: [[T0, -30, 1]], b: [[T0, -50, 0]] })
  })

  it('stores silence at the meter floor so it survives JSON', () => {
    const history: SoundHistory = {}
    addSample(history, 'nursery', T0, -Infinity, false)
    expect(history.nursery).toEqual([[T0, -60, 0]])
    expect(JSON.parse(JSON.stringify(history))).toEqual(history)
  })

  it('ignores NaN levels and a clock that stepped back', () => {
    const history: SoundHistory = {}
    expect(addSample(history, 'nursery', T0, NaN, false)).toBe(false)
    expect(history).toEqual({})

    addSample(history, 'nursery', T0 + BUCKET_MS, -30, false)
    addSample(history, 'nursery', T0, -10, true)
    expect(history.nursery).toEqual([[T0 + BUCKET_MS, -30, 0]])
  })

  it('drops buckets older than 24 hours as new ones arrive', () => {
    const history: SoundHistory = { nursery: [[T0, -30, 0]] }
    addSample(history, 'nursery', T0 + HISTORY_RETENTION_MS + BUCKET_MS, -40, false)
    expect(history.nursery).toEqual([[T0 + HISTORY_RETENTION_MS + BUCKET_MS, -40, 0]])
  })
})

describe('pruning', () => {
  it('drops old buckets and cameras left empty, keeping the edge minute', () => {
    const now = T0 + HISTORY_RETENTION_MS
    const history: SoundHistory = {
      old: [[T0 - BUCKET_MS, -30, 0]],
      mixed: [
        [T0, -30, 0],
        [now, -20, 1],
      ],
    }
    expect(pruneHistory(history, now)).toEqual({
      mixed: [
        [T0, -30, 0],
        [now, -20, 1],
      ],
    })
    expect(pruneHistory(history, now + BUCKET_MS)).toEqual({ mixed: [[now, -20, 1]] })
  })

  it('forgets deleted cameras and keeps the same object when nothing goes', () => {
    const history: SoundHistory = { a: [[T0, -30, 0]], b: [[T0, -30, 0]] }
    expect(pruneCameras(history, ['a', 'c'])).toEqual({ a: [[T0, -30, 0]] })
    expect(pruneCameras(history, ['a', 'b'])).toBe(history)
  })
})

describe('bucketsInRange', () => {
  it('returns the buckets overlapping the range', () => {
    const history: SoundHistory = {
      a: [
        [T0, -30, 0],
        [T0 + BUCKET_MS, -30, 0],
        [T0 + 5 * BUCKET_MS, -30, 0],
      ],
    }
    expect(bucketsInRange(history, 'a', T0 + 30_000, T0 + BUCKET_MS)).toEqual([
      [T0, -30, 0],
      [T0 + BUCKET_MS, -30, 0],
    ])
    expect(bucketsInRange(history, 'missing', 0, Infinity)).toEqual([])
  })
})

describe('storage helpers', () => {
  it('accepts the compact shape and rejects malformed buckets', () => {
    expect(soundHistorySchema.safeParse({ a: [[T0, -30.5, 1]] }).success).toBe(true)
    expect(soundHistorySchema.safeParse({ a: [[T0, -30.5, 2]] }).success).toBe(false)
    expect(soundHistorySchema.safeParse({ a: [[T0, null, 0]] }).success).toBe(false)
    expect(soundHistorySchema.safeParse({ a: [[T0, -30]] }).success).toBe(false)
    expect(soundHistorySchema.safeParse({ a: 'x' }).success).toBe(false)
  })

  it('orders, merges duplicate minutes and prunes what was stored', () => {
    const now = T0 + 10 * BUCKET_MS
    const stored: SoundHistory = {
      a: [
        [T0 + 2 * BUCKET_MS, -30, 0],
        [T0 + 3 * BUCKET_MS + 1_000, -20, 1],
        [T0 + 2 * BUCKET_MS + 5, -40, 1],
      ],
      stale: [[T0 - 2 * HISTORY_RETENTION_MS, -30, 0]],
    }
    expect(normalizeHistory(stored, now)).toEqual({
      a: [
        [T0 + 2 * BUCKET_MS, -30, 1],
        [bucketStart(T0 + 3 * BUCKET_MS), -20, 1],
      ],
    })
  })
})
