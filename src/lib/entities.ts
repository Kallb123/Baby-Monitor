import type { EntityState } from '@shared/api.ts'

const UNAVAILABLE = new Set(['unavailable', 'unknown', ''])

export function isAvailable(state: EntityState | undefined): state is EntityState {
  return state !== undefined && !UNAVAILABLE.has(state.state)
}

/** Cry entities are expected to be HA binary sensors: "on" means crying. */
export function isCrying(state: EntityState | undefined): boolean {
  return isAvailable(state) && state.state === 'on'
}

export function formatMeasurement(state: EntityState | undefined, digits = 1): string | undefined {
  if (!isAvailable(state)) return undefined
  const value = Number(state.state)
  if (!Number.isFinite(value)) return undefined
  return `${value.toFixed(digits)}${state.unit ?? ''}`
}
