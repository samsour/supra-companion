import { buildRouteIndex, type Trip, type TripMember } from '@supra/core'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { finishTrip, getMembers, getTrip, setTripStatus } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { statusLabel } from '../../lib/labels'
import { rememberTrip } from '../../lib/recentTrips'
import { useSession } from '../../session'

export default function LobbyScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const { userId } = useSession()
  const navigate = useNavigate()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [members, setMembers] = useState<TripMember[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!tripId) return
    Promise.all([getTrip(tripId), getMembers(tripId)])
      .then(([t, m]) => {
        setTrip(t)
        setMembers(m)
        setError(null)
        rememberTrip(t)
      })
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [tripId])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5_000)
    return () => clearInterval(id)
  }, [refresh])

  if (!tripId) return null
  if (error) return <div className="screen"><div className="notice">{error}</div></div>
  if (!trip) return <div className="splash">Trip wird geladen…</div>

  const isOrganizer = trip.organizerId === userId

  const goLive = async () => {
    try {
      await setTripStatus(tripId, 'live')
      refresh()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const end = async () => {
    if (!window.confirm('Trip für alle beenden und die Statistiken berechnen?')) return
    try {
      await finishTrip(tripId)
      refresh()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="screen">
      <header className="row">
        <div>
          <div className="eyebrow">Lobby</div>
          <h1 className="display" style={{ fontSize: 32 }}>{trip.name}</h1>
        </div>
        <span className={trip.status === 'live' ? 'badge badge-live' : 'badge'}>
          {statusLabel[trip.status]}
        </span>
      </header>

      <div className="card">
        <div className="label">Einladungscode — ab in den Gruppenchat</div>
        <div className="invite-code">{trip.inviteCode}</div>
      </div>

      <div className="card">
        <div className="label">Fahrer ({members.length})</div>
        <div>
          {members.map((m) => (
            <div className="member" key={m.userId}>
              <strong>{m.handle}{m.userId === userId ? ' (du)' : ''}</strong>
              <span className="car">
                {[m.carModel, m.carColor].filter(Boolean).join(' · ') || '—'}
                {m.role === 'organizer' ? ' · Organisator' : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <div className="label">Route</div>
            <div>
              {trip.routeGeojson
                ? `${(buildRouteIndex(trip.routeGeojson).totalM / 1000).toFixed(0)} km geplant`
                : 'Noch keine Route'}
            </div>
          </div>
          {isOrganizer && (
            <button className="btn" style={{ width: 'auto' }} onClick={() => navigate(`/trip/${tripId}/route`)}>
              {trip.routeGeojson ? 'Route bearbeiten' : 'Route planen'}
            </button>
          )}
        </div>
      </div>

      {isOrganizer && trip.status === 'draft' && (
        <button className="btn btn-primary" onClick={goLive}>Los geht's</button>
      )}
      {trip.status === 'live' && (
        <button className="btn btn-primary" onClick={() => navigate(`/trip/${tripId}/drive`)}>
          Drive Mode starten
        </button>
      )}
      {isOrganizer && trip.status === 'live' && (
        <button className="btn" onClick={end}>Trip beenden</button>
      )}
      {trip.status === 'ended' && (
        <button className="btn btn-primary" onClick={() => navigate(`/trip/${tripId}/results`)}>
          Ergebnis ansehen
        </button>
      )}

      <p className="hint">
        <Link to="/" style={{ color: 'var(--cyan)' }}>← Anderen Trip öffnen</Link>
      </p>
    </div>
  )
}
