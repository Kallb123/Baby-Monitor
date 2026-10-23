import { getAudioContext } from '@/lib/audio-context'

/** How often the alert repeats while a lost feed stays undismissed. */
export const ALERT_REPEAT_MS = 60_000

const TONES = [
  { hz: 659.25, start: 0 },
  { hz: 523.25, start: 0.32 },
]
const TONE_SECONDS = 0.5
const PEAK_GAIN = 0.12
const VIBRATION_PATTERN = [200, 100, 200]

/**
 * Plays a short, gentle two-tone chime and vibrates. This is the one place the
 * app connects nodes to the speakers, so every node is disconnected when done.
 *
 * Sound only plays if the shared AudioContext is already running: browsers
 * allow that after a tap, and resuming it here (outside a gesture) would fail.
 */
export function playAlertChime() {
  navigator.vibrate?.(VIBRATION_PATTERN)

  const ctx = getAudioContext()
  if (!ctx || ctx.state !== 'running') return

  const gain = ctx.createGain()
  gain.gain.value = 0
  gain.connect(ctx.destination)

  const oscillators = TONES.map(({ hz, start }) => {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = hz
    osc.connect(gain)

    // Ramp up and down so the tone has no click.
    const begin = ctx.currentTime + start
    gain.gain.setValueAtTime(0, begin)
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, begin + 0.04)
    gain.gain.linearRampToValueAtTime(0, begin + TONE_SECONDS)
    osc.start(begin)
    osc.stop(begin + TONE_SECONDS)
    return osc
  })

  const last = oscillators[oscillators.length - 1]
  if (last) {
    last.onended = () => {
      for (const osc of oscillators) osc.disconnect()
      gain.disconnect()
    }
  }
}

/**
 * Repeats an alert while any camera is lost. Chimes right away when a camera
 * joins the lost set (a second outage must not wait for the next repeat), then
 * every `repeatMs` until the set is empty.
 */
export function createAlertScheduler(play: () => void, repeatMs = ALERT_REPEAT_MS) {
  let timer: ReturnType<typeof setInterval> | undefined
  let known = new Set<string>()

  function stop() {
    clearInterval(timer)
    timer = undefined
  }

  /** Call whenever the ids of lost, undismissed cameras may have changed. */
  function update(cameraIds: readonly string[]) {
    const next = new Set(cameraIds)
    const added = cameraIds.some((id) => !known.has(id))
    known = next
    if (next.size === 0) {
      stop()
      return
    }
    if (!added) return
    stop()
    play()
    timer = setInterval(play, repeatMs)
  }

  function dispose() {
    stop()
    known = new Set()
  }

  return { update, dispose }
}
