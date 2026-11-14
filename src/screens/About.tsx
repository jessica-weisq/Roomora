import { Link } from 'react-router-dom'
import { Header } from '../components/Header'

const STEPS = [
  {
    title: 'Upload a floor plan and photos',
    body: 'A PDF or image of the plan, plus a few photos of each room. Phone photos are fine.',
  },
  {
    title: 'AI reads the plan and sorts the photos',
    body: 'A vision model finds every room on the plan, measures it, and works out which room each photo shows. If it is unsure, it asks you.',
  },
  {
    title: 'Each room is rebuilt in 3D',
    body: 'MASt3R, a 3D reconstruction model, turns the photos of each room into a coloured 3D scan, which we place on the plan at its real size.',
  },
  {
    title: 'Explore it',
    body: 'Orbit around the whole home, click a room to see its photos, open a 360° view, or download the model as a .glb file.',
  },
]

const CREDITS = [
  { name: 'MASt3R', by: 'Naver Labs Europe', note: 'room reconstruction · CC BY-NC-SA 4.0', href: 'https://github.com/naver/mast3r' },
  { name: 'Gemini', by: 'Google', note: 'reading floor plans and matching photos', href: 'https://ai.google.dev' },
  { name: 'HunyuanWorld via fal', by: 'Tencent / fal.ai', note: '360° room impressions', href: 'https://fal.ai' },
  { name: 'three.js', by: 'three.js authors', note: '3D viewer', href: 'https://threejs.org' },
  { name: 'Marzipano', by: 'Google', note: '360° viewer', href: 'https://www.marzipano.net' },
  { name: 'Modal and Netlify', by: '', note: 'GPU backend and hosting', href: '' },
]

export function About() {
  return (
    <>
      <Header />
      <main className="page about">
        <h1 className="page-title">About Roomora</h1>
        <p className="about-lead">
          Roomora turns a floor plan and a handful of room photos into a 3D model of a home that you can look around from
          any device. No 3D scanner, no special camera, no modelling skills.
        </p>

        <section aria-labelledby="how">
          <h2 id="how">How it works</h2>
          <ol className="about-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="about-num">{i + 1}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="why">
          <h2 id="why">Why</h2>
          <p>
            Listing photos show what a room looks like but not how the home fits together. Floor plans show the layout but
            not what it feels like to be there. Roomora puts the two together, so buyers, renters and anyone planning a move
            can understand a place before they visit it.
          </p>
        </section>

        <section aria-labelledby="limits">
          <h2 id="limits">Good to know</h2>
          <ul className="about-list">
            <li>The 3D model is only as good as the photos. Rooms with no photos get plain floors and walls.</li>
            <li>
              The 360° views are <strong>AI-generated impressions</strong>. They are built from a single photo, so most of
              each view is invented and won&rsquo;t match the real room exactly.
            </li>
            <li>
              Roomora is a hackathon prototype. Uploads are processed by third-party AI services, so please don&rsquo;t
              upload photos of a home without the owner&rsquo;s permission, or anything private.
            </li>
          </ul>
        </section>

        <section aria-labelledby="team">
          <h2 id="team">Who made it</h2>
          <p>Originally built by Neev Dhall, Will Robinson and Jessica Wei at Imperial AI Hack 2026 (Imperial College London, 14th-15th November 2026).</p>
        </section>

        <section aria-labelledby="credits">
          <h2 id="credits">Built with</h2>
          <ul className="about-credits">
            {CREDITS.map((c) => (
              <li key={c.name}>
                {c.href ? <a href={c.href} target="_blank" rel="noreferrer">{c.name}</a> : <span>{c.name}</span>}
                {c.by && <span className="about-by"> by {c.by}</span>}
                <span className="about-note"> · {c.note}</span>
              </li>
            ))}
          </ul>
        </section>

        <Link to="/" className="btn btn-primary btn-lg about-cta">
          Try it
        </Link>
      </main>
    </>
  )
}
