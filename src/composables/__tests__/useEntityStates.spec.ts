import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import type { EntityStatesResponse } from '@shared/api.ts'
import { fetchEntityStates } from '@/api'
import { useEntityStates } from '../useEntityStates'

vi.mock('@/api', () => ({ fetchEntityStates: vi.fn<typeof fetchEntityStates>() }))

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn<() => void>()

  constructor(readonly url: string) {
    super()
    FakeEventSource.instances.push(this)
  }

  snapshot(state = 'off', configured = true) {
    this.onmessage?.({ data: JSON.stringify(response(state, configured)) })
  }
}

const response = (state = 'off', configured = true): EntityStatesResponse => ({
  configured,
  states: { cry: { entityId: 'cry', state, lastChanged: 'now' } },
})

describe('useEntityStates', () => {
  let scope: ReturnType<typeof effectScope>
  let result: ReturnType<typeof useEntityStates>
  const latest = () => FakeEventSource.instances.at(-1)!

  function start() {
    scope = effectScope()
    result = scope.run(() => useEntityStates())!
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(fetchEntityStates).mockReset().mockResolvedValue(response())
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    scope?.stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses live snapshots and heartbeats without polling', async () => {
    start()
    expect(latest().url).toBe('/api/ha/events')
    latest().snapshot('on')
    expect(result.states.value.cry?.state).toBe('on')
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(15_000)
      latest().dispatchEvent(new Event('heartbeat'))
    }
    expect(fetchEntityStates).not.toHaveBeenCalled()
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('polls on a connection error, retries SSE, and stops polling after a fresh snapshot', async () => {
    start()
    latest().snapshot()
    latest().onerror?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchEntityStates).toHaveBeenCalledOnce()
    expect(latest().close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(3000)
    expect(FakeEventSource.instances).toHaveLength(2)
    latest().snapshot('on')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchEntityStates).toHaveBeenCalledTimes(2)
    expect(result.states.value.cry?.state).toBe('on')
    expect(result.error.value).toBeUndefined()
  })

  it('rejects an older poll result after live updates recover', async () => {
    let resolve!: (value: EntityStatesResponse) => void
    vi.mocked(fetchEntityStates).mockReturnValueOnce(new Promise((done) => (resolve = done)))
    start()
    latest().onerror?.()
    await vi.advanceTimersByTimeAsync(3000)
    latest().snapshot('on')
    resolve(response('off'))
    await vi.advanceTimersByTimeAsync(0)
    expect(result.states.value.cry?.state).toBe('on')
    expect(vi.getTimerCount()).toBe(1)
  })

  it.each(['initial snapshot', 'heartbeat'])('falls back when the %s stalls', async (stage) => {
    start()
    if (stage === 'heartbeat') latest().snapshot()
    // Heartbeats cannot substitute for an initial state snapshot.
    else latest().dispatchEvent(new Event('heartbeat'))
    await vi.advanceTimersByTimeAsync(stage === 'heartbeat' ? 45_000 : 10_000)
    expect(fetchEntityStates).toHaveBeenCalledOnce()
    expect(latest().close).toHaveBeenCalledOnce()
  })

  it('polls when SSE is unsupported and recovers from REST errors', async () => {
    vi.stubGlobal('EventSource', undefined)
    vi.mocked(fetchEntityStates).mockRejectedValueOnce(new Error('Offline'))
    start()
    await vi.advanceTimersByTimeAsync(0)
    expect(result.error.value).toBe('Offline')
    await vi.advanceTimersByTimeAsync(3000)
    expect(result.error.value).toBeUndefined()
    expect(result.states.value.cry?.state).toBe('off')
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('handles unconfigured HA and malformed SSE messages', async () => {
    start()
    latest().snapshot('off', false)
    expect(result.configured.value).toBe(false)
    latest().onmessage?.({ data: 'broken json' })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchEntityStates).toHaveBeenCalledOnce()
    expect(result.configured.value).toBe(true)
  })

  it('closes connections, aborts pending polls and cancels timers on disposal', async () => {
    vi.mocked(fetchEntityStates).mockImplementationOnce(
      (signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(new Error('Aborted'))),
        ),
    )
    start()
    latest().onerror?.()
    const signal = vi.mocked(fetchEntityStates).mock.lastCall![0]!
    scope.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(fetchEntityStates).toHaveBeenCalledOnce()
    expect(result.error.value).toBeUndefined()
  })
})
