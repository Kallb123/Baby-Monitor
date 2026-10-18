import type { z } from 'zod'

/**
 * Reads a per-device value from localStorage. Returns undefined when it is
 * missing, corrupt or no longer matches the schema, so callers fall back to
 * their defaults instead of failing to start.
 */
export function readStored<T>(key: string, schema: z.ZodType<T>): T | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const parsed = schema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or blocked storage: the choice just won't survive a reload.
  }
}
