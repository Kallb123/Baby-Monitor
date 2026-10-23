import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'

import type { StreamStatus } from '@/composables/useWebRtcStream'
import { findLostFeeds } from '@/lib/feed-alerts'

const TICK_MS = 1000

/** Copy of `record` without `key`, or the same object when it has no such key. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const { [key]: _removed, ...rest } = record
  return rest
}

/**
 * Which camera feeds are down and for how long. Transient: a reload starts
 * every tile as "connecting", so there is nothing worth persisting.
 */
export const useFeedAlertsStore = defineStore('feed-alerts', () => {
  /** When each camera that is not live went down. Live cameras have no entry. */
  const downSince = ref<Record<string, number>>({})
  /** Cameras whose alert was silenced until their feed returns and drops again. */
  const dismissed = ref<Record<string, true>>({})
  // Reactive clock so durations advance; it only ticks while a camera is down.
  const now = ref(Date.now())
  let ticker: ReturnType<typeof setInterval> | undefined

  function syncTicker() {
    const anyDown = Object.keys(downSince.value).length > 0
    if (anyDown && !ticker) {
      now.value = Date.now()
      ticker = setInterval(() => (now.value = Date.now()), TICK_MS)
    } else if (!anyDown && ticker) {
      clearInterval(ticker)
      ticker = undefined
    }
  }

  /** The tile is gone (camera hidden or deleted), so it must not alert. */
  function forget(cameraId: string) {
    dismissed.value = without(dismissed.value, cameraId)
    downSince.value = without(downSince.value, cameraId)
    syncTicker()
  }

  /** Called by every tile with its stream's current status. */
  function report(cameraId: string, status: StreamStatus) {
    if (status === 'live') {
      forget(cameraId)
      return
    }
    // Flipping between connecting and error is still the same outage.
    if (cameraId in downSince.value) return
    downSince.value = { ...downSince.value, [cameraId]: Date.now() }
    syncTicker()
  }

  function dismiss(cameraId: string) {
    if (cameraId in downSince.value) dismissed.value = { ...dismissed.value, [cameraId]: true }
  }

  /** Lost feeds that have not been dismissed, longest outage first. */
  const lostFeeds = computed(() =>
    findLostFeeds(downSince.value, now.value).filter((feed) => !(feed.cameraId in dismissed.value)),
  )

  onScopeDispose(() => {
    clearInterval(ticker)
    ticker = undefined
  })

  return { lostFeeds, report, forget, dismiss }
})
