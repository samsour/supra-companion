import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createTrip, joinTrip, loadProfile, saveProfile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { loadRecentTrips } from '../../lib/recentTrips'

type Mode = 'join' | 'create'

export default function JoinScreen() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('join')
  const [profile, setProfile] = useState(loadProfile)
  const [tripName, setTripName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recent] = useState(loadRecentTrips)

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
        <div className="eyebrow">Convoy companion</div>
        <h1 className="display">
          Supra <span className="glow">Companion</span>
        </h1>
      </header>

      {recent.length > 0 && (
        <div className="card">
          <div className="label">Jump back in</div>
          <div>
            {recent.map((t) => (
              <button className="recent-row" key={t.id} onClick={() => navigate(`/trip/${t.id}`)}>
                <strong>{t.name}</strong>
                <span className="car">{t.status}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')}>
          Join a trip
        </button>
        <button className="tab" role="tab" aria-selected={mode === 'create'} onClick={() => setMode('create')}>
          Create a trip
        </button>
      </div>

      <form className="card" onSubmit={submit}>
        {mode === 'join' ? (
          <div>
            <div className="label">Invite code</div>
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="6-character code from the group chat"
              autoCapitalize="characters"
              autoCorrect="off"
              required
            />
          </div>
        ) : (
          <div>
            <div className="label">Trip name</div>
            <input
              className="input"
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              placeholder="Alpine run 2026"
              required
            />
          </div>
        )}

        <div>
          <div className="label">Your handle</div>
          <input
            className="input"
            value={profile.handle}
            onChange={(e) => setProfile({ ...profile, handle: e.target.value })}
            placeholder="SAM"
            required
          />
        </div>
        <div>
          <div className="label">Car</div>
          <input
            className="input"
            value={profile.carModel}
            onChange={(e) => setProfile({ ...profile, carModel: e.target.value })}
            placeholder="A90 · Mk4 · Mk3 …"
          />
        </div>
        <div>
          <div className="label">Color</div>
          <input
            className="input"
            value={profile.carColor}
            onChange={(e) => setProfile({ ...profile, carColor: e.target.value })}
            placeholder="Renaissance Red"
          />
        </div>

        {error && <div className="notice">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Working…' : mode === 'create' ? 'Create trip' : 'Join trip'}
        </button>
      </form>
    </div>
  )
}
