import type { ApiError, EntityStatesResponse } from '@shared/api.ts'
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiError | undefined
    throw new ApiRequestError(response.status, body)
  }
  return (await response.json()) as T
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

export function fetchEntityStates(): Promise<EntityStatesResponse> {
  return request('/api/ha/states')
}

/** Sends a WebRTC SDP offer for a camera and returns the SDP answer. */
export async function negotiateWebRtc(cameraId: string, offerSdp: string): Promise<string> {
  const response = await fetch(`/api/streams/${encodeURIComponent(cameraId)}/webrtc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offerSdp,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiError | undefined
    throw new ApiRequestError(response.status, body)
  }
  return response.text()
}
