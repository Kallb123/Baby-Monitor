<script setup lang="ts">
import { computed, onMounted, useId } from 'vue'
import { RouterLink } from 'vue-router'

import type { HomeAssistantStatus } from '@shared/api.ts'
import AppIcon from '@/components/AppIcon.vue'
import { useSystemInfo } from '@/composables/useSystemInfo'
import { SENSITIVITIES, sensitivityLabels } from '@/lib/sound-status'
import { useConfigStore } from '@/stores/config'
import type { StreamQualityPreference } from '@/lib/stream-quality'
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()
const configStore = useConfigStore()
const { info, error } = useSystemInfo()
const decibelsLabelId = useId()
const streamDetailsLabelId = useId()
const feedAlertsLabelId = useId()
const feedSoundLabelId = useId()
const cameraLabelPrefix = useId()
const streamQualityLabelId = useId()
const streamQualityName = useId()

const streamQualityOptions: { value: StreamQualityPreference; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'main', label: 'Always main' },
  { value: 'sub', label: 'Always sub-stream' },
]

// This page can be the first one opened (a reload on /settings), before the
// monitor has loaded the camera list.
onMounted(() => {
  if (!configStore.loaded) void configStore.load()
})

const haStatusLabels: Record<HomeAssistantStatus, string> = {
  connected: 'Connected',
  error: 'Not connected',
  unconfigured: 'Not configured',
}

const homeAssistant = computed(() => {
  // Without the server there is no fresh answer, so don't keep showing an old one.
  if (error.value) {
    return {
      tone: 'error',
      label: 'Unknown',
      message: `Can't reach the monitor server: ${error.value}`,
    }
  }
  const ha = info.value?.homeAssistant
  if (!ha) return { tone: 'pending', label: 'Checking…', message: undefined }
  return { tone: ha.status, label: haStatusLabels[ha.status], message: ha.message }
})
</script>

