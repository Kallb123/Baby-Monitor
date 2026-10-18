/** Quietest level the meter shows, in dBFS. Anything below reads as 0. */
export const METER_FLOOR_DB = -60

/** RMS level of time-domain samples (-1..1) in dBFS. Digital silence is -Infinity. */
export function dbFromSamples(samples: Float32Array): number {
  if (samples.length === 0) return -Infinity
  let sumSquares = 0
  for (const sample of samples) sumSquares += sample * sample
  return 20 * Math.log10(Math.sqrt(sumSquares / samples.length))
}

/** Maps dBFS to a 0..1 meter level, so quiet sounds like whimpers still move the meter. */
export function levelFromDb(db: number): number {
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB))
}

export function levelFromSamples(samples: Float32Array): number {
  return levelFromDb(dbFromSamples(samples))
}

/** Fast attack, slow release, like a hardware VU meter. */
export function smoothLevel(previous: number, next: number, release = 0.9): number {
  return next >= previous ? next : Math.max(next, previous * release)
}

/** Below this a falling readout snaps to the new value, so silence reads -∞, not -900 dB. */
const DB_DECAY_FLOOR = -120

/** The same ballistics for a dB readout: rise at once, fall by `releaseDb` per sample. */
export function smoothDb(previous: number, next: number, releaseDb = 1.5): number {
  if (next >= previous) return next
  const fallen = previous - releaseDb
  return fallen < DB_DECAY_FLOOR ? next : Math.max(next, fallen)
}

/** Why a stream has no level to show, or `live` when it is being measured. */
export type AudioLevelStatus = 'idle' | 'locked' | 'no-audio' | 'live'

/**
 * Short readout for the dB display. The non-live cases are spelled out
 * because the number exists to diagnose a meter that isn't moving.
 */
export function decibelReadout(status: AudioLevelStatus, db: number | undefined): string {
  switch (status) {
    case 'live':
      if (db === undefined) return '… dB'
      return db === -Infinity ? '-∞ dB' : `${Math.round(db)} dB`
    case 'locked':
      return 'Tap for dB'
    case 'no-audio':
      return 'No audio'
    case 'idle':
      return '– dB'
  }
}
