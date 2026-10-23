import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { useSettingsStore } from '../settings'

describe('settings store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('hides decibels by default and remembers the choice on this device', async () => {
    const settings = useSettingsStore()
    expect(settings.showDecibels).toBe(false)

    settings.setShowDecibels(true)
    await nextTick()

    setActivePinia(createPinia())
    expect(useSettingsStore().showDecibels).toBe(true)
  })

  it('ignores corrupt stored settings', () => {
    localStorage.setItem('baby-monitor:settings', '{"showDecibels":"yes"}')
    expect(useSettingsStore().showDecibels).toBe(false)
  })

  it('hides stream details in older saves and persists them alongside other settings', async () => {
    localStorage.setItem('baby-monitor:settings', '{"showDecibels":true,"hiddenCameraIds":["cot"]}')
    const settings = useSettingsStore()
    expect(settings.showStreamDetails).toBe(false)
    settings.setShowStreamDetails(true)
    await nextTick()

    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    expect(reloaded.showStreamDetails).toBe(true)
    expect(reloaded.showDecibels).toBe(true)
    expect(reloaded.hiddenCameraIds).toEqual(['cot'])

    reloaded.setShowDecibels(false)
    reloaded.setCameraHidden('nursery', true)
    await nextTick()
    setActivePinia(createPinia())
    expect(useSettingsStore().showStreamDetails).toBe(true)
  })

  it('hides no cameras by default', () => {
    const settings = useSettingsStore()
    expect(settings.hiddenCameraIds).toEqual([])
    expect(settings.isCameraHidden('nursery')).toBe(false)
  })

  it('remembers hidden cameras on this device', async () => {
    const settings = useSettingsStore()
    settings.setCameraHidden('nursery', true)
    settings.setCameraHidden('cot', true)
    settings.setCameraHidden('cot', false)
    await nextTick()

    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    expect(reloaded.hiddenCameraIds).toEqual(['nursery'])
    expect(reloaded.isCameraHidden('nursery')).toBe(true)
    expect(reloaded.isCameraHidden('cot')).toBe(false)
  })

  it('does not list a camera twice', () => {
    const settings = useSettingsStore()
    settings.setCameraHidden('nursery', true)
    settings.setCameraHidden('nursery', true)
    expect(settings.hiddenCameraIds).toEqual(['nursery'])
  })

  it('keeps each setting when the other one is saved', async () => {
    const settings = useSettingsStore()
    settings.setShowDecibels(true)
    await nextTick()
    settings.setCameraHidden('nursery', true)
    await nextTick()
    expect(JSON.parse(localStorage.getItem('baby-monitor:settings') ?? '{}')).toEqual({
      showDecibels: true,
      showStreamDetails: false,
      hiddenCameraIds: ['nursery'],
      streamQuality: 'auto',
    })

    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    reloaded.setShowDecibels(false)
    await nextTick()

    setActivePinia(createPinia())
    const again = useSettingsStore()
    expect(again.showDecibels).toBe(false)
    expect(again.hiddenCameraIds).toEqual(['nursery'])
  })

  it('reads saves made before cameras could be hidden', () => {
    localStorage.setItem('baby-monitor:settings', '{"showDecibels":true}')
    const settings = useSettingsStore()
    expect(settings.showDecibels).toBe(true)
    expect(settings.hiddenCameraIds).toEqual([])
  })

  it('ignores a corrupt hidden list', () => {
    localStorage.setItem('baby-monitor:settings', '{"hiddenCameraIds":"nursery"}')
    expect(useSettingsStore().hiddenCameraIds).toEqual([])
  })

  it('forgets hidden cameras that were deleted', async () => {
    const settings = useSettingsStore()
    settings.setCameraHidden('nursery', true)
    settings.setCameraHidden('gone', true)
    settings.pruneHiddenCameras(['nursery', 'cot'])
    await nextTick()
    expect(settings.hiddenCameraIds).toEqual(['nursery'])
  })

  it('chooses the stream quality automatically by default, including for older saves', () => {
    expect(useSettingsStore().streamQuality).toBe('auto')
    setActivePinia(createPinia())
    localStorage.setItem('baby-monitor:settings', '{"showDecibels":true}')
    expect(useSettingsStore().streamQuality).toBe('auto')
  })

  it('remembers the stream quality on this device without losing other settings', async () => {
    localStorage.setItem('baby-monitor:settings', '{"showDecibels":true,"hiddenCameraIds":["cot"]}')
    useSettingsStore().setStreamQuality('sub')
    await nextTick()

    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    expect(reloaded.streamQuality).toBe('sub')
    expect(reloaded.showDecibels).toBe(true)
    expect(reloaded.hiddenCameraIds).toEqual(['cot'])
  })

  it('ignores an unknown stored stream quality', () => {
    localStorage.setItem('baby-monitor:settings', '{"streamQuality":"huge"}')
    expect(useSettingsStore().streamQuality).toBe('auto')
  })
})