<template>
  <div class="settings">
    <header class="settings-header">
      <RouterLink to="/" class="back-btn" aria-label="Back to monitor" title="Back to monitor">
        <AppIcon name="arrow-left" :size="22" />
      </RouterLink>
      <h1 class="title">Settings</h1>
    </header>

    <main class="content">
      <section class="card" aria-labelledby="display-heading">
        <h2 id="display-heading" class="card-title">Display</h2>
        <p class="card-note">Saved on this device only.</p>

        <div class="row">
          <div class="row-text">
            <span :id="decibelsLabelId" class="row-label">Sound level in decibels</span>
            <span class="row-help">
              Shows each camera's level as a number next to its meter, in dBFS: 0 is the loudest the
              stream can carry and the meter starts at −60. −∞ means the audio is digitally silent.
            </span>
          </div>
          <button
            type="button"
            class="switch"
            role="switch"
            :aria-checked="settings.showDecibels"
            :aria-labelledby="decibelsLabelId"
            @click="settings.setShowDecibels(!settings.showDecibels)"
          >
            <span class="switch-knob" />
          </button>
        </div>
        <div class="row">
          <div class="row-text">
            <span :id="streamDetailsLabelId" class="row-label">Stream details</span>
            <span class="row-help">
              Shows a small overlay on each video feed with the received resolution, frame rate,
              video codec and audio codec. Unavailable details appear as —.
            </span>
          </div>
          <button
            type="button"
            class="switch"
            role="switch"
            :aria-checked="settings.showStreamDetails"
            :aria-labelledby="streamDetailsLabelId"
            @click="settings.setShowStreamDetails(!settings.showStreamDetails)"
          >
            <span class="switch-knob" />
          </button>
        </div>
        <div class="row stacked" role="radiogroup" :aria-labelledby="streamQualityLabelId">
          <span :id="streamQualityLabelId" class="row-label">Stream quality</span>
          <span class="row-help">
            Auto plays a camera's lower-resolution sub-stream in small tiles and its main stream in
            large ones. This only applies to cameras with a sub-stream address.
          </span>
          <div class="segments">
            <label v-for="option in streamQualityOptions" :key="option.value" class="segment">
              <input
                type="radio"
                :name="streamQualityName"
                :value="option.value"
                :checked="settings.streamQuality === option.value"
                @change="settings.setStreamQuality(option.value)"
              />
              <span>{{ option.label }}</span>
            </label>
          </div>
        </div>
      </section>

      <section class="card" aria-labelledby="alerts-heading">
        <h2 id="alerts-heading" class="card-title">Alerts</h2>
        <p class="card-note">Saved on this device only.</p>

        <div class="row">
          <div class="row-text">
            <span :id="feedAlertsLabelId" class="row-label">Warn when a feed is lost</span>
            <span class="row-help">
              Shows a banner when a camera has been disconnected for 30 seconds, until it comes back
              or you dismiss it.
            </span>
          </div>
          <button
            type="button"
            class="switch"
            role="switch"
            :aria-checked="settings.feedLostAlerts"
            :aria-labelledby="feedAlertsLabelId"
            @click="settings.setFeedLostAlerts(!settings.feedLostAlerts)"
          >
            <span class="switch-knob" />
          </button>
        </div>
        <div class="row">
          <div class="row-text">
            <span :id="feedSoundLabelId" class="row-label">Chime and vibrate</span>
            <span class="row-help">
              Plays a soft chime and vibrates when a feed is lost, then repeats every minute. The
              chime needs a tap on the page first, as for any sound.
            </span>
          </div>
          <button
            type="button"
            class="switch"
            role="switch"
            :aria-checked="settings.feedLostSound"
            :aria-labelledby="feedSoundLabelId"
            @click="settings.setFeedLostSound(!settings.feedLostSound)"
          >
            <span class="switch-knob" />
          </button>
        </div>
      </section>

      <section class="card" aria-labelledby="cameras-heading">
        <h2 id="cameras-heading" class="card-title">Cameras</h2>
        <p class="card-note">
          Choose which cameras this device shows. Hidden cameras are not played at all. Saved on
          this device only.
        </p>

        <p v-if="!configStore.loaded && configStore.error" class="row empty" role="alert">
          Can't load the cameras: {{ configStore.error }}
        </p>
        <p v-else-if="!configStore.loaded" class="row empty">Loading cameras…</p>
        <p v-else-if="configStore.config.cameras.length === 0" class="row empty">
          No cameras yet. Add one from the monitor.
        </p>
        <template v-else>
          <div v-for="camera in configStore.config.cameras" :key="camera.id" class="row">
            <div class="row-text">
              <span :id="`${cameraLabelPrefix}-${camera.id}`" class="row-label">{{
                camera.name
              }}</span>
              <span :id="`${cameraLabelPrefix}-${camera.id}-help`" class="row-help">
                Show on monitor
              </span>
            </div>
            <button
              type="button"
              class="switch"
              role="switch"
              :aria-checked="!settings.isCameraHidden(camera.id)"
              :aria-labelledby="`${cameraLabelPrefix}-${camera.id} ${cameraLabelPrefix}-${camera.id}-help`"
              @click="settings.setCameraHidden(camera.id, !settings.isCameraHidden(camera.id))"
            >
              <span class="switch-knob" />
            </button>
          </div>
        </template>
      </section>

      <section
        v-if="configStore.loaded && configStore.config.cameras.length > 0"
        class="card"
        aria-labelledby="stirring-heading"
      >
        <h2 id="stirring-heading" class="card-title">Stirring sensitivity</h2>
        <p class="card-note">
          Stirring is measured against each room's background noise, so steady sounds like a
          white-noise machine are ignored after a minute or two. Higher reacts to quieter sounds.
          Saved on this device only.
        </p>

        <div
          v-for="camera in configStore.config.cameras"
          :key="camera.id"
          class="row sensitivity-row"
        >
          <span :id="`${cameraLabelPrefix}-stirring-${camera.id}`" class="row-label">{{
            camera.name
          }}</span>
          <div
            class="segments"
            role="radiogroup"
            :aria-labelledby="`${cameraLabelPrefix}-stirring-${camera.id}`"
          >
            <label v-for="option in SENSITIVITIES" :key="option" class="segment">
              <input
                type="radio"
                :name="`${cameraLabelPrefix}-stirring-${camera.id}`"
                :value="option"
                :checked="settings.sensitivityFor(camera.id) === option"
                @change="settings.setSensitivity(camera.id, option)"
              />
              <span>{{ sensitivityLabels[option] }}</span>
            </label>
          </div>
        </div>
      </section>

      <section class="card" aria-labelledby="system-heading">
        <h2 id="system-heading" class="card-title">System</h2>
        <p class="card-note">Set on the server with environment variables. Read-only here.</p>

        <dl class="facts">
          <div class="row fact">
            <dt class="row-label">Home Assistant</dt>
            <dd class="row-value">
              <span class="status" :class="homeAssistant.tone" role="status">
                <span class="dot" />{{ homeAssistant.label }}
              </span>
              <span v-if="homeAssistant.message" class="row-help">
                {{ homeAssistant.message }}
              </span>
            </dd>
          </div>
          <div class="row fact">
            <dt class="row-label">Home Assistant URL</dt>
            <dd class="row-value url">{{ info ? (info.homeAssistant.url ?? 'Not set') : '…' }}</dd>
          </div>
          <div class="row fact">
            <dt class="row-label">go2rtc URL</dt>
            <dd class="row-value url">{{ info ? (info.go2rtc.url ?? 'Not set') : '…' }}</dd>
          </div>
        </dl>
      </section>
    </main>
  </div>
