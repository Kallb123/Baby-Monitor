import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, shallowRef, type Ref } from 'vue'

import type { StreamDetails } from '@/lib/stream-details'
import { FEED_LOST_AFTER_MS } from '@/lib/feed-alerts'
import { useFeedAlertsStore } from '@/stores/feed-alerts'
import CameraTile from '../CameraTile.vue'

const details = shallowRef<StreamDetails>({})
const streamStatus = ref('live')
const reconnect = vi.fn<() => Promise<void>>(() => Promise.resolve())
// The tile's most recent quality ref, to read what it asks the stream to play.
let requestedQuality: Ref<string | undefined>
vi.mock('@/composables/useWebRtcStream', () => ({
  useWebRtcStream: (_id: unknown, _details: unknown, quality: Ref<string | undefined>) => {
    requestedQuality = quality
    return { stream: shallowRef(), status: streamStatus, details, error: ref(), reconnect }
  },
}))
const meterDb = ref<number | undefined>(-30.4)
vi.mock('@/composables/useAudioLevel', () => ({
  useAudioLevel: () => ({ level: ref(0.5), db: meterDb, status: ref('live') }),
}))

const camera = {
  id: 'nursery',
  name: 'Nursery',
  rtspUrl: 'rtsp://cam/s',
  entities: { cry: 'binary_sensor.nursery_crying', temperature: 'sensor.nursery_temp' },
}

describe('CameraTile', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    details.value = {}
    streamStatus.value = 'live'
    meterDb.value = -30.4
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

  it('reports its stream status to the feed alerts until it unmounts', async () => {
    vi.useFakeTimers()
    try {
      streamStatus.value = 'error'
      const alerts = useFeedAlertsStore()
      const wrapper = mount(CameraTile, { props: { camera, states: {}, audioActive: false } })
      vi.advanceTimersByTime(FEED_LOST_AFTER_MS)
      expect(alerts.lostFeeds.map((f) => f.cameraId)).toEqual(['nursery'])

      streamStatus.value = 'live'
      await flushPromises()
      expect(alerts.lostFeeds).toEqual([])

      streamStatus.value = 'error'
      await flushPromises()
      vi.advanceTimersByTime(FEED_LOST_AFTER_MS)
      expect(alerts.lostFeeds).toHaveLength(1)

      // A hidden or deleted camera unmounts its tile; that is not a lost feed.
      wrapper.unmount()
      expect(alerts.lostFeeds).toEqual([])
    } finally {
      vi.useRealTimers()
    }
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

  it('shows the learned background noise beside the level once it is known', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mount(CameraTile, {
        props: { camera, states: {}, audioActive: false, showDecibels: true },
      })
      expect(wrapper.find('.decibels').text()).toBe('-30 dB')

      for (let i = 0; i < 20 * 15; i++) {
        meterDb.value = -38.4 + (i % 2) * 0.01
        await nextTick()
        vi.advanceTimersByTime(66)
      }
      expect(wrapper.find('.decibels').text()).toBe('-38 dB · bg -38')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads stirring at a level that depends on the camera sensitivity', async () => {
    const wrapper = mount(CameraTile, { props: { camera, states: {}, audioActive: false } })
    meterDb.value = -45
    await nextTick()
    expect(wrapper.find('.sound-status').text()).toBe('Quiet')

    await wrapper.setProps({ stirringSensitivity: 'high' })
    meterDb.value = -44
    await nextTick()
    expect(wrapper.find('.sound-status').text()).toBe('Stirring')
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

  describe('main and sub streams', () => {
    const withSub = { ...camera, subRtspUrl: 'rtsp://cam/sub' }

    it('asks for the main stream when the camera has no sub-stream', () => {
      mount(CameraTile, { props: { camera, states: {}, audioActive: false, streamQuality: 'sub' } })
      expect(requestedQuality.value).toBe('main')
    })

    it('asks for the stream the preference names when the camera has a sub-stream', () => {
      mount(CameraTile, {
        props: { camera: withSub, states: {}, audioActive: false, streamQuality: 'sub' },
      })
      expect(requestedQuality.value).toBe('sub')
      mount(CameraTile, {
        props: { camera: withSub, states: {}, audioActive: false, streamQuality: 'main' },
      })
      expect(requestedQuality.value).toBe('main')
    })

    it('shows which stream is playing in the stream details', async () => {
      const wrapper = mount(CameraTile, {
        props: {
          camera: withSub,
          states: {},
          audioActive: false,
          showStreamDetails: true,
          streamQuality: 'sub',
        },
      })
      expect(wrapper.get('.stream-details').text()).toContain('Stream: Sub')
      await wrapper.setProps({ streamQuality: 'main' })
      expect(wrapper.get('.stream-details').text()).toContain('Stream: Main')
      await wrapper.setProps({ compact: true })
      expect(wrapper.get('.stream-details').text()).toContain('Main · —')
    })

    it('reconnects when the sub-stream address changes while playing it', async () => {
      reconnect.mockClear()
      const wrapper = mount(CameraTile, {
        props: { camera: withSub, states: {}, audioActive: false, streamQuality: 'sub' },
      })
      await wrapper.setProps({ camera: { ...withSub, subRtspUrl: 'rtsp://cam/sub2' } })
      expect(reconnect).toHaveBeenCalledOnce()
    })

    it('does not reconnect for a sub-stream address change while playing main', async () => {
      reconnect.mockClear()
      const wrapper = mount(CameraTile, {
        props: { camera: withSub, states: {}, audioActive: false, streamQuality: 'main' },
      })
      await wrapper.setProps({ camera: { ...withSub, subRtspUrl: 'rtsp://cam/sub2' } })
      expect(reconnect).not.toHaveBeenCalled()
    })

    it('leaves reconnecting to the quality change when a sub-stream is added or removed', async () => {
      reconnect.mockClear()
      const wrapper = mount(CameraTile, {
        props: { camera, states: {}, audioActive: false, streamQuality: 'sub' },
      })
      expect(requestedQuality.value).toBe('main')
      await wrapper.setProps({ camera: withSub })
      expect(requestedQuality.value).toBe('sub')
      await wrapper.setProps({ camera })
      expect(requestedQuality.value).toBe('main')
      expect(reconnect).not.toHaveBeenCalled()
    })
  })
})
