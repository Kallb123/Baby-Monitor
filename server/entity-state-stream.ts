import type { EntityStatesResponse } from '../shared/api.ts'
import type { HomeAssistantClient, HomeAssistantStreamFailure } from './home-assistant.ts'

interface Subscriber {
  send: (response: EntityStatesResponse) => void
  close: () => void
}

/** One HA connection shared by all viewers, released when the last viewer leaves. */
export class EntityStateStream {
  readonly #homeAssistant: HomeAssistantClient | undefined
  readonly #subscribers = new Set<Subscriber>()
  readonly #onUnavailable: (failure: HomeAssistantStreamFailure) => void
  #entityIds: string[] = []
  #snapshot: EntityStatesResponse | undefined
  #stop: (() => void) | undefined

  constructor(
    homeAssistant?: HomeAssistantClient,
    onUnavailable: (failure: HomeAssistantStreamFailure) => void = () => {},
  ) {
    this.#homeAssistant = homeAssistant
    this.#onUnavailable = onUnavailable
  }

  setEntities(ids: string[]) {
    if (JSON.stringify([...ids].sort()) === JSON.stringify([...this.#entityIds].sort())) return
    this.#entityIds = ids
    // Reconnecting viewers take a fresh snapshot and cannot retain removed entities.
    this.close()
  }

  subscribe(send: Subscriber['send'], close: Subscriber['close']): () => void {
    const subscriber = { send, close }
    this.#subscribers.add(subscriber)
    if (this.#snapshot) send(this.#snapshot)
    else if (!this.#homeAssistant || this.#entityIds.length === 0) {
      this.#publish({ configured: Boolean(this.#homeAssistant), states: {} })
    } else if (!this.#stop) {
      this.#stop = this.#homeAssistant.watchStates(
        this.#entityIds,
        (states) => this.#publish({ configured: true, states }),
        (failure) => {
          this.#onUnavailable(failure)
          this.close()
        },
      )
    }
    return () => {
      this.#subscribers.delete(subscriber)
      if (this.#subscribers.size === 0) this.#reset()
    }
  }

  #publish(response: EntityStatesResponse) {
    this.#snapshot = response
    for (const subscriber of this.#subscribers) subscriber.send(response)
  }

  #reset() {
    this.#stop?.()
    this.#stop = undefined
    this.#snapshot = undefined
  }

  close() {
    this.#reset()
    const subscribers = [...this.#subscribers]
    this.#subscribers.clear()
    for (const subscriber of subscribers) subscriber.close()
  }
}
