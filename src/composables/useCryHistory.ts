import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'

import type { CryHistoryResponse } from '@shared/api.ts'
import { fetchCryHistory } from '@/api'

/**
 * Crying history from Home Assistant for the last `hours`, refreshed every
 * minute while the scope lives so an ongoing episode keeps growing.
 */
export function useCryHistory(hours: Ref<number>, intervalMs = 60_000) {
  const data = shallowRef<CryHistoryResponse>()
  const error = ref<string>()

  let timer: ReturnType<typeof setTimeout> | undefined
  let request: AbortController | undefined
  let disposed = false

  async function load() {
    request?.abort()
    const controller = new AbortController()
    request = controller
    try {
      const response = await fetchCryHistory(hours.value, controller.signal)
      if (controller.signal.aborted) return
      data.value = response
      error.value = undefined
    } catch (e) {
      if (controller.signal.aborted) return
      // Keep the last good data: a minute of bad Wi-Fi should not blank the chart.
      error.value = e instanceof Error ? e.message : String(e)
    }
    if (!disposed) timer = setTimeout(() => void load(), intervalMs)
  }

  // A different range is a different question, so the old answer must not linger.
  watch(
    hours,
    () => {
      clearTimeout(timer)
      data.value = undefined
      void load()
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    disposed = true
    clearTimeout(timer)
    request?.abort()
  })

  return { data, error }
}
