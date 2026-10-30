import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { z } from 'zod'

import { entityIdSchema } from '@shared/config.ts'
import { batteryDisplays, type BatteryDisplay } from '@/lib/battery'
import { readStored, writeStored } from '@/lib/local-storage'
import { DEFAULT_SENSITIVITY, SENSITIVITIES, type Sensitivity } from '@/lib/sound-status'
import { streamQualityPreferences, type StreamQualityPreference } from '@/lib/stream-quality'

const SETTINGS_STORAGE_KEY = 'baby-monitor:settings'

// Each field is optional so settings added later don't discard older saves.
const storedSettingsSchema = z.object({
  showDecibels: z.boolean().optional(),
  showStreamDetails: z.boolean().optional(),
  hiddenCameraIds: z.array(z.string()).optional(),
  stirringSensitivity: z.record(z.string(), z.enum(SENSITIVITIES)).optional(),
  feedLostAlerts: z.boolean().optional(),
  feedLostSound: z.boolean().optional(),
  streamQuality: z.enum(streamQualityPreferences).optional(),
  batteryDisplay: z.enum(batteryDisplays).optional(),
  batteryEntityId: entityIdSchema.optional(),
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
  /** Warn when a camera feed stays down. On by default: a silent dead feed is the worst failure. */
  const feedLostAlerts = ref(stored.feedLostAlerts ?? true)
  /** Chime and vibrate for a lost feed; the banner shows either way. */
  const feedLostSound = ref(stored.feedLostSound ?? true)
  const hiddenSet = computed(() => new Set(hiddenCameraIds.value))
  /**
   * How easily each camera's tile reads "Stirring". Only non-default choices
   * are kept, so a camera that is absent uses medium. May hold ids of cameras
   * deleted since.
   */
  const stirringSensitivity = ref<Record<string, Sensitivity>>({ ...stored.stirringSensitivity })

  /** Which stream cameras with a sub-stream play: chosen by tile size, or always one. */
  const streamQuality = ref<StreamQualityPreference>(stored.streamQuality ?? 'auto')

  /** When the header shows this device's battery. */
  const batteryDisplay = ref<BatteryDisplay>(stored.batteryDisplay ?? 'fullscreen')
  /**
   * This device's Home Assistant battery sensor, used when the browser can't
   * read the battery itself. The server only serves it while it is listed in
   * the config's `batteryEntities`.
   */
  const batteryEntityId = ref<string | undefined>(stored.batteryEntityId)

  // One write for every field: saving a single one would drop the others.
  watch(
    [
      showDecibels,
      showStreamDetails,
      hiddenCameraIds,
      stirringSensitivity,
      feedLostAlerts,
      feedLostSound,
      streamQuality,
      batteryDisplay,
      batteryEntityId,
    ],
    ([
      decibels,
      details,
      hidden,
      sensitivity,
      lostAlerts,
      lostSound,
      quality,
      battery,
      batteryEntity,
    ]) =>
      writeStored(SETTINGS_STORAGE_KEY, {
        showDecibels: decibels,
        showStreamDetails: details,
        hiddenCameraIds: hidden,
        stirringSensitivity: sensitivity,
        feedLostAlerts: lostAlerts,
        feedLostSound: lostSound,
        streamQuality: quality,
        batteryDisplay: battery,
        batteryEntityId: batteryEntity,
      }),
  )

  function setShowDecibels(on: boolean) {
    showDecibels.value = on
  }

  function setShowStreamDetails(on: boolean) {
    showStreamDetails.value = on
  }

  function setFeedLostAlerts(on: boolean) {
    feedLostAlerts.value = on
  }

  function setFeedLostSound(on: boolean) {
    feedLostSound.value = on
  }

  function setStreamQuality(preference: StreamQualityPreference) {
    streamQuality.value = preference
  }

  function setBatteryDisplay(display: BatteryDisplay) {
    batteryDisplay.value = display
  }

  function setBatteryEntityId(entityId: string | undefined) {
    batteryEntityId.value = entityId
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
    feedLostAlerts,
    feedLostSound,
    setShowDecibels,
    setShowStreamDetails,
    setFeedLostAlerts,
    setFeedLostSound,
    streamQuality,
    setStreamQuality,
    batteryDisplay,
    setBatteryDisplay,
    batteryEntityId,
    setBatteryEntityId,
    isCameraHidden,
    setCameraHidden,
    pruneHiddenCameras,
    sensitivityFor,
    setSensitivity,
    pruneStirringSensitivity,
  }
})
