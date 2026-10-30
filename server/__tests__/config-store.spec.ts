import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import { ConfigStore } from '../config-store.ts'

const camera = {
  id: 'nursery',
  name: 'Nursery',
  rtspUrl: 'rtsp://192.168.1.20:554/stream1',
  entities: { cry: 'binary_sensor.nursery_crying' },
}

describe('ConfigStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'baby-monitor-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns the default config when no file exists', async () => {
    const store = new ConfigStore(dir)
    expect(await store.load()).toEqual({
      version: 1,
      cameras: [],
      layout: { mode: 'grid' },
      batteryEntities: [],
    })
  })

  it('persists a saved config across instances', async () => {
    await new ConfigStore(dir).save({ cameras: [camera] })

    const reloaded = await new ConfigStore(dir).load()
    expect(reloaded.cameras).toEqual([camera])
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')).cameras).toHaveLength(1)
  })

  it('creates the data directory on first save', async () => {
    const store = new ConfigStore(join(dir, 'nested', 'data'))
    await store.save({})
    expect(await new ConfigStore(join(dir, 'nested', 'data')).load()).toEqual(await store.load())
  })

  it('rejects invalid configs without touching the file', async () => {
    const store = new ConfigStore(dir)
    await store.save({ cameras: [camera] })

    await expect(store.save({ cameras: [camera, camera] })).rejects.toBeInstanceOf(ZodError)
    expect((await new ConfigStore(dir).load()).cameras).toHaveLength(1)
  })

  it('fails loudly on a corrupt file', async () => {
    await writeFile(join(dir, 'config.json'), '{not json')
    await expect(new ConfigStore(dir).load()).rejects.toThrow(SyntaxError)
  })

  it('serialises concurrent saves', async () => {
    const store = new ConfigStore(dir)
    await Promise.all([
      store.save({ layout: { mode: 'grid' } }),
      store.save({ layout: { mode: 'focus' } }),
    ])
    expect((await new ConfigStore(dir).load()).layout.mode).toBe('focus')
  })
})
