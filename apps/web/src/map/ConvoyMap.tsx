import type { Checkpoint, RouteGeometry } from '@supra/core'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useEffect, useRef, useState } from 'react'
import { isValidAccent } from '../lib/accent'
import { stopIcon } from '../lib/labels'
import { applyNeonStyle, applyRoadBrightness } from './neonStyle'

const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
const style =
  (import.meta.env.VITE_MAPBOX_STYLE as string | undefined) ?? 'mapbox://styles/mapbox/dark-v11'

export interface CarPosition {
  userId: string
  handle: string
  lat: number
  lng: number
  heading: number | null
  /** driver-chosen neon color; falls back to hash color / amber for self */
  accent: string | null
  /** kleines Profilbild (Data-URL); ersetzt bei showAvatars den Pfeil */
  avatar: string | null
  isSelf: boolean
  stale: boolean
}

interface Props {
  cars: CarPosition[]
  route: RouteGeometry | null
  checkpoints: Checkpoint[]
  /** Zuschauer-Modus: Auto-Framing über Route + Konvoi statt Chase-Cam */
  spectate?: boolean
  /** Sonnen-Boost: hellere Straßen, breitere/hellere Routenlinie */
  sunBoost?: boolean
  /** 3D-Gebäude (Fancy-Modus / Zuschauer) */
  buildings3d?: boolean
  /** Profilbilder statt Pfeile zeigen (Fancy-Modus / Zuschauer) */
  showAvatars?: boolean
}

/** camera zoom while following own car — follow always returns to this */
const FOLLOW_ZOOM = 16
/** chase-cam tilt while following (degrees from top-down) */
const FOLLOW_PITCH = 55

const PEER_COLORS = ['#35e0f2', '#e653b8', '#7cff6b', '#ffd02e', '#9d7bff', '#ff6b5e']
const colorFor = (userId: string) => {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return PEER_COLORS[h % PEER_COLORS.length]!
}

interface CarMarker {
  /** the arrow — lies flat on the map plane, rotates in map space */
  arrowMarker: mapboxgl.Marker
  /** avatar variant: upright photo instead of a rotating arrow */
  isAvatar: boolean
  /** the name tag — separate screen-aligned marker so it stays readable; null for self */
  labelMarker: mapboxgl.Marker | null
  arrowRoot: HTMLDivElement
  labelEl: HTMLDivElement | null
  cur: { lat: number; lng: number }
  target: { lat: number; lng: number }
  heading: number
}

function buildCarElements(
  car: CarPosition,
  asAvatar: boolean,
): { arrowRoot: HTMLDivElement; labelEl: HTMLDivElement | null } {
  const color = isValidAccent(car.accent)
    ? car.accent
    : car.isSelf
      ? '#ffa02e'
      : colorFor(car.userId)
  const arrowRoot = document.createElement('div')
  arrowRoot.style.setProperty('--car-color', color)
  if (asAvatar && car.avatar) {
    arrowRoot.className = car.isSelf ? 'car-avatar car-self' : 'car-avatar'
    const img = document.createElement('img')
    img.src = car.avatar
    img.alt = ''
    arrowRoot.append(img)
  } else {
    arrowRoot.className = car.isSelf ? 'car-marker car-self' : 'car-marker'
    const arrow = document.createElement('div')
    arrow.className = 'car-arrow'
    arrowRoot.append(arrow)
  }
  if (car.isSelf) return { arrowRoot, labelEl: null } // own arrow stays label-free
  const labelEl = document.createElement('div')
  labelEl.className = 'car-label'
  labelEl.style.setProperty('--car-color', color)
  labelEl.textContent = car.handle
  return { arrowRoot, labelEl }
}

