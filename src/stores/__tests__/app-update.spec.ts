import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { UPDATE_CHECK_INTERVAL_MS, UPDATE_RELOAD_FALLBACK_MS } from '@/lib/app-update'

type Options = {
  onNeedRefresh?: () => void
  onRegisteredSW?: (url: string, reg: ServiceWorkerRegistration | undefined) => void
  onRegisterError?: (error: unknown) => void
}

const pwa = vi.hoisted(() => ({
  options: undefined as Options | undefined,
  updateSW: undefined as Mock<(reload?: boolean) => Promise<void>> | undefined,
  registerSW: undefined as Mock<(options: unknown) => void> | undefined,
}))

vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: Options) => {
    pwa.registerSW?.(options)
    pwa.options = options
    return pwa.updateSW
  },
}))

import { useAppUpdateStore } from '../app-update'

class FakeWorker extends EventTarget {
  state = 'installing'
}

type FakeRegistration = {
  waiting: ServiceWorker | null
  installing: FakeWorker | null
  update: Mock<() => Promise<void>>
}

const asRegistration = (reg: FakeRegistration) => reg as unknown as ServiceWorkerRegistration

function installFakeServiceWorker(controller: object | null = {}) {
  const container = Object.assign(new EventTarget(), { controller })
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true })
  return container
}

function makeRegistration(): FakeRegistration {
  return {
    waiting: null,
    installing: null,
    update: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
}

describe('app update store', () => {
  let reload: Mock<() => void>
  let container: EventTarget

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    pwa.options = undefined
    pwa.updateSW = vi.fn<(reload?: boolean) => Promise<void>>().mockResolvedValue(undefined)
    pwa.registerSW = vi.fn<(options: unknown) => void>()
    container = installFakeServiceWorker()
    reload = vi.fn<() => void>()
    vi.stubGlobal('location', { ...window.location, reload })
  })

  afterEach(() => {
    useAppUpdateStore().stop()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  function started(reg = makeRegistration()) {
    const store = useAppUpdateStore()
    store.start()
    pwa.options?.onRegisteredSW?.('/sw.js', asRegistration(reg))
    return { store, reg }
  }

  it('is unsupported without service worker support', () => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
    const store = useAppUpdateStore()
    store.start()
    expect(store.status).toBe('unsupported')
    expect(pwa.registerSW).not.toHaveBeenCalled()
  })

  it('stays unsupported until a registration arrives, and registers only once', () => {
    const store = useAppUpdateStore()
    store.start()
    store.start()
    expect(store.status).toBe('unsupported')
    expect(pwa.registerSW).toHaveBeenCalledTimes(1)

    pwa.options?.onRegisteredSW?.('/sw.js', asRegistration(makeRegistration()))
    expect(store.status).toBe('idle')
  })

  it('is unsupported when registration fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useAppUpdateStore()
    store.start()
    pwa.options?.onRegisterError?.(new Error('insecure'))
    expect(store.status).toBe('unsupported')
    expect(warn).toHaveBeenCalled()
  })

  it('becomes available when the worker asks for a refresh', () => {
    const { store } = started()
    pwa.options?.onNeedRefresh?.()
    expect(store.status).toBe('available')
  })

  it('reports up to date when a check finds nothing', async () => {
    const { store, reg } = started()
    await store.checkForUpdates()
    expect(reg.update).toHaveBeenCalled()
    expect(store.status).toBe('up-to-date')
  })

  it('reports available when a worker is waiting after a check', async () => {
    const { store, reg } = started()
    reg.update.mockImplementation(async () => {
      reg.waiting = {} as ServiceWorker
    })
    await store.checkForUpdates()
    expect(store.status).toBe('available')
  })

  it('waits for an installing worker before deciding', async () => {
    const { store, reg } = started()
    const worker = new FakeWorker()
    reg.update.mockImplementation(async () => {
      reg.installing = worker
    })
    const check = store.checkForUpdates()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.status).toBe('checking')

    reg.waiting = worker as unknown as ServiceWorker
    worker.state = 'installed'
    worker.dispatchEvent(new Event('statechange'))
    await check
    expect(store.status).toBe('available')
  })

  it('reports an error when the check fails', async () => {
    const { store, reg } = started()
    reg.update.mockRejectedValue(new TypeError('offline'))
    await store.checkForUpdates()
    expect(store.status).toBe('error')
  })

  it('ignores a second check while one is running', async () => {
    const { store, reg } = started()
    await Promise.all([store.checkForUpdates(), store.checkForUpdates()])
    expect(reg.update).toHaveBeenCalledTimes(1)
  })

  it('throttles the check made when Settings opens', async () => {
    const { store, reg } = started()
    store.checkIfStale()
    await vi.advanceTimersByTimeAsync(0)
    store.checkIfStale()
    expect(reg.update).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    store.checkIfStale()
    expect(reg.update).toHaveBeenCalledTimes(2)
  })

  it('checks hourly, but not while offline', async () => {
    const { reg } = started()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(reg.update).toHaveBeenCalledTimes(1)

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(reg.update).toHaveBeenCalledTimes(1)
  })

  it('applies the update through the worker and reloads if nothing else does', async () => {
    const { store } = started()
    pwa.options?.onNeedRefresh?.()
    await store.applyUpdate()
    expect(pwa.updateSW).toHaveBeenCalledWith(true)
    expect(store.status).toBe('updating')
    expect(reload).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(UPDATE_RELOAD_FALLBACK_MS)
    expect(reload).toHaveBeenCalled()
  })

  it('asks to reload when another window updated the worker', () => {
    const { store } = started()
    container.dispatchEvent(new Event('controllerchange'))
    expect(store.status).toBe('reload-needed')

    store.reload()
    expect(reload).toHaveBeenCalled()
  })

  it('does not ask to reload for its own update', async () => {
    const { store } = started()
    await store.applyUpdate()
    container.dispatchEvent(new Event('controllerchange'))
    expect(store.status).toBe('updating')
  })

  it('does not treat the first controller of a fresh install as an update', () => {
    container = installFakeServiceWorker(null)
    const { store } = started()
    container.dispatchEvent(new Event('controllerchange'))
    expect(store.status).toBe('idle')
  })

  it('stops listening after stop()', () => {
    const { store } = started()
    store.stop()
    container.dispatchEvent(new Event('controllerchange'))
    expect(store.status).toBe('idle')
  })
})
