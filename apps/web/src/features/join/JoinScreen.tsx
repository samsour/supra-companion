import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createTrip, joinTrip, loadProfile, saveProfile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { statusLabel } from '../../lib/labels'
import { forgetTrip, loadRecentTrips } from '../../lib/recentTrips'

type Mode = 'join' | 'create'

export default function JoinScreen() {
  const navigate = useNavigate()
  // deep link from a shared invite: /join/CODE prefills the code
  const { code: codeParam } = useParams<{ code?: string }>()
  const [mode, setMode] = useState<Mode>('join')
  const [profile, setProfile] = useState(loadProfile)
  const [tripName, setTripName] = useState('')
  const [code, setCode] = useState(() => codeParam?.toUpperCase() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState(loadRecentTrips)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      saveProfile(profile)
      const tripId =
        mode === 'create' ? await createTrip(tripName, profile) : await joinTrip(code, profile)
      navigate(`/trip/${tripId}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <header>
        <div className="eyebrow">Roadtrip-Begleiter</div>
        <h1 className="display">
          Supra <span className="glow">Companion</span>
        </h1>
      </header>

      {recent.length > 0 && (
        <div className="card">
          <div className="label">Zuletzt dabei</div>
          <div>
            {recent.map((t) => (
              <div className="recent-row" key={t.id}>
                <button className="recent-open" onClick={() => navigate(`/trip/${t.id}`)}>
                  <strong>{t.name}</strong>
                  <span className="car">{statusLabel[t.status]}</span>
                </button>
                <button
                  className="icon-btn icon-btn-danger"
                  aria-label="aus Liste entfernen"
                  onClick={() => {
                    forgetTrip(t.id)
                    setRecent(loadRecentTrips())
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')}>
          Trip beitreten
        </button>
        <button className="tab" role="tab" aria-selected={mode === 'create'} onClick={() => setMode('create')}>
          Trip erstellen
        </button>
      </div>

      <form className="card" onSubmit={submit}>
        {mode === 'join' ? (
          codeParam ? (
            <div className="row">
              <div className="label">Du bist eingeladen · Code</div>
              <span className="display" style={{ fontSize: 20, color: 'var(--cyan)' }}>{code} ✓</span>
            </div>
          ) : (
            <div>
              <div className="label">Einladungscode</div>
              <input
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="6-stelliger Code aus dem Gruppenchat"
                autoCapitalize="characters"
                autoCorrect="off"
                required
              />
            </div>
          )
        ) : (
          <div>
            <div className="label">Trip-Name</div>
            <input
              className="input"
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              placeholder="Alpentour 2026"
              required
            />
          </div>
        )}

        <div>
          <div className="label">Dein Name</div>
          <input
            className="input"
            value={profile.handle}
            onChange={(e) => setProfile({ ...profile, handle: e.target.value })}
            placeholder="SAM"
            required
          />
        </div>
        <div>
          <div className="label">Auto</div>
          <input
            className="input"
            value={profile.carModel}
            onChange={(e) => setProfile({ ...profile, carModel: e.target.value })}
            placeholder="A90 · Mk4 · Mk3 …"
          />
        </div>
        <div>
          <div className="label">Farbe</div>
          <input
            className="input"
            value={profile.carColor}
            onChange={(e) => setProfile({ ...profile, carColor: e.target.value })}
            placeholder="Renaissance Red"
          />
        </div>

        {error && <div className="notice">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Moment…' : mode === 'create' ? 'Trip erstellen' : 'Beitreten'}
        </button>
      </form>
    </div>
  )
}
