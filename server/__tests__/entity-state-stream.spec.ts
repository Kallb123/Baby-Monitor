import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EntityStateStream } from '../entity-state-stream.ts'
import { HomeAssistantClient } from '../home-assistant.ts'

describe('shared entity state stream', () => {
  const ha = new HomeAssistantClient({ baseUrl: 'http://ha:8123', token: 'private-token' })
  const stop = vi.fn<() => void>()
  const watch = vi.spyOn(ha, 'watchStates').mockReturnValue(stop)
  let stream: EntityStateStream

  beforeEach(() => {
    vi.clearAllMocks()
    stream = new EntityStateStream(ha)
    stream.setEntities(['sensor.temp'])
  })

  it('shares one connection, replays its snapshot and stops after the last viewer leaves', () => {
    const first = vi.fn<Parameters<EntityStateStream['subscribe']>[0]>()
    const unsubscribe = stream.subscribe(first, vi.fn())
    const states = {
      'sensor.temp': { entityId: 'sensor.temp', state: '21', lastChanged: 'now', unit: '°C' },
    }
    watch.mock.lastCall![1](states)
    const second = vi.fn<Parameters<EntityStateStream['subscribe']>[0]>()
    const leave = stream.subscribe(second, vi.fn())
    expect(watch).toHaveBeenCalledOnce()
    expect(first).toHaveBeenLastCalledWith({ configured: true, states })
    expect(second).toHaveBeenLastCalledWith({ configured: true, states })
    unsubscribe()
    expect(stop).not.toHaveBeenCalled()
    leave()
    expect(stop).toHaveBeenCalledOnce()
    stream.subscribe(vi.fn(), vi.fn())()
    expect(watch).toHaveBeenCalledTimes(2)
  })

  it('closes viewers on upstream failure so they can poll and reconnect', () => {
    const close = vi.fn<() => void>()
    stream.subscribe(vi.fn(), close)
    watch.mock.lastCall![2]({ phase: 'live', reason: 'socket_error' })
    expect(close).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
    stream.subscribe(vi.fn(), vi.fn())()
    expect(watch).toHaveBeenCalledTimes(2)
  })

  it('reconnects with new entity ids after config changes and drops cached states', () => {
    const close = vi.fn<() => void>()
    stream.subscribe(vi.fn(), close)
    watch.mock.lastCall![1]({})
    stream.setEntities(['binary_sensor.cry'])
    expect(close).toHaveBeenCalledOnce()
    const send = vi.fn<Parameters<EntityStateStream['subscribe']>[0]>()
    stream.subscribe(send, vi.fn())()
    expect(send).not.toHaveBeenCalled()
    expect(watch.mock.lastCall![0]).toEqual(['binary_sensor.cry'])
  })

  it('keeps the connection when the referenced entities have not changed', () => {
    const close = vi.fn<() => void>()
    const leave = stream.subscribe(vi.fn(), close)
    stream.setEntities(['sensor.temp'])
    expect(close).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    leave()
  })

  it.each([false, true])('sends an empty snapshot without HA traffic (configured=%s)', (hasHa) => {
    const empty = new EntityStateStream(hasHa ? ha : undefined)
    const send = vi.fn<Parameters<EntityStateStream['subscribe']>[0]>()
    empty.subscribe(send, vi.fn())()
    expect(send).toHaveBeenCalledWith({ configured: hasHa, states: {} })
    expect(watch).not.toHaveBeenCalled()
  })
})
