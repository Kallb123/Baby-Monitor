import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'

import { negotiateWebRtc } from '@/api'
import { readStreamDetails, type StreamDetails } from '@/lib/stream-details'
import type { StreamOutcome } from '@/lib/stream-quality'
import type { StreamQuality } from '@shared/streams.ts'

export type StreamStatus = 'connecting' | 'live' | 'error'

interface Connection {
  peer: RTCPeerConnection
  quality: StreamQuality
  tracks: MediaStreamTrack[]
  /** Reached `connected` at least once. */
  connected: boolean
  /** Its outcome went to `onOutcome`; each connection reports once. */
  reported: boolean
  /** Callbacks of a closed connection are ignored. */
  closed: boolean
}

const ICE_GATHER_TIMEOUT_MS = 2000
const MAX_RETRY_DELAY_MS = 30_000
/** `disconnected` often recovers by itself; only reconnect if it lasts this long. */
const DISCONNECT_GRACE_MS = 5000
/** How often to check that media is still arriving while "connected". */
const WATCHDOG_INTERVAL_MS = 5000

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
 * with exponential backoff when the connection drops. Changing the camera
 * reconnects at once; an undefined quality means "not decided yet", and
 * nothing connects until it is.
 *
 * Changing the quality is make-before-break: while the stream is live, the new
 * connection negotiates beside the old one, which keeps playing until the new
 * one is connected. A failed switch leaves a healthy stream alone and retries
 * quietly. `playing` is the quality of the connection currently shown, which
 * lags `quality` during a switch. `onOutcome` hears how each attempt ended.
 */
