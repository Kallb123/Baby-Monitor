import { describe, expect, it } from 'vitest'

import type { EntityState } from '@shared/api.ts'
import { formatMeasurement, isCrying } from '../entities'

const state = (value: string, unit?: string): EntityState => ({
  entityId: 'sensor.x',
  state: value,
  unit,
  lastChanged: '2026-10-17T10:00:00Z',
})

describe('entity helpers', () => {
  it('treats "on" as crying', () => {
    expect(isCrying(state('on'))).toBe(true)
    expect(isCrying(state('off'))).toBe(false)
    expect(isCrying(state('unavailable'))).toBe(false)
    expect(isCrying(undefined)).toBe(false)
  })

  it('formats numeric measurements with units', () => {
    expect(formatMeasurement(state('21.44', '°C'))).toBe('21.4°C')
    expect(formatMeasurement(state('55', '%'), 0)).toBe('55%')
    expect(formatMeasurement(state('unknown', '°C'))).toBeUndefined()
  })
})
