import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchEntityStates } from '../api'

describe('API cancellation on older browsers', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(AbortSignal, 'any').mockImplementation(() => {
      throw new TypeError('AbortSignal.any is unavailable')
    })
    fetchMock.mockReset().mockResolvedValue(new Response('{"configured":true,"states":{}}'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('polls without AbortSignal.any and removes the cancellation listener after success', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    await expect(fetchEntityStates(controller.signal)).resolves.toEqual({
      configured: true,
      states: {},
    })
    expect(AbortSignal.any).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])('forwards cancellation (already aborted=%s)', async (alreadyAborted) => {
    const controller = new AbortController()
    if (alreadyAborted) controller.abort()
    fetchMock.mockImplementationOnce(async (_input, init) => {
      const signal = init!.signal!
      if (!signal.aborted) controller.abort()
      expect(signal.aborted).toBe(true)
      throw signal.reason
    })
    await expect(fetchEntityStates(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the timeout active through response body parsing and cleans up after failure', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    fetchMock.mockImplementationOnce(
      async (_input, init) =>
        ({
          ok: true,
          json: () =>
            new Promise((_resolve, reject) =>
              init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)),
            ),
        }) as Response,
    )
    const pending = fetchEntityStates(controller.signal)
    const advance = vi.advanceTimersByTimeAsync(10_000)
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await advance
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })
})
