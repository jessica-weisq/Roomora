// A fake backend so the UI works end to end before the real one exists.
// Delete this file (and set VITE_USE_MOCK=false) once the real API is up.

import type { BuildRequest, BuildStatus, MatchResponse, Plan, PhotoMatch } from './types'
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
