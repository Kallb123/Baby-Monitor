import { registerSW } from 'virtual:pwa-register'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  appUpdateMessages,
  shouldCheckNow,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_INSTALL_TIMEOUT_MS,
  UPDATE_RELOAD_FALLBACK_MS,
  type AppUpdateStatus,
} from '@/lib/app-update'

/**
 * Registers the service worker and exposes its update state to Settings. The
 * worker is configured to wait for every window to close, so a live monitor
 * is only ever reloaded when the user asks for it here.
 */
export const useAppUpdateStore = defineStore('app-update', () => {
  const status = ref<AppUpdateStatus>('idle')
  const message = computed(() => appUpdateMessages[status.value])

  let started = false
  let registration: ServiceWorkerRegistration | undefined
  let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined
  let lastCheckedAt: number | undefined
  let checking = false
  // True when a worker already controlled or was installed for this page, so a
  // later controller swap is an update. A hard reload has no controller but
  // still has an active worker.
  let hadWorker = false
  let pendingCheck = false
  let intervalId: ReturnType<typeof setInterval> | undefined
  let reloadTimer: ReturnType<typeof setTimeout> | undefined

  const isSettled = () => status.value === 'updating' || status.value === 'reload-needed'

  function onControllerChange() {
    // Our own update also swaps the controller, and then the page reloads itself.
    if (isSettled()) return
    // The first controller on a fresh install isn't a new version. Never reload
    // here: only a tap in this window may.
    if (!hadWorker) {
      hadWorker = true
      return
    }
    status.value = 'reload-needed'
  }

  function onNeedReload() {
    // The library reloads on its own when the worker is swapped, even if the
    // update was started in another window; only this window's own tap may.
    if (status.value === 'updating') {
      clearTimeout(reloadTimer)
      location.reload()
    } else {
      status.value = 'reload-needed'
    }
  }

  function waitForInstall(worker: ServiceWorker): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        worker.removeEventListener('statechange', onChange)
        resolve()
      }
      const onChange = () => {
        if (worker.state === 'installed' || worker.state === 'redundant') done()
      }
      const timer = setTimeout(done, UPDATE_INSTALL_TIMEOUT_MS)
      worker.addEventListener('statechange', onChange)
      onChange()
    })
  }

  async function checkForUpdates() {
    if (checking || !registration || isSettled()) return
    checking = true
    status.value = 'checking'
    lastCheckedAt = Date.now()
    let outcome: AppUpdateStatus = 'up-to-date'
    try {
      await registration.update()
      if (registration.installing) await waitForInstall(registration.installing)
      if (registration.installing?.state === 'installing') outcome = 'error'
    } catch {
      outcome = 'error'
    } finally {
      checking = false
    }
    // Another window's update may have settled this one while we waited.
    if (isSettled()) return
    status.value = registration.waiting ? 'available' : outcome
  }

  /** Called when Settings opens; skips the request if one ran a moment ago. */
  function checkIfStale() {
    if (!registration) {
      // Registration is still arriving (app opened straight on /settings).
      if (status.value === 'registering') pendingCheck = true
      return
    }
    if (shouldCheckNow(lastCheckedAt, Date.now())) void checkForUpdates()
  }

  async function applyUpdate() {
    if (!updateSW || status.value === 'updating') return
    if (!registration?.waiting) {
      // The update may have been applied elsewhere; find out instead of
      // claiming to update.
      await checkForUpdates()
      return
    }
    status.value = 'updating'
    // updateSW reloads once the new worker takes control; if that never
    // happens (no waiting worker left), reload so the button isn't a dead end.
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => location.reload(), UPDATE_RELOAD_FALLBACK_MS)
    try {
      await updateSW(true)
    } catch {
      clearTimeout(reloadTimer)
      status.value = 'error'
    }
  }

  function reload() {
    location.reload()
  }

  function start() {
    if (started) return
    started = true
    // The dev server never registers a worker, and registerSW would never call
    // back, so don't wait for it.
    if (import.meta.env.DEV) {
      status.value = 'unsupported'
      return
    }
    if (!('serviceWorker' in navigator)) {
      status.value = window.isSecureContext ? 'unsupported' : 'insecure'
      return
    }
    status.value = 'registering'
    hadWorker = navigator.serviceWorker.controller !== null
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    updateSW = registerSW({
      immediate: true,
      onNeedReload,
      onNeedRefresh() {
        if (!isSettled()) status.value = 'available'
      },
      onRegisteredSW(_url, reg) {
        if (!reg) {
          if (status.value === 'registering') status.value = 'unsupported'
          return
        }
        registration = reg
        if (reg.active) hadWorker = true
        if (status.value === 'registering') status.value = 'idle'
        intervalId ??= setInterval(() => {
          // Don't replace a ready update, or interrupt one in progress.
          if (status.value === 'available' || isSettled()) return
          if (navigator.onLine !== false) void checkForUpdates()
        }, UPDATE_CHECK_INTERVAL_MS)
        if (pendingCheck) {
          pendingCheck = false
          checkIfStale()
        }
      },
      onRegisterError(error) {
        console.warn('Service worker registration failed:', error)
        pendingCheck = false
        if (status.value === 'registering' || status.value === 'idle') {
          status.value = 'unsupported'
        }
      },
    })
  }

  /** Releases the timers and listener; the app itself never calls this. */
  function stop() {
    clearInterval(intervalId)
    clearTimeout(reloadTimer)
    intervalId = undefined
    reloadTimer = undefined
    pendingCheck = false
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }

  return { status, message, start, stop, checkForUpdates, checkIfStale, applyUpdate, reload }
})
