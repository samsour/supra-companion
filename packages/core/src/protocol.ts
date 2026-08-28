import type { LocationSample } from './types'

/** Realtime broadcast topic for a trip. Must match the RLS policy on realtime.messages. */
export const tripChannel = (tripId: string) => `trip:${tripId}`

export const EVENT_POSITION = 'pos'

export interface PositionPing extends LocationSample {
  userId: string
}

export const PING_INTERVAL_MOVING_MS = 4_000
export const PING_INTERVAL_STATIONARY_MS = 30_000
/** Below this we consider the car stationary (GPS drift territory). */
export const STATIONARY_SPEED_MPS = 1.5
/** How often buffered samples are flushed to location_samples. */
export const SAMPLE_FLUSH_INTERVAL_MS = 30_000
/** A member with no ping for this long renders as "last seen". */
export const STALE_AFTER_MS = 20_000
