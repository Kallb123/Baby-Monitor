/** Wire types for the server's REST API, shared by client and server. */

export interface EntityState {
  entityId: string
  /** Raw Home Assistant state, e.g. "on", "off", "21.4", "unavailable". */
  state: string
  unit?: string
  friendlyName?: string
  lastChanged: string
}

export interface EntityStatesResponse {
  /** False when HA_URL / HA_TOKEN are not set on the server. */
  configured: boolean
  states: Record<string, EntityState>
}

export interface ApiError {
  error: string
  /** Validation issues, present on 400 responses to config writes. */
  issues?: { path: (string | number)[]; message: string }[]
}

export interface HealthResponse {
  ok: true
  homeAssistant: boolean
  go2rtc: string
}

/**
 * `connected`: HA answered with the configured token. `error`: it is
 * configured but unreachable or rejected the token. `unconfigured`: HA_URL or
 * HA_TOKEN is not set.
 */
export type HomeAssistantStatus = 'connected' | 'error' | 'unconfigured'

/** Read-only server settings shown on the settings page. Never includes secrets. */
export interface SystemInfoResponse {
  homeAssistant: {
    /** HA_URL with any credentials removed; undefined when it is not set. */
    url?: string
    status: HomeAssistantStatus
    /** Why it is not connected. */
    message?: string
  }
  go2rtc: { url?: string }
}
