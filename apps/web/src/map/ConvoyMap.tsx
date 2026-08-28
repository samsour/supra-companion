import type { Checkpoint, RouteGeometry } from '@supra/core'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useEffect, useRef, useState } from 'react'

const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
const style =
  (import.meta.env.VITE_MAPBOX_STYLE as string | undefined) ?? 'mapbox://styles/mapbox/dark-v11'

export interface CarPosition {
  userId: string
  handle: string
  lat: number
  lng: number
  heading: number | null
  isSelf: boolean
  stale: boolean
}

interface Props {
  cars: CarPosition[]
  route: RouteGeometry | null
  checkpoints: Checkpoint[]
}

const PEER_COLORS = ['#35e0f2', '#e653b8', '#7cff6b', '#ffd02e', '#9d7bff', '#ff6b5e']
const colorFor = (userId: string) => {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return PEER_COLORS[h % PEER_COLORS.length]!
}

interface CarMarker {
  marker: mapboxgl.Marker
  root: HTMLDivElement
  arrow: HTMLDivElement
  cur: { lat: number; lng: number }
  target: { lat: number; lng: number }
  heading: number
}

function buildMarkerElement(car: CarPosition): { root: HTMLDivElement; arrow: HTMLDivElement } {
  const root = document.createElement('div')
  root.className = car.isSelf ? 'car-marker car-self' : 'car-marker'
  root.style.setProperty('--car-color', car.isSelf ? '#ffa02e' : colorFor(car.userId))
  const arrow = document.createElement('div')
  arrow.className = 'car-arrow'
  root.append(arrow)
  if (!car.isSelf) {
    // own arrow stays label-free — it's always the amber one
    const label = document.createElement('div')
    label.className = 'car-label'
    label.textContent = car.handle
    root.append(label)
  }
  return { root, arrow }
}

export default function ConvoyMap({ cars, route, checkpoints }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [loaded, setLoaded] = useState(false)
  const carsRef = useRef<Map<string, CarMarker>>(new Map())
  const cpMarkersRef = useRef<mapboxgl.Marker[]>([])
  const [follow, setFollow] = useState(true)
  const followRef = useRef(true)
  const zoomedRef = useRef(false)
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
      paint: { 'line-color': '#35e0f2', 'line-width': 12, 'line-blur': 10, 'line-opacity': 0.55 },
    })
    map.addLayer({
      id: 'route-core',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#b7f6ff', 'line-width': 2.5 },
    })
    return () => {
      if (!map.getStyle()) return
      if (map.getLayer('route-core')) map.removeLayer('route-core')
      if (map.getLayer('route-glow')) map.removeLayer('route-glow')
      if (map.getSource('route')) map.removeSource('route')
    }
  }, [route, loaded])

  // --- checkpoint pins ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    for (const cp of checkpoints) {
      const el = document.createElement('div')
      el.className = 'cp-marker'
      el.title = cp.name
      el.textContent = { fuel: '⛽', food: '🍔', photo: '📸', meet: '🏁' }[cp.kind]
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
      let entry = carsRef.current.get(car.userId)
      if (!entry) {
        const { root, arrow } = buildMarkerElement(car)
        const marker = new mapboxgl.Marker({ element: root, anchor: 'center' })
          .setLngLat([car.lng, car.lat])
          .addTo(map)
        entry = {
          marker,
          root,
          arrow,
          cur: { lat: car.lat, lng: car.lng },
          target: { lat: car.lat, lng: car.lng },
          heading: car.heading ?? 0,
        }
        carsRef.current.set(car.userId, entry)
      }
      entry.target = { lat: car.lat, lng: car.lng }
      entry.root.classList.toggle('car-stale', car.stale)
      if (car.heading !== null) entry.heading = car.heading
    }
    for (const [id, entry] of carsRef.current) {
      if (!seen.has(id)) {
        entry.marker.remove()
        carsRef.current.delete(id)
      }
    }
  }, [cars, loaded])

  // --- animation loop: glide markers toward targets, follow self ---
  useEffect(() => {
    if (!loaded) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.2, (now - last) / 1000)
      last = now
      const alpha = 1 - Math.exp(-dt * 2.5)
      const bearing = mapRef.current?.getBearing() ?? 0
      for (const entry of carsRef.current.values()) {
        entry.cur.lat += (entry.target.lat - entry.cur.lat) * alpha
        entry.cur.lng += (entry.target.lng - entry.cur.lng) * alpha
        entry.marker.setLngLat([entry.cur.lng, entry.cur.lat])
        // arrows show true heading regardless of map rotation (course-up mode)
        entry.arrow.style.transform = `rotate(${entry.heading - bearing}deg)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [loaded])

  // --- camera follows own car, course-up: your heading is always screen-top ---
  const self = cars.find((c) => c.isSelf)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded || !followRef.current || !self) return
    const bearing = self.heading ?? map.getBearing()
    if (!zoomedRef.current) {
      zoomedRef.current = true
      map.easeTo({ center: [self.lng, self.lat], zoom: 14, bearing, duration: 1200 })
    } else {
      map.easeTo({ center: [self.lng, self.lat], bearing, duration: 900 })
    }
  }, [self?.lat, self?.lng, self?.heading, loaded, follow])

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
      {!follow && (
        <button className="recenter-btn" onClick={enableFollow}>
          ⌖ Follow
        </button>
      )}
    </div>
  )
}
