import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { z } from 'zod'

import { readStored, writeStored } from '@/lib/local-storage'

const SETTINGS_STORAGE_KEY = 'baby-monitor:settings'

// Each field is optional so settings added later don't discard older saves.
const storedSettingsSchema = z.object({
  showDecibels: z.boolean().optional(),
})

/**
 * App settings for this device only, kept in localStorage. Like the layout,
 * they stay off the server: a config save re-registers every go2rtc stream.
 */
export const useSettingsStore = defineStore('settings', () => {
  const stored = readStored(SETTINGS_STORAGE_KEY, storedSettingsSchema) ?? {}
  /** Show each tile's sound level as a dBFS number beside the meter. */
  const showDecibels = ref(stored.showDecibels ?? false)

  watch(showDecibels, (show) => writeStored(SETTINGS_STORAGE_KEY, { showDecibels: show }))

  function setShowDecibels(on: boolean) {
    showDecibels.value = on
  }

  return { showDecibels, setShowDecibels }
})
