import type {
  Checkpoint,
  CheckpointKind,
  LocationSample,
  MemberRole,
  RouteGeometry,
  Trip,
  TripMember,
  TripStatus,
} from '@supra/core'
import { supabase } from './supabase'

interface TripRow {
  id: string
  name: string
  status: TripStatus
  organizer_id: string
  route_geojson: RouteGeometry | null
  route_waypoints: [number, number][] | null
  starts_at: string | null
  invite_code: string
}

interface MemberRow {
  trip_id: string
  user_id: string
  handle: string
  car_model: string | null
  car_color: string | null
  role: MemberRole
  share_location: boolean
}

const toTrip = (r: TripRow): Trip => ({
  id: r.id,
  name: r.name,
  status: r.status,
  organizerId: r.organizer_id,
  routeGeojson: r.route_geojson,
  routeWaypoints: r.route_waypoints,
  startsAt: r.starts_at,
  inviteCode: r.invite_code,
})

const toMember = (r: MemberRow): TripMember => ({
  tripId: r.trip_id,
  userId: r.user_id,
  handle: r.handle,
  carModel: r.car_model,
  carColor: r.car_color,
  role: r.role,
  shareLocation: r.share_location,
})

export interface ProfileInput {
  handle: string
  carModel: string
  carColor: string
  /** gewählte Neon-Akzentfarbe (hex), themed App + eigenen Pfeil */
  accent?: string
}

export async function createTrip(name: string, p: ProfileInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_trip', {
    p_name: name,
    p_handle: p.handle,
    p_car_model: p.carModel || null,
    p_car_color: p.carColor || null,
  })
  if (error) throw error
  return data as string
}

export async function joinTrip(code: string, p: ProfileInput): Promise<string> {
  const { data, error } = await supabase.rpc('join_trip', {
    p_code: code,
    p_handle: p.handle,
    p_car_model: p.carModel || null,
    p_car_color: p.carColor || null,
  })
  if (error) throw error
  return data as string
}

export async function getTrip(tripId: string): Promise<Trip> {
  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).single()
  if (error) throw error
  return toTrip(data as TripRow)
}

export async function getMembers(tripId: string): Promise<TripMember[]> {
  const { data, error } = await supabase
    .from('trip_members')
    .select('*')
    .eq('trip_id', tripId)
    .order('joined_at')
  if (error) throw error
  return (data as MemberRow[]).map(toMember)
}

interface CheckpointRow {
  id: string
  trip_id: string
  name: string
  kind: CheckpointKind
  lat: number
  lng: number
  order_idx: number
}

export async function getCheckpoints(tripId: string): Promise<Checkpoint[]> {
  const { data, error } = await supabase
    .from('checkpoints')
    .select('*')
    .eq('trip_id', tripId)
    .order('order_idx')
  if (error) throw error
  return (data as CheckpointRow[]).map((r) => ({
    id: r.id,
    tripId: r.trip_id,
    name: r.name,
    kind: r.kind,
    lat: r.lat,
    lng: r.lng,
    orderIdx: r.order_idx,
  }))
}

export async function updateTripRoute(
  tripId: string,
  route: RouteGeometry | null,
  waypoints: [number, number][] | null,
): Promise<void> {
  const { error } = await supabase
    .from('trips')
    .update({ route_geojson: route, route_waypoints: waypoints })
    .eq('id', tripId)
  if (error) throw error
}

export async function addCheckpoint(
  tripId: string,
  cp: { name: string; kind: CheckpointKind; lat: number; lng: number; orderIdx: number },
): Promise<void> {
  const { error } = await supabase.from('checkpoints').insert({
    trip_id: tripId,
    name: cp.name,
    kind: cp.kind,
    lat: cp.lat,
    lng: cp.lng,
    order_idx: cp.orderIdx,
  })
  if (error) throw error
}

export async function deleteCheckpoint(checkpointId: string): Promise<void> {
  const { error } = await supabase.from('checkpoints').delete().eq('id', checkpointId)
  if (error) throw error
}

/** Rewrite order_idx to match the given id order (organizer only, via RLS). */
export async function setCheckpointOrder(ordered: Checkpoint[]): Promise<void> {
  await Promise.all(
    ordered.map(async (cp, i) => {
      if (cp.orderIdx === i) return
      const { error } = await supabase.from('checkpoints').update({ order_idx: i }).eq('id', cp.id)
      if (error) throw error
    }),
  )
}

