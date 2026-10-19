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
  entity_id: 'binary_sensor.cry',
  state,
  last_changed: '2026-10-19T10:00:00Z',
  attributes: { friendly_name: 'Crying' },
})

describe('Home Assistant live states', () => {
  let socket: FakeSocket
  let stop: () => void
  const onStates = vi.fn<Parameters<HomeAssistantClient['watchStates']>[1]>()
  const onUnavailable = vi.fn<() => void>()
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
    socket.receive({ id: 2, type: 'result', success: true, result: [cry()] })
  }

  function change(state: ReturnType<typeof cry> | null, id = 'binary_sensor.cry') {
    socket.receive({
      id: 1,
      type: 'event',
      event: { data: { entity_id: id, new_state: state } },
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

  it('authenticates server-side, subscribes, then snapshots only configured entities', () => {
    watch('https://ha:8123/prefix/')
    expect(createWebSocket).toHaveBeenCalledWith('wss://ha:8123/prefix/api/websocket')
    authenticate()
    expect(socket.send.mock.calls.map(([body]) => JSON.parse(body))).toEqual([
      { type: 'auth', access_token: 'private-token' },
      { id: 1, type: 'subscribe_events', event_type: 'state_changed' },
      { id: 2, type: 'get_states' },
    ])
    socket.receive({
      id: 2,
      type: 'result',
      success: true,
      result: [cry(), { ...cry(), entity_id: 'sensor.private' }],
    })
    expect(onStates).toHaveBeenLastCalledWith({
      'binary_sensor.cry': {
        entityId: 'binary_sensor.cry',
        state: 'off',
        friendlyName: 'Crying',
        lastChanged: '2026-10-19T10:00:00Z',
      },
    })
    expect(JSON.stringify(onStates.mock.calls)).not.toContain('private')
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it('preserves setup-time changes over the snapshot and pushes updates and removals', () => {
    watch()
    authenticate()
    change(cry('on'))
    snapshot()
    expect(onStates.mock.lastCall?.[0]['binary_sensor.cry']?.state).toBe('on')
    change(cry('off'))
    expect(onStates.mock.lastCall?.[0]['binary_sensor.cry']?.state).toBe('off')
    change(cry('on'), 'sensor.private')
    expect(onStates).toHaveBeenCalledTimes(2)
    change(null)
    expect(onStates).toHaveBeenLastCalledWith({})
  })

  it.each(['auth', 'subscribe', 'snapshot', 'close', 'error', 'malformed'])(
    'reports %s failure once and releases the socket',
    (failure) => {
      watch()
      if (failure === 'auth') socket.receive({ type: 'auth_invalid' })
      if (failure === 'subscribe') {
        socket.receive({ type: 'auth_required' })
        socket.receive({ type: 'auth_ok' })
        socket.receive({ id: 1, type: 'result', success: false })
      }
      if (failure === 'snapshot') {
        authenticate()
        socket.receive({ id: 2, type: 'result', success: false })
      }
      if (failure === 'close') socket.onclose?.()
      if (failure === 'error') socket.onerror?.()
      if (failure === 'malformed') socket.onmessage?.({ data: '{broken' })
      vi.advanceTimersByTime(60_000)
      expect(onUnavailable).toHaveBeenCalledOnce()
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
    expect(onUnavailable).toHaveBeenCalledOnce()
  })

  it('detects half-open connections using ping/pong', () => {
    watch()
    authenticate()
    snapshot()
    vi.advanceTimersByTime(30_000)
    expect(JSON.parse(socket.send.mock.lastCall![0])).toEqual({ id: 3, type: 'ping' })
    socket.receive({ id: 3, type: 'pong' })
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
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith()
  })
})
