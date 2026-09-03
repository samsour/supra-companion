import {
  buildRouteIndex,
  snapToRoute,
  type Checkpoint,
  type CheckpointKind,
  type RouteGeometry,
  type Trip,
} from '@supra/core'
import { useMemo } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  addCheckpoint,
  deleteCheckpoint,
  fetchDirections,
  getCheckpoints,
  getTrip,
  matchToRoads,
  searchPlaces,
  setCheckpointOrder,
  updateCheckpointKind,
  updateTripRoute,
  type PlaceHit,
} from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { asCoordinate, isGoogleMapsLink, parseGoogleMapsLink } from '../../lib/googleMaps'
import { parseGpx } from '../../lib/gpx'
import { checkpointIcon, checkpointLabel, stopIcon } from '../../lib/labels'
import { applyNeonStyle } from '../../map/neonStyle'
import { useSession } from '../../session'

const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
const style =
  (import.meta.env.VITE_MAPBOX_STYLE as string | undefined) ?? 'mapbox://styles/mapbox/dark-v11'

type Mode = 'route' | 'checkpoint'

export default function RouteEditorScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const { userId } = useSession()
  const navigate = useNavigate()

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [loaded, setLoaded] = useState(false)
  const wpMarkersRef = useRef<mapboxgl.Marker[]>([])
  const cpMarkersRef = useRef<mapboxgl.Marker[]>([])

  const [trip, setTrip] = useState<Trip | null>(null)
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [waypoints, setWaypoints] = useState<[number, number][]>([])
  const [preview, setPreview] = useState<{ geometry: RouteGeometry; distanceM: number } | null>(null)
  const [mode, setMode] = useState<Mode>('route')
  const modeRef = useRef<Mode>('route')
  const [pendingCp, setPendingCp] = useState<{ lng: number; lat: number } | null>(null)
  const [cpName, setCpName] = useState('')
  const [cpKind, setCpKind] = useState<CheckpointKind>('meet')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [searching, setSearching] = useState(false)
  const [routeVia, setRouteVia] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const editorRouteIndex = useMemo(
    () => (preview ? buildRouteIndex(preview.geometry) : null),
    [preview],
  )
  const isImported = waypoints.length === 0 && preview !== null

  /** Stopps auf der Kilometer-Achse der Route: sortiert nach Lage, mit
   *  km-Marke; Abseitige (>500 m neben der Linie) ans Ende mit Warnung. */
  const stopRows = useMemo(() => {
    if (!editorRouteIndex) {
      return checkpoints.map((cp) => ({ cp, alongM: null as number | null, offM: null as number | null }))
    }
    return checkpoints
      .map((cp) => {
        const fix = snapToRoute(editorRouteIndex, { lat: cp.lat, lng: cp.lng })
        return { cp, alongM: fix.alongM, offM: fix.offRouteM }
      })
      .sort((a, b) => (a.offM! > 500 ? Infinity : a.alongM!) - (b.offM! > 500 ? Infinity : b.alongM!))
  }, [checkpoints, editorRouteIndex])

  /** Wegpunkt so einfügen, dass die Route über diesen Punkt führt. */
  const insertViaWaypoint = (p: { lng: number; lat: number }) => {
    setWaypoints((prev) => {
      if (prev.length < 2 || !editorRouteIndex) return [...prev, [p.lng, p.lat]]
      const stopAlong = snapToRoute(editorRouteIndex, { lat: p.lat, lng: p.lng }).alongM
      const alongs = prev.map(([lng, lat]) => snapToRoute(editorRouteIndex, { lat, lng }).alongM)
      let idx = alongs.findIndex((a) => a > stopAlong)
      if (idx === -1) idx = prev.length
      const n = [...prev]
      n.splice(idx, 0, [p.lng, p.lat])
      return n
    })
    setDirty(true)
  }
  // true when the preview came from an import (no waypoints backing it)
  const importedRef = useRef(false)
  useEffect(() => {
    importedRef.current = waypoints.length === 0 && preview !== null
  }, [waypoints, preview])

  const moveWaypoint = (i: number, dir: -1 | 1) => {
    const t = i + dir
    if (t < 0 || t >= waypoints.length) return
    setWaypoints((prev) => {
      const n = [...prev]
      ;[n[i], n[t]] = [n[t]!, n[i]!]
      return n
    })
    setDirty(true)
  }

  const removeWaypoint = (i: number) => {
    setWaypoints((prev) => prev.filter((_, idx) => idx !== i))
    setDirty(true)
  }

  const downsample = (pts: [number, number][], target: number): [number, number][] => {
    if (pts.length <= target) return pts
    const step = (pts.length - 1) / (target - 1)
    return Array.from({ length: target }, (_, i) => pts[Math.round(i * step)]!)
  }

  const importGpx = async (file: File) => {
    setBusy(true)
    try {
      const { coordinates, stopps } = parseGpx(await file.text())
      const rawGeometry: RouteGeometry = { type: 'LineString', coordinates }
      const totalM = buildRouteIndex(rawGeometry).totalM
      const avgStepM = totalM / Math.max(1, coordinates.length - 1)

      if (coordinates.length <= 25 || avgStepM > 300) {
        // grobe GPX (nur Via-Punkte): als Wegpunkte übernehmen und straßengenau
        // routen — Ergebnis bleibt editierbar wie eine handgeplante Route
        setWaypoints(downsample(coordinates, 25))
        setDirty(true)
        setPreview(null)
      } else {
        // dichter Track: aufs Straßennetz matchen; wenn das nicht klappt
        // (z.B. Offroad-Anteile), bleibt die Rohlinie als Fallback
        setWaypoints([])
        setDirty(false)
        try {
          setPreview(await matchToRoads(downsample(coordinates, 380)))
        } catch {
          setPreview({ geometry: rawGeometry, distanceM: totalM })
        }
      }
      fittedRef.current = false
      if (tripId && stopps.length > 0) {
        for (const [i, s] of stopps.entries()) {
          await addCheckpoint(tripId, {
            name: s.name,
            kind: s.kind,
            lat: s.lat,
            lng: s.lng,
            orderIdx: checkpoints.length + i,
          })
        }
        refreshCheckpoints()
      }
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  /** Google-Routenlink → Wegpunkte (Namen werden geocodiert) */
  const importGoogleLink = async (link: string) => {
    const segments = parseGoogleMapsLink(link)
    if (segments.length > 25) throw new Error('Zu viele Ziele im Link (max. 25)')
    const points: [number, number][] = []
    for (const seg of segments) {
      const coord = asCoordinate(seg)
      if (coord) {
        points.push(coord)
        continue
      }
      const hit = (await searchPlaces(seg))[0]
      if (!hit) throw new Error(`Ort nicht gefunden: "${seg}"`)
      points.push([hit.lng, hit.lat])
    }
    setWaypoints(points)
    setDirty(true)
    fittedRef.current = false
    setQuery('')
  }

  const search = async (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    try {
      if (isGoogleMapsLink(q)) {
        await importGoogleLink(q)
      } else {
        setHits(await searchPlaces(q))
      }
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSearching(false)
    }
  }

  const moveCheckpoint = async (index: number, dir: -1 | 1) => {
    const next = [...checkpoints]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setCheckpoints(next.map((cp, i) => ({ ...cp, orderIdx: i }))) // optimistic
    try {
      await setCheckpointOrder(next)
    } catch (e) {
      setError(errorMessage(e))
    }
    refreshCheckpoints()
  }

  /** Icon antippen wechselt den Stopp-Typ: ⛽ → 🍔 → 📸 → 📍 */
  const cycleKind = async (cp: Checkpoint) => {
    const KINDS: CheckpointKind[] = ['fuel', 'food', 'photo', 'meet']
    const next = KINDS[(KINDS.indexOf(cp.kind) + 1) % KINDS.length]!
    setCheckpoints((prev) => prev.map((c) => (c.id === cp.id ? { ...c, kind: next } : c)))
    try {
      await updateCheckpointKind(cp.id, next)
    } catch (e) {
      setError(errorMessage(e))
      refreshCheckpoints()
    }
  }

  const removeCheckpoint = async (cp: Checkpoint) => {
    if (!window.confirm(`Stopp "${cp.name}" entfernen?`)) return
    try {
      await deleteCheckpoint(cp.id)
    } catch (e) {
      setError(errorMessage(e))
    }
    refreshCheckpoints()
  }

  const goToPlace = (h: PlaceHit) => {
    setHits([])
    setQuery('')
    mapRef.current?.flyTo({ center: [h.lng, h.lat], zoom: 12, duration: 1200 })
  }

  const refreshCheckpoints = useCallback(() => {
    if (tripId) void getCheckpoints(tripId).then(setCheckpoints).catch(() => {})
  }, [tripId])

  useEffect(() => {
    if (!tripId) return
    getTrip(tripId)
      .then((t) => {
        setTrip(t)
        setWaypoints(t.routeWaypoints ?? [])
        if (t.routeGeojson) {
          setPreview({ geometry: t.routeGeojson, distanceM: buildRouteIndex(t.routeGeojson).totalM })
        }
      })
      .catch((e: unknown) => setError(errorMessage(e)))
    refreshCheckpoints()
  }, [tripId, refreshCheckpoints])

  // --- map lifecycle ---
  useEffect(() => {
    if (!token || !containerRef.current) return
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style,
      center: [10.45, 51.16],
      zoom: 5,
    })
    map.on('load', () => {
      map.resize()
      applyNeonStyle(map)
      map.addSource('preview', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'preview-glow',
        type: 'line',
        source: 'preview',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#1f51ff', 'line-width': 18, 'line-blur': 12, 'line-opacity': 0.7 },
      })
      map.addLayer({
        id: 'preview-core',
        type: 'line',
        source: 'preview',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#4d8dff', 'line-width': 5 },
      })
      setLoaded(true)
    })
    mapRef.current = map
    return () => {
      mapRef.current = null
      wpMarkersRef.current = []
      cpMarkersRef.current = []
      setLoaded(false)
      map.remove()
    }
  }, [])

  // --- tap to add waypoint / checkpoint ---
  useEffect(() => {
    modeRef.current = mode
  }, [mode])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat
      if (modeRef.current === 'route') {
        if (
          importedRef.current &&
          !window.confirm('Importierte Route verwerfen und neu mit Wegpunkten planen?')
        ) {
          return
        }
        setWaypoints((prev) => [...prev, [lng, lat]])
        setDirty(true)
      } else {
        setPendingCp({ lng, lat })
      }
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [loaded])

  // --- fetch directions when waypoints change ---
  useEffect(() => {
    if (!dirty) return
    if (waypoints.length < 2) {
      setPreview(null)
      return
    }
    const t = setTimeout(() => {
      fetchDirections(waypoints)
        .then((r) => {
          setPreview(r)
          setError(null)
        })
        .catch((e: unknown) => setError(errorMessage(e)))
    }, 400)
    return () => clearTimeout(t)
  }, [waypoints, dirty])

  // --- render preview line ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    const src = map.getSource('preview') as mapboxgl.GeoJSONSource | undefined
    src?.setData(
      preview
        ? { type: 'Feature', geometry: preview.geometry, properties: {} }
        : { type: 'FeatureCollection', features: [] },
    )
  }, [preview, loaded])

  // --- waypoint dots ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    for (const [i, [lng, lat]] of waypoints.entries()) {
      const el = document.createElement('div')
      el.className = 'wp-marker'
      el.textContent = String(i + 1)
      const marker = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat([lng, lat])
        .addTo(map)
      marker.on('dragend', () => {
        const p = marker.getLngLat()
        setWaypoints((prev) => prev.map((w, idx) => (idx === i ? [p.lng, p.lat] : w)))
        setDirty(true)
      })
      wpMarkersRef.current.push(marker)
    }
    return () => {
      wpMarkersRef.current.forEach((m) => m.remove())
      wpMarkersRef.current = []
    }
  }, [waypoints, loaded])

  // --- checkpoint pins (click one to delete) ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    for (const [i, cp] of checkpoints.entries()) {
      const el = document.createElement('div')
      el.className = 'cp-marker cp-editable'
      el.textContent = stopIcon(cp.kind, i === checkpoints.length - 1)
      el.title = `${cp.name} — antippen zum Entfernen`
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        if (window.confirm(`Stopp "${cp.name}" entfernen?`)) {
          void deleteCheckpoint(cp.id).then(refreshCheckpoints)
        }
      })
      cpMarkersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([cp.lng, cp.lat]).addTo(map))
    }
    return () => {
      cpMarkersRef.current.forEach((m) => m.remove())
      cpMarkersRef.current = []
    }
  }, [checkpoints, loaded, refreshCheckpoints])

  // fit to existing route once
  const fittedRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded || fittedRef.current) return
    const coords = preview?.geometry.coordinates ?? waypoints
    if (coords.length < 2) return
    fittedRef.current = true
    const bounds = coords.reduce(
      (b, c) => b.extend(c as [number, number]),
      new mapboxgl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]),
    )
    map.fitBounds(bounds, { padding: 60, duration: 800 })
  }, [preview, waypoints, loaded])

  const saveCp = async () => {
    if (!tripId || !pendingCp || !cpName.trim()) return
    setBusy(true)
    try {
      await addCheckpoint(tripId, {
        name: cpName.trim(),
        kind: cpKind,
        lat: pendingCp.lat,
        lng: pendingCp.lng,
        orderIdx: checkpoints.length,
      })
      if (routeVia && !isImported) insertViaWaypoint(pendingCp)
      setPendingCp(null)
      setCpName('')
      refreshCheckpoints()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!tripId) return
    setBusy(true)
    try {
      await updateTripRoute(tripId, preview?.geometry ?? null, waypoints.length ? waypoints : null)
      navigate(`/trip/${tripId}`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (!tripId) return null
  if (trip && trip.organizerId !== userId) {
    return (
      <div className="screen">
        <div className="notice">Nur der Organisator kann die Route bearbeiten.</div>
        <p className="hint"><Link to={`/trip/${tripId}`} style={{ color: 'var(--cyan)' }}>← Zur Lobby</Link></p>
      </div>
    )
  }

  return (
    <div className="screen">
      <header className="row">
        <div>
          <div className="eyebrow">{trip?.name ?? 'Route'}</div>
          <h1 className="display" style={{ fontSize: 26 }}>Routen-Editor</h1>
        </div>
        <span className="badge">
          {preview ? `${(preview.distanceM / 1000).toFixed(0)} km` : `${waypoints.length} Punkte`}
        </span>
      </header>

      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={mode === 'route'} onClick={() => setMode('route')}>
          ➤ Wegpunkte
        </button>
        <button className="tab" role="tab" aria-selected={mode === 'checkpoint'} onClick={() => setMode('checkpoint')}>
          🏁 Stopps
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {mode === 'route'
          ? 'Tippe auf die Karte für Wegpunkte — die Route folgt den Straßen. Marker lassen sich ziehen.'
          : 'Tippe auf die Karte, um einen Stopp zu setzen (Tanken, Essen, Foto, Treffpunkt). Pin antippen zum Entfernen.'}
      </p>

      <form className="search-row" onSubmit={search}>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ort suchen oder Google-Maps-Link einfügen"
          autoCorrect="off"
        />
        <button className="btn" style={{ width: 'auto' }} disabled={searching || !query.trim()}>
          {searching ? '…' : '🔍'}
        </button>
        <button
          type="button"
          className="btn"
          style={{ width: 'auto' }}
          onClick={() => fileInputRef.current?.click()}
          title="GPX-Datei importieren (Komoot, Kurviger, Garmin, …)"
        >
          GPX
        </button>
        {/* kein accept-Attribut: iOS kennt für .gpx keinen Dateityp und würde
            die Dateien im Picker sonst ausgrauen — der Parser validiert selbst */}
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importGpx(f)
            e.target.value = ''
          }}
        />
      </form>
      {hits.length > 0 && (
        <div className="card" style={{ padding: '4px 14px' }}>
          {hits.map((h) => (
            <button className="recent-row" key={`${h.lng},${h.lat}`} onClick={() => goToPlace(h)}>
              {h.name}
            </button>
          ))}
        </div>
      )}

      {!token ? (
        <div className="map-placeholder">Set VITE_MAPBOX_TOKEN in apps/web/.env to enable the map</div>
      ) : (
        <div className="map-wrap" style={{ minHeight: 380 }}>
          <div ref={containerRef} className="map-canvas" />
        </div>
      )}

      {pendingCp && (
        <div className="card">
          <div className="label">Neuer Stopp</div>
          <input
            className="input"
            placeholder="Tankstopp Irschenberg"
            value={cpName}
            onChange={(e) => setCpName(e.target.value)}
            autoFocus
          />
          <div className="kind-row">
            {(Object.keys(checkpointIcon) as CheckpointKind[]).map((k) => (
              <button key={k} className="tab" aria-selected={cpKind === k} onClick={() => setCpKind(k)}>
                {checkpointIcon[k]} {checkpointLabel[k]}
              </button>
            ))}
          </div>
          {!isImported && (
            <label className="via-check">
              <input type="checkbox" checked={routeVia} onChange={(e) => setRouteVia(e.target.checked)} />
              Route über diesen Stopp führen
            </label>
          )}
          <div className="btn-row">
            <button className="btn" onClick={() => setPendingCp(null)}>Abbrechen</button>
            <button className="btn btn-primary" disabled={busy || !cpName.trim()} onClick={saveCp}>
              Hinzufügen
            </button>
          </div>
        </div>
      )}

      {waypoints.length > 0 && (
        <div className="card">
          <div className="label">Wegpunkte ({waypoints.length}) — Reihenfolge der Route</div>
          <div>
            {waypoints.map(([lng, lat], i) => (
              <div className="cp-row" key={`${i}:${lng.toFixed(5)}:${lat.toFixed(5)}`}>
                <span className="cp-row-name">
                  <span className="cp-row-idx">{i + 1}</span> {lat.toFixed(4)}, {lng.toFixed(4)}
                </span>
                <span className="cp-row-actions">
                  <button className="icon-btn" disabled={i === 0} onClick={() => moveWaypoint(i, -1)} aria-label="Wegpunkt nach oben">
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    disabled={i === waypoints.length - 1}
                    onClick={() => moveWaypoint(i, 1)}
                    aria-label="Wegpunkt nach unten"
                  >
                    ↓
                  </button>
                  <button className="icon-btn icon-btn-danger" onClick={() => removeWaypoint(i)} aria-label="Wegpunkt entfernen">
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stopRows.length > 0 && (
        <div className="card">
          <div className="label">
            Stopps ({stopRows.length}) — {editorRouteIndex ? 'entlang der Route' : 'Reihenfolge des Tages'}
          </div>
          <div>
            {stopRows.map(({ cp, alongM, offM }, i) => (
              <div className="cp-row" key={cp.id}>
                <span className="cp-row-name">
                  <span className="cp-row-idx">{i + 1}</span>{' '}
                  <button
                    type="button"
                    className="cp-kind-btn"
                    title="Typ ändern: Tanken → Essen → Foto → Treffpunkt"
                    aria-label={`Stopp-Typ ändern, aktuell ${checkpointLabel[cp.kind]}`}
                    onClick={() => void cycleKind(cp)}
                  >
                    {stopIcon(cp.kind, i === stopRows.length - 1 && (offM === null || offM <= 500))}
                  </button>{' '}
                  {cp.name}{' '}
                  {alongM !== null &&
                    (offM! > 500 ? (
                      <span className="cp-km cp-km-warn">⚠ {(offM! / 1000).toFixed(1)} km neben der Route</span>
                    ) : (
                      <span className="cp-km">km {(alongM / 1000).toFixed(0)}</span>
                    ))}
                </span>
                <span className="cp-row-actions">
                  {!editorRouteIndex && (
                    <>
                      <button className="icon-btn" disabled={i === 0} onClick={() => moveCheckpoint(i, -1)} aria-label="nach oben">
                        ↑
                      </button>
                      <button
                        className="icon-btn"
                        disabled={i === stopRows.length - 1}
                        onClick={() => moveCheckpoint(i, 1)}
                        aria-label="nach unten"
                      >
                        ↓
                      </button>
                    </>
                  )}
                  <button className="icon-btn icon-btn-danger" onClick={() => removeCheckpoint(cp)} aria-label="entfernen">
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="notice">{error}</div>}

      <div className="btn-row">
        <button
          className="btn"
          disabled={waypoints.length === 0}
          onClick={() => {
            setWaypoints((p) => p.slice(0, -1))
            setDirty(true)
          }}
        >
          Rückgängig
        </button>
        <button
          className="btn"
          disabled={waypoints.length === 0}
          onClick={() => {
            setWaypoints([])
            setPreview(null)
            setDirty(true)
          }}
        >
          Leeren
        </button>
        <button className="btn btn-primary" disabled={busy || (dirty && waypoints.length === 1)} onClick={save}>
          {busy ? 'Speichern…' : 'Route speichern'}
        </button>
      </div>

      <p className="hint">
        <Link to={`/trip/${tripId}`} style={{ color: 'var(--cyan)' }}>← Zur Lobby</Link>
      </p>
    </div>
  )
}
