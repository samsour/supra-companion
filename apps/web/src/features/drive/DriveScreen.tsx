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
  snapToRoute,
  type Checkpoint,
  type ConvoyMemberInput,
  type LocationSample,
  type Trip,
  type TripMember,
  type TripTotals,
} from '@supra/core'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { isValidAccent } from '../../lib/accent'
import { getCheckpoints, getMembers, getTrip, insertSamples, loadProfile } from '../../lib/api'
import { statusLabel, stopIcon } from '../../lib/labels'
import { type CarPosition } from '../../map/ConvoyMap'

const ConvoyMap = lazy(() => import('../../map/ConvoyMap'))

// totals survive reloads/crashes mid-drive — a mounted phone will lose the
// tab at some point, and the km counter shouldn't reset when it does
const totalsKey = (tripId: string, userId: string) => `supra.totals.${tripId}.${userId}`

const fmtEta = (sec: number): string =>
  sec < 5400
    ? `${Math.max(1, Math.round(sec / 60))} min`
    : `${Math.floor(sec / 3600)} h ${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}`

function loadTotals(tripId: string, userId: string): TripTotals {
  try {
    const raw = localStorage.getItem(totalsKey(tripId, userId))
    if (raw) return JSON.parse(raw) as TripTotals
  } catch {
    /* private mode etc. */
  }
  return emptyTotals()
}

function saveTotals(tripId: string, userId: string, totals: TripTotals): void {
  try {
    localStorage.setItem(totalsKey(tripId, userId), JSON.stringify(totals))
  } catch {
    /* best effort */
  }
}
import { useGeolocation } from '../../location/useGeolocation'
import { useWakeLock } from '../../location/useWakeLock'
import { useConvoyChannel } from '../../realtime/useConvoyChannel'
import { useSession } from '../../session'

