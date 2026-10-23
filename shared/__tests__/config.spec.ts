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

  it('only allows sensor and binary_sensor entities', () => {
    const withCry = (cry: string) =>
      appConfigSchema.safeParse({
        cameras: [{ id: 'cot', name: 'Cot', rtspUrl: 'rtsp://cam/s', entities: { cry } }],
      }).success
    expect(withCry('binary_sensor.cot_crying')).toBe(true)
    expect(withCry('lock.front_door')).toBe(false)
    expect(withCry('device_tracker.phone')).toBe(false)
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

  describe('subRtspUrl', () => {
    const parse = (subRtspUrl?: unknown) =>
      appConfigSchema.safeParse({
        cameras: [{ id: 'cot', name: 'Cot', rtspUrl: 'rtsp://cam/s', subRtspUrl }],
      })

    it('is optional and keeps a valid rtsp or rtsps address', () => {
      expect(parse(undefined).data?.cameras[0]?.subRtspUrl).toBeUndefined()
      expect(parse(' rtsp://cam/sub ').data?.cameras[0]?.subRtspUrl).toBe('rtsp://cam/sub')
      expect(parse('rtsps://cam/sub').success).toBe(true)
    })

    it('rejects other schemes with the same message as the main address', () => {
      const result = parse('http://cam/sub')
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.path).toEqual(['cameras', 0, 'subRtspUrl'])
      expect(result.error?.issues[0]?.message).toBe('Expected an rtsp:// or rtsps:// URL')
    })

    it('treats a blank value as absent', () => {
      for (const blank of ['', '   ']) {
        const result = parse(blank)
        expect(result.success).toBe(true)
        expect(result.data?.cameras[0]?.subRtspUrl).toBeUndefined()
      }
    })

    it('does not change the config version', () => {
      expect(defaultConfig().version).toBe(1)
    })
  })
})
