import type { LatLng, RouteGeometry } from './types'

const EARTH_RADIUS_M = 6_371_000
const toRad = (deg: number) => (deg * Math.PI) / 180

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Route polyline with precomputed cumulative distances, so snapping N members
 * every ping stays cheap.
 */
export interface RouteIndex {
  points: LatLng[]
  /** cumulative distance in meters at each point; cum[0] = 0 */
  cum: number[]
  totalM: number
}

export function buildRouteIndex(route: RouteGeometry): RouteIndex {
  const points = route.coordinates.map(([lng, lat]) => ({ lat, lng }))
  const cum: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1]! + haversineMeters(points[i - 1]!, points[i]!))
  }
  return { points, cum, totalM: cum[cum.length - 1] ?? 0 }
}

export interface RouteFix {
  /** distance along the route of the closest point on it, meters */
  alongM: number
  /** distance from the route line, meters */
  offRouteM: number
}

// Local planar projection around a reference latitude — accurate at segment scale.
function toXY(p: LatLng, refLatRad: number): { x: number; y: number } {
  return {
    x: toRad(p.lng) * EARTH_RADIUS_M * Math.cos(refLatRad),
    y: toRad(p.lat) * EARTH_RADIUS_M,
  }
}

/** Snap a position onto the route: closest point across all segments. */
export function snapToRoute(index: RouteIndex, p: LatLng): RouteFix {
  const { points, cum } = index
  if (points.length === 0) return { alongM: 0, offRouteM: Infinity }
  if (points.length === 1) {
    return { alongM: 0, offRouteM: haversineMeters(points[0]!, p) }
  }

  let best: RouteFix = { alongM: 0, offRouteM: Infinity }
  const refLatRad = toRad(p.lat)
  const pt = toXY(p, refLatRad)

  for (let i = 0; i < points.length - 1; i++) {
    const a = toXY(points[i]!, refLatRad)
    const b = toXY(points[i + 1]!, refLatRad)
    const abx = b.x - a.x
    const aby = b.y - a.y
    const lenSq = abx * abx + aby * aby
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / lenSq))
    const proj = { x: a.x + t * abx, y: a.y + t * aby }
    const dist = Math.hypot(pt.x - proj.x, pt.y - proj.y)
    if (dist < best.offRouteM) {
      const segLen = cum[i + 1]! - cum[i]!
      best = { alongM: cum[i]! + t * segLen, offRouteM: dist }
    }
  }
  return best
}
