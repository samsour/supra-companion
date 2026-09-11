import { haversineMeters, type Trip, type TripMember } from '@supra/core'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getMembers, getTrip, getTripTracks, joinAsSpectator, type TrackPoint } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { applyNeonStyle } from '../../map/neonStyle'
import { useSession } from '../../session'

const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
const style =
  (import.meta.env.VITE_MAPBOX_STYLE as string | undefined) ?? 'mapbox://styles/mapbox/dark-v11'

/** Wiedergabedauer der ganzen Etappe im Zeitraffer */
const REPLAY_MS = 75_000
/** Pausen länger als das werden nicht interpoliert, sondern gehalten */
const GAP_MS = 10 * 60_000
/** so lange (Simulationszeit) bleibt ein Marker nach dem letzten Punkt
 *  bzw. am Anfang einer langen Lücke sichtbar, dann blendet er aus */
const GRACE_MS = 60_000
/** Kamera rahmt zusätzlich die Spur der letzten Sim-Minuten ein — gibt
 *  Kontext und verhindert hektisches Kleben an den Momentanpositionen */
const CAM_TRAIL_MS = 10 * 60_000

const COLORS = ['#ffa02e', '#35e0f2', '#e653b8', '#7cff6b', '#ffd02e', '#9d7bff', '#ff6b5e']
const colorFor = (id: string, i: number) => COLORS[i % COLORS.length] ?? '#ffa02e'

interface DriverTrack {
  userId: string
  handle: string
  color: string
  pts: TrackPoint[]
  /** kumulierte Meter je Punkt */
  cum: number[]
}

const bearingDeg = (a: TrackPoint, b: TrackPoint): number => {
  const r = (d: number) => (d * Math.PI) / 180
  const y = Math.sin(r(b.lng - a.lng)) * Math.cos(r(b.lat))
  const x =
    Math.cos(r(a.lat)) * Math.sin(r(b.lat)) -
    Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lng - a.lng))
  return (Math.atan2(y, x) * 180) / Math.PI
}

function downsample(pts: TrackPoint[], target = 1500): TrackPoint[] {
  if (pts.length <= target) return pts
  const step = (pts.length - 1) / (target - 1)
  return Array.from({ length: target }, (_, i) => pts[Math.round(i * step)]!)
}

