export const SENSITIVITIES = ['low', 'medium', 'high'] as const

/** How easily a tile reads "Stirring": high reacts to smaller sounds. */
export type Sensitivity = (typeof SENSITIVITIES)[number]

export const DEFAULT_SENSITIVITY: Sensitivity = 'medium'

export const sensitivityLabels: Record<Sensitivity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

/** How far above the room's background noise a sound must be to count as stirring. */
const STIRRING_MARGIN_DB: Record<Sensitivity, number> = { low: 15, medium: 10, high: 6 }

/**
 * Quietest threshold per sensitivity, in dBFS. It applies in a silent room and
 * before the background is known; medium (-43, a whimper or rustle) is the
 * fixed threshold stirring used before it adapted.
 */
const STIRRING_MINIMUM_DB: Record<Sensitivity, number> = { low: -38, medium: -43, high: -48 }

/**
 * dBFS above which a tile reads "Stirring". The margin over the background
 * keeps steady noise (a white-noise machine) from counting; the minimum keeps
 * a very quiet room from triggering on its own hiss.
 */
export function stirringThresholdDb(floorDb: number | undefined, sensitivity: Sensitivity): number {
  const minimum = STIRRING_MINIMUM_DB[sensitivity]
  return floorDb === undefined
    ? minimum
    : Math.max(minimum, floorDb + STIRRING_MARGIN_DB[sensitivity])
}

/** How long "Stirring" stays up after the last loud sample, so it doesn't flicker. */
export const STIRRING_HOLD_MS = 3000

export type SoundStatus = 'crying' | 'stirring' | 'quiet' | 'no-feed'

export const soundStatusLabels: Record<SoundStatus, string> = {
  crying: 'Crying',
  stirring: 'Stirring',
  quiet: 'Quiet',
  'no-feed': 'No feed',
}

/**
 * Crying comes from Home Assistant, so it wins even when the stream is down.
 * Without a live stream the meter reads zero, which must not pass for "Quiet".
 */
export function soundStatus(input: {
  crying: boolean
  stirring: boolean
  live: boolean
}): SoundStatus {
  if (input.crying) return 'crying'
  if (!input.live) return 'no-feed'
  return input.stirring ? 'stirring' : 'quiet'
}
