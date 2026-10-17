import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { z } from 'zod'

import { layoutModes, type LayoutMode } from '@shared/config.ts'

const LAYOUT_STORAGE_KEY = 'baby-monitor:layout'

// No defaults: an unset mode must fall through to the saved config's layout.
const storedLayoutSchema = z.object({
  mode: z.enum(layoutModes).optional(),
  focusCameraId: z.string().optional(),
})

/**
 * Layout choices are per device (a phone and the wall tablet want different
 * views) and are kept out of the server config on purpose: every config save
 * re-registers all streams with go2rtc, which a layout tap must not trigger.
 */
function readStoredLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    const parsed = storedLayoutSchema.safeParse(raw ? JSON.parse(raw) : {})
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

function writeStoredLayout(layout: { mode?: LayoutMode; focusCameraId?: string }) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // Private mode or blocked storage: the choice just won't survive a reload.
  }
}

/** Live UI state for the monitor screen. Not persisted on the server. */
export const useMonitorStore = defineStore('monitor', () => {
  /** Camera whose audio is playing. At most one at a time, like a real baby monitor. */
  const audioCameraId = ref<string>()
  /** This device's layout; undefined falls back to the saved config's layout. */
  const stored = readStoredLayout()
  const layoutMode = ref<LayoutMode | undefined>(stored.mode)
  const focusCameraId = ref<string | undefined>(stored.focusCameraId)
  /** Edit mode: tapping a tile opens its settings instead of playing audio. */
  const editing = ref(false)

  watch([layoutMode, focusCameraId], ([mode, focus]) =>
    writeStoredLayout({ mode, focusCameraId: focus }),
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
