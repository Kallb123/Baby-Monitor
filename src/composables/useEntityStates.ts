import { onScopeDispose, ref, shallowRef } from 'vue'

import type { EntityState, EntityStatesResponse } from '@shared/api.ts'
import { fetchEntityStates } from '@/api'

/** Live HA snapshots over SSE, with REST polling only while the stream is unavailable. */
export function useEntityStates(intervalMs = 3000) {
  const states = shallowRef<Record<string, EntityState>>({})
  const configured = ref(true)
  const error = ref<string>()

  let source: EventSource | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let request: AbortController | undefined
  let polling = false
  let disposed = false
  let revision = 0
  let retryMs = intervalMs

  function adopt(response: EntityStatesResponse) {
    states.value = response.states
    configured.value = response.configured
    error.value = undefined
  }

  async function poll() {
    if (disposed || !polling || request) return
    const controller = new AbortController()
    request = controller
    const startedAt = revision
    try {
      const response = await fetchEntityStates(controller.signal)
      if (!disposed && polling && revision === startedAt) adopt(response)
    } catch (e) {
      if (!disposed && polling && revision === startedAt) {
        error.value = e instanceof Error ? e.message : String(e)
      }
    } finally {
      request = undefined
      if (!disposed && polling) pollTimer = setTimeout(poll, intervalMs)
    }
  }

  function fallback() {
    if (disposed) return
    source?.close()
    source = undefined
    clearTimeout(watchdog)
    if (!polling) {
      polling = true
      revision++
      void poll()
    }
    clearTimeout(retryTimer)
    if (typeof EventSource !== 'undefined') {
      retryTimer = setTimeout(connect, retryMs)
      retryMs = Math.min(retryMs * 2, 60_000)
    }
  }

  function armWatchdog(timeoutMs: number) {
    clearTimeout(watchdog)
    watchdog = setTimeout(fallback, timeoutMs)
  }

  function connect() {
    if (disposed) return
    if (typeof EventSource === 'undefined') return fallback()
    try {
      const connection = new EventSource('/api/ha/events')
      let ready = false
      source = connection
      // Opening HTTP alone is insufficient: wait for the initial HA snapshot.
      armWatchdog(10_000)
      connection.onmessage = (event) => {
        if (disposed || source !== connection) return
        try {
          const response = JSON.parse(event.data) as EntityStatesResponse
          if (typeof response.configured !== 'boolean' || !response.states) return fallback()
          revision++
          ready = true
          retryMs = intervalMs
          polling = false
          clearTimeout(pollTimer)
          request?.abort()
          adopt(response)
          armWatchdog(45_000)
        } catch {
          fallback()
        }
      }
      connection.addEventListener('heartbeat', () => {
        if (!disposed && source === connection && ready) armWatchdog(45_000)
      })
      connection.onerror = () => {
        if (source === connection) fallback()
      }
    } catch {
      fallback()
    }
  }

  connect()

  onScopeDispose(() => {
    disposed = true
    source?.close()
    request?.abort()
    clearTimeout(pollTimer)
    clearTimeout(retryTimer)
    clearTimeout(watchdog)
  })

  return { states, configured, error }
}
