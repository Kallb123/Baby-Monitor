import { onScopeDispose, ref, watch, type Ref } from 'vue'

import { audioUnlocked, getAudioContext } from '@/lib/audio-context'
import {
  dbFromSamples,
  levelFromDb,
  smoothDb,
  smoothLevel,
  type AudioLevelStatus,
} from '@/lib/audio-level'

// ~15 Hz is smooth enough for a meter and keeps re-renders cheap with many tiles.
const SAMPLE_INTERVAL_MS = 66

/**
 * Live 0..1 loudness of a stream's audio track, plus the same level in dBFS.
 * Works while the stream is muted for playback, because analysis taps the
 * MediaStream, not the speaker.
 */
export function useAudioLevel(stream: Ref<MediaStream | undefined>) {
  const level = ref(0)
  /** Smoothed RMS level in dBFS; undefined until the first sample. */
  const db = ref<number>()
  const status = ref<AudioLevelStatus>('idle')

  let source: MediaStreamAudioSourceNode | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  function stop() {
    clearInterval(timer)
    timer = undefined
    source?.disconnect()
    source = undefined
    level.value = 0
    db.value = undefined
  }

  function start(media: MediaStream) {
    const ctx = getAudioContext()
    if (!ctx) return
    if (media.getAudioTracks().length === 0) {
      status.value = 'no-audio'
      return
    }
    status.value = 'live'

    source = ctx.createMediaStreamSource(media)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    // Deliberately not connected to ctx.destination: analysis only, no sound.
    source.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)

    timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      const sampleDb = dbFromSamples(samples)
      level.value = smoothLevel(level.value, levelFromDb(sampleDb))
      db.value = db.value === undefined ? sampleDb : smoothDb(db.value, sampleDb)
    }, SAMPLE_INTERVAL_MS)
  }

  watch(
    [stream, audioUnlocked],
    ([media, unlocked]) => {
      stop()
      status.value = media && !unlocked ? 'locked' : 'idle'
      if (media && unlocked) start(media)
    },
    { immediate: true },
  )

  onScopeDispose(stop)

  return { level, db, status }
}
