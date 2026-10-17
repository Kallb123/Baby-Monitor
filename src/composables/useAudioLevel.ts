import { onScopeDispose, ref, watch, type Ref } from 'vue'

import { audioUnlocked, getAudioContext } from '@/lib/audio-context'
import { levelFromSamples, smoothLevel } from '@/lib/audio-level'

/**
 * Live 0..1 loudness of a stream's audio track. Works while the stream is
 * muted for playback, because analysis taps the MediaStream, not the speaker.
 */
export function useAudioLevel(stream: Ref<MediaStream | undefined>) {
  const level = ref(0)

  let source: MediaStreamAudioSourceNode | undefined
  let frame: number | undefined

  function stop() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    source?.disconnect()
    source = undefined
    level.value = 0
  }

  function start(media: MediaStream) {
    const ctx = getAudioContext()
    if (!ctx || media.getAudioTracks().length === 0) return

    source = ctx.createMediaStreamSource(media)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    // Deliberately not connected to ctx.destination: analysis only, no sound.
    source.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)

    const tick = () => {
      analyser.getFloatTimeDomainData(samples)
      level.value = smoothLevel(level.value, levelFromSamples(samples))
      frame = requestAnimationFrame(tick)
    }
    tick()
  }

  watch(
    [stream, audioUnlocked],
    ([media, unlocked]) => {
      stop()
      if (media && unlocked) start(media)
    },
    { immediate: true },
  )

  onScopeDispose(stop)

  return { level }
}
