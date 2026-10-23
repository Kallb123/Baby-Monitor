import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import type { StreamQualityPreference } from '@/lib/stream-quality'
import { QUALITY_DEBOUNCE_MS, useStreamQuality } from '../useStreamQuality'

const width = ref(0)
vi.mock('@/composables/useElementSize', () => ({ useElementSize: () => ({ width }) }))

describe('useStreamQuality', () => {
  let scope: ReturnType<typeof effectScope>
  const preference = ref<StreamQualityPreference>('auto')
  const hasSub = ref(true)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', class {})
    vi.stubGlobal('devicePixelRatio', 1)
    width.value = 0
    preference.value = 'auto'
    hasSub.value = true
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const setup = () => scope.run(() => useStreamQuality(ref(document.body), { preference, hasSub }))!

  it('makes no decision until the first real size measurement', async () => {
    const { quality } = setup()
    expect(quality.value).toBeUndefined()

    width.value = 400
    await nextTick()
    expect(quality.value).toBe('sub')
  })

  it('decides from physical pixels, so a high-density screen gets the main stream sooner', async () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const { quality } = setup()
    width.value = 700
    await nextTick()
    expect(quality.value).toBe('main')
  })

  it('decides at once, without measuring, when the size cannot matter', () => {
    hasSub.value = false
    expect(setup().quality.value).toBe('main')

    scope.stop()
    scope = effectScope()
    hasSub.value = true
    preference.value = 'sub'
    expect(setup().quality.value).toBe('sub')
  })

  it('does not wait for a measurement that will never come', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    expect(setup().quality.value).toBe('main')
  })

  it('switches only after the width has settled for the debounce period', async () => {
    const { quality } = setup()
    width.value = 400
    await nextTick()
    expect(quality.value).toBe('sub')

    width.value = 1500
    await nextTick()
    await vi.advanceTimersByTimeAsync(QUALITY_DEBOUNCE_MS - 1)
    expect(quality.value).toBe('sub')
    await vi.advanceTimersByTimeAsync(1)
    expect(quality.value).toBe('main')
  })

  it('ignores a width that passes through and returns before the debounce ends', async () => {
    const { quality } = setup()
    width.value = 400
    await nextTick()

    width.value = 1500
    await nextTick()
    await vi.advanceTimersByTimeAsync(1000)
    width.value = 500
    await nextTick()
    await vi.advanceTimersByTimeAsync(QUALITY_DEBOUNCE_MS * 2)
    expect(quality.value).toBe('sub')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the current stream while the width is between the thresholds', async () => {
    const { quality } = setup()
    width.value = 400
    await nextTick()
    width.value = 1100
    await nextTick()
    await vi.advanceTimersByTimeAsync(QUALITY_DEBOUNCE_MS * 2)
    expect(quality.value).toBe('sub')
  })

  it('ignores a zero width after the first decision', async () => {
    const { quality } = setup()
    width.value = 1500
    await nextTick()
    width.value = 0
    await nextTick()
    await vi.advanceTimersByTimeAsync(QUALITY_DEBOUNCE_MS * 2)
    expect(quality.value).toBe('main')
  })

  it('applies a preference or sub-stream change immediately', async () => {
    const { quality } = setup()
    width.value = 400
    await nextTick()
    expect(quality.value).toBe('sub')

    preference.value = 'main'
    await nextTick()
    expect(quality.value).toBe('main')

    preference.value = 'auto'
    await nextTick()
    // Back to automatic: the small tile moves to sub only after the debounce.
    expect(quality.value).toBe('main')
    await vi.advanceTimersByTimeAsync(QUALITY_DEBOUNCE_MS)
    expect(quality.value).toBe('sub')

    hasSub.value = false
    await nextTick()
    expect(quality.value).toBe('main')
  })

  it('releases its timer when the scope stops', async () => {
    const { quality } = setup()
    width.value = 400
    await nextTick()
    width.value = 1500
    await nextTick()
    expect(vi.getTimerCount()).toBe(1)
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(quality.value).toBe('sub')
  })
})
