import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useFullscreen } from '@/composables/useFullscreen'
import type { BatteryDisplay, BatteryReading } from '@/lib/battery'
import MonitorHeader from '../MonitorHeader.vue'

vi.mock('@/composables/useFullscreen', () => ({ useFullscreen: vi.fn<typeof useFullscreen>() }))

const toggle = vi.fn<() => void>()

function mountHeader(options: {
  supported: boolean
  isFullscreen?: boolean
  battery?: BatteryReading
  batteryDisplay?: BatteryDisplay
}) {
  vi.mocked(useFullscreen).mockReturnValue({
    supported: options.supported,
    isFullscreen: ref(options.isFullscreen ?? false),
    toggle,
  })
  return mount(MonitorHeader, {
    props: {
      status: 'All quiet',
      notice: undefined,
      layoutMode: 'grid',
      editing: false,
      canEdit: true,
      canAdd: true,
      battery: options.battery,
      batteryDisplay: options.batteryDisplay,
    },
    global: {
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
        // The real icon renders only SVG paths, so expose which one was asked for.
        AppIcon: { props: ['name'], template: '<i :data-icon="name" />' },
      },
    },
  })
}

describe('MonitorHeader full screen button', () => {
  beforeEach(() => {
    toggle.mockClear()
  })

  it('is hidden where full screen is unsupported', () => {
    const wrapper = mountHeader({ supported: false })
    expect(wrapper.find('.fullscreen-btn').exists()).toBe(false)
  })

  it('offers to enter full screen and toggles on click', async () => {
    const wrapper = mountHeader({ supported: true })
    const button = wrapper.get('.fullscreen-btn')
    expect(button.attributes('aria-label')).toBe('Enter full screen')
    expect(button.attributes('title')).toBe('Enter full screen')
    expect(button.attributes('aria-pressed')).toBe('false')
    expect(button.get('[data-icon]').attributes('data-icon')).toBe('maximize')

    await button.trigger('click')
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('offers to exit full screen while in full screen', () => {
    const wrapper = mountHeader({ supported: true, isFullscreen: true })
    const button = wrapper.get('.fullscreen-btn')
    expect(button.attributes('aria-label')).toBe('Exit full screen')
    expect(button.attributes('title')).toBe('Exit full screen')
    expect(button.attributes('aria-pressed')).toBe('true')
    expect(button.get('[data-icon]').attributes('data-icon')).toBe('minimize')
  })
})

describe('MonitorHeader battery', () => {
  const battery: BatteryReading = { level: 87, charging: true, source: 'device' }

  it('shows the battery only in full screen by default', () => {
    expect(mountHeader({ supported: true, battery }).find('.battery').exists()).toBe(false)

    const shown = mountHeader({ supported: true, isFullscreen: true, battery }).get('.battery')
    expect(shown.text()).toContain('87%')
    expect(shown.text()).toContain('Battery 87%, charging')
    expect(shown.get('[data-icon]').attributes('data-icon')).toBe('battery-charging')
  })

  it('follows the display setting', () => {
    const always = mountHeader({ supported: false, battery, batteryDisplay: 'always' })
    expect(always.find('.battery').exists()).toBe(true)
    const off = mountHeader({ supported: true, isFullscreen: true, battery, batteryDisplay: 'off' })
    expect(off.find('.battery').exists()).toBe(false)
  })

  it('shows nothing without a reading', () => {
    const wrapper = mountHeader({ supported: true, isFullscreen: true })
    expect(wrapper.find('.battery').exists()).toBe(false)
  })

  it('highlights a low battery that is not charging', () => {
    const low: BatteryReading = { level: 12, source: 'home-assistant' }
    const wrapper = mountHeader({ supported: true, battery: low, batteryDisplay: 'always' })
    expect(wrapper.get('.battery').classes()).toContain('low')
    expect(wrapper.get('.battery').attributes('title')).toBe('Battery 12% (from Home Assistant)')
  })
})
