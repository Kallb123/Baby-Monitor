import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import { useDeviceBattery } from '../useDeviceBattery'

type Battery = EventTarget & { level: number; charging: boolean }

function makeBattery(level: number, charging: boolean): Battery {
  return Object.assign(new EventTarget(), { level, charging })
}

function mountHost() {
  let result!: ReturnType<typeof useDeviceBattery>
  const Host = defineComponent({
    setup() {
      result = useDeviceBattery()
      return () => null
    },
  })
  const wrapper = mount(Host)
  return { wrapper, result }
}

describe('useDeviceBattery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is unavailable where the browser has no Battery Status API', () => {
    vi.stubGlobal('navigator', {})
    const { wrapper, result } = mountHost()
    expect(result.unavailable.value).toBe(true)
    expect(result.reading.value).toBeUndefined()
    wrapper.unmount()
  })

  it('is unavailable when the browser refuses', async () => {
    vi.stubGlobal('navigator', { getBattery: () => Promise.reject(new Error('blocked')) })
    const { wrapper, result } = mountHost()
    expect(result.unavailable.value).toBe(false)
    await flushPromises()
    expect(result.unavailable.value).toBe(true)
    wrapper.unmount()
  })

  it('reads the battery and follows level and charging changes', async () => {
    const battery = makeBattery(0.5, false)
    vi.stubGlobal('navigator', { getBattery: () => Promise.resolve(battery) })
    const { wrapper, result } = mountHost()
    await flushPromises()
    expect(result.reading.value).toEqual({ level: 50, charging: false, source: 'device' })

    battery.level = 0.49
    battery.dispatchEvent(new Event('levelchange'))
    battery.charging = true
    battery.dispatchEvent(new Event('chargingchange'))
    expect(result.reading.value).toEqual({ level: 49, charging: true, source: 'device' })
    expect(result.unavailable.value).toBe(false)

    wrapper.unmount()
    battery.level = 0.1
    battery.dispatchEvent(new Event('levelchange'))
    expect(result.reading.value?.level).toBe(49)
  })

  it('does not listen when disposed before the battery arrives', async () => {
    const battery = makeBattery(0.5, false)
    const addEventListener = vi.spyOn(battery, 'addEventListener')
    vi.stubGlobal('navigator', { getBattery: () => Promise.resolve(battery) })
    const { wrapper } = mountHost()
    wrapper.unmount()
    await flushPromises()
    expect(addEventListener).not.toHaveBeenCalled()
  })
})
