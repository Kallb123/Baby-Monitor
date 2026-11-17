import { registerSW } from 'virtual:pwa-register'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  appUpdateMessages,
  shouldCheckNow,
  UPDATE_CHECK_INTERVAL_MS,
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
  let hadController = false
  let intervalId: ReturnType<typeof setInterval> | undefined
  let reloadTimer: ReturnType<typeof setTimeout> | undefined

  function onControllerChange() {
    // Our own update also swaps the controller, and then the page reloads itself.
    if (status.value === 'updating') return
    // The first controller on a fresh install isn't a new version.
    if (!hadController) {
      hadController = true
      return
    }
    status.value = 'reload-needed'
  }

  function waitForInstall(worker: ServiceWorker): Promise<void> {
    return new Promise((resolve) => {
      const onChange = () => {
        if (worker.state === 'installed' || worker.state === 'redundant') {
          worker.removeEventListener('statechange', onChange)
          resolve()
        }
      }
      worker.addEventListener('statechange', onChange)
      onChange()
    })
  }

  async function checkForUpdates() {
    if (checking || !registration) return
    if (status.value === 'updating' || status.value === 'reload-needed') return
    checking = true
    status.value = 'checking'
    lastCheckedAt = Date.now()
    try {
      await registration.update()
      if (registration.installing) await waitForInstall(registration.installing)
      status.value = registration.waiting ? 'available' : 'up-to-date'
    } catch {
      status.value = 'error'
    } finally {
      checking = false
    }
  }

  /** Called when Settings opens; skips the request if one ran a moment ago. */
  function checkIfStale() {
    if (shouldCheckNow(lastCheckedAt, Date.now())) void checkForUpdates()
  }

  async function applyUpdate() {
    if (!updateSW || status.value === 'updating') return
    status.value = 'updating'
    // updateSW reloads once the new worker takes control; if that never
    // happens (no waiting worker left), reload so the button isn't a dead end.
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
    if (!('serviceWorker' in navigator)) {
      status.value = 'unsupported'
      return
    }
    // The dev server never registers a worker, so without a registration the
    // status stays 'unsupported' and Settings explains it.
    status.value = 'unsupported'
    hadController = navigator.serviceWorker.controller !== null
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        if (status.value !== 'updating' && status.value !== 'reload-needed') {
          status.value = 'available'
        }
      },
      onRegisteredSW(_url, reg) {
        if (!reg) return
        registration = reg
        if (status.value === 'unsupported') status.value = 'idle'
        intervalId ??= setInterval(() => {
          if (navigator.onLine !== false) void checkForUpdates()
        }, UPDATE_CHECK_INTERVAL_MS)
      },
      onRegisterError(error) {
        console.warn('Service worker registration failed:', error)
        status.value = 'unsupported'
      },
    })
  }

  /** Releases the timers and listener; the app itself never calls this. */
  function stop() {
    clearInterval(intervalId)
    clearTimeout(reloadTimer)
    intervalId = undefined
    reloadTimer = undefined
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }

  return { status, message, start, stop, checkForUpdates, checkIfStale, applyUpdate, reload }
})
