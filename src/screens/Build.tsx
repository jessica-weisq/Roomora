import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Header } from '../components/Header'
import { Icon } from '../components/Icon'
import { FloorPlan } from '../components/FloorPlan'
import { Spinner } from './Upload'
import { getBuildStatus } from '../api/client'
import { BUILD_STEPS } from '../api/types'
import type { BuildStatus } from '../api/types'
import { useProject } from '../state/ProjectContext'

const POLL_MS = 1000

export function Build() {
  const { jobId, plan, setModelUrl } = useProject()
  const navigate = useNavigate()
  const [status, setStatus] = useState<BuildStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const s = await getBuildStatus(jobId)
        if (stopped) return
        setStatus(s)
        if (s.state === 'done') {
          setModelUrl(s.modelUrl ?? null)
          return
        }
        if (s.state === 'failed') {
          setError(s.error ?? 'The build failed.')
          return
        }
      } catch (e) {
        if (stopped) return
        setError(e instanceof Error ? e.message : 'Lost contact with the server.')
        return
      }
      timer = setTimeout(poll, POLL_MS)
    }
    poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [jobId, setModelUrl])

  if (!jobId || !plan) return <Navigate to="/" replace />

  const step = status?.step ?? 0
  const done = status?.state === 'done'
  const pct = Math.round((Math.min(step, BUILD_STEPS.length) / BUILD_STEPS.length) * 100)

  // Fill rooms in as the walls step (3) and textures step (4) progress.
  const built = Math.round(plan.rooms.length * Math.max(0, Math.min(1, (step - 3 + 0.5) / 2)))
  const fills: Record<string, string> = {}
  plan.rooms.forEach((r, i) => (fills[r.id] = i < built || done ? 'var(--accent-fill)' : '#FFFFFF'))

  return (
    <>
      <Header step={2} />
      <main className="page">
        <div className="row" style={{ alignItems: 'stretch' }}>
          <section className="card" style={{ flex: '1 1 420px', minWidth: 0, padding: 32 }} aria-labelledby="build-h">
            <h1 id="build-h" style={{ fontSize: 30, lineHeight: 1.15, marginBottom: 6 }}>
              {error ? 'Something went wrong' : done ? 'Your model is ready' : 'Building your model'}
            </h1>
            <p className="muted" style={{ margin: '0 0 20px' }}>
              {error ?? (done ? 'Open it to look around, download it or share a link.' : 'This page updates as each step finishes.')}
            </p>
            <div className="progress" role="progressbar" aria-label="Build progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div style={{ width: `${pct}%` }} />
            </div>
            <ol className="steps" aria-live="polite">
              {BUILD_STEPS.map((s, i) => {
                const state = i < step ? 'done' : i === step && !error ? 'active' : 'pending'
                return (
                  <li key={s.label}>
                    {state === 'done' && (
                      <span className="dot done">
                        <Icon name="check" size={15} strokeWidth={3} />
                      </span>
                    )}
                    {state === 'active' && (
                      <span className="dot">
                        <Spinner />
                      </span>
                    )}
                    {state === 'pending' && <span className="dot pending" />}
                    <div>
                      <div className={state === 'pending' ? 'pending-label' : undefined} style={{ fontWeight: state === 'active' ? 600 : 400 }}>
                        {s.label}
                      </div>
                      {state === 'active' && <div className="muted small">{s.detail}</div>}
                    </div>
                  </li>
                )
              })}
            </ol>
            <div style={{ marginTop: 32, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {done ? (
                <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate('/view')}>
                  Open model
                  <Icon name="arrowRight" />
                </button>
              ) : error ? (
                <Link to="/review" className="btn btn-lg">
                  Back to review
                </Link>
              ) : (
                <Link to="/" className="btn btn-lg">
                  Cancel
                </Link>
              )}
            </div>
          </section>

          <section className="card" style={{ flex: '1 1 420px', minWidth: 0, padding: 32, display: 'flex', flexDirection: 'column' }} aria-labelledby="prev-h">
            <h2 id="prev-h" style={{ fontSize: 20 }}>
              Preview
            </h2>
            <p className="hint" style={{ marginBottom: 20 }}>
              Rooms fill in as they're built.
            </p>
            <div className="preview-box">
              <FloorPlan plan={plan} fills={fills} ariaLabel="Floor plan preview" />
            </div>
          </section>
        </div>
      </main>
    </>
  )
}
