import { useEffect, useRef } from 'react'
import { Icon } from '../components/Icon'
import { Panorama } from './Panorama'

interface Props {
  roomName: string
  url: string
  onClose: () => void
}

/** Full-window 360° view of one room, clearly labelled as AI-generated. */
export function PanoramaDialog({ roomName, url, onClose }: Props) {
  const closeBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previous?.focus()
    }
  }, [onClose])

  return (
    <div className="pano-backdrop" onClick={onClose}>
      <div className="pano-dialog" role="dialog" aria-modal="true" aria-labelledby="pano-title" onClick={(e) => e.stopPropagation()}>
        <div className="pano-head">
          <div style={{ minWidth: 0 }}>
            <h2 id="pano-title">{roomName} · 360° view</h2>
            <div className="ai-badge">
              <Icon name="alert" size={14} />
              AI-generated impression. Parts of the room not in your photo are made up.
            </div>
          </div>
          <button ref={closeBtn} type="button" className="btn btn-icon" aria-label="Close 360° view" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="pano-stage">
          <Panorama url={url} label={`360° view of ${roomName}`} />
        </div>
        <p className="stage-hint">Drag to look around · Scroll to zoom · Esc to close</p>
      </div>
    </div>
  )
}
