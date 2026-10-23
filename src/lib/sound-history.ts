import { z } from 'zod'

import { METER_FLOOR_DB } from '@/lib/audio-level'

export const BUCKET_MS = 60_000
export const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000

/** `[minuteStartMs, peakDb, stirred]`: plain arrays keep the localStorage copy small. */
export type SoundBucket = [minuteStartMs: number, peakDb: number, stirred: 0 | 1]
/** Per-camera buckets, oldest first. */
export type SoundHistory = Record<string, SoundBucket[]>

// A day is 1440 minute buckets; the cap only bounds what a corrupt save can inflate.
const MAX_BUCKETS_PER_CAMERA = 1500

export const soundHistorySchema = z.record(
  z.string(),
  z
    .array(
      z.tuple([
        z.number().int().nonnegative(),
        z.number().finite(),
        z.union([z.literal(0), z.literal(1)]),
      ]),
    )
    .max(MAX_BUCKETS_PER_CAMERA),
)

export function bucketStart(atMs: number): number {
  return Math.floor(atMs / BUCKET_MS) * BUCKET_MS
}

/**
 * Records one sample into the camera's current minute, keeping the loudest
 * level and whether it stirred at any point. Changes `history` in place: this
 * runs once a second per camera, so copying a day of buckets each time would
 * be wasteful. Returns true when a new bucket was started.
 */
export function addSample(
  history: SoundHistory,
  cameraId: string,
  atMs: number,
  db: number,
  stirred: boolean,
): boolean {
  if (Number.isNaN(db) || !Number.isFinite(atMs)) return false
  const buckets = (history[cameraId] ??= [])
  const minute = bucketStart(atMs)
  // Digital silence is -Infinity, which JSON can't hold; the meter floor is
  // the quietest thing the chart shows anyway.
  const peak = Math.round(Math.max(db, METER_FLOOR_DB) * 10) / 10
  const last = buckets.at(-1)

  if (last && minute < last[0]) return false // the clock stepped back; keep what we have
  if (last && minute === last[0]) {
    last[1] = Math.max(last[1], peak)
    if (stirred) last[2] = 1
    return false
  }
  buckets.push([minute, peak, stirred ? 1 : 0])
  // Prune only when a bucket is added, which is once a minute rather than once a sample.
  pruneOlderThan(buckets, atMs - HISTORY_RETENTION_MS)
  return true
}

function pruneOlderThan(buckets: SoundBucket[], cutoffMs: number) {
  let drop = 0
  while (drop < buckets.length && buckets[drop]![0] + BUCKET_MS <= cutoffMs) drop++
  if (drop > 0) buckets.splice(0, drop)
}

/** Drops buckets older than 24 hours, and cameras left with none. Returns a new object. */
export function pruneHistory(history: SoundHistory, nowMs: number): SoundHistory {
  const next: SoundHistory = {}
  for (const [cameraId, buckets] of Object.entries(history)) {
    const kept = buckets.filter(([start]) => start + BUCKET_MS > nowMs - HISTORY_RETENTION_MS)
    if (kept.length > 0) next[cameraId] = kept
  }
  return next
}

/** Keeps only the cameras in `existingIds`. Returns the same object when nothing changes. */
export function pruneCameras(history: SoundHistory, existingIds: Iterable<string>): SoundHistory {
  const existing = new Set(existingIds)
  if (Object.keys(history).every((id) => existing.has(id))) return history
  return Object.fromEntries(Object.entries(history).filter(([id]) => existing.has(id)))
}

/** Buckets whose minute overlaps `[fromMs, toMs]`. */
export function bucketsInRange(
  history: SoundHistory,
  cameraId: string,
  fromMs: number,
  toMs: number,
): SoundBucket[] {
  return (history[cameraId] ?? []).filter(([start]) => start + BUCKET_MS > fromMs && start <= toMs)
}

/**
 * Cleans what came out of storage: ordered by time without duplicate minutes,
 * and within retention. A save from another build or a hand edit must not
 * break the chart.
 */
export function normalizeHistory(history: SoundHistory, nowMs: number): SoundHistory {
  const next: SoundHistory = {}
  for (const [cameraId, buckets] of Object.entries(history)) {
    const byMinute = new Map<number, SoundBucket>()
    for (const [start, peak, stirred] of buckets) {
      const minute = bucketStart(start)
      const existing = byMinute.get(minute)
      if (existing) {
        existing[1] = Math.max(existing[1], peak)
        if (stirred) existing[2] = 1
      } else {
        byMinute.set(minute, [minute, peak, stirred])
      }
    }
    next[cameraId] = [...byMinute.values()].sort((a, b) => a[0] - b[0])
  }
  return pruneHistory(next, nowMs)
}
