/**
 * Cameras the monitor screen lets you add. The layouts are designed for up to
 * four; the config schema allows more, and extra cameras still display.
 */
export const MAX_CAMERAS = 4

const MAX_ID_LENGTH = 64

/**
 * Derives a camera id (also the go2rtc stream name) from its display name,
 * unique among `taken`. Matches the id pattern in `shared/config.ts`.
 */
export function cameraIdFromName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base =
    name
      .normalize('NFKD')
      // Drop the accents NFKD split off, so "Crèche" becomes "creche".
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_ID_LENGTH)
      .replace(/-+$/, '') || 'camera'
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, MAX_ID_LENGTH - suffix.length)}${suffix}`
    if (!used.has(candidate)) return candidate
  }
}
