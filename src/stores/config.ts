import { defineStore } from 'pinia'
import { ref } from 'vue'

import { fetchConfig, saveConfig } from '@/api'
import { defaultConfig, type AppConfig } from '@shared/config.ts'

/** Server-persisted app config. The server validates and is the source of truth. */
export const useConfigStore = defineStore('config', () => {
  const config = ref<AppConfig>(defaultConfig())
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string>()

  async function load() {
    loading.value = true
    error.value = undefined
    try {
      config.value = await fetchConfig()
      loaded.value = true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  /** Saves and adopts the server's normalised copy. Rethrows so forms can show field errors. */
  async function save(next: AppConfig) {
    config.value = await saveConfig(next)
    loaded.value = true
  }

  return { config, loaded, loading, error, load, save }
})
