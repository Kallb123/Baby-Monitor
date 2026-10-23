import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CryHistoryResponse } from '@shared/api.ts'
import { appConfigSchema, type AppConfig } from '@shared/config.ts'
import { fetchConfig, fetchCryHistory } from '@/api'
import { BUCKET_MS, bucketStart } from '@/lib/sound-history'
import { useConfigStore } from '@/stores/config'
import { useSettingsStore } from '@/stores/settings'
import { SOUND_HISTORY_STORAGE_KEY } from '@/stores/sound-history'
import HistoryView from '../HistoryView.vue'

vi.mock('@/api', () => ({
  fetchConfig: vi.fn<() => Promise<AppConfig>>(),
  fetchCryHistory: vi.fn<typeof fetchCryHistory>(),
}))

const camera = (id: string, name: string, cry?: string) => ({
  id,
  name,
  rtspUrl: 'rtsp://cam/s',
  entities: cry ? { cry } : {},
})

function cryResponse(
  cameras: CryHistoryResponse['cameras'],
  configured = true,
): CryHistoryResponse {
  const now = Date.now()
  return {
    configured,
    from: new Date(now - 12 * 3_600_000).toISOString(),
    to: new Date(now).toISOString(),
    cameras,
  }
}

function mountView(...cameras: ReturnType<typeof camera>[]) {
  const config = useConfigStore()
  config.config = appConfigSchema.parse({ cameras })
  config.loaded = true
  return mount(HistoryView, { global: { stubs: { RouterLink: RouterLinkStub } } })
}

describe('HistoryView', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(fetchConfig).mockResolvedValue(appConfigSchema.parse({}))
    vi.mocked(fetchCryHistory).mockResolvedValue(cryResponse({}))
  })

  afterEach(() => vi.useRealTimers())

  it('shows a chart and crying episodes for each camera', async () => {
    const now = Date.now()
    localStorage.setItem(
      SOUND_HISTORY_STORAGE_KEY,
      JSON.stringify({
        nursery: [
          [bucketStart(now - 30 * BUCKET_MS), -35.5, 0],
          [bucketStart(now - 29 * BUCKET_MS), -20, 1],
        ],
      }),
    )
    vi.mocked(fetchCryHistory).mockResolvedValue(
      cryResponse({
        nursery: {
          cry: [
            {
              start: new Date(now - 3 * 3_600_000).toISOString(),
              end: new Date(now - 3 * 3_600_000 + 7 * 60_000).toISOString(),
            },
            { start: new Date(now - 10 * 60_000).toISOString() },
          ],
        },
      }),
    )
    const wrapper = mountView(camera('nursery', 'Nursery', 'binary_sensor.cry'))
    await flushPromises()

    expect(fetchCryHistory).toHaveBeenCalledWith(12, expect.any(AbortSignal))
    expect(wrapper.get('h2').text()).toBe('Nursery')

    const chart = wrapper.get('svg[role="img"]')
    expect(chart.attributes('aria-label')).toContain('Nursery')
    expect(chart.attributes('aria-label')).toContain('2 minutes of sound recorded on this device')
    expect(chart.attributes('aria-label')).toContain('2 crying episodes')
    expect(wrapper.findAll('path.line')).toHaveLength(1)
    expect(wrapper.findAll('rect.stirred')).toHaveLength(1)
    expect(wrapper.findAll('rect.cry')).toHaveLength(2)

    const episodes = wrapper.findAll('.episodes li').map((li) => li.text())
    expect(episodes).toHaveLength(2)
    expect(episodes[0]).toContain('still crying')
    expect(episodes[1]).toContain('7 min')
    expect(wrapper.text()).toContain('recorded on this device only')
    wrapper.unmount()
  })

  it('says so when nothing was recorded and nobody cried', async () => {
    vi.mocked(fetchCryHistory).mockResolvedValue(cryResponse({ nursery: { cry: [] } }))
    const wrapper = mountView(camera('nursery', 'Nursery', 'binary_sensor.cry'))
    await flushPromises()

    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).toContain('No sound recorded')
    expect(wrapper.findAll('path.line')).toHaveLength(0)
    expect(wrapper.text()).toContain('No crying in the last 12 hours')
    wrapper.unmount()
  })

  it('explains why crying is missing', async () => {
    vi.mocked(fetchCryHistory).mockResolvedValue(cryResponse({}, false))
    const wrapper = mountView(camera('nursery', 'Nursery', 'binary_sensor.cry'))
    await flushPromises()
    expect(wrapper.text()).toContain("Home Assistant isn't connected")

    wrapper.unmount()
    vi.mocked(fetchCryHistory).mockResolvedValue(cryResponse({ nursery: { cry: [] } }))
    const other = mountView(camera('nursery', 'Nursery'), camera('cot', 'Cot'))
    await flushPromises()
    expect(other.text()).toContain('No crying sensor is set for this camera')
    other.unmount()
  })

  it('keeps the chart when Home Assistant history cannot be loaded', async () => {
    vi.mocked(fetchCryHistory).mockRejectedValue(new Error('Home Assistant history unavailable'))
    const wrapper = mountView(camera('nursery', 'Nursery', 'binary_sensor.cry'))
    await flushPromises()

    expect(wrapper.find('svg[role="img"]').exists()).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toContain("Can't load the crying history")
    wrapper.unmount()
  })

  it('only shows cameras this device does not hide', async () => {
    const wrapper = mountView(camera('nursery', 'Nursery'), camera('cot', 'Cot'))
    useSettingsStore().setCameraHidden('cot', true)
    await flushPromises()

    expect(wrapper.findAll('h2').map((h) => h.text())).toEqual(['Nursery'])
    wrapper.unmount()
  })

  it('remembers the range and asks for it', async () => {
    const wrapper = mountView(camera('nursery', 'Nursery', 'binary_sensor.cry'))
    await flushPromises()
    const pressed = () =>
      wrapper.findAll('.range-btn').filter((b) => b.attributes('aria-pressed') === 'true')
    expect(pressed().map((b) => b.text())).toEqual(['12 h'])

    await wrapper.findAll('.range-btn')[2]!.trigger('click')
    await flushPromises()
    expect(fetchCryHistory).toHaveBeenLastCalledWith(24, expect.any(AbortSignal))
    expect(pressed().map((b) => b.text())).toEqual(['24 h'])
    wrapper.unmount()

    setActivePinia(createPinia())
    const reopened = mountView(camera('nursery', 'Nursery', 'binary_sensor.cry'))
    await flushPromises()
    expect(reopened.findAll('.range-btn[aria-pressed="true"]').map((b) => b.text())).toEqual([
      '24 h',
    ])
    reopened.unmount()
  })

  it('refreshes Home Assistant data every minute and stops when closed', async () => {
    vi.useFakeTimers()
    const wrapper = mountView(camera('nursery', 'Nursery', 'binary_sensor.cry'))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchCryHistory).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchCryHistory).toHaveBeenCalledTimes(2)

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(fetchCryHistory).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('links back to the monitor', () => {
    const wrapper = mountView()
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/')
    wrapper.unmount()
  })
})
