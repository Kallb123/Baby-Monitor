/** Quietest level the meter shows, in dBFS. Anything below reads as 0. */
export const METER_FLOOR_DB = -60

/**
 * Maps time-domain samples (-1..1) to a 0..1 meter level on a dB scale, so
 * quiet sounds like whimpers still move the meter visibly.
 */
export function levelFromSamples(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sumSquares = 0
  for (const sample of samples) sumSquares += sample * sample
  const rms = Math.sqrt(sumSquares / samples.length)
  if (rms === 0) return 0
  const db = 20 * Math.log10(rms)
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB))
}

/** Fast attack, slow release, like a hardware VU meter. */
export function smoothLevel(previous: number, next: number, release = 0.9): number {
  return next >= previous ? next : Math.max(next, previous * release)
}
