import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import LevelMeter from '../LevelMeter.vue'

describe('LevelMeter', () => {
  it('lights segments in proportion to the level', () => {
    const wrapper = mount(LevelMeter, { props: { level: 0.5, segments: 10 } })
    expect(wrapper.findAll('.segment.lit')).toHaveLength(5)
    expect(wrapper.attributes('aria-valuenow')).toBe('50')
  })

  it('uses twelve segments, turning terracotta near the top', () => {
    const wrapper = mount(LevelMeter, { props: { level: 1 } })
    const segments = wrapper.findAll('.segment')
    expect(segments).toHaveLength(12)
    expect(
      segments.map((s) => s.classes().find((c) => ['low', 'mid', 'high'].includes(c))),
    ).toEqual([...Array(5).fill('low'), ...Array(3).fill('mid'), ...Array(4).fill('high')])
  })

  it('clamps out-of-range levels', () => {
    const wrapper = mount(LevelMeter, { props: { level: 3, segments: 8 } })
    expect(wrapper.findAll('.segment.lit')).toHaveLength(8)
  })
})
