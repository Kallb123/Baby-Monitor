<script setup lang="ts">
import { computed, useId } from 'vue'
import { RouterLink } from 'vue-router'

import type { HomeAssistantStatus } from '@shared/api.ts'
import AppIcon from '@/components/AppIcon.vue'
import { useSystemInfo } from '@/composables/useSystemInfo'
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()
const { info, error } = useSystemInfo()
const decibelsLabelId = useId()

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

@media (max-width: 560px) {
  .card {
    padding: 20px 20px 4px;
  }

  .fact {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .switch,
  .switch-knob {
    transition: none;
  }
}
</style>
