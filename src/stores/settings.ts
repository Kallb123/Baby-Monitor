import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { z } from 'zod'

import { readStored, writeStored } from '@/lib/local-storage'

const SETTINGS_STORAGE_KEY = 'baby-monitor:settings'

// Each field is optional so settings added later don't discard older saves.
const storedSettingsSchema = z.object({
  showDecibels: z.boolean().optional(),
  hiddenCameraIds: z.array(z.string()).optional(),
})

/**
 * App settings for this device only, kept in localStorage. Like the layout,
 * they stay off the server: a config save re-registers every go2rtc stream.
 */
export const useSettingsStore = defineStore('settings', () => {
  const stored = readStored(SETTINGS_STORAGE_KEY, storedSettingsSchema) ?? {}
  /** Show each tile's sound level as a dBFS number beside the meter. */
  const showDecibels = ref(stored.showDecibels ?? false)
  /**
   * Cameras kept off this device's monitor. Hidden cameras get no tile, so no
   * stream is opened for them. May hold ids of cameras deleted since.
   */
  const hiddenCameraIds = ref<string[]>([...new Set(stored.hiddenCameraIds)])
  const hiddenSet = computed(() => new Set(hiddenCameraIds.value))

  // One write for every field: saving a single one would drop the others.
  watch([showDecibels, hiddenCameraIds], ([decibels, hidden]) =>
    writeStored(SETTINGS_STORAGE_KEY, { showDecibels: decibels, hiddenCameraIds: hidden }),
  )

  function setShowDecibels(on: boolean) {
    showDecibels.value = on
  }

  function isCameraHidden(cameraId: string) {
    return hiddenSet.value.has(cameraId)
  }

  function setCameraHidden(cameraId: string, hidden: boolean) {
    if (hidden === isCameraHidden(cameraId)) return
    hiddenCameraIds.value = hidden
      ? [...hiddenCameraIds.value, cameraId]
      : hiddenCameraIds.value.filter((id) => id !== cameraId)
  }

  /** Forgets hidden ids of cameras that no longer exist. */
  function pruneHiddenCameras(existingIds: Iterable<string>) {
    const existing = new Set(existingIds)
    if (hiddenCameraIds.value.every((id) => existing.has(id))) return
    hiddenCameraIds.value = hiddenCameraIds.value.filter((id) => existing.has(id))
  }

  return {
    showDecibels,
    hiddenCameraIds,
    setShowDecibels,
    isCameraHidden,
    setCameraHidden,
    pruneHiddenCameras,
  }
})
