import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useFullscreen } from '@/composables/useFullscreen'
import MonitorHeader from '../MonitorHeader.vue'

vi.mock('@/composables/useFullscreen', () => ({ useFullscreen: vi.fn<typeof useFullscreen>() }))

const toggle = vi.fn<() => void>()

function mountHeader(options: { supported: boolean; isFullscreen?: boolean }) {
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