export default function ReplayScreen() {
  // zwei Wege hierher: /trip/:tripId/replay (Mitglied) oder /replay/:code
  // (geteilter Link — stiller Zuschauer-Beitritt über den Watch-Code)
  const { tripId: tripIdParam, code } = useParams<{ tripId?: string; code?: string }>()
  useSession() // Auth sicherstellen
  const [tripId, setTripId] = useState<string | null>(tripIdParam ?? null)
  const [copied, setCopied] = useState(false)
  const [trip, setTrip] = useState<Trip | null>(null)
  const [members, setMembers] = useState<TripMember[]>([])
  const [tracks, setTracks] = useState<Record<string, TrackPoint[]> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(true)
  const [progress, setProgress] = useState(0) // 0..1, nur fürs UI
  const [kmNow, setKmNow] = useState<Record<string, number>>({})

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (tripId || !code) return
    joinAsSpectator(code)
      .then(setTripId)
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [code, tripId])

  useEffect(() => {
    if (!tripId) return
    void getTrip(tripId).then(setTrip).catch((e: unknown) => setError(errorMessage(e)))
    void getMembers(tripId).then(setMembers).catch(() => {})
    void getTripTracks(tripId)
      .then(setTracks)
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [tripId])

  const shareReplay = async () => {
    if (!trip?.spectatorCode) return
    const url = `${window.location.origin}/replay/${trip.spectatorCode}`
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Supra Companion',
          text: `▶ Replay unserer Etappe "${trip.name}" — schau dir die Fahrt im Zeitraffer an!`,
          url,
        })
      } else {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2_500)
      }
    } catch {
      /* Share-Sheet abgebrochen */
    }
  }

  const drivers = useMemo<DriverTrack[]>(() => {
    if (!tracks) return []
    return Object.entries(tracks)
      .filter(([, pts]) => pts.length >= 2)
      .map(([userId, raw], i) => {
        const pts = downsample(raw)
        const cum: number[] = [0]
        for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1]! + haversineMeters(pts[k - 1]!, pts[k]!))
        return {
          userId,
          handle: members.find((m) => m.userId === userId)?.handle ?? userId.slice(0, 6),
          color: colorFor(userId, i),
          pts,
          cum,
        }
      })
  }, [tracks, members])

  const span = useMemo(() => {
    if (drivers.length === 0) return null
    const t0 = Math.min(...drivers.map((d) => d.pts[0]!.ts))
    const t1 = Math.max(...drivers.map((d) => d.pts[d.pts.length - 1]!.ts))
    return t1 > t0 ? { t0, t1 } : null
  }, [drivers])

  // --- Karte ---
  useEffect(() => {
    if (!token || !containerRef.current) return
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style,
      center: [10.45, 51.16],
      zoom: 5,
      interactive: false,
    })
    map.on('load', () => {
      map.resize()
      applyNeonStyle(map)
      setLoaded(true)
    })
    mapRef.current = map
    return () => {
      mapRef.current = null
      setLoaded(false)
      map.remove()
    }
  }, [])

  // geplante Route als dezenter Kontext
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded || !trip?.routeGeojson) return
    map.addSource('planned', { type: 'geojson', data: { type: 'Feature', geometry: trip.routeGeojson, properties: {} } })
    map.addLayer({
      id: 'planned',
      type: 'line',
      source: 'planned',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#28406e', 'line-width': 3, 'line-opacity': 0.7 },
    })
    return () => {
      if (!map.getStyle()) return
      if (map.getLayer('planned')) map.removeLayer('planned')
      if (map.getSource('planned')) map.removeSource('planned')
    }
  }, [trip?.routeGeojson, loaded])

  const playingRef = useRef(playing)
  playingRef.current = playing
  const progressRef = useRef(0)

  // --- Replay-Engine: Marker, wachsende Spuren, Kino-Kamera ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded || !span || drivers.length === 0) return

    const markers = drivers.map((d) => {
      const root = document.createElement('div')
      root.className = 'car-marker'
      root.style.setProperty('--car-color', d.color)
      const arrow = document.createElement('div')
      arrow.className = 'car-arrow'
      root.append(arrow)
      const labelEl = document.createElement('div')
      labelEl.className = 'car-label'
      labelEl.style.setProperty('--car-color', d.color)
      labelEl.textContent = d.handle
      const first = d.pts[0]!
      return {
        d,
        idx: 0,
        hidden: false,
        arrow: new mapboxgl.Marker({ element: root, anchor: 'center', pitchAlignment: 'map', rotationAlignment: 'map' })
          .setLngLat([first.lng, first.lat])
          .addTo(map),
        label: new mapboxgl.Marker({ element: labelEl, anchor: 'top', offset: [0, 14] })
          .setLngLat([first.lng, first.lat])
          .addTo(map),
      }
    })
    for (const m of markers) {
      map.addSource(`trail-${m.d.userId}`, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: `trail-${m.d.userId}`,
        type: 'line',
        source: `trail-${m.d.userId}`,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': m.d.color, 'line-width': 4, 'line-opacity': 0.9 },
      })
    }

    const cam = { lng: 0, lat: 0, zoom: 8, bearing: 0, init: false }
    let camTarget: { lng: number; lat: number; zoom: number } | null = null
    let lastCamCalc = 0
    let endCamSet = false
    let lastTrail = 0
    let lastUi = 0
    let raf = 0
    let last = performance.now()

    const tick = (now: number) => {
      const dt = now - last
      last = now
      if (playingRef.current) {
        progressRef.current = Math.min(1, progressRef.current + dt / REPLAY_MS)
        if (progressRef.current >= 1) setPlaying(false)
      }
      const simT = span.t0 + progressRef.current * (span.t1 - span.t0)

      const positions: [number, number][] = []
      for (const m of markers) {
        const pts = m.d.pts
        if (simT < pts[0]!.ts) m.idx = 0
        while (m.idx > 0 && pts[m.idx]!.ts > simT) m.idx-- // Scrub rückwärts
        while (m.idx < pts.length - 2 && pts[m.idx + 1]!.ts <= simT) m.idx++
        const a = pts[m.idx]!
        const b = pts[Math.min(m.idx + 1, pts.length - 1)]!
        const seg = b.ts - a.ts
        const frac = seg > 0 && seg < GAP_MS ? Math.max(0, Math.min(1, (simT - a.ts) / seg)) : 0
        const lng = a.lng + (b.lng - a.lng) * frac
        const lat = a.lat + (b.lat - a.lat) * frac
        m.arrow.setLngLat([lng, lat]).setRotation(bearingDeg(a, b))
        m.label.setLngLat([lng, lat])

        // Handy aus / lange Pause: kurz nach dem letzten Punkt ausblenden,
        // damit die Kamera nur den fahrenden Rest einrahmt (Spur bleibt)
        const notStarted = simT < pts[0]!.ts
        const ended = simT > pts[pts.length - 1]!.ts + GRACE_MS
        const inGap = seg >= GAP_MS && simT > a.ts + GRACE_MS && simT < b.ts
        const hidden = notStarted || ended || inGap
        m.hidden = hidden
        m.arrow.getElement().classList.toggle('car-hidden', hidden)
        m.label.getElement().classList.toggle('car-hidden', hidden)
        if (!hidden) positions.push([lng, lat])

        if (now - lastTrail > 100) {
          const coords = pts.slice(0, m.idx + 1).map((p) => [p.lng, p.lat] as [number, number])
          coords.push([lng, lat])
          const src = map.getSource(`trail-${m.d.userId}`) as mapboxgl.GeoJSONSource | undefined
          src?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} })
        }
      }
      if (now - lastTrail > 100) lastTrail = now

      // Kamera-Ziel jede Sekunde neu, Position jede Frame weich nachziehen;
      // am Ende einmal auf alle Spuren komplett aufziehen
      if (progressRef.current >= 1) {
        if (!endCamSet) {
          endCamSet = true
          const allPts = markers.flatMap((mm) => mm.d.pts.map((p) => [p.lng, p.lat] as [number, number]))
          if (allPts.length > 0) {
            const bounds = allPts.reduce(
              (bb, p) => bb.extend(p),
              new mapboxgl.LngLatBounds(allPts[0]!, allPts[0]!),
            )
            const c = map.cameraForBounds(bounds, { padding: 90 })
            if (c?.center) {
              const ctr = mapboxgl.LngLat.convert(c.center)
              camTarget = { lng: ctr.lng, lat: ctr.lat, zoom: Math.min(13, Math.max(5, (c.zoom ?? 9) - 0.2)) }
            }
          }
        }
      } else {
        endCamSet = false
        if (positions.length > 0 && now - lastCamCalc > 1000) {
          lastCamCalc = now
          // Momentanpositionen + jüngste Spur der Aktiven als Rahmen
          const boundsPts: [number, number][] = [...positions]
          for (const mm of markers) {
            if (mm.hidden) continue
            let k = mm.idx
            while (k >= 0 && mm.d.pts[k]!.ts >= simT - CAM_TRAIL_MS) {
              boundsPts.push([mm.d.pts[k]!.lng, mm.d.pts[k]!.lat])
              k--
            }
          }
          const first = boundsPts[0]!
          const bounds = boundsPts.reduce(
            (bb, p) => bb.extend(p),
            new mapboxgl.LngLatBounds(first, first),
          )
          const c = map.cameraForBounds(bounds, { padding: 120 })
          if (c?.center) {
            const ctr = mapboxgl.LngLat.convert(c.center)
            camTarget = { lng: ctr.lng, lat: ctr.lat, zoom: Math.min(11.5, Math.max(7, (c.zoom ?? 10) - 0.5)) }
          }
        }
      }
      if (camTarget) {
        if (!cam.init) {
          Object.assign(cam, camTarget, { init: true })
        } else {
          const a = 1 - Math.exp((-dt / 1000) * 1.0)
          cam.lng += (camTarget.lng - cam.lng) * a
          cam.lat += (camTarget.lat - cam.lat) * a
          cam.zoom += (camTarget.zoom - cam.zoom) * a
        }
        cam.bearing += (dt / 1000) * 1.2
        map.jumpTo({ center: [cam.lng, cam.lat], zoom: cam.zoom, pitch: 50, bearing: cam.bearing })
      }

      if (now - lastUi > 200) {
        lastUi = now
        setProgress(progressRef.current)
        const km: Record<string, number> = {}
        for (const m of markers) km[m.d.userId] = (m.d.cum[m.idx] ?? 0) / 1000
        setKmNow(km)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      for (const m of markers) {
        m.arrow.remove()
        m.label.remove()
        if (map.getStyle()) {
          if (map.getLayer(`trail-${m.d.userId}`)) map.removeLayer(`trail-${m.d.userId}`)
          if (map.getSource(`trail-${m.d.userId}`)) map.removeSource(`trail-${m.d.userId}`)
        }
      }
    }
  }, [loaded, span, drivers])

  if (!tripId && !code) return null
  const simT = span ? span.t0 + progress * (span.t1 - span.t0) : null

  return (
    <div className="drive-full">
      {!token ? (
        <div className="map-placeholder" style={{ position: 'absolute', inset: 0 }}>
          Set VITE_MAPBOX_TOKEN in apps/web/.env
        </div>
      ) : (
        <div className="map-wrap">
          <div ref={containerRef} className="map-canvas" />
        </div>
      )}

      {(!tracks || error) && (
        <div className="replay-loading">
          <div className="card" style={{ alignItems: 'center', textAlign: 'center', minWidth: 240 }}>
            {error ? (
              <>
                <div className="display" style={{ fontSize: 20, color: 'var(--magenta)' }}>
                  Laden fehlgeschlagen
                </div>
                <p className="hint" style={{ margin: 0 }}>{error}</p>
                <button className="btn" onClick={() => window.location.reload()}>Nochmal versuchen</button>
              </>
            ) : (
              <>
                <div className="spinner" aria-hidden="true" />
                <div className="display" style={{ fontSize: 20 }}>Spuren werden geladen</div>
                <p className="hint" style={{ margin: 0 }}>Einen Moment …</p>
              </>
            )}
          </div>
        </div>
      )}

      <div className="hud">
        <div className="hud-top">
          <div className="eyebrow">▶ Replay · {trip?.name ?? '…'}</div>
          <span style={{ display: 'flex', gap: 6 }}>
            {trip?.spectatorCode && (
              <button
                className="badge sun-toggle"
                aria-label="Replay-Link teilen"
                onClick={() => void shareReplay()}
              >
                {copied ? '✓ kopiert' : '🔗 Teilen'}
              </button>
            )}
          <span className="badge">
            {simT !== null
              ? new Date(simT).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
              : '…'}
          </span>
          </span>
        </div>

        <div className="hud-section hud-bottom">
          {tracks && drivers.length === 0 && (
            <div className="notice">Keine Aufzeichnungen für diesen Trip gefunden.</div>
          )}

          {drivers.length > 0 && (
            <div className="replay-chips">
              {drivers.map((d) => (
                <span className="replay-chip" key={d.userId} style={{ '--car-color': d.color } as React.CSSProperties}>
                  <span className="replay-dot" />
                  {d.handle}
                  <span className="replay-km">{(kmNow[d.userId] ?? 0).toFixed(0)} km</span>
                </span>
              ))}
            </div>
          )}

          {span && (
            <div className="replay-controls">
              <button
                className="icon-btn"
                aria-label={playing ? 'Pause' : 'Abspielen'}
                onClick={() => {
                  if (!playing && progressRef.current >= 1) progressRef.current = 0
                  setPlaying(!playing)
                }}
              >
                {playing ? '⏸' : '⏵'}
              </button>
              <input
                type="range"
                min={0}
                max={1000}
                value={Math.round(progress * 1000)}
                aria-label="Zeitleiste"
                onChange={(e) => {
                  progressRef.current = Number(e.target.value) / 1000
                  setProgress(progressRef.current)
                }}
              />
            </div>
          )}

          <div className="hud-links">
            {!code && tripId && <Link to={`/trip/${tripId}/results`}>← Ergebnis</Link>}
          </div>
        </div>
      </div>
    </div>
  )
}
