import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { z } from 'zod'

import { readStored, writeStored } from '@/lib/local-storage'
import { layoutModes, type LayoutMode } from '@shared/config.ts'

// Layout choices are per device (a phone and the wall tablet want different
// views) and are kept out of the server config on purpose: every config save
// re-registers all streams with go2rtc, which a layout tap must not trigger.
const LAYOUT_STORAGE_KEY = 'baby-monitor:layout'

// No defaults: an unset mode must fall through to the saved config's layout.
const storedLayoutSchema = z.object({
  mode: z.enum(layoutModes).optional(),
  focusCameraId: z.string().optional(),
})

/** Live UI state for the monitor screen. Not persisted on the server. */
export const useMonitorStore = defineStore('monitor', () => {
  /** Camera whose audio is playing. At most one at a time, like a real baby monitor. */
  const audioCameraId = ref<string>()
  /** This device's layout; undefined falls back to the saved config's layout. */
  const stored = readStored(LAYOUT_STORAGE_KEY, storedLayoutSchema) ?? {}
  const layoutMode = ref<LayoutMode | undefined>(stored.mode)
  const focusCameraId = ref<string | undefined>(stored.focusCameraId)
  /** Edit mode: tapping a tile opens its settings instead of playing audio. */
  const editing = ref(false)

  watch([layoutMode, focusCameraId], ([mode, focus]) =>
    writeStored(LAYOUT_STORAGE_KEY, { mode, focusCameraId: focus }),
  )

  function toggleAudio(cameraId: string) {
    audioCameraId.value = audioCameraId.value === cameraId ? undefined : cameraId
  }

  function setAudio(cameraId: string, on: boolean) {
    if (on) audioCameraId.value = cameraId
    else if (audioCameraId.value === cameraId) audioCameraId.value = undefined
  }

  function stopAudio() {
    audioCameraId.value = undefined
  }

  function setLayout(mode: LayoutMode) {
    layoutMode.value = mode
  }

  function focus(cameraId: string) {
    focusCameraId.value = cameraId
  }

  function setEditing(on: boolean) {
    editing.value = on
  }

  return {
    audioCameraId,
    layoutMode,
    focusCameraId,
    editing,
    toggleAudio,
    setAudio,
    stopAudio,
    setLayout,
    focus,
    setEditing,
  }
})
