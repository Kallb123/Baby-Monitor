<script setup lang="ts">
import { computed } from 'vue'

import { useFeedAlertSound } from '@/composables/useFeedAlertSound'
import { formatDownDuration } from '@/lib/feed-alerts'
import { useConfigStore } from '@/stores/config'
import { useFeedAlertsStore } from '@/stores/feed-alerts'
import { useSettingsStore } from '@/stores/settings'
import AppIcon from './AppIcon.vue'

const alerts = useFeedAlertsStore()
const settings = useSettingsStore()
const configStore = useConfigStore()
useFeedAlertSound()

const feeds = computed(() => {
  if (!settings.feedLostAlerts) return []
  const names = new Map(configStore.config.cameras.map((c) => [c.id, c.name]))
  return alerts.lostFeeds.map((feed) => ({
    id: feed.cameraId,
    name: names.get(feed.cameraId) ?? feed.cameraId,
    duration: formatDownDuration(feed.downForMs),
  }))
})
</script>

<template>
  <!-- In the page flow, between the header and the grid, so it never covers header controls. -->
  <div v-if="feeds.length > 0" class="feed-alerts" role="alert">
    <div v-for="feed in feeds" :key="feed.id" class="feed">
      <AppIcon name="triangle-alert" :size="20" class="icon" />
      <span class="message">{{ feed.name }} feed lost · {{ feed.duration }}</span>
      <button
        type="button"
        class="dismiss"
        :aria-label="`Dismiss alert for ${feed.name}`"
        @click="alerts.dismiss(feed.id)"
      >
        Dismiss
      </button>
    </div>
  </div>
</template>

<style scoped>
.feed-alerts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: none;
  /* Landscape phones are short: scroll the list rather than squeeze the grid away. */
  max-height: 40dvh;
  overflow-y: auto;
  margin: 4px calc(20px + env(safe-area-inset-right)) 0 calc(20px + env(safe-area-inset-left));
  animation: alert-in 200ms ease-out;
}

.feed {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 6px 6px 18px;
  border: 1px solid var(--color-accent-600);
  border-radius: var(--radius-pill);
  background: var(--color-accent-900);
  color: var(--color-accent-200);
}

.icon {
  flex: none;
  color: var(--color-accent-400);
}

.message {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.dismiss {
  flex: none;
  height: 44px;
  padding: 0 20px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  color: var(--color-bg);
  font-family: var(--font-heading);
  font-size: 15px;
}

.dismiss:hover {
  background: var(--color-accent-500);
}

.dismiss:active {
  background: var(--color-accent-400);
}

@keyframes alert-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
}

@media (max-width: 480px) {
  .feed {
    padding-left: 14px;
    gap: 8px;
  }

  .message {
    font-size: 15px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .feed-alerts {
    animation: none;
  }
}
</style>
