import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from '../app.ts'
import { ConfigStore } from '../config-store.ts'
import { Go2rtcClient } from '../go2rtc.ts'
import { HomeAssistantClient } from '../home-assistant.ts'

const camera = {
  id: 'nursery',
  name: 'Nursery',
  rtspUrl: 'rtsp://192.168.1.20:554/stream1',
  entities: { cry: 'binary_sensor.nursery_crying', temperature: 'sensor.nursery_temp' },
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('server app', () => {
  let dir: string
  let app: FastifyInstance
  let go2rtcFetch: ReturnType<typeof vi.fn<typeof fetch>>
  let haFetch: ReturnType<typeof vi.fn<typeof fetch>>

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'baby-monitor-'))
    go2rtcFetch = vi.fn<typeof fetch>(async () => new Response('v=0 answer', { status: 201 }))
    haFetch = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === 'http://ha:8123/api/') return jsonResponse({ message: 'API running.' })
      if (url.endsWith('/binary_sensor.nursery_crying')) {
        return jsonResponse({
          entity_id: 'binary_sensor.nursery_crying',
          state: 'on',
          last_changed: '2026-10-17T10:00:00Z',
        })
      }
      return new Response('not found', { status: 404 })
    })
    app = await buildApp({
      store: new ConfigStore(dir),
      go2rtc: new Go2rtcClient({ baseUrl: 'http://go2rtc:1984', fetch: go2rtcFetch }),
      homeAssistant: new HomeAssistantClient({
        baseUrl: 'http://ha:8123',
        token: 'secret-token',
        fetch: haFetch,
      }),
    })
  })

  afterEach(async () => {
    await app.close()
    await rm(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('round-trips the config and registers streams with go2rtc', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { cameras: [camera] },
    })
    expect(put.statusCode).toBe(200)

    const get = await app.inject({ method: 'GET', url: '/api/config' })
    expect(get.json().cameras).toEqual([camera])

    await vi.waitFor(() => expect(go2rtcFetch).toHaveBeenCalled())
    const [url, init] = go2rtcFetch.mock.calls[0]!
    expect(init?.method).toBe('PUT')
    expect(new URL(String(url)).searchParams.get('src')).toBe(camera.rtspUrl)
  })

  it('returns 400 with issues for an invalid config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { cameras: [{ ...camera, rtspUrl: 'http://not-rtsp' }] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().issues[0].path).toEqual(['cameras', 0, 'rtspUrl'])
  })

  it('only returns states for entities referenced by the config', async () => {
    await app.inject({ method: 'PUT', url: '/api/config', payload: { cameras: [camera] } })

    const res = await app.inject({ method: 'GET', url: '/api/ha/states' })
    expect(res.json()).toEqual({
      configured: true,
      states: {
        'binary_sensor.nursery_crying': {
          entityId: 'binary_sensor.nursery_crying',
          state: 'on',
          lastChanged: '2026-10-17T10:00:00Z',
        },
      },
    })
    const requested = haFetch.mock.calls.map(([input]) => String(input)).sort()
    expect(requested).toEqual([
      'http://ha:8123/api/states/binary_sensor.nursery_crying',
      'http://ha:8123/api/states/sensor.nursery_temp',
    ])
    expect(haFetch.mock.calls[0]![1]?.headers).toEqual({ Authorization: 'Bearer secret-token' })
  })

  it('streams snapshots over SSE, emits heartbeats and closes on HA failure', async () => {
    const stop = vi.fn<() => void>()
    const watch = vi.spyOn(HomeAssistantClient.prototype, 'watchStates').mockReturnValue(stop)
    await app.inject({ method: 'PUT', url: '/api/config', payload: { cameras: [camera] } })
    vi.useFakeTimers()
    const res = await app.inject({ url: '/api/ha/events', payloadAsStream: true })
    let data = ''
    res.stream().on('data', (chunk) => (data += String(chunk)))
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.headers['cache-control']).toBe('no-cache, no-transform')
    expect(res.headers['x-accel-buffering']).toBe('no')
    expect(watch.mock.lastCall![0].sort()).toEqual([
      'binary_sensor.nursery_crying',
      'sensor.nursery_temp',
    ])
    const states = {
      'binary_sensor.nursery_crying': {
        entityId: 'binary_sensor.nursery_crying',
        state: 'on',
        lastChanged: 'now',
      },
    }
    watch.mock.lastCall![1](states)
    await vi.waitFor(() => expect(data).toContain(JSON.stringify({ configured: true, states })))
    expect(data).not.toContain('secret-token')
    const second = await app.inject({ url: '/api/ha/events', payloadAsStream: true })
    let secondData = ''
    second.stream().on('data', (chunk) => (secondData += String(chunk)))
    await vi.advanceTimersByTimeAsync(15_000)
    expect(secondData).toContain('event: heartbeat\ndata: {}\n\n')
    watch.mock.lastCall![2]()
    await vi.advanceTimersByTimeAsync(0)
    expect(res.raw.res.writableEnded).toBe(true)
    expect(second.raw.res.writableEnded).toBe(true)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('ends SSE on config changes and releases HA resources on viewer departure and shutdown', async () => {
    const stop = vi.fn<() => void>()
    const watch = vi.spyOn(HomeAssistantClient.prototype, 'watchStates').mockReturnValue(stop)
    await app.inject({ method: 'PUT', url: '/api/config', payload: { cameras: [camera] } })
    const first = await app.inject({ url: '/api/ha/events', payloadAsStream: true })
    await app.inject({ method: 'PUT', url: '/api/config', payload: { cameras: [] } })
    expect(first.raw.res.writableEnded).toBe(true)
    expect(stop).toHaveBeenCalledOnce()

    await app.inject({ method: 'PUT', url: '/api/config', payload: { cameras: [camera] } })
    const second = await app.inject({ url: '/api/ha/events', payloadAsStream: true })
    second.raw.res.destroy()
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2))

    const third = await app.inject({ url: '/api/ha/events', payloadAsStream: true })
    await app.close()
    expect(third.raw.res.writableEnded).toBe(true)
    expect(stop).toHaveBeenCalledTimes(3)
    expect(watch).toHaveBeenCalledTimes(3)
  })

  it('streams an empty unconfigured snapshot without leaking secrets or polling HA', async () => {
    const bare = await buildApp({
      store: new ConfigStore(dir),
      go2rtc: new Go2rtcClient({ baseUrl: 'http://go2rtc:1984', fetch: go2rtcFetch }),
    })
    try {
      const res = await bare.inject({ url: '/api/ha/events', payloadAsStream: true })
      let data = ''
      res.stream().on('data', (chunk) => (data += String(chunk)))
      await vi.waitFor(() => expect(data).toContain('data: {"configured":false,"states":{}}\n\n'))
      expect(haFetch).not.toHaveBeenCalled()
    } finally {
      await bare.close()
    }
  })

  it('proxies WebRTC offers for known cameras only', async () => {
    await app.inject({ method: 'PUT', url: '/api/config', payload: { cameras: [camera] } })

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/streams/garage/webrtc',
      headers: { 'content-type': 'application/sdp' },
      payload: 'v=0 offer',
    })
    expect(unknown.statusCode).toBe(404)

    const known = await app.inject({
      method: 'POST',
      url: '/api/streams/nursery/webrtc',
      headers: { 'content-type': 'application/sdp' },
      payload: 'v=0 offer',
    })
    expect(known.statusCode).toBe(200)
    expect(known.body).toBe('v=0 answer')
    expect(known.headers['content-type']).toContain('application/sdp')
  })

  it('reports read-only system settings and a connected Home Assistant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system' })
    expect(res.json()).toEqual({
      homeAssistant: { url: 'http://ha:8123', status: 'connected' },
      go2rtc: { url: 'http://go2rtc:1984' },
    })
    expect(res.body).not.toContain('secret-token')
    expect(haFetch).toHaveBeenCalledWith(
      'http://ha:8123/api/',
      expect.objectContaining({ headers: { Authorization: 'Bearer secret-token' } }),
    )
  })

  it('explains why Home Assistant is not connected', async () => {
    haFetch.mockResolvedValueOnce(new Response('401: Unauthorized', { status: 401 }))
    const rejected = await app.inject({ method: 'GET', url: '/api/system' })
    expect(rejected.json().homeAssistant).toEqual({
      url: 'http://ha:8123',
      status: 'error',
      message: 'Home Assistant rejected the token (check HA_TOKEN)',
    })

    haFetch.mockRejectedValueOnce(
      new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 10.0.0.2:8123') }),
    )
    const unreachable = await app.inject({ method: 'GET', url: '/api/system' })
    expect(unreachable.json().homeAssistant.message).toBe(
      "Can't reach Home Assistant: connect ECONNREFUSED 10.0.0.2:8123",
    )

    haFetch.mockRejectedValueOnce(new TypeError('Bad URL http://user:hunter2@ha:8123/api/'))
    const invalid = await app.inject({ method: 'GET', url: '/api/system' })
    expect(invalid.json().homeAssistant.message).toBe("Can't reach Home Assistant: request failed")

    haFetch.mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'))
    const slow = await app.inject({ method: 'GET', url: '/api/system' })
    expect(slow.json().homeAssistant.message).toBe("Can't reach Home Assistant: timed out")
  })

  it('shows HA_URL without credentials when no token is configured', async () => {
    const bare = await buildApp({
      store: new ConfigStore(dir),
      go2rtc: new Go2rtcClient({ baseUrl: 'http://go2rtc:1984', fetch: go2rtcFetch }),
      haUrl: 'http://user:hunter2@ha.local:8123/',
    })
    const res = await bare.inject({ method: 'GET', url: '/api/system' })
    await bare.close()
    expect(res.json().homeAssistant).toEqual({
      url: 'http://ha.local:8123',
      status: 'unconfigured',
      message: 'HA_TOKEN is not set',
    })
    expect(res.body).not.toContain('hunter2')
  })
})
