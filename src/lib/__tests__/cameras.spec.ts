import { describe, expect, it } from 'vitest'

import { cameraSchema } from '@shared/config.ts'
import { cameraIdFromName } from '../cameras'

const isValidId = (id: string) => cameraSchema.shape.id.safeParse(id).success

describe('cameraIdFromName', () => {
  it('slugifies the display name', () => {
    expect(cameraIdFromName("Maya's Room", [])).toBe('maya-s-room')
    expect(cameraIdFromName('Crèche 2', [])).toBe('creche-2')
  })

  it('falls back when the name has no usable characters', () => {
    expect(cameraIdFromName('👶', [])).toBe('camera')
  })

  it('adds a suffix to avoid existing ids', () => {
    expect(cameraIdFromName('Theo', ['theo', 'theo-2'])).toBe('theo-3')
  })

  it.each([
    ['x'.repeat(80), []],
    ['x'.repeat(80), ['x'.repeat(64)]],
    [`${'a'.repeat(63)} b`, []],
    ['  -Nursery-  ', []],
  ])('produces an id the config schema accepts for %j', (name, taken) => {
    expect(isValidId(cameraIdFromName(name, taken))).toBe(true)
  })
})
