import type { EntityState } from '@shared/api.ts'
import { isAvailable } from './entities'

export interface BatteryReading {
  /** Whole percent, 0–100. */
  level: number
  /** Unknown for Home Assistant sensors, which report only the level. */
  charging?: boolean
  source: 'device' | 'home-assistant'
}

export const batteryDisplays = ['off', 'fullscreen', 'always'] as const
export type BatteryDisplay = (typeof batteryDisplays)[number]

/** Below this, and not charging, the readout is highlighted: the charger may be unplugged. */
export const LOW_BATTERY_PERCENT = 20

const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)))

/** `level` is the Battery Status API's fraction, 0–1. */
export function deviceBattery(level: number, charging: boolean): BatteryReading | undefined {
  if (!Number.isFinite(level)) return undefined
  return { level: clampPercent(level * 100), charging, source: 'device' }
}

/** A Home Assistant battery level sensor, e.g. the Companion app's `sensor.<device>_battery_level`. */
export function homeAssistantBattery(state: EntityState | undefined): BatteryReading | undefined {
  if (!isAvailable(state)) return undefined
  const value = Number(state.state)
  if (state.state.trim() === '' || !Number.isFinite(value)) return undefined
  return { level: clampPercent(value), source: 'home-assistant' }
}

export function isBatteryLow(reading: BatteryReading): boolean {
  return reading.level < LOW_BATTERY_PERCENT && reading.charging !== true
}

export type BatteryIcon =
  'battery-charging' | 'battery-warning' | 'battery-low' | 'battery-medium' | 'battery-full'

export function batteryIcon(reading: BatteryReading): BatteryIcon {
  if (reading.charging) return 'battery-charging'
  if (isBatteryLow(reading)) return 'battery-warning'
  if (reading.level < 40) return 'battery-low'
  if (reading.level < 75) return 'battery-medium'
  return 'battery-full'
}

/** What a screen reader hears and the tooltip shows, e.g. "Battery 87%, charging". */
export function batteryLabel(reading: BatteryReading): string {
  const charging = reading.charging ? ', charging' : ''
  const source = reading.source === 'home-assistant' ? ' (from Home Assistant)' : ''
  return `Battery ${reading.level}%${charging}${source}`
}

/**
 * Android hides its status bar, and the battery with it, in full screen, so by
 * default the header shows the battery only then.
 */
export function shouldShowBattery(display: BatteryDisplay, fullscreen: boolean): boolean {
  return display === 'always' || (display === 'fullscreen' && fullscreen)
}
