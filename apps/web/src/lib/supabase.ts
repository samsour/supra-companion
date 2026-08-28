import { createClient, type Session } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configured = Boolean(url && anonKey)

export const supabase = createClient(
  url ?? 'https://not-configured.supabase.co',
  anonKey ?? 'not-configured',
)

/** Anonymous session: reuse if present, otherwise sign in anonymously. */
export async function ensureSession(): Promise<Session> {
  const { data } = await supabase.auth.getSession()
  if (data.session) return data.session
  const { data: signed, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  if (!signed.session) throw new Error('anonymous sign-in returned no session')
  return signed.session
}
