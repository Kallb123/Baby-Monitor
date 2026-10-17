import { defineStore } from 'pinia'
import { ref } from 'vue'

/** Live UI state for the monitor screen. Not persisted. */
export const useMonitorStore = defineStore('monitor', () => {
  /** Camera whose audio is playing. At most one at a time, like a real baby monitor. */
  const audioCameraId = ref<string>()

  function toggleAudio(cameraId: string) {
    audioCameraId.value = audioCameraId.value === cameraId ? undefined : cameraId
  }

  function stopAudio() {
    audioCameraId.value = undefined
  }

  return { audioCameraId, toggleAudio, stopAudio }
})
