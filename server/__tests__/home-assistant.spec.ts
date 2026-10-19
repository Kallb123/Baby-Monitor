import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HomeAssistantClient } from '../home-assistant.ts'

class FakeSocket {
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  send = vi.fn<(data: string) => void>()
  close = vi.fn<() => void>()

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

const cry = (state = 'off') => ({
  s: state,
  lc: 1792404000,
  a: { friendly_name: 'Crying', unit_of_measurement: 'dB' },
})

describe('Home Assistant live states', () => {
  let socket: FakeSocket
  let stop: () => void
  const onStates = vi.fn<Parameters<HomeAssistantClient['watchStates']>[1]>()
  const onUnavailable = vi.fn<Parameters<HomeAssistantClient['watchStates']>[2]>()
  const createWebSocket = vi.fn<(url: string) => WebSocket>()

  function watch(baseUrl = 'http://ha:8123') {
    const client = new HomeAssistantClient({
      baseUrl,
      token: 'private-token',
      createWebSocket,
    })
    stop = client.watchStates(['binary_sensor.cry'], onStates, onUnavailable)
  }

  function authenticate() {
    socket.receive({ type: 'auth_required' })
    socket.receive({ type: 'auth_ok' })
    socket.receive({ id: 1, type: 'result', success: true })
  }

  function snapshot() {
    socket.receive({ id: 1, type: 'event', event: { a: { 'binary_sensor.cry': cry() } } })
  }

  function change(state: ReturnType<typeof cry> | null, id = 'binary_sensor.cry') {
    socket.receive({
      id: 1,
      type: 'event',
      event: state ? { c: { [id]: { '+': state } } } : { r: [id] },
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    socket = new FakeSocket()
    createWebSocket.mockReturnValue(socket as unknown as WebSocket)
  })

  afterEach(() => {
    stop?.()
    vi.useRealTimers()
  })

  it('authenticates and requests an HA-filtered subscription with an atomic snapshot', () => {
    watch('https://ha:8123/prefix/')
    expect(createWebSocket).toHaveBeenCalledWith('wss://ha:8123/prefix/api/websocket')
    authenticate()
    expect(socket.send.mock.calls.map(([body]) => JSON.parse(body))).toEqual([
      { type: 'auth', access_token: 'private-token' },
      { id: 1, type: 'subscribe_entities', entity_ids: ['binary_sensor.cry'] },
    ])
    socket.receive({
      id: 1,
      type: 'event',
      event: { a: { 'binary_sensor.cry': cry(), 'sensor.private': cry() } },
    })
    expect(onStates).toHaveBeenLastCalledWith({
      'binary_sensor.cry': {
        entityId: 'binary_sensor.cry',
        state: 'off',
        friendlyName: 'Crying',
        unit: 'dB',
        lastChanged: new Date(cry().lc * 1000).toISOString(),
      },
    })
    expect(JSON.stringify(onStates.mock.calls)).not.toContain('private')
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it('applies compact updates, additions and removals without exposing other entities', () => {
    watch()
    authenticate()
    snapshot()
    change(cry('on'))
    expect(onStates.mock.lastCall?.[0]['binary_sensor.cry']?.state).toBe('on')
    change(cry('off'))
    expect(onStates.mock.lastCall?.[0]['binary_sensor.cry']?.state).toBe('off')
    change(cry('on'), 'sensor.private')
    expect(onStates).toHaveBeenCalledTimes(4)
    change(null)
    expect(onStates).toHaveBeenLastCalledWith({})
    socket.receive({ id: 1, type: 'event', event: { a: { 'binary_sensor.cry': cry('on') } } })
    expect(onStates.mock.lastCall?.[0]['binary_sensor.cry']?.state).toBe('on')
  })

  it('merges partial state and attribute diffs and preserves the last-change timestamp', () => {
    watch()
    authenticate()
    snapshot()
    socket.receive({
      id: 1,
      type: 'event',
      event: {
        c: {
          'binary_sensor.cry': { '+': { s: '', a: { friendly_name: 'New name' }, lu: 1792404010 } },
        },
      },
    })
    expect(onStates.mock.lastCall?.[0]['binary_sensor.cry']).toEqual({
      entityId: 'binary_sensor.cry',
      state: '',
      friendlyName: 'New name',
      unit: 'dB',
      lastChanged: new Date(cry().lc * 1000).toISOString(),
    })
    socket.receive({
      id: 1,
      type: 'event',
      event: {
        c: {
          'binary_sensor.cry': {
            '+': { s: 'on', lc: 1792404020 },
            '-': { a: ['friendly_name', 'unit_of_measurement'] },
          },
        },
      },
    })
    expect(onStates.mock.lastCall?.[0]['binary_sensor.cry']).toEqual({
      entityId: 'binary_sensor.cry',
      state: 'on',
      lastChanged: new Date(1792404020 * 1000).toISOString(),
    })
  })

  it('accepts an empty initial snapshot when configured entities are missing', () => {
    watch()
    authenticate()
    socket.receive({ id: 1, type: 'event', event: { a: {} } })
    expect(onStates).toHaveBeenCalledExactlyOnceWith({})
    vi.advanceTimersByTime(5000)
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it.each(['auth', 'subscribe', 'snapshot', 'close', 'error', 'malformed'])(
    'reports %s failure once and releases the socket',
    (failure) => {
      watch()
      if (failure === 'auth') {
        socket.receive({ type: 'auth_required' })
        socket.receive({ type: 'auth_invalid', message: 'private-token https://secret.example' })
      }
      if (failure === 'subscribe') {
        socket.receive({ type: 'auth_required' })
        socket.receive({ type: 'auth_ok' })
        socket.receive({ id: 1, type: 'result', success: false })
      }
      if (failure === 'snapshot') {
        authenticate()
        socket.receive({
          id: 1,
          type: 'event',
          event: { a: { 'binary_sensor.cry': { s: 'on', lc: 'invalid' } } },
        })
      }
      if (failure === 'close') socket.onclose?.()
      if (failure === 'error') socket.onerror?.()
      if (failure === 'malformed') socket.onmessage?.({ data: '{broken' })
      vi.advanceTimersByTime(60_000)
      expect(onUnavailable).toHaveBeenCalledOnce()
      expect(onUnavailable.mock.lastCall?.[0].reason).toBe(
        {
          auth: 'auth_invalid',
          subscribe: 'subscription_rejected',
          snapshot: 'invalid_message',
          close: 'socket_closed',
          error: 'socket_error',
          malformed: 'invalid_message',
        }[failure],
      )
      expect(JSON.stringify(onUnavailable.mock.calls)).not.toContain('private-token')
      expect(JSON.stringify(onUnavailable.mock.calls)).not.toContain('https://secret.example')
      expect(socket.close).toHaveBeenCalledOnce()
      expect(onStates).not.toHaveBeenCalled()
    },
  )

  it.each(['connect', 'subscribe', 'snapshot'])('times out during %s', (phase) => {
    watch()
    if (phase === 'subscribe') {
      socket.receive({ type: 'auth_required' })
      socket.receive({ type: 'auth_ok' })
    }
    if (phase === 'snapshot') authenticate()
    vi.advanceTimersByTime(5000)
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith({
      phase: { connect: 'connecting', subscribe: 'subscribing', snapshot: 'snapshot' }[phase],
      reason: 'timeout',
    })
  })

  it('detects half-open connections using ping/pong', () => {
    watch()
    authenticate()
    snapshot()
    vi.advanceTimersByTime(30_000)
    expect(JSON.parse(socket.send.mock.lastCall![0])).toEqual({ id: 2, type: 'ping' })
    socket.receive({ id: 2, type: 'pong' })
    vi.advanceTimersByTime(30_000)
    expect(onUnavailable).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(onUnavailable).toHaveBeenCalledOnce()
  })

  it('releases all resources without reporting a failure on disposal', () => {
    watch()
    authenticate()
    snapshot()
    stop()
    vi.advanceTimersByTime(60_000)
    expect(socket.close).toHaveBeenCalledOnce()
    expect(onUnavailable).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('handles a synchronous connection error without exposing credentials', async () => {
    createWebSocket.mockImplementationOnce(() => {
      throw new Error('private-token')
    })
    watch()
    await vi.runAllTimersAsync()
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith({
      phase: 'connecting',
      reason: 'connection_error',
    })
  })
})
