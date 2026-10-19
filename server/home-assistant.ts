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

interface CompressedEntity {
  s: string
  a: NonNullable<HaStateBody['attributes']>
  lc: number
}

interface EntityUpdates {
  a?: Record<string, CompressedEntity>
  r?: string[]
  c?: Record<string, { '+'?: Partial<CompressedEntity>; '-'?: { a: string[] } }>
}

export interface HomeAssistantStreamFailure {
  phase: 'connecting' | 'authenticating' | 'subscribing' | 'snapshot' | 'live'
  reason:
    | 'auth_invalid'
    | 'subscription_rejected'
    | 'invalid_message'
    | 'socket_error'
    | 'socket_closed'
    | 'connection_error'
    | 'send_error'
    | 'timeout'
}

/** HA's subscribe_entities stream sends a compact snapshot followed by attribute/state diffs. */
function applyEntityUpdates(
  states: Record<string, EntityState>,
  updates: EntityUpdates,
  wanted: Set<string>,
) {
  for (const [id, body] of Object.entries(updates.a ?? {})) {
    if (!wanted.has(id)) continue
    states[id] = entityState({
      entity_id: id,
      state: body.s,
      attributes: body.a,
      last_changed: new Date(body.lc * 1000).toISOString(),
    })
  }
  for (const id of updates.r ?? []) delete states[id]
  for (const [id, diff] of Object.entries(updates.c ?? {})) {
    const previous = states[id]
    if (!wanted.has(id) || !previous) continue
    const next = { ...previous }
    const added = diff['+']
    if (added?.s !== undefined) next.state = added.s
    if (added?.lc !== undefined) next.lastChanged = new Date(added.lc * 1000).toISOString()
    if (added?.a && 'unit_of_measurement' in added.a) next.unit = added.a.unit_of_measurement
    if (added?.a && 'friendly_name' in added.a) next.friendlyName = added.a.friendly_name
    for (const key of diff['-']?.a ?? []) {
      if (key === 'unit_of_measurement') delete next.unit
      if (key === 'friendly_name') delete next.friendlyName
    }
    states[id] = next
  }
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

  /** HA filters and snapshots the subscription atomically, without an all-entity REST fetch. */
  watchStates(
    entityIds: string[],
    onStates: (states: Record<string, EntityState>) => void,
    onUnavailable: (failure: HomeAssistantStreamFailure) => void,
  ): () => void {
    const wanted = new Set(entityIds)
    let socket: WebSocket | undefined
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const states: Record<string, EntityState> = {}
    let phase: HomeAssistantStreamFailure['phase'] = 'connecting'
    let nextId = 2
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
    const fail = (reason: HomeAssistantStreamFailure['reason']) => {
      if (stopped) return
      stop()
      // Only local enum values cross this boundary, never HA payloads, URLs or errors.
      onUnavailable({ phase, reason })
    }
    const deadline = () => {
      clearTimeout(timer)
      timer = setTimeout(() => fail('timeout'), this.#timeoutMs)
    }
    const send = (message: object) => socket!.send(JSON.stringify(message))

    try {
      const url = new URL(`${this.baseUrl.replace(/\/+$/, '')}/api/websocket`)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = this.#createWebSocket(url.toString())
      socket.onerror = () => fail('socket_error')
      socket.onclose = () => fail('socket_closed')
      socket.onmessage = (event) => {
        if (stopped) return
        try {
          const message = JSON.parse(String(event.data)) as {
            type: string
            id?: number
            success?: boolean
            event?: EntityUpdates
          }
          if (message.type === 'auth_invalid') return fail('auth_invalid')
          if (message.type === 'auth_required' && phase === 'connecting') {
            phase = 'authenticating'
            send({ type: 'auth', access_token: this.#token })
            deadline()
          } else if (message.type === 'auth_ok' && phase === 'authenticating') {
            phase = 'subscribing'
            send({ id: 1, type: 'subscribe_entities', entity_ids: entityIds })
            deadline()
          } else if (message.type === 'result' && message.id === 1 && phase === 'subscribing') {
            if (!message.success) return fail('subscription_rejected')
            phase = 'snapshot'
            deadline()
          } else if (message.type === 'event' && message.id === 1) {
            if (!message.event || (phase !== 'snapshot' && phase !== 'live')) {
              return fail('invalid_message')
            }
            applyEntityUpdates(states, message.event, wanted)
            onStates({ ...states })
            if (phase === 'live' || stopped) return
            phase = 'live'
            clearTimeout(timer)
            // A quiet nursery is normal; ping/pong detects a half-open HA connection.
            heartbeat = setInterval(() => {
              if (pingId !== undefined) return
              try {
                pingId = nextId++
                send({ id: pingId, type: 'ping' })
                deadline()
              } catch {
                fail('send_error')
              }
            }, 30_000)
          } else if (message.type === 'pong' && pingId !== undefined && message.id === pingId) {
            clearTimeout(timer)
            pingId = undefined
          }
        } catch {
          // Errors can contain the URL or token. Only signal availability to callers.
          fail('invalid_message')
        }
      }
      deadline()
    } catch {
      // Let the caller register its disposer before reporting synchronous setup failures.
      queueMicrotask(() => fail('connection_error'))
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
