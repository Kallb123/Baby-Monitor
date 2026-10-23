<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'

import type { CryInterval } from '@shared/api.ts'
import { useElementSize } from '@/composables/useElementSize'
import {
  areaPath,
  cryBands,
  dbToY,
  formatClock,
  formatHour,
  hourTicks,
  linePath,
  nearestBucket,
  scale,
  soundSegments,
  tickStepHours,
} from '@/lib/history-chart'
import { BUCKET_MS, type SoundBucket } from '@/lib/sound-history'

const props = defineProps<{
  fromMs: number
  toMs: number
  /** This device's minute buckets inside the range, oldest first. */
  buckets: SoundBucket[]
  /** Crying from Home Assistant. Undefined when there is none to show. */
  cry: CryInterval[] | undefined
  /** Accessible name of the chart, including a summary of what it shows. */
  label: string
}>()

const HEIGHT = 168
const MARGIN = { left: 36, right: 10, top: 8 }
const PLOT_HEIGHT = 112
const LANE_TOP = MARGIN.top + PLOT_HEIGHT + 8
const LANE_HEIGHT = 12
const AXIS_BASELINE = LANE_TOP + LANE_HEIGHT + 18
const FALLBACK_WIDTH = 640

const wrap = useTemplateRef<HTMLElement>('wrap')
const { width: measured } = useElementSize(wrap)
// Before the first measurement (and where ResizeObserver is missing) use a sane width.
const width = computed(() => Math.max(measured.value || FALLBACK_WIDTH, 240))

const plotLeft = MARGIN.left
const plotRight = computed(() => width.value - MARGIN.right)
const x = (ms: number) => scale(ms, [props.fromMs, props.toMs], [plotLeft, plotRight.value])
const y = (db: number) => dbToY(db, MARGIN.top, PLOT_HEIGHT)
const minuteWidth = computed(() => x(props.fromMs + BUCKET_MS) - x(props.fromMs))

const gridDb = [0, -20, -40, -60]
const rangeHours = computed(() => (props.toMs - props.fromMs) / 3_600_000)
const ticks = computed(() =>
  hourTicks(props.fromMs, props.toMs, tickStepHours(rangeHours.value)).map((ms) => ({
    x: x(ms),
    label: formatHour(ms),
  })),
)

const segments = computed(() => soundSegments(props.buckets, x, y, Math.max(2, minuteWidth.value)))
const baseline = MARGIN.top + PLOT_HEIGHT
const lines = computed(() => segments.value.map((points) => linePath(points)))
const areas = computed(() => segments.value.map((points) => areaPath(points, baseline)))

const stirred = computed(() =>
  props.buckets
    .filter((bucket) => bucket[2] === 1)
    .map(([start]) => x(start + BUCKET_MS / 2) - Math.max(1, minuteWidth.value / 2)),
)
const stirredWidth = computed(() => Math.max(2, minuteWidth.value))

const bands = computed(() =>
  cryBands(props.cry ?? [], props.fromMs, props.toMs, props.toMs).map((band) => {
    const left = x(band.startMs)
    // Even a one-minute episode must be visible on a 24 h chart.
    return { x: left, width: Math.max(3, x(band.endMs) - left) }
  }),
)

// Pointer readout: the chart is drawn in pixels, so a pixel is the tolerance for a hit.
const hover = ref<{ px: number; ms: number }>()
const msPerPixel = computed(() => (props.toMs - props.fromMs) / (plotRight.value - plotLeft))

function onPointer(event: PointerEvent) {
  const rect = wrap.value?.getBoundingClientRect()
  if (!rect) return
  const px = Math.min(plotRight.value, Math.max(plotLeft, event.clientX - rect.left))
  hover.value = { px, ms: scale(px, [plotLeft, plotRight.value], [props.fromMs, props.toMs]) }
}

const readout = computed(() => {
  if (!hover.value) return undefined
  const { ms, px } = hover.value
  const bucket = nearestBucket(props.buckets, ms, msPerPixel.value * 4)
  const crying = (props.cry ?? []).some((interval) => {
    const start = Date.parse(interval.start)
    const end = interval.end ? Date.parse(interval.end) : props.toMs
    return ms >= start - msPerPixel.value * 2 && ms <= end + msPerPixel.value * 2
  })
  return {
    px,
    time: formatClock(ms),
    sound: bucket ? `${bucket[1].toFixed(1).replace('-', '−')} dB peak` : 'Nothing recorded',
    stirring: bucket?.[2] === 1,
    crying,
  }
})

