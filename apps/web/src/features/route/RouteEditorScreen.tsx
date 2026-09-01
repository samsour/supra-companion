import {
  buildRouteIndex,
  type Checkpoint,
  type CheckpointKind,
  type RouteGeometry,
  type Trip,
} from '@supra/core'
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
  searchPlaces,
  updateTripRoute,
  type PlaceHit,
} from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { checkpointIcon, checkpointLabel } from '../../lib/labels'
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

  const search = async (e: FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    try {
      setHits(await searchPlaces(query.trim()))
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSearching(false)
    }
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
      el.textContent = checkpointIcon[cp.kind]
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
          ? 'Tippe auf die Karte, um Wegpunkte zu setzen — die Route folgt automatisch den Straßen.'
          : 'Tippe auf die Karte, um einen Stopp zu setzen (Tanken, Essen, Foto, Treffpunkt). Pin antippen zum Entfernen.'}
      </p>

      <form className="search-row" onSubmit={search}>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ort suchen — z.B. Berchtesgaden"
          autoCorrect="off"
        />
        <button className="btn" style={{ width: 'auto' }} disabled={searching || !query.trim()}>
          {searching ? '…' : '🔍'}
        </button>
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
          <div className="tabs" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {(Object.keys(checkpointIcon) as CheckpointKind[]).map((k) => (
              <button key={k} className="tab" aria-selected={cpKind === k} onClick={() => setCpKind(k)}>
                {checkpointIcon[k]} {checkpointLabel[k]}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="btn" onClick={() => setPendingCp(null)}>Abbrechen</button>
            <button className="btn btn-primary" disabled={busy || !cpName.trim()} onClick={saveCp}>
              Hinzufügen
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
