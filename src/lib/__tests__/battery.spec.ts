import { describe, expect, it } from 'vitest'

import type { EntityState } from '@shared/api.ts'
import {
  batteryIcon,
  batteryLabel,
  deviceBattery,
  homeAssistantBattery,
  isBatteryLow,
  shouldShowBattery,
  type BatteryReading,
} from '../battery'

const sensor = (state: string): EntityState => ({
  entityId: 'sensor.tablet_battery_level',
  state,
  unit: '%',
  lastChanged: '2026-10-30T12:00:00Z',
})

const reading = (level: number, charging?: boolean): BatteryReading => ({
  level,
  charging,
  source: 'device',
})

describe('deviceBattery', () => {
  it('turns the API fraction into whole percent', () => {
    expect(deviceBattery(0.876, true)).toEqual({ level: 88, charging: true, source: 'device' })
    expect(deviceBattery(1, false)?.level).toBe(100)
  })

  it('ignores a level that is not a number', () => {
    expect(deviceBattery(Number.NaN, false)).toBeUndefined()
  })
})

describe('homeAssistantBattery', () => {
  it('reads the level without a charging state', () => {
    expect(homeAssistantBattery(sensor('64'))).toEqual({ level: 64, source: 'home-assistant' })
  })

  it('rounds and clamps odd values', () => {
    expect(homeAssistantBattery(sensor('42.6'))?.level).toBe(43)
    expect(homeAssistantBattery(sensor('140'))?.level).toBe(100)
    expect(homeAssistantBattery(sensor('-3'))?.level).toBe(0)
  })

  it('has no reading for unavailable or non-numeric states', () => {
    expect(homeAssistantBattery(undefined)).toBeUndefined()
    expect(homeAssistantBattery(sensor('unavailable'))).toBeUndefined()
    expect(homeAssistantBattery(sensor('charging'))).toBeUndefined()
    expect(homeAssistantBattery(sensor(' '))).toBeUndefined()
  })
})

describe('isBatteryLow', () => {
  it('is low under 20% unless charging', () => {
    expect(isBatteryLow(reading(19, false))).toBe(true)
    expect(isBatteryLow(reading(19))).toBe(true)
    expect(isBatteryLow(reading(19, true))).toBe(false)
    expect(isBatteryLow(reading(20, false))).toBe(false)
  })
})

describe('batteryIcon', () => {
  it('picks an icon by charging state and level', () => {
    expect(batteryIcon(reading(10, true))).toBe('battery-charging')
    expect(batteryIcon(reading(10, false))).toBe('battery-warning')
    expect(batteryIcon(reading(30, false))).toBe('battery-low')
    expect(batteryIcon(reading(60))).toBe('battery-medium')
    expect(batteryIcon(reading(90))).toBe('battery-full')
  })
})

describe('batteryLabel', () => {
  it('says whether it is charging and where it came from', () => {
    expect(batteryLabel(reading(87, true))).toBe('Battery 87%, charging')
    expect(batteryLabel({ level: 50, source: 'home-assistant' })).toBe(
      'Battery 50% (from Home Assistant)',
    )
  })
})

describe('shouldShowBattery', () => {
  it('follows the display setting and full screen', () => {
    expect(shouldShowBattery('off', true)).toBe(false)
    expect(shouldShowBattery('fullscreen', false)).toBe(false)
    expect(shouldShowBattery('fullscreen', true)).toBe(true)
    expect(shouldShowBattery('always', false)).toBe(true)
  })
})
