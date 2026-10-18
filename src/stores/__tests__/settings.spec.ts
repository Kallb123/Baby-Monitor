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
})
