import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type Ref } from 'vue'

import type { Sensitivity } from '@/lib/sound-status'
import { useStirring } from '../useStirring'

describe('useStirring', () => {
  const scopes: ReturnType<typeof effectScope>[] = []

  function setup(initial: Sensitivity = 'medium') {
    const db = ref<number>()
    const sensitivity = ref<Sensitivity>(initial)
    const scope = effectScope()
    scopes.push(scope)
    const result = scope.run(() => useStirring(db, sensitivity))!
    return { db, sensitivity, scope, ...result }
  }

  /** One sample, as `useAudioLevel` emits them, then lets the watcher run. */
  async function sample(db: Ref<number | undefined>, value: number | undefined) {
    db.value = value
    await nextTick()
  }

  /** Steady room tone for `seconds`, advancing the fake clock at ~15 Hz. */
  async function hum(db: Ref<number | undefined>, value: number, seconds: number) {
    for (let i = 0; i < seconds * 15; i++) {
      // Alternating by a hair so the ref sees a change on every sample.
      await sample(db, value + (i % 2) * 0.01)
      vi.advanceTimersByTime(66)
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
  })

  afterEach(() => {
    scopes.splice(0).forEach((scope) => scope.stop())
    vi.useRealTimers()
  })

  it('starts quiet and ignores unmeasured samples', async () => {
    const { db, stirring, floorDb } = setup()
    await sample(db, undefined)
    expect(stirring.value).toBe(false)
    expect(floorDb.value).toBeUndefined()
  })

  it('uses the minimum threshold until the background is learned', async () => {
    const { db, stirring, thresholdDb } = setup()
    expect(thresholdDb.value).toBe(-43)
    await sample(db, -44)
    expect(stirring.value).toBe(false)
    await sample(db, -42)
    expect(stirring.value).toBe(true)
  })

  it('holds stirring for three seconds after the last loud sample', async () => {
    const { db, stirring } = setup()
    await sample(db, -30)
    expect(stirring.value).toBe(true)

    await sample(db, -70)
    vi.advanceTimersByTime(2900)
    expect(stirring.value).toBe(true)
    vi.advanceTimersByTime(200)
    expect(stirring.value).toBe(false)
  })

  it('restarts the hold on every loud sample', async () => {
    const { db, stirring } = setup()
    await sample(db, -30)
    vi.advanceTimersByTime(2000)
    await sample(db, -31)
    vi.advanceTimersByTime(2000)
    expect(stirring.value).toBe(true)
    vi.advanceTimersByTime(1100)
    expect(stirring.value).toBe(false)
  })

  it('learns a steady noise and stops reading it as stirring', async () => {
    const { db, stirring, floorDb, thresholdDb } = setup()
    await hum(db, -60, 30)
    expect(floorDb.value).toBeCloseTo(-60, 1)
    expect(thresholdDb.value).toBe(-43)

    // A white-noise machine switches on at -35 dB: stirring at first.
    await hum(db, -35, 1)
    expect(stirring.value).toBe(true)

    await hum(db, -35, 125)
    expect(floorDb.value).toBeCloseTo(-35, 1)
    expect(thresholdDb.value).toBeCloseTo(-25, 1)
    vi.advanceTimersByTime(3500)
    expect(stirring.value).toBe(false)

    // A real disturbance above the noise still registers.
    await sample(db, -20)
    expect(stirring.value).toBe(true)
  })

  it('forgets the learned background on reset and learns the new level', async () => {
    const { db, floorDb, thresholdDb, reset } = setup()
    await hum(db, -60, 30)
    expect(floorDb.value).toBeCloseTo(-60, 1)

    reset()
    expect(floorDb.value).toBeUndefined()
    expect(thresholdDb.value).toBe(-43)

    // The other stream is 20 dB hotter; the old floor must not linger in the window.
    await hum(db, -40, 20)
    expect(floorDb.value).toBeCloseTo(-40, 1)
  })

  it('follows sensitivity changes', async () => {
    const { sensitivity, thresholdDb } = setup()
    expect(thresholdDb.value).toBe(-43)
    sensitivity.value = 'high'
    expect(thresholdDb.value).toBe(-48)
    sensitivity.value = 'low'
    expect(thresholdDb.value).toBe(-38)
  })

  it('releases its timer when the scope stops', async () => {
    const { db, scope, stirring } = setup()
    await sample(db, -30)
    expect(vi.getTimerCount()).toBe(1)
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(stirring.value).toBe(true)
  })
})
