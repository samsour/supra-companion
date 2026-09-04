import { EVENT_POSITION, tripChannel, type LocationSample, type PositionPing } from '@supra/core'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isAvatar } from '../lib/avatar'
import { supabase } from '../lib/supabase'

/**
 * The convoy's live channel: broadcast own position pings, collect everyone
 * else's latest. Private channel — authorized by the RLS policies on
 * realtime.messages (trip membership).
 */
export function useConvoyChannel(
  tripId: string,
  userId: string,
  accent?: string,
  role: 'driver' | 'spectator' = 'driver',
  avatar?: string,
) {
  const [peers, setPeers] = useState<Record<string, PositionPing>>({})
  const [connected, setConnected] = useState(false)
  /** Anzahl gerade zuschauender Spectators — via Presence, kostet nur je eine
   *  Nachricht bei Betreten/Verlassen, keinerlei laufende Calls. */
  const [spectators, setSpectators] = useState(0)
  /** Profilbilder der Mitglieder, verteilt über Presence (einmalig je Join) */
  const [avatars, setAvatars] = useState<Record<string, string>>({})
  const channelRef = useRef<RealtimeChannel | null>(null)
  const queuedRef = useRef<LocationSample | null>(null)

  useEffect(() => {
    if (!tripId) return
    const ch = supabase.channel(tripChannel(tripId), {
      config: { private: true, broadcast: { self: false }, presence: { key: userId } },
    })
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ role?: string; avatar?: string }>()
      let n = 0
      const av: Record<string, string> = {}
      for (const [key, metas] of Object.entries(state)) {
        if (metas.some((m) => m.role === 'spectator')) n++
        const a = metas.find((m) => m.avatar)?.avatar
        if (isAvatar(a)) av[key] = a
      }
      setSpectators(n)
      setAvatars(av)
    })
    ch.on('broadcast', { event: EVENT_POSITION }, ({ payload }) => {
      const ping = payload as PositionPing
      if (ping.userId === userId) return
      setPeers((prev) => ({ ...prev, [ping.userId]: ping }))
    })
    ch.subscribe((status) => {
      setConnected(status === 'SUBSCRIBED')
      if (status === 'SUBSCRIBED') void ch.track(avatar ? { role, avatar } : { role })
      // deliver the fix that arrived while we were still joining
      if (status === 'SUBSCRIBED' && queuedRef.current) {
        const ping: PositionPing = { ...queuedRef.current, userId, accent }
        queuedRef.current = null
        void ch.send({ type: 'broadcast', event: EVENT_POSITION, payload: ping })
      }
    })
    channelRef.current = ch
    return () => {
      channelRef.current = null
      setConnected(false)
      setPeers({})
      setSpectators(0)
      setAvatars({})
      void supabase.removeChannel(ch)
    }
  }, [tripId, userId, role, avatar])

  const publish = useCallback(
    (s: LocationSample) => {
      const ch = channelRef.current
      if (!ch || ch.state !== 'joined') {
        queuedRef.current = s
        return
      }
      const ping: PositionPing = { ...s, userId, accent }
      void ch.send({ type: 'broadcast', event: EVENT_POSITION, payload: ping })
    },
    [userId, accent],
  )

  return { peers, publish, connected, spectators, avatars }
}
