import { EVENT_POSITION, tripChannel, type LocationSample, type PositionPing } from '@supra/core'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * The convoy's live channel: broadcast own position pings, collect everyone
 * else's latest. Private channel — authorized by the RLS policies on
 * realtime.messages (trip membership).
 */
export function useConvoyChannel(tripId: string, userId: string) {
  const [peers, setPeers] = useState<Record<string, PositionPing>>({})
  const [connected, setConnected] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const queuedRef = useRef<LocationSample | null>(null)

  useEffect(() => {
    const ch = supabase.channel(tripChannel(tripId), {
      config: { private: true, broadcast: { self: false } },
    })
    ch.on('broadcast', { event: EVENT_POSITION }, ({ payload }) => {
      const ping = payload as PositionPing
      if (ping.userId === userId) return
      setPeers((prev) => ({ ...prev, [ping.userId]: ping }))
    })
    ch.subscribe((status) => {
      setConnected(status === 'SUBSCRIBED')
      // deliver the fix that arrived while we were still joining
      if (status === 'SUBSCRIBED' && queuedRef.current) {
        const ping: PositionPing = { ...queuedRef.current, userId }
        queuedRef.current = null
        void ch.send({ type: 'broadcast', event: EVENT_POSITION, payload: ping })
      }
    })
    channelRef.current = ch
    return () => {
      channelRef.current = null
      setConnected(false)
      setPeers({})
      void supabase.removeChannel(ch)
    }
  }, [tripId, userId])

  const publish = useCallback(
    (s: LocationSample) => {
      const ch = channelRef.current
      if (!ch || ch.state !== 'joined') {
        queuedRef.current = s
        return
      }
      const ping: PositionPing = { ...s, userId }
      void ch.send({ type: 'broadcast', event: EVENT_POSITION, payload: ping })
    },
    [userId],
  )

  return { peers, publish, connected }
}
