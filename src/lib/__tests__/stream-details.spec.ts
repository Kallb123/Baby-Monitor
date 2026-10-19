import { describe, expect, it } from 'vitest'

import { readStreamDetails } from '../stream-details'

function stats(...reports: { id: string; type: string; [key: string]: unknown }[]): RTCStatsReport {
  return new Map(reports.map((report) => [report.id, report])) as unknown as RTCStatsReport
}

describe('readStreamDetails', () => {
  it('resolves inbound codecs by id rather than the other negotiated codecs', () => {
    expect(
      readStreamDetails(
        stats(
          { id: 'unused', type: 'codec', mimeType: 'video/VP8' },
          { id: 'video', type: 'codec', mimeType: 'video/H264' },
          { id: 'audio', type: 'codec', mimeType: 'audio/opus' },
          {
            id: 'v',
            type: 'inbound-rtp',
            kind: 'video',
            codecId: 'video',
            frameWidth: 1920,
            frameHeight: 1080,
            framesPerSecond: 29.97,
          },
          { id: 'a', type: 'inbound-rtp', kind: 'audio', codecId: 'audio' },
          {
            id: 'outbound',
            type: 'outbound-rtp',
            kind: 'video',
            codecId: 'unused',
            frameWidth: 640,
            frameHeight: 480,
          },
        ),
      ),
    ).toEqual({
      resolution: '1920 × 1080',
      framesPerSecond: 30,
      videoCodec: 'H264',
      audioCodec: 'OPUS',
    })
  })

  it('allows missing stats and codecs without inventing values', () => {
    expect(readStreamDetails(stats())).toEqual({})
    expect(
      readStreamDetails(
        stats({
          id: 'v',
          type: 'inbound-rtp',
          kind: 'video',
          codecId: 'missing',
          frameWidth: 0,
          frameHeight: 0,
          framesPerSecond: NaN,
        }),
      ),
    ).toEqual({ videoCodec: undefined })
  })

  it('supports the older mediaType field and preserves zero fps', () => {
    expect(
      readStreamDetails(
        stats({ id: 'v', type: 'inbound-rtp', mediaType: 'video', framesPerSecond: 0 }),
      ).framesPerSecond,
    ).toBe(0)
  })
})
