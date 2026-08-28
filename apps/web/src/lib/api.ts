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

export async function setTripStatus(tripId: string, status: TripStatus): Promise<void> {
  const { error } = await supabase.from('trips').update({ status }).eq('id', tripId)
  if (error) throw error
}

export async function finishTrip(tripId: string): Promise<void> {
  const { error } = await supabase.rpc('finish_trip', { p_trip: tripId })
  if (error) throw error
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
