import { useCallback, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Header } from '../components/Header'
import { Icon } from '../components/Icon'
import { PhotoThumb } from '../components/PhotoThumb'
import { FloorPlan } from '../components/FloorPlan'
import { ModelScene } from '../viewer/ModelScene'
import type { SceneHandle } from '../viewer/ModelScene'
import { PanoramaDialog } from '../viewer/PanoramaDialog'
import { TourDialog } from '../viewer/TourDialog'
import { downloadGlb } from '../lib/exportGlb'
import { resolvedAssignments, useProject } from '../state/ProjectContext'

export function Viewer() {
  const { plan, matches, assignments, photos, floorPlan, modelUrl, panoramas, reset } = useProject()
  const navigate = useNavigate()
  const [view, setView] = useState<'3d' | 'plan'>('3d')
  const [selected, setSelected] = useState<string | null>(plan?.rooms[0]?.id ?? null)
  const [toast, setToast] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [panoOpen, setPanoOpen] = useState(false)
  const closePano = useCallback(() => setPanoOpen(false), [])
  // undefined = closed; null = open in the main living space; a room id = open in that room
  const [tourRoom, setTourRoom] = useState<string | null | undefined>(undefined)
  const closeTour = useCallback(() => setTourRoom(undefined), [])
  const scene = useRef<SceneHandle>(null)
  const stage = useRef<HTMLElement>(null)
  const labelLayer = useRef<HTMLDivElement>(null)

  const final = useMemo(() => resolvedAssignments(matches, assignments), [matches, assignments])
  const photosByRoom = useMemo(() => {
    const map: Record<string, { id: string; url: string; name: string }[]> = {}
    for (const p of photos) {
      const room = final[p.id]
      if (!room || room === 'skip') continue
      ;(map[room] ??= []).push({ id: p.id, url: p.url, name: p.file.name })
    }
    return map
  }, [photos, final])

  if (!plan) return <Navigate to="/" replace />

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }
  const label = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`
  const current = plan.rooms.find((r) => r.id === selected) ?? plan.rooms[0]
  const currentPhotos = current ? photosByRoom[current.id] ?? [] : []
  const thin = plan.rooms.filter((r) => (photosByRoom[r.id]?.length ?? 0) < 2)
  const title = floorPlan?.file.name.replace(/\.[^.]+$/, '') ?? 'Your property'
  const usedPhotos = Object.values(photosByRoom).reduce((n, list) => n + list.length, 0)

  async function onDownload() {
    if (modelUrl) {
      const a = document.createElement('a')
      a.href = modelUrl
      a.download = 'model.glb'
      a.click()
      return
    }
    const obj = scene.current?.getModel()
    if (!obj) {
      setView('3d')
      flash('Switch to the 3D view, then try again')
      return
    }
    setDownloading(true)
    try {
      await downloadGlb(obj, `${title || 'model'}.glb`)
    } finally {
      setDownloading(false)
    }
  }

  async function onShare() {
    // TODO: once the backend stores models, share a link to this project instead of the current URL.
    try {
      await navigator.clipboard.writeText(window.location.href)
      flash('Link copied')
    } catch {
      flash('Couldn’t copy the link')
    }
  }

  return (
    <>
      <Header
        right={
          <button
            type="button"
            className="btn"
            onClick={() => {
              reset()
              navigate('/')
            }}
          >
            New property
          </button>
        }
      />
      <main className="page" style={{ paddingTop: 32 }}>
        <div className="viewer-head">
          <div style={{ minWidth: 0 }}>
            <div className="muted small">
              {plan.rooms.length} rooms · {label(usedPhotos)}
            </div>
            <h1>{title}</h1>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button type="button" className="btn" onClick={onShare}>
              <Icon name="link" size={16} />
              Share link
            </button>
            <button type="button" className="btn" onClick={onDownload} disabled={downloading}>
              <Icon name="download" size={16} />
              {downloading ? 'Preparing…' : 'Download .glb'}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setTourRoom(null)}>
              <Icon name="walk" size={16} />
              Walk through
            </button>
          </div>
        </div>

        <div className="row">
          <section className="viewer" aria-label="Model viewer" ref={stage}>
            <div className="viewer-toolbar">
              <div role="group" aria-label="View" className="segmented">
                <button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')}>
                  3D
                </button>
                <button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')}>
                  Floor plan
                </button>
              </div>
              <div className="tool-group">
                <button type="button" className="btn btn-icon" aria-label="Zoom in" disabled={view !== '3d'} onClick={() => scene.current?.zoom(0.8)}>
                  <Icon name="plus" />
                </button>
                <button type="button" className="btn btn-icon" aria-label="Zoom out" disabled={view !== '3d'} onClick={() => scene.current?.zoom(1.25)}>
                  <Icon name="minus" />
                </button>
                <button type="button" className="btn btn-icon" aria-label="Reset view" disabled={view !== '3d'} onClick={() => scene.current?.reset()}>
                  <Icon name="reset" />
                </button>
                <button
                  type="button"
                  className="btn btn-icon"
                  aria-label="Full screen"
                  onClick={() => {
                    if (document.fullscreenElement) document.exitFullscreen()
                    else stage.current?.requestFullscreen?.()
                  }}
                >
                  <Icon name="expand" />
                </button>
              </div>
            </div>
            {/* The 3D canvas stays mounted when hidden, so the camera keeps its position. */}
            <div className="stage" hidden={view !== '3d'}>
              <ModelScene plan={plan} modelUrl={modelUrl} selected={selected} onSelect={setSelected} handle={scene} labelLayer={labelLayer} />
              <div ref={labelLayer} className="label-layer" />
            </div>
            {view === 'plan' && (
              <div className="stage stage-plan">
                <FloorPlan
                  plan={plan}
                  maxWidth={560}
                  fills={selected ? { [selected]: 'var(--accent-fill)' } : {}}
                  onSelect={setSelected}
                  ariaLabel="Floor plan. Select a room."
                />
              </div>
            )}
            <p className="stage-hint">
              {view === '3d' ? 'Drag to orbit · Scroll to zoom · Right-drag to pan · Click a room to select it' : 'Click a room to select it'}
            </p>
          </section>

          <aside className="col-side" style={{ flexBasis: 300 }}>
            <section className="card" style={{ padding: 16 }} aria-labelledby="rooms-h">
              <h2 id="rooms-h" style={{ fontSize: 18, margin: '4px 8px 8px' }}>
                Rooms
              </h2>
              <ul className="room-list">
                {plan.rooms.map((r) => {
                  const n = photosByRoom[r.id]?.length ?? 0
                  return (
                    <li key={r.id}>
                      <button type="button" aria-pressed={selected === r.id} onClick={() => setSelected(r.id)}>
                        <span>
                          {r.name}
                          {panoramas[r.id] && <span className="chip-360">360°</span>}
                        </span>
                        <span className={n < 2 ? 'count low' : 'count'}>{label(n)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>

            {current && (
              <section className="card" style={{ padding: 20 }} aria-labelledby="room-h">
                <h2 id="room-h" style={{ fontSize: 18 }}>
                  {current.name}
                </h2>
                <div className="muted small" style={{ marginBottom: 12 }}>
                  {current.width.toFixed(1)} × {current.depth.toFixed(1)} m · {label(currentPhotos.length)}
                </div>
                <button type="button" className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={() => setTourRoom(current.id)}>
                  <Icon name="walk" size={18} />
                  Walk through this room
                </button>
                {panoramas[current.id] && (
                  <button type="button" className="btn btn-primary" style={{ width: '100%', marginBottom: 12 }} onClick={() => setPanoOpen(true)}>
                    <Icon name="pano" size={18} />
                    Open 360° view
                  </button>
                )}
                {currentPhotos.length > 0 ? (
                  <div className="mini-grid">
                    {currentPhotos.map((p) => (
                      <PhotoThumb key={p.id} url={p.url} alt={p.name} ratio="1 / 1" iconSize={18} />
                    ))}
                  </div>
                ) : (
                  <p className="muted small" style={{ margin: 0 }}>
                    No photos of this room, so it has plain surfaces.
                  </p>
                )}
              </section>
            )}

            {thin.length > 0 && (
              <section className="notice" aria-labelledby="issues-h">
                <Icon name="alert" />
                <div>
                  <h2 id="issues-h" style={{ fontSize: 15, fontFamily: 'Inter, system-ui, sans-serif', marginBottom: 2 }}>
                    Could look better
                  </h2>
                  {thin.map((r) => r.name).join(', ')} {thin.length === 1 ? 'has' : 'have'} fewer than two photos. More angles give better
                  textures.
                </div>
              </section>
            )}
          </aside>
        </div>
      </main>
      {panoOpen && current && panoramas[current.id] && (
        <PanoramaDialog roomName={current.name} url={panoramas[current.id]} onClose={closePano} />
      )}
      {tourRoom !== undefined && <TourDialog title={title} startRoom={tourRoom} onClose={closeTour} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  )
}