export default function ConvoyMap({
  cars,
  route,
  checkpoints,
  spectate = false,
  sunBoost = false,
  buildings3d = false,
  showAvatars = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [loaded, setLoaded] = useState(false)
  const carsRef = useRef<Map<string, CarMarker>>(new Map())
  const cpMarkersRef = useRef<mapboxgl.Marker[]>([])
  const [follow, setFollow] = useState(true)
  const followRef = useRef(true)
  const idleTimerRef = useRef<number | null>(null)

  const enableFollow = () => {
    followRef.current = true
    setFollow(true)
  }

  // --- map lifecycle ---
  useEffect(() => {
    if (!token || !containerRef.current) return
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style,
      center: [10.45, 51.16],
      zoom: 4,
    })
    // user interaction pauses follow; a few idle seconds re-enable it
    const IDLE_RECENTER_MS = 7_000
    const onUserInteraction = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return // programmatic camera moves don't count
      followRef.current = false
      setFollow(false)
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = window.setTimeout(() => {
        followRef.current = true
        setFollow(true)
      }, IDLE_RECENTER_MS)
    }
    for (const ev of ['dragstart', 'dragend', 'zoomstart', 'zoomend', 'rotatestart', 'rotateend', 'pitchstart', 'pitchend'] as const) {
      // payload types differ per event; we only look at originalEvent
      map.on(ev, onUserInteraction as unknown as () => void)
    }
    map.on('load', () => {
      map.resize() // in case the container was still settling during init
      applyNeonStyle(map)
      setLoaded(true)
    })
    mapRef.current = map
    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
      mapRef.current = null
      carsRef.current.clear()
      cpMarkersRef.current = []
      setLoaded(false)
      map.remove()
    }
  }, [])

  // --- 3D-Gebäude (unterhalb der Routenlinie, damit sie sichtbar bleibt) ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    const B3D = 'supra-3d-buildings'
    if (buildings3d && !map.getLayer(B3D)) {
      try {
        map.addLayer(
          {
            id: B3D,
            type: 'fill-extrusion',
            source: 'composite',
            'source-layer': 'building',
            minzoom: 13,
            paint: {
              'fill-extrusion-color': '#3a4653',
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'min_height'],
              'fill-extrusion-opacity': 0.85,
            },
          },
          map.getLayer('route-glow') ? 'route-glow' : undefined,
        )
      } catch {
        /* custom style ohne composite-Quelle — dann eben flach */
      }
    } else if (!buildings3d && map.getLayer(B3D)) {
      map.removeLayer(B3D)
    }
  }, [buildings3d, loaded, route])

  // --- sun boost: road brightness follows the toggle ---
  useEffect(() => {
    const map = mapRef.current
    if (map && loaded) applyRoadBrightness(map, sunBoost)
  }, [sunBoost, loaded])

  // --- neon route line ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded || !route) return
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'Feature', geometry: route, properties: {} },
    })
    map.addLayer({
      id: 'route-glow',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#1f51ff',
        'line-width': 18,
        'line-blur': 12,
        'line-opacity': sunBoost ? 0.85 : 0.7,
      },
    })
    map.addLayer({
      id: 'route-core',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': sunBoost ? '#7aa9ff' : '#4d8dff', 'line-width': sunBoost ? 7 : 5 },
    })
    return () => {
      if (!map.getStyle()) return
      if (map.getLayer('route-core')) map.removeLayer('route-core')
      if (map.getLayer('route-glow')) map.removeLayer('route-glow')
      if (map.getSource('route')) map.removeSource('route')
    }
  }, [route, loaded, sunBoost])

  // --- checkpoint pins ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    for (const [i, cp] of checkpoints.entries()) {
      const el = document.createElement('div')
      el.className = 'cp-marker'
      el.title = cp.name
      el.textContent = stopIcon(cp.kind, i === checkpoints.length - 1)
      cpMarkersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([cp.lng, cp.lat]).addTo(map))
    }
    return () => {
      cpMarkersRef.current.forEach((m) => m.remove())
      cpMarkersRef.current = []
    }
  }, [checkpoints, loaded])

  // --- car markers: sync targets with props ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    const seen = new Set<string>()
    for (const car of cars) {
      seen.add(car.userId)
      const wantAvatar = showAvatars && !!car.avatar
      let entry = carsRef.current.get(car.userId)
      // Variante gewechselt (Modus-Toggle oder Avatar kam nach) → neu bauen
      if (entry && entry.isAvatar !== wantAvatar) {
        entry.arrowMarker.remove()
        entry.labelMarker?.remove()
        carsRef.current.delete(car.userId)
        entry = undefined
      }
      if (!entry) {
        const { arrowRoot, labelEl } = buildCarElements(car, wantAvatar)
        const arrowMarker = new mapboxgl.Marker(
          wantAvatar
            ? { element: arrowRoot, anchor: 'center' }
            : { element: arrowRoot, anchor: 'center', pitchAlignment: 'map', rotationAlignment: 'map' },
        )
          .setLngLat([car.lng, car.lat])
          .addTo(map)
        const labelMarker = labelEl
          ? new mapboxgl.Marker({ element: labelEl, anchor: 'top', offset: [0, 14] })
              .setLngLat([car.lng, car.lat])
              .addTo(map)
          : null
        entry = {
          arrowMarker,
          isAvatar: wantAvatar,
          labelMarker,
          arrowRoot,
          labelEl,
          cur: { lat: car.lat, lng: car.lng },
          target: { lat: car.lat, lng: car.lng },
          heading: car.heading ?? 0,
        }
        carsRef.current.set(car.userId, entry)
      }
      entry.target = { lat: car.lat, lng: car.lng }
      entry.arrowRoot.classList.toggle('car-stale', car.stale)
      entry.labelEl?.classList.toggle('car-stale', car.stale)
      if (car.heading !== null) entry.heading = car.heading
    }
    for (const [id, entry] of carsRef.current) {
      if (!seen.has(id)) {
        entry.arrowMarker.remove()
        entry.labelMarker?.remove()
        carsRef.current.delete(id)
      }
    }
  }, [cars, loaded, showAvatars])

  // --- animation loop: glide markers toward targets, follow self ---
  useEffect(() => {
    if (!loaded) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.2, (now - last) / 1000)
      last = now
      const alpha = 1 - Math.exp(-dt * 2.5)
      for (const entry of carsRef.current.values()) {
        entry.cur.lat += (entry.target.lat - entry.cur.lat) * alpha
        entry.cur.lng += (entry.target.lng - entry.cur.lng) * alpha
        entry.arrowMarker.setLngLat([entry.cur.lng, entry.cur.lat])
        // map-space rotation: mapbox folds bearing/pitch in via the marker transform
        if (!entry.isAvatar) entry.arrowMarker.setRotation(entry.heading)
        entry.labelMarker?.setLngLat([entry.cur.lng, entry.cur.lat])
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [loaded])

  // --- spectate: alles im Bild halten; Interaktion pausiert das Framing kurz ---
  useEffect(() => {
    if (!spectate || !loaded) return
    const fit = () => {
      const map = mapRef.current
      if (!map || !followRef.current) return
      const pts: [number, number][] = [...carsRef.current.values()].map((e) => [e.target.lng, e.target.lat])
      if (pts.length === 0 && route) {
        for (let i = 0; i < route.coordinates.length; i += Math.max(1, Math.floor(route.coordinates.length / 50))) {
          pts.push(route.coordinates[i] as [number, number])
        }
      }
      if (pts.length === 0) return
      const bounds = new mapboxgl.LngLatBounds(pts[0]!, pts[0]!)
      for (const p of pts) bounds.extend(p)
      map.fitBounds(bounds, { padding: 70, maxZoom: 14, pitch: 0, bearing: 0, duration: 1000 })
    }
    fit()
    const id = window.setInterval(fit, 12_000)
    return () => window.clearInterval(id)
  }, [spectate, loaded, route])

  // --- camera follows own car, course-up: your heading is always screen-top.
  // Follow enforces FOLLOW_ZOOM, so manual pan/zoom is fully restored
  // (center, bearing, and zoom) when idle recenter kicks back in.
  const self = cars.find((c) => c.isSelf)
  useEffect(() => {
    if (spectate) return
    const map = mapRef.current
    if (!map || !loaded || !followRef.current || !self) return
    const bearing = self.heading ?? map.getBearing()
    // push own car toward the lower third of the screen so most of the
    // viewport shows the road ahead (course-up: ahead = up)
    const offsetY = map.getContainer().clientHeight * 0.28
    map.easeTo({
      center: [self.lng, self.lat],
      zoom: FOLLOW_ZOOM,
      pitch: FOLLOW_PITCH,
      bearing,
      offset: [0, offsetY],
      duration: 900,
    })
  }, [self?.lat, self?.lng, self?.heading, loaded, follow])

  const showAll = () => {
    const map = mapRef.current
    const entries = [...carsRef.current.values()]
    if (!map || entries.length === 0) return
    const first = entries[0]!
    const bounds = new mapboxgl.LngLatBounds(
      [first.target.lng, first.target.lat],
      [first.target.lng, first.target.lat],
    )
    for (const e of entries) bounds.extend([e.target.lng, e.target.lat])
    followRef.current = false
    setFollow(false)
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = window.setTimeout(() => {
      followRef.current = true
      setFollow(true)
    }, 10_000)
    map.fitBounds(bounds, { padding: 70, maxZoom: 14, bearing: 0, pitch: 0, duration: 800 })
  }

  if (!token) {
    return (
      <div className="map-placeholder">
        Set VITE_MAPBOX_TOKEN in apps/web/.env to enable the map
      </div>
    )
  }

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map-canvas" />
      {!spectate && (
        <button className="overview-btn" onClick={showAll}>
          ⛶ Alle
        </button>
      )}
      {!spectate && !follow && (
        <button className="recenter-btn" onClick={enableFollow}>
          ⌖ Folgen
        </button>
      )}
    </div>
  )
}
