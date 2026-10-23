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
    watch.mock.lastCall![2]({ phase: 'live', reason: 'socket_error' })
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

  it.each(['HA failure', 'config change', 'shutdown'])(
    'stops heartbeat writes before ending a stalled viewer on %s',
    async (cause) => {
      const watch = vi.spyOn(HomeAssistantClient.prototype, 'watchStates').mockReturnValue(vi.fn())
      await app.inject({ method: 'PUT', url: '/api/config', payload: { cameras: [camera] } })
      vi.useFakeTimers()
      const res = await app.inject({ url: '/api/ha/events', payloadAsStream: true })
      // Model a socket whose end is queued but cannot flush or emit close yet.
      const end = vi.spyOn(res.raw.res, 'end').mockImplementation(() => {
        Object.defineProperty(res.raw.res, 'writableEnded', { value: true, configurable: true })
        return res.raw.res
      })
      const write = vi.spyOn(res.raw.res, 'write')
      let shutdown: Promise<void> | undefined
      let update: Promise<unknown> | undefined
      try {
        if (cause === 'HA failure') {
          watch.mock.lastCall![2]({ phase: 'live', reason: 'socket_closed' })
        } else if (cause === 'config change') {
          update = app.inject({ method: 'PUT', url: '/api/config', payload: { cameras: [] } })
        } else {
          shutdown = app.close()
        }
        await vi.waitFor(() => expect(end).toHaveBeenCalledOnce())
        await vi.advanceTimersByTimeAsync(0)
        await update
        expect(res.raw.res.destroyed).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
        await vi.advanceTimersByTimeAsync(30_000)
        expect(write).not.toHaveBeenCalled()
      } finally {
        end.mockRestore()
        res.raw.res.destroy()
        await update
        await shutdown
      }
    },
  )

  it('does not write a heartbeat to an already ended response before close fires', async () => {
    vi.useFakeTimers()
    const res = await app.inject({ url: '/api/ha/events', payloadAsStream: true })
    const write = vi.spyOn(res.raw.res, 'write')
    Object.defineProperty(res.raw.res, 'writableEnded', { value: true, configurable: true })
    try {
      await vi.advanceTimersByTimeAsync(15_000)
      expect(res.raw.res.destroyed).toBe(false)
      expect(write).not.toHaveBeenCalled()
    } finally {
      res.raw.res.destroy()
    }
  })

  it('destroys viewers that buffer over 1 MiB and releases their subscription and heartbeat', async () => {
    const stop = vi.fn<() => void>()
    const watch = vi.spyOn(HomeAssistantClient.prototype, 'watchStates').mockReturnValue(stop)
    await app.inject({ method: 'PUT', url: '/api/config', payload: { cameras: [camera] } })
    vi.useFakeTimers()
    const res = await app.inject({ url: '/api/ha/events', payloadAsStream: true })
    Object.defineProperty(res.raw.res, 'writableLength', { value: 1024 * 1024 + 1 })
    const write = vi.spyOn(res.raw.res, 'write')
    watch.mock.lastCall![1]({})
    await vi.advanceTimersByTimeAsync(0)
    expect(res.raw.res.destroyed).toBe(true)
    expect(write).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('logs a safe phase and actionable authentication failure through the app logger', async () => {
    const watch = vi.spyOn(HomeAssistantClient.prototype, 'watchStates').mockReturnValue(vi.fn())
    const warn = vi.spyOn(app.log, 'warn')
    await app.inject({ method: 'PUT', url: '/api/config', payload: { cameras: [camera] } })
    await app.inject({ url: '/api/ha/events', payloadAsStream: true })
    watch.mock.lastCall![2]({ phase: 'authenticating', reason: 'auth_invalid' })
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { phase: 'authenticating', reason: 'auth_invalid' },
      'Home Assistant rejected the WebSocket token (check HA_TOKEN)',
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-token')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('http://ha:8123')
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

  describe('stream quality', () => {
    const withSub = { ...camera, subRtspUrl: 'rtsp://192.168.1.20:554/stream2' }

    const offer = (id: string, query = '') =>
      app.inject({
        method: 'POST',
        url: `/api/streams/${id}/webrtc${query}`,
        headers: { 'content-type': 'application/sdp' },
        payload: 'v=0 offer',
      })

    const negotiatedSource = () =>
      new URL(String(go2rtcFetch.mock.calls.at(-1)![0])).searchParams.get('src')

    beforeEach(async () => {
      await app.inject({ method: 'PUT', url: '/api/config', payload: { cameras: [withSub] } })
      // Setup, not an assertion: wait for the background stream sync to finish.
      await vi.waitFor(() => {
        if (go2rtcFetch.mock.calls.length < 2) throw new Error('streams not registered yet')
      })
      go2rtcFetch.mockClear()
    })

    it('negotiates the main stream by default and when asked', async () => {
      expect((await offer('nursery')).statusCode).toBe(200)
      expect(negotiatedSource()).toBe('nursery')
      expect((await offer('nursery', '?quality=main')).statusCode).toBe(200)
      expect(negotiatedSource()).toBe('nursery')
    })

    it('negotiates the sub stream when the camera has one', async () => {
      expect((await offer('nursery', '?quality=sub')).statusCode).toBe(200)
      expect(negotiatedSource()).toBe('nursery.sub')
    })

    it('falls back to main for a camera without a sub-stream', async () => {
      await app.inject({ method: 'PUT', url: '/api/config', payload: { cameras: [camera] } })
      await vi.waitFor(() => expect(go2rtcFetch).toHaveBeenCalled())
      go2rtcFetch.mockClear()

      expect((await offer('nursery', '?quality=sub')).statusCode).toBe(200)
      expect(negotiatedSource()).toBe('nursery')
    })

    it('rejects an invalid quality without calling go2rtc', async () => {
      const res = await offer('nursery', '?quality=huge')
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'Expected quality to be "main" or "sub"' })
      expect(go2rtcFetch).not.toHaveBeenCalled()
    })

    it('still answers 404 for an unknown camera', async () => {
      expect((await offer('garage', '?quality=sub')).statusCode).toBe(404)
    })

    it('saves a blank sub-stream address as absent and does not register it', async () => {
      await app.inject({
        method: 'PUT',
        url: '/api/config',
        payload: { cameras: [{ ...withSub, subRtspUrl: '' }] },
      })
      await vi.waitFor(() => expect(go2rtcFetch).toHaveBeenCalledTimes(1))
      const names = go2rtcFetch.mock.calls.map(([url]) =>
        new URL(String(url)).searchParams.get('name'),
      )
      expect(names).toEqual(['nursery'])
      const saved = await app.inject({ method: 'GET', url: '/api/config' })
      expect(saved.json().cameras[0]).not.toHaveProperty('subRtspUrl')
    })
  })
})
