export type AppUpdateStatus =
  | 'registering'
  | 'unsupported'
  | 'insecure'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'updating'
  | 'reload-needed'
  | 'error'

/** How often an open app asks the server whether a new version exists. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60_000

/** Opening Settings repeatedly shouldn't hit the server each time. */
export const UPDATE_CHECK_THROTTLE_MS = 60_000

/** How long to wait for the new worker to take over before reloading by hand. */
export const UPDATE_RELOAD_FALLBACK_MS = 10_000

/** A stalled precache download must not leave a check running forever. */
export const UPDATE_INSTALL_TIMEOUT_MS = 60_000

export const appUpdateMessages: Record<AppUpdateStatus, string> = {
  registering: 'Starting…',
  unsupported: "Updates aren't available in this browser.",
  insecure: 'Updates need HTTPS. Open the app over a secure connection.',
  idle: 'Not checked yet.',
  checking: 'Checking for updates…',
  'up-to-date': 'Up to date',
  available: 'A new version is ready. Updating reloads this screen, so streams reconnect.',
  updating: 'Updating…',
  'reload-needed':
    'Updated in another window. Reloading uses the new version, so streams reconnect.',
  error: "Couldn't check for updates. Check the connection and try again.",
}

/** True when no check has run yet, or the last one is older than the throttle. */
export function shouldCheckNow(
  lastCheckedAt: number | undefined,
  now: number,
  throttleMs = UPDATE_CHECK_THROTTLE_MS,
): boolean {
  return lastCheckedAt === undefined || now - lastCheckedAt >= throttleMs
}
