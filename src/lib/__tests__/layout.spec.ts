import { describe, expect, it } from 'vitest'

import { bestGrid } from '../layout'

describe('bestGrid', () => {
  it('uses a single tile for one camera', () => {
    expect(bestGrid(1, 1280, 720)).toEqual({ columns: 1, rows: 1 })
  })

  it('stacks two cameras on a portrait phone', () => {
    expect(bestGrid(2, 390, 844)).toEqual({ columns: 1, rows: 2 })
  })

  it('places two cameras side by side on a landscape phone', () => {
    expect(bestGrid(2, 844, 390)).toEqual({ columns: 2, rows: 1 })
  })

  it('uses a 2x2 grid for four cameras on a landscape tablet', () => {
    expect(bestGrid(4, 1280, 800)).toEqual({ columns: 2, rows: 2 })
  })

  it('falls back to one column before the container is measured', () => {
    expect(bestGrid(3, 0, 0)).toEqual({ columns: 1, rows: 3 })
  })
})
