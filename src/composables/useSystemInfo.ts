import { onScopeDispose, ref, shallowRef } from 'vue'

import type { SystemInfoResponse } from '@shared/api.ts'
import { fetchSystemInfo } from '@/api'

/**
 * Polls the server's read-only settings while the settings page is open, so
 * the Home Assistant status updates as someone fixes HA_URL / HA_TOKEN.
 */
export function useSystemInfo(intervalMs = 10_000) {
  const info = shallowRef<SystemInfoResponse>()
  const error = ref<string>()

  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  async function poll() {
    try {
      info.value = await fetchSystemInfo()
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

  return { info, error }
}
