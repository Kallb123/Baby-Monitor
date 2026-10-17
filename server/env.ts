import { resolve } from 'node:path'

export interface ServerEnv {
  host: string
  port: number
  /** Directory holding config.json. Mount this as a volume in Docker. */
  dataDir: string
  /** Built client to serve in production. Not served when the directory is missing. */
  clientDir: string
  /** Home Assistant base URL, e.g. http://homeassistant.local:8123 */
  haUrl?: string
  /** Home Assistant long-lived access token. Server-side only. */
  haToken?: string
  /** go2rtc API base URL, used to register RTSP streams and negotiate WebRTC. */
  go2rtcUrl: string
}

/** Loads `.env` into process.env if present. Real env vars take precedence. */
export function loadDotEnv(path = '.env') {
  try {
    process.loadEnvFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 3000),
    dataDir: resolve(env.DATA_DIR ?? 'data'),
    clientDir: resolve(env.CLIENT_DIR ?? 'dist'),
    haUrl: env.HA_URL?.replace(/\/+$/, '') || undefined,
    haToken: env.HA_TOKEN || undefined,
    go2rtcUrl: (env.GO2RTC_URL ?? 'http://localhost:1984').replace(/\/+$/, ''),
  }
}
