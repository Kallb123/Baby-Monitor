import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import { useScreenWakeLock } from '../useScreenWakeLock'

const Host = defineComponent({
  setup() {
    useScreenWakeLock()
    return () => null
  },
})

function makeLock() {
  const lock = new EventTarget() as WakeLockSentinel
  Object.defineProperty(lock, 'released', { value: false, writable: true })
  lock.release = vi.fn<() => Promise<void>>(async () => {
    Object.defineProperty(lock, 'released', { value: true, writable: true })
    lock.dispatchEvent(new Event('release'))
  })
  return lock
}

describe('useScreenWakeLock', () => {
  const request = vi.fn<(type: WakeLockType) => Promise<WakeLockSentinel>>()
  let wrapper: ReturnType<typeof mount> | undefined

  function visibility(state: DocumentVisibilityState) {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
    document.dispatchEvent(new Event('visibilitychange'))
  }

  beforeEach(() => {
    request.mockReset().mockImplementation(async () => makeLock())
    vi.stubGlobal('navigator', { wakeLock: { request } })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('requests a screen lock on mount and releases it on disposal', async () => {
    const lock = makeLock()
    request.mockResolvedValue(lock)
    wrapper = mount(Host)
    await flushPromises()
    expect(request).toHaveBeenCalledExactlyOnceWith('screen')

    wrapper.unmount()
    wrapper = undefined
    expect(lock.release).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('keydown'))
    window.dispatchEvent(new Event('pageshow'))
    visibility('visible')
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('releases on backgrounding and acquires a fresh lock when visible again', async () => {
    const lock = makeLock()
    request.mockResolvedValueOnce(lock)
    wrapper = mount(Host)
    await flushPromises()
    visibility('hidden')
    expect(lock.release).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledTimes(1)

    visibility('visible')
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('waits for visibility if mounted in a background tab', async () => {
    visibility('hidden')
    wrapper = mount(Host)
    window.dispatchEvent(new Event('pointerdown'))
    await flushPromises()
    expect(request).not.toHaveBeenCalled()

    visibility('visible')
    await flushPromises()
    expect(request).toHaveBeenCalledOnce()
  })

  it('does not request duplicate locks during a pending request or while held', async () => {
    let resolve!: (lock: WakeLockSentinel) => void
    request.mockReturnValue(new Promise((done) => (resolve = done)))
    wrapper = mount(Host)
    window.dispatchEvent(new Event('pointerdown'))
    visibility('visible')
    expect(request).toHaveBeenCalledOnce()

    resolve(makeLock())
    await flushPromises()
    window.dispatchEvent(new Event('keydown'))
    window.dispatchEvent(new Event('pageshow'))
    expect(request).toHaveBeenCalledOnce()
  })

  it.each(['pointerdown', 'keydown', 'pageshow'])(
    'tolerates denial and retries on %s',
    async (event) => {
      request.mockRejectedValueOnce(new DOMException('Not allowed', 'NotAllowedError'))
      wrapper = mount(Host)
      await flushPromises()
      expect(request).toHaveBeenCalledTimes(1)

      window.dispatchEvent(new Event(event))
      await flushPromises()
      expect(request).toHaveBeenCalledTimes(2)
    },
  )

  it('can acquire again after the system releases the lock', async () => {
    const lock = makeLock()
    request.mockResolvedValueOnce(lock)
    wrapper = mount(Host)
    await flushPromises()
    await lock.release()
    window.dispatchEvent(new Event('pointerdown'))
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each(['hidden', 'unmounted'])('releases a pending lock if the app is %s', async (state) => {
    let resolve!: (lock: WakeLockSentinel) => void
    request.mockReturnValue(new Promise((done) => (resolve = done)))
    wrapper = mount(Host)
    if (state === 'hidden') visibility('hidden')
    else {
      wrapper.unmount()
      wrapper = undefined
    }

    const lock = makeLock()
    resolve(lock)
    await flushPromises()
    expect(lock.release).toHaveBeenCalledOnce()
  })

  it('continues normally when the browser has no wake lock API', async () => {
    vi.unstubAllGlobals()
    // jsdom has no wakeLock property by default.
    wrapper = mount(Host)
    await flushPromises()
    window.dispatchEvent(new Event('pointerdown'))
    expect(request).not.toHaveBeenCalled()
  })
})
