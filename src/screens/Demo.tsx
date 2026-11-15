import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { Header } from '../components/Header'
import { Icon } from '../components/Icon'

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

export function Demo() {
  const frame = useRef<HTMLIFrameElement>(null)
  // The walk-through reads these from the page around it (public/tour/config.js), so the sample flat gets
  // Street View and Reimagine with Fal just like a real project.
  ;(window as unknown as { VEDUTA_TOUR_CONFIG?: Record<string, string> }).VEDUTA_TOUR_CONFIG = {
    MAPS_API_KEY: import.meta.env.VITE_GOOGLE_MAPS_KEY ?? '',
    API_URL: USE_MOCK ? '' : (import.meta.env.VITE_API_URL ?? ''),
  }

  // iPhones can't put a frame full screen, so open the walk-through on its own page there instead
  const fullScreen = () => {
    const el = frame.current
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => window.location.assign('/tour/index.html'))
    else window.location.assign('/tour/index.html')
  }

  return (
    <div className="demo-shell">
      <Header />
      <main className="demo">
        <div className="demo-intro">
          <div>
            <h1 className="demo-title">Demo: a sample flat</h1>
            <p className="demo-text">
              A finished walk-through of a seventh-floor flat in Mayfair, made from its floor plan and listing photos.
              Walk round it in 3D, open the photos in 3D, step out to the street, or redesign a room.
            </p>
          </div>
          <div className="demo-actions">
            <button type="button" className="btn" onClick={fullScreen}>
              <Icon name="expand" size={18} /> Full screen
            </button>
            <Link to="/" className="btn btn-primary">
              Try it with your own plan
            </Link>
          </div>
        </div>
        <iframe ref={frame} className="demo-frame" src="/tour/index.html" title="Walk-through of a sample flat" allow="fullscreen" />
      </main>
    </div>
  )
}
