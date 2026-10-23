import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { negotiateWebRtc } from '@/api'
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
})
