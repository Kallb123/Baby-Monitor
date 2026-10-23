import { describe, expect, it, vi } from 'vitest'

import { cryIntervals } from '../cry-history.ts'
import { HomeAssistantClient } from '../home-assistant.ts'

const point = (state: string, lastChanged: string) => ({ state, lastChanged })

describe('cryIntervals', () => {
  it('turns on/off changes into intervals', () => {
    expect(
      cryIntervals([
        point('off', '2026-10-23T00:00:00Z'),
        point('on', '2026-10-23T02:14:00Z'),
        point('off', '2026-10-23T02:21:00Z'),
        point('on', '2026-10-23T04:00:00Z'),
        point('off', '2026-10-23T04:05:00Z'),
      ]),
    ).toEqual([
      { start: '2026-10-23T02:14:00.000Z', end: '2026-10-23T02:21:00.000Z' },
      { start: '2026-10-23T04:00:00.000Z', end: '2026-10-23T04:05:00.000Z' },
    ])
  })

  it('leaves the end off while still crying', () => {
    expect(
      cryIntervals([point('off', '2026-10-23T00:00:00Z'), point('on', '2026-10-23T05:00:00Z')]),
    ).toEqual([{ start: '2026-10-23T05:00:00.000Z' }])
  })

  it('starts at the window start when it was already crying then', () => {
    expect(
      cryIntervals([point('on', '2026-10-23T00:00:00Z'), point('off', '2026-10-23T00:03:00Z')]),
    ).toEqual([{ start: '2026-10-23T00:00:00.000Z', end: '2026-10-23T00:03:00.000Z' }])
  })

  it.each(['unavailable', 'unknown'])('ends an interval when the sensor goes %s', (state) => {
    expect(
      cryIntervals([
        point('on', '2026-10-23T01:00:00Z'),
        point(state, '2026-10-23T01:10:00Z'),
        point('off', '2026-10-23T01:20:00Z'),
      ]),
    ).toEqual([{ start: '2026-10-23T01:00:00.000Z', end: '2026-10-23T01:10:00.000Z' }])
  })

  it('ignores repeated on states and unparseable times', () => {
    expect(
      cryIntervals([
        point('on', '2026-10-23T01:00:00Z'),
        point('on', '2026-10-23T01:01:00Z'),
        point('off', 'garbage'),
        point('off', '2026-10-23T01:05:00Z'),
      ]),
    ).toEqual([{ start: '2026-10-23T01:00:00.000Z', end: '2026-10-23T01:05:00.000Z' }])
  })

  it('returns nothing without history', () => {
    expect(cryIntervals([])).toEqual([])
  })
})

describe('HomeAssistantClient.getHistory', () => {
  const from = new Date('2026-10-23T00:00:00Z')
  const to = new Date('2026-10-23T12:00:00Z')

  function client(fetchFake: typeof fetch) {
    return new HomeAssistantClient({
      baseUrl: 'http://ha:8123',
      token: 'secret-token',
      fetch: fetchFake,
    })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  it('asks HA for a minimal history of the entities with the token', async () => {
    const fetchFake = vi.fn<typeof fetch>(async () => json([]))
    await client(fetchFake).getHistory(['binary_sensor.a', 'binary_sensor.b'], from, to)

    const [url, init] = fetchFake.mock.calls[0]!
    const parsed = new URL(String(url))
    expect(decodeURIComponent(parsed.pathname)).toBe(`/api/history/period/${from.toISOString()}`)
    expect(parsed.searchParams.get('filter_entity_id')).toBe('binary_sensor.a,binary_sensor.b')
    expect(parsed.searchParams.get('end_time')).toBe(to.toISOString())
    expect(parsed.searchParams.has('minimal_response')).toBe(true)
    expect(parsed.searchParams.has('no_attributes')).toBe(true)
    expect(init?.headers).toEqual({ Authorization: 'Bearer secret-token' })
  })

  it('takes the entity id from the first item of each minimal_response list', async () => {
    const fetchFake = vi.fn<typeof fetch>(async () =>
      json([
        [
          { entity_id: 'binary_sensor.a', state: 'off', last_changed: '2026-10-23T00:00:00+00:00' },
          { state: 'on', last_changed: '2026-10-23T02:14:00+00:00' },
          { state: 'unavailable', last_updated: '2026-10-23T02:21:00+00:00' },
        ],
        [{ entity_id: 'binary_sensor.b', state: 'on', last_changed: '2026-10-23T00:00:00+00:00' }],
        [{ entity_id: 'sensor.other', state: '1', last_changed: '2026-10-23T00:00:00+00:00' }],
      ]),
    )
    const history = await client(fetchFake).getHistory(
      ['binary_sensor.a', 'binary_sensor.b'],
      from,
      to,
    )

    expect(history).toEqual({
      'binary_sensor.a': [
        point('off', '2026-10-23T00:00:00+00:00'),
        point('on', '2026-10-23T02:14:00+00:00'),
        point('unavailable', '2026-10-23T02:21:00+00:00'),
      ],
      'binary_sensor.b': [point('on', '2026-10-23T00:00:00+00:00')],
    })
  })

  it('makes no request without entities', async () => {
    const fetchFake = vi.fn<typeof fetch>()
    expect(await client(fetchFake).getHistory([], from, to)).toEqual({})
    expect(fetchFake).not.toHaveBeenCalled()
  })

  it('fails with a message that holds neither URL nor token', async () => {
    const refused = client(
      vi.fn<typeof fetch>(async () => {
        throw new TypeError('fetch failed', {
          cause: new Error('connect ECONNREFUSED 10.0.0.5:8123'),
        })
      }),
    )
    const error = await refused.getHistory(['binary_sensor.a'], from, to).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('ECONNREFUSED')
    expect((error as Error).message).not.toContain('secret-token')

    await expect(
      client(vi.fn<typeof fetch>(async () => new Response('no', { status: 500 }))).getHistory(
        ['binary_sensor.a'],
        from,
        to,
      ),
    ).rejects.toThrow('Home Assistant responded 500 for history')
    await expect(
      client(vi.fn<typeof fetch>(async () => json({ message: 'odd' }))).getHistory(
        ['binary_sensor.a'],
        from,
        to,
      ),
    ).rejects.toThrow('malformed')
  })
})
