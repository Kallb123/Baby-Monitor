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

  it('shows the battery in full screen by default and remembers the sensor', async () => {
    const settings = useSettingsStore()
    expect(settings.batteryDisplay).toBe('fullscreen')
    expect(settings.batteryEntityId).toBeUndefined()

    settings.setBatteryDisplay('always')
    settings.setBatteryEntityId('sensor.tablet_battery_level')
    await nextTick()

    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    expect(reloaded.batteryDisplay).toBe('always')
    expect(reloaded.batteryEntityId).toBe('sensor.tablet_battery_level')
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
      stirringSensitivity: {},
      feedLostAlerts: true,
      feedLostSound: true,
      streamQuality: 'auto',
      batteryDisplay: 'fullscreen',
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

  it('defaults every camera to medium stirring sensitivity', () => {
    const settings = useSettingsStore()
    expect(settings.sensitivityFor('nursery')).toBe('medium')
    expect(settings.stirringSensitivity).toEqual({})
  })

  it('remembers stirring sensitivity per camera on this device', async () => {
    const settings = useSettingsStore()
    settings.setSensitivity('nursery', 'high')
    settings.setSensitivity('cot', 'low')
    settings.setSensitivity('cot', 'medium')
    await nextTick()

    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    expect(reloaded.sensitivityFor('nursery')).toBe('high')
    expect(reloaded.sensitivityFor('cot')).toBe('medium')
    expect(reloaded.stirringSensitivity).toEqual({ nursery: 'high' })
  })

  it('keeps other settings when sensitivity is saved, and the reverse', async () => {
    localStorage.setItem(
      'baby-monitor:settings',
      '{"showDecibels":true,"hiddenCameraIds":["cot"],"stirringSensitivity":{"nursery":"low"}}',
    )
    const settings = useSettingsStore()
    expect(settings.sensitivityFor('nursery')).toBe('low')
    settings.setSensitivity('nursery', 'high')
    await nextTick()
    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    expect(reloaded.showDecibels).toBe(true)
    expect(reloaded.hiddenCameraIds).toEqual(['cot'])
    expect(reloaded.sensitivityFor('nursery')).toBe('high')

    reloaded.setShowDecibels(false)
    await nextTick()
    setActivePinia(createPinia())
    expect(useSettingsStore().sensitivityFor('nursery')).toBe('high')
  })

  it('ignores a corrupt sensitivity list', () => {
    localStorage.setItem('baby-monitor:settings', '{"stirringSensitivity":{"nursery":"loud"}}')
    expect(useSettingsStore().sensitivityFor('nursery')).toBe('medium')
  })

  it('forgets stirring sensitivity of cameras that were deleted', async () => {
    const settings = useSettingsStore()
    settings.setSensitivity('nursery', 'high')
    settings.setSensitivity('gone', 'low')
    settings.pruneStirringSensitivity(['nursery', 'cot'])
    await nextTick()
    expect(settings.stirringSensitivity).toEqual({ nursery: 'high' })

    setActivePinia(createPinia())
    expect(useSettingsStore().sensitivityFor('gone')).toBe('medium')
  })

  it('turns feed-lost alerts and their sound on by default, and remembers changes', async () => {
    const settings = useSettingsStore()
    expect(settings.feedLostAlerts).toBe(true)
    expect(settings.feedLostSound).toBe(true)

    settings.setFeedLostAlerts(false)
    settings.setFeedLostSound(false)
    await nextTick()

    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    expect(reloaded.feedLostAlerts).toBe(false)
    expect(reloaded.feedLostSound).toBe(false)
  })

  it('keeps feed-lost alerts on in older saves that predate them', () => {
    localStorage.setItem('baby-monitor:settings', '{"showDecibels":true}')
    const settings = useSettingsStore()
    expect(settings.feedLostAlerts).toBe(true)
    expect(settings.feedLostSound).toBe(true)
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
