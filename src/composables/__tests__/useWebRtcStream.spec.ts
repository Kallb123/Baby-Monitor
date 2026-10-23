import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type Ref } from 'vue'

import { negotiateWebRtc } from '@/api'
import type { StreamOutcome } from '@/lib/stream-quality'
import type { StreamQuality } from '@shared/streams.ts'
import { useWebRtcStream } from '../useWebRtcStream'

vi.mock('@/api', () => ({ negotiateWebRtc: vi.fn<typeof negotiateWebRtc>() }))

function stats(width = 1920, bytes = 100): RTCStatsReport {
  return new Map([
    ['codec', { id: 'codec', type: 'codec', mimeType: 'video/H264' }],
    [
      'video',
      {
        id: 'video',
        type: 'inbound-rtp',
        kind: 'video',
        codecId: 'codec',
        frameWidth: width,
        frameHeight: 1080,
        bytesReceived: bytes,
      },
    ],
  ]) as unknown as RTCStatsReport
}

class Peer extends EventTarget {
  static instances: Peer[] = []
  connectionState = 'new'
  iceGatheringState = 'complete'
  localDescription = { sdp: 'offer' }
  addTransceiver = vi.fn<() => void>()
  createOffer = vi
    .fn<() => Promise<RTCSessionDescriptionInit>>()
    .mockResolvedValue({ type: 'offer', sdp: 'offer' })
  setLocalDescription = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  setRemoteDescription = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  getStats = vi.fn<() => Promise<RTCStatsReport>>().mockResolvedValue(stats())
  close = vi.fn<() => void>()

  constructor() {
    super()
    Peer.instances.push(this)
  }

  state(state: string) {
    this.connectionState = state
    this.dispatchEvent(new Event('connectionstatechange'))
  }

  track(kind: 'audio' | 'video') {
    this.dispatchEvent(Object.assign(new Event('track'), { track: { kind } }))
  }
}

/** jsdom has no MediaStream; this keeps the tracks it was built from. */
class FakeStream {
  tracks: unknown[]

  constructor(tracks: unknown[] = []) {
    this.tracks = tracks
  }
}

