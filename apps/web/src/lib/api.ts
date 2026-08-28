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
