/** Erkennung: läuft die App installiert (Homescreen/PWA) oder im Browser-Tab —
 *  plus Android-Install-Prompt (beforeinstallprompt wird hier früh abgefangen). */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e as BeforeInstallPromptEvent
})

export const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)

export type Platform = 'ios' | 'android' | 'other'

export function getPlatform(): Platform {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  // iPadOS gibt sich als Mac aus, hat aber Touch
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'other'
}

export const canPromptInstall = (): boolean => deferredPrompt !== null

/** Android/Chrome: nativen Install-Dialog öffnen. true = installiert. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false
  const p = deferredPrompt
  deferredPrompt = null
  await p.prompt()
  const choice = await p.userChoice
  return choice.outcome === 'accepted'
}
