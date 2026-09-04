import { useRef, useState, type FormEvent } from 'react'
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
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const accent = isValidAccent(profile.accent) ? profile.accent : DEFAULT_ACCENT

  // --- Zuschneiden: quadratischer Ausschnitt, Pan per Finger, Zoom per Slider ---
  const CROP_V = 260 // Viewport-Kantenlänge in px
  const [crop, setCrop] = useState<{ src: string; nw: number; nh: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const cropImgRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  const kOf = (c: { nw: number; nh: number }, z: number) => Math.max(CROP_V / c.nw, CROP_V / c.nh) * z
  const clampOff = (x: number, y: number, k: number, c: { nw: number; nh: number }) => ({
    x: Math.min(0, Math.max(CROP_V - c.nw * k, x)),
    y: Math.min(0, Math.max(CROP_V - c.nh * k, y)),
  })

  const openCrop = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const src = reader.result as string
      const img = new Image()
      img.onload = () => {
        cropImgRef.current = img
        const c = { src, nw: img.naturalWidth, nh: img.naturalHeight }
        const k = kOf(c, 1)
        setCrop(c)
        setZoom(1)
        setOff({ x: (CROP_V - c.nw * k) / 2, y: (CROP_V - c.nh * k) / 2 })
        setAvatarError(null)
      }
      img.onerror = () => setAvatarError('Bild konnte nicht gelesen werden')
      img.src = src
    }
    reader.readAsDataURL(file)
  }

  const onZoom = (z: number) => {
    if (!crop) return
    const k1 = kOf(crop, zoom)
    const k2 = kOf(crop, z)
    const c = CROP_V / 2
    setOff(clampOff(c - (c - off.x) * (k2 / k1), c - (c - off.y) * (k2 / k1), k2, crop))
    setZoom(z)
  }

  const confirmCrop = () => {
    const img = cropImgRef.current
    if (!crop || !img) return
    const k = kOf(crop, zoom)
    const canvas = document.createElement('canvas')
    canvas.width = 96
    canvas.height = 96
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, -off.x / k, -off.y / k, CROP_V / k, CROP_V / k, 0, 0, 96, 96)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    if (dataUrl.length > 40_000) {
      setAvatarError('Bild zu groß — bitte ein anderes wählen')
    } else {
      setProfile({ ...profile, avatar: dataUrl })
    }
    setCrop(null)
    cropImgRef.current = null
  }

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
          <>
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
            <div className="avatar-row">
              <button
                type="button"
                className="avatar-pick"
                style={{ '--swatch': accent } as React.CSSProperties}
                onClick={() => avatarInputRef.current?.click()}
                aria-label="Profilbild wählen"
              >
                {profile.avatar ? <img src={profile.avatar} alt="" /> : <span>📷</span>}
              </button>
              <div style={{ flex: 1 }}>
                <div className="label">Profilbild (optional)</div>
                <p className="hint" style={{ margin: '2px 0 6px' }}>
                  Erscheint im Fancy-Modus statt des Pfeils auf der Karte.
                </p>
                {profile.avatar && (
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    onClick={() => setProfile({ ...profile, avatar: undefined })}
                  >
                    Entfernen
                  </button>
                )}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) openCrop(f)
                  e.target.value = ''
                }}
              />
            </div>
            {avatarError && <div className="notice">{avatarError}</div>}
          </>
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
                {profile.avatar ? (
                  <div className="car-avatar">
                    <img src={profile.avatar} alt="" />
                  </div>
                ) : (
                  <div className="car-arrow" style={{ transform: 'rotate(28deg)' }} />
                )}
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

        {crop && (
          <div className="crop-overlay">
            <div className="crop-box card">
              <div className="label">Bildausschnitt wählen — ziehen zum Verschieben</div>
              <div
                className="crop-viewport"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  dragRef.current = { px: e.clientX, py: e.clientY, ox: off.x, oy: off.y }
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current
                  if (!d || !crop) return
                  setOff(
                    clampOff(d.ox + (e.clientX - d.px), d.oy + (e.clientY - d.py), kOf(crop, zoom), crop),
                  )
                }}
                onPointerUp={() => {
                  dragRef.current = null
                }}
              >
                <img
                  src={crop.src}
                  alt=""
                  draggable={false}
                  style={{
                    width: crop.nw,
                    height: crop.nh,
                    maxWidth: 'none',
                    transform: `translate(${off.x}px, ${off.y}px) scale(${kOf(crop, zoom) })`,
                    transformOrigin: '0 0',
                  }}
                />
              </div>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => onZoom(Number(e.target.value))}
                aria-label="Zoom"
              />
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => setCrop(null)}>
                  Abbrechen
                </button>
                <button type="button" className="btn btn-primary" onClick={confirmCrop}>
                  Übernehmen
                </button>
              </div>
            </div>
          </div>
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
