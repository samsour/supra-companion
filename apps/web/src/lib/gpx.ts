/**
 * GPX-Import: liest Tracks (<trkpt>) oder Routen (<rtept>) als Routenlinie
 * und <wpt>-Einträge als Stopp-Kandidaten. GPX ist der De-facto-Standard —
 * Komoot, Kurviger, Calimoto, Garmin, Outdooractive exportieren es alle.
 */
export interface GpxData {
  coordinates: [number, number][]
  stopps: { name: string; lat: number; lng: number }[]
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
    .map((el) => ({
      name: el.getElementsByTagName('name')[0]?.textContent?.trim() || 'Stopp',
      lng: Number(el.getAttribute('lon')),
      lat: Number(el.getAttribute('lat')),
    }))
    .filter((s) => Number.isFinite(s.lng) && Number.isFinite(s.lat))
  return { coordinates: pts, stopps }
}
