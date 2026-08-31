import { buildRouteIndex, type Trip, type TripMember } from '@supra/core'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { finishTrip, getMembers, getTrip, setTripStatus } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
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
  if (!trip) return <div className="splash">Loading trip…</div>

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
    if (!window.confirm('End the trip for everyone and compute final stats?')) return
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
          <div className="eyebrow">Trip lobby</div>
          <h1 className="display" style={{ fontSize: 32 }}>{trip.name}</h1>
        </div>
        <span className={trip.status === 'live' ? 'badge badge-live' : 'badge'}>{trip.status}</span>
      </header>

      <div className="card">
        <div className="label">Invite code — drop it in the group chat</div>
        <div className="invite-code">{trip.inviteCode}</div>
      </div>

      <div className="card">
        <div className="label">Drivers ({members.length})</div>
        <div>
          {members.map((m) => (
            <div className="member" key={m.userId}>
              <strong>{m.handle}{m.userId === userId ? ' (you)' : ''}</strong>
              <span className="car">
                {[m.carModel, m.carColor].filter(Boolean).join(' · ') || '—'}
                {m.role === 'organizer' ? ' · organizer' : ''}
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
                ? `${(buildRouteIndex(trip.routeGeojson).totalM / 1000).toFixed(0)} km set`
                : 'Not set yet'}
            </div>
          </div>
          {isOrganizer && (
            <button className="btn" style={{ width: 'auto' }} onClick={() => navigate(`/trip/${tripId}/route`)}>
              {trip.routeGeojson ? 'Edit route' : 'Plan route'}
            </button>
          )}
        </div>
      </div>

      {isOrganizer && trip.status === 'draft' && (
        <button className="btn btn-primary" onClick={goLive}>Go live</button>
      )}
      {trip.status === 'live' && (
        <button className="btn btn-primary" onClick={() => navigate(`/trip/${tripId}/drive`)}>
          Enter drive mode
        </button>
      )}
      {isOrganizer && trip.status === 'live' && (
        <button className="btn" onClick={end}>Finish trip</button>
      )}
      {trip.status === 'ended' && (
        <button className="btn btn-primary" onClick={() => navigate(`/trip/${tripId}/results`)}>
          View results
        </button>
      )}

      <p className="hint">
        <Link to="/" style={{ color: 'var(--cyan)' }}>← Join a different trip</Link>
      </p>
    </div>
  )
}
