import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SystemInfoResponse } from '@shared/api.ts'
import { fetchSystemInfo } from '@/api'
import { useSettingsStore } from '@/stores/settings'
import SettingsView from '../SettingsView.vue'

vi.mock('@/api', () => ({ fetchSystemInfo: vi.fn<() => Promise<SystemInfoResponse>>() }))

function mountView() {
  return mount(SettingsView, { global: { stubs: { RouterLink: RouterLinkStub } } })
}

describe('SettingsView', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('toggles the decibel readout', async () => {
    vi.mocked(fetchSystemInfo).mockResolvedValue({
      homeAssistant: { status: 'unconfigured', message: 'HA_URL and HA_TOKEN are not set' },
      go2rtc: { url: 'http://localhost:1984' },
    })
    const wrapper = mountView()
    const toggle = wrapper.get('[role="switch"]')
    expect(toggle.attributes('aria-checked')).toBe('false')

    await toggle.trigger('click')
    expect(toggle.attributes('aria-checked')).toBe('true')
    expect(useSettingsStore().showDecibels).toBe(true)
    wrapper.unmount()
  })

  it('shows the Home Assistant URL and whether it is connected', async () => {
    vi.mocked(fetchSystemInfo).mockResolvedValue({
      homeAssistant: { url: 'http://ha.local:8123', status: 'connected' },
      go2rtc: { url: 'http://localhost:1984' },
    })
    const wrapper = mountView()
    expect(wrapper.find('.status').text()).toBe('Checking…')

    await flushPromises()
    expect(wrapper.find('.status').text()).toBe('Connected')
    expect(wrapper.text()).toContain('http://ha.local:8123')
    expect(wrapper.text()).toContain('http://localhost:1984')
    wrapper.unmount()
  })

  it('explains a failed connection', async () => {
    vi.mocked(fetchSystemInfo).mockResolvedValue({
      homeAssistant: {
        url: 'http://ha.local:8123',
        status: 'error',
        message: 'Home Assistant rejected the token (check HA_TOKEN)',
      },
      go2rtc: { url: 'http://localhost:1984' },
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('.status').text()).toBe('Not connected')
    expect(wrapper.text()).toContain('rejected the token')
    wrapper.unmount()
  })
})
