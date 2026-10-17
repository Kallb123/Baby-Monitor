import { describe, expect, it } from 'vitest'

import { soundStatus } from '../sound-status'

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
