// Every call the UI makes to the backend goes through this file.
// With VITE_USE_MOCK unset or "true", it uses ./mock.ts. Set VITE_USE_MOCK=false
// and VITE_API_URL to the real server to switch over. Endpoints are in README.md.

import type { BuildRequest, BuildStatus, MatchResponse } from './types'
import { mockGetBuildStatus, mockMatchPhotos, mockStartBuild } from './mock'

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

/** Upload the floor plan and photos; get back the rooms and a room guess for each photo. */
export async function matchPhotos(floorPlan: File, photos: { id: string; file: File }[]): Promise<MatchResponse> {
  if (USE_MOCK) return mockMatchPhotos(photos.map((p) => p.id))
  const body = new FormData()
  body.append('floorPlan', floorPlan)
  for (const p of photos) body.append('photos', p.file, p.id)
  return json(await fetch(`${API_URL}/match`, { method: 'POST', body }))
}

/** Start building the model with the user's confirmed photo → room assignments. */
export async function startBuild(req: BuildRequest): Promise<{ jobId: string }> {
  if (USE_MOCK) return mockStartBuild(req)
  return json(
    await fetch(`${API_URL}/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }),
  )
}

/** Poll this until state is "done" or "failed". */
export async function getBuildStatus(jobId: string): Promise<BuildStatus> {
  if (USE_MOCK) return mockGetBuildStatus(jobId)
  const status = await json<BuildStatus>(await fetch(`${API_URL}/build/${encodeURIComponent(jobId)}`))
  // Accept a modelUrl relative to the API (e.g. "/model/abc.glb") as well as a full URL.
  if (status.modelUrl) status.modelUrl = new URL(status.modelUrl, new URL(API_URL + '/', window.location.href)).toString()
  return status
}
