import { useEffect, useMemo, useRef } from 'react'
import { Icon } from '../components/Icon'
import { depthUrlBase, furnishRoom } from '../api/client'
import { resolvedAssignments, useProject } from '../state/ProjectContext'

interface Props {
  title: string
  /** Room to start in; the tour picks the main living space if this is null */
  startRoom: string | null
  onClose: () => void
}

/**
 * Full-window walk-through of the current project.
 * The tour engine lives in public/tour/ and runs in a frame (it has its own three.js build), on the same
 * origin so it can use this page's photo and floor plan URLs. It says hello, we send the project, and
 * it asks us for furniture when someone uses "Furnish from photos" (we ask the backend through client.ts).
 */
export function TourDialog({ title, startRoom, onClose }: Props) {
  const { projectId, plan, matches, assignments, photos, floorPlan, modelUrl, panoramas, address } = useProject()
  const frame = useRef<HTMLIFrameElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)

  const photosByRoom = useMemo(() => {
    const final = resolvedAssignments(matches, assignments)
    const map: Record<string, { id: string; url: string; name: string }[]> = {}
    for (const p of photos) {
      const room = final[p.id]
      if (!room || room === 'skip') continue
      ;(map[room] ??= []).push({ id: p.id, url: p.url, name: p.file.name })
    }
    return map
  }, [photos, matches, assignments])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.activeElement === closeBtn.current) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previous?.focus()
    }
  }, [onClose])

  useEffect(() => {
    if (!plan) return
    const origin = window.location.origin
    const reply = (id: number, result: unknown, error?: { message: string }) =>
      frame.current?.contentWindow?.postMessage({ type: 'roomora:reply', id, result, error }, origin)

    async function onMessage(e: MessageEvent) {
      if (e.origin !== origin || e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== 'object') return
      const msg = e.data as { type: string; id?: number; roomId?: string }
      if (msg.type === 'roomora:hello') {
        frame.current?.contentWindow?.postMessage(
          {
            type: 'roomora:project',
            project: {
              projectId,
              title,
              address,
              planImage: floorPlan?.url ?? null,
              planIsImage: !!floorPlan?.file.type.startsWith('image/'),
              plan,
              photos: photosByRoom,
              panoramas,
              modelUrl,
              mapsKey: (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined) ?? '',
              depthBase: projectId ? depthUrlBase(projectId) : null,
              startRoom,
            },
          },
          origin,
        )
      }
      if (msg.type === 'roomora:furnish' && msg.id != null && msg.roomId && projectId) {
        const ids = (photosByRoom[msg.roomId] ?? []).map((p) => p.id)
        try {
          reply(msg.id, await furnishRoom(projectId, msg.roomId, ids))
        } catch (err) {
          reply(msg.id, null, { message: err instanceof Error ? err.message : 'Couldn’t analyse the photos just now. Try again.' })
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [plan, projectId, title, address, floorPlan, photosByRoom, panoramas, modelUrl, startRoom])

  return (
    <div className="tour-backdrop" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="tour-bar">
        <h2 id="tour-title">Walk through {title}</h2>
        <span className="muted small tour-help">Move the mouse to look around · W A S D or arrow keys to walk</span>
        <button ref={closeBtn} type="button" className="btn" onClick={onClose}>
          <Icon name="x" size={16} />
          Close
        </button>
      </div>
      <iframe ref={frame} className="tour-frame" src="/tour/index.html?embed=1" title={`Walk-through of ${title}`} allow="fullscreen" />
    </div>
  )
}
