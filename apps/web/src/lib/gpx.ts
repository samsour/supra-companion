/**
 * GPX-Import: liest Tracks (<trkpt>) oder Routen (<rtept>) als Routenlinie
 * und <wpt>-Einträge als Stopp-Kandidaten. GPX ist der De-facto-Standard —
 * Komoot, Kurviger, Calimoto, Garmin, Outdooractive exportieren es alle.
 */
import type { CheckpointKind } from '@supra/core'

export interface GpxData {
  coordinates: [number, number][]
  stopps: { name: string; kind: CheckpointKind; lat: number; lng: number }[]
}

/** Stopp-Typ aus dem Namen raten — trifft bei GPX-Waypoints erstaunlich oft. */
export function guessStopKind(name: string): CheckpointKind {
  if (/tank|fuel|gas ?station|shell|aral|esso|omv|\bjet\b|avia|agip|raststätte|rasthof/i.test(name)) return 'fuel'
  if (/restaurant|essen|food|burger|pizza|imbiss|caf[eé]|b[äa]cker|gasthof|gasthaus|wirtshaus|grill|mc ?donald|kfc|h[üu]tte/i.test(name)) return 'food'
  if (/foto|photo|aussicht|viewpoint|panorama|blick|spot/i.test(name)) return 'photo'
  return 'meet'
}

export function parseGpx(xml: string, maxPoints = 1500): GpxData {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Keine gültige GPX-Datei')
  }
  const read = (el: Element): [number, number] => [
    Number(el.getAttribute('lon')),
    Number(el.getAttribute('lat')),
  ]
  let pts = [...doc.getElementsByTagName('trkpt')].map(read)
  if (pts.length < 2) pts = [...doc.getElementsByTagName('rtept')].map(read)
  pts = pts.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
  if (pts.length < 2) throw new Error('GPX enthält keinen Track und keine Route')
  if (pts.length > maxPoints) {
    const step = Math.ceil(pts.length / maxPoints)
    pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
  }
  const stopps = [...doc.getElementsByTagName('wpt')]
    .slice(0, 20)
    .map((el) => {
      const name = el.getElementsByTagName('name')[0]?.textContent?.trim() || 'Stopp'
      return {
        name,
        kind: guessStopKind(name),
        lng: Number(el.getAttribute('lon')),
        lat: Number(el.getAttribute('lat')),
      }
    })
    .filter((s) => Number.isFinite(s.lng) && Number.isFinite(s.lat))
  return { coordinates: pts, stopps }
}
