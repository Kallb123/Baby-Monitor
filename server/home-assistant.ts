import type { EntityState } from '../shared/api.ts'

export interface HomeAssistantOptions {
  baseUrl: string
  token: string
  fetch?: typeof fetch
  timeoutMs?: number
}

interface HaStateBody {
  entity_id: string
  state: string
  last_changed: string
  attributes?: { unit_of_measurement?: string; friendly_name?: string }
}

/**
 * Minimal Home Assistant REST client. Runs server-side only so the
 * long-lived token never reaches the browser.
 *
 * TODO: switch to the HA WebSocket API (subscribe_entities) and push updates
 * to clients, so cry alerts arrive without polling latency.
 */
export class HomeAssistantClient {
  readonly #baseUrl: string
  readonly #token: string
  readonly #fetch: typeof fetch
  readonly #timeoutMs: number

  constructor(options: HomeAssistantOptions) {
    this.#baseUrl = options.baseUrl
    this.#token = options.token
    this.#fetch = options.fetch ?? fetch
    this.#timeoutMs = options.timeoutMs ?? 5000
  }

  /** Fetches the given entities. Entities that are missing or fail are left out. */
  async getStates(entityIds: string[]): Promise<Record<string, EntityState>> {
    const results = await Promise.allSettled(entityIds.map((id) => this.#getState(id)))
    const states: Record<string, EntityState> = {}
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        states[result.value.entityId] = result.value
      }
    }
    return states
  }

  async #getState(entityId: string): Promise<EntityState | undefined> {
    const response = await this.#fetch(
      `${this.#baseUrl}/api/states/${encodeURIComponent(entityId)}`,
      {
        headers: { Authorization: `Bearer ${this.#token}` },
        signal: AbortSignal.timeout(this.#timeoutMs),
      },
    )
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(`Home Assistant ${response.status} for ${entityId}`)
    const body = (await response.json()) as HaStateBody
    return {
      entityId: body.entity_id,
      state: body.state,
      unit: body.attributes?.unit_of_measurement,
      friendlyName: body.attributes?.friendly_name,
      lastChanged: body.last_changed,
    }
  }
}
