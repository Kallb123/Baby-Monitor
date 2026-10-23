import { describe, expect, it, vi } from 'vitest'

import type { Camera } from '../../shared/config.ts'
import { Go2rtcClient } from '../go2rtc.ts'

const camera = (id: string, subRtspUrl?: string): Camera => ({
  id,
  name: id,
  rtspUrl: `rtsp://cam/${id}`,
  ...(subRtspUrl && { subRtspUrl }),
  entities: {},
})

function setup(status = 200) {
  const fetchFake = vi.fn<typeof fetch>(async () => new Response('', { status }))
  const client = new Go2rtcClient({ baseUrl: 'http://go2rtc:1984', fetch: fetchFake })
  const registered = () =>
    fetchFake.mock.calls.map(([url, init]) => {
      const { searchParams } = new URL(String(url))
      return { method: init?.method, name: searchParams.get('name'), src: searchParams.get('src') }
    })
  return { client, fetchFake, registered }
}

describe('Go2rtcClient.syncStreams', () => {
  it('registers one stream per camera when there are no sub-streams', async () => {
    const { client, registered } = setup()
    await client.syncStreams([camera('nursery'), camera('cot')])
    expect(registered()).toEqual([
      { method: 'PUT', name: 'nursery', src: 'rtsp://cam/nursery' },
      { method: 'PUT', name: 'cot', src: 'rtsp://cam/cot' },
    ])
  })

  it('also registers the sub stream under its own name', async () => {
    const { client, registered } = setup()
    await client.syncStreams([camera('nursery', 'rtsp://cam/nursery-sub'), camera('cot')])
    expect(registered()).toEqual([
      { method: 'PUT', name: 'nursery', src: 'rtsp://cam/nursery' },
      { method: 'PUT', name: 'nursery.sub', src: 'rtsp://cam/nursery-sub' },
      { method: 'PUT', name: 'cot', src: 'rtsp://cam/cot' },
    ])
  })

  it('names the stream go2rtc rejected', async () => {
    const { client } = setup(400)
    await expect(client.syncStreams([camera('nursery', 'rtsp://cam/sub')])).rejects.toThrow(
      /"nursery(\.sub)?"/,
    )
  })
})

describe('Go2rtcClient.negotiate', () => {
  it('asks go2rtc for the named stream', async () => {
    const { client, fetchFake } = setup()
    await client.negotiate('nursery.sub', 'v=0 offer')
    const [url, init] = fetchFake.mock.calls[0]!
    expect(new URL(String(url)).searchParams.get('src')).toBe('nursery.sub')
    expect(init?.body).toBe('v=0 offer')
  })
})
