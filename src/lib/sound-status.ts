/**
 * Meter level (0..1 on the dB scale from `levelFromSamples`) above which a
 * tile reads "Stirring". About -43 dBFS: a whimper or rustle, not room tone.
 */
export const STIRRING_LEVEL = 0.28

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
