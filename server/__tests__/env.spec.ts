import { describe, expect, it } from 'vitest'
import { readEnv } from '../env.ts'

describe('go2rtc connection settings', () => {
  it('connects to the default bundled API without configuration', () => {
    expect(readEnv({}).go2rtcUrl).toBe('http://localhost:1984')
  })

  it('follows the configured API port outside Docker too', () => {
    expect(readEnv({ GO2RTC_API_PORT: '9198' }).go2rtcUrl).toBe('http://localhost:9198')
  })

  it('prefers an explicit external URL and strips trailing slashes', () => {
    expect(
      readEnv({ GO2RTC_API_PORT: '9198', GO2RTC_URL: 'https://go2rtc.example/api///' }).go2rtcUrl,
    ).toBe('https://go2rtc.example/api')
  })

  it('treats empty values like Compose defaults', () => {
    expect(readEnv({ GO2RTC_API_PORT: '', GO2RTC_URL: '' }).go2rtcUrl).toBe('http://localhost:1984')
    expect(readEnv({ GO2RTC_API_PORT: '9198', GO2RTC_URL: '' }).go2rtcUrl).toBe(
      'http://localhost:9198',
    )
  })
})
