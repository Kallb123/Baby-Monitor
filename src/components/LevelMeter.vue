<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Loudness, 0..1. */
    level: number
    segments?: number
  }>(),
  { segments: 12 },
)

const lit = computed(() => Math.round(Math.min(1, Math.max(0, props.level)) * props.segments))

// Sage for room sound, pale sage for raised sound, terracotta for loud.
function tone(index: number): 'low' | 'mid' | 'high' {
  const fraction = (index - 1) / props.segments
  if (fraction >= 2 / 3) return 'high'
  if (fraction >= 5 / 12) return 'mid'
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
  gap: 4px;
  width: 100%;
  height: 100%;
}

.segment {
  flex: 1;
  border-radius: var(--radius-pill);
  background: rgb(238 231 219 / 14%);
  transition: background-color 80ms linear;
}

.segment.lit.low {
  background: var(--color-accent-2-500);
}

.segment.lit.mid {
  background: var(--color-accent-2-300);
}

.segment.lit.high {
  background: var(--color-accent-400);
}

@media (prefers-reduced-motion: reduce) {
  .segment {
    transition: none;
  }
}
</style>
