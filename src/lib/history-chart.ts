import type { CryInterval } from '@shared/api.ts'
import { METER_FLOOR_DB } from '@/lib/audio-level'
import { BUCKET_MS, type SoundBucket } from '@/lib/sound-history'

export const RANGE_HOURS = [6, 12, 24] as const
export type RangeHours = (typeof RANGE_HOURS)[number]

export interface Point {
  x: number
  y: number
}

/** Maps a value linearly from one range onto another. */
export function scale(
  value: number,
  [fromMin, fromMax]: readonly [number, number],
  [toMin, toMax]: readonly [number, number],
): number {
  return toMin + ((value - fromMin) / (fromMax - fromMin)) * (toMax - toMin)
}

/** dBFS to a y position: the meter floor sits on the bottom edge, 0 dBFS on the top. */
export function dbToY(db: number, top: number, height: number): number {
  const clamped = Math.min(0, Math.max(METER_FLOOR_DB, db))
  return scale(clamped, [METER_FLOOR_DB, 0], [top + height, top])
}

/** Hours between labelled ticks, so every range gets about six labels. */
export function tickStepHours(rangeHours: number): number {
  return rangeHours <= 6 ? 1 : rangeHours <= 12 ? 2 : 4
}

/**
 * Times of the local clock hours that are multiples of the step, inside the
 * range. Stepping by calendar hours (not 3 600 000 ms) keeps labels on the
 * hour across a daylight-saving change.
 */
export function hourTicks(fromMs: number, toMs: number, stepHours: number): number[] {
  const tick = new Date(fromMs)
  tick.setMinutes(0, 0, 0)
  while (tick.getHours() % stepHours !== 0 || tick.getTime() < fromMs) {
    tick.setHours(tick.getHours() + 1)
  }
  const ticks: number[] = []
  for (; tick.getTime() <= toMs; tick.setHours(tick.getHours() + stepHours)) {
    ticks.push(tick.getTime())
  }
  return ticks
}

/**
 * Runs of consecutive minutes as point lists. A missing minute ends the run,
 * so a stretch where nothing was recorded stays empty instead of being drawn
 * as a line through it. A lone minute becomes a short flat stroke so it shows.
 */
export function soundSegments(
  buckets: readonly SoundBucket[],
  x: (ms: number) => number,
  y: (db: number) => number,
  minimumWidth = 2,
): Point[][] {
  const segments: Point[][] = []
  let run: SoundBucket[] = []
  const finish = () => {
    if (run.length === 0) return
    const points = run.map(([start, peak]) => ({ x: x(start + BUCKET_MS / 2), y: y(peak) }))
    if (points.length === 1) {
      const only = points[0]!
      points[0] = { x: only.x - minimumWidth / 2, y: only.y }
      points.push({ x: only.x + minimumWidth / 2, y: only.y })
    }
    segments.push(points)
    run = []
  }
  for (const bucket of buckets) {
    const previous = run.at(-1)
    if (previous && bucket[0] - previous[0] !== BUCKET_MS) finish()
    run.push(bucket)
  }
  finish()
  return segments
}

const round = (n: number) => Math.round(n * 10) / 10

export function linePath(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ')
}

/** The line closed down to `baseline`, for the soft fill under it. */
export function areaPath(points: readonly Point[], baseline: number): string {
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last) return ''
  return `${linePath(points)} L${round(last.x)} ${baseline} L${round(first.x)} ${baseline} Z`
}

export interface CryBand {
  startMs: number
  endMs: number
}

/** Crying intervals clipped to the chart range; an open one runs to `nowMs`. */
export function cryBands(
  intervals: readonly CryInterval[],
  fromMs: number,
  toMs: number,
  nowMs: number,
): CryBand[] {
  const bands: CryBand[] = []
  for (const interval of intervals) {
    const start = Date.parse(interval.start)
    const end = interval.end ? Date.parse(interval.end) : nowMs
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    const startMs = Math.max(start, fromMs)
    const endMs = Math.min(end, toMs)
    if (endMs >= startMs && end >= fromMs && start <= toMs) bands.push({ startMs, endMs })
  }
  return bands
}

/** The bucket closest to `ms`, if one lies within `toleranceMs` of it. */
export function nearestBucket(
  buckets: readonly SoundBucket[],
  ms: number,
  toleranceMs: number,
): SoundBucket | undefined {
  let best: SoundBucket | undefined
  let bestDistance = Infinity
  for (const bucket of buckets) {
    const distance = Math.abs(bucket[0] + BUCKET_MS / 2 - ms)
    if (distance < bestDistance) {
      best = bucket
      bestDistance = distance
    }
  }
  return best && bestDistance <= toleranceMs + BUCKET_MS / 2 ? best : undefined
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return rest === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${rest} min`
}

/** Local time of day in the viewer's own format. */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatHour(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric' })
}

export interface CryEpisode {
  startMs: number
  /** Absent while still crying. */
  endMs?: number
  /** e.g. `02:14–02:21 · 7 min`, or `since 09:50 · still crying`. */
  label: string
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

/** Crying episodes, newest first, worded for the text list under the chart. */
export function cryEpisodes(
  intervals: readonly CryInterval[],
  nowMs: number,
  formatTime: (ms: number) => string = formatClock,
): CryEpisode[] {
  const now = new Date(nowMs)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const weekday = (date: Date) => `${date.toLocaleDateString([], { weekday: 'short' })} `
  const episodes: CryEpisode[] = []
  for (const interval of intervals) {
    const startMs = Date.parse(interval.start)
    const endMs = interval.end ? Date.parse(interval.end) : undefined
    if (Number.isNaN(startMs) || (endMs !== undefined && Number.isNaN(endMs))) continue

    const start = new Date(startMs)
    // A 24 h range reaches into yesterday, where a bare clock time would be ambiguous.
    const day = sameDay(start, now) ? '' : sameDay(start, yesterday) ? 'Yesterday ' : weekday(start)
    const label =
      endMs === undefined
        ? `${day}since ${formatTime(startMs)} · still crying`
        : `${day}${formatTime(startMs)}–${formatTime(endMs)} · ${formatDuration(endMs - startMs)}`
    episodes.push({ startMs, endMs, label })
  }
  return episodes.sort((a, b) => b.startMs - a.startMs)
}

/** Minutes of `buckets` flagged as stirring, for the chart's text summary. */
export function stirredMinutes(buckets: readonly SoundBucket[]): number {
  return buckets.reduce((count, bucket) => count + bucket[2], 0)
}
