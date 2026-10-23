<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { z } from 'zod'

import AppIcon from '@/components/AppIcon.vue'
import SoundTimeline from '@/components/SoundTimeline.vue'
import { useCryHistory } from '@/composables/useCryHistory'
import { visibleCameras } from '@/lib/cameras'
import { cryEpisodes, RANGE_HOURS, stirredMinutes, type RangeHours } from '@/lib/history-chart'
import { readStored, writeStored } from '@/lib/local-storage'
import { useConfigStore } from '@/stores/config'
import { useSettingsStore } from '@/stores/settings'
import { useSoundHistoryStore } from '@/stores/sound-history'

const RANGE_STORAGE_KEY = 'baby-monitor:history-range'
const rangeSchema = z.union([z.literal(6), z.literal(12), z.literal(24)])
const REFRESH_MS = 60_000

const configStore = useConfigStore()
const settings = useSettingsStore()
const soundHistory = useSoundHistoryStore()

// This page can be the first one opened (a reload on /history), before the
// monitor has loaded the camera list.
onMounted(() => {
  if (!configStore.loaded) void configStore.load()
})

const hours = ref<RangeHours>(readStored(RANGE_STORAGE_KEY, rangeSchema) ?? 12)
watch(hours, (value) => writeStored(RANGE_STORAGE_KEY, value))

const { data: cryData, error: cryError } = useCryHistory(hours, REFRESH_MS)

// The sound history lives in this browser and is not reactive, so the chart
// window and its buckets are re-read on the same cadence as the HA data.
const now = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), REFRESH_MS)
onScopeDispose(() => clearInterval(clock))
watch(cryData, () => (now.value = Date.now()))

const fromMs = computed(() => now.value - hours.value * 3_600_000)
const visible = computed(() => visibleCameras(configStore.config.cameras, settings.hiddenCameraIds))
const ready = computed(() => configStore.loaded)

function cryStatus(cameraId: string) {
  const data = cryData.value
  if (!data) {
    return cryError.value ? { kind: 'error' as const } : { kind: 'loading' as const }
  }
  if (!data.configured) return { kind: 'unconfigured' as const }
  const entry = data.cameras[cameraId]
  if (!entry) return { kind: 'no-sensor' as const }
  return { kind: 'ok' as const, intervals: entry.cry }
}

const cards = computed(() =>
  visible.value.map((camera) => {
    const buckets = soundHistory.bucketsFor(camera.id, fromMs.value, now.value)
    const status = cryStatus(camera.id)
    const intervals = status.kind === 'ok' ? status.intervals : undefined
    const episodes = intervals ? cryEpisodes(intervals, now.value) : []
    const summary = [
      `${camera.name}: sound level and crying over the last ${hours.value} hours.`,
      buckets.length === 0
        ? 'No sound recorded on this device.'
        : `${buckets.length} minutes of sound recorded on this device, ${stirredMinutes(buckets)} with stirring.`,
      intervals
        ? `${episodes.length} crying ${episodes.length === 1 ? 'episode' : 'episodes'}.`
        : '',
      'The list below has the details.',
    ]
      .filter(Boolean)
      .join(' ')
    return { camera, buckets, status, intervals, episodes, summary }
  }),
)

const statusMessages = {
  loading: 'Loading crying history…',
  error: "Can't load the crying history from Home Assistant right now. Trying again soon.",
  unconfigured: "Home Assistant isn't connected, so crying isn't shown.",
  'no-sensor': 'No crying sensor is set for this camera, so crying isn’t shown.',
} as const
</script>

