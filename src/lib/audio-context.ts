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

/**
 * Resumes the AudioContext on any tap or key press while it is not running.
 * The listeners stay installed because iOS can suspend the context again
 * later (screen lock, backgrounding, phone call).
 */
export function unlockAudioOnFirstGesture() {
  const resume = () => {
    const ctx = getAudioContext()
    if (ctx && ctx.state !== 'running') void ctx.resume()
  }
  window.addEventListener('pointerdown', resume)
  window.addEventListener('keydown', resume)
}
