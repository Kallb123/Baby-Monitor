import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CryHistoryResponse } from '../../shared/api.ts'
import { buildApp } from '../app.ts'
import { ConfigStore } from '../config-store.ts'
import { Go2rtcClient } from '../go2rtc.ts'
import { HomeAssistantClient } from '../home-assistant.ts'

const rtspUrl = 'rtsp://192.168.1.20:554/stream1'
const nursery = { id: 'nursery', name: 'Nursery', rtspUrl, entities: { cry: 'binary_sensor.cry' } }
// Shares its crying entity with the nursery.
const cot = { id: 'cot', name: 'Cot', rtspUrl, entities: { cry: 'binary_sensor.cry' } }
const hall = { id: 'hall', name: 'Hall', rtspUrl, entities: { cry: 'binary_sensor.hall_cry' } }
// Temperature only: not a crying entity, so it must never be requested.
const attic = { id: 'attic', name: 'Attic', rtspUrl, entities: { temperature: 'sensor.attic' } }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('GET /api/ha/history', () => {
  let dir: string
  let app: FastifyInstance | undefined
  let haFetch: ReturnType<typeof vi.fn<typeof fetch>>

  async function start(options: { withHa: boolean; cameras?: unknown[] }) {
    const store = new ConfigStore(dir)
    await store.save({ cameras: options.cameras ?? [nursery, cot, hall, attic] })
    app = await buildApp({
      store,
      go2rtc: new Go2rtcClient({
        baseUrl: 'http://go2rtc:1984',
        fetch: vi.fn<typeof fetch>(async () => new Response('', { status: 200 })),
      }),
      homeAssistant: options.withHa
        ? new HomeAssistantClient({
            baseUrl: 'http://ha:8123',
            token: 'secret-token',
            fetch: haFetch,
            createWebSocket: () => {
              throw new Error('no sockets in tests')
            },
          })
        : undefined,
    })
    return app
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'baby-monitor-'))
    haFetch = vi.fn<typeof fetch>(async () =>
      json([
        [
          { entity_id: 'binary_sensor.cry', state: 'off', last_changed: '2026-10-23T00:00:00Z' },
          { state: 'on', last_changed: '2026-10-23T02:14:00Z' },
          { state: 'off', last_changed: '2026-10-23T02:21:00Z' },
          { state: 'on', last_changed: '2026-10-23T09:50:00Z' },
        ],
      ]),
    )
    // Only Date is faked: Fastify's inject still needs real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T10:00:00Z'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    await app?.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('reports an unconfigured Home Assistant without calling it', async () => {
    const response = await (await start({ withHa: false })).inject({ url: '/api/ha/history' })
    expect(response.statusCode).toBe(200)
    expect(response.json<CryHistoryResponse>()).toEqual({
      configured: false,
      from: '2026-10-22T22:00:00.000Z',
      to: '2026-10-23T10:00:00.000Z',
      cameras: {},
    })
    expect(haFetch).not.toHaveBeenCalled()
  })

  it('returns intervals per camera, sharing an entity and requesting only crying entities', async () => {
    const response = await (
      await start({ withHa: true })
    ).inject({
      url: '/api/ha/history?hours=6',
    })
    expect(response.statusCode).toBe(200)

    const nurseryCry = [
      { start: '2026-10-23T02:14:00.000Z', end: '2026-10-23T02:21:00.000Z' },
      { start: '2026-10-23T09:50:00.000Z' },
    ]
    expect(response.json<CryHistoryResponse>()).toEqual({
      configured: true,
      from: '2026-10-23T04:00:00.000Z',
      to: '2026-10-23T10:00:00.000Z',
      cameras: {
        nursery: { cry: nurseryCry },
        cot: { cry: nurseryCry },
        // HA had nothing for this one: it has a sensor, it was just quiet.
        hall: { cry: [] },
      },
    })

    expect(haFetch).toHaveBeenCalledTimes(1)
    const url = new URL(String(haFetch.mock.calls[0]![0]))
    expect(url.searchParams.get('filter_entity_id')).toBe(
      'binary_sensor.cry,binary_sensor.hall_cry',
    )
    expect(url.searchParams.get('end_time')).toBe('2026-10-23T10:00:00.000Z')
    expect(decodeURIComponent(url.pathname)).toBe('/api/history/period/2026-10-23T04:00:00.000Z')
  })

  it('defaults to twelve hours', async () => {
    const response = await (await start({ withHa: true })).inject({ url: '/api/ha/history' })
    expect(response.json<CryHistoryResponse>().from).toBe('2026-10-22T22:00:00.000Z')
  })

  it('does not call HA when no camera has a crying entity', async () => {
    const response = await (
      await start({ withHa: true, cameras: [attic] })
    ).inject({
      url: '/api/ha/history',
    })
    expect(response.json<CryHistoryResponse>()).toMatchObject({ configured: true, cameras: {} })
    expect(haFetch).not.toHaveBeenCalled()
  })

  it.each(['0', '25', '1.5', 'abc', '', '-3'])('rejects hours=%s with 400', async (hours) => {
    const response = await (
      await start({ withHa: true })
    ).inject({
      url: `/api/ha/history?hours=${hours}`,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: expect.stringContaining('hours') })
    expect(haFetch).not.toHaveBeenCalled()
  })

  it('answers 502 without leaking the URL or token when HA is unreachable', async () => {
    haFetch.mockImplementation(async () => {
      throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') })
    })
    const response = await (await start({ withHa: true })).inject({ url: '/api/ha/history' })
    expect(response.statusCode).toBe(502)
    expect(response.body).not.toContain('ha:8123')
    expect(response.body).not.toContain('secret-token')
    expect(response.json()).toEqual({ error: 'Home Assistant history unavailable' })
  })

  it('answers 502 when HA rejects the request', async () => {
    haFetch.mockImplementation(async () => new Response('nope', { status: 401 }))
    const response = await (await start({ withHa: true })).inject({ url: '/api/ha/history' })
    expect(response.statusCode).toBe(502)
  })
})
