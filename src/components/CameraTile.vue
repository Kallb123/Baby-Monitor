<script setup lang="ts">
import { computed, toRef, useTemplateRef, watch } from 'vue'

import type { EntityState } from '@shared/api.ts'
import type { Camera } from '@shared/config.ts'
import { useAudioLevel } from '@/composables/useAudioLevel'
import { useWebRtcStream } from '@/composables/useWebRtcStream'
import { formatMeasurement, isCrying } from '@/lib/entities'
import CryIndicator from './CryIndicator.vue'
import LevelMeter from './LevelMeter.vue'

const props = defineProps<{
  camera: Camera
  states: Record<string, EntityState>
  /** True when this tile's audio is the one playing. */
  audioActive: boolean
}>()

const emit = defineEmits<{
  toggleAudio: []
}>()

const video = useTemplateRef<HTMLVideoElement>('video')
const { stream, status } = useWebRtcStream(toRef(() => props.camera.id))
const { level } = useAudioLevel(stream)

const entityState = (id: string | undefined) => (id ? props.states[id] : undefined)
const crying = computed(() => isCrying(entityState(props.camera.entities.cry)))
const temperature = computed(() =>
  formatMeasurement(entityState(props.camera.entities.temperature)),
)
const humidity = computed(() => formatMeasurement(entityState(props.camera.entities.humidity), 0))

watch([video, stream], ([el, media]) => {
  if (el && el.srcObject !== (media ?? null)) el.srcObject = media ?? null
})

function applyAudio(el: HTMLVideoElement, active: boolean) {
  el.muted = !active
  if (active) void el.play().catch(() => {})
}

// Unmute right inside the tap handler: mobile browsers (iOS especially) only
// allow audible playback when it starts synchronously in a user gesture.
function onTap() {
  if (video.value) applyAudio(video.value, !props.audioActive)
  emit('toggleAudio')
}

// Keeps the element in sync when audio moves to another tile or the stream
// is replaced. Muting needs no user gesture.
watch([video, () => props.audioActive], ([el, active]) => {
  if (el) applyAudio(el, active)
})
</script>

<template>
  <div
    class="camera-tile"
    :class="{ 'audio-active': audioActive, crying }"
    role="button"
    tabindex="0"
    :aria-pressed="audioActive"
    :aria-label="`${camera.name}: ${audioActive ? 'mute' : 'listen'}`"
    @click="onTap"
    @keydown.enter.prevent="onTap"
    @keydown.space.prevent="onTap"
  >
    <video ref="video" autoplay playsinline muted />

    <div v-if="status !== 'live'" class="status">
      {{ status === 'connecting' ? 'Connecting…' : 'Reconnecting…' }}
    </div>

    <div class="overlay top">
      <span class="name">{{ camera.name }}</span>
      <span v-if="temperature" class="reading">{{ temperature }}</span>
      <span v-if="humidity" class="reading">{{ humidity }}</span>
    </div>

    <div class="overlay side">
      <CryIndicator v-if="camera.entities.cry" :crying="crying" />
      <LevelMeter :level="level" />
      <span class="speaker" :title="audioActive ? 'Listening' : 'Muted'" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
          <template v-if="audioActive">
            <path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" />
            <path
              d="M18.5 6a8.5 8.5 0 0 1 0 12"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            />
          </template>
          <path v-else d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" />
        </svg>
      </span>
    </div>
  </div>
</template>

<style scoped>
.camera-tile {
  position: relative;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  border: 2px solid transparent;
  border-radius: var(--radius);
  background: #000;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.camera-tile:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.camera-tile.audio-active {
  border-color: var(--accent);
}

.camera-tile.crying {
  border-color: var(--alert);
}

video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.status {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.overlay {
  position: absolute;
  display: flex;
  gap: 8px;
  pointer-events: none;
}

.overlay.top {
  top: 8px;
  left: 8px;
  right: 56px;
  align-items: center;
  flex-wrap: wrap;
}

.name,
.reading {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgb(0 0 0 / 45%);
  font-size: 0.85rem;
  white-space: nowrap;
}

.name {
  font-weight: 600;
}

.overlay.side {
  top: 8px;
  right: 8px;
  flex-direction: column;
  align-items: center;
  padding: 6px;
  border-radius: 999px;
  background: rgb(0 0 0 / 35%);
}

.speaker {
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.audio-active .speaker {
  color: var(--accent);
}
</style>
