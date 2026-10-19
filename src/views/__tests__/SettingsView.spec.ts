import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SystemInfoResponse } from '@shared/api.ts'
import { appConfigSchema, type AppConfig } from '@shared/config.ts'
import { fetchConfig, fetchSystemInfo } from '@/api'
import { useConfigStore } from '@/stores/config'
import { useSettingsStore } from '@/stores/settings'
import SettingsView from '../SettingsView.vue'

vi.mock('@/api', () => ({
  fetchSystemInfo: vi.fn<() => Promise<SystemInfoResponse>>(),
  fetchConfig: vi.fn<() => Promise<AppConfig>>(),
}))

const camera = (id: string, name: string) => ({ id, name, rtspUrl: 'rtsp://cam/s' })
const configWith = (...cameras: ReturnType<typeof camera>[]) => appConfigSchema.parse({ cameras })

function mountView() {
  return mount(SettingsView, { global: { stubs: { RouterLink: RouterLinkStub } } })
}

describe('SettingsView', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(fetchConfig).mockResolvedValue(configWith())
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

  it('toggles stream details with a labelled switch', async () => {
    vi.mocked(fetchSystemInfo).mockResolvedValue({
      homeAssistant: { status: 'unconfigured' },
      go2rtc: { url: 'http://localhost:1984' },
    })
    const wrapper = mountView()
    const label = wrapper.findAll('.row-label').find((el) => el.text() === 'Stream details')!
    const toggle = wrapper.get(`[aria-labelledby="${label.attributes('id')}"]`)
    expect(toggle.attributes('aria-checked')).toBe('false')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-checked')).toBe('true')
    expect(useSettingsStore().showStreamDetails).toBe(true)
    await toggle.trigger('click')
    expect(useSettingsStore().showStreamDetails).toBe(false)
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

  describe('cameras', () => {
    const systemInfo: SystemInfoResponse = {
      homeAssistant: { status: 'unconfigured' },
      go2rtc: { url: 'http://localhost:1984' },
    }

    async function mountWithCameras() {
      vi.mocked(fetchSystemInfo).mockResolvedValue(systemInfo)
      vi.mocked(fetchConfig).mockResolvedValue(
        configWith(camera('nursery', 'Nursery'), camera('cot', 'Cot')),
      )
      const wrapper = mountView()
      await flushPromises()
      return wrapper
    }

    const cameraSwitch = (wrapper: ReturnType<typeof mountView>, name: string) =>
      wrapper
        .findAll('[role="switch"]')
        .find(
          (el) =>
            el.attributes('aria-labelledby') &&
            el.element.closest('.row')?.textContent?.includes(name),
        )

    it('lists every camera as shown by default', async () => {
      const wrapper = await mountWithCameras()
      expect(cameraSwitch(wrapper, 'Nursery')?.attributes('aria-checked')).toBe('true')
      expect(cameraSwitch(wrapper, 'Cot')?.attributes('aria-checked')).toBe('true')
      wrapper.unmount()
    })

    it('hides a camera on this device when its switch is turned off', async () => {
      const wrapper = await mountWithCameras()
      const toggle = cameraSwitch(wrapper, 'Cot')
      await toggle?.trigger('click')

      expect(toggle?.attributes('aria-checked')).toBe('false')
      expect(cameraSwitch(wrapper, 'Nursery')?.attributes('aria-checked')).toBe('true')
      expect(useSettingsStore().hiddenCameraIds).toEqual(['cot'])

      await toggle?.trigger('click')
      expect(toggle?.attributes('aria-checked')).toBe('true')
      expect(useSettingsStore().hiddenCameraIds).toEqual([])
      wrapper.unmount()
    })

    it('names each switch after its camera', async () => {
      const wrapper = await mountWithCameras()
      const labelledBy = cameraSwitch(wrapper, 'Nursery')?.attributes('aria-labelledby') ?? ''
      const text = labelledBy
        .split(' ')
        .map((id) => wrapper.element.querySelector(`[id="${id}"]`)?.textContent?.trim())
        .join(' ')
      expect(text).toBe('Nursery Show on monitor')
      wrapper.unmount()
    })

    it('shows an empty state without cameras', async () => {
      vi.mocked(fetchSystemInfo).mockResolvedValue(systemInfo)
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.text()).toContain('No cameras yet')
      wrapper.unmount()
    })

    it('loads the cameras itself when the config is not loaded yet', async () => {
      vi.mocked(fetchSystemInfo).mockResolvedValue(systemInfo)
      const wrapper = mountView()
      expect(useConfigStore().loaded).toBe(false)
      expect(wrapper.text()).toContain('Loading cameras')
      await flushPromises()
      expect(useConfigStore().loaded).toBe(true)
      wrapper.unmount()
    })

    it('says when the cameras cannot be loaded', async () => {
      vi.mocked(fetchSystemInfo).mockResolvedValue(systemInfo)
      vi.mocked(fetchConfig).mockRejectedValue(new Error('offline'))
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.get('[role="alert"]').text()).toContain('offline')
      wrapper.unmount()
    })
  })
})
