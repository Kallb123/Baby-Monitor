import type { EntityState } from '../shared/api.ts'

export interface HomeAssistantOptions {
  baseUrl: string
  token: string
  fetch?: typeof fetch
  timeoutMs?: number
  createWebSocket?: (url: string) => WebSocket
}

interface HaStateBody {
  entity_id: string
  state: string
  last_changed: string
  attributes?: { unit_of_measurement?: string; friendly_name?: string }
}

function entityState(body: HaStateBody): EntityState {
  return {
    entityId: body.entity_id,
    state: body.state,
    unit: body.attributes?.unit_of_measurement,
    friendlyName: body.attributes?.friendly_name,
    lastChanged: body.last_changed,
  }
}

function fetchFailureReason(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'timed out'
  // Node's fetch says "fetch failed" and keeps the useful part (ECONNREFUSED,
  // ENOTFOUND, …) in `cause`.
  const cause = (error as { cause?: unknown }).cause
  if (cause instanceof Error) return cause.message
  // Anything else may echo the request URL, credentials and all.
  return 'request failed'
}

/**
 * Home Assistant client. Runs server-side only so the
 * long-lived token never reaches the browser.
 */
export class HomeAssistantClient {
  readonly baseUrl: string
  readonly #token: string
  readonly #fetch: typeof fetch
  readonly #timeoutMs: number
  readonly #createWebSocket: (url: string) => WebSocket

  constructor(options: HomeAssistantOptions) {
    this.baseUrl = options.baseUrl
    this.#token = options.token
    this.#fetch = options.fetch ?? fetch
    this.#timeoutMs = options.timeoutMs ?? 5000
    this.#createWebSocket = options.createWebSocket ?? ((url) => new WebSocket(url))
  }

  /** Subscribe before taking the snapshot so changes during setup cannot be missed. */
  watchStates(
    entityIds: string[],
    onStates: (states: Record<string, EntityState>) => void,
    onUnavailable: () => void,
  ): () => void {
    const wanted = new Set(entityIds)
    let socket: WebSocket | undefined
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let states: Record<string, EntityState> | undefined
    const pending = new Map<string, HaStateBody | null>()
    let phase: 'auth_required' | 'auth_ok' | 'subscribe' | 'snapshot' | 'live' = 'auth_required'
    let nextId = 3
    let pingId: number | undefined

    const stop = () => {
      if (stopped) return
      stopped = true
      clearTimeout(timer)
      clearInterval(heartbeat)
      if (socket) {
        socket.onmessage = socket.onerror = socket.onclose = null
        socket.close()
      }
    }
    const fail = () => {
      if (stopped) return
      stop()
      onUnavailable()
    }
    const deadline = () => {
      clearTimeout(timer)
      timer = setTimeout(fail, this.#timeoutMs)
    }
    const send = (message: object) => socket!.send(JSON.stringify(message))
    const apply = (id: string, body: HaStateBody | null) => {
      if (body) states![id] = entityState(body)
      else delete states![id]
    }

    try {
      const url = new URL(`${this.baseUrl.replace(/\/+$/, '')}/api/websocket`)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = this.#createWebSocket(url.toString())
      socket.onerror = socket.onclose = fail
      socket.onmessage = (event) => {
        if (stopped) return
        try {
          const message = JSON.parse(String(event.data)) as {
            type: string
            id?: number
            success?: boolean
            result?: HaStateBody[]
            event?: { data: { entity_id: string; new_state: HaStateBody | null } }
          }
          if (message.type === 'auth_invalid') return fail()
          if (message.type === 'auth_required' && phase === 'auth_required') {
            phase = 'auth_ok'
            send({ type: 'auth', access_token: this.#token })
            deadline()
          } else if (message.type === 'auth_ok' && phase === 'auth_ok') {
            phase = 'subscribe'
            send({ id: 1, type: 'subscribe_events', event_type: 'state_changed' })
            deadline()
          } else if (message.type === 'result' && message.id === 1 && phase === 'subscribe') {
            if (!message.success) return fail()
            phase = 'snapshot'
            send({ id: 2, type: 'get_states' })
            deadline()
          } else if (message.type === 'result' && message.id === 2 && phase === 'snapshot') {
            if (!message.success || !Array.isArray(message.result)) return fail()
            states = {}
            for (const body of message.result) {
              if (wanted.has(body.entity_id)) apply(body.entity_id, body)
            }
            for (const [id, body] of pending) apply(id, body)
            pending.clear()
            phase = 'live'
            clearTimeout(timer)
            onStates({ ...states })
            // A quiet nursery is normal; ping/pong detects a half-open HA connection.
            heartbeat = setInterval(() => {
              if (pingId !== undefined) return
              try {
                pingId = nextId++
                send({ id: pingId, type: 'ping' })
                deadline()
              } catch {
                fail()
              }
            }, 30_000)
          } else if (message.type === 'pong' && pingId !== undefined && message.id === pingId) {
            clearTimeout(timer)
            pingId = undefined
          } else if (message.type === 'event' && message.id === 1 && message.event) {
            const { entity_id: id, new_state: body } = message.event.data
            if (!wanted.has(id)) return
            if (!states) pending.set(id, body)
            else {
              apply(id, body)
              onStates({ ...states })
            }
          }
        } catch {
          // Errors can contain the URL or token. Only signal availability to callers.
          fail()
        }
      }
      deadline()
    } catch {
      // Let the caller register its disposer before reporting synchronous setup failures.
      queueMicrotask(fail)
    }
    return stop
  }

  /**
   * Fetches the given entities. Missing entities are left out; failed fetches
   * are left out of `states` and reported in `errors` so callers can log them.
   */
  async getStates(
    entityIds: string[],
  ): Promise<{ states: Record<string, EntityState>; errors: unknown[] }> {
    const results = await Promise.allSettled(entityIds.map((id) => this.#getState(id)))
    const states: Record<string, EntityState> = {}
    const errors: unknown[] = []
    for (const result of results) {
      if (result.status === 'rejected') errors.push(result.reason)
      else if (result.value) states[result.value.entityId] = result.value
    }
    return { states, errors }
  }

  /**
   * Checks the URL and token against HA's API root. Resolves with why it
   * failed, worded for someone fixing HA_URL / HA_TOKEN, or undefined when
   * connected.
   */
  async check(): Promise<string | undefined> {
    let response: Response
    try {
      response = await this.#fetch(`${this.baseUrl}/api/`, {
        headers: { Authorization: `Bearer ${this.#token}` },
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
    } catch (error) {
      return `Can't reach Home Assistant: ${fetchFailureReason(error)}`
    }
    await response.body?.cancel().catch(() => {})
    if (response.status === 401 || response.status === 403) {
      return 'Home Assistant rejected the token (check HA_TOKEN)'
    }
    if (!response.ok) return `Home Assistant responded ${response.status}`
    return undefined
  }

  async #getState(entityId: string): Promise<EntityState | undefined> {
    const response = await this.#fetch(
      `${this.baseUrl}/api/states/${encodeURIComponent(entityId)}`,
      {
        headers: { Authorization: `Bearer ${this.#token}` },
        signal: AbortSignal.timeout(this.#timeoutMs),
      },
    )
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(`Home Assistant ${response.status} for ${entityId}`)
    const body = (await response.json()) as HaStateBody
    return entityState(body)
  }
}
