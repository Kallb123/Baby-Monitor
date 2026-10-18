export interface StatusLineInput {
  editing: boolean
  /** Names of cameras whose cry sensor is on. */
  cryingNames: string[]
  /** Name of the camera whose audio is playing. */
  listeningName: string | undefined
  audioUnlocked: boolean
  hasCameras: boolean
  /** Cameras exist but this device hides every one of them. */
  allHidden?: boolean
}

/** The one-line summary under the header title, most urgent first. */
export function statusLine(input: StatusLineInput): string {
  if (input.editing) return 'Tap a camera to edit or remove it'
  if (input.cryingNames.length > 0) return `${input.cryingNames.join(' & ')} crying`
  if (input.listeningName) return `Listening to ${input.listeningName}`
  if (input.allHidden) return 'All cameras are hidden'
  if (!input.hasCameras) return 'Add a camera to start'
  // Browsers keep audio suspended until a gesture, so the meters are flat until then.
  if (!input.audioUnlocked) return 'Tap anywhere to start the sound meters'
  return 'Tap a camera to listen'
}
