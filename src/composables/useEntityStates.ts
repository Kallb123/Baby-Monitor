import { onScopeDispose, ref, shallowRef } from 'vue'

import type { EntityState } from '@shared/api.ts'
import { fetchEntityStates } from '@/api'

/**
 * Polls the server for the Home Assistant entities referenced by the config.
 *
 * TODO: replace polling with a server-sent event stream fed by the HA
 * WebSocket API, so cry alerts are near-instant.
 */
export function useEntityStates(intervalMs = 3000) {
  const states = shallowRef<Record<string, EntityState>>({})
  const configured = ref(true)
  const error = ref<string>()

  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  async function poll() {
    try {
      const response = await fetchEntityStates()
      states.value = response.states
      configured.value = response.configured
      error.value = undefined
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
    if (!disposed) timer = setTimeout(poll, intervalMs)
  }

  void poll()

  onScopeDispose(() => {
    disposed = true
    clearTimeout(timer)
  })

  return { states, configured, error }
}
