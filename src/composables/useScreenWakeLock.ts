import { onMounted, onScopeDispose } from 'vue'

/** Keeps a visible app awake where supported, without blocking browsers that deny it. */
export function useScreenWakeLock() {
  let active = false
  let requesting = false
  let sentinel: WakeLockSentinel | undefined

  function release() {
    const lock = sentinel
    sentinel = undefined
    if (lock && !lock.released) void lock.release().catch(() => {})
  }

  async function acquire() {
    if (
      !active ||
      !('wakeLock' in navigator) ||
      document.visibilityState !== 'visible' ||
      requesting ||
      sentinel
    ) {
      return
    }

    requesting = true
    try {
      const lock = await navigator.wakeLock.request('screen')
      // A request may finish after the app is hidden or its scope is disposed.
      if (!active || document.visibilityState !== 'visible') {
        await lock.release()
        return
      }
      sentinel = lock
      lock.addEventListener(
        'release',
        () => {
          if (sentinel === lock) sentinel = undefined
        },
        { once: true },
      )
    } catch {
      // Power saving, browser policy and insecure origins can deny the request.
      // Retry on the next interaction or return to the app, without a busy loop.
    } finally {
      requesting = false
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') void acquire()
    else release()
  }

  onMounted(() => {
    active = true
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', acquire)
    window.addEventListener('pointerdown', acquire)
    window.addEventListener('keydown', acquire)
    void acquire()
  })

  onScopeDispose(() => {
    active = false
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pageshow', acquire)
    window.removeEventListener('pointerdown', acquire)
    window.removeEventListener('keydown', acquire)
    release()
  })
}
