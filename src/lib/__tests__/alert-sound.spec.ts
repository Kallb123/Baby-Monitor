import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getAudioContext } from '@/lib/audio-context'
import { ALERT_REPEAT_MS, createAlertScheduler, playAlertChime } from '../alert-sound'

vi.mock('@/lib/audio-context', () => ({
  getAudioContext: vi.fn<() => AudioContext | undefined>(),
}))

const fakeNode = () => ({
  connect: vi.fn<(to: unknown) => void>(),
  disconnect: vi.fn<() => void>(),
})
const fakeGain = () => ({
  ...fakeNode(),
  gain: {
    value: 1,
    setValueAtTime: vi.fn<(value: number, at: number) => void>(),
    linearRampToValueAtTime: vi.fn<(value: number, at: number) => void>(),
  },
})
const fakeOscillator = () => ({
  ...fakeNode(),
  type: '',
  frequency: { value: 0 },
  start: vi.fn<(at: number) => void>(),
  stop: vi.fn<(at: number) => void>(),
  onended: null as (() => void) | null,
})

function fakeContext(state: AudioContextState = 'running') {
  const gains: ReturnType<typeof fakeGain>[] = []
  const oscillators: ReturnType<typeof fakeOscillator>[] = []
  const ctx = {
    state,
    currentTime: 10,
    destination: { kind: 'destination' },
    resume: vi.fn<() => Promise<void>>(),
    createGain: vi.fn<() => ReturnType<typeof fakeGain>>(() => {
      const gain = fakeGain()
      gains.push(gain)
      return gain
    }),
    createOscillator: vi.fn<() => ReturnType<typeof fakeOscillator>>(() => {
      const osc = fakeOscillator()
      oscillators.push(osc)
      return osc
    }),
  }
  vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext)
  return { ctx, gains, oscillators }
}

describe('playAlertChime', () => {
  const vibrate = vi.fn<(pattern: VibratePattern) => boolean>(() => true)

  beforeEach(() => {
    vibrate.mockClear()
    vi.mocked(getAudioContext).mockReset()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'vibrate')
  })

  it('plays two descending tones to the speakers and disconnects when done', () => {
    const { ctx, gains, oscillators } = fakeContext()

    playAlertChime()

    expect(oscillators).toHaveLength(2)
    const [first, second] = oscillators
    expect(first?.frequency.value).toBeGreaterThan(second?.frequency.value ?? Infinity)
    expect(first?.start).toHaveBeenCalledWith(10)
    expect(second?.start.mock.calls[0]?.[0]).toBeGreaterThan(10)
    expect(gains[0]?.connect).toHaveBeenCalledWith(ctx.destination)
    // Gentle: never near full scale.
    for (const [value] of gains[0]?.gain.linearRampToValueAtTime.mock.calls ?? []) {
      expect(value).toBeLessThanOrEqual(0.2)
    }

    expect(gains[0]?.disconnect).not.toHaveBeenCalled()
    second?.onended?.()
    expect(gains[0]?.disconnect).toHaveBeenCalled()
    expect(first?.disconnect).toHaveBeenCalled()
    expect(second?.disconnect).toHaveBeenCalled()
  })

  it('vibrates', () => {
    fakeContext()
    playAlertChime()
    expect(vibrate).toHaveBeenCalledTimes(1)
  })

  it('stays silent, without trying to resume, while the context is locked', () => {
    const { ctx, oscillators } = fakeContext('suspended')

    playAlertChime()

    expect(ctx.resume).not.toHaveBeenCalled()
    expect(ctx.createGain).not.toHaveBeenCalled()
    expect(oscillators).toHaveLength(0)
    expect(vibrate).toHaveBeenCalled()
  })

  it('does nothing without Web Audio or vibration support', () => {
    Reflect.deleteProperty(navigator, 'vibrate')
    vi.mocked(getAudioContext).mockReturnValue(undefined)
    expect(() => playAlertChime()).not.toThrow()
  })
})

describe('createAlertScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('plays right away, then every minute while a feed stays lost', () => {
    const play = vi.fn<() => void>()
    const scheduler = createAlertScheduler(play)

    scheduler.update(['nursery'])
    expect(play).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(ALERT_REPEAT_MS - 1)
    expect(play).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(play).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(ALERT_REPEAT_MS)
    expect(play).toHaveBeenCalledTimes(3)

    scheduler.dispose()
  })

  it('does not chime again for updates that change nothing', () => {
    const play = vi.fn<() => void>()
    const scheduler = createAlertScheduler(play)

    scheduler.update(['nursery'])
    vi.advanceTimersByTime(10_000)
    scheduler.update(['nursery'])
    scheduler.update(['nursery'])
    expect(play).toHaveBeenCalledTimes(1)

    scheduler.dispose()
  })

  it('stops when every lost feed is dismissed or restored', () => {
    const play = vi.fn<() => void>()
    const scheduler = createAlertScheduler(play)

    scheduler.update(['nursery'])
    scheduler.update([])
    expect(vi.getTimerCount()).toBe(0)

    vi.advanceTimersByTime(3 * ALERT_REPEAT_MS)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('keeps repeating while at least one lost feed remains', () => {
    const play = vi.fn<() => void>()
    const scheduler = createAlertScheduler(play)

    scheduler.update(['nursery', 'cot'])
    scheduler.update(['cot'])
    vi.advanceTimersByTime(ALERT_REPEAT_MS)
    expect(play).toHaveBeenCalledTimes(2)

    scheduler.dispose()
  })

  it('chimes immediately for a second outage and restarts the minute', () => {
    const play = vi.fn<() => void>()
    const scheduler = createAlertScheduler(play)

    scheduler.update(['nursery'])
    vi.advanceTimersByTime(40_000)
    scheduler.update(['nursery', 'cot'])
    expect(play).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(ALERT_REPEAT_MS - 1)
    expect(play).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    expect(play).toHaveBeenCalledTimes(3)

    scheduler.dispose()
  })

  it('chimes again for a feed that returns and is lost again', () => {
    const play = vi.fn<() => void>()
    const scheduler = createAlertScheduler(play)

    scheduler.update(['nursery'])
    scheduler.update([])
    scheduler.update(['nursery'])
    expect(play).toHaveBeenCalledTimes(2)

    scheduler.dispose()
  })

  it('releases its timer when disposed', () => {
    const scheduler = createAlertScheduler(vi.fn<() => void>())
    scheduler.update(['nursery'])
    expect(vi.getTimerCount()).toBe(1)

    scheduler.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
