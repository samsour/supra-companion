import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { errorMessage } from './lib/errors'
import { configured, ensureSession, supabase } from './lib/supabase'

interface SessionCtx {
  userId: string
}

const Ctx = createContext<SessionCtx | null>(null)

export function useSession(): SessionCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}

function Splash({ msg }: { msg: string }) {
  return (
    <div className="splash">
      <div>
        <div className="display" style={{ fontSize: 28, color: 'var(--amber)' }}>
          Supra Companion
        </div>
        <p>{msg}</p>
      </div>
    </div>
  )
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!configured) return
    ensureSession()
      .then((session) => {
        // private realtime channels authorize with the user's JWT
        supabase.realtime.setAuth(session.access_token)
        setUserId(session.user.id)
      })
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [])

  if (!configured)
    return <Splash msg="Missing configuration — copy apps/web/.env.example to apps/web/.env and fill it in, then restart the dev server." />
  if (error) return <Splash msg={`Sign-in failed: ${error}. Is anonymous sign-in enabled in Supabase?`} />
  if (!userId) return <Splash msg="Connecting…" />
  return <Ctx.Provider value={{ userId }}>{children}</Ctx.Provider>
}
