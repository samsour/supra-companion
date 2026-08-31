import type { TripStatus } from '@supra/core'

/** Recently visited trips, per device — lets people jump back in without the invite code. */
export interface RecentTrip {
  id: string
  name: string
  status: TripStatus
  savedAt: number
}

const KEY = 'supra.recent-trips'
const MAX = 5

export function loadRecentTrips(): RecentTrip[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as RecentTrip[]
  } catch {
    /* private mode etc. */
  }
  return []
}

export function rememberTrip(trip: { id: string; name: string; status: TripStatus }): void {
  try {
    const list = loadRecentTrips().filter((t) => t.id !== trip.id)
    list.unshift({ id: trip.id, name: trip.name, status: trip.status, savedAt: Date.now() })
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    /* best effort */
  }
}
