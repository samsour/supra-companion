import {
  PING_INTERVAL_MOVING_MS,
  PING_INTERVAL_STATIONARY_MS,
  SAMPLE_FLUSH_INTERVAL_MS,
  STALE_AFTER_MS,
  STATIONARY_SPEED_MPS,
  addSample,
  buildRouteIndex,
  computeConvoy,
  emptyTotals,
  formatGap,
  kmh,
  type Checkpoint,
  type ConvoyMemberInput,
  type LocationSample,
  type Trip,
  type TripMember,
} from '@supra/core'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCheckpoints, getMembers, getTrip, insertSamples } from '../../lib/api'
import { type CarPosition } from '../../map/ConvoyMap'

const ConvoyMap = lazy(() => import('../../map/ConvoyMap'))
import { useGeolocation } from '../../location/useGeolocation'
import { useWakeLock } from '../../location/useWakeLock'
import { useConvoyChannel } from '../../realtime/useConvoyChannel'
import { useSession } from '../../session'

export default function DriveScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const { userId } = useSession()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [members, setMembers] = useState<TripMember[]>([])
  const [, setTick] = useState(0)

  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])

  useEffect(() => {
    if (!tripId) return
    void getTrip(tripId).then(setTrip)
    void getMembers(tripId).then(setMembers)
    void getCheckpoints(tripId).then(setCheckpoints)
  }, [tripId])

  // re-render every second so gaps/staleness stay current between pings
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000)
    return () => clearInterval(id)
  }, [])

  const wakeLockHeld = useWakeLock(true)
  const { peers, publish, connected } = useConvoyChannel(tripId ?? '', userId)

  const totalsRef = useRef(emptyTotals())
  const pendingRef = useRef<LocationSample[]>([])
  const latestRef = useRef<LocationSample | null>(null)
  const lastPingAtRef = useRef(0)

  const onSample = useCallback((s: LocationSample) => {
    totalsRef.current = addSample(totalsRef.current, s)
    pendingRef.current.push(s)
    latestRef.current = s
  }, [])

  const { latest, error: geoError } = useGeolocation(onSample)

  // heartbeat publisher: steady pings even when the GPS reports no movement,
  // adaptive interval based on whether we're moving
  useEffect(() => {
    const id = setInterval(() => {
      const s = latestRef.current
      if (!s) return
      const moving = (s.speedMps ?? 0) >= STATIONARY_SPEED_MPS
      const interval = moving ? PING_INTERVAL_MOVING_MS : PING_INTERVAL_STATIONARY_MS
      if (Date.now() - lastPingAtRef.current >= interval) {
        lastPingAtRef.current = Date.now()
        publish(s)
      }
    }, 1_000)
    return () => clearInterval(id)
  }, [publish])

  // persist buffered samples for stats (only while the trip is live)
  useEffect(() => {
    if (!tripId || trip?.status !== 'live') return
    const id = setInterval(() => {
      const batch = pendingRef.current.splice(0)
      if (batch.length > 0) void insertSamples(tripId, userId, batch).catch(() => {
        pendingRef.current.unshift(...batch) // offline: retry on the next flush
      })
    }, SAMPLE_FLUSH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [tripId, userId, trip?.status])

  const routeIndex = useMemo(
    () => (trip?.routeGeojson ? buildRouteIndex(trip.routeGeojson) : null),
    [trip?.routeGeojson],
  )

  const now = Date.now()
  const livePeers = Object.values(peers).filter((p) => now - p.ts < STALE_AFTER_MS * 3)

  const convoy = useMemo(() => {
    if (!routeIndex) return null
    const inputs: ConvoyMemberInput[] = livePeers.map((p) => ({
      userId: p.userId,
      point: { lat: p.lat, lng: p.lng },
      speedMps: p.speedMps,
    }))
    if (latest) inputs.push({ userId, point: { lat: latest.lat, lng: latest.lng }, speedMps: latest.speedMps })
    return computeConvoy(routeIndex, inputs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeIndex, peers, latest, userId])

  const me = convoy?.find((e) => e.userId === userId)
  const handleOf = (id: string) => members.find((m) => m.userId === id)?.handle ?? id.slice(0, 6)

  const cars = useMemo<CarPosition[]>(() => {
    const list: CarPosition[] = livePeers.map((p) => ({
      userId: p.userId,
      handle: handleOf(p.userId),
      lat: p.lat,
      lng: p.lng,
      heading: p.heading,
      isSelf: false,
      stale: now - p.ts > STALE_AFTER_MS,
    }))
    if (latest) {
      list.push({
        userId,
        handle: handleOf(userId),
        lat: latest.lat,
        lng: latest.lng,
        heading: latest.heading,
        isSelf: true,
        stale: false,
      })
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers, latest, members, now, userId])
  const totals = totalsRef.current
  const speedKmh = latest?.speedMps != null ? kmh(latest.speedMps) : null

  if (!tripId) return null

  return (
    <div className="screen">
      <header className="row">
        <div>
          <div className="eyebrow">{trip?.name ?? 'Drive mode'}</div>
          <h1 className="display" style={{ fontSize: 26 }}>
            {me?.position ? <span className="pos-p">P{me.position}</span> : me?.offRoute ? <span className="gap-off">Off route</span> : 'Convoy'}
            {me?.gapAheadSec != null && <span style={{ color: 'var(--muted)', marginLeft: 10 }}>{formatGap(me.gapAheadSec)} ahead</span>}
          </h1>
        </div>
        <span className={trip?.status === 'live' ? 'badge badge-live' : 'badge'}>
          {connected ? (trip?.status ?? '…') : 'offline'}
        </span>
      </header>

      <div className="stat-grid">
        <div className="stat hero">
          <div className="label">Speed</div>
          <div className="value">
            {speedKmh != null ? Math.round(speedKmh) : '—'}
            <small>km/h</small>
          </div>
        </div>
        <div className="stat">
          <div className="label">Trip distance</div>
          <div className="value">
            {(totals.distanceM / 1000).toFixed(1)}
            <small>km</small>
          </div>
        </div>
        <div className="stat">
          <div className="label">Moving time</div>
          <div className="value">
            {Math.floor(totals.movingSecs / 60)}
            <small>min</small>
          </div>
        </div>
        <div className="stat">
          <div className="label">Cars live</div>
          <div className="value">
            {livePeers.length + (latest ? 1 : 0)}
            <small>/ {Math.max(members.length, livePeers.length + 1)}</small>
          </div>
        </div>
      </div>

      {convoy && convoy.length > 1 && (
        <div className="card">
          <div className="label">Convoy</div>
          <div>
            {convoy.map((e) => (
              <div className="member" key={e.userId}>
                <strong>
                  {e.position ? <span className="pos-p">P{e.position} </span> : <span className="gap-off">⚑ </span>}
                  {handleOf(e.userId)}
                  {e.userId === userId ? ' (you)' : ''}
                </strong>
                <span className="car">
                  {e.offRoute
                    ? `off route · ${(e.offRouteM / 1000).toFixed(1)} km out`
                    : e.gapAheadSec != null
                      ? `${formatGap(e.gapAheadSec)} to ${handleOf(convoy.find((x) => x.position === (e.position ?? 0) - 1)?.userId ?? '')}`
                      : 'leader'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Suspense fallback={<div className="map-placeholder">Loading map…</div>}>
        <ConvoyMap cars={cars} route={trip?.routeGeojson ?? null} checkpoints={checkpoints} />
      </Suspense>

      {geoError && <div className="notice">GPS: {geoError}. Allow location access for this site.</div>}
      {!wakeLockHeld && (
        <div className="hint">
          Screen may sleep — keep the app visible while driving so your position keeps broadcasting.
        </div>
      )}
      {!routeIndex && <div className="hint">No route on this trip yet — positions and gaps unlock once the organizer adds one (Day 3).</div>}

      <p className="hint">
        <Link to={`/trip/${tripId}`} style={{ color: 'var(--cyan)' }}>← Back to lobby</Link>
      </p>
    </div>
  )
}
