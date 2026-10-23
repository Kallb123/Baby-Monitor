/**
 * How long a feed must stay down before it counts as lost. Long enough that
 * the stream's own reconnect (and a brief network blip) fixes it silently.
 */
export const FEED_LOST_AFTER_MS = 30_000

export interface LostFeed {
  cameraId: string
  /** How long the feed has been down, in ms. */
  downForMs: number
}

/**
 * Cameras that have been down for at least FEED_LOST_AFTER_MS, longest first.
 * `downSince` holds a timestamp for every camera that is not live, including
 * one that never connected since its tile mounted.
 */
export function findLostFeeds(
  downSince: Readonly<Record<string, number>>,
  now: number,
): LostFeed[] {
  return Object.entries(downSince)
    .map(([cameraId, since]) => ({ cameraId, downForMs: Math.max(0, now - since) }))
    .filter((feed) => feed.downForMs >= FEED_LOST_AFTER_MS)
    .sort((a, b) => b.downForMs - a.downForMs)
}

/** "45 s" under a minute, then "3 min", then "1 h 5 min". */
export function formatDownDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}
