import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Header } from '../components/Header'
import { Icon } from '../components/Icon'
import { PhotoThumb } from '../components/PhotoThumb'
import { matchPhotos, startBuild } from '../api/client'
import { resolvedAssignments, useProject } from '../state/ProjectContext'

function useDrop(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false)
  return {
    dragging,
    handlers: {
      onDragOver: (e: DragEvent) => {
        e.preventDefault()
        setDragging(true)
      },
      onDragLeave: () => setDragging(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        setDragging(false)
        onFiles(Array.from(e.dataTransfer.files))
      },
    },
  }
}

const sizeLabel = (bytes: number) => (bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`)

export function Upload() {
  const project = useProject()
  const { floorPlan, photos, address, setFloorPlan, addPhotos, removePhoto, setMatchResult, setJob, setAddress } = project
  const navigate = useNavigate()
  const planInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const planDrop = useDrop((files) => {
    const f = files.find((x) => x.type === 'application/pdf' || x.type.startsWith('image/'))
    if (f) setFloorPlan(f)
  })
  const photoDrop = useDrop(addPhotos)

  async function onContinue() {
    if (!floorPlan) return
    setBusy(true)
    setError(null)
    try {
      const res = await matchPhotos(floorPlan.file, photos.map((p) => ({ id: p.id, file: p.file })))
      setMatchResult(res.projectId, res.plan, res.matches)
      const unsure = res.matches.some((m) => !m.confident)
      if (unsure) {
        navigate('/review')
      } else {
        // Every match is confident: skip Review and go straight to building.
        const assignments = resolvedAssignments(res.matches, {})
        const { jobId } = await startBuild({ projectId: res.projectId, assignments })
        setJob(jobId)
        navigate('/build')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const isImagePlan = floorPlan?.file.type.startsWith('image/')

  return (
    <>
      <Header step={0} />
      <main className="page">
        <h1 className="page-title">Upload your floor plan and photos</h1>
        <p className="lede">
          The floor plan gives us the layout. Your photos tell us what each room looks like. Want to see the result first?{' '}
          <Link to="/demo">Walk through a sample flat</Link>.
        </p>

        <div className="row">
          <div className="col-main">
            <section className="card" aria-labelledby="fp-h">
              <div className="card-head">
                <h2 id="fp-h">Floor plan</h2>
                <span className="pill">Required</span>
              </div>
              <p className="hint">PDF, PNG or JPG. A scan or a phone photo of a printed plan is fine.</p>
              <input
                ref={planInput}
                id="plan-input"
                type="file"
                accept="application/pdf,image/*"
                className="visually-hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) setFloorPlan(f)
                  e.target.value = ''
                }}
              />
              {floorPlan ? (
                <div className="file-row">
                  <div className="file-preview">
                    {isImagePlan ? <img src={floorPlan.url} alt="Floor plan preview" /> : <Icon name="file" size={36} strokeWidth={1.5} />}
                  </div>
                  <div className="file-meta">
                    <div className="name">{floorPlan.file.name}</div>
                    <div className="muted small">
                      {floorPlan.file.type === 'application/pdf' ? 'PDF' : 'Image'} · {sizeLabel(floorPlan.file.size)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn" onClick={() => planInput.current?.click()}>
                      Replace
                    </button>
                    <button type="button" className="btn" aria-label="Remove floor plan" onClick={() => setFloorPlan(null)}>
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <label htmlFor="plan-input" className={planDrop.dragging ? 'dropzone dragging' : 'dropzone'} {...planDrop.handlers}>
                  <Icon name="upload" size={28} />
                  <strong>
                    Drop your floor plan here or <span className="browse">browse</span>
                  </strong>
                  <span className="small">One file</span>
                </label>
              )}
            </section>

            <section className="card" aria-labelledby="ph-h">
              <div className="card-head">
                <h2 id="ph-h">Room photos</h2>
                <span className="muted small">{photos.length} added</span>
              </div>
              <p className="hint">Ideally two or more per room. Rooms with no photos get plain surfaces.</p>
              <label htmlFor="photo-input" className={photoDrop.dragging ? 'dropzone dragging' : 'dropzone'} {...photoDrop.handlers}>
                <Icon name="upload" size={28} />
                <strong>
                  Drop photos here or <span className="browse">browse</span>
                </strong>
                <span className="small">JPG, PNG or HEIC</span>
              </label>
              <input
                id="photo-input"
                type="file"
                multiple
                accept="image/*,.heic,.heif"
                className="visually-hidden"
                onChange={(e) => {
                  addPhotos(Array.from(e.target.files ?? []))
                  e.target.value = ''
                }}
              />
              {photos.length > 0 ? (
                <div className="photo-grid">
                  {photos.map((p) => (
                    <div className="photo-card" key={p.id}>
                      <PhotoThumb url={p.url} alt={p.file.name} />
                      <div className="caption">{p.file.name}</div>
                      <button type="button" className="photo-remove" aria-label={`Remove ${p.file.name}`} onClick={() => removePhoto(p.id)}>
                        <span>
                          <Icon name="x" size={14} strokeWidth={2.5} />
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted small" style={{ margin: '12px 0 0' }}>
                  No photos yet. You can still continue, but every room will be plain.
                </p>
              )}
            </section>

            <section className="card" aria-labelledby="addr-h">
              <div className="card-head">
                <h2 id="addr-h">Address</h2>
                <span className="pill">Optional</span>
              </div>
              <p className="hint">Used for the street view at the start of the walk-through. Leave it blank to skip the street.</p>
              <label htmlFor="address-input" className="visually-hidden">
                Street address
              </label>
              <input
                id="address-input"
                className="text-input"
                type="text"
                autoComplete="street-address"
                placeholder="e.g. 12 Example Road, London"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </section>
          </div>

          <aside className="col-side">
            <section className="card" aria-labelledby="tips-h">
              <h2 id="tips-h" style={{ fontSize: 18, marginBottom: 12 }}>
                For a better model
              </h2>
              <ul className="ticks">
                {['Shoot each room from at least two corners', 'Get the floor and ceiling edges in frame', 'Lights on, curtains open', 'Landscape, held level'].map(
                  (t) => (
                    <li key={t}>
                      <Icon name="check" size={18} strokeWidth={2.5} />
                      {t}
                    </li>
                  ),
                )}
              </ul>
            </section>
            <section className="card-plain" aria-labelledby="next-h">
              <h2 id="next-h" style={{ fontSize: 18, marginBottom: 12 }}>
                What happens next
              </h2>
              <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, color: 'var(--ink-2)' }}>
                <li>We work out which room each photo shows</li>
                <li>You check any we're unsure about</li>
                <li>We build the model</li>
                <li>Explore it, walk through it, download it or share a link</li>
              </ol>
            </section>
          </aside>
        </div>

        {error && (
          <div className="error" role="alert">
            <Icon name="alert" />
            {error}
          </div>
        )}

        <div className="actions">
          <p className="muted small" style={{ margin: 0 }}>
            {floorPlan ? 'Next: we match each photo to a room for you.' : 'Add a floor plan to continue.'}
          </p>
          <button type="button" className="btn btn-primary btn-lg" disabled={!floorPlan || busy} onClick={onContinue}>
            Continue
            <Icon name="arrowRight" />
          </button>
        </div>
      </main>

      {busy && (
        <div className="overlay" role="status" aria-live="polite">
          <div className="overlay-card">
            <Spinner />
            <div>
              <div style={{ fontWeight: 600 }}>Matching photos to rooms…</div>
              <div className="muted small">Reading your floor plan and looking at each photo</div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function Spinner({ size = 26 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={2.5} aria-hidden="true">
      <circle cx="12" cy="12" r="9" style={{ stroke: 'var(--accent-fill)' }} />
      <path d="M12 3a9 9 0 0 1 9 9" style={{ stroke: 'var(--accent)' }} strokeLinecap="round" />
    </svg>
  )
}
