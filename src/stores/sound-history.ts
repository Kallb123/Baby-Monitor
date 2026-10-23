import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { readStored, writeStored } from '@/lib/local-storage'
import {
  addSample,
  bucketsInRange,
  normalizeHistory,
  pruneCameras,
  soundHistorySchema,
  type SoundBucket,
  type SoundHistory,
} from '@/lib/sound-history'

export const SOUND_HISTORY_STORAGE_KEY = 'baby-monitor:sound-history'
/** Rewriting a day of buckets every second would wear flash storage on a wall tablet. */
const WRITE_INTERVAL_MS = 60_000

/**
 * Per-minute sound levels recorded by this device while a camera tile was
 * playing, kept in localStorage for the history page. Per device and off the
 * server, like the other local settings.
 */
export const useSoundHistoryStore = defineStore('sound-history', () => {
  let history: SoundHistory = normalizeHistory(
    readStored(SOUND_HISTORY_STORAGE_KEY, soundHistorySchema) ?? {},
    Date.now(),
  )
  let dirty = false
  let lastWriteAt = 0

  function flush(now = Date.now()) {
    if (!dirty) return
    dirty = false
    lastWriteAt = now
    writeStored(SOUND_HISTORY_STORAGE_KEY, history)
  }

  function record(cameraId: string, db: number, stirred: boolean, now = Date.now()) {
    addSample(history, cameraId, now, db, stirred)
    dirty = true
    if (now - lastWriteAt >= WRITE_INTERVAL_MS) flush(now)
  }

  /** Forgets the history of cameras that no longer exist. */
  function pruneDeletedCameras(existingIds: Iterable<string>) {
    const next = pruneCameras(history, existingIds)
    if (next === history) return
    history = next
    dirty = true
    flush()
  }

  /** Not reactive: the history page reads it again on its own refresh timer. */
  function bucketsFor(cameraId: string, fromMs: number, toMs: number): SoundBucket[] {
    return bucketsInRange(history, cameraId, fromMs, toMs)
  }

  // The throttled write can leave the last minute unsaved; flush it when the
  // page goes away. Mobile browsers often skip pagehide, so hiding counts too.
  const onPageHide = () => flush()
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibility)
  onScopeDispose(() => {
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { record, bucketsFor, pruneDeletedCameras, flush }
})
