import { snapToRoute, type RouteIndex } from './geo'
import { STATIONARY_SPEED_MPS } from './protocol'
import type { LatLng } from './types'

/** Beyond this distance from the route line a car is "off route". */
export const OFF_ROUTE_THRESHOLD_M = 250

export interface ConvoyMemberInput {
  userId: string
  point: LatLng
  speedMps: number | null
}

export interface ConvoyEntry {
  userId: string
  /** P1 = 1 (furthest along the route); null when off route */
  position: number | null
  alongM: number
  offRouteM: number
  offRoute: boolean
  /** meters/seconds to the car directly ahead; null for P1 or off-route cars */
  gapAheadM: number | null
  gapAheadSec: number | null
  /** meters/seconds to the car directly behind; null for last car or off-route cars */
  gapBehindM: number | null
  gapBehindSec: number | null
}

/**
 * Convoy ordering and gaps, measured along the shared route — straight-line
 * distance lies on winding roads. Time gaps use the chasing car's own speed
 * (that's the speed the gap closes at), falling back to the convoy's average
 * moving speed when that car is stopped.
 */
export function computeConvoy(
  index: RouteIndex,
  members: ConvoyMemberInput[],
  offRouteThresholdM: number = OFF_ROUTE_THRESHOLD_M,
): ConvoyEntry[] {
  const snapped = members.map((m) => {
    const fix = snapToRoute(index, m.point)
    return {
      ...m,
      alongM: fix.alongM,
      offRouteM: fix.offRouteM,
      offRoute: fix.offRouteM > offRouteThresholdM,
    }
  })

  const onRoute = snapped
    .filter((m) => !m.offRoute)
    .sort((a, b) => b.alongM - a.alongM)

  const movingSpeeds = onRoute
    .map((m) => m.speedMps)
    .filter((s): s is number => s !== null && s >= STATIONARY_SPEED_MPS)
  const fallbackSpeed =
    movingSpeeds.length > 0
      ? movingSpeeds.reduce((a, b) => a + b, 0) / movingSpeeds.length
      : null

  const timeGap = (meters: number, chaserSpeed: number | null): number | null => {
    const speed =
      chaserSpeed !== null && chaserSpeed >= STATIONARY_SPEED_MPS ? chaserSpeed : fallbackSpeed
    return speed === null ? null : meters / speed
  }

  const entries: ConvoyEntry[] = onRoute.map((m, i) => {
    const ahead = i > 0 ? onRoute[i - 1]! : null
    const behind = i < onRoute.length - 1 ? onRoute[i + 1]! : null
    const gapAheadM = ahead ? ahead.alongM - m.alongM : null
    const gapBehindM = behind ? m.alongM - behind.alongM : null
    return {
      userId: m.userId,
      position: i + 1,
      alongM: m.alongM,
      offRouteM: m.offRouteM,
      offRoute: false,
      gapAheadM,
      gapAheadSec: gapAheadM !== null ? timeGap(gapAheadM, m.speedMps) : null,
      gapBehindM,
      gapBehindSec: gapBehindM !== null ? timeGap(gapBehindM, behind!.speedMps) : null,
    }
  })

  for (const m of snapped.filter((s) => s.offRoute)) {
    entries.push({
      userId: m.userId,
      position: null,
      alongM: m.alongM,
      offRouteM: m.offRouteM,
      offRoute: true,
      gapAheadM: null,
      gapAheadSec: null,
      gapBehindM: null,
      gapBehindSec: null,
    })
  }
  return entries
}
