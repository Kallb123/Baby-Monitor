export interface StreamDetails {
  resolution?: string
  framesPerSecond?: number
  videoCodec?: string
  audioCodec?: string
}

/** Read the codecs actually received, rather than every codec offered in SDP. */
export function readStreamDetails(stats: RTCStatsReport): StreamDetails {
  const details: StreamDetails = {}
  stats.forEach((report: RTCInboundRtpStreamStats & { mediaType?: string }) => {
    if (report.type !== 'inbound-rtp') return
    const kind = report.kind ?? report.mediaType
    const codec: { mimeType?: string } | undefined = report.codecId
      ? stats.get(report.codecId)
      : undefined
    const codecName = codec?.mimeType?.split('/')[1]?.toUpperCase()
    if (kind === 'video') {
      details.videoCodec = codecName
      if (report.frameWidth && report.frameHeight) {
        details.resolution = `${report.frameWidth} × ${report.frameHeight}`
      }
      if (report.framesPerSecond !== undefined && Number.isFinite(report.framesPerSecond)) {
        details.framesPerSecond = Math.round(report.framesPerSecond)
      }
    } else if (kind === 'audio') {
      details.audioCodec = codecName
    }
  })
  return details
}
