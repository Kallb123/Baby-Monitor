/**
 * App configuration schema, shared by the Vue client and the Node server.
 *
 * The server is the source of truth: it validates every write against this
 * schema and persists the result to disk. The client uses the inferred types
 * and the same schema for form validation.
 *
 * Secrets (the Home Assistant token) are deliberately NOT part of this schema.
 * They live in server-side environment variables and never reach the browser.
 */
import { z } from 'zod'

export const CONFIG_VERSION = 1

/** Home Assistant entity ids look like `binary_sensor.nursery_crying`. */
const entityId = z
  .string()
  .regex(/^[a-z_]+\.[a-z0-9_]+$/, 'Expected a Home Assistant entity id, e.g. sensor.nursery_temp')

const optionalEntityId = entityId.optional()

export const cameraSchema = z.object({
  /** Stable id, also used as the go2rtc stream name. */
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Use lowercase letters, digits, "-" or "_"'),
  name: z.string().trim().min(1).max(64),
  /** RTSP source, registered with go2rtc. Example: rtsp://user:pass@192.168.1.20:554/stream1 */
  rtspUrl: z
    .string()
    .trim()
    .regex(/^rtsps?:\/\/.+/, 'Expected an rtsp:// or rtsps:// URL'),
  /** Home Assistant entities that enrich this camera tile. All optional. */
  entities: z
    .object({
      cry: optionalEntityId,
      temperature: optionalEntityId,
      humidity: optionalEntityId,
    })
    .default({}),
})

export const layoutModes = ['grid', 'focus'] as const

export const layoutSchema = z.object({
  /**
   * - `grid`: equal tiles, column count adapts to orientation and camera count.
   * - `focus`: one large tile plus a strip of small tiles.
   */
  mode: z.enum(layoutModes).default('grid'),
  /** Camera shown large in `focus` mode. Falls back to the first camera. */
  focusCameraId: z.string().optional(),
})

export const appConfigSchema = z
  .object({
    version: z.literal(CONFIG_VERSION).default(CONFIG_VERSION),
    cameras: z.array(cameraSchema).max(16).default([]),
    layout: layoutSchema.default({ mode: 'grid' }),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>()
    config.cameras.forEach((camera, index) => {
      if (seen.has(camera.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cameras', index, 'id'],
          message: `Duplicate camera id "${camera.id}"`,
        })
      }
      seen.add(camera.id)
    })
  })

export type Camera = z.infer<typeof cameraSchema>
export type CameraEntities = Camera['entities']
export type LayoutMode = (typeof layoutModes)[number]
export type Layout = z.infer<typeof layoutSchema>
export type AppConfig = z.infer<typeof appConfigSchema>

export function defaultConfig(): AppConfig {
  return appConfigSchema.parse({})
}

/** Every Home Assistant entity id referenced by the config. */
export function referencedEntityIds(config: AppConfig): string[] {
  const ids = new Set<string>()
  for (const camera of config.cameras) {
    for (const id of Object.values(camera.entities)) {
      if (id) ids.add(id)
    }
  }
  return [...ids]
}
