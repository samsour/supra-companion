/** NFS-Underground-Neonpalette: die Akzentfarbe des Fahrers — themed die
 *  eigene App und färbt den eigenen Pfeil auf den Karten der anderen. */
export const ACCENTS = [
  '#ffa02e', // Amber (Default)
  '#35e0f2', // Cyan
  '#e653b8', // Magenta
  '#7cff6b', // Lime
  '#ffd02e', // Gelb
  '#9d7bff', // Violett
  '#ff4d4d', // Rot
] as const

export const DEFAULT_ACCENT = ACCENTS[0]

export const isValidAccent = (v: unknown): v is string =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

export function applyAccent(hex: string | undefined): void {
  const root = document.documentElement
  if (isValidAccent(hex)) root.style.setProperty('--amber', hex)
  else root.style.removeProperty('--amber')
}
