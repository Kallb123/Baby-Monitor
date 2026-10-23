import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import type { CryHistoryResponse } from '@shared/api.ts'
import { fetchCryHistory } from '@/api'
import { useCryHistory } from '../useCryHistory'

vi.mock('@/api', () => ({ fetchCryHistory: vi.fn<typeof fetchCryHistory>() }))

const response = (cry: CryHistoryResponse['cameras'] = {}): CryHistoryResponse => ({
  configured: true,
  from: '2026-10-23T00:00:00.000Z',
  to: '2026-10-23T12:00:00.000Z',
  cameras: cry,
})

describe('useCryHistory', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(fetchCryHistory).mockReset().mockResolvedValue(response())
  })

  afterEach(() => {
    scope?.stop()
    vi.useRealTimers()
  })

  function start(hours = 12) {
    const range = ref(hours)
    scope = effectScope()
    const result = scope.run(() => useCryHistory(range))!
    return { range, ...result }
  }

  it('loads once at start, then every minute', async () => {
    const { data } = start()
    await vi.advanceTimersByTimeAsync(0)
    expect(data.value?.configured).toBe(true)
    expect(fetchCryHistory).toHaveBeenCalledTimes(1)
    expect(fetchCryHistory).toHaveBeenCalledWith(12, expect.any(AbortSignal))

    await vi.advanceTimersByTimeAsync(59_000)
    expect(fetchCryHistory).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchCryHistory).toHaveBeenCalledTimes(2)
  })

  it('keeps the last data on a failed refresh and recovers', async () => {
    const { data, error } = start()
    await vi.advanceTimersByTimeAsync(0)
    const first = data.value

    vi.mocked(fetchCryHistory).mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(error.value).toBe('offline')
    expect(data.value).toBe(first)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(error.value).toBeUndefined()
  })

  it('drops the old answer and reloads when the range changes', async () => {
    const { data, range } = start()
    await vi.advanceTimersByTimeAsync(0)
    expect(data.value).toBeDefined()

    vi.mocked(fetchCryHistory).mockImplementation(() => new Promise(() => {}))
    range.value = 24
    await nextTick()
    expect(data.value).toBeUndefined()
    expect(fetchCryHistory).toHaveBeenLastCalledWith(24, expect.any(AbortSignal))
  })

  it('ignores a slow answer for a range that is no longer selected', async () => {
    let resolveFirst: (value: CryHistoryResponse) => void = () => {}
    vi.mocked(fetchCryHistory).mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    )
    const { data, range } = start()
    range.value = 6
    await vi.advanceTimersByTimeAsync(0)
    resolveFirst(response({ stale: { cry: [] } }))
    await vi.advanceTimersByTimeAsync(0)
    expect(data.value?.cameras).toEqual({})
  })

  it('cancels its request and timer with the scope', async () => {
    start()
    await vi.advanceTimersByTimeAsync(0)
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchCryHistory).toHaveBeenCalledTimes(1)
  })
})
