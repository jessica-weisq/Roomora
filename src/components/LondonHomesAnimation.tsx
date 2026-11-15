import { useEffect, useRef } from 'react'

/** Plays once on arrival; visitors can pause or replay using the native video controls. */
export function LondonHomesAnimation() {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let started = false
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) video.pause()
      else if (!started && !motion.matches) {
        started = true
        void video.play().catch(() => { /* Manual playback remains available. */ })
      }
    }, { threshold: 0.35 })
    const pauseForReducedMotion = () => { if (motion.matches) video.pause() }
    motion.addEventListener('change', pauseForReducedMotion)
    observer.observe(video)
    return () => {
      observer.disconnect()
      motion.removeEventListener('change', pauseForReducedMotion)
      video.pause()
    }
  }, [])

  return (
    <figure className="london-homes-animation">
      <video
        ref={videoRef}
        width={1200}
        height={960}
        muted
        playsInline
        controls
        preload="none"
        poster="/animations/london-home-lights.jpg"
        aria-label="Animated map of London: approximately 3.88 million homes light up across the city"
        aria-describedby="london-homes-caption"
      >
        <source src="/animations/london-home-lights.mp4" type="video/mp4" />
        <a href="/animations/london-home-lights.mp4">Watch the London homes animation</a>
      </video>
      <figcaption id="london-homes-caption">
        Around 3.88 million homes. Each light represents a property, with illustrative locations distributed within
        boroughs rather than exact addresses.{' '}
        <a href="https://www.gov.uk/government/statistics/council-tax-stock-of-properties-2026" target="_blank" rel="noreferrer">
          Source: Council Tax stock, 8 September 2026
        </a>.
      </figcaption>
    </figure>
  )
}
