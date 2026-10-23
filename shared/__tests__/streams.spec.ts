import { describe, expect, it } from 'vitest'

import { cameraSchema } from '../config.ts'
import { streamName, streamQualities } from '../streams.ts'

describe('streamName', () => {
  it('keeps the camera id for the main stream so existing streams keep working', () => {
    expect(streamName('nursery', 'main')).toBe('nursery')
  })

  it('adds a .sub suffix for the sub stream', () => {
    expect(streamName('nursery', 'sub')).toBe('nursery.sub')
  })

  it('cannot collide with another camera id, which never contains a dot', () => {
    expect(cameraSchema.shape.id.safeParse('nursery.sub').success).toBe(false)
    expect(streamQualities).toEqual(['main', 'sub'])
  })
})
