import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useFullscreen } from '../useFullscreen'

type Overrides = Partial<Record<string, unknown>>

const defined: { target: object; key: string }[] = []

// jsdom has no fullscreen API, so each test defines just the members it needs.
function define(target: object, props: Overrides) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(target, key, { value, configurable: true, writable: true })
    defined.push({ target, key })
  }
}

function run() {
  const scope = effectScope()
  const api = scope.run(() => useFullscreen())!
  return { api, scope }
}

function setElement(key: string, value: Element | null) {
  define(document, { [key]: value })
}

describe('useFullscreen', () => {
  afterEach(() => {
    for (const { target, key } of defined.splice(0)) {
      Reflect.deleteProperty(target, key)
    }
    vi.restoreAllMocks()
  })

  it('is unsupported and does nothing where fullscreen is unavailable', () => {
    const request = vi.fn<() => void>()
    define(document.documentElement, { requestFullscreen: request })
    const { api, scope } = run()
    expect(api.supported).toBe(false)
    expect(api.isFullscreen.value).toBe(false)
    api.toggle()
    expect(request).not.toHaveBeenCalled()
    scope.stop()
  })

  it('requests fullscreen on the document element', () => {
    const request = vi.fn<() => Promise<void>>(async () => {})
    define(document, { fullscreenEnabled: true })
    define(document.documentElement, { requestFullscreen: request })
    const { api, scope } = run()
    expect(api.supported).toBe(true)
    api.toggle()
    expect(request).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('exits fullscreen when an element is already fullscreen', () => {
    const exit = vi.fn<() => Promise<void>>(async () => {})
    const request = vi.fn<() => Promise<void>>(async () => {})
    define(document, { fullscreenEnabled: true, exitFullscreen: exit })
    define(document.documentElement, { requestFullscreen: request })
    setElement('fullscreenElement', document.documentElement)
    const { api, scope } = run()
    expect(api.isFullscreen.value).toBe(true)
    api.toggle()
    expect(exit).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
    scope.stop()
  })

  it('swallows rejected requests and exits', async () => {
    const unhandled = vi.fn<() => void>()
    process.on('unhandledRejection', unhandled)
    define(document, {
      fullscreenEnabled: true,
      exitFullscreen: vi.fn<() => Promise<void>>(() => Promise.reject(new TypeError('denied'))),
    })
    define(document.documentElement, {
      requestFullscreen: vi.fn<() => Promise<void>>(() => Promise.reject(new TypeError('denied'))),
    })
    const { api, scope } = run()
    api.toggle()
    setElement('fullscreenElement', document.documentElement)
    api.toggle()
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    scope.stop()
  })

  it('follows fullscreenchange events', () => {
    define(document, { fullscreenEnabled: true, fullscreenElement: null })
    const { api, scope } = run()
    expect(api.isFullscreen.value).toBe(false)

    setElement('fullscreenElement', document.documentElement)
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(api.isFullscreen.value).toBe(true)

    setElement('fullscreenElement', null)
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(api.isFullscreen.value).toBe(false)
    scope.stop()
  })

  it('falls back to the WebKit-prefixed API', () => {
    const request = vi.fn<() => void>()
    const exit = vi.fn<() => void>()
    define(document, { webkitFullscreenEnabled: true, webkitExitFullscreen: exit })
    define(document.documentElement, { webkitRequestFullscreen: request })
    const { api, scope } = run()
    expect(api.supported).toBe(true)
    expect(api.isFullscreen.value).toBe(false)

    api.toggle()
    expect(request).toHaveBeenCalledOnce()

    setElement('webkitFullscreenElement', document.documentElement)
    document.dispatchEvent(new Event('webkitfullscreenchange'))
    expect(api.isFullscreen.value).toBe(true)

    api.toggle()
    expect(exit).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('removes both listeners when the scope stops', () => {
    define(document, { fullscreenEnabled: true, fullscreenElement: null })
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const { api, scope } = run()
    scope.stop()

    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
      const added = add.mock.calls.find(([name]) => name === type)
      const removed = remove.mock.calls.find(([name]) => name === type)
      expect(added).toBeDefined()
      expect(removed?.[1]).toBe(added?.[1])
    }

    setElement('fullscreenElement', document.documentElement)
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(api.isFullscreen.value).toBe(false)
  })
})
