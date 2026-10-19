import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { EntityStatesResponse } from '@shared/api.ts'
import { appConfigSchema, type AppConfig, type Camera } from '@shared/config.ts'
import { fetchConfig, fetchEntityStates } from '@/api'
import CameraGrid from '@/components/CameraGrid.vue'
import MonitorHeader from '@/components/MonitorHeader.vue'
import { useConfigStore } from '@/stores/config'
import { useMonitorStore } from '@/stores/monitor'
import { useSettingsStore } from '@/stores/settings'
import MonitorView from '../MonitorView.vue'

vi.mock('@/api', () => ({
  fetchEntityStates: vi.fn<() => Promise<EntityStatesResponse>>(),
  fetchConfig: vi.fn<() => Promise<AppConfig>>(),
}))

const camera = (id: string, name: string) => ({ id, name, rtspUrl: 'rtsp://cam/s' })

/** Mounts the monitor with a loaded config; the grid is stubbed so no stream opens. */
async function mountMonitor(...cameras: ReturnType<typeof camera>[]) {
  vi.mocked(fetchEntityStates).mockResolvedValue({ configured: true, states: {} })
  const config = useConfigStore()
  config.config = appConfigSchema.parse({ cameras })
  config.loaded = true
  const wrapper = mount(MonitorView, {
    global: {
      stubs: { RouterLink: RouterLinkStub, CameraGrid: true, CameraDialog: true },
    },
  })
  await flushPromises()
  return wrapper
}

const gridCameraIds = (wrapper: Awaited<ReturnType<typeof mountMonitor>>) =>
  wrapper
    .findComponent(CameraGrid)
    .props('cameras')
    .map((c: Camera) => c.id)

describe('MonitorView', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('gives the grid only the cameras this device shows', async () => {
    useSettingsStore().setCameraHidden('cot', true)
    const wrapper = await mountMonitor(camera('nursery', 'Nursery'), camera('cot', 'Cot'))
    expect(gridCameraIds(wrapper)).toEqual(['nursery'])
    wrapper.unmount()
  })

  it('adds a camera back to the grid when it is shown again', async () => {
    const settings = useSettingsStore()
    settings.setCameraHidden('cot', true)
    const wrapper = await mountMonitor(camera('nursery', 'Nursery'), camera('cot', 'Cot'))

    settings.setCameraHidden('cot', false)
    await nextTick()
    expect(gridCameraIds(wrapper)).toEqual(['nursery', 'cot'])
    wrapper.unmount()
  })

  it('passes the stream details preference to the grid', async () => {
    const wrapper = await mountMonitor(camera('nursery', 'Nursery'))
    expect(wrapper.getComponent(CameraGrid).props('showStreamDetails')).toBe(false)
    useSettingsStore().setShowStreamDetails(true)
    await nextTick()
    expect(wrapper.getComponent(CameraGrid).props('showStreamDetails')).toBe(true)
    wrapper.unmount()
  })

  it('stops the audio of a camera that gets hidden', async () => {
    const monitor = useMonitorStore()
    const wrapper = await mountMonitor(camera('nursery', 'Nursery'), camera('cot', 'Cot'))
    monitor.setAudio('cot', true)

    useSettingsStore().setCameraHidden('nursery', true)
    await nextTick()
    expect(monitor.audioCameraId).toBe('cot')

    useSettingsStore().setCameraHidden('cot', true)
    await nextTick()
    expect(monitor.audioCameraId).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps the saved focus camera when it is hidden, so the grid falls back by itself', async () => {
    const monitor = useMonitorStore()
    monitor.focus('cot')
    const wrapper = await mountMonitor(camera('nursery', 'Nursery'), camera('cot', 'Cot'))

    useSettingsStore().setCameraHidden('cot', true)
    await nextTick()
    const grid = wrapper.findComponent(CameraGrid)
    expect(grid.props('focusCameraId')).toBe('cot')
    expect(gridCameraIds(wrapper)).toEqual(['nursery'])
    wrapper.unmount()
  })

  it('points to the settings page when every camera is hidden', async () => {
    const settings = useSettingsStore()
    settings.setCameraHidden('nursery', true)
    settings.setCameraHidden('cot', true)
    const wrapper = await mountMonitor(camera('nursery', 'Nursery'), camera('cot', 'Cot'))

    expect(wrapper.findComponent(CameraGrid).exists()).toBe(false)
    expect(wrapper.text()).toContain('All cameras are hidden')
    expect(wrapper.text()).not.toContain('No cameras yet')
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/settings')
    expect(wrapper.findComponent(MonitorHeader).props('canEdit')).toBe(false)
    wrapper.unmount()
  })

  it('leaves edit mode when the last visible camera gets hidden', async () => {
    const monitor = useMonitorStore()
    const wrapper = await mountMonitor(camera('nursery', 'Nursery'))
    monitor.setEditing(true)

    useSettingsStore().setCameraHidden('nursery', true)
    await nextTick()
    expect(monitor.editing).toBe(false)
    wrapper.unmount()
  })

  it('still offers to add a camera when none exist', async () => {
    const wrapper = await mountMonitor()
    expect(wrapper.text()).toContain('No cameras yet')
    expect(wrapper.text()).not.toContain('All cameras are hidden')
    wrapper.unmount()
  })

  it('forgets hidden ids of deleted cameras once the config is loaded', async () => {
    const settings = useSettingsStore()
    settings.setCameraHidden('gone', true)
    settings.setCameraHidden('cot', true)
    const wrapper = await mountMonitor(camera('nursery', 'Nursery'), camera('cot', 'Cot'))
    expect(settings.hiddenCameraIds).toEqual(['cot'])
    wrapper.unmount()
  })

  it('keeps hidden ids while the config has not loaded', async () => {
    vi.mocked(fetchEntityStates).mockResolvedValue({ configured: true, states: {} })
    vi.mocked(fetchConfig).mockRejectedValue(new Error('offline'))
    const settings = useSettingsStore()
    settings.setCameraHidden('cot', true)
    const wrapper = mount(MonitorView, {
      global: { stubs: { RouterLink: RouterLinkStub, CameraGrid: true, CameraDialog: true } },
    })
    await flushPromises()
    expect(settings.hiddenCameraIds).toEqual(['cot'])
    wrapper.unmount()
  })
})
