/**
 * Google-Maps-Routenlink → Liste der Ziele (Ortsnamen oder Koordinaten).
 * Unterstützt beide Formate:
 *  - Pfad-Stil:  https://www.google.com/maps/dir/Start/Zwischenziel/Ziel/@...
 *  - API-Stil:   https://www.google.com/maps/dir/?api=1&origin=...&destination=...&waypoints=A|B
 * Kurzlinks (maps.app.goo.gl) können im Browser nicht aufgelöst werden (CORS) —
 * dafür gibt es eine erklärende Fehlermeldung.
 */
export function isGoogleMapsLink(text: string): boolean {
  return /^https?:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(
    text.trim(),
  )
}

export function parseGoogleMapsLink(text: string): string[] {
  const raw = text.trim()
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Das sieht nicht nach einem gültigen Link aus')
  }

  if (/(^|\.)goo\.gl$/i.test(url.hostname) || url.hostname === 'maps.app.goo.gl') {
    throw new Error(
      'Kurzlink erkannt — bitte den Link erst im Browser öffnen und die lange Adresse aus der Adresszeile kopieren',
    )
  }

  // API-Stil: ?api=1&origin=…&destination=…&waypoints=A|B
  const origin = url.searchParams.get('origin')
  const destination = url.searchParams.get('destination')
  if (origin && destination) {
    const via = url.searchParams.get('waypoints')?.split('|').filter(Boolean) ?? []
    return [origin, ...via, destination].map((s) => s.trim())
  }

  // Pfad-Stil: /maps/dir/A/B/C/@lat,lng,zoom/data=…
  const dirIdx = url.pathname.indexOf('/dir/')
  if (dirIdx === -1) {
    throw new Error('Kein Routen-Link — bitte in Google Maps eine Route öffnen und deren Link kopieren')
  }
  const segments = url.pathname
    .slice(dirIdx + 5)
    .split('/')
    .filter((s) => s.length > 0 && !s.startsWith('@') && !s.startsWith('data='))
    .map((s) => decodeURIComponent(s.replace(/\+/g, ' ')).trim())
    .filter((s) => s.length > 0)
  if (segments.length < 2) {
    throw new Error('Im Link stecken keine zwei Orte — ist die Route in Google Maps vollständig?')
  }
  return segments
}

const COORD = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/

/** "48.13,11.57" → [lng, lat]; sonst null (dann muss geocodiert werden) */
export function asCoordinate(segment: string): [number, number] | null {
  const m = COORD.exec(segment)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return [lng, lat]
}
