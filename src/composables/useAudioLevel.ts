import { onScopeDispose, ref, watch, type Ref } from 'vue'

import { audioUnlocked, getAudioContext } from '@/lib/audio-context'
import { levelFromSamples, smoothLevel } from '@/lib/audio-level'

// ~15 Hz is smooth enough for a meter and keeps re-renders cheap with many tiles.
const SAMPLE_INTERVAL_MS = 66

/**
 * Live 0..1 loudness of a stream's audio track. Works while the stream is
 * muted for playback, because analysis taps the MediaStream, not the speaker.
 */
export function useAudioLevel(stream: Ref<MediaStream | undefined>) {
  const level = ref(0)

  let source: MediaStreamAudioSourceNode | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  function stop() {
    clearInterval(timer)
    timer = undefined
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

    timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      level.value = smoothLevel(level.value, levelFromSamples(samples))
    }, SAMPLE_INTERVAL_MS)
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