export function useWebRtcStream(
  cameraId: Ref<string>,
  showDetails: Ref<boolean> = ref(false),
  quality: Readonly<Ref<StreamQuality | undefined>> = ref('main'),
  options: { onOutcome?: (outcome: StreamOutcome) => void } = {},
) {
  const stream = shallowRef<MediaStream>()
  const status = ref<StreamStatus>('connecting')
  const error = ref<string>()
  const details = shallowRef<StreamDetails>({})

  // The connection whose media is shown and watched, and the replacement
  // negotiating beside it during a quality switch.
  const current = shallowRef<Connection>()
  const playing = computed(() => current.value?.quality)
  let next: Connection | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let watchdog: ReturnType<typeof setInterval> | undefined
  let attempt = 0

  function close(conn: Connection) {
    if (conn.closed) return
    conn.closed = true
    conn.peer.close()
  }

  function teardown() {
    clearTimeout(retryTimer)
    retryTimer = undefined
    clearInterval(watchdog)
    watchdog = undefined
    if (next) close(next)
    next = undefined
    if (current.value) close(current.value)
    current.value = undefined
    details.value = {}
  }

  function report(conn: Connection, result: StreamOutcome['result']) {
    if (conn.reported) return
    conn.reported = true
    options.onOutcome?.({ quality: conn.quality, result })
  }

  function scheduleRetry(action: () => void, minDelay = 0) {
    if (retryTimer) return
    const delay = Math.max(minDelay, Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** attempt))
    attempt++
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      action()
    }, delay)
  }

  /**
   * A camera or go2rtc's RTSP pull can stall while the peer connection stays
   * "connected", leaving a frozen frame. Reconnect when no bytes arrive.
   */
  function startWatchdog(conn: Connection) {
    clearInterval(watchdog)
    let lastBytes = -1
    watchdog = setInterval(async () => {
      const stats = await conn.peer.getStats().catch(() => undefined)
      if (!stats || conn.closed || conn !== current.value) return
      if (showDetails.value && status.value === 'live') details.value = readStreamDetails(stats)
      let bytes = 0
      stats.forEach((entry: { type: string; bytesReceived?: number }) => {
        if (entry.type === 'inbound-rtp') bytes += entry.bytesReceived ?? 0
      })
      if (bytes === lastBytes) {
        status.value = 'error'
        error.value = 'No media received'
        // A replacement already negotiating may rescue the stream; if it fails
        // it sees the error status and takes the normal retry path.
        if (!next) void connect()
      }
      lastBytes = bytes
    }, WATCHDOG_INTERVAL_MS)
  }

  function markLive(conn: Connection) {
    // Cancel a reconnect queued by a brief `disconnected` blip.
    clearTimeout(retryTimer)
    retryTimer = undefined
    status.value = 'live'
    error.value = undefined
    attempt = 0
    startWatchdog(conn)
  }

  /** Shows the replacement's media and retires the old connection. */
  function promote(conn: Connection) {
    const previous = current.value
    next = undefined
    current.value = conn
    // New object so watchers (video element, level meter) see the change.
    stream.value = new MediaStream(conn.tracks)
    details.value = {}
    if (previous) close(previous)
    markLive(conn)
  }

  function fail(conn: Connection, message: string) {
    if (!conn.connected) report(conn, 'failed')
    if (conn !== current.value) return replacementFailed(conn, message)
    details.value = {}
    status.value = 'error'
    error.value = message
    // With a replacement pending, it decides: it either takes over or fails
    // into the retry below.
    if (!next) scheduleRetry(() => void connect())
  }

  function replacementFailed(conn: Connection, message: string) {
    close(conn)
    next = undefined
    if (status.value === 'live') {
      // The old stream is still fine, so retry the switch without disturbing it.
      scheduleRetry(() => switchTo(quality.value))
      return
    }
    status.value = 'error'
    error.value = message
    scheduleRetry(() => void connect())
  }

  function onConnectionState(conn: Connection) {
    if (conn.closed) return
    const state = conn.peer.connectionState
    const isCurrent = conn === current.value
    if (state === 'connected') {
      conn.connected = true
      report(conn, conn.tracks.some((track) => track.kind === 'audio') ? 'connected' : 'no-audio')
      if (isCurrent) return markLive(conn)
      // Reporting can change the wanted quality at once (a sub-stream without
      // audio gives way to main); don't flash the stream that was just rejected.
      if (quality.value !== conn.quality) {
        close(conn)
        next = undefined
        return
      }
      promote(conn)
    } else if (state === 'disconnected' && isCurrent) {
      details.value = {}
      status.value = 'error'
      error.value = 'Connection interrupted'
      if (!next) scheduleRetry(() => void connect(), DISCONNECT_GRACE_MS)
    } else if (state === 'failed') {
      fail(conn, 'Connection failed')
    }
  }

  function open(requested: StreamQuality): Connection {
    const peer = new RTCPeerConnection()
    const conn: Connection = {
      peer,
      quality: requested,
      tracks: [],
      connected: false,
      reported: false,
      closed: false,
    }
    peer.addTransceiver('video', { direction: 'recvonly' })
    peer.addTransceiver('audio', { direction: 'recvonly' })
    peer.addEventListener('track', (event) => {
      if (conn.closed) return
      conn.tracks.push(event.track)
      // A replacement's tracks wait until it takes over.
      if (conn === current.value) stream.value = new MediaStream(conn.tracks)
    })
    peer.addEventListener('connectionstatechange', () => onConnectionState(conn))
    return conn
  }

  async function negotiate(conn: Connection) {
    const { peer } = conn
    try {
      await peer.setLocalDescription(await peer.createOffer())
      await iceGatheringComplete(peer)
      const offer = peer.localDescription?.sdp
      if (!offer) throw new Error('No local SDP offer')
      const answer = await negotiateWebRtc(cameraId.value, offer, conn.quality)
      if (conn.closed) return
      await peer.setRemoteDescription({ type: 'answer', sdp: answer })
    } catch (e) {
      if (conn.closed) return
      fail(conn, e instanceof Error ? e.message : String(e))
    }
  }

  /** Replaces everything: a fresh connection that becomes the shown one at once. */
  async function connect() {
    teardown()
    status.value = 'connecting'
    const requested = quality.value
    if (!requested) return
    const conn = open(requested)
    current.value = conn
    await negotiate(conn)
  }

  /** Moves to `wanted` without interrupting a stream that is playing fine. */
  function switchTo(wanted: StreamQuality | undefined) {
    const active = current.value
    // Nothing worth keeping on screen: a plain reconnect is quicker.
    if (!wanted || !active || status.value !== 'live') return void connect()
    if (next?.quality === wanted) return
    if (next) close(next)
    next = undefined
    clearTimeout(retryTimer)
    retryTimer = undefined
    if (active.quality === wanted) return
    const conn = open(wanted)
    next = conn
    void negotiate(conn)
  }

  watch([showDetails, status, current], async ([enabled, state, conn], _, onCleanup) => {
    details.value = {}
    if (!enabled || state !== 'live' || !conn) return
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    const stats = await conn.peer.getStats().catch(() => undefined)
    if (stats && !cancelled && !conn.closed && conn === current.value) {
      details.value = readStreamDetails(stats)
    }
  })

  watch(
    [cameraId, quality],
    ([id, wanted], previous) => {
      attempt = 0
      if (id === previous?.[0] && wanted) return switchTo(wanted)
      stream.value = undefined
      void connect()
    },
    { immediate: true },
  )

  onScopeDispose(teardown)

  return { stream, status, error, details, playing, reconnect: connect }
}
