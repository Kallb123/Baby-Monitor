import { onScopeDispose, ref, watch, type Ref } from 'vue'

import type { StreamQuality } from '@shared/streams.ts'
import { useElementSize } from '@/composables/useElementSize'
import { pickQuality, type StreamQualityPreference } from '@/lib/stream-quality'

/** Rotation and window resizes pass through many widths; only a settled one should reconnect. */
export const QUALITY_DEBOUNCE_MS = 2000

/**
 * Decides whether a tile plays its main or sub stream.
 *
 * `quality` stays undefined until the first decision, so the stream can wait
 * for it instead of connecting to main and being replaced at once. Settings
 * and camera changes apply immediately; size-driven changes wait for the width
 * to settle.
 */
export function useStreamQuality(
  target: Ref<HTMLElement | null | undefined>,
  options: { preference: Ref<StreamQualityPreference>; hasSub: Ref<boolean> },
) {
  const { width } = useElementSize(target)
  const quality = ref<StreamQuality>()
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancelPending() {
    clearTimeout(timer)
    timer = undefined
  }

  function apply(next: StreamQuality) {
    cancelPending()
    quality.value = next
  }

  function decide() {
    const preference = options.preference.value
    const hasSub = options.hasSub.value
    const current = quality.value ?? 'main'

    // The answer doesn't depend on size, so there is nothing to measure or wait for.
    if (!hasSub || preference !== 'auto') {
      return apply(pickQuality({ preference, hasSub, physicalWidth: 0, current }))
    }
    // Without ResizeObserver there will never be a measurement.
    if (typeof ResizeObserver === 'undefined') return apply(current)
    // Zero means not measured yet (or hidden): keep what we have, or keep waiting.
    if (width.value <= 0) return

    const next = pickQuality({
      preference,
      hasSub,
      physicalWidth: width.value * (window.devicePixelRatio || 1),
      current,
    })
    if (quality.value === undefined) return apply(next)
    cancelPending()
    if (next !== quality.value) timer = setTimeout(() => apply(next), QUALITY_DEBOUNCE_MS)
  }

  // Preference and sub-stream changes are deliberate, so they skip the debounce.
  watch([options.preference, options.hasSub], decide)
  watch(width, decide)
  decide()

  onScopeDispose(cancelPending)

  return { quality }
}
