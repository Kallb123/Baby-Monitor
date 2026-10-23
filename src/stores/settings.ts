import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { z } from 'zod'

import { readStored, writeStored } from '@/lib/local-storage'
import { streamQualityPreferences, type StreamQualityPreference } from '@/lib/stream-quality'

const SETTINGS_STORAGE_KEY = 'baby-monitor:settings'

// Each field is optional so settings added later don't discard older saves.
const storedSettingsSchema = z.object({
  showDecibels: z.boolean().optional(),
  showStreamDetails: z.boolean().optional(),
  hiddenCameraIds: z.array(z.string()).optional(),
  streamQuality: z.enum(streamQualityPreferences).optional(),
})

/**
 * App settings for this device only, kept in localStorage. Like the layout,
 * they stay off the server: a config save re-registers every go2rtc stream.
 */
export const useSettingsStore = defineStore('settings', () => {
  const stored = readStored(SETTINGS_STORAGE_KEY, storedSettingsSchema) ?? {}
  /** Show each tile's sound level as a dBFS number beside the meter. */
  const showDecibels = ref(stored.showDecibels ?? false)
  const showStreamDetails = ref(stored.showStreamDetails ?? false)
  /**
   * Cameras kept off this device's monitor. Hidden cameras get no tile, so no
   * stream is opened for them. May hold ids of cameras deleted since.
   */
  const hiddenCameraIds = ref<string[]>([...new Set(stored.hiddenCameraIds)])
  const hiddenSet = computed(() => new Set(hiddenCameraIds.value))
  /** Which stream cameras with a sub-stream play: chosen by tile size, or always one. */
  const streamQuality = ref<StreamQualityPreference>(stored.streamQuality ?? 'auto')

  // One write for every field: saving a single one would drop the others.
  watch(
    [showDecibels, showStreamDetails, hiddenCameraIds, streamQuality],
    ([decibels, details, hidden, quality]) =>
      writeStored(SETTINGS_STORAGE_KEY, {
        showDecibels: decibels,
        showStreamDetails: details,
        hiddenCameraIds: hidden,
        streamQuality: quality,
      }),
  )

  function setShowDecibels(on: boolean) {
    showDecibels.value = on
  }

  function setShowStreamDetails(on: boolean) {
    showStreamDetails.value = on
  }

  function setStreamQuality(preference: StreamQualityPreference) {
    streamQuality.value = preference
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
    showStreamDetails,
    hiddenCameraIds,
    streamQuality,
    setShowDecibels,
    setShowStreamDetails,
    setStreamQuality,
    isCameraHidden,
    setCameraHidden,
    pruneHiddenCameras,
  }
})
