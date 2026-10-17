import { describe, expect, it } from 'vitest'

import { levelFromSamples, smoothLevel } from '../audio-level'

describe('levelFromSamples', () => {
  it('is 0 for silence', () => {
    expect(levelFromSamples(new Float32Array(512))).toBe(0)
  })

  it('is 1 for a full-scale signal', () => {
    expect(levelFromSamples(new Float32Array(512).fill(1))).toBe(1)
  })

  it('maps -30 dBFS to the middle of the meter', () => {
    const amplitude = 10 ** (-30 / 20)
    expect(levelFromSamples(new Float32Array(512).fill(amplitude))).toBeCloseTo(0.5)
  })
})

describe('smoothLevel', () => {
  it('rises immediately and decays gradually', () => {
    expect(smoothLevel(0.2, 0.8)).toBe(0.8)
    expect(smoothLevel(0.8, 0)).toBeCloseTo(0.72)
  })
})
