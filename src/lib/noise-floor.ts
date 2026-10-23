/** Seconds of history the floor is taken over. */
export const NOISE_WINDOW_SECONDS = 120

/** Seconds that must have data before a floor is reported, so a cold start can't mislead. */
export const NOISE_MIN_SECONDS = 15

/** Share of the window's seconds that may sit below the floor. */
export const NOISE_PERCENTILE = 0.1

/** Digital silence is -Infinity; clamping keeps it a usable number. */
export const NOISE_CLAMP_DB = -100

/**
 * Tracks a room's background level: the 10th percentile of the last two
 * minutes, one value per second (that second's quietest sample).
 *
 * A low percentile on purpose. A crying baby pauses to breathe, so even a long
 * bout leaves quiet seconds and the floor stays at the room's background. A
 * white-noise machine switched on fills the whole window instead, so the floor
 * rises to it within a couple of minutes and steady noise stops reading as
 * stirring. Time is passed in so tests don't need real clocks.
 */
export function createNoiseFloor() {
  // Ring buffer of per-second minimums. A slot belongs to the window only
  // while its second is inside it, so old data expires without any cleanup.
  const seconds = Array.from<number>({ length: NOISE_WINDOW_SECONDS }).fill(NaN)
  const minimums = Array.from<number>({ length: NOISE_WINDOW_SECONDS }).fill(NaN)

  // Sorting 120 values per call is cheap, but samples arrive at ~15 Hz per
  // tile, so reuse the answer until the data or the window moves.
  let dirty = true
  let cachedSecond = NaN
  let cachedFloor: number | undefined

  function add(db: number, nowMs: number) {
    if (Number.isNaN(db)) return
    const value = Math.max(NOISE_CLAMP_DB, db)
    const second = Math.floor(nowMs / 1000)
    const slot = ((second % NOISE_WINDOW_SECONDS) + NOISE_WINDOW_SECONDS) % NOISE_WINDOW_SECONDS
    if (seconds[slot] !== second) {
      seconds[slot] = second
      minimums[slot] = value
      dirty = true
    } else if (value < (minimums[slot] ?? Infinity)) {
      minimums[slot] = value
      dirty = true
    }
  }

  /** The background level in dBFS, or undefined while there is too little data. */
  function floor(nowMs: number): number | undefined {
    const now = Math.floor(nowMs / 1000)
    if (!dirty && cachedSecond === now) return cachedFloor

    const values: number[] = []
    for (let slot = 0; slot < NOISE_WINDOW_SECONDS; slot++) {
      const second = seconds[slot] ?? NaN
      const minimum = minimums[slot]
      if (minimum !== undefined && second > now - NOISE_WINDOW_SECONDS && second <= now) {
        values.push(minimum)
      }
    }
    dirty = false
    cachedSecond = now
    cachedFloor =
      values.length < NOISE_MIN_SECONDS ? undefined : percentile(values, NOISE_PERCENTILE)
    return cachedFloor
  }

  /** Forgets everything, e.g. when the stream's gain changes and old samples no longer compare. */
  function reset() {
    seconds.fill(NaN)
    minimums.fill(NaN)
    dirty = true
  }

  return { add, floor, reset }
}

/** Linear-interpolated percentile (0..1) of a non-empty list. */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const position = p * (sorted.length - 1)
  const lower = Math.floor(position)
  const low = sorted[lower] ?? NaN
  const high = sorted[lower + 1] ?? low
  return low + (high - low) * (position - lower)
}

/** Compact tile text for the learned background, or undefined before it is known. */
export function backgroundReadout(floorDb: number | undefined): string | undefined {
  return floorDb === undefined ? undefined : `bg ${Math.round(floorDb)}`
}
