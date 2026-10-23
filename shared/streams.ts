/**
 * Stream variants of a camera. `main` is the full-resolution RTSP source and
 * `sub` the optional lower-resolution one (see `Camera.subRtspUrl`).
 */
export const streamQualities = ['main', 'sub'] as const

export type StreamQuality = (typeof streamQualities)[number]

/**
 * go2rtc stream name for a camera's stream. Main keeps the bare camera id so
 * streams registered before sub-streams existed keep working. A camera id can
 * never contain a dot, so the sub name cannot collide with another camera.
 */
export function streamName(cameraId: string, quality: StreamQuality): string {
  return quality === 'sub' ? `${cameraId}.sub` : cameraId
}
