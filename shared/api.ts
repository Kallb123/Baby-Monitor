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
