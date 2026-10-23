import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { z } from 'zod'

import { readStored, writeStored } from '@/lib/local-storage'
import { DEFAULT_SENSITIVITY, SENSITIVITIES, type Sensitivity } from '@/lib/sound-status'

const SETTINGS_STORAGE_KEY = 'baby-monitor:settings'

// Each field is optional so settings added later don't discard older saves.
const storedSettingsSchema = z.object({
  showDecibels: z.boolean().optional(),
  showStreamDetails: z.boolean().optional(),
  hiddenCameraIds: z.array(z.string()).optional(),
  stirringSensitivity: z.record(z.string(), z.enum(SENSITIVITIES)).optional(),
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
  /**
   * How easily each camera's tile reads "Stirring". Only non-default choices
   * are kept, so a camera that is absent uses medium. May hold ids of cameras
   * deleted since.
   */
  const stirringSensitivity = ref<Record<string, Sensitivity>>({ ...stored.stirringSensitivity })

  // One write for every field: saving a single one would drop the others.
  watch(
    [showDecibels, showStreamDetails, hiddenCameraIds, stirringSensitivity],
    ([decibels, details, hidden, sensitivity]) =>
      writeStored(SETTINGS_STORAGE_KEY, {
        showDecibels: decibels,
        showStreamDetails: details,
        hiddenCameraIds: hidden,
        stirringSensitivity: sensitivity,
      }),
  )

  function setShowDecibels(on: boolean) {
    showDecibels.value = on
  }

  function setShowStreamDetails(on: boolean) {
    showStreamDetails.value = on
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

  function sensitivityFor(cameraId: string): Sensitivity {
    return stirringSensitivity.value[cameraId] ?? DEFAULT_SENSITIVITY
  }

  function setSensitivity(cameraId: string, sensitivity: Sensitivity) {
    if (sensitivity === sensitivityFor(cameraId)) return
    const { [cameraId]: _previous, ...others } = stirringSensitivity.value
    stirringSensitivity.value =
      sensitivity === DEFAULT_SENSITIVITY ? others : { ...others, [cameraId]: sensitivity }
  }

  /** Forgets sensitivities of cameras that no longer exist. */
  function pruneStirringSensitivity(existingIds: Iterable<string>) {
    const existing = new Set(existingIds)
    const kept = Object.entries(stirringSensitivity.value).filter(([id]) => existing.has(id))
    if (kept.length === Object.keys(stirringSensitivity.value).length) return
    stirringSensitivity.value = Object.fromEntries(kept)
  }

  return {
    showDecibels,
    showStreamDetails,
    hiddenCameraIds,
    stirringSensitivity,
    setShowDecibels,
    setShowStreamDetails,
    isCameraHidden,
    setCameraHidden,
    pruneHiddenCameras,
    sensitivityFor,
    setSensitivity,
    pruneStirringSensitivity,
  }
})
