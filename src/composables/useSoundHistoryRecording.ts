import { onScopeDispose, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

import { useSoundHistoryStore } from '@/stores/sound-history'

// The meter runs at ~15 Hz; a minute bucket only needs its loudest moment, and
// the smoothed dB readout decays slowly enough for one sample a second to catch it.
const RECORD_INTERVAL_MS = 1000

/**
 * Feeds a camera's sound level and stirring flag into this device's sound
 * history once a second. Records only while `db` is defined, i.e. the stream
 * is live and audio is unlocked, so gaps in the chart mean "not listening".
 */
export function useSoundHistoryRecording(
  cameraId: MaybeRefOrGetter<string>,
  db: Ref<number | undefined>,
  stirring: Ref<boolean>,
) {
  const store = useSoundHistoryStore()
  let timer: ReturnType<typeof setInterval> | undefined

  function stop() {
    clearInterval(timer)
    timer = undefined
  }

  watch(
    () => db.value !== undefined,
    (live) => {
      stop()
      if (!live) return
      timer = setInterval(() => {
        if (db.value !== undefined) store.record(toValue(cameraId), db.value, stirring.value)
      }, RECORD_INTERVAL_MS)
    },
    { immediate: true },
  )

  onScopeDispose(stop)
}