export default function DriveScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const { userId } = useSession()
  const navigate = useNavigate()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [members, setMembers] = useState<TripMember[]>([])
  const [, setTick] = useState(0)

  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [showOffline, setShowOffline] = useState(false)

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

  // fullscreen HUD: the page itself must never scroll while driving
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const wakeLockHeld = useWakeLock(true)
  const myAccent = useMemo(() => {
    const a = loadProfile().accent
    return isValidAccent(a) ? a : undefined
  }, [])
  const { peers, publish, connected, spectators } = useConvoyChannel(tripId ?? '', userId, myAccent)

  const totalsRef = useRef(tripId ? loadTotals(tripId, userId) : emptyTotals())
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
      saveTotals(tripId, userId, totalsRef.current)
    }, SAMPLE_FLUSH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [tripId, userId, trip?.status])

  // save totals when the tab hides/closes too
  useEffect(() => {
    if (!tripId) return
    const onHide = () => saveTotals(tripId, userId, totalsRef.current)
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [tripId, userId])

  // notice when the organizer ends the trip → everyone lands on results
  useEffect(() => {
    if (!tripId) return
    const id = setInterval(() => {
      void getTrip(tripId).then((t) => {
        setTrip(t)
        if (t.status === 'ended') navigate(`/trip/${tripId}/results`)
      }).catch(() => {})
    }, 15_000)
    return () => clearInterval(id)
  }, [tripId, navigate])

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
  const drivers = useMemo(() => members.filter((m) => m.role !== 'spectator'), [members])

  // checkpoints projected onto the route, for the "next checkpoint" readout
  const cpAlongs = useMemo(() => {
    if (!routeIndex) return []
    return checkpoints
      .map((cp) => ({ cp, fix: snapToRoute(routeIndex, { lat: cp.lat, lng: cp.lng }) }))
      .filter((x) => x.fix.offRouteM < 500)
      .sort((a, b) => a.fix.alongM - b.fix.alongM)
  }, [routeIndex, checkpoints])

  const nextCp = useMemo(() => {
    if (!me || me.offRoute) return null
    const ahead = cpAlongs.find((x) => x.fix.alongM > me.alongM + 50)
    return ahead ? { ...ahead.cp, distanceM: ahead.fix.alongM - me.alongM } : null
  }, [cpAlongs, me])

  // map + finish flag follow the route order (off-route stops appended)
  const sortedCheckpoints = useMemo(() => {
    if (!routeIndex) return checkpoints
    const onRoute = cpAlongs.map((x) => x.cp)
    return [...onRoute, ...checkpoints.filter((c) => !onRoute.some((o) => o.id === c.id))]
  }, [checkpoints, cpAlongs, routeIndex])
  const lastCpId = sortedCheckpoints[sortedCheckpoints.length - 1]?.id

  const cars = useMemo<CarPosition[]>(() => {
    const list: CarPosition[] = livePeers.map((p) => ({
      userId: p.userId,
      handle: handleOf(p.userId),
      lat: p.lat,
      lng: p.lng,
      heading: p.heading,
      accent: p.accent ?? null,
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
        accent: myAccent ?? null,
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
    <div className="drive-full">
      <Suspense fallback={<div className="map-placeholder" style={{ position: 'absolute', inset: 0 }}>Loading map…</div>}>
        <ConvoyMap cars={cars} route={trip?.routeGeojson ?? null} checkpoints={sortedCheckpoints} />
      </Suspense>

      <div className="hud">
        <div className="hud-top">
          <div className="eyebrow">{trip?.name ?? 'Drive Mode'}</div>
          <span style={{ display: 'flex', gap: 6 }}>
            {spectators > 0 && <span className="badge">👁 {spectators}</span>}
            <span className={trip?.status === 'live' ? 'badge badge-live' : 'badge'}>
              {connected ? (trip ? statusLabel[trip.status] : '…') : 'offline'}
            </span>
          </span>
        </div>

        <div className="hud-mid">
          <div className="hud-tiles">
            <div className="tile hero">
              <div className="label">Tempo</div>
              <div className="value">
                {speedKmh != null ? Math.round(speedKmh) : '—'}
                <small>km/h</small>
              </div>
            </div>
            <div className="tile">
              <div className="label">Strecke</div>
              <div className="value">
                {(totals.distanceM / 1000).toFixed(1)}
                <small>km</small>
              </div>
            </div>
            <div className="tile">
              <div className="label">Fahrzeit</div>
              <div className="value">
                {Math.floor(totals.movingSecs / 60)}
                <small>min</small>
              </div>
            </div>
          </div>

          {convoy && convoy.length > 0 && (
            <div className="leaderboard">
              <div className="row">
                <span className="label">Konvoi</span>
                {me?.position != null && (
                  <span className="lb-mypos">{me.position}/{drivers.length}</span>
                )}
              </div>
              {convoy.map((e) => (
                <div
                  className={`lb-row${e.userId === userId ? ' lb-you' : ''}${e.offRoute ? ' lb-off' : ''}`}
                  key={e.userId}
                >
                  <span className="lb-who">
                    {e.position ? <span className="pos-p">P{e.position}</span> : <span className="gap-off">⚑</span>}{' '}
                    {handleOf(e.userId)}
                  </span>
                  <span className="lb-gap">
                    {e.offRoute
                      ? 'abseits'
                      : e.position === 1
                        ? 'vorne'
                        : e.gapAheadSec != null
                          ? formatGap(e.gapAheadSec)
                          : '—'}
                  </span>
                </div>
              ))}
              {(() => {
                const offline = drivers.filter((m) => !convoy.some((e) => e.userId === m.userId))
                if (offline.length === 0) return null
                // wenige Offline direkt zeigen; viele zu einer Zeile einklappen
                if (offline.length <= 2 || showOffline) {
                  return (
                    <>
                      {offline.map((m) => (
                        <div className="lb-row lb-offline" key={m.userId}>
                          <span className="lb-who">– {m.handle}</span>
                          <span className="lb-gap">offline</span>
                        </div>
                      ))}
                      {offline.length > 2 && (
                        <button className="lb-row lb-offline lb-toggle" onClick={() => setShowOffline(false)}>
                          <span className="lb-who">einklappen</span>
                          <span className="lb-gap">▴</span>
                        </button>
                      )}
                    </>
                  )
                }
                return (
                  <button className="lb-row lb-offline lb-toggle" onClick={() => setShowOffline(true)}>
                    <span className="lb-who">– {offline.length} offline</span>
                    <span className="lb-gap">▾</span>
                  </button>
                )
              })()}
            </div>
          )}
        </div>

        <div className="hud-section hud-bottom">
          {geoError && (
            <div className="notice">
              {geoError === 'denied' ? (
                <>
                  <strong>Standortzugriff verweigert.</strong> iPhone: Einstellungen → Datenschutz &
                  Sicherheit → Ortungsdienste → <strong>Safari-Websites</strong> auf „Beim Verwenden“
                  (läuft die App vom Homescreen: dort deren eigenen Eintrag erlauben). Android:
                  Website-Einstellungen → Standort → Zulassen. Danach:{' '}
                  <button className="icon-btn" onClick={() => window.location.reload()}>Neu laden</button>
                </>
              ) : geoError === 'unavailable' ? (
                'Kein GPS-Signal — freie Sicht zum Himmel hilft, es wird automatisch weiterversucht.'
              ) : geoError === 'timeout' ? (
                'GPS antwortet gerade nicht — es wird automatisch weiterversucht.'
              ) : (
                'Dieser Browser unterstützt keinen Standortzugriff.'
              )}
            </div>
          )}
          {nextCp && (
            <div className="tile hud-next">
              <span className="label">Nächster Stopp</span>
              <strong className="display">
                {stopIcon(nextCp.kind, nextCp.id === lastCpId)} {nextCp.name}
              </strong>
              <span className="display" style={{ color: 'var(--cyan)' }}>
                {(nextCp.distanceM / 1000).toFixed(nextCp.distanceM < 10_000 ? 1 : 0)} km
              </span>
              {latest?.speedMps != null && latest.speedMps >= STATIONARY_SPEED_MPS && (
                <span className="display" style={{ color: 'var(--muted)', fontSize: 16 }}>
                  ~{fmtEta(nextCp.distanceM / latest.speedMps)}
                </span>
              )}
            </div>
          )}
          <div className="hud-links">
            <Link to={`/trip/${tripId}`}>← Lobby</Link>
            {!routeIndex && <span className="hint">keine Route geplant</span>}
            {!wakeLockHeld && <span className="hint">Display während der Fahrt anlassen</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
