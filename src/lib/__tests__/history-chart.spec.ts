import { describe, expect, it } from 'vitest'

import { BUCKET_MS, type SoundBucket } from '../sound-history'
import {
  areaPath,
  cryBands,
  cryEpisodes,
  dbToY,
  formatDuration,
  hourTicks,
  linePath,
  nearestBucket,
  soundSegments,
  stirredMinutes,
  tickStepHours,
} from '../history-chart'

// Local dates, so the tests hold in any time zone.
const at = (hour: number, minute = 0, day = 23) => new Date(2026, 9, day, hour, minute).getTime()
const iso = (ms: number) => new Date(ms).toISOString()
const clock = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

describe('dbToY', () => {
  it('puts 0 dBFS on top and the meter floor on the bottom, clamping outside', () => {
    expect(dbToY(0, 10, 100)).toBe(10)
    expect(dbToY(-60, 10, 100)).toBe(110)
    expect(dbToY(-30, 10, 100)).toBe(60)
    expect(dbToY(-90, 10, 100)).toBe(110)
    expect(dbToY(6, 10, 100)).toBe(10)
  })
})

describe('hourTicks', () => {
  it('lists the local hours that are multiples of the step inside the range', () => {
    const ticks = hourTicks(at(1, 30), at(13, 30), 4)
    expect(ticks.map(clock)).toEqual(['04:00', '08:00', '12:00'])
  })

  it('includes ticks exactly on the edges', () => {
    expect(hourTicks(at(2), at(5), 1).map(clock)).toEqual(['02:00', '03:00', '04:00', '05:00'])
  })

  it('picks about six labels for each range', () => {
    expect([6, 12, 24].map(tickStepHours)).toEqual([1, 2, 4])
  })
})

describe('soundSegments', () => {
  const x = (ms: number) => ms / BUCKET_MS
  const y = (db: number) => -db
  const bucket = (minute: number, db = -30): SoundBucket => [minute * BUCKET_MS, db, 0]

  it('breaks the line wherever a minute is missing', () => {
    const segments = soundSegments([bucket(0), bucket(1), bucket(2), bucket(5), bucket(6)], x, y)
    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveLength(3)
    expect(segments[1]).toHaveLength(2)
  })

  it('draws a lone minute as a short flat stroke', () => {
    const [segment] = soundSegments([bucket(3, -40)], x, y, 2)
    expect(segment).toHaveLength(2)
    expect(segment![1]!.x - segment![0]!.x).toBe(2)
    expect(segment![0]!.y).toBe(segment![1]!.y)
  })

  it('has nothing to draw without buckets', () => {
    expect(soundSegments([], x, y)).toEqual([])
  })

  it('builds open and closed paths', () => {
    const points = [
      { x: 0, y: 5 },
      { x: 10, y: 8.04 },
    ]
    expect(linePath(points)).toBe('M0 5 L10 8')
    expect(areaPath(points, 20)).toBe('M0 5 L10 8 L10 20 L0 20 Z')
    expect(areaPath([], 20)).toBe('')
  })
})

describe('cryBands', () => {
  it('clips to the range and runs open intervals to now', () => {
    const bands = cryBands(
      [
        { start: iso(at(0)), end: iso(at(3)) },
        { start: iso(at(8)), end: iso(at(9)) },
        { start: iso(at(11)) },
        { start: iso(at(1, 0, 20)), end: iso(at(2, 0, 20)) },
      ],
      at(2),
      at(12),
      at(11, 40),
    )
    expect(bands).toEqual([
      { startMs: at(2), endMs: at(3) },
      { startMs: at(8), endMs: at(9) },
      { startMs: at(11), endMs: at(11, 40) },
    ])
  })
})

describe('nearestBucket', () => {
  const buckets: SoundBucket[] = [
    [0, -30, 0],
    [10 * BUCKET_MS, -20, 1],
  ]

  it('finds the closest minute within the tolerance', () => {
    expect(nearestBucket(buckets, 9 * BUCKET_MS, BUCKET_MS)).toBe(buckets[1])
    expect(nearestBucket(buckets, 0.2 * BUCKET_MS, 0)).toBe(buckets[0])
  })

  it('finds nothing in a gap', () => {
    expect(nearestBucket(buckets, 5 * BUCKET_MS, BUCKET_MS)).toBeUndefined()
    expect(nearestBucket([], 0, BUCKET_MS)).toBeUndefined()
  })
})

describe('cryEpisodes', () => {
  const now = at(10)

  it('words episodes newest first with their length', () => {
    const episodes = cryEpisodes(
      [
        { start: iso(at(2, 14)), end: iso(at(2, 21)) },
        { start: iso(at(4, 0)), end: iso(at(5, 5)) },
        { start: iso(at(9, 50)) },
      ],
      now,
      clock,
    )
    expect(episodes.map((e) => e.label)).toEqual([
      'since 09:50 · still crying',
      '04:00–05:05 · 1 h 5 min',
      '02:14–02:21 · 7 min',
    ])
    expect(episodes[0]!.endMs).toBeUndefined()
  })

  it("marks yesterday's episodes", () => {
    const [episode] = cryEpisodes(
      [{ start: iso(at(23, 50, 22)), end: iso(at(0, 4, 23)) }],
      now,
      clock,
    )
    expect(episode!.label).toBe('Yesterday 23:50–00:04 · 14 min')
  })

  it('skips unparseable times', () => {
    expect(cryEpisodes([{ start: 'nope' }], now, clock)).toEqual([])
  })
})

describe('summaries', () => {
  it('formats durations', () => {
    expect(formatDuration(20_000)).toBe('under a minute')
    expect(formatDuration(7 * 60_000)).toBe('7 min')
    expect(formatDuration(120 * 60_000)).toBe('2 h')
  })

  it('counts stirred minutes', () => {
    expect(
      stirredMinutes([
        [0, -30, 1],
        [BUCKET_MS, -30, 0],
        [2 * BUCKET_MS, -30, 1],
      ]),
    ).toBe(2)
  })
})
