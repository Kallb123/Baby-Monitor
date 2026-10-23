import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '@shared/config.ts'
import { useConfigStore } from '@/stores/config'
import { useMonitorStore } from '@/stores/monitor'
import CameraDialog from '../CameraDialog.vue'

const savedConfig: AppConfig = {
  version: 1,
  cameras: [
    {
      id: 'nursery',
      name: 'Nursery',
      rtspUrl: 'rtsp://cam/s',
      entities: { temperature: 'sensor.nursery_temp' },
    },
  ],
  layout: { mode: 'grid' },
}

describe('CameraDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

  beforeEach(() => {
    setActivePinia(createPinia())
    useConfigStore().config = structuredClone(savedConfig)
    // The server echoes the saved config back, as the real one does.
    fetchMock = vi.fn<typeof fetch>(async (_input, init) => new Response(init?.body ?? '{}'))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  const putBody = (): AppConfig => {
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    return JSON.parse(String(put?.[1]?.body))
  }

  it('adds a camera with an id derived from its name and no blank sensors', async () => {
    const wrapper = mount(CameraDialog)
    expect(wrapper.text()).toContain('Add camera')

    await wrapper.find('input[placeholder^="e.g."]').setValue("Maya's room")
    await wrapper.find('input[placeholder^="rtsp://"]').setValue(' rtsp://cam/maya ')
    await wrapper.find('input[placeholder="binary_sensor.nursery_crying"]').setValue('  ')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(putBody().cameras[1]).toEqual({
      id: 'maya-s-room',
      name: "Maya's room",
      rtspUrl: 'rtsp://cam/maya',
      entities: {},
    })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('edits a camera without changing its id or the store before saving', async () => {
    const wrapper = mount(CameraDialog, { props: { cameraId: 'nursery' } })
    const name = wrapper.find('input[placeholder^="e.g."]')
    expect((name.element as HTMLInputElement).value).toBe('Nursery')

    await name.setValue('Cot')
    expect(useConfigStore().config.cameras[0]?.name).toBe('Nursery')

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(putBody().cameras).toEqual([{ ...savedConfig.cameras[0], name: 'Cot' }])
  })

  it('blocks saving and shows the field error for an invalid RTSP URL', async () => {
    const wrapper = mount(CameraDialog, { props: { cameraId: 'nursery' } })

    await wrapper.find('input[placeholder^="rtsp://"]').setValue('http://cam')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Expected an rtsp:// or rtsps:// URL')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('removes a camera, stops its audio and leaves edit mode when none are left', async () => {
    const monitor = useMonitorStore()
    monitor.setAudio('nursery', true)
    monitor.setEditing(true)
    const wrapper = mount(CameraDialog, { props: { cameraId: 'nursery' } })

    const remove = wrapper.findAll('button').find((b) => b.text() === 'Remove')
    await remove?.trigger('click')
    await flushPromises()

    expect(putBody().cameras).toEqual([])
    expect(monitor.audioCameraId).toBeUndefined()
    expect(monitor.editing).toBe(false)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows server-side validation errors next to the field', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          error: 'Invalid config',
          issues: [{ path: ['cameras', 0, 'rtspUrl'], message: 'Camera unreachable' }],
        },
        { status: 400 },
      ),
    )
    const wrapper = mount(CameraDialog, { props: { cameraId: 'nursery' } })
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Camera unreachable')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('closes on Escape', async () => {
    const wrapper = mount(CameraDialog)
    await wrapper.find('input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  describe('sub-stream address', () => {
    const subInput = (wrapper: ReturnType<typeof mount>) =>
      wrapper.find('input[placeholder="rtsp://user:pass@192.168.1.20:554/stream2"]')

    it('explains the optional field', () => {
      const wrapper = mount(CameraDialog)
      expect(wrapper.text()).toContain('Sub-stream address (RTSP, optional)')
      expect(wrapper.text()).toContain('lower-resolution stream')
    })

    it('saves a trimmed sub-stream address', async () => {
      const wrapper = mount(CameraDialog, { props: { cameraId: 'nursery' } })
      await subInput(wrapper).setValue(' rtsp://cam/sub ')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(putBody().cameras[0]?.subRtspUrl).toBe('rtsp://cam/sub')
    })

    it('leaves the field out when it is blank', async () => {
      const wrapper = mount(CameraDialog, { props: { cameraId: 'nursery' } })
      await subInput(wrapper).setValue('   ')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(putBody().cameras[0]).not.toHaveProperty('subRtspUrl')
    })

    it('clears an existing sub-stream address when the field is emptied', async () => {
      useConfigStore().config.cameras[0]!.subRtspUrl = 'rtsp://cam/sub'
      const wrapper = mount(CameraDialog, { props: { cameraId: 'nursery' } })
      expect((subInput(wrapper).element as HTMLInputElement).value).toBe('rtsp://cam/sub')

      await subInput(wrapper).setValue('')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(putBody().cameras[0]).not.toHaveProperty('subRtspUrl')
    })

    it('shows the field error and blocks saving for an invalid address', async () => {
      const wrapper = mount(CameraDialog, { props: { cameraId: 'nursery' } })
      await subInput(wrapper).setValue('http://cam/sub')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.text()).toContain('Expected an rtsp:// or rtsps:// URL')
      expect(wrapper.text()).not.toContain('lower-resolution stream')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
