// A fake backend so the UI works end to end before the real one exists.
// Delete this file (and set VITE_USE_MOCK=false) once the real API is up.

import type { BuildRequest, BuildStatus, FurnishResponse, MatchResponse, Plan, PhotoMatch } from './types'
import { BUILD_STEPS } from './types'
import { mockPanorama } from './mockPanorama'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const DEMO_PLAN: Plan = {
  width: 10,
  depth: 7,
  rooms: [
    { id: 'living', name: 'Living room', x: 0, y: 0, width: 6, depth: 4 },
    { id: 'kitchen', name: 'Kitchen', x: 6, y: 0, width: 4, depth: 4 },
    { id: 'bed1', name: 'Bedroom 1', x: 0, y: 4, width: 5, depth: 3 },
    { id: 'bath', name: 'Bathroom', x: 5, y: 4, width: 2, depth: 3 },
    { id: 'bed2', name: 'Bedroom 2', x: 7, y: 4, width: 3, depth: 3 },
  ],
}

// Roughly how a person photographs a flat: more of the big rooms.
const SHARE = ['living', 'living', 'living', 'living', 'kitchen', 'kitchen', 'kitchen', 'bed1', 'bed1', 'bath', 'bed2', 'bed2']

export async function mockMatchPhotos(photoIds: string[]): Promise<MatchResponse> {
  await sleep(1400)
  const matches: PhotoMatch[] = photoIds.map((photoId, i) => ({
    photoId,
    roomId: SHARE[Math.floor((i / Math.max(photoIds.length, 1)) * SHARE.length)] ?? 'living',
    confident: true,
  }))
  // Make the last photo ambiguous so the Review screen has something to show.
  if (matches.length >= 2) {
    const last = matches[matches.length - 1]
    last.confident = false
    last.roomId = 'bed2'
    last.candidates = ['bed2', 'bed1']
    last.reason = 'It looks like a bedroom, but it could be either one. Both have one window and similar flooring.'
  }
  return { projectId: 'demo-' + Date.now(), plan: DEMO_PLAN, matches }
}

const jobs = new Map<string, { started: number; rooms: string[]; panoramas?: Record<string, string> }>()

export async function mockStartBuild(req: BuildRequest): Promise<{ jobId: string }> {
  await sleep(300)
  const jobId = req.projectId + '-job'
  // Only rooms that have at least one photo get a 360° view, as with the real pipeline.
  const rooms = [...new Set(Object.values(req.assignments))].filter((r) => r !== 'skip')
  jobs.set(jobId, { started: Date.now(), rooms })
  return { jobId }
}

export async function mockGetBuildStatus(jobId: string): Promise<BuildStatus> {
  await sleep(150)
  const job = jobs.get(jobId)
  const started = job?.started ?? Date.now()
  const step = Math.min(Math.floor((Date.now() - started) / 1500), BUILD_STEPS.length)
  const done = step >= BUILD_STEPS.length
  if (done && job && !job.panoramas) {
    job.panoramas = {}
    for (const id of job.rooms) {
      const i = DEMO_PLAN.rooms.findIndex((r) => r.id === id)
      if (i >= 0) job.panoramas[id] = await mockPanorama(DEMO_PLAN.rooms[i].name, i)
    }
  }
  // No modelUrl: the viewer draws the plan itself.
  return { jobId, state: done ? 'done' : 'running', step, panoramas: done ? job?.panoramas : undefined }
}

// Furniture "seen" in each demo room, so the walk-through's Furnish from photos works without a server.
const DEMO_FURNITURE: Record<string, FurnishResponse> = {
  living: {
    floor: 'oak',
    walls: '#d9d4c7',
    // a picture cut from the middle of the first photo, so the demo shows artwork too
    art: [{ photo: 1, box: [0.38, 0.25, 0.62, 0.55], wall: 'up', at: 0.5, w: 0.7, h: 0.9 }],
    items: [
      { type: 'rug', x: 0.45, y: 0.5, faces: 'down', w: 3.2, d: 2.2, color: '#d9d2c4' },
      { type: 'sofa', x: 0.45, y: 0.78, faces: 'up', len: 2.4, color: '#7d8a99', accent: ['#e2c290', '#f1ede4'] },
      { type: 'armchair', x: 0.2, y: 0.38, faces: 'right', color: '#c9b79c', accent: ['#7d8a99'] },
      { type: 'coffee', x: 0.45, y: 0.5, faces: 'down', w: 1.1, d: 0.6 },
      { type: 'tv', x: 0.45, y: 0.04, faces: 'down' },
      { type: 'plant', x: 0.9, y: 0.12, faces: 'down' },
    ],
  },
  kitchen: {
    floor: 'tile',
    walls: '#eef0ec',
    items: [
      { type: 'counter', x: 0.5, y: 0.08, faces: 'down', len: 3.4 },
      { type: 'table', x: 0.5, y: 0.62, faces: 'down', w: 1.6, d: 0.9 },
    ],
  },
  bed1: {
    floor: 'carpet',
    walls: '#c9d3cc',
    items: [
      { type: 'bed', x: 0.42, y: 0.38, faces: 'down', w: 1.6, d: 2.1, color: '#a9b4a3' },
      { type: 'nightstand', x: 0.18, y: 0.1, faces: 'down' },
      { type: 'nightstand', x: 0.66, y: 0.1, faces: 'down' },
      { type: 'wardrobe', x: 0.9, y: 0.5, faces: 'left', len: 1.8 },
    ],
  },
  bath: { floor: 'stone', items: [{ type: 'bath', x: 0.5, y: 0.15, faces: 'down', len: 1.6 }, { type: 'vanity', x: 0.5, y: 0.9, faces: 'up', len: 1.0 }] },
  bed2: { floor: 'oak', walls: '#e6d9c9', items: [{ type: 'bed', x: 0.5, y: 0.4, faces: 'down', w: 1.4, d: 2.0, color: '#c7a98f' }, { type: 'desk', x: 0.8, y: 0.88, faces: 'up', w: 1.1 }] },
}

export async function mockFurnishRoom(roomId: string): Promise<FurnishResponse> {
  await sleep(1200)
  return DEMO_FURNITURE[roomId] ?? { floor: null, items: [] }
}
