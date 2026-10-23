import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FEED_LOST_AFTER_MS } from '@/lib/feed-alerts'
import { useFeedAlertsStore } from '../feed-alerts'

const ids = (store: ReturnType<typeof useFeedAlertsStore>) =>
  store.lostFeeds.map((feed) => feed.cameraId)

describe('feed alerts store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('alerts once a camera has been down for 30 seconds, with how long', () => {
    const store = useFeedAlertsStore()
    store.report('nursery', 'connecting')

    vi.advanceTimersByTime(FEED_LOST_AFTER_MS - 1000)
    expect(store.lostFeeds).toEqual([])

    vi.advanceTimersByTime(1000)
    expect(store.lostFeeds).toEqual([{ cameraId: 'nursery', downForMs: FEED_LOST_AFTER_MS }])

    vi.advanceTimersByTime(30_000)
    expect(store.lostFeeds[0]?.downForMs).toBe(60_000)
  })

  it('keeps counting through connecting and error flips', () => {
    const store = useFeedAlertsStore()
    store.report('nursery', 'connecting')
    vi.advanceTimersByTime(20_000)
    store.report('nursery', 'error')
    vi.advanceTimersByTime(10_000)
    store.report('nursery', 'connecting')
    expect(ids(store)).toEqual(['nursery'])
  })

  it('clears the alert when the feed is live again', () => {
    const store = useFeedAlertsStore()
    store.report('nursery', 'error')
    vi.advanceTimersByTime(FEED_LOST_AFTER_MS)
    expect(ids(store)).toEqual(['nursery'])

    store.report('nursery', 'live')
    expect(store.lostFeeds).toEqual([])

    // A new outage starts its own 30 second clock.
    store.report('nursery', 'error')
    vi.advanceTimersByTime(FEED_LOST_AFTER_MS - 1000)
    expect(store.lostFeeds).toEqual([])
  })

  it('never alerts for a camera that is live', () => {
    const store = useFeedAlertsStore()
    store.report('nursery', 'live')
    vi.advanceTimersByTime(5 * FEED_LOST_AFTER_MS)
    expect(store.lostFeeds).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('forgets a camera whose tile unmounted', () => {
    const store = useFeedAlertsStore()
    store.report('nursery', 'error')
    store.report('cot', 'error')
    vi.advanceTimersByTime(FEED_LOST_AFTER_MS)

    store.forget('cot')
    expect(ids(store)).toEqual(['nursery'])
  })

  it('lists the longest outage first', () => {
    const store = useFeedAlertsStore()
    store.report('cot', 'error')
    vi.advanceTimersByTime(10_000)
    store.report('nursery', 'error')
    vi.advanceTimersByTime(FEED_LOST_AFTER_MS)
    expect(ids(store)).toEqual(['cot', 'nursery'])
  })

  describe('dismiss', () => {
    it('silences one camera and leaves the others', () => {
      const store = useFeedAlertsStore()
      store.report('nursery', 'error')
      store.report('cot', 'error')
      vi.advanceTimersByTime(FEED_LOST_AFTER_MS)

      store.dismiss('nursery')
      expect(ids(store)).toEqual(['cot'])
    })

    it('stays silent while the feed stays down, even through reconnect attempts', () => {
      const store = useFeedAlertsStore()
      store.report('nursery', 'error')
      vi.advanceTimersByTime(FEED_LOST_AFTER_MS)
      store.dismiss('nursery')

      store.report('nursery', 'connecting')
      vi.advanceTimersByTime(10 * 60_000)
      expect(store.lostFeeds).toEqual([])
    })

    it('alerts again when the feed returns and drops again', () => {
      const store = useFeedAlertsStore()
      store.report('nursery', 'error')
      vi.advanceTimersByTime(FEED_LOST_AFTER_MS)
      store.dismiss('nursery')

      store.report('nursery', 'live')
      store.report('nursery', 'error')
      vi.advanceTimersByTime(FEED_LOST_AFTER_MS)
      expect(ids(store)).toEqual(['nursery'])
    })

    it('does not pre-dismiss a feed that is not down', () => {
      const store = useFeedAlertsStore()
      store.report('nursery', 'live')
      store.dismiss('nursery')

      store.report('nursery', 'error')
      vi.advanceTimersByTime(FEED_LOST_AFTER_MS)
      expect(ids(store)).toEqual(['nursery'])
    })

    it('forgets the dismissal along with the camera', () => {
      const store = useFeedAlertsStore()
      store.report('nursery', 'error')
      vi.advanceTimersByTime(FEED_LOST_AFTER_MS)
      store.dismiss('nursery')

      store.forget('nursery')
      store.report('nursery', 'error')
      vi.advanceTimersByTime(FEED_LOST_AFTER_MS)
      expect(ids(store)).toEqual(['nursery'])
    })
  })

  describe('ticker', () => {
    it('runs only while a camera is down', () => {
      const store = useFeedAlertsStore()
      expect(vi.getTimerCount()).toBe(0)

      store.report('nursery', 'error')
      store.report('cot', 'error')
      expect(vi.getTimerCount()).toBe(1)

      store.report('nursery', 'live')
      expect(vi.getTimerCount()).toBe(1)

      store.forget('cot')
      expect(vi.getTimerCount()).toBe(0)
    })

    it('keeps running for a dismissed camera that is still down', () => {
      const store = useFeedAlertsStore()
      store.report('nursery', 'error')
      store.dismiss('nursery')
      expect(vi.getTimerCount()).toBe(1)
    })

    it('is released when the store is disposed', () => {
      const store = useFeedAlertsStore()
      store.report('nursery', 'error')
      expect(vi.getTimerCount()).toBe(1)

      store.$dispose()
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
