import { describe, expect, it } from 'vitest'
import { buildRouteIndex } from './geo'
import { computeConvoy } from './gaps'
import type { RouteGeometry } from './types'

// Straight route east along the equator: 0.01° lng ≈ 1113.2 m
const route: RouteGeometry = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [0.01, 0],
    [0.02, 0],
    [0.03, 0],
    [0.04, 0],
  ],
}
const M_PER_001_DEG = 1113.2

describe('computeConvoy', () => {
  const index = buildRouteIndex(route)

  it('orders cars by distance along the route, not straight-line', () => {
    const entries = computeConvoy(index, [
      { userId: 'mid', point: { lat: 0, lng: 0.02 }, speedMps: 30 },
      { userId: 'leader', point: { lat: 0, lng: 0.035 }, speedMps: 30 },
      { userId: 'tail', point: { lat: 0, lng: 0.005 }, speedMps: 30 },
    ])
    expect(entries.map((e) => e.userId)).toEqual(['leader', 'mid', 'tail'])
    expect(entries.map((e) => e.position)).toEqual([1, 2, 3])
  })

  it('measures gaps along the route and converts to time at the chaser speed', () => {
    const entries = computeConvoy(index, [
      { userId: 'p1', point: { lat: 0, lng: 0.03 }, speedMps: 30 },
      { userId: 'p2', point: { lat: 0, lng: 0.01 }, speedMps: 20 },
    ])
    const p2 = entries.find((e) => e.userId === 'p2')!
    expect(p2.gapAheadM!).toBeCloseTo(2 * M_PER_001_DEG, -1)
    expect(p2.gapAheadSec!).toBeCloseTo((2 * M_PER_001_DEG) / 20, 0)
    const p1 = entries.find((e) => e.userId === 'p1')!
    expect(p1.gapAheadM).toBeNull()
    expect(p1.gapBehindM!).toBeCloseTo(2 * M_PER_001_DEG, -1)
  })

  it('flags cars far from the line as off route and excludes them from ordering', () => {
    const entries = computeConvoy(index, [
      { userId: 'ok', point: { lat: 0, lng: 0.02 }, speedMps: 25 },
      // ~0.005° lat ≈ 556 m north of the route
      { userId: 'lost', point: { lat: 0.005, lng: 0.02 }, speedMps: 25 },
    ])
    const lost = entries.find((e) => e.userId === 'lost')!
    expect(lost.offRoute).toBe(true)
    expect(lost.position).toBeNull()
    expect(lost.offRouteM).toBeGreaterThan(250)
    const ok = entries.find((e) => e.userId === 'ok')!
    expect(ok.position).toBe(1)
    expect(ok.gapBehindM).toBeNull()
  })

  it('falls back to convoy average speed when the chaser is stopped', () => {
    const entries = computeConvoy(index, [
      { userId: 'p1', point: { lat: 0, lng: 0.03 }, speedMps: 20 },
      { userId: 'stopped', point: { lat: 0, lng: 0.02 }, speedMps: 0 },
    ])
    const stopped = entries.find((e) => e.userId === 'stopped')!
    expect(stopped.gapAheadSec!).toBeCloseTo(M_PER_001_DEG / 20, 0)
  })
})
