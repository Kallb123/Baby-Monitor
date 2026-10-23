import { onScopeDispose, watch } from 'vue'

import { createAlertScheduler, playAlertChime } from '@/lib/alert-sound'
import { useFeedAlertsStore } from '@/stores/feed-alerts'
import { useSettingsStore } from '@/stores/settings'

/** Chimes (and vibrates) for lost feeds, repeating until they are dismissed or return. */
export function useFeedAlertSound() {
  const alerts = useFeedAlertsStore()
  const settings = useSettingsStore()
  const scheduler = createAlertScheduler(playAlertChime)

  watch(
    () =>
      settings.feedLostAlerts && settings.feedLostSound
        ? alerts.lostFeeds.map((feed) => feed.cameraId)
        : [],
    (ids) => scheduler.update(ids),
    { immediate: true },
  )

  onScopeDispose(scheduler.dispose)
}