// Keep the readout inside the card by flipping it to the left of the cursor near the right edge.
const readoutOnLeft = computed(() => (readout.value?.px ?? 0) > width.value * 0.6)
</script>

<template>
  <div
    ref="wrap"
    class="timeline"
    @pointermove="onPointer"
    @pointerdown="onPointer"
    @pointerleave="hover = undefined"
    @pointercancel="hover = undefined"
  >
    <svg
      :width="width"
      :height="HEIGHT"
      :viewBox="`0 0 ${width} ${HEIGHT}`"
      role="img"
      :aria-label="label"
    >
      <g class="grid">
        <template v-for="db in gridDb" :key="db">
          <line :x1="plotLeft" :x2="plotRight" :y1="y(db)" :y2="y(db)" />
          <text :x="plotLeft - 8" :y="y(db)" class="axis-label end" dominant-baseline="middle">
            {{ db === 0 ? '0' : `−${-db}` }}
          </text>
        </template>
      </g>

      <rect
        v-for="(band, i) in bands"
        :key="`cry-${i}`"
        class="cry"
        :x="band.x"
        :y="MARGIN.top"
        :width="band.width"
        :height="LANE_TOP + LANE_HEIGHT - MARGIN.top"
        rx="3"
      />

      <path v-for="(d, i) in areas" :key="`area-${i}`" class="area" :d="d" />
      <path v-for="(d, i) in lines" :key="`line-${i}`" class="line" :d="d" />

      <rect
        v-for="(left, i) in stirred"
        :key="`stir-${i}`"
        class="stirred"
        :x="left"
        :y="LANE_TOP + 1"
        :width="stirredWidth"
        :height="LANE_HEIGHT - 2"
        rx="1"
      />

      <g class="axis">
        <template v-for="tick in ticks" :key="tick.x">
          <line
            :x1="tick.x"
            :x2="tick.x"
            :y1="LANE_TOP + LANE_HEIGHT + 3"
            :y2="LANE_TOP + LANE_HEIGHT + 8"
          />
          <text :x="tick.x" :y="AXIS_BASELINE" class="axis-label middle">{{ tick.label }}</text>
        </template>
      </g>

      <line
        v-if="readout"
        class="crosshair"
        :x1="readout.px"
        :x2="readout.px"
        :y1="MARGIN.top"
        :y2="LANE_TOP + LANE_HEIGHT"
      />
    </svg>

    <div
      v-if="readout"
      class="readout"
      :class="{ left: readoutOnLeft }"
      :style="{ left: `${readout.px}px` }"
      aria-hidden="true"
    >
      <span class="readout-time">{{ readout.time }}</span>
      <span class="readout-value">{{ readout.sound }}</span>
      <span v-if="readout.stirring" class="readout-flag stirring">Stirring</span>
      <span v-if="readout.crying" class="readout-flag crying">Crying</span>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  position: relative;
  width: 100%;
  /* Vertical swipes must still scroll the page; horizontal moves drive the readout. */
  touch-action: pan-y;
}

svg {
  display: block;
  max-width: 100%;
  overflow: visible;
}

.grid line,
.axis line {
  stroke: var(--color-divider);
  stroke-width: 1;
}

.axis-label {
  font-size: 11px;
  fill: var(--color-text-muted);
}

.axis-label.end {
  text-anchor: end;
}

.axis-label.middle {
  text-anchor: middle;
}

.cry {
  fill: var(--color-accent-500);
  fill-opacity: 0.32;
}

.area {
  fill: var(--color-neutral-400);
  fill-opacity: 0.12;
}

.line {
  fill: none;
  stroke: var(--color-neutral-300);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.stirred {
  fill: var(--color-accent-2-300);
}

.crosshair {
  stroke: var(--color-text-muted);
  stroke-width: 1;
  pointer-events: none;
}

.readout {
  position: absolute;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border-radius: 14px;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
  font-size: 13px;
  white-space: nowrap;
  pointer-events: none;
  transform: translateX(12px);
}

.readout.left {
  transform: translateX(calc(-100% - 12px));
}

.readout-time {
  color: var(--color-text-muted);
}

.readout-value {
  font-weight: 700;
  color: var(--color-text-strong);
}

.readout-flag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text);
}

/* The coloured key beside the word carries identity; the word stays in text colour. */
.readout-flag::before {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 3px;
}

.readout-flag.stirring::before {
  background: var(--color-accent-2-300);
}

.readout-flag.crying::before {
  background: var(--color-accent-500);
}
</style>
