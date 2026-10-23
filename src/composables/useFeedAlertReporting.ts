import { onScopeDispose, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

import type { StreamStatus } from '@/composables/useWebRtcStream'
import { useFeedAlertsStore } from '@/stores/feed-alerts'

/** Tells the feed-alert store how this tile's stream is doing, until it unmounts. */
export function useFeedAlertReporting(
  cameraId: MaybeRefOrGetter<string>,
  status: Ref<StreamStatus>,
) {
  const alerts = useFeedAlertsStore()

  watch(
    [() => toValue(cameraId), status],
    ([id, state], previous) => {
      const previousId = previous?.[0]
      if (previousId !== undefined && previousId !== id) alerts.forget(previousId)
      alerts.report(id, state)
    },
    { immediate: true },
  )

  // An unmounted tile (camera hidden or deleted) is not a lost feed.
  onScopeDispose(() => alerts.forget(toValue(cameraId)))
}
