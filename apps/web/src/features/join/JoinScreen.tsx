import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { createTrip, joinTrip, loadProfile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { statusLabel } from '../../lib/labels'
import { canPromptInstall, getPlatform, isStandalone, promptInstall } from '../../lib/pwaInstall'
import { forgetTrip, loadRecentTrips } from '../../lib/recentTrips'

const INSTALL_HINT_KEY = 'supra.install-hint-dismissed'

/** Hinweis + Anleitung, wenn die App im Browser statt vom Homescreen läuft. */
function InstallHint() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(INSTALL_HINT_KEY) === '1'
    } catch {
      return true
    }
  })
  const [installed, setInstalled] = useState(isStandalone)
  const platform = getPlatform()

  useEffect(() => {
    const onInstalled = () => setInstalled(true)
    window.addEventListener('appinstalled', onInstalled)
    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])

  if (installed || dismissed || platform === 'other') return null

  const dismiss = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem(INSTALL_HINT_KEY, '1')
    } catch {
      /* egal */
    }
  }

  return (
    <div className="card install-hint">
      <div className="row">
        <span className="label">📲 Als App installieren — Vollbild, eigenes Icon, ein Tap</span>
        <button className="icon-btn" aria-label="Hinweis schließen" onClick={dismiss}>✕</button>
      </div>
      {platform === 'ios' ? (
        <ol className="install-steps">
          <li>Diese Seite in <strong>Safari</strong> öffnen (falls du gerade woanders bist)</li>
          <li>Teilen-Symbol antippen (Viereck mit Pfeil nach oben)</li>
          <li><strong>„Zum Home-Bildschirm“</strong> wählen</li>
          <li>Ab jetzt immer vom Homescreen starten</li>
        </ol>
      ) : canPromptInstall() ? (
        <button
          className="btn btn-primary"
          onClick={() => {
            void promptInstall().then((ok) => {
              if (ok) setInstalled(true)
            })
          }}
        >
          Jetzt installieren
        </button>
      ) : (
        <ol className="install-steps">
          <li><strong>Chrome-Menü</strong> (⋮ oben rechts) öffnen</li>
          <li><strong>„App installieren“</strong> bzw. „Zum Startbildschirm hinzufügen“ wählen</li>
          <li>Ab jetzt immer vom Homescreen starten</li>
        </ol>
      )}
    </div>
  )
}

type Mode = 'join' | 'create'

/** Hauptmenü: Trip beitreten / erstellen + zuletzt besuchte Trips.
 *  Ohne lokales Profil geht es erst durchs Onboarding (/profile). */
export default function JoinScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const { code: codeParam } = useParams<{ code?: string }>()
  const [mode, setMode] = useState<Mode>('join')
  const [tripName, setTripName] = useState('')
  const [code, setCode] = useState(() => codeParam?.toUpperCase() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState(loadRecentTrips)
  // Bestandsnutzer auf das neue Profilbild hinweisen (einmalig, wegklickbar)
  const [avatarHintDismissed, setAvatarHintDismissed] = useState(() => {
    try {
      return localStorage.getItem('supra.avatar-hint') === '1'
    } catch {
      return true
    }
  })
  const profileNow = loadProfile()
  const dismissAvatarHint = () => {
    setAvatarHintDismissed(true)
    try {
      localStorage.setItem('supra.avatar-hint', '1')
    } catch {
      /* egal */
    }
  }

  useEffect(() => {
    if (!loadProfile().handle) {
      navigate(`/profile?next=${encodeURIComponent(location.pathname)}`, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const profile = loadProfile()
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
      <header className="row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow">Roadtrip-Begleiter</div>
          <h1 className="display">
            Supra <span className="glow">Companion</span>
          </h1>
        </div>
        <button className="user-chip-wrap" aria-label="Profil bearbeiten" onClick={() => navigate('/profile')}>
          <span className="user-chip">
            {profileNow.avatar ? <img src={profileNow.avatar} alt="" /> : '▲'}
          </span>
          <span className="user-chip-label">Profil</span>
        </button>
      </header>

      <InstallHint />

      {profileNow.handle && !profileNow.avatar && !avatarHintDismissed && (
        <div className="card install-hint">
          <div className="row">
            <span className="label">📸 Neu: Profilbild — dein Foto statt Pfeil im Fancy-Modus</span>
            <button className="icon-btn" aria-label="Hinweis schließen" onClick={dismissAvatarHint}>✕</button>
          </div>
          <button className="btn" onClick={() => navigate('/profile')}>Foto hinzufügen</button>
        </div>
      )}

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

        {error && <div className="notice">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Moment…' : mode === 'create' ? 'Trip erstellen' : 'Beitreten'}
        </button>
      </form>
    </div>
  )
}
