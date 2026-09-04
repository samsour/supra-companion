import { buildRouteIndex, type Trip, type TripMember } from '@supra/core'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  deleteTrip,
  duplicateTrip,
  finishTrip,
  getMembers,
  getTrip,
  loadProfile,
  renameTrip,
  setTripStatus,
} from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { statusLabel } from '../../lib/labels'
import { forgetTrip, rememberTrip } from '../../lib/recentTrips'
import { useSession } from '../../session'

export default function LobbyScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const { userId } = useSession()
  const navigate = useNavigate()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [members, setMembers] = useState<TripMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const saveName = async () => {
    setEditingName(false)
    const v = nameDraft.trim()
    if (!trip || !v || v === trip.name) return
    try {
      await renameTrip(trip.id, v)
      refresh()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

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
  if (error && !trip) return <div className="screen"><div className="notice">{error}</div></div>
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

  const shareUrl = async (url: string, text: string) => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Supra Companion', text, url })
      } else {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2_500)
      }
    } catch {
      /* share sheet dismissed */
    }
  }

  const share = () => shareUrl(`${window.location.origin}/join/${trip!.inviteCode}`, `Komm mit auf "${trip!.name}"!`)
  const shareWatch = () =>
    shareUrl(
      `${window.location.origin}/watch/${trip!.spectatorCode}`,
      `Schau live zu, wo der Konvoi "${trip!.name}" gerade ist!`,
    )

  const duplicate = async () => {
    if (!window.confirm('Route und Stopps in einen neuen Trip kopieren? Du wirst Organisator der Kopie.')) return
    try {
      const me = members.find((m) => m.userId === userId)
      const profile = loadProfile()
      const newId = await duplicateTrip(tripId, {
        handle: me?.handle ?? profile.handle ?? 'FAHRER',
        carModel: me?.carModel ?? profile.carModel ?? '',
        carColor: me?.carColor ?? profile.carColor ?? '',
      })
      navigate(`/trip/${newId}`)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const remove = async () => {
    if (
      !window.confirm(
        `Trip "${trip?.name}" endgültig löschen? Route, Stopps und alle Statistiken gehen für alle verloren.`,
      )
    )
      return
    try {
      await deleteTrip(tripId)
      forgetTrip(tripId)
      navigate('/')
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
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="eyebrow">Lobby</div>
          {editingName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void saveName()
              }}
            >
              <input
                className="input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void saveName()}
                aria-label="Trip-Name"
                autoFocus
              />
            </form>
          ) : (
            <h1 className="display" style={{ fontSize: 32, margin: 0 }}>
              {trip.name}
              {isOrganizer && (
                <button
                  className="icon-btn"
                  style={{ marginLeft: 10, verticalAlign: 'middle' }}
                  aria-label="Namen bearbeiten"
                  onClick={() => {
                    setNameDraft(trip.name)
                    setEditingName(true)
                  }}
                >
                  ✎
                </button>
              )}
            </h1>
          )}
        </div>
        <span className={trip.status === 'live' ? 'badge badge-live' : 'badge'}>
          {statusLabel[trip.status]}
        </span>
      </header>

      {/* Mitglieder: die eine wichtige Aktion zuerst */}
      {!isOrganizer && trip.status === 'live' && (
        <button className="btn btn-primary" onClick={() => navigate(`/trip/${tripId}/drive`)}>
          Drive Mode starten
        </button>
      )}
      {!isOrganizer && trip.status === 'draft' && (
        <div className="card">
          <p className="hint" style={{ margin: 0 }}>
            Noch nicht gestartet —{' '}
            {members.find((m) => m.role === 'organizer')?.handle ?? 'der Organisator'} gibt das
            Startsignal. Danach erscheint hier „Drive Mode starten“.
          </p>
        </div>
      )}
      {!isOrganizer && trip.status === 'ended' && (
        <button className="btn btn-primary" onClick={() => navigate(`/trip/${tripId}/results`)}>
          Ergebnis ansehen
        </button>
      )}

      {isOrganizer && (
      <div className="card">
        <div className="label">Einladungscode — ab in den Gruppenchat</div>
        <div className="invite-code">{trip.inviteCode}</div>
        <button className="btn" onClick={() => void share()}>
          {copied ? 'Link kopiert ✓' : '🔗 Einladungslink teilen'}
        </button>
        {trip.spectatorCode && (
          <button className="btn" onClick={() => void shareWatch()}>
            👁 Zuschauer-Link teilen
          </button>
        )}
      </div>
      )}

      <div className="card">
        <div className="label">
          Fahrer ({members.filter((m) => m.role !== 'spectator').length})
          {isOrganizer &&
            members.some((m) => m.role === 'spectator') &&
            ` · 👁 ${members.filter((m) => m.role === 'spectator').length} Zuschauer`}
        </div>
        <div>
          {members.filter((m) => m.role !== 'spectator').map((m) => (
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

      {/* Mitglieder: Teilen kompakt in einer Zeile */}
      {!isOrganizer && (
        <div className="card">
          <div className="row">
            <div>
              <div className="label">Einladungscode</div>
              <span
                className="display"
                style={{ fontSize: 22, color: 'var(--cyan)', letterSpacing: '0.1em' }}
              >
                {trip.inviteCode}
              </span>
            </div>
            <span className="cp-row-actions">
              <button className="icon-btn" aria-label="Einladungslink teilen" onClick={() => void share()}>
                🔗
              </button>
              {trip.spectatorCode && (
                <button className="icon-btn" aria-label="Zuschauer-Link teilen" onClick={() => void shareWatch()}>
                  👁
                </button>
              )}
            </span>
          </div>
          {copied && <span className="hint">Link kopiert ✓</span>}
        </div>
      )}

      {isOrganizer && trip.status === 'draft' && (
        <button className="btn btn-primary" onClick={goLive}>Los geht's</button>
      )}
      {isOrganizer && trip.status === 'live' && (
        <>
          <button className="btn btn-primary" onClick={() => navigate(`/trip/${tripId}/drive`)}>
            Drive Mode starten
          </button>
          <button className="btn" onClick={end}>Trip beenden</button>
        </>
      )}
      {isOrganizer && trip.status === 'ended' && (
        <button className="btn btn-primary" onClick={() => navigate(`/trip/${tripId}/results`)}>
          Ergebnis ansehen
        </button>
      )}

      {error && <div className="notice">{error}</div>}

      {isOrganizer ? (
        <>
          <button className="btn" onClick={duplicate}>Trip duplizieren</button>
          <p className="hint" style={{ margin: 0 }}>
            Kopiert Route und Stopps in einen neuen Trip — für Etappen, Vorlagen oder als Backup.
          </p>
        </>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          <button className="linklike" onClick={duplicate}>Trip duplizieren</button> — Route &amp;
          Stopps als eigene Kopie übernehmen.
        </p>
      )}

      {isOrganizer && (
        <button className="btn btn-danger" onClick={remove}>Trip löschen</button>
      )}

      <p className="hint">
        <Link to="/" style={{ color: 'var(--cyan)' }}>← Anderen Trip öffnen</Link>
      </p>
    </div>
  )
}
