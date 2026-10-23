import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUCKET_MS, HISTORY_RETENTION_MS } from '@/lib/sound-history'
import { SOUND_HISTORY_STORAGE_KEY, useSoundHistoryStore } from '../sound-history'

const NOW = Date.UTC(2026, 9, 23, 2, 0, 0)
const stored = () => JSON.parse(localStorage.getItem(SOUND_HISTORY_STORAGE_KEY) ?? 'null')

describe('sound history store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => vi.useRealTimers())

  it('records into minute buckets and returns a range of them', () => {
    const store = useSoundHistoryStore()
    store.record('a', -40, false, NOW)
    store.record('a', -30, true, NOW + 5_000)
    store.record('a', -50, false, NOW + BUCKET_MS)

    expect(store.bucketsFor('a', NOW, NOW + 2 * BUCKET_MS)).toEqual([
      [NOW, -30, 1],
      [NOW + BUCKET_MS, -50, 0],
    ])
    expect(store.bucketsFor('a', NOW + BUCKET_MS, NOW + 2 * BUCKET_MS)).toEqual([
      [NOW + BUCKET_MS, -50, 0],
    ])
    expect(store.bucketsFor('other', 0, Infinity)).toEqual([])
  })

  it('writes at most once a minute, then once more on pagehide', () => {
    const store = useSoundHistoryStore()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    store.record('a', -40, false, NOW)
    expect(setItem).toHaveBeenCalledTimes(1)

    store.record('a', -35, false, NOW + 10_000)
    store.record('a', -33, false, NOW + 59_000)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(stored()).toEqual({ a: [[NOW, -40, 0]] })

    window.dispatchEvent(new Event('pagehide'))
    expect(setItem).toHaveBeenCalledTimes(2)
    expect(stored()).toEqual({ a: [[NOW, -33, 0]] })

    // Nothing new to save, so a second pagehide stays quiet.
    window.dispatchEvent(new Event('pagehide'))
    expect(setItem).toHaveBeenCalledTimes(2)

    store.record('a', -20, true, NOW + 2 * BUCKET_MS)
    expect(setItem).toHaveBeenCalledTimes(3)
    setItem.mockRestore()
  })

  it('restores the saved history in a new session', () => {
    useSoundHistoryStore().record('a', -42, true, NOW)
    window.dispatchEvent(new Event('pagehide'))

    setActivePinia(createPinia())
    expect(useSoundHistoryStore().bucketsFor('a', NOW, NOW + BUCKET_MS)).toEqual([[NOW, -42, 1]])
  })

  it('drops saved buckets older than a day on load', () => {
    localStorage.setItem(
      SOUND_HISTORY_STORAGE_KEY,
      JSON.stringify({
        a: [
          [NOW - HISTORY_RETENTION_MS - 2 * BUCKET_MS, -30, 0],
          [NOW - BUCKET_MS, -31, 0],
        ],
      }),
    )
    expect(useSoundHistoryStore().bucketsFor('a', 0, Infinity)).toEqual([[NOW - BUCKET_MS, -31, 0]])
  })

  it('ignores corrupt storage', () => {
    localStorage.setItem(SOUND_HISTORY_STORAGE_KEY, '{"a":[[1,"loud",0]]}')
    expect(useSoundHistoryStore().bucketsFor('a', 0, Infinity)).toEqual([])
    localStorage.setItem(SOUND_HISTORY_STORAGE_KEY, 'not json')
    setActivePinia(createPinia())
    expect(useSoundHistoryStore().bucketsFor('a', 0, Infinity)).toEqual([])
  })

  it('forgets deleted cameras and saves right away', () => {
    const store = useSoundHistoryStore()
    store.record('a', -40, false, NOW)
    store.record('gone', -40, false, NOW)

    store.pruneDeletedCameras(['a'])
    expect(store.bucketsFor('gone', 0, Infinity)).toEqual([])
    expect(stored()).toEqual({ a: [[NOW, -40, 0]] })
  })

  it('stops listening for pagehide when the pinia scope is disposed', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    useSoundHistoryStore()
    // `$dispose` stops the store's own effect scope.
    useSoundHistoryStore().$dispose()
    expect(removeEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function))
    removeEventListener.mockRestore()
  })
})
