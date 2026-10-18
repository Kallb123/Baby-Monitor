<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import CameraDialog from '@/components/CameraDialog.vue'
import CameraGrid from '@/components/CameraGrid.vue'
import MonitorHeader from '@/components/MonitorHeader.vue'
import { useEntityStates } from '@/composables/useEntityStates'
import { audioUnlocked } from '@/lib/audio-context'
import { MAX_CAMERAS } from '@/lib/cameras'
import { isCrying } from '@/lib/entities'
import { statusLine } from '@/lib/status-line'
import { useConfigStore } from '@/stores/config'
import { useMonitorStore } from '@/stores/monitor'
import { useSettingsStore } from '@/stores/settings'
import { referencedEntityIds } from '@shared/config.ts'

const configStore = useConfigStore()
const monitor = useMonitorStore()
const settings = useSettingsStore()
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

const cameras = computed(() => configStore.config.cameras)
const layoutMode = computed(() => monitor.layoutMode ?? configStore.config.layout.mode)
const focusCameraId = computed(
  () => monitor.focusCameraId ?? configStore.config.layout.focusCameraId,
)

/** Dialog state: `null` closed, `{}` adding, `{ cameraId }` editing. */
const dialog = ref<{ cameraId?: string } | null>(null)

const status = computed(() =>
  statusLine({
    editing: monitor.editing,
    cryingNames: cameras.value
      .filter((c) => isCrying(c.entities.cry ? states.value[c.entities.cry] : undefined))
      .map((c) => c.name),
    listeningName: cameras.value.find((c) => c.id === monitor.audioCameraId)?.name,
    audioUnlocked: audioUnlocked.value,
    hasCameras: cameras.value.length > 0,
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
  monitor.setEditing(!monitor.editing && cameras.value.length > 0)
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
      :can-edit="cameras.length > 0"
      :can-add="configStore.loaded && cameras.length < MAX_CAMERAS"
      @layout="monitor.setLayout"
      @toggle-edit="toggleEdit"
      @add="openAdd"
    />

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

      <CameraGrid
        v-else-if="configStore.loaded"
        :cameras="cameras"
        :mode="layoutMode"
        :focus-camera-id="focusCameraId"
        :states="states"
        :audio-camera-id="monitor.audioCameraId"
        :editing="monitor.editing"
        :show-decibels="settings.showDecibels"
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
