import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Header } from '../components/Header'
import { Icon } from '../components/Icon'
import { PhotoThumb } from '../components/PhotoThumb'
import { FloorPlan } from '../components/FloorPlan'
import { startBuild } from '../api/client'
import { resolvedAssignments, useProject } from '../state/ProjectContext'

export function Review() {
  const { plan, matches, photos, assignments, assign, projectId, setJob } = useProject()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const photoById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])

  if (!plan || !projectId) return <Navigate to="/" replace />

  const roomName = (id: string) => (id === 'skip' ? 'Not in this property' : plan.rooms.find((r) => r.id === id)?.name ?? id)
  const flagged = matches.filter((m) => !m.confident)
  const open = flagged.filter((m) => !assignments[m.photoId]).length
  const total = matches.length

  const counts: Record<string, number> = {}
  for (const m of matches) {
    const r = assignments[m.photoId]
    if (r && r !== 'skip') counts[r] = (counts[r] ?? 0) + 1
  }
  const summary = plan.rooms
    .filter((r) => counts[r.id])
    .map((r) => `${r.name} (${counts[r.id]})`)
    .join(' · ')

  async function build() {
    if (!projectId) return
    setBusy(true)
    setError(null)
    try {
      const { jobId } = await startBuild({ projectId, assignments: resolvedAssignments(matches, assignments) })
      setJob(jobId)
      navigate('/build')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the build.')
      setBusy(false)
    }
  }

  const roomOptions = (
    <>
      {plan.rooms.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
      <option value="skip">Not in this property</option>
    </>
  )

  return (
    <>
      <Header step={1} />
      <main className="page">
        <div className="pill-accent">
          <Icon name="check" size={16} strokeWidth={2.5} />
          Matched automatically
        </div>
        <h1 className="page-title">
          {open
            ? `${total - flagged.length} of ${total} photos matched. ${open} ${open === 1 ? 'needs' : 'need'} a quick check.`
            : `All ${total} photos matched`}
        </h1>
        <p className="lede">
          {open ? 'We matched the rest with confidence. Pick the right room below, then we can start building.' : 'Thanks. Everything is ready to build.'}
        </p>

        {flagged.map((m) => {
          const photo = photoById.get(m.photoId)
          const name = photo?.file.name ?? m.photoId
          const chosen = assignments[m.photoId]
          const candidates = m.candidates?.length ? m.candidates : plan.rooms.map((r) => r.id)
          const fills: Record<string, string> = {}
          for (const c of candidates) fills[c] = chosen ? '#FFFFFF' : 'var(--candidate)'
          if (chosen && chosen !== 'skip') fills[chosen] = '#BFD0FB'
          return (
            <section key={m.photoId} className={chosen ? 'card review-card' : 'card review-card open'} aria-label={`Check ${name}`}>
              <div className="review-photo">
                <PhotoThumb url={photo?.url} alt={name} iconSize={36} />
              </div>
              <div className="review-body">
                <div>
                  <h2>Which room is this?</h2>
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    {chosen ? `Set to ${roomName(chosen)}. You can still change it.` : m.reason ?? 'We weren’t sure about this one.'}
                  </p>
                </div>
                <div className="choice-row">
                  <div style={{ width: 200, flex: 'none' }} aria-hidden="true">
                    <FloorPlan plan={plan} fills={fills} labels="short" maxWidth={200} />
                  </div>
                  <div role="group" aria-label="Choose a room" className="choices">
                    {candidates.slice(0, 4).map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={chosen === c ? 'btn btn-lg selected' : 'btn btn-lg'}
                        aria-pressed={chosen === c}
                        onClick={() => assign(m.photoId, c)}
                      >
                        {roomName(c)}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }} className="small muted">
                  <label htmlFor={`other-${m.photoId}`}>Something else?</label>
                  <select
                    id={`other-${m.photoId}`}
                    className="select"
                    value={chosen && !candidates.slice(0, 4).includes(chosen) ? chosen : ''}
                    onChange={(e) => assign(m.photoId, e.target.value)}
                  >
                    <option value="">Choose a room…</option>
                    {roomOptions}
                  </select>
                </div>
              </div>
            </section>
          )
        })}

        <section className="card" style={{ padding: 0, marginTop: 8 }}>
          <button type="button" className="disclosure" aria-expanded={expanded} aria-controls="all-matches" onClick={() => setExpanded(!expanded)}>
            <span>
              <strong>See all matches</strong>
              <span className="muted small"> · {summary}</span>
            </span>
            <Icon name="chevronDown" size={20} />
          </button>
          {expanded && (
            <div id="all-matches" style={{ padding: '0 24px 24px', borderTop: '1px solid var(--line)' }}>
              <p className="muted small" style={{ margin: '16px 0 0' }}>
                Change any match the model got wrong.
              </p>
              <div className="photo-grid">
                {matches.map((m) => {
                  const photo = photoById.get(m.photoId)
                  const name = photo?.file.name ?? m.photoId
                  return (
                    <div className="photo-card" key={m.photoId}>
                      <div style={{ position: 'relative' }}>
                        <PhotoThumb url={photo?.url} alt={name} />
                        {!m.confident && !assignments[m.photoId] && <span className="badge-unsure">Not sure</span>}
                      </div>
                      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label htmlFor={`m-${m.photoId}`} className="small muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {name}
                        </label>
                        <select id={`m-${m.photoId}`} className="select" value={assignments[m.photoId] ?? ''} onChange={(e) => assign(m.photoId, e.target.value)}>
                          <option value="">Not sure yet</option>
                          {roomOptions}
                        </select>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        {error && (
          <div className="error" role="alert">
            <Icon name="alert" />
            {error}
          </div>
        )}

        <div className="actions">
          <Link to="/" className="btn btn-lg">
            <Icon name="arrowLeft" />
            Back
          </Link>
          <div className="actions-right">
            <span className="muted small">{open ? 'Unchecked photos use our best guess.' : 'Ready to build'}</span>
            <button type="button" className="btn btn-primary btn-lg" onClick={build} disabled={busy}>
              Build 3D model
              <Icon name="arrowRight" />
            </button>
          </div>
        </div>
      </main>
    </>
  )
}
