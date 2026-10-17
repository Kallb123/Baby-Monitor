import { describe, expect, it } from 'vitest'

import { appConfigSchema, defaultConfig, referencedEntityIds } from '../config.ts'

describe('appConfigSchema', () => {
  it('fills defaults for an empty object', () => {
    expect(defaultConfig()).toEqual({ version: 1, cameras: [], layout: { mode: 'grid' } })
  })

  it('rejects non-RTSP stream URLs', () => {
    const result = appConfigSchema.safeParse({
      cameras: [{ id: 'cot', name: 'Cot', rtspUrl: 'http://cam/stream' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects malformed entity ids', () => {
    const result = appConfigSchema.safeParse({
      cameras: [
        { id: 'cot', name: 'Cot', rtspUrl: 'rtsp://cam/s', entities: { cry: 'not an entity' } },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects duplicate camera ids', () => {
    const cam = { id: 'cot', name: 'Cot', rtspUrl: 'rtsp://cam/s' }
    const result = appConfigSchema.safeParse({ cameras: [cam, cam] })
    expect(result.success).toBe(false)
  })
})

describe('referencedEntityIds', () => {
  it('collects unique entity ids across cameras', () => {
    const config = appConfigSchema.parse({
      cameras: [
        {
          id: 'a',
          name: 'A',
          rtspUrl: 'rtsp://a/s',
          entities: { cry: 'binary_sensor.a_cry', temperature: 'sensor.temp' },
        },
        { id: 'b', name: 'B', rtspUrl: 'rtsp://b/s', entities: { temperature: 'sensor.temp' } },
      ],
    })
    expect(referencedEntityIds(config).sort()).toEqual(['binary_sensor.a_cry', 'sensor.temp'])
  })
})
