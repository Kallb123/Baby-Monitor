import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { appConfigSchema } from '@shared/config.ts'
import { playAlertChime } from '@/lib/alert-sound'
import { FEED_LOST_AFTER_MS } from '@/lib/feed-alerts'
import { useConfigStore } from '@/stores/config'
import { useFeedAlertsStore } from '@/stores/feed-alerts'
import { useSettingsStore } from '@/stores/settings'
import FeedAlertBanner from '../FeedAlertBanner.vue'

vi.mock('@/lib/alert-sound', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/alert-sound')>()),
  playAlertChime: vi.fn<() => void>(),
}))

const camera = (id: string, name: string) => ({ id, name, rtspUrl: 'rtsp://cam/s' })

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await nextTick()
}

function mountBanner() {
  const config = useConfigStore()
  config.config = appConfigSchema.parse({
    cameras: [camera('nursery', 'Nursery'), camera('cot', 'Cot')],
  })
  return mount(FeedAlertBanner)
}

describe('FeedAlertBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    vi.mocked(playAlertChime).mockClear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing while every feed is fine or only briefly down', async () => {
    const wrapper = mountBanner()
    useFeedAlertsStore().report('nursery', 'connecting')
    await advance(FEED_LOST_AFTER_MS - 1000)

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('announces a lost feed by camera name, in seconds then minutes', async () => {
    const wrapper = mountBanner()
    useFeedAlertsStore().report('nursery', 'error')
    await advance(FEED_LOST_AFTER_MS)

    expect(wrapper.find('[role="alert"]').text()).toContain('Nursery feed lost · 30 s')

    await advance(60_000)
    expect(wrapper.text()).toContain('Nursery feed lost · 1 min')
    wrapper.unmount()
  })

  it('lists each lost feed with its own dismiss button', async () => {
    const wrapper = mountBanner()
    const alerts = useFeedAlertsStore()
    alerts.report('nursery', 'error')
    alerts.report('cot', 'connecting')
    await advance(FEED_LOST_AFTER_MS)

    expect(wrapper.findAll('.feed')).toHaveLength(2)
    await wrapper.get('button[aria-label="Dismiss alert for Nursery"]').trigger('click')

    expect(wrapper.findAll('.feed')).toHaveLength(1)
    expect(wrapper.text()).toContain('Cot feed lost')
    expect(wrapper.text()).not.toContain('Nursery')
    wrapper.unmount()
  })

  it('disappears when the feed returns', async () => {
    const wrapper = mountBanner()
    const alerts = useFeedAlertsStore()
    alerts.report('nursery', 'error')
    await advance(FEED_LOST_AFTER_MS)
    alerts.report('nursery', 'live')
    await nextTick()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('chimes when a feed is lost and stops once it is dismissed', async () => {
    const wrapper = mountBanner()
    useFeedAlertsStore().report('nursery', 'error')
    await advance(FEED_LOST_AFTER_MS)
    expect(playAlertChime).toHaveBeenCalledTimes(1)

    await advance(60_000)
    expect(playAlertChime).toHaveBeenCalledTimes(2)

    await wrapper.get('.dismiss').trigger('click')
    await advance(3 * 60_000)
    expect(playAlertChime).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('shows the banner but stays quiet when the sound is off', async () => {
    useSettingsStore().setFeedLostSound(false)
    const wrapper = mountBanner()
    useFeedAlertsStore().report('nursery', 'error')
    await advance(FEED_LOST_AFTER_MS)

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(playAlertChime).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows nothing and stays quiet when alerts are off', async () => {
    useSettingsStore().setFeedLostAlerts(false)
    const wrapper = mountBanner()
    useFeedAlertsStore().report('nursery', 'error')
    await advance(FEED_LOST_AFTER_MS)

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(playAlertChime).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('releases its repeat timer when unmounted', async () => {
    const wrapper = mountBanner()
    useFeedAlertsStore().report('nursery', 'error')
    await advance(FEED_LOST_AFTER_MS)

    wrapper.unmount()
    useFeedAlertsStore().forget('nursery')
    expect(vi.getTimerCount()).toBe(0)
  })
})
