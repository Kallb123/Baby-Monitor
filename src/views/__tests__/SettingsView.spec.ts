import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SystemInfoResponse } from '@shared/api.ts'
import { appConfigSchema, type AppConfig } from '@shared/config.ts'
import { fetchConfig, fetchSystemInfo, saveConfig } from '@/api'
import { useConfigStore } from '@/stores/config'
import { useSettingsStore } from '@/stores/settings'
import SettingsView from '../SettingsView.vue'

vi.mock('@/api', () => ({
  fetchSystemInfo: vi.fn<() => Promise<SystemInfoResponse>>(),
  fetchConfig: vi.fn<() => Promise<AppConfig>>(),
  saveConfig: vi.fn<(config: AppConfig) => Promise<AppConfig>>(),
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

    it('keeps element ids and radio names unique when camera ids look like each other', async () => {
      vi.mocked(fetchSystemInfo).mockResolvedValue(systemInfo)
      vi.mocked(fetchConfig).mockResolvedValue(
        configWith(
          camera('cot', 'Cot'),
          camera('stirring-cot', 'Other cot'),
          camera('cot-help', 'Help cot'),
        ),
      )
      const wrapper = mountView()
      await flushPromises()

      const ids = [...wrapper.element.querySelectorAll('[id]')].map((el) => el.id)
      expect(new Set(ids).size).toBe(ids.length)

      const groups = wrapper.findAll('.sensitivity-row [role="radiogroup"]')
      expect(groups).toHaveLength(3)
      const names = groups.map((group) => group.get('input').attributes('name'))
      expect(new Set(names).size).toBe(3)
      // Each radio group is named after its own camera.
      const labels = groups.map((group) =>
        wrapper.get(`[id="${group.attributes('aria-labelledby')}"]`).text(),
      )
      expect(labels).toEqual(['Cot', 'Other cot', 'Help cot'])
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

  it.each([
    ['Warn when a feed is lost', 'feedLostAlerts'],
    ['Chime and vibrate', 'feedLostSound'],
  ] as const)('toggles "%s" with a labelled switch, on by default', async (labelText, key) => {
    vi.mocked(fetchSystemInfo).mockResolvedValue({
      homeAssistant: { status: 'unconfigured' },
      go2rtc: { url: 'http://localhost:1984' },
    })
    const wrapper = mountView()
    const label = wrapper.findAll('.row-label').find((el) => el.text() === labelText)!
    const toggle = wrapper.get(`[aria-labelledby="${label.attributes('id')}"]`)
    expect(toggle.attributes('aria-checked')).toBe('true')

    await toggle.trigger('click')
    expect(toggle.attributes('aria-checked')).toBe('false')
    expect(useSettingsStore()[key]).toBe(false)
    wrapper.unmount()
  })

  describe('stream quality', () => {
    const systemInfo: SystemInfoResponse = {
      homeAssistant: { status: 'unconfigured' },
      go2rtc: { url: 'http://localhost:1984' },
    }

    // The per-camera stirring groups are radiogroups too, so find this one by its label.
    const qualityGroup = (wrapper: ReturnType<typeof mountView>) => {
      const label = wrapper.findAll('.row-label').find((el) => el.text() === 'Stream quality')!
      return wrapper.get(`[role="radiogroup"][aria-labelledby="${label.attributes('id')}"]`)
    }

    const radio = (wrapper: ReturnType<typeof mountView>, label: string) =>
      qualityGroup(wrapper)
        .findAll('label')
        .find((el) => el.text() === label)!
        .get('input')

    it('offers Auto, Main and Sub-stream, with Auto chosen by default', () => {
      vi.mocked(fetchSystemInfo).mockResolvedValue(systemInfo)
      const wrapper = mountView()
      const group = qualityGroup(wrapper)
      expect(group.findAll('label').map((el) => el.text())).toEqual(['Auto', 'Main', 'Sub-stream'])
      expect((radio(wrapper, 'Auto').element as HTMLInputElement).checked).toBe(true)
      expect(group.text()).toContain('only applies to cameras with a sub-stream address')
      wrapper.unmount()
    })

    it('labels the group and saves the choice on this device', async () => {
      vi.mocked(fetchSystemInfo).mockResolvedValue(systemInfo)
      const wrapper = mountView()
      const labelId = qualityGroup(wrapper).attributes('aria-labelledby')!
      expect(wrapper.get(`[id="${labelId}"]`).text()).toBe('Stream quality')

      await radio(wrapper, 'Sub-stream').setValue(true)
      expect(useSettingsStore().streamQuality).toBe('sub')
      await radio(wrapper, 'Main').setValue(true)
      expect(useSettingsStore().streamQuality).toBe('main')
      wrapper.unmount()
    })

    it('still finds its own group when cameras add stirring groups', async () => {
      vi.mocked(fetchSystemInfo).mockResolvedValue(systemInfo)
      vi.mocked(fetchConfig).mockResolvedValue(
        configWith(camera('nursery', 'Nursery'), camera('cot', 'Cot')),
      )
      const wrapper = mountView()
      await flushPromises()
      // Battery level, stream quality and one stirring group per camera.
      expect(wrapper.findAll('[role="radiogroup"]')).toHaveLength(4)
      expect(
        qualityGroup(wrapper)
          .findAll('label')
          .map((el) => el.text()),
      ).toEqual(['Auto', 'Main', 'Sub-stream'])

      await radio(wrapper, 'Sub-stream').setValue(true)
      expect(useSettingsStore().streamQuality).toBe('sub')
      expect(useSettingsStore().sensitivityFor('nursery')).toBe('medium')
      wrapper.unmount()
    })

    it('shows the stored choice', () => {
      vi.mocked(fetchSystemInfo).mockResolvedValue(systemInfo)
      useSettingsStore().setStreamQuality('main')
      const wrapper = mountView()
      expect((radio(wrapper, 'Main').element as HTMLInputElement).checked).toBe(true)
      expect((radio(wrapper, 'Auto').element as HTMLInputElement).checked).toBe(false)
      wrapper.unmount()
    })
  })

  describe('battery', () => {
    const systemInfo: SystemInfoResponse = {
      homeAssistant: { status: 'connected' },
      go2rtc: { url: 'http://localhost:1984' },
    }
    const sensorInput = (wrapper: ReturnType<typeof mountView>) =>
      wrapper.get('input[placeholder="sensor.tablet_battery_level"]')

    beforeEach(() => {
      vi.mocked(fetchSystemInfo).mockResolvedValue(systemInfo)
      vi.mocked(saveConfig)
        .mockReset()
        .mockImplementation(async (config) => config)
    })

    it('chooses when the header shows the battery', async () => {
      const wrapper = mountView()
      const label = wrapper.findAll('.row-label').find((el) => el.text() === 'Battery level')!
      const group = wrapper.get(`[role="radiogroup"][aria-labelledby="${label.attributes('id')}"]`)
      expect(group.findAll('label').map((el) => el.text())).toEqual([
        'Off',
        'Full screen',
        'Always',
      ])
      const always = group
        .findAll('label')
        .find((el) => el.text() === 'Always')!
        .get('input')
      await always.setValue(true)
      expect(useSettingsStore().batteryDisplay).toBe('always')
      wrapper.unmount()
    })

    it('says when the browser cannot read the battery', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.text()).toContain("This browser can't read the battery")
      wrapper.unmount()
    })

    it('adds a new sensor to the config and keeps the choice on this device', async () => {
      const wrapper = mountView()
      await flushPromises()
      await sensorInput(wrapper).setValue(' sensor.tablet_battery_level ')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ batteryEntities: ['sensor.tablet_battery_level'] }),
      )
      expect(useConfigStore().config.batteryEntities).toEqual(['sensor.tablet_battery_level'])
      expect(useSettingsStore().batteryEntityId).toBe('sensor.tablet_battery_level')
      wrapper.unmount()
    })

    it('does not save the config for a sensor it already lists', async () => {
      vi.mocked(fetchConfig).mockResolvedValue(
        appConfigSchema.parse({ batteryEntities: ['sensor.tablet_battery_level'] }),
      )
      const wrapper = mountView()
      await flushPromises()
      await sensorInput(wrapper).setValue('sensor.tablet_battery_level')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(saveConfig).not.toHaveBeenCalled()
      expect(useSettingsStore().batteryEntityId).toBe('sensor.tablet_battery_level')
      wrapper.unmount()
    })

    it('rejects an entity that is not a sensor', async () => {
      const wrapper = mountView()
      await flushPromises()
      await sensorInput(wrapper).setValue('lock.front_door')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(wrapper.get('[role="alert"]').text()).toContain('Expected a sensor')
      expect(saveConfig).not.toHaveBeenCalled()
      expect(useSettingsStore().batteryEntityId).toBeUndefined()
      wrapper.unmount()
    })

    it('shows a failed save and keeps the old choice', async () => {
      vi.mocked(saveConfig).mockRejectedValue(new Error('Server unreachable'))
      const wrapper = mountView()
      await flushPromises()
      await sensorInput(wrapper).setValue('sensor.tablet_battery_level')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(wrapper.get('[role="alert"]').text()).toBe('Server unreachable')
      expect(useSettingsStore().batteryEntityId).toBeUndefined()
      wrapper.unmount()
    })

    it('clears the sensor when left blank', async () => {
      useSettingsStore().setBatteryEntityId('sensor.tablet_battery_level')
      const wrapper = mountView()
      await flushPromises()
      expect((sensorInput(wrapper).element as HTMLInputElement).value).toBe(
        'sensor.tablet_battery_level',
      )
      await sensorInput(wrapper).setValue('')
      await wrapper.get('form').trigger('submit')

      expect(useSettingsStore().batteryEntityId).toBeUndefined()
      expect(saveConfig).not.toHaveBeenCalled()
      wrapper.unmount()
    })
  })
})
