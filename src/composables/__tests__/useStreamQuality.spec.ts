import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import type { StreamQualityPreference } from '@/lib/stream-quality'
import { QUALITY_DEBOUNCE_MS, useStreamQuality } from '../useStreamQuality'

const width = ref(0)
vi.mock('@/composables/useElementSize', () => ({ useElementSize: () => ({ width }) }))

describe('useStreamQuality', () => {
  let scope: ReturnType<typeof effectScope>
  const preference = ref<StreamQualityPreference>('auto')
  const subRtspUrl = ref<string | undefined>('rtsp://cam/sub')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', class {})
    vi.stubGlobal('devicePixelRatio', 1)
    width.value = 0
    preference.value = 'auto'
    subRtspUrl.value = 'rtsp://cam/sub'
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const setup = () =>
    scope.run(() => useStreamQuality(ref(document.body), { preference, subRtspUrl }))!

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
    subRtspUrl.value = undefined
    expect(setup().quality.value).toBe('main')

    scope.stop()
    scope = effectScope()
    subRtspUrl.value = 'rtsp://cam/sub'
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

    subRtspUrl.value = undefined
    await nextTick()
    expect(quality.value).toBe('main')
  })

  describe('falling back from the sub-stream', () => {
    const failed = { quality: 'sub', result: 'failed' } as const

    async function smallTile() {
      const tile = setup()
      width.value = 400
      await nextTick()
      expect(tile.quality.value).toBe('sub')
      return tile
    }

    it('plays main after three failed sub-stream attempts in a row', async () => {
      const { quality, fellBack, reportOutcome } = await smallTile()
      reportOutcome(failed)
      reportOutcome(failed)
      expect(quality.value).toBe('sub')
      reportOutcome(failed)
      expect(quality.value).toBe('main')
      expect(fellBack.value).toBe(true)
    })

    it('does not count failures that a successful connection interrupted', async () => {
      const { quality, reportOutcome } = await smallTile()
      reportOutcome(failed)
      reportOutcome(failed)
      reportOutcome({ quality: 'sub', result: 'connected' })
      reportOutcome(failed)
      reportOutcome(failed)
      expect(quality.value).toBe('sub')
    })

    it('ignores outcomes of the main stream', async () => {
      const { quality, reportOutcome } = await smallTile()
      for (let i = 0; i < 5; i++) reportOutcome({ quality: 'main', result: 'failed' })
      expect(quality.value).toBe('sub')
    })

    it('plays main at once when the sub-stream carries no audio', async () => {
      const { quality, reportOutcome } = await smallTile()
      reportOutcome({ quality: 'sub', result: 'no-audio' })
      expect(quality.value).toBe('main')
    })

    it('holds the fallback through size changes', async () => {
      const { quality, reportOutcome } = await smallTile()
      reportOutcome({ quality: 'sub', result: 'no-audio' })
      width.value = 1500
      await nextTick()
      await vi.advanceTimersByTimeAsync(QUALITY_DEBOUNCE_MS)
      width.value = 400
      await nextTick()
      await vi.advanceTimersByTimeAsync(QUALITY_DEBOUNCE_MS)
      expect(quality.value).toBe('main')
    })

    it('tries the sub-stream again after the preference changes', async () => {
      const { quality, fellBack, reportOutcome } = await smallTile()
      reportOutcome({ quality: 'sub', result: 'no-audio' })
      preference.value = 'sub'
      await nextTick()
      expect(quality.value).toBe('sub')
      expect(fellBack.value).toBe(false)
    })

    it('tries the sub-stream again after its address changes, with a fresh failure count', async () => {
      const { quality, reportOutcome } = await smallTile()
      reportOutcome(failed)
      reportOutcome(failed)
      reportOutcome(failed)
      expect(quality.value).toBe('main')

      subRtspUrl.value = 'rtsp://cam/sub2'
      await nextTick()
      expect(quality.value).toBe('sub')
      reportOutcome(failed)
      reportOutcome(failed)
      expect(quality.value).toBe('sub')
    })
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
