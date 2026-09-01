import type { Trip, TripMember } from '@supra/core'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getMembers, getTrip, getTripStats, type TripStatsRow } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { useSession } from '../../session'

function fmtMoving(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.round((secs % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`
}

export default function ResultsScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const { userId } = useSession()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [members, setMembers] = useState<TripMember[]>([])
  const [stats, setStats] = useState<TripStatsRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tripId) return
    Promise.all([getTrip(tripId), getMembers(tripId), getTripStats(tripId)])
      .then(([t, m, s]) => {
        setTrip(t)
        setMembers(m)
        setStats([...s].sort((a, b) => b.distanceKm - a.distanceKm))
      })
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [tripId])

  if (!tripId) return null
  const handleOf = (id: string) => members.find((m) => m.userId === id)?.handle ?? id.slice(0, 6)
  const carOf = (id: string) => members.find((m) => m.userId === id)?.carModel ?? ''

  return (
    <div className="screen">
      <header>
        <div className="eyebrow">Ergebnis</div>
        <h1 className="display" style={{ fontSize: 32 }}>{trip?.name ?? '…'}</h1>
      </header>

      {error && <div className="notice">{error}</div>}
      {!error && stats.length === 0 && (
        <div className="card">
          <p className="hint" style={{ margin: 0 }}>
            Noch keine Statistiken — sie werden berechnet, sobald der Organisator den Trip beendet.
          </p>
        </div>
      )}

      {stats.map((s, i) => (
        <div
          className="card"
          key={s.userId}
          style={s.userId === userId ? { borderColor: 'var(--amber)' } : undefined}
        >
          <div className="row">
            <strong className="display" style={{ fontSize: 22 }}>
              <span className="pos-p">P{i + 1}</span> {handleOf(s.userId)}
              {s.userId === userId ? ' (du)' : ''}
            </strong>
            <span className="car">{carOf(s.userId)}</span>
          </div>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Strecke</div>
              <div className="value">{s.distanceKm.toFixed(1)}<small>km</small></div>
            </div>
            <div className="stat">
              <div className="label">Fahrzeit</div>
              <div className="value" style={{ fontSize: 28 }}>{fmtMoving(s.movingSecs)}</div>
            </div>
            <div className="stat">
              <div className="label">Ø Tempo</div>
              <div className="value">{s.avgSpeedKmh != null ? Math.round(s.avgSpeedKmh) : '—'}<small>km/h</small></div>
            </div>
            {s.userId === userId && (
              <div className="stat">
                <div className="label">Topspeed (nur für dich sichtbar)</div>
                <div className="value">{s.topSpeedKmh != null ? Math.round(s.topSpeedKmh) : '—'}<small>km/h</small></div>
              </div>
            )}
          </div>
        </div>
      ))}

      <p className="hint">
        <Link to={`/trip/${tripId}`} style={{ color: 'var(--cyan)' }}>← Zur Lobby</Link>
      </p>
    </div>
  )
}
