import { onScopeDispose, readonly, ref } from 'vue'

// iPadOS Safari before 16.4 only has the WebKit-prefixed API.
type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => void
}
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void }

/**
 * Toggles page fullscreen where the browser allows it. `supported` is false on iPhone Safari,
 * which has no element fullscreen, so callers can hide the control instead of showing a dead one.
 */
export function useFullscreen() {
  const doc: WebkitDocument = document
  const supported = Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)

  const current = () => Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement)
  const active = ref(current())

  function sync() {
    active.value = current()
  }

  if (supported) {
    doc.addEventListener('fullscreenchange', sync)
    doc.addEventListener('webkitfullscreenchange', sync)
  }

  onScopeDispose(() => {
    doc.removeEventListener('fullscreenchange', sync)
    doc.removeEventListener('webkitfullscreenchange', sync)
  })

  /** Must run inside the click handler: browsers reject fullscreen without a user gesture. */
  function toggle() {
    if (!supported) return
    const root: WebkitElement = doc.documentElement
    const result = current()
      ? doc.exitFullscreen
        ? doc.exitFullscreen()
        : doc.webkitExitFullscreen?.()
      : root.requestFullscreen
        ? root.requestFullscreen()
        : root.webkitRequestFullscreen?.()
    // The standard methods reject on policy or gesture failures; the prefixed ones return void.
    void Promise.resolve(result).catch(() => {})
  }

  return { supported, isFullscreen: readonly(active), toggle }
}
