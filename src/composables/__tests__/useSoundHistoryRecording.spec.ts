import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { useSoundHistoryStore } from '@/stores/sound-history'
import { useSoundHistoryRecording } from '../useSoundHistoryRecording'

const NOW = Date.UTC(2026, 9, 23, 2, 0, 0)

describe('useSoundHistoryRecording', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => vi.useRealTimers())

  function setup(initialDb: number | undefined) {
    const db = ref<number | undefined>(initialDb)
    const stirring = ref(false)
    const scope = effectScope()
    scope.run(() => useSoundHistoryRecording('nursery', db, stirring))
    const store = useSoundHistoryStore()
    const record = vi.spyOn(store, 'record')
    return { db, stirring, scope, record }
  }

  it('samples about once a second, not at the meter rate', async () => {
    const { record, scope } = setup(-40)
    await vi.advanceTimersByTimeAsync(3_500)
    expect(record).toHaveBeenCalledTimes(3)
    expect(record).toHaveBeenLastCalledWith('nursery', -40, false)
    scope.stop()
  })

  it('records nothing while there is no level', async () => {
    const { record, scope } = setup(undefined)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(record).not.toHaveBeenCalled()
    scope.stop()
  })

  it('starts when the level appears, passes the current stirring flag, and stops when it goes', async () => {
    const { db, stirring, record, scope } = setup(undefined)

    db.value = -35
    stirring.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenLastCalledWith('nursery', -35, true)

    db.value = undefined
    await nextTick()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(record).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('releases its timer with the scope', async () => {
    const { record, scope } = setup(-40)
    scope.stop()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(record).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