describe('WebRTC stream details lifecycle', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('RTCPeerConnection', Peer)
    vi.mocked(negotiateWebRtc).mockResolvedValue('answer')
    Peer.instances = []
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function setup(enabled = false) {
    const showDetails = ref(enabled)
    const stream = scope.run(() => useWebRtcStream(ref('nursery'), showDetails))!
    await flushPromises()
    const peer = Peer.instances[0]!
    peer.state('connected')
    await flushPromises()
    return { showDetails, stream, peer }
  }

  it('collects details on demand and refreshes them through the existing watchdog', async () => {
    const { showDetails, stream, peer } = await setup()
    expect(peer.getStats).not.toHaveBeenCalled()
    showDetails.value = true
    await flushPromises()
    expect(stream.details.value.resolution).toBe('1920 × 1080')
    expect(Peer.instances).toHaveLength(1)

    peer.getStats.mockResolvedValue(stats(1280, 200))
    await vi.advanceTimersByTimeAsync(5000)
    expect(stream.details.value.resolution).toBe('1280 × 1080')

    showDetails.value = false
    await nextTick()
    expect(stream.details.value).toEqual({})
    await vi.advanceTimersByTimeAsync(5000)
    expect(stream.details.value).toEqual({})
    scope.stop()
    expect(peer.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears details on disconnect and ignores a superseded connection’s pending stats', async () => {
    const { stream, peer } = await setup(true)
    expect(stream.details.value.videoCodec).toBe('H264')
    let resolveStats!: (value: RTCStatsReport) => void
    peer.getStats.mockReturnValue(
      new Promise((resolve) => {
        resolveStats = resolve
      }),
    )
    await vi.advanceTimersByTimeAsync(5000)
    peer.state('disconnected')
    expect(stream.details.value).toEqual({})
    await stream.reconnect()
    resolveStats(stats())
    await flushPromises()
    expect(stream.details.value).toEqual({})
    expect(peer.close).toHaveBeenCalledOnce()
  })

  it('ignores a pending stats read after the toggle is turned off', async () => {
    const { showDetails, stream, peer } = await setup()
    let resolveStats!: (value: RTCStatsReport) => void
    peer.getStats.mockReturnValue(
      new Promise((resolve) => {
        resolveStats = resolve
      }),
    )
    showDetails.value = true
    await nextTick()
    showDetails.value = false
    await nextTick()
    resolveStats(stats())
    await flushPromises()
    expect(stream.details.value).toEqual({})
  })

  it('keeps live playback when stats cannot be read', async () => {
    const { showDetails, stream, peer } = await setup()
    peer.getStats.mockRejectedValue(new Error('Stats unavailable'))
    showDetails.value = true
    await flushPromises()
    expect(stream.status.value).toBe('live')
    expect(stream.details.value).toEqual({})
  })

  describe('stream quality', () => {
    it('negotiates the requested quality', async () => {
      const quality = ref<StreamQuality | undefined>('sub')
      scope.run(() => useWebRtcStream(ref('nursery'), ref(false), quality))
      await flushPromises()
      expect(negotiateWebRtc).toHaveBeenCalledExactlyOnceWith('nursery', 'offer', 'sub')
    })

    it('asks for main when no quality is given', async () => {
      scope.run(() => useWebRtcStream(ref('nursery')))
      await flushPromises()
      expect(negotiateWebRtc).toHaveBeenCalledExactlyOnceWith('nursery', 'offer', 'main')
    })

    it('waits for the first quality decision instead of connecting to main', async () => {
      const quality = ref<StreamQuality | undefined>()
      const stream = scope.run(() => useWebRtcStream(ref('nursery'), ref(false), quality))!
      await flushPromises()
      expect(Peer.instances).toHaveLength(0)
      expect(stream.status.value).toBe('connecting')

      quality.value = 'sub'
      await flushPromises()
      expect(Peer.instances).toHaveLength(1)
      expect(negotiateWebRtc).toHaveBeenCalledExactlyOnceWith('nursery', 'offer', 'sub')
    })

    it('reconnects with a fresh attempt counter when the quality changes', async () => {
      const quality = ref<StreamQuality | undefined>('main')
      const stream = scope.run(() => useWebRtcStream(ref('nursery'), ref(false), quality))!
      await flushPromises()
      const first = Peer.instances[0]!
      // Fail once so the backoff counter is above zero.
      first.state('failed')
      expect(stream.status.value).toBe('error')

      quality.value = 'sub'
      await flushPromises()
      expect(first.close).toHaveBeenCalled()
      expect(Peer.instances).toHaveLength(2)
      expect(vi.mocked(negotiateWebRtc).mock.lastCall?.[2]).toBe('sub')

      // A failure now retries after the base 1 s delay, not the doubled one.
      Peer.instances[1]!.state('failed')
      await vi.advanceTimersByTimeAsync(1000)
      expect(Peer.instances).toHaveLength(3)
      expect(vi.mocked(negotiateWebRtc).mock.lastCall?.[2]).toBe('sub')
    })

    it('does not reconnect when the quality is set to what it already is', async () => {
      const quality = ref<StreamQuality | undefined>('main')
      scope.run(() => useWebRtcStream(ref('nursery'), ref(false), quality))
      await flushPromises()
      quality.value = 'main'
      await flushPromises()
      expect(Peer.instances).toHaveLength(1)
    })
  })

  describe('switching quality without interrupting playback', () => {
    beforeEach(() => {
      vi.stubGlobal('MediaStream', FakeStream)
    })

    async function live(initial: StreamQuality = 'main') {
      const quality = ref<StreamQuality | undefined>(initial)
      const camera = ref('nursery')
      const result = scope.run(() => useWebRtcStream(camera, ref(false), quality))!
      await flushPromises()
      const first = Peer.instances[0]!
      first.track('video')
      first.track('audio')
      first.state('connected')
      await flushPromises()
      return { quality, camera, first, ...result }
    }

    const tracksOf = (media: MediaStream | undefined) => (media as unknown as FakeStream).tracks

    it('keeps the old stream live until the new connection is connected, then swaps', async () => {
      const { quality, first, stream, status, playing } = await live()
      const before = stream.value
      expect(playing.value).toBe('main')

      quality.value = 'sub'
      await flushPromises()
      const second = Peer.instances[1]!
      expect(vi.mocked(negotiateWebRtc).mock.lastCall?.[2]).toBe('sub')
      expect(first.close).not.toHaveBeenCalled()
      expect(stream.value).toBe(before)
      expect(status.value).toBe('live')
      expect(playing.value).toBe('main')

      // Tracks arriving early must not replace what is playing.
      second.track('video')
      second.track('audio')
      expect(stream.value).toBe(before)

      second.state('connected')
      expect(stream.value).not.toBe(before)
      expect(tracksOf(stream.value)).toHaveLength(2)
      expect(status.value).toBe('live')
      expect(playing.value).toBe('sub')
      expect(first.close).toHaveBeenCalledOnce()
      expect(second.close).not.toHaveBeenCalled()
    })

    it('keeps playing and retries quietly when the new connection fails', async () => {
      const { quality, first, stream, status } = await live()
      const before = stream.value
      quality.value = 'sub'
      await flushPromises()
      const second = Peer.instances[1]!

      second.state('failed')
      expect(second.close).toHaveBeenCalledOnce()
      expect(first.close).not.toHaveBeenCalled()
      expect(status.value).toBe('live')
      expect(stream.value).toBe(before)

      await vi.advanceTimersByTimeAsync(1000)
      expect(Peer.instances).toHaveLength(3)
      expect(vi.mocked(negotiateWebRtc).mock.lastCall?.[2]).toBe('sub')
      expect(first.close).not.toHaveBeenCalled()

      const third = Peer.instances[2]!
      third.track('video')
      third.state('connected')
      expect(stream.value).not.toBe(before)
      expect(first.close).toHaveBeenCalledOnce()
    })

    it('treats a failed negotiation like a failed connection', async () => {
      const { quality, first, stream, status } = await live()
      const before = stream.value
      vi.mocked(negotiateWebRtc).mockRejectedValueOnce(new Error('go2rtc down'))
      quality.value = 'sub'
      await flushPromises()

      expect(Peer.instances[1]!.close).toHaveBeenCalledOnce()
      expect(first.close).not.toHaveBeenCalled()
      expect(status.value).toBe('live')
      expect(stream.value).toBe(before)
      await vi.advanceTimersByTimeAsync(1000)
      expect(Peer.instances).toHaveLength(3)
    })

    it('reconnects normally when the old stream is not healthy to begin with', async () => {
      const { quality, first, status } = await live()
      first.state('disconnected')
      expect(status.value).toBe('error')

      quality.value = 'sub'
      await flushPromises()
      expect(first.close).toHaveBeenCalledOnce()
      expect(Peer.instances).toHaveLength(2)
      expect(vi.mocked(negotiateWebRtc).mock.lastCall?.[2]).toBe('sub')
    })

    it('falls back to the normal retry path when the old stream broke during the switch', async () => {
      const { quality, first, status } = await live()
      quality.value = 'sub'
      await flushPromises()
      const second = Peer.instances[1]!

      // The replacement is still negotiating, so it gets the chance to rescue the stream.
      first.state('disconnected')
      await vi.advanceTimersByTimeAsync(10_000)
      expect(first.close).not.toHaveBeenCalled()
      expect(Peer.instances).toHaveLength(2)

      second.state('failed')
      expect(status.value).toBe('error')
      await vi.advanceTimersByTimeAsync(1000)
      expect(first.close).toHaveBeenCalledOnce()
      expect(second.close).toHaveBeenCalledOnce()
      expect(Peer.instances).toHaveLength(3)
    })

    it('lets a replacement take over from a stream that broke meanwhile', async () => {
      const { quality, first, stream, status } = await live()
      quality.value = 'sub'
      await flushPromises()
      const second = Peer.instances[1]!

      first.state('disconnected')
      second.track('video')
      second.state('connected')
      expect(status.value).toBe('live')
      expect(first.close).toHaveBeenCalledOnce()
      expect(tracksOf(stream.value)).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(4000)
      expect(Peer.instances).toHaveLength(2)
    })

    it('drops the replacement when the quality goes back before it connected', async () => {
      const { quality, first, stream } = await live()
      const before = stream.value
      quality.value = 'sub'
      await flushPromises()
      const second = Peer.instances[1]!

      quality.value = 'main'
      await flushPromises()
      expect(second.close).toHaveBeenCalledOnce()
      expect(Peer.instances).toHaveLength(2)

      // Whatever the abandoned connection still reports is ignored.
      second.track('video')
      second.state('connected')
      expect(stream.value).toBe(before)
      expect(first.close).not.toHaveBeenCalled()
    })

    it('watches the connection that is playing after a swap', async () => {
      const { quality, first } = await live()
      quality.value = 'sub'
      await flushPromises()
      const second = Peer.instances[1]!
      second.track('video')
      second.state('connected')
      first.getStats.mockClear()

      await vi.advanceTimersByTimeAsync(5000)
      expect(first.getStats).not.toHaveBeenCalled()
      expect(second.getStats).toHaveBeenCalledOnce()

      // Its media stalls (same byte count twice): reconnect from scratch.
      await vi.advanceTimersByTimeAsync(5000)
      expect(Peer.instances).toHaveLength(3)
      expect(second.close).toHaveBeenCalledOnce()
    })

    it('closes both connections and every timer on dispose', async () => {
      const { quality, first } = await live()
      quality.value = 'sub'
      await flushPromises()
      const second = Peer.instances[1]!

      scope.stop()
      expect(first.close).toHaveBeenCalledOnce()
      expect(second.close).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)

      // Late events from either are ignored.
      second.state('connected')
      first.state('failed')
      expect(vi.getTimerCount()).toBe(0)
      expect(Peer.instances).toHaveLength(2)
    })

    it('still blanks the stream when the camera changes', async () => {
      const { camera, first, stream } = await live()
      expect(stream.value).toBeDefined()
      camera.value = 'cot'
      await flushPromises()
      expect(stream.value).toBeUndefined()
      expect(first.close).toHaveBeenCalledOnce()
      expect(vi.mocked(negotiateWebRtc).mock.lastCall?.[0]).toBe('cot')
    })
  })

  describe('connection outcomes', () => {
    beforeEach(() => {
      vi.stubGlobal('MediaStream', FakeStream)
    })

    function start(onOutcome: (outcome: StreamOutcome) => void, quality: Ref<StreamQuality>) {
      return scope.run(() => useWebRtcStream(ref('nursery'), ref(false), quality, { onOutcome }))!
    }

    it('reports a connection with audio once', async () => {
      const onOutcome = vi.fn<(outcome: StreamOutcome) => void>()
      start(onOutcome, ref('sub'))
      await flushPromises()
      const peer = Peer.instances[0]!
      peer.track('video')
      peer.track('audio')
      peer.state('connected')
      peer.state('disconnected')
      peer.state('connected')
      expect(onOutcome).toHaveBeenCalledExactlyOnceWith({ quality: 'sub', result: 'connected' })
    })

    it('reports a connection without an audio track', async () => {
      const onOutcome = vi.fn<(outcome: StreamOutcome) => void>()
      start(onOutcome, ref('sub'))
      await flushPromises()
      const peer = Peer.instances[0]!
      peer.track('video')
      peer.state('connected')
      expect(onOutcome).toHaveBeenCalledExactlyOnceWith({ quality: 'sub', result: 'no-audio' })
    })

    it('reports every attempt that fails before connecting, once each', async () => {
      const onOutcome = vi.fn<(outcome: StreamOutcome) => void>()
      vi.mocked(negotiateWebRtc).mockRejectedValue(new Error('no such stream'))
      start(onOutcome, ref('sub'))
      await flushPromises()
      expect(onOutcome).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(onOutcome).toHaveBeenCalledTimes(2)
      // The same attempt failing twice (negotiation, then ICE) counts once.
      Peer.instances[1]!.state('failed')
      expect(onOutcome).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(2000)
      expect(onOutcome).toHaveBeenCalledTimes(3)
      expect(onOutcome).toHaveBeenLastCalledWith({ quality: 'sub', result: 'failed' })
    })

    it('does not report a drop after a successful connection as a failed attempt', async () => {
      const onOutcome = vi.fn<(outcome: StreamOutcome) => void>()
      start(onOutcome, ref('sub'))
      await flushPromises()
      const peer = Peer.instances[0]!
      peer.track('audio')
      peer.state('connected')
      peer.state('failed')
      expect(onOutcome).toHaveBeenCalledExactlyOnceWith({ quality: 'sub', result: 'connected' })
    })

    it('moves to main without blanking when a sub-stream without audio is rejected', async () => {
      const quality = ref<StreamQuality>('sub')
      const onOutcome = vi.fn<(outcome: StreamOutcome) => void>((outcome) => {
        if (outcome.result === 'no-audio') quality.value = 'main'
      })
      const { status } = start(onOutcome, quality)
      await flushPromises()
      const sub = Peer.instances[0]!
      sub.track('video')
      sub.state('connected')
      expect(status.value).toBe('live')

      await flushPromises()
      expect(sub.close).not.toHaveBeenCalled()
      const main = Peer.instances[1]!
      expect(vi.mocked(negotiateWebRtc).mock.lastCall?.[2]).toBe('main')
      main.track('video')
      main.track('audio')
      main.state('connected')
      expect(sub.close).toHaveBeenCalledOnce()
    })

    it('never shows a replacement that was rejected for lacking audio', async () => {
      const quality = ref<StreamQuality>('main')
      const onOutcome = vi.fn<(outcome: StreamOutcome) => void>((outcome) => {
        if (outcome.result === 'no-audio') quality.value = 'main'
      })
      const stream = start(onOutcome, quality)
      await flushPromises()
      const main = Peer.instances[0]!
      main.track('video')
      main.track('audio')
      main.state('connected')
      const before = stream.stream.value

      quality.value = 'sub'
      await flushPromises()
      const sub = Peer.instances[1]!
      sub.track('video')
      sub.state('connected')
      expect(stream.stream.value).toBe(before)
      expect(sub.close).toHaveBeenCalledOnce()
      expect(main.close).not.toHaveBeenCalled()
      await flushPromises()
      expect(Peer.instances).toHaveLength(2)
      expect(stream.status.value).toBe('live')
    })
  })
})
