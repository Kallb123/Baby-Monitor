import { describe, expect, it } from 'vitest'

import {
  appUpdateMessages,
  shouldCheckNow,
  UPDATE_CHECK_THROTTLE_MS,
  type AppUpdateStatus,
} from '../app-update'

describe('appUpdateMessages', () => {
  it('has a non-empty message for every status', () => {
    const statuses: AppUpdateStatus[] = [
      'registering',
      'unsupported',
      'insecure',
      'idle',
      'checking',
      'up-to-date',
      'available',
      'updating',
      'reload-needed',
      'error',
    ]
    for (const status of statuses) expect(appUpdateMessages[status]).not.toBe('')
  })
})

describe('appUpdateMessages wording', () => {
  it('only mentions HTTPS for the insecure status', () => {
    expect(appUpdateMessages.insecure).toContain('HTTPS')
    expect(appUpdateMessages.unsupported).not.toContain('HTTPS')
  })

  it('warns that streams reconnect when a reload is needed', () => {
    expect(appUpdateMessages['reload-needed']).toContain('streams reconnect')
  })
})

describe('shouldCheckNow', () => {
  it('checks when nothing has been checked yet', () => {
    expect(shouldCheckNow(undefined, 1000)).toBe(true)
  })

  it('skips a check inside the throttle window', () => {
    expect(shouldCheckNow(1000, 1000 + UPDATE_CHECK_THROTTLE_MS - 1)).toBe(false)
  })

  it('checks once the window has passed', () => {
    expect(shouldCheckNow(1000, 1000 + UPDATE_CHECK_THROTTLE_MS)).toBe(true)
  })
})
