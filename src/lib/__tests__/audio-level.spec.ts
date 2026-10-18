import { describe, expect, it } from 'vitest'

import {
  dbFromSamples,
  decibelReadout,
  levelFromSamples,
  smoothDb,
  smoothLevel,
} from '../audio-level'

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

describe('dbFromSamples', () => {
  it('is -Infinity for digital silence', () => {
    expect(dbFromSamples(new Float32Array(512))).toBe(-Infinity)
    expect(dbFromSamples(new Float32Array(0))).toBe(-Infinity)
  })

  it('reports levels below the meter floor', () => {
    const amplitude = 10 ** (-80 / 20)
    expect(dbFromSamples(new Float32Array(512).fill(amplitude))).toBeCloseTo(-80)
  })
})

describe('smoothDb', () => {
  it('rises immediately and falls a fixed step at a time', () => {
    expect(smoothDb(-50, -20)).toBe(-20)
    expect(smoothDb(-20, -60)).toBe(-21.5)
    expect(smoothDb(-20, -Infinity)).toBe(-21.5)
    expect(smoothDb(-Infinity, -40)).toBe(-40)
    expect(smoothDb(-119, -Infinity)).toBe(-Infinity)
  })
})

describe('decibelReadout', () => {
  it('rounds live levels and spells out silence', () => {
    expect(decibelReadout('live', -42.6)).toBe('-43 dB')
    expect(decibelReadout('live', -Infinity)).toBe('-∞ dB')
  })

  it('says why there is no number', () => {
    expect(decibelReadout('locked', undefined)).toBe('Tap for dB')
    expect(decibelReadout('no-audio', undefined)).toBe('No audio')
    expect(decibelReadout('idle', undefined)).toBe('– dB')
  })
})
