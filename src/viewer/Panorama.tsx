import { useEffect, useRef } from 'react'
import Marzipano from 'marzipano'

/** A drag-to-look-around 360° viewer for one 2:1 equirectangular image. */
export function Panorama({ url, label }: { url: string; label: string }) {
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!el.current) return
    const viewer = new Marzipano.Viewer(el.current, { controls: { mouseViewMode: 'drag' } })
    // The generated panoramas are ~2k wide, so don't let people zoom in far enough to see the blur.
    const limiter = Marzipano.RectilinearView.limit.traditional(2048, (110 * Math.PI) / 180)
    const view = new Marzipano.RectilinearView({ yaw: 0, pitch: 0, fov: (100 * Math.PI) / 180 }, limiter)
    const scene = viewer.createScene({
      source: Marzipano.ImageUrlSource.fromString(url),
      geometry: new Marzipano.EquirectGeometry([{ width: 2048 }]),
      view,
      pinFirstLevel: true,
    })
    scene.switchTo()
    const onResize = () => viewer.updateSize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      viewer.destroy()
    }
  }, [url])

  return <div ref={el} role="img" aria-label={label} className="pano" />
}
