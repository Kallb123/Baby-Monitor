import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'

import type { StreamQuality } from '@shared/streams.ts'
import { useElementSize } from '@/composables/useElementSize'
import {
  nextSubHealth,
  pickQuality,
  type StreamOutcome,
  type StreamQualityPreference,
} from '@/lib/stream-quality'

/** Rotation and window resizes pass through many widths; only a settled one should reconnect. */
export const QUALITY_DEBOUNCE_MS = 2000

/**
 * Decides whether a tile plays its main or sub stream.
 *
 * `quality` stays undefined until the first decision, so the stream can wait
 * for it instead of connecting to main and being replaced at once. Settings
 * and camera changes apply immediately; size-driven changes wait for the width
 * to settle.
 *
 * A sub-stream that keeps failing, or connects without audio, is given up on:
 * `quality` becomes main until the sub-stream address or the preference changes
 * (or the page reloads). The stream reports each attempt through `reportOutcome`.
 */
export function useStreamQuality(
  target: Ref<HTMLElement | null | undefined>,
  options: { preference: Ref<StreamQualityPreference>; subRtspUrl: Ref<string | undefined> },
) {
  const { width } = useElementSize(target)
  const chosen = ref<StreamQuality>()
  const fellBack = ref(false)
  const hasSub = computed(() => Boolean(options.subRtspUrl.value))
  /** What is played: the size/preference choice, except sub once it proved unusable. */
  const quality = computed(() => (chosen.value === 'sub' && fellBack.value ? 'main' : chosen.value))
  let subFailures = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancelPending() {
    clearTimeout(timer)
    timer = undefined
  }

  function apply(next: StreamQuality) {
    cancelPending()
    chosen.value = next
  }

  function decide() {
    const preference = options.preference.value
    const current = chosen.value ?? 'main'

    // The answer doesn't depend on size, so there is nothing to measure or wait for.
    if (!hasSub.value || preference !== 'auto') {
      return apply(pickQuality({ preference, hasSub: hasSub.value, physicalWidth: 0, current }))
    }
    // Without ResizeObserver there will never be a measurement.
    if (typeof ResizeObserver === 'undefined') return apply(current)
    // Zero means not measured yet (or hidden): keep what we have, or keep waiting.
    if (width.value <= 0) return

    const next = pickQuality({
      preference,
      hasSub: hasSub.value,
      physicalWidth: width.value * (window.devicePixelRatio || 1),
      current,
    })
    if (chosen.value === undefined) return apply(next)
    cancelPending()
    if (next !== chosen.value) timer = setTimeout(() => apply(next), QUALITY_DEBOUNCE_MS)
  }

  function reportOutcome({ quality: attempted, result }: StreamOutcome) {
    if (attempted !== 'sub' || !hasSub.value) return
    const health = nextSubHealth(subFailures, result)
    subFailures = health.failures
    if (health.fallBack) fellBack.value = true
  }

  // Preference and sub-stream changes are deliberate, so they skip the debounce
  // and give a sub-stream that failed before another chance.
  watch([options.preference, options.subRtspUrl], () => {
    fellBack.value = false
    subFailures = 0
    decide()
  })
  watch(width, decide)
  decide()

  onScopeDispose(cancelPending)

  return { quality, fellBack, reportOutcome }
}
