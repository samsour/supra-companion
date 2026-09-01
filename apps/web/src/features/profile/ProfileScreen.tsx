import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ACCENTS, DEFAULT_ACCENT, applyAccent, isValidAccent } from '../../lib/accent'
import { loadProfile, saveProfile } from '../../lib/api'

const STEPS = ['Dein Name', 'Deine Neonfarbe', 'Dein Auto'] as const

/** Erstes Onboarding und späteres Profil-Bearbeiten (User-Icon im Menü). */
export default function ProfileScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/'
  const [isNew] = useState(() => !loadProfile().handle)
  const [profile, setProfile] = useState(loadProfile)
  const [step, setStep] = useState(0)
  const accent = isValidAccent(profile.accent) ? profile.accent : DEFAULT_ACCENT

  const forward = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))

  const finish = () => {
    const handle = profile.handle.trim()
    if (!handle) {
      setStep(0)
      return
    }
    const p = { ...profile, handle }
    saveProfile(p)
    applyAccent(p.accent)
    navigate(next, { replace: true })
  }

  const submitStep = (e: FormEvent) => {
    e.preventDefault()
    if (step < STEPS.length - 1) forward()
    else finish()
  }

  return (
    <div className="screen">
      <header>
        <div className="eyebrow">{isNew ? 'Willkommen im Konvoi' : 'Profil'}</div>
        <h1 className="display" style={{ fontSize: 34 }}>{STEPS[step]}</h1>
      </header>

      <div className="onb-dots" aria-hidden="true">
        {STEPS.map((s, i) => (
          <span key={s} className={i === step ? 'onb-dot onb-dot-active' : 'onb-dot'} />
        ))}
      </div>

      <form className="card" onSubmit={submitStep}>
        {step === 0 && (
          <div>
            <div className="label">So sehen dich die anderen auf der Karte</div>
            <input
              className="input"
              autoFocus
              placeholder="SAM"
              value={profile.handle}
              onChange={(e) => setProfile({ ...profile, handle: e.target.value })}
            />
          </div>
        )}

        {step === 1 && (
          <>
            <div className="swatch-row">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="swatch"
                  style={{ '--swatch': c } as React.CSSProperties}
                  aria-label={`Akzentfarbe ${c}`}
                  aria-pressed={accent === c}
                  onClick={() => {
                    setProfile({ ...profile, accent: c })
                    applyAccent(c)
                  }}
                />
              ))}
            </div>
            <div className="preview-map" aria-hidden="true">
              <svg viewBox="0 0 320 150" preserveAspectRatio="xMidYMid slice">
                <rect width="320" height="150" fill="#0a0d12" />
                <path d="M-10 118 L330 42" stroke="#39435c" strokeWidth="7" />
                <path d="M52 -10 L96 160" stroke="#2a3345" strokeWidth="5" />
                <path d="M210 -10 L180 160" stroke="#2a3345" strokeWidth="5" />
                <path d="M-10 78 C90 92 200 30 330 70" stroke="#1f51ff" strokeWidth="12" opacity="0.4" />
                <path d="M-10 78 C90 92 200 30 330 70" stroke="#4d8dff" strokeWidth="3.5" />
              </svg>
              <div className="preview-car" style={{ '--car-color': accent } as React.CSSProperties}>
                <div className="car-arrow" style={{ transform: 'rotate(28deg)' }} />
                <div className="car-label">{profile.handle.trim() || 'DU'}</div>
              </div>
            </div>
            <p className="hint" style={{ margin: 0 }}>
              Färbt deine App und deinen Pfeil auf der Konvoi-Karte.
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <div className="label">Auto</div>
              <input
                className="input"
                autoFocus
                placeholder="A90 · Mk4 · Mk3 …"
                value={profile.carModel}
                onChange={(e) => setProfile({ ...profile, carModel: e.target.value })}
              />
            </div>
            <div>
              <div className="label">Lackfarbe</div>
              <input
                className="input"
                placeholder="Renaissance Red"
                value={profile.carColor}
                onChange={(e) => setProfile({ ...profile, carColor: e.target.value })}
              />
            </div>
          </>
        )}

        <div className="btn-row">
          {step > 0 && (
            <button type="button" className="btn" onClick={() => setStep(step - 1)}>
              Zurück
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button className="btn btn-primary" disabled={step === 0 && !profile.handle.trim()}>
              Weiter
            </button>
          ) : (
            <button className="btn btn-primary">Fertig</button>
          )}
        </div>
      </form>
    </div>
  )
}
