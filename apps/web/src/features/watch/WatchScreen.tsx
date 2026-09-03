import {
  STALE_AFTER_MS,
  buildRouteIndex,
  computeConvoy,
  formatGap,
  snapToRoute,
  type Checkpoint,
  type Trip,
  type TripMember,
} from '@supra/core'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getCheckpoints, getMembers, getTrip, joinAsSpectator } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { statusLabel, stopIcon } from '../../lib/labels'
import { type CarPosition } from '../../map/ConvoyMap'
import { useConvoyChannel } from '../../realtime/useConvoyChannel'
import { useSession } from '../../session'

const ConvoyMap = lazy(() => import('../../map/ConvoyMap'))

/** Nur-Zuschauen: WhatsApp-Link → direkt Vollbild-Karte, keine Lobby. */
export default function WatchScreen() {
  const { code } = useParams<{ code: string }>()
  const { userId } = useSession()
  const [tripId, setTripId] = useState<string | null>(null)
  const [trip, setTrip] = useState<Trip | null>(null)
  const [members, setMembers] = useState<TripMember[]>([])
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!code) return
    joinAsSpectator(code)
      .then(setTripId)
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [code])

  useEffect(() => {
    if (!tripId) return
    const load = () => {
      void getTrip(tripId).then(setTrip).catch(() => {})
      void getMembers(tripId).then(setMembers).catch(() => {})
      void getCheckpoints(tripId).then(setCheckpoints).catch(() => {})
    }
    load()
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [tripId])

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000)
    return () => clearInterval(id)
  }, [])

  const { peers, spectators } = useConvoyChannel(tripId ?? '', userId, undefined, 'spectator')
  const now = Date.now()
  const livePeers = Object.values(peers).filter((p) => now - p.ts < STALE_AFTER_MS * 3)
  const drivers = members.filter((m) => m.role !== 'spectator')
  const handleOf = (id: string) => drivers.find((m) => m.userId === id)?.handle ?? id.slice(0, 6)

  const routeIndex = useMemo(
    () => (trip?.routeGeojson ? buildRouteIndex(trip.routeGeojson) : null),
    [trip?.routeGeojson],
  )

  const convoy = useMemo(() => {
    if (!routeIndex) return null
    return computeConvoy(
      routeIndex,
      livePeers.map((p) => ({ userId: p.userId, point: { lat: p.lat, lng: p.lng }, speedMps: p.speedMps })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeIndex, peers])

  const cars: CarPosition[] = livePeers.map((p) => ({
    userId: p.userId,
    handle: handleOf(p.userId),
    lat: p.lat,
    lng: p.lng,
    heading: p.heading,
    accent: p.accent ?? null,
    isSelf: false,
    stale: now - p.ts > STALE_AFTER_MS,
  }))

  const cpTicks = useMemo(() => {
    if (!routeIndex) return []
    return checkpoints
      .map((cp) => ({ cp, fix: snapToRoute(routeIndex, { lat: cp.lat, lng: cp.lng }) }))
      .filter((x) => x.fix.offRouteM <= 500)
      .map((x) => ({ id: x.cp.id, kind: x.cp.kind, pct: x.fix.alongM / routeIndex.totalM }))
  }, [routeIndex, checkpoints])

  const carDots =
    routeIndex && convoy
      ? convoy
          .filter((e) => !e.offRoute)
          .map((e) => ({
            userId: e.userId,
            pct: e.alongM / routeIndex.totalM,
            accent: peers[e.userId]?.accent ?? null,
          }))
      : []

  if (error) {
    return (
      <div className="splash">
        <div>
          <div className="display" style={{ fontSize: 28, color: 'var(--amber)' }}>Supra Companion</div>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="drive-full">
      <Suspense fallback={<div className="map-placeholder" style={{ position: 'absolute', inset: 0 }}>Karte lädt…</div>}>
        <ConvoyMap cars={cars} route={trip?.routeGeojson ?? null} checkpoints={checkpoints} spectate />
      </Suspense>

      <div className="hud">
        <div className="hud-section">
          <div className="hud-top">
            <div>
              <div className="eyebrow">👁 Zuschauen · {trip?.name ?? '…'}</div>
              {trip?.status === 'draft' && (
                <div className="display hud-pos" style={{ fontSize: 22 }}>Noch nicht losgefahren</div>
              )}
              {trip?.status === 'ended' && (
                <div className="display hud-pos" style={{ fontSize: 22 }}>Angekommen 🏁</div>
              )}
            </div>
            <span className={trip?.status === 'live' ? 'badge badge-live' : 'badge'}>
              {trip ? statusLabel[trip.status] : '…'}
            </span>
          </div>
        </div>

        <div className="hud-mid">
          <div />
          {convoy && convoy.length > 0 && (
            <div className="leaderboard">
              <div className="label">Konvoi</div>
              {convoy.map((e) => (
                <div className={`lb-row${e.offRoute ? ' lb-off' : ''}`} key={e.userId}>
                  <span className="lb-who">
                    {e.position ? <span className="pos-p">P{e.position}</span> : <span className="gap-off">⚑</span>}{' '}
                    {handleOf(e.userId)}
                  </span>
                  <span className="lb-gap">
                    {e.offRoute ? 'abseits' : e.position === 1 ? 'vorne' : e.gapAheadSec != null ? formatGap(e.gapAheadSec) : '—'}
                  </span>
                </div>
              ))}
              {drivers.length > convoy.length && (
                <div className="lb-row lb-offline">
                  <span className="lb-who">– {drivers.length - convoy.length} offline</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="hud-section hud-bottom">
          {routeIndex && (
            <div className="watch-progress" aria-hidden="true">
              <div className="wp-track" />
              {cpTicks.map((t, i) => (
                <span className="wp-cp" key={t.id} style={{ left: `${t.pct * 100}%` }}>
                  {stopIcon(t.kind, i === cpTicks.length - 1)}
                </span>
              ))}
              {carDots.map((d) => (
                <span
                  className="wp-car"
                  key={d.userId}
                  style={{ left: `${d.pct * 100}%`, background: d.accent ?? 'var(--cyan)' }}
                />
              ))}
            </div>
          )}
          <div className="hud-links">
            <span className="hint">
              {livePeers.length > 0
                ? `${livePeers.length} ${livePeers.length === 1 ? 'Auto' : 'Autos'} live`
                : 'Warten auf den Konvoi…'}
              {spectators > 1 && ` · 👁 ${spectators} schauen zu`}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
