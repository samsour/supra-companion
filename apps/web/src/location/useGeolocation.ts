import type { LocationSample } from '@supra/core'
import { useEffect, useRef, useState } from 'react'

/**
 * Watch the device GPS. `onSample` fires for every fix (stable across renders
 * via ref, so callers may pass inline closures).
 */
export function useGeolocation(onSample: (s: LocationSample) => void) {
  const [latest, setLatest] = useState<LocationSample | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cbRef = useRef(onSample)
  cbRef.current = onSample

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setError('This browser has no geolocation support.')
      return
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const s: LocationSample = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speedMps: pos.coords.speed,
          heading: pos.coords.heading,
          accuracyM: pos.coords.accuracy,
          ts: pos.timestamp,
        }
        setLatest(s)
        setError(null)
        cbRef.current(s)
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  return { latest, error }
}
