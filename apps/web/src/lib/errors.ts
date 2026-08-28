/** Supabase/Postgrest errors are plain objects, not Error instances. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const { message, details, hint } = e as Record<string, unknown>
    const parts = [message, details, hint].filter((p): p is string => typeof p === 'string' && p.length > 0)
    if (parts.length > 0) return parts.join(' — ')
  }
  return String(e)
}
