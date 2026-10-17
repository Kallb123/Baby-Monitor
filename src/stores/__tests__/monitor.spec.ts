import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useMonitorStore } from '../monitor'

describe('monitor store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('plays audio from one camera at a time', () => {
    const monitor = useMonitorStore()
    monitor.toggleAudio('nursery')
    expect(monitor.audioCameraId).toBe('nursery')

    monitor.toggleAudio('cot')
    expect(monitor.audioCameraId).toBe('cot')

    monitor.toggleAudio('cot')
    expect(monitor.audioCameraId).toBeUndefined()
  })
})
