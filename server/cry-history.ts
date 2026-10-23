import type { CryInterval } from '../shared/api.ts'
import type { AppConfig } from '../shared/config.ts'

/** One state change from HA's history API. `minimal_response` drops everything else. */
export interface HistoryPoint {
  state: string
  lastChanged: string
}

/**
 * Turns an entity's chronological state changes into crying intervals. Only
 * `on` counts as crying: `off`, `unavailable` and `unknown` all end it, so a
 * sensor that dropped offline is not reported as crying for hours.
 */
export function cryIntervals(points: readonly HistoryPoint[]): CryInterval[] {
  const intervals: CryInterval[] = []
  let open: CryInterval | undefined
  for (const point of points) {
    const at = Date.parse(point.lastChanged)
    if (Number.isNaN(at)) continue
    if (point.state === 'on') {
      if (!open) {
        open = { start: new Date(at).toISOString() }
        intervals.push(open)
      }
    } else if (open) {
      open.end = new Date(at).toISOString()
      open = undefined
    }
  }
  return intervals
}

/** The crying entity of each camera that has one, for the history route. */
export function cryEntitiesByCamera(config: AppConfig): Record<string, string> {
  const entities: Record<string, string> = {}
  for (const camera of config.cameras) {
    if (camera.entities.cry) entities[camera.id] = camera.entities.cry
  }
  return entities
}