<template>
  <div class="history">
    <header class="history-header">
      <RouterLink to="/" class="back-btn" aria-label="Back to monitor" title="Back to monitor">
        <AppIcon name="arrow-left" :size="22" />
      </RouterLink>
      <h1 class="title">History</h1>
    </header>

    <main class="content">
      <div class="toolbar">
        <div class="ranges" role="group" aria-label="Time range">
          <button
            v-for="option in RANGE_HOURS"
            :key="option"
            type="button"
            class="range-btn"
            :class="{ active: hours === option }"
            :aria-pressed="hours === option"
            @click="hours = option"
          >
            {{ option }} h
          </button>
        </div>
      </div>

      <div v-if="configStore.error && !ready" class="card" role="alert">
        <h2 class="card-title">Can't reach the monitor</h2>
        <p class="note">{{ configStore.error }}</p>
      </div>
      <p v-else-if="!ready" class="empty">Loading cameras…</p>
      <div v-else-if="configStore.config.cameras.length === 0" class="card">
        <h2 class="card-title">No cameras yet</h2>
        <p class="note">Add a camera on the monitor to start recording its history.</p>
      </div>
      <div v-else-if="visible.length === 0" class="card">
        <h2 class="card-title">All cameras are hidden</h2>
        <p class="note">
          This device is set to hide every camera. Choose which to show in
          <RouterLink to="/settings" class="link">Settings</RouterLink>.
        </p>
      </div>

      <div v-else class="cards">
        <section
          v-for="card in cards"
          :key="card.camera.id"
          class="card"
          :aria-labelledby="`history-${card.camera.id}`"
        >
          <h2 :id="`history-${card.camera.id}`" class="card-title">{{ card.camera.name }}</h2>

          <ul class="legend">
            <li><span class="key key-line" aria-hidden="true" />Peak sound, dBFS</li>
            <li><span class="key key-stir" aria-hidden="true" />Stirring</li>
            <li><span class="key key-cry" aria-hidden="true" />Crying</li>
          </ul>

          <SoundTimeline
            :from-ms="fromMs"
            :to-ms="now"
            :buckets="card.buckets"
            :cry="card.intervals"
            :label="card.summary"
          />

          <p class="note">
            Sound history is recorded on this device only, while the app is open on the monitor.
            Blank stretches mean nothing was recorded.
          </p>

          <h3 class="list-title">Crying</h3>
          <ul v-if="card.status.kind === 'ok' && card.episodes.length > 0" class="episodes">
            <li v-for="episode in card.episodes" :key="episode.startMs">
              {{ episode.label }}
            </li>
          </ul>
          <p v-else-if="card.status.kind === 'ok'" class="note">
            No crying in the last {{ hours }} hours.
          </p>
          <p v-else class="note" :role="card.status.kind === 'error' ? 'alert' : undefined">
            {{ statusMessages[card.status.kind] }}
          </p>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.history {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.history-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: calc(14px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right)) 6px
    calc(20px + env(safe-area-inset-left));
}

.back-btn {
  display: grid;
  place-items: center;
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  color: var(--color-text);
}

.back-btn:hover {
  filter: brightness(1.12);
}

.title {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 24px;
  font-weight: 400;
  color: var(--color-text);
}

.content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1120px;
  margin: 0 auto;
  padding: 12px calc(20px + env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom))
    calc(20px + env(safe-area-inset-left));
}

.toolbar {
  display: flex;
}

.ranges {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
}

.range-btn {
  min-width: 64px;
  height: 44px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-heading);
  font-size: 15px;
}

.range-btn:not(.active):hover {
  background: rgb(238 231 219 / 7%);
}

.range-btn.active {
  background: var(--color-neutral-200);
  color: var(--color-ink);
}

/* One column on phones and portrait tablets; two once a card has room for a wide chart. */
.cards {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

@media (min-width: 1000px) {
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 24px 28px;
  border-radius: var(--radius-card);
  background: var(--color-tile);
}

.card-title {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 20px;
  font-weight: 400;
  color: var(--color-text-strong);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 14px;
  color: var(--color-text-muted);
}

.legend li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.key {
  flex: none;
  display: inline-block;
}

.key-line {
  width: 16px;
  height: 2px;
  border-radius: 1px;
  background: var(--color-neutral-300);
}

.key-stir {
  width: 4px;
  height: 12px;
  border-radius: 1px;
  background: var(--color-accent-2-300);
}

.key-cry {
  width: 14px;
  height: 12px;
  border-radius: 3px;
  background: var(--color-accent-500);
  opacity: 0.6;
}

.note,
.empty {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-muted);
}

.list-title {
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}

.episodes {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}

.episodes li {
  padding: 8px 0;
  border-top: 1px solid var(--color-divider);
}

.link {
  color: var(--color-accent-400);
}

@media (max-width: 560px) {
  .card {
    padding: 20px;
  }
}
</style>
