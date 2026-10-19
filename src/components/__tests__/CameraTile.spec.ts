import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'

import type { StreamDetails } from '@/lib/stream-details'
import CameraTile from '../CameraTile.vue'

const details = shallowRef<StreamDetails>({})
const streamStatus = ref('live')
const reconnect = vi.fn<() => Promise<void>>(() => Promise.resolve())
vi.mock('@/composables/useWebRtcStream', () => ({
  useWebRtcStream: () => ({
    stream: shallowRef(),
    status: streamStatus,
    details,
    error: ref(),
    reconnect,
  }),
}))
vi.mock('@/composables/useAudioLevel', () => ({
  useAudioLevel: () => ({ level: ref(0.5), db: ref(-30.4), status: ref('live') }),
}))

const camera = {
  id: 'nursery',
  name: 'Nursery',
  rtspUrl: 'rtsp://cam/s',
  entities: { cry: 'binary_sensor.nursery_crying', temperature: 'sensor.nursery_temp' },
}

describe('CameraTile', () => {
  beforeEach(() => {
    details.value = {}
    streamStatus.value = 'live'
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

  it('shows the level in dB only when asked to', async () => {
    const wrapper = mount(CameraTile, { props: { camera, states: {}, audioActive: false } })
    expect(wrapper.find('.decibels').exists()).toBe(false)

    await wrapper.setProps({ showDecibels: true })
    expect(wrapper.find('.decibels').text()).toBe('-30 dB')
  })

  it('shows current stream details only when enabled and live, including compact tiles', async () => {
    details.value = {
      resolution: '1920 × 1080',
      framesPerSecond: 30,
      videoCodec: 'H264',
      audioCodec: 'OPUS',
    }
    const wrapper = mount(CameraTile, { props: { camera, states: {}, audioActive: false } })
    expect(wrapper.find('.stream-details').exists()).toBe(false)
    await wrapper.setProps({ showStreamDetails: true })
    const overlay = wrapper.get('.stream-details')
    expect(overlay.text()).toContain('1920 × 1080 · 30 fps · H264')
    expect(overlay.text()).toContain('Audio: OPUS')
    await wrapper.setProps({ compact: true })
    expect(overlay.text()).toContain('1920×1080 · H264')
    expect(overlay.text()).toContain('OPUS · 30 fps')
    await wrapper.setProps({ compact: false })
    details.value = {}
    await flushPromises()
    expect(overlay.text()).toContain('Video: — · — · —')
    expect(overlay.text()).toContain('Audio: —')
    streamStatus.value = 'error'
    await flushPromises()
    expect(wrapper.find('.stream-details').exists()).toBe(false)
    wrapper.unmount()
  })
})
