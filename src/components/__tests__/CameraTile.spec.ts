import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'

import CameraTile from '../CameraTile.vue'

const reconnect = vi.fn<() => Promise<void>>(() => Promise.resolve())
vi.mock('@/composables/useWebRtcStream', () => ({
  useWebRtcStream: () => ({ stream: shallowRef(), status: ref('live'), error: ref(), reconnect }),
}))
vi.mock('@/composables/useAudioLevel', () => ({
  useAudioLevel: () => ({ level: ref(0.5) }),
}))

const camera = {
  id: 'nursery',
  name: 'Nursery',
  rtspUrl: 'rtsp://cam/s',
  entities: { cry: 'binary_sensor.nursery_crying', temperature: 'sensor.nursery_temp' },
}

describe('CameraTile', () => {
  beforeEach(() => {
    HTMLMediaElement.prototype.play = vi.fn<HTMLMediaElement['play']>(() => Promise.resolve())
  })

  it('unmutes inside the tap handler and asks the parent to start audio', async () => {
    const wrapper = mount(CameraTile, { props: { camera, states: {}, audioActive: false } })
    // Let post-mount watchers settle, as they would long before a real tap.
    await flushPromises()
    const video = wrapper.find('video').element

    expect(video.muted).toBe(true)
    await wrapper.trigger('click')

    expect(video.muted).toBe(false)
    expect(video.play).toHaveBeenCalled()
    expect(wrapper.emitted('audio')).toEqual([[true]])
  })

  it('asks to stop audio when the listening tile is tapped again', async () => {
    const wrapper = mount(CameraTile, { props: { camera, states: {}, audioActive: true } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('audio')).toEqual([[false]])
  })

  it('keeps listening when a focus-layout thumbnail is tapped', async () => {
    const wrapper = mount(CameraTile, {
      props: { camera, states: {}, audioActive: true, listenOnTap: true },
    })
    await wrapper.trigger('click')
    expect(wrapper.find('video').element.muted).toBe(false)
    expect(wrapper.emitted('audio')).toEqual([[true]])
  })

  it('asks to edit instead of playing audio in edit mode', async () => {
    const wrapper = mount(CameraTile, {
      props: { camera, states: {}, audioActive: false, editing: true },
    })
    await flushPromises()
    await wrapper.trigger('click')

    expect(wrapper.find('video').element.muted).toBe(true)
    expect(wrapper.emitted('audio')).toBeUndefined()
    expect(wrapper.emitted('edit')).toHaveLength(1)
    expect(wrapper.text()).toContain('Edit camera')
  })

  it('shows listening and muted badges', async () => {
    const wrapper = mount(CameraTile, { props: { camera, states: {}, audioActive: true } })
    expect(wrapper.text()).toContain('Listening')
    expect(wrapper.find('[title="Muted"]').exists()).toBe(false)

    await wrapper.setProps({ audioActive: false })
    expect(wrapper.text()).not.toContain('Listening')
    expect(wrapper.find('[title="Muted"]').exists()).toBe(true)
  })

  it('hides badge and status text on compact thumbnails', () => {
    const wrapper = mount(CameraTile, {
      props: { camera, states: {}, audioActive: true, compact: true },
    })
    expect(wrapper.classes()).toContain('compact')
    expect(wrapper.text()).not.toContain('Listening')
    expect(wrapper.find('.sound-status').exists()).toBe(false)
  })

  it('reconnects when the camera source changes', async () => {
    reconnect.mockClear()
    const wrapper = mount(CameraTile, { props: { camera, states: {}, audioActive: false } })
    await wrapper.setProps({ camera: { ...camera, name: 'Cot' } })
    expect(reconnect).not.toHaveBeenCalled()

    await wrapper.setProps({ camera: { ...camera, rtspUrl: 'rtsp://cam/new' } })
    expect(reconnect).toHaveBeenCalledOnce()
  })

  it('mutes when audio moves to another tile', async () => {
    const wrapper = mount(CameraTile, { props: { camera, states: {}, audioActive: true } })
    await wrapper.setProps({ audioActive: false })
    expect(wrapper.find('video').element.muted).toBe(true)
  })

  it('shows Home Assistant readings and the crying state', () => {
    const lastChanged = '2026-10-17T10:00:00Z'
    const wrapper = mount(CameraTile, {
      props: {
        camera,
        audioActive: false,
        states: {
          'binary_sensor.nursery_crying': {
            entityId: 'binary_sensor.nursery_crying',
            state: 'on',
            lastChanged,
          },
          'sensor.nursery_temp': {
            entityId: 'sensor.nursery_temp',
            state: '21.46',
            unit: '°C',
            lastChanged,
          },
        },
      },
    })
    expect(wrapper.classes()).toContain('crying')
    expect(wrapper.find('[aria-label="Crying detected"]').exists()).toBe(true)
    expect(wrapper.find('.sound-status').text()).toBe('Crying')
    expect(wrapper.attributes('aria-label')).toBe('Nursery, Crying')
    expect(wrapper.text()).toContain('21.5°C')
  })
})
