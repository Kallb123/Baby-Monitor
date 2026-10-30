import { onScopeDispose, readonly, ref, shallowRef } from 'vue'

import { deviceBattery, type BatteryReading } from '@/lib/battery'

// The Battery Status API isn't in TypeScript's DOM lib: only Chromium ships it.
interface BatteryManagerLike extends EventTarget {
  level: number
  charging: boolean
}
type BatteryNavigator = Navigator & { getBattery?: () => Promise<BatteryManagerLike> }

/**
 * This device's battery from the Battery Status API. Chrome and Edge (Android
 * included) offer it only in a secure context; Safari and Firefox don't at
 * all, and then `unavailable` turns true so callers can fall back to a sensor.
 */
export function useDeviceBattery() {
  const nav: BatteryNavigator = navigator
  const reading = shallowRef<BatteryReading>()
  const unavailable = ref(typeof nav.getBattery !== 'function')

  let manager: BatteryManagerLike | undefined
  let disposed = false

  function update() {
    if (manager) reading.value = deviceBattery(manager.level, manager.charging)
  }

  if (!unavailable.value) {
    nav.getBattery!().then(
      (battery) => {
        if (disposed) return
        manager = battery
        battery.addEventListener('levelchange', update)
        battery.addEventListener('chargingchange', update)
        update()
      },
      () => {
        // A permissions policy can block it even where the API exists.
        if (!disposed) unavailable.value = true
      },
    )
  }

  onScopeDispose(() => {
    disposed = true
    manager?.removeEventListener('levelchange', update)
    manager?.removeEventListener('chargingchange', update)
    manager = undefined
  })

  return { reading: readonly(reading), unavailable: readonly(unavailable) }
}