</template>

<style scoped>
.settings {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.settings-header {
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
  max-width: 640px;
  margin: 0 auto;
  padding: 12px calc(20px + env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom))
    calc(20px + env(safe-area-inset-left));
}

.card {
  display: flex;
  flex-direction: column;
  padding: 24px 28px 8px;
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

.card-note {
  margin: 4px 0 8px;
  font-size: 14px;
  color: var(--color-text-muted);
}

.facts {
  margin: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
  border-top: 1px solid var(--color-divider);
}

.stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}

.segments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.segment {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 18px;
  border-radius: var(--radius-pill);
  background: var(--color-neutral-800);
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
  cursor: pointer;
}

.segment input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.segment:has(input:checked) {
  background: var(--color-accent);
  color: var(--color-neutral-100);
}

.segment:has(input:focus-visible) {
  outline: 2px solid var(--color-accent-400);
  outline-offset: 2px;
}

.row-text,
.row-value {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.row-text {
  flex: 1;
}

.row-label {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}

.row-help {
  font-size: 14px;
  color: var(--color-text-muted);
}

.empty {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-muted);
}

.fact {
  display: grid;
  grid-template-columns: minmax(0, 11rem) minmax(0, 1fr);
  align-items: baseline;
}

.row-value {
  margin: 0;
}

.url {
  font-size: 15px;
  color: var(--color-text-strong);
  overflow-wrap: anywhere;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-muted);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-neutral-600);
}

.status.connected {
  color: var(--color-accent-2-300);
}

.status.connected .dot {
  background: var(--color-accent-2-400);
}

.status.error {
  color: var(--color-accent-300);
}

.status.error .dot {
  background: var(--color-accent-400);
}

.switch {
  position: relative;
  flex: none;
  width: 60px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-neutral-800);
  transition: background-color 150ms ease;
}

.switch-knob {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-neutral-300);
  transition: transform 150ms ease;
}

.switch[aria-checked='true'] {
  background: var(--color-accent);
}

.switch[aria-checked='true'] .switch-knob {
  background: var(--color-neutral-100);
  transform: translateX(24px);
}

/* Wraps on narrow phones so a long camera name keeps room beside the control. */
.sensitivity-row {
  flex-wrap: wrap;
}

.sensitivity-row .row-label {
  flex: 1 1 8rem;
  min-width: 0;
}

.segments {
  display: flex;
  flex: none;
  padding: 4px;
  border-radius: var(--radius-pill);
  background: var(--color-neutral-800);
}

.segment {
  position: relative;
  display: grid;
  place-items: center;
  min-width: 72px;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background-color 150ms ease;
}

/* The native radio stays for keyboard and screen-reader behaviour. */
.segment input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.segment:has(input:checked) {
  background: var(--color-accent);
  color: var(--color-neutral-100);
}

.segment:has(input:focus-visible) {
  outline: 2px solid var(--color-accent-400);
  outline-offset: 2px;
}

@media (max-width: 560px) {
  .card {
    padding: 20px 20px 4px;
  }

  .fact {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  .segment {
    min-width: 60px;
    padding: 0 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .switch,
  .switch-knob,
  .segment {
    transition: none;
  }
}
</style>
