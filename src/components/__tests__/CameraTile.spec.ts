import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'

import CameraTile from '../CameraTile.vue'

vi.mock('@/composables/useWebRtcStream', () => ({
  useWebRtcStream: () => ({ stream: shallowRef(), status: ref('live'), error: ref() }),
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

  it('unmutes inside the tap handler and asks the parent to switch audio', async () => {
    const wrapper = mount(CameraTile, { props: { camera, states: {}, audioActive: false } })
    // Let post-mount watchers settle, as they would long before a real tap.
    await flushPromises()
    const video = wrapper.find('video').element

    expect(video.muted).toBe(true)
    await wrapper.trigger('click')

    expect(video.muted).toBe(false)
    expect(video.play).toHaveBeenCalled()
    expect(wrapper.emitted('toggleAudio')).toHaveLength(1)
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
    expect(wrapper.text()).toContain('21.5°C')
  })
})
