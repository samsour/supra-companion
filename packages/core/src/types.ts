export type TripStatus = 'draft' | 'live' | 'ended'
export type MemberRole = 'organizer' | 'driver' | 'passenger'
export type CheckpointKind = 'fuel' | 'food' | 'photo' | 'meet'

export interface LatLng {
  lat: number
  lng: number
}

/** GeoJSON LineString, coordinates as [lng, lat] (GeoJSON order). */
export interface RouteGeometry {
  type: 'LineString'
  coordinates: [number, number][]
}

export interface Trip {
  id: string
  name: string
  status: TripStatus
  organizerId: string
  routeGeojson: RouteGeometry | null
  /** the organizer's picked waypoints, [lng, lat] — kept so the route stays editable */
  routeWaypoints: [number, number][] | null
  startsAt: string | null
  inviteCode: string
}

export interface TripMember {
  tripId: string
  userId: string
  handle: string
  carModel: string | null
  carColor: string | null
  role: MemberRole
  shareLocation: boolean
}

export interface Checkpoint {
  id: string
  tripId: string
  name: string
  kind: CheckpointKind
  lat: number
  lng: number
  orderIdx: number
}

/** One GPS fix. `ts` is epoch milliseconds. */
export interface LocationSample {
  lat: number
  lng: number
  speedMps: number | null
  heading: number | null
  accuracyM: number | null
  ts: number
}
