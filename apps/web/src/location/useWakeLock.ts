import { useEffect, useState } from 'react'

/**
 * Keep the screen awake while `active` (Drive Mode). Browsers release wake
 * locks when the page is hidden, so we re-acquire on visibilitychange.
 * Everything is best-effort: unsupported browsers just return held=false.
 */
export function useWakeLock(active: boolean): boolean {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    if (!active) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false

    const acquire = async () => {
      try {
        if (!('wakeLock' in navigator)) return
        lock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          await lock.release()
          return
        }
        setHeld(true)
        lock.addEventListener('release', () => setHeld(false))
      } catch {
        setHeld(false)
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      lock?.release().catch(() => {})
      setHeld(false)
    }
  }, [active])

  return held
}
