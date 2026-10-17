import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { useConfigStore } from '@/stores/config'
import SettingsView from '../SettingsView.vue'

const savedConfig = {
  version: 1,
  cameras: [{ id: 'nursery', name: 'Nursery', rtspUrl: 'rtsp://cam/s', entities: {} }],
  layout: { mode: 'grid' },
}

describe('SettingsView', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock = vi.fn<typeof fetch>(
      async (_input, init) => new Response(init?.body ?? JSON.stringify(savedConfig)),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  async function mountView() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/settings', component: SettingsView },
      ],
    })
    await router.push('/settings')
    const wrapper = mount(SettingsView, { global: { plugins: [router] } })
    await flushPromises()
    return wrapper
  }

  it('edits a copy of the loaded config', async () => {
    const wrapper = await mountView()
    const store = useConfigStore()

    await wrapper.find('input').setValue('Renamed')
    expect(store.config.cameras[0]?.name).toBe('Nursery')
  })

  it('blocks saving and shows the field error for an invalid RTSP URL', async () => {
    const wrapper = await mountView()

    await wrapper.find('input[placeholder^="rtsp://"]').setValue('http://cam')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Expected an rtsp:// or rtsps:// URL')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('saves a valid config and drops blank entity fields', async () => {
    const wrapper = await mountView()

    await wrapper.find('input[placeholder="binary_sensor.nursery_crying"]').setValue('  ')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body)).cameras[0].entities).toEqual({})
  })
})
