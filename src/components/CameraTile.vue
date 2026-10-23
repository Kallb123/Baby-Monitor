<script setup lang="ts">
import { computed, toRef, useTemplateRef, watch } from 'vue'

import type { EntityState } from '@shared/api.ts'
import type { Camera } from '@shared/config.ts'
import { useAudioLevel } from '@/composables/useAudioLevel'
import { useStirring } from '@/composables/useStirring'
import { useWebRtcStream } from '@/composables/useWebRtcStream'
import { decibelReadout } from '@/lib/audio-level'
import { formatMeasurement, isCrying } from '@/lib/entities'
import { backgroundReadout } from '@/lib/noise-floor'
import {
  DEFAULT_SENSITIVITY,
  soundStatus,
  soundStatusLabels,
  type Sensitivity,
} from '@/lib/sound-status'
import AppIcon from './AppIcon.vue'
import LevelMeter from './LevelMeter.vue'

const props = withDefaults(
  defineProps<{
    camera: Camera
    states: Record<string, EntityState>
    /** True when this tile's audio is the one playing. */
    audioActive: boolean
    /** Thumbnail in the focus layout: smaller type, icon-only badges. */
    compact?: boolean
    /** Tapping always starts this tile's audio instead of toggling it. */
    listenOnTap?: boolean
    /** Edit mode: tapping asks to edit the camera and leaves audio alone. */
    editing?: boolean
    /** Show the sound level in dBFS next to the meter. */
    showDecibels?: boolean
    /** Show the received stream's resolution and codecs. */
    showStreamDetails?: boolean
    /** How easily the tile reads "Stirring" against its room's background noise. */
    stirringSensitivity?: Sensitivity
  }>(),
  {
    compact: false,
    listenOnTap: false,
    editing: false,
    showDecibels: false,
    showStreamDetails: false,
    stirringSensitivity: DEFAULT_SENSITIVITY,
  },
)

const emit = defineEmits<{
  audio: [on: boolean]
  edit: []
}>()

const video = useTemplateRef<HTMLVideoElement>('video')
const { stream, status, details, reconnect } = useWebRtcStream(
  toRef(() => props.camera.id),
  toRef(() => props.showStreamDetails),
)
// Editing a camera's source keeps its id (the go2rtc stream name), so pick up
// the new source explicitly; the tile stays mounted across config saves.
watch(
  () => props.camera.rtspUrl,
  () => void reconnect(),
)
const { level, db, status: levelStatus } = useAudioLevel(stream)
const decibels = computed(() => decibelReadout(levelStatus.value, db.value))
const { stirring, floorDb } = useStirring(db, () => props.stirringSensitivity)
// The learned background lets users calibrate sensitivity; it means nothing
// while the meter isn't measuring.
const background = computed(() =>
  levelStatus.value === 'live' ? backgroundReadout(floorDb.value) : undefined,
)

const entityState = (id: string | undefined) => (id ? props.states[id] : undefined)
const crying = computed(() => isCrying(entityState(props.camera.entities.cry)))
const temperature = computed(() =>
  formatMeasurement(entityState(props.camera.entities.temperature)),
)
const humidity = computed(() => formatMeasurement(entityState(props.camera.entities.humidity), 0))

const sound = computed(() =>
  soundStatus({ crying: crying.value, stirring: stirring.value, live: status.value === 'live' }),
)
const ariaLabel = computed(() => {
  if (props.editing) return `Edit ${props.camera.name}`
  const listening = props.audioActive ? ', listening' : ''
  return `${props.camera.name}, ${soundStatusLabels[sound.value]}${listening}`
})

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
  if (props.editing) {
    emit('edit')
    return
  }
  const next = props.listenOnTap || !props.audioActive
  if (video.value) applyAudio(video.value, next)
  emit('audio', next)
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
    :class="{
      compact,
      listening: audioActive,
      crying,
      editing,
      'details-visible': showStreamDetails,
    }"
    role="button"
    tabindex="0"
    :aria-pressed="editing ? undefined : audioActive"
    :aria-label="ariaLabel"
    @click="onTap"
    @keydown.enter.prevent="onTap"
    @keydown.space.prevent="onTap"
  >
    <video ref="video" autoplay playsinline muted />

    <div v-if="status !== 'live'" class="feed-status">
      {{ status === 'connecting' ? 'Connecting…' : 'Reconnecting…' }}
    </div>

    <div class="scrim" />

    <div class="overlay">
      <div class="top">
        <div class="identity">
          <div class="name">{{ camera.name }}</div>
          <div v-if="temperature || humidity" class="readings">
            <span v-if="temperature" class="reading">
              <AppIcon name="thermometer" :size="14" />{{ temperature }}
            </span>
            <span v-if="humidity" class="reading">
              <AppIcon name="droplet" :size="14" />{{ humidity }}
            </span>
          </div>
        </div>

        <span v-if="crying" class="badge cry" role="status" aria-label="Crying detected">
          <AppIcon name="baby" :size="20" />
          <span v-if="!compact">Crying</span>
        </span>
        <span v-if="audioActive" class="badge listen">
          <AppIcon name="volume" :size="18" />
          <span v-if="!compact">Listening</span>
        </span>
        <span v-else-if="!editing" class="muted" title="Muted">
          <AppIcon name="volume-off" :size="18" />
        </span>

        <div v-if="showStreamDetails && status === 'live'" class="stream-details">
          <template v-if="compact">
            <span title="Resolution · video codec">
              {{ details.resolution?.replaceAll(' ', '') ?? '—' }} · {{ details.videoCodec ?? '—' }}
            </span>
            <span title="Audio codec · frame rate">
              {{ details.audioCodec ?? '—' }} ·
              {{ details.framesPerSecond === undefined ? '—' : `${details.framesPerSecond} fps` }}
            </span>
          </template>
          <template v-else>
            <span>
              Video: {{ details.resolution ?? '—' }} ·
              {{ details.framesPerSecond === undefined ? '—' : `${details.framesPerSecond} fps` }} ·
              {{ details.videoCodec ?? '—' }}
            </span>
            <span>Audio: {{ details.audioCodec ?? '—' }}</span>
          </template>
        </div>
      </div>

      <div class="bottom">
        <span v-if="!compact" class="sound-status" :class="sound">
          {{ soundStatusLabels[sound] }}
        </span>
        <LevelMeter class="meter" :level="level" />
        <span
          v-if="showDecibels"
          class="decibels"
          :class="{ inactive: levelStatus !== 'live' }"
          title="RMS level in dBFS (0 is the loudest the stream can carry), and the learned background noise"
        >
          {{ decibels }}<span v-if="background" class="background"> · {{ background }}</span>
        </span>
      </div>
    </div>

    <div v-if="editing" class="edit-overlay">
      <span class="edit-pill">
        <AppIcon name="pencil" :size="18" />
        <span v-if="!compact">Edit camera</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.camera-tile {
  --pad: 20px;

  position: relative;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius-tile);
  background: radial-gradient(ellipse at 50% 45%, #3a362f 0%, var(--color-tile) 75%);
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.camera-tile.compact {
  --pad: 12px;

  border-radius: var(--radius-tile-compact);
}

/* Listening ring, drawn above the video. A pseudo-element keeps `outline`
   free for the keyboard focus ring. */
.camera-tile::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 4px solid transparent;
  border-radius: inherit;
  pointer-events: none;
}

