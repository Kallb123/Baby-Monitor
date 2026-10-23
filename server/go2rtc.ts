import type { Camera } from '../shared/config.ts'
import { streamName } from '../shared/streams.ts'

export interface Go2rtcOptions {
  baseUrl: string
  fetch?: typeof fetch
}

/**
 * Thin wrapper around the go2rtc HTTP API (https://github.com/AlexxIT/go2rtc).
 *
 * Browsers cannot play RTSP, so go2rtc pulls each camera's RTSP feed and
 * re-serves it as WebRTC. Each camera id doubles as its go2rtc stream name
 * (see `streamName` for the sub-stream's).
 */
export class Go2rtcClient {
  readonly baseUrl: string
  readonly #fetch: typeof fetch

  constructor(options: Go2rtcOptions) {
    this.baseUrl = options.baseUrl
    this.#fetch = options.fetch ?? fetch
  }

  /**
   * Registers (or replaces) the go2rtc streams of every camera: the main one,
   * plus a sub-stream when the camera has a sub-stream address. Streams of
   * cleared sub-stream addresses and deleted cameras are not removed.
   */
  async syncStreams(cameras: Camera[]): Promise<void> {
    const streams = cameras.flatMap((camera) => [
      { name: streamName(camera.id, 'main'), src: camera.rtspUrl },
      ...(camera.subRtspUrl
        ? [{ name: streamName(camera.id, 'sub'), src: camera.subRtspUrl }]
        : []),
    ])
    await Promise.all(
      streams.map(async ({ name, src }) => {
        const query = new URLSearchParams({ name, src })
        const response = await this.#fetch(`${this.baseUrl}/api/streams?${query}`, {
          method: 'PUT',
        })
        if (!response.ok) {
          throw new Error(`go2rtc rejected stream "${name}" (${response.status})`)
        }
      }),
    )
  }

  /** Exchanges a WebRTC SDP offer for go2rtc's answer (WHEP-style, non-trickle). */
  async negotiate(streamName: string, offerSdp: string): Promise<string> {
    const query = new URLSearchParams({ src: streamName })
    const response = await this.#fetch(`${this.baseUrl}/api/webrtc?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offerSdp,
    })
    if (!response.ok) {
      throw new Error(`go2rtc WebRTC negotiation failed (${response.status})`)
    }
    return response.text()
  }
}
