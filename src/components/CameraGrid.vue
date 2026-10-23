<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'

import type { EntityState } from '@shared/api.ts'
import type { Camera, LayoutMode } from '@shared/config.ts'
import { useElementSize } from '@/composables/useElementSize'
import { bestGrid } from '@/lib/layout'
import { DEFAULT_SENSITIVITY, type Sensitivity } from '@/lib/sound-status'
import CameraTile from './CameraTile.vue'

const props = defineProps<{
  cameras: Camera[]
  mode: LayoutMode
  focusCameraId: string | undefined
  states: Record<string, EntityState>
  audioCameraId: string | undefined
  editing: boolean
  showDecibels: boolean
  showStreamDetails: boolean
  /** Per-camera stirring sensitivity; cameras without an entry use the default. */
  stirringSensitivity: Record<string, Sensitivity>
}>()

const emit = defineEmits<{
  audio: [cameraId: string, on: boolean]
  edit: [cameraId: string]
}>()

const root = useTemplateRef<HTMLElement>('root')
const { width, height } = useElementSize(root)

const focusId = computed(() => {
  if (props.mode !== 'focus' || props.cameras.length < 2) return undefined
  const preferred = props.cameras.find((c) => c.id === props.focusCameraId)
  return (preferred ?? props.cameras[0])?.id
})

const gridStyle = computed(() => {
  if (focusId.value) {
    const thumbnails = props.cameras.length - 1
    // One thumbnail gets a wider strip so it doesn't read as an afterthought.
    return {
      '--thumbnails': thumbnails,
      '--strip-landscape': thumbnails === 1 ? '34%' : '26%',
      '--strip-portrait': thumbnails === 1 ? '32%' : '22%',
    }
  }
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
      :compact="!!focusId && camera.id !== focusId"
      :listen-on-tap="!!focusId && camera.id !== focusId"
      :editing="editing"
      :show-decibels="showDecibels"
      :show-stream-details="showStreamDetails"
      :stirring-sensitivity="stirringSensitivity[camera.id] ?? DEFAULT_SENSITIVITY"
      @audio="(on) => emit('audio', camera.id, on)"
      @edit="emit('edit', camera.id)"
    />
  </div>
</template>

<style scoped>
.camera-grid {
  display: grid;
  gap: 14px;
  width: 100%;
  height: 100%;
}

/* Focus layout: one large tile plus a strip of thumbnails. The strip sits
   beside the main tile in landscape and below it in portrait. */
.camera-grid.focus {
  grid-template-columns: minmax(0, 1fr) minmax(0, var(--strip-landscape));
  grid-template-rows: repeat(var(--thumbnails), minmax(0, 1fr));
}

.camera-grid.focus .main {
  grid-row: 1 / -1;
  grid-column: 1;
}

@media (orientation: portrait) {
  .camera-grid.focus {
    grid-template-columns: repeat(var(--thumbnails), minmax(0, 1fr));
    grid-template-rows: minmax(0, 1fr) minmax(0, var(--strip-portrait));
  }

  .camera-grid.focus .main {
    grid-row: 1;
    grid-column: 1 / -1;
  }
}
</style>
