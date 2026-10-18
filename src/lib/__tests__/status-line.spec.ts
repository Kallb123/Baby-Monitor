import { describe, expect, it } from 'vitest'

import { statusLine, type StatusLineInput } from '../status-line'

const idle: StatusLineInput = {
  editing: false,
  cryingNames: [],
  listeningName: undefined,
  audioUnlocked: true,
  hasCameras: true,
}

describe('statusLine', () => {
  it('prompts to listen when nothing is happening', () => {
    expect(statusLine(idle)).toBe('Tap a camera to listen')
  })

  it('puts crying ahead of listening', () => {
    expect(statusLine({ ...idle, cryingNames: ['Maya', 'Theo'], listeningName: 'Maya' })).toBe(
      'Maya & Theo crying',
    )
  })

  it('names the camera being listened to', () => {
    expect(statusLine({ ...idle, listeningName: 'Theo' })).toBe('Listening to Theo')
  })

  it('explains edit mode above everything else', () => {
    expect(statusLine({ ...idle, editing: true, cryingNames: ['Maya'] })).toBe(
      'Tap a camera to edit or remove it',
    )
  })

  it('asks for a tap while audio is still locked', () => {
    expect(statusLine({ ...idle, audioUnlocked: false })).toBe(
      'Tap anywhere to start the sound meters',
    )
  })

  it('says so when every camera is hidden on this device', () => {
    expect(statusLine({ ...idle, hasCameras: false, allHidden: true })).toBe(
      'All cameras are hidden',
    )
  })

  it('still asks for a camera when none exist', () => {
    expect(statusLine({ ...idle, hasCameras: false })).toBe('Add a camera to start')
  })
})
