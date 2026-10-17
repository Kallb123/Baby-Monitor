<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'

import CameraGrid from '@/components/CameraGrid.vue'
import { useEntityStates } from '@/composables/useEntityStates'
import { audioUnlocked } from '@/lib/audio-context'
import { useConfigStore } from '@/stores/config'
import { useMonitorStore } from '@/stores/monitor'

const configStore = useConfigStore()
const monitor = useMonitorStore()
const { states, configured: haConfigured, error: statesError } = useEntityStates()

const CONFIG_RETRY_MS = 5000
let configRetry: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  if (!configStore.loaded) void configStore.load()
})

// The server may be down when a wall tablet boots; keep retrying rather than
// waiting for someone to reload the page.
watch(
  () => configStore.error,
  (error) => {
    clearTimeout(configRetry)
    if (error) configRetry = setTimeout(() => void configStore.load(), CONFIG_RETRY_MS)
  },
)

onUnmounted(() => clearTimeout(configRetry))
</script>

<template>
  <main class="monitor">
    <p v-if="configStore.error" class="notice error">
      Could not load config: {{ configStore.error }}
    </p>

    <div v-else-if="configStore.loaded && configStore.config.cameras.length === 0" class="empty">
      <h1>No cameras yet</h1>
      <p>Add your RTSP cameras to start monitoring.</p>
      <RouterLink class="button" to="/settings">Add a camera</RouterLink>
    </div>

    <CameraGrid
      v-else
      :cameras="configStore.config.cameras"
      :layout="configStore.config.layout"
      :states="states"
      :audio-camera-id="monitor.audioCameraId"
      @toggle-audio="monitor.toggleAudio"
    />

    <div class="hints">
      <p v-if="!audioUnlocked" class="notice">Tap anywhere to start the sound meters</p>
      <p v-if="!haConfigured" class="notice">Home Assistant not connected</p>
      <p v-else-if="statesError" class="notice error">Sensor data may be stale</p>
    </div>

    <RouterLink class="settings-link" to="/settings" aria-label="Settings">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          fill="currentColor"
          d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
          transform="translate(-1 0)"
        />
      </svg>
    </RouterLink>
  </main>
</template>

<style scoped>
.monitor {
  position: relative;
  height: 100%;
  padding: calc(var(--gap) + env(safe-area-inset-top)) calc(var(--gap) + env(safe-area-inset-right))
    calc(var(--gap) + env(safe-area-inset-bottom)) calc(var(--gap) + env(safe-area-inset-left));
}

.empty {
  display: grid;
  place-content: center;
  gap: 12px;
  height: 100%;
  text-align: center;
}

.hints {
  position: absolute;
  left: 50%;
  bottom: calc(var(--gap) + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  white-space: nowrap;
}

.settings-link {
  position: absolute;
  left: calc(var(--gap) + 8px + env(safe-area-inset-left));
  bottom: calc(var(--gap) + 8px + env(safe-area-inset-bottom));
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: var(--text);
  background: rgb(0 0 0 / 45%);
}
</style>
