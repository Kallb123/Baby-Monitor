import type {
  ApiError,
  CryHistoryResponse,
  EntityStatesResponse,
  SystemInfoResponse,
} from '@shared/api.ts'
import type { AppConfig } from '@shared/config.ts'

export class ApiRequestError extends Error {
  readonly status: number
  readonly body: ApiError | undefined

  constructor(status: number, body: ApiError | undefined) {
    super(body?.error ?? `Request failed (${status})`)
    this.status = status
    this.body = body
  }
}

const REQUEST_TIMEOUT_MS = 10_000

// A timeout matters on flaky tablet Wi-Fi: a hung request must not stall polling forever.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort(init?.signal?.reason)
  const timer = setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    REQUEST_TIMEOUT_MS,
  )
  // Link cancellation manually for tablets that do not support AbortSignal.any.
  init?.signal?.addEventListener('abort', abort, { once: true })
  if (init?.signal?.aborted) abort()
  try {
    const response = await fetch(path, { ...init, signal: controller.signal })
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as ApiError | undefined
      throw new ApiRequestError(response.status, body)
    }
    return (await response.json()) as T
  } finally {
    clearTimeout(timer)
    init?.signal?.removeEventListener('abort', abort)
  }
}

export function fetchConfig(): Promise<AppConfig> {
  return request('/api/config')
}

export function saveConfig(config: AppConfig): Promise<AppConfig> {
  return request('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
}

export function fetchEntityStates(signal?: AbortSignal): Promise<EntityStatesResponse> {
  return request('/api/ha/states', { signal })
}

export function fetchCryHistory(hours: number, signal?: AbortSignal): Promise<CryHistoryResponse> {
  return request(`/api/ha/history?hours=${hours}`, { signal })
}

export function fetchSystemInfo(): Promise<SystemInfoResponse> {
  return request('/api/system')
}

/** Sends a WebRTC SDP offer for a camera and returns the SDP answer. */
export async function negotiateWebRtc(cameraId: string, offerSdp: string): Promise<string> {
  const response = await fetch(`/api/streams/${encodeURIComponent(cameraId)}/webrtc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offerSdp,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiError | undefined
    throw new ApiRequestError(response.status, body)
  }
  return response.text()
}
