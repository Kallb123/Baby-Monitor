<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import CameraDialog from '@/components/CameraDialog.vue'
import CameraGrid from '@/components/CameraGrid.vue'
import FeedAlertBanner from '@/components/FeedAlertBanner.vue'
import MonitorHeader from '@/components/MonitorHeader.vue'
import { useDeviceBattery } from '@/composables/useDeviceBattery'
import { useEntityStates } from '@/composables/useEntityStates'
import { audioUnlocked } from '@/lib/audio-context'
import { homeAssistantBattery } from '@/lib/battery'
import { MAX_CAMERAS, visibleCameras } from '@/lib/cameras'
import { isCrying } from '@/lib/entities'
import { statusLine } from '@/lib/status-line'
import { useConfigStore } from '@/stores/config'
import { useMonitorStore } from '@/stores/monitor'
import { useSettingsStore } from '@/stores/settings'
import { useSoundHistoryStore } from '@/stores/sound-history'
import { referencedEntityIds } from '@shared/config.ts'

const configStore = useConfigStore()
const monitor = useMonitorStore()
const settings = useSettingsStore()
const soundHistory = useSoundHistoryStore()
const { states, configured: haConfigured, error: statesError } = useEntityStates()
const { reading: deviceBattery } = useDeviceBattery()

// The browser's own reading wins: the sensor is for browsers that can't read
// the battery (no HTTPS, Safari, Firefox).
const battery = computed(() => {
  if (deviceBattery.value) return deviceBattery.value
  const entityId = settings.batteryEntityId
  return entityId ? homeAssistantBattery(states.value[entityId]) : undefined
})

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

/** Every configured camera, including ones this device hides. */
const cameras = computed(() => configStore.config.cameras)
/** What the grid shows. Hidden cameras get no tile, so no stream is opened for them. */
const visible = computed(() => visibleCameras(cameras.value, settings.hiddenCameraIds))
const allHidden = computed(() => cameras.value.length > 0 && visible.value.length === 0)
const layoutMode = computed(() => monitor.layoutMode ?? configStore.config.layout.mode)
const focusCameraId = computed(
  () => monitor.focusCameraId ?? configStore.config.layout.focusCameraId,
)

// Hiding the camera that is playing must stop its audio, as deleting it does;
// otherwise it would start again by itself when the camera is shown again.
// A hidden focus camera needs no handling: the grid falls back to the first
// visible one and the saved choice returns when the camera does.
watch(visible, (now) => {
  if (monitor.audioCameraId && !now.some((c) => c.id === monitor.audioCameraId)) monitor.stopAudio()
  if (now.length === 0) monitor.setEditing(false)
})

// Forget per-camera settings of deleted cameras, but only once the real config is in:
// the empty default must not wipe the list.
watch(
  () => configStore.loaded && cameras.value.map((c) => c.id),
  (ids) => {
    if (!ids) return
    settings.pruneHiddenCameras(ids)
    settings.pruneStirringSensitivity(ids)
    soundHistory.pruneDeletedCameras(ids)
  },
  { immediate: true },
)

/** Dialog state: `null` closed, `{}` adding, `{ cameraId }` editing. */
const dialog = ref<{ cameraId?: string } | null>(null)

const status = computed(() =>
  statusLine({
    editing: monitor.editing,
    cryingNames: visible.value
      .filter((c) => isCrying(c.entities.cry ? states.value[c.entities.cry] : undefined))
      .map((c) => c.name),
    listeningName: visible.value.find((c) => c.id === monitor.audioCameraId)?.name,
    audioUnlocked: audioUnlocked.value,
    hasCameras: visible.value.length > 0,
    allHidden: allHidden.value,
  }),
)

// Only worth flagging when some camera actually uses Home Assistant data.
const notice = computed(() => {
  if (referencedEntityIds(configStore.config).length === 0) return undefined
  if (!haConfigured.value) return 'Home Assistant not connected'
  if (statesError.value) return 'Sensor data may be stale'
  return undefined
})

function onAudio(cameraId: string, on: boolean) {
  monitor.setAudio(cameraId, on)
  monitor.focus(cameraId)
}

function toggleEdit() {
  monitor.setEditing(!monitor.editing && visible.value.length > 0)
}

function openAdd() {
  if (cameras.value.length < MAX_CAMERAS) dialog.value = {}
}
</script>

<template>
  <div class="monitor">
    <MonitorHeader
      :status="status"
      :notice="notice"
      :layout-mode="layoutMode"
      :editing="monitor.editing"
      :can-edit="visible.length > 0"
      :can-add="configStore.loaded && cameras.length < MAX_CAMERAS"
      :battery="battery"
      :battery-display="settings.batteryDisplay"
      @layout="monitor.setLayout"
      @toggle-edit="toggleEdit"
      @add="openAdd"
    />

    <FeedAlertBanner />

    <main class="content">
      <div v-if="configStore.error && !configStore.loaded" class="card" role="alert">
        <h2 class="card-title">Can't reach the monitor</h2>
        <p class="card-body">{{ configStore.error }}. Trying again in a few seconds.</p>
      </div>

      <div v-else-if="configStore.loaded && cameras.length === 0" class="card">
        <h2 class="card-title">No cameras yet</h2>
        <p class="card-body">Add a camera to start watching. You can connect up to four.</p>
        <button type="button" class="btn btn-primary card-action" @click="openAdd">
          Add camera
        </button>
      </div>

      <div v-else-if="configStore.loaded && allHidden" class="card">
        <h2 class="card-title">All cameras are hidden</h2>
        <p class="card-body">
          This device is set to hide every camera. Choose which to show in Settings.
        </p>
        <RouterLink to="/settings" class="btn btn-primary card-action">Open settings</RouterLink>
      </div>

      <CameraGrid
        v-else-if="configStore.loaded"
        :cameras="visible"
        :mode="layoutMode"
        :focus-camera-id="focusCameraId"
        :states="states"
        :audio-camera-id="monitor.audioCameraId"
        :editing="monitor.editing"
        :show-decibels="settings.showDecibels"
        :show-stream-details="settings.showStreamDetails"
        :stirring-sensitivity="settings.stirringSensitivity"
        :stream-quality="settings.streamQuality"
        @audio="onAudio"
        @edit="(cameraId) => (dialog = { cameraId })"
      />
    </main>

    <CameraDialog v-if="dialog" :camera-id="dialog.cameraId" @close="dialog = null" />
  </div>
</template>

<style scoped>
.monitor {
  display: flex;
  flex-direction: column;
  height: 100%;
  user-select: none;
}

.content {
  flex: 1;
  min-height: 0;
  display: grid;
  padding: 12px calc(20px + env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom))
    calc(20px + env(safe-area-inset-left));
}

.card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 16px;
  padding: 40px;
  border-radius: var(--radius-card);
  background: var(--color-tile);
}

.card-title {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 28px;
  font-weight: 400;
}

.card-body {
  margin: 0;
  max-width: 420px;
  font-size: 16px;
  color: var(--color-text-muted);
}

.card-action {
  height: 52px;
  padding: 0 24px;
  font-size: 16px;
}
</style>
