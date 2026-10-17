import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'

import { negotiateWebRtc } from '@/api'

export type StreamStatus = 'connecting' | 'live' | 'error'

const ICE_GATHER_TIMEOUT_MS = 2000
const MAX_RETRY_DELAY_MS = 30_000

/** go2rtc's HTTP signalling is non-trickle, so the offer must carry our ICE candidates. */
function iceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', onChange)
      clearTimeout(timer)
      resolve()
    }
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done()
    }
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS)
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

/**
 * Receives one camera's audio + video from go2rtc over WebRTC, reconnecting
 * with exponential backoff when the connection drops.
 */
export function useWebRtcStream(cameraId: Ref<string>) {
  const stream = shallowRef<MediaStream>()
  const status = ref<StreamStatus>('connecting')
  const error = ref<string>()

  let pc: RTCPeerConnection | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0
  // Bumped on every (re)connect so callbacks from a superseded connection are ignored.
  let generation = 0

  function teardown() {
    clearTimeout(retryTimer)
    retryTimer = undefined
    pc?.close()
    pc = undefined
  }

  function scheduleRetry(gen: number) {
    if (gen !== generation || retryTimer) return
    const delay = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** attempt)
    attempt++
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void connect()
    }, delay)
  }

  async function connect() {
    teardown()
    const gen = ++generation
    status.value = 'connecting'

    const peer = new RTCPeerConnection()
    pc = peer
    peer.addTransceiver('video', { direction: 'recvonly' })
    peer.addTransceiver('audio', { direction: 'recvonly' })

    const tracks: MediaStreamTrack[] = []
    peer.addEventListener('track', (event) => {
      if (gen !== generation) return
      tracks.push(event.track)
      // New object so watchers (video element, level meter) see the change.
      stream.value = new MediaStream(tracks)
    })
    peer.addEventListener('connectionstatechange', () => {
      if (gen !== generation) return
      if (peer.connectionState === 'connected') {
        status.value = 'live'
        error.value = undefined
        attempt = 0
      } else if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        status.value = 'error'
        error.value = `Connection ${peer.connectionState}`
        scheduleRetry(gen)
      }
    })

    try {
      await peer.setLocalDescription(await peer.createOffer())
      await iceGatheringComplete(peer)
      const offer = peer.localDescription?.sdp
      if (!offer) throw new Error('No local SDP offer')
      const answer = await negotiateWebRtc(cameraId.value, offer)
      if (gen !== generation) return
      await peer.setRemoteDescription({ type: 'answer', sdp: answer })
    } catch (e) {
      if (gen !== generation) return
      status.value = 'error'
      error.value = e instanceof Error ? e.message : String(e)
      scheduleRetry(gen)
    }
  }

  watch(
    cameraId,
    () => {
      attempt = 0
      stream.value = undefined
      void connect()
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    generation++
    teardown()
  })

  return { stream, status, error, reconnect: connect }
}
