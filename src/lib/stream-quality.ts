import type { StreamQuality } from '@shared/streams.ts'

export const streamQualityPreferences = ['auto', 'main', 'sub'] as const

export type StreamQualityPreference = (typeof streamQualityPreferences)[number]

/** Below this physical tile width (CSS px × device pixel ratio) the sub-stream is enough. */
export const SUB_BELOW_PHYSICAL_PX = 960
/** Above this the main stream is worth its decode cost. In between, nothing changes. */
export const MAIN_ABOVE_PHYSICAL_PX = 1280

export interface PickQualityInput {
  preference: StreamQualityPreference
  /** True when the camera has a sub-stream address. */
  hasSub: boolean
  /** Tile width in physical pixels. */
  physicalWidth: number
  /** The quality currently playing, kept while the width is between the thresholds. */
  current: StreamQuality
}

/**
 * Chooses which stream a tile plays. The gap between the two thresholds is
 * hysteresis: a tile resting near a boundary (or rotating through it) keeps
 * its current stream instead of reconnecting back and forth.
 */
export function pickQuality({
  preference,
  hasSub,
  physicalWidth,
  current,
}: PickQualityInput): StreamQuality {
  if (!hasSub || preference === 'main') return 'main'
  if (preference === 'sub') return 'sub'
  if (physicalWidth < SUB_BELOW_PHYSICAL_PX) return 'sub'
  if (physicalWidth > MAIN_ABOVE_PHYSICAL_PX) return 'main'
  return current
}

/** How a connection attempt for one stream ended. */
export type StreamResult = 'connected' | 'failed' | 'no-audio'

export interface StreamOutcome {
  quality: StreamQuality
  result: StreamResult
}

/** Failed sub-stream attempts in a row before the tile plays main instead. */
export const SUB_FAILURES_BEFORE_MAIN = 3

export interface SubHealth {
  /** Consecutive failed attempts, to carry into the next call. */
  failures: number
  /** True when the tile should stop trying the sub-stream and play main. */
  fallBack: boolean
}

/**
 * Folds one sub-stream attempt into the failure streak. A sub-stream that
 * connects without an audio track falls back at once, without waiting for
 * failures: the main stream is assumed to carry the audio, and a nursery
 * monitor without sound is worse than one that decodes a larger picture.
 */
export function nextSubHealth(failures: number, result: StreamResult): SubHealth {
  if (result === 'connected') return { failures: 0, fallBack: false }
  if (result === 'no-audio') return { failures: 0, fallBack: true }
  const streak = failures + 1
  return { failures: streak, fallBack: streak >= SUB_FAILURES_BEFORE_MAIN }
}