.camera-tile.listening::after {
  border-color: var(--color-accent-2-400);
}

.camera-tile.crying {
  animation: cry-glow 1.25s ease-in-out infinite alternate;
  box-shadow:
    0 0 0 4px rgb(214 127 72 / 75%),
    0 0 36px rgb(214 127 72 / 35%);
}

@keyframes cry-glow {
  from {
    box-shadow:
      0 0 0 3px rgb(214 127 72 / 55%),
      0 0 36px rgb(214 127 72 / 35%);
  }

  to {
    box-shadow:
      0 0 0 6px rgb(214 127 72 / 95%),
      0 0 36px rgb(214 127 72 / 35%);
  }
}

video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* Letterbox rather than crop: the whole cot must stay in view. */
  object-fit: contain;
  display: block;
}

.feed-status {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-neutral-500);
}

.scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgb(20 18 15 / 70%) 0%,
    rgb(20 18 15 / 0%) 30%,
    rgb(20 18 15 / 0%) 62%,
    rgb(20 18 15 / 78%) 100%
  );
  pointer-events: none;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: var(--pad);
  pointer-events: none;
}

.top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.identity {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 0;
  min-width: 0;
}

.name {
  font-family: var(--font-heading);
  font-size: 22px;
  line-height: 1.15;
  color: var(--color-text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.compact .name {
  font-size: 17px;
}

.readings {
  display: flex;
  flex-wrap: wrap;
  column-gap: 12px;
  font-size: 14px;
  color: var(--color-neutral-300);
}

.reading {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.stream-details {
  display: flex;
  flex-direction: column;
  flex-basis: 100%;
  max-width: 100%;
  padding: 4px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-bg) 80%, transparent);
  color: var(--color-text-strong);
  font-size: 12px;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.details-visible .top {
  flex-wrap: wrap;
}

.compact .stream-details {
  font-size: 10px;
}

.compact.details-visible {
  --pad: 8px;
}

.compact.details-visible .top {
  gap: 4px 6px;
}

.compact.details-visible .badge,
.compact.details-visible .muted {
  height: 24px;
  min-width: 24px;
}

.badge,
.muted {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: none;
  height: 36px;
  min-width: 36px;
  border-radius: var(--radius-pill);
  font-size: 14px;
  font-weight: 700;
}

.badge {
  padding: 0 12px;
}

.compact .badge {
  padding: 0 8px;
}

.badge.cry {
  background: var(--color-accent-500);
  color: var(--color-bg);
}

.badge.listen {
  background: var(--color-accent-2-400);
  color: var(--color-accent-2-900);
}

.muted {
  background: rgb(28 26 22 / 55%);
  color: var(--color-text-muted);
}

.bottom {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sound-status {
  min-width: 64px;
  flex: none;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-muted);
}

.sound-status.crying {
  color: var(--color-accent-400);
}

.sound-status.stirring {
  color: var(--color-accent-2-300);
}

.meter {
  flex: 1;
  max-width: 320px;
  height: 12px;
}

.compact .meter {
  height: 8px;
}

.decibels {
  flex: none;
  min-width: 56px;
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
  color: var(--color-text-strong);
}

.decibels .background {
  font-weight: 500;
  color: var(--color-text-muted);
}

.decibels.inactive {
  color: var(--color-text-muted);
}

.compact .decibels {
  min-width: 0;
  font-size: 12px;
}

.edit-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(28 26 22 / 55%);
}

.edit-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 20px;
  border-radius: var(--radius-pill);
  background: var(--color-neutral-200);
  color: var(--color-ink);
  font-family: var(--font-heading);
  font-size: 16px;
}

.compact .edit-pill {
  padding: 0 14px;
}

@media (prefers-reduced-motion: reduce) {
  .camera-tile.crying {
    animation: none;
  }
}
</style>
