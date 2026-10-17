<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'

import type { EntityState } from '@shared/api.ts'
import type { Camera, Layout } from '@shared/config.ts'
import { useElementSize } from '@/composables/useElementSize'
import { bestGrid } from '@/lib/layout'
import CameraTile from './CameraTile.vue'

const props = defineProps<{
  cameras: Camera[]
  layout: Layout
  states: Record<string, EntityState>
  audioCameraId: string | undefined
}>()

const emit = defineEmits<{
  toggleAudio: [cameraId: string]
}>()

const root = useTemplateRef<HTMLElement>('root')
const { width, height } = useElementSize(root)

const focusId = computed(() => {
  if (props.layout.mode !== 'focus' || props.cameras.length < 2) return undefined
  const preferred = props.cameras.find((c) => c.id === props.layout.focusCameraId)
  return (preferred ?? props.cameras[0])?.id
})

const gridStyle = computed(() => {
  if (focusId.value) return { '--thumbnails': props.cameras.length - 1 }
  const { columns, rows } = bestGrid(props.cameras.length, width.value, height.value)
  return {
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
  }
})
</script>

<template>
  <div ref="root" class="camera-grid" :class="{ focus: focusId }" :style="gridStyle">
    <CameraTile
      v-for="camera in cameras"
      :key="camera.id"
      :class="{ main: camera.id === focusId }"
      :camera="camera"
      :states="states"
      :audio-active="camera.id === audioCameraId"
      @toggle-audio="emit('toggleAudio', camera.id)"
    />
  </div>
</template>

<style scoped>
.camera-grid {
  display: grid;
  gap: var(--gap);
  width: 100%;
  height: 100%;
}

/* Focus layout: one large tile plus a strip of thumbnails. The strip sits
   beside the main tile in landscape and below it in portrait. */
.camera-grid.focus {
  grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
  grid-template-rows: repeat(var(--thumbnails), minmax(0, 1fr));
}

.camera-grid.focus .main {
  grid-row: 1 / -1;
  grid-column: 1;
}

@media (orientation: portrait) {
  .camera-grid.focus {
    grid-template-columns: repeat(var(--thumbnails), minmax(0, 1fr));
    grid-template-rows: minmax(0, 3fr) minmax(0, 1fr);
  }

  .camera-grid.focus .main {
    grid-row: 1;
    grid-column: 1 / -1;
  }
}
</style>
