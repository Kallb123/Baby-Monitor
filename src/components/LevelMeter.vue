<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Loudness, 0..1. */
    level: number
    segments?: number
  }>(),
  { segments: 10 },
)

const lit = computed(() => Math.round(Math.min(1, Math.max(0, props.level)) * props.segments))

function tone(index: number): 'low' | 'mid' | 'high' {
  const fraction = index / props.segments
  if (fraction >= 0.8) return 'high'
  if (fraction >= 0.5) return 'mid'
  return 'low'
}
</script>

<template>
  <div
    class="level-meter"
    role="meter"
    aria-label="Sound level"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(level * 100)"
  >
    <span
      v-for="index in segments"
      :key="index"
      class="segment"
      :class="[tone(index), { lit: index <= lit }]"
    />
  </div>
</template>

<style scoped>
.level-meter {
  display: flex;
  flex-direction: column-reverse;
  gap: 2px;
  width: 8px;
  height: 64px;
}

.segment {
  flex: 1;
  border-radius: 1px;
  background: rgb(255 255 255 / 15%);
  transition: background-color 80ms linear;
}

.segment.lit.low {
  background: var(--meter-low);
}

.segment.lit.mid {
  background: var(--meter-mid);
}

.segment.lit.high {
  background: var(--meter-high);
}
</style>
