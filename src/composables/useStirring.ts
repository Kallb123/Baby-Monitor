import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

import { createNoiseFloor } from '@/lib/noise-floor'
import { STIRRING_HOLD_MS, stirringThresholdDb, type Sensitivity } from '@/lib/sound-status'

/**
 * True while the level is above the stirring threshold, held briefly after it
 * drops. The threshold sits a margin above the room's learned background, so
 * steady noise doesn't count. `db` is the smoothed dBFS from `useAudioLevel`.
 */
export function useStirring(
  db: Ref<number | undefined>,
  sensitivity: MaybeRefOrGetter<Sensitivity>,
) {
  const stirring = ref(false)
  /** Learned background level in dBFS; undefined during the first seconds. */
  const floorDb = ref<number>()
  const thresholdDb = computed(() => stirringThresholdDb(floorDb.value, toValue(sensitivity)))
  const noise = createNoiseFloor()
  let release: ReturnType<typeof setTimeout> | undefined

  watch(db, (value) => {
    // Undefined means nothing is being measured, which says nothing about the room.
    if (value === undefined) return
    const now = Date.now()
    noise.add(value, now)
    floorDb.value = noise.floor(now)
    if (value < thresholdDb.value) return
    stirring.value = true
    clearTimeout(release)
    release = setTimeout(() => (stirring.value = false), STIRRING_HOLD_MS)
  })

  /**
   * Starts learning the background again. Main and sub streams of one camera
   * can differ in gain, so levels measured on one say nothing about the other.
   */
  function reset() {
    noise.reset()
    floorDb.value = undefined
  }

  onScopeDispose(() => clearTimeout(release))

  return { stirring, floorDb, thresholdDb, reset }
}
