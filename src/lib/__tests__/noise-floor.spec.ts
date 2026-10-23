import { describe, expect, it } from 'vitest'

import {
  NOISE_CLAMP_DB,
  NOISE_MIN_SECONDS,
  NOISE_WINDOW_SECONDS,
  backgroundReadout,
  createNoiseFloor,
  percentile,
} from '../noise-floor'

/** Feeds `seconds` seconds of samples (4 per second) from `start`, returning the end time. */
function feed(
  tracker: ReturnType<typeof createNoiseFloor>,
  start: number,
  seconds: number,
  dbAt: (second: number) => number,
) {
  for (let s = 0; s < seconds; s++) {
    for (let k = 0; k < 4; k++) tracker.add(dbAt(s), start + s * 1000 + k * 250)
  }
  return start + seconds * 1000
}

describe('percentile', () => {
  it('interpolates between ranks', () => {
    expect(percentile([10, 0, 20, 30], 0)).toBe(0)
    expect(percentile([10, 0, 20, 30], 1)).toBe(30)
    expect(percentile([10, 0, 20, 30], 0.5)).toBe(15)
  })
})

describe('createNoiseFloor', () => {
  it('reports nothing until it has enough seconds of data', () => {
    const tracker = createNoiseFloor()
    let end = feed(tracker, 1_000_000, NOISE_MIN_SECONDS - 1, () => -50)
    expect(tracker.floor(end)).toBeUndefined()
    end = feed(tracker, end, 1, () => -50)
    expect(tracker.floor(end)).toBe(-50)
  })

  it('keeps the quietest sample of each second', () => {
    const tracker = createNoiseFloor()
    for (let s = 0; s < NOISE_MIN_SECONDS; s++) {
      tracker.add(-20, s * 1000)
      tracker.add(-55, s * 1000 + 300)
      tracker.add(-30, s * 1000 + 600)
    }
    expect(tracker.floor(NOISE_MIN_SECONDS * 1000)).toBe(-55)
  })

  it('takes the 10th percentile of the seconds in the window', () => {
    const tracker = createNoiseFloor()
    // 100 seconds counting up from -100, so the 10th percentile is at rank 9.9.
    const end = feed(tracker, 0, 100, (s) => -100 + s)
    expect(tracker.floor(end)).toBeCloseTo(-100 + 9.9, 5)
  })

  it('clamps digital silence to a finite floor', () => {
    const tracker = createNoiseFloor()
    const end = feed(tracker, 0, 30, () => -Infinity)
    expect(tracker.floor(end)).toBe(NOISE_CLAMP_DB)
  })

  it('ignores NaN samples', () => {
    const tracker = createNoiseFloor()
    tracker.add(NaN, 0)
    expect(tracker.floor(60_000)).toBeUndefined()
  })

  it('rises to a steady white-noise level once it fills the window', () => {
    const tracker = createNoiseFloor()
    let end = feed(tracker, 0, 100, () => -60)
    expect(tracker.floor(end)).toBe(-60)

    const stepAt = end
    end = feed(tracker, end, 90, () => -35)
    // Quiet seconds still make up more than a tenth of the window.
    expect(tracker.floor(end)).toBe(-60)

    end = feed(tracker, end, 30, () => -35)
    expect(end - stepAt).toBeLessThanOrEqual(NOISE_WINDOW_SECONDS * 1000)
    expect(tracker.floor(end)).toBe(-35)
  })

  it('is not lifted by loud bursts with pauses between them', () => {
    const tracker = createNoiseFloor()
    // A baby crying 7 seconds out of every 10, quiet in the gaps to breathe.
    const end = feed(tracker, 0, 300, (s) => (s % 10 < 7 ? -15 : -50))
    expect(tracker.floor(end)).toBe(-50)
  })

  it('forgets everything after a long gap', () => {
    const tracker = createNoiseFloor()
    const end = feed(tracker, 0, 60, () => -50)
    expect(tracker.floor(end)).toBe(-50)
    expect(tracker.floor(end + NOISE_WINDOW_SECONDS * 1000)).toBeUndefined()
  })

  it('refreshes a cached floor when new data arrives in the same second', () => {
    const tracker = createNoiseFloor()
    const end = feed(tracker, 0, 20, () => -40)
    expect(tracker.floor(end)).toBe(-40)
    for (let s = 20; s < 40; s++) tracker.add(-70, s * 1000)
    expect(tracker.floor(40_000)).toBe(-70)
  })
})

describe('backgroundReadout', () => {
  it('rounds the floor and says nothing before it is known', () => {
    expect(backgroundReadout(-37.6)).toBe('bg -38')
    expect(backgroundReadout(undefined)).toBeUndefined()
  })
})
