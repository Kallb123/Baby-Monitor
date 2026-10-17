import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { useMonitorStore } from '../monitor'

describe('monitor store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('plays audio from one camera at a time', () => {
    const monitor = useMonitorStore()
    monitor.toggleAudio('nursery')
    expect(monitor.audioCameraId).toBe('nursery')

    monitor.toggleAudio('cot')
    expect(monitor.audioCameraId).toBe('cot')

    monitor.toggleAudio('cot')
    expect(monitor.audioCameraId).toBeUndefined()
  })

  it('only stops audio for the camera that is playing', () => {
    const monitor = useMonitorStore()
    monitor.setAudio('nursery', true)
    monitor.setAudio('cot', false)
    expect(monitor.audioCameraId).toBe('nursery')

    monitor.setAudio('nursery', false)
    expect(monitor.audioCameraId).toBeUndefined()
  })

  it('remembers this device’s layout across reloads', async () => {
    const monitor = useMonitorStore()
    expect(monitor.layoutMode).toBeUndefined()

    monitor.setLayout('focus')
    monitor.focus('cot')
    await nextTick()

    setActivePinia(createPinia())
    const reloaded = useMonitorStore()
    expect(reloaded.layoutMode).toBe('focus')
    expect(reloaded.focusCameraId).toBe('cot')
  })

  it('ignores a corrupt stored layout', () => {
    localStorage.setItem('baby-monitor:layout', '{"mode":"carousel"')
    expect(useMonitorStore().layoutMode).toBeUndefined()

    localStorage.setItem('baby-monitor:layout', '{"mode":"carousel"}')
    setActivePinia(createPinia())
    expect(useMonitorStore().layoutMode).toBeUndefined()
  })
})
