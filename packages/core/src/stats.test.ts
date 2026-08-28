import { describe, expect, it } from 'vitest'
import { addSample, emptyTotals, formatGap } from './stats'
import type { LocationSample } from './types'

// ~0.0001° lat ≈ 11.1 m; one sample per second ≈ 11 m/s ≈ 40 km/h
const sample = (i: number, over: Partial<LocationSample> = {}): LocationSample => ({
  lat: i * 0.0001,
  lng: 0,
  speedMps: 11,
  heading: 0,
  accuracyM: 5,
  ts: i * 1000,
  ...over,
})

describe('addSample', () => {
  it('accumulates distance and moving time for a clean drive', () => {
    let t = emptyTotals()
    for (let i = 0; i < 11; i++) t = addSample(t, sample(i))
    expect(t.distanceM).toBeCloseTo(111.2, 0)
    expect(t.movingSecs).toBeCloseTo(10, 5)
    expect(t.maxSpeedMps).toBeCloseTo(11.1, 0)
  })

  it('discards samples with bad accuracy', () => {
    let t = emptyTotals()
    t = addSample(t, sample(0))
    t = addSample(t, sample(1, { accuracyM: 80, lat: 1 })) // wild fix, bad accuracy
    t = addSample(t, sample(2))
    expect(t.distanceM).toBeCloseTo(22.2, 0)
  })

  it('discards teleport jumps but keeps the anchor', () => {
    let t = emptyTotals()
    t = addSample(t, sample(0))
    t = addSample(t, sample(1, { lat: 0.1 })) // ~11 km in 1 s
    expect(t.distanceM).toBe(0)
    t = addSample(t, sample(2))
    expect(t.distanceM).toBeCloseTo(22.2, 0)
  })

  it('does not accumulate stationary GPS drift as distance', () => {
    let t = emptyTotals()
    t = addSample(t, sample(0))
    // 1.1 m drift over 10 s → 0.11 m/s, below the stationary threshold
    t = addSample(t, { ...sample(0), lat: 0.00001, ts: 10_000, speedMps: 0 })
    expect(t.distanceM).toBe(0)
    expect(t.movingSecs).toBe(0)
  })
})

describe('formatGap', () => {
  it('formats race-style gaps', () => {
    expect(formatGap(42)).toBe('+0:42')
    expect(formatGap(78)).toBe('+1:18')
  })
})
