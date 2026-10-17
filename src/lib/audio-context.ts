import { ref } from 'vue'

let context: AudioContext | undefined

/**
 * True once the shared AudioContext is running. Browsers keep audio suspended
 * until the user interacts with the page, so level meters stay flat until then.
 */
export const audioUnlocked = ref(false)

/** One AudioContext for the whole app; browsers cap how many can exist. */
export function getAudioContext(): AudioContext | undefined {
  if (typeof AudioContext === 'undefined') return undefined
  if (!context) {
    context = new AudioContext()
    audioUnlocked.value = context.state === 'running'
    context.addEventListener('statechange', () => {
      audioUnlocked.value = context?.state === 'running'
    })
  }
  return context
}

export function unlockAudioOnFirstGesture() {
  const events = ['pointerdown', 'keydown'] as const
  const unlock = () => {
    const ctx = getAudioContext()
    if (!ctx) return
    void ctx.resume().then(() => {
      if (ctx.state !== 'running') return
      for (const event of events) window.removeEventListener(event, unlock)
    })
  }
  for (const event of events) window.addEventListener(event, unlock)
}
