import { haversineMeters } from './geo'
import { STATIONARY_SPEED_MPS } from './protocol'
import type { LocationSample } from './types'

/** Samples with worse GPS accuracy than this are discarded. */
export const MAX_ACCURACY_M = 30
/** Implied speeds above this are treated as GPS teleports and discarded. */
export const MAX_SPEED_MPS = 250 / 3.6
/** Gaps longer than this (tunnel, app hidden) don't count as moving time. */
export const MAX_MOVING_GAP_SECS = 120

export interface TripTotals {
  distanceM: number
  movingSecs: number
  maxSpeedMps: number
  lastSample: LocationSample | null
}

export const emptyTotals = (): TripTotals => ({
  distanceM: 0,
  movingSecs: 0,
  maxSpeedMps: 0,
  lastSample: null,
})

/**
 * Fold one GPS sample into the running totals. Pure — returns a new object.
 * Filters kill the two classic km-inflation bugs: bad-accuracy fixes and
 * teleport jumps; stationary drift never accumulates distance because
 * distance only counts while implied speed clears the stationary threshold.
 */
export function addSample(totals: TripTotals, s: LocationSample): TripTotals {
  if (s.accuracyM !== null && s.accuracyM > MAX_ACCURACY_M) return totals

  const last = totals.lastSample
  if (last === null) return { ...totals, lastSample: s }

  const dtSecs = (s.ts - last.ts) / 1000
  if (dtSecs <= 0) return totals

  const dM = haversineMeters(last, s)
  const impliedMps = dM / dtSecs
  // Teleport: drop the sample but keep the anchor — if the jump was real
  // (tunnel), implied speed decays as dt grows and a later sample is accepted.
  if (impliedMps > MAX_SPEED_MPS) return totals

  const moving = impliedMps >= STATIONARY_SPEED_MPS
  const reportedSpeed = s.speedMps ?? 0
  return {
    distanceM: totals.distanceM + (moving ? dM : 0),
    movingSecs: totals.movingSecs + (moving ? Math.min(dtSecs, MAX_MOVING_GAP_SECS) : 0),
    maxSpeedMps: Math.max(totals.maxSpeedMps, moving ? impliedMps : 0, reportedSpeed),
    lastSample: s,
  }
}

export const kmh = (mps: number) => mps * 3.6

export function formatGap(seconds: number): string {
  const s = Math.round(seconds)
  const m = Math.floor(s / 60)
  return `+${m}:${String(s % 60).padStart(2, '0')}`
}
