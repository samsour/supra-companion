import {
  buildRouteIndex,
  type Checkpoint,
  type CheckpointKind,
  type RouteGeometry,
  type Trip,
} from '@supra/core'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  addCheckpoint,
  deleteCheckpoint,
  fetchDirections,
  getCheckpoints,
  getTrip,
  updateTripRoute,
} from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { applyNeonStyle } from '../../map/neonStyle'
import { useSession } from '../../session'

const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
const style =
  (import.meta.env.VITE_MAPBOX_STYLE as string | undefined) ?? 'mapbox://styles/mapbox/dark-v11'

type Mode = 'route' | 'checkpoint'
const CP_ICONS: Record<CheckpointKind, string> = { fuel: '⛽', food: '🍔', photo: '📸', meet: '🏁' }

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
      wpMarkersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map))
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
    for (const cp of checkpoints) {
      const el = document.createElement('div')
      el.className = 'cp-marker cp-editable'
      el.textContent = CP_ICONS[cp.kind]
      el.title = `${cp.name} — tap to remove`
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        if (window.confirm(`Remove checkpoint "${cp.name}"?`)) {
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
        <div className="notice">Only the organizer can edit the route.</div>
        <p className="hint"><Link to={`/trip/${tripId}`} style={{ color: 'var(--cyan)' }}>← Back to lobby</Link></p>
      </div>
    )
  }

  return (
    <div className="screen">
      <header className="row">
        <div>
          <div className="eyebrow">{trip?.name ?? 'Route'}</div>
          <h1 className="display" style={{ fontSize: 26 }}>Route editor</h1>
        </div>
        <span className="badge">
          {preview ? `${(preview.distanceM / 1000).toFixed(0)} km` : `${waypoints.length} pts`}
        </span>
      </header>

      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={mode === 'route'} onClick={() => setMode('route')}>
          ➤ Waypoints
        </button>
        <button className="tab" role="tab" aria-selected={mode === 'checkpoint'} onClick={() => setMode('checkpoint')}>
          🏁 Checkpoints
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {mode === 'route'
          ? 'Tap the map to drop waypoints — the driving route snaps to roads between them.'
          : 'Tap the map to place a checkpoint (fuel, food, photo, meet). Tap a pin to remove it.'}
      </p>

      {!token ? (
        <div className="map-placeholder">Set VITE_MAPBOX_TOKEN in apps/web/.env to enable the map</div>
      ) : (
        <div className="map-wrap" style={{ minHeight: 380 }}>
          <div ref={containerRef} className="map-canvas" />
        </div>
      )}

      {pendingCp && (
        <div className="card">
          <div className="label">New checkpoint</div>
          <input
            className="input"
            placeholder="Fuel stop Irschenberg"
            value={cpName}
            onChange={(e) => setCpName(e.target.value)}
            autoFocus
          />
          <div className="tabs" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {(Object.keys(CP_ICONS) as CheckpointKind[]).map((k) => (
              <button key={k} className="tab" aria-selected={cpKind === k} onClick={() => setCpKind(k)}>
                {CP_ICONS[k]} {k}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="btn" onClick={() => setPendingCp(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !cpName.trim()} onClick={saveCp}>
              Add
            </button>
          </div>
        </div>
      )}

      {error && <div className="notice">{error}</div>}

      <div className="row">
        <button
          className="btn"
          disabled={waypoints.length === 0}
          onClick={() => {
            setWaypoints((p) => p.slice(0, -1))
            setDirty(true)
          }}
        >
          Undo
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
          Clear
        </button>
        <button className="btn btn-primary" disabled={busy || (dirty && waypoints.length === 1)} onClick={save}>
          {busy ? 'Saving…' : 'Save route'}
        </button>
      </div>

      <p className="hint">
        <Link to={`/trip/${tripId}`} style={{ color: 'var(--cyan)' }}>← Back to lobby</Link>
      </p>
    </div>
  )
}