/** Copy route + checkpoints into a new trip; the caller becomes its organizer. */
export async function duplicateTrip(tripId: string, p: ProfileInput): Promise<string> {
  const { data, error } = await supabase.rpc('duplicate_trip', {
    p_trip: tripId,
    p_handle: p.handle,
    p_car_model: p.carModel || null,
    p_car_color: p.carColor || null,
  })
  if (error) throw error
  return data as string
}

/** Mapbox Directions along the picked waypoints (driving profile). */
export async function fetchDirections(
  waypoints: [number, number][],
): Promise<{ geometry: RouteGeometry; distanceM: number }> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
  if (!token) throw new Error('VITE_MAPBOX_TOKEN missing')
  const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${token}`
  const res = await fetch(url)
  const body = (await res.json()) as {
    code?: string
    message?: string
    routes?: { geometry: RouteGeometry; distance: number }[]
  }
  if (!res.ok || body.code !== 'Ok' || !body.routes?.[0]) {
    throw new Error(body.message ?? `Directions failed (${body.code ?? res.status})`)
  }
  return { geometry: body.routes[0].geometry, distanceM: body.routes[0].distance }
}

export interface PlaceHit {
  name: string
  lng: number
  lat: number
}

/** Mapbox geocoding — used to recenter the route editor map. */
export async function searchPlaces(query: string): Promise<PlaceHit[]> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
  if (!token) throw new Error('VITE_MAPBOX_TOKEN fehlt')
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&limit=5&language=de`
  const res = await fetch(url)
  const body = (await res.json()) as {
    features?: { place_name: string; center: [number, number] }[]
    message?: string
  }
  if (!res.ok) throw new Error(body.message ?? `Suche fehlgeschlagen (${res.status})`)
  return (body.features ?? []).map((f) => ({ name: f.place_name, lng: f.center[0], lat: f.center[1] }))
}

/** Organizer only (RLS); cascades members, checkpoints, samples, stats. */
export async function deleteTrip(tripId: string): Promise<void> {
  const { error } = await supabase.from('trips').delete().eq('id', tripId)
  if (error) throw error
}

export async function renameTrip(tripId: string, name: string): Promise<void> {
  const { error } = await supabase.from('trips').update({ name }).eq('id', tripId)
  if (error) throw error
}

export async function setTripStatus(tripId: string, status: TripStatus): Promise<void> {
  const { error } = await supabase.from('trips').update({ status }).eq('id', tripId)
  if (error) throw error
}

export async function finishTrip(tripId: string): Promise<void> {
  const { error } = await supabase.rpc('finish_trip', { p_trip: tripId })
  if (error) throw error
}

export interface TripStatsRow {
  userId: string
  distanceKm: number
  movingSecs: number
  avgSpeedKmh: number | null
  topSpeedKmh: number | null
}

export async function getTripStats(tripId: string): Promise<TripStatsRow[]> {
  const { data, error } = await supabase.from('trip_stats').select('*').eq('trip_id', tripId)
  if (error) throw error
  return (data as {
    user_id: string
    distance_km: number
    moving_secs: number
    avg_speed_kmh: number | null
    top_speed_kmh: number | null
  }[]).map((r) => ({
    userId: r.user_id,
    distanceKm: Number(r.distance_km),
    movingSecs: r.moving_secs,
    avgSpeedKmh: r.avg_speed_kmh != null ? Number(r.avg_speed_kmh) : null,
    topSpeedKmh: r.top_speed_kmh != null ? Number(r.top_speed_kmh) : null,
  }))
}

export async function insertSamples(
  tripId: string,
  userId: string,
  samples: LocationSample[],
): Promise<void> {
  const rows = samples.map((s) => ({
    trip_id: tripId,
    user_id: userId,
    lat: s.lat,
    lng: s.lng,
    speed: s.speedMps,
    heading: s.heading,
    accuracy: s.accuracyM,
    ts: new Date(s.ts).toISOString(),
  }))
  const { error } = await supabase.from('location_samples').insert(rows)
  if (error) throw error
}

// -------- local profile convenience (per-device, not authoritative) --------

const PROFILE_KEY = 'supra.profile'

export function loadProfile(): ProfileInput {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return JSON.parse(raw) as ProfileInput
  } catch {
    /* private mode etc. — fall through */
  }
  return { handle: '', carModel: '', carColor: '' }
}

export function saveProfile(p: ProfileInput): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
  } catch {
    /* best effort */
  }
}
