// The contract between the UI and the backend.
// Coordinates are in metres on the floor plan: x to the right, y down the page.

export interface Room {
  id: string
  name: string
  x: number
  y: number
  width: number
  depth: number
}

export interface Plan {
  width: number
  depth: number
  rooms: Room[]
}

export interface PhotoMatch {
  photoId: string
  /** The model's best guess. null if it has no idea. */
  roomId: string | null
  /** false → the photo is shown on the Review screen. */
  confident: boolean
  /** Rooms it could be, best first. Only needed when confident is false. */
  candidates?: string[]
  /** One short sentence shown to the user, e.g. "Could be either bedroom." */
  reason?: string
}

export interface MatchResponse {
  /** Identifies the uploaded files on the server for the build step. */
  projectId: string
  plan: Plan
  matches: PhotoMatch[]
}

export interface BuildRequest {
  projectId: string
  /** photoId → roomId, or "skip" for a photo that isn't of this property. */
  assignments: Record<string, string>
}

export type BuildState = 'running' | 'done' | 'failed'

export interface BuildStatus {
  jobId: string
  state: BuildState
  /** Index into BUILD_STEPS of the step in progress (= BUILD_STEPS.length when done). */
  step: number
  /** URL of the finished .glb. Optional: without it the viewer draws the plan as a simple 3D model. */
  modelUrl?: string
  /**
   * Optional 360° views, roomId → URL of a 2:1 equirectangular image (e.g. from fal-ai/hunyuan_world).
   * These are AI-generated from one photo, and the UI labels them as such.
   */
  panoramas?: Record<string, string>
  error?: string
}

export const BUILD_STEPS: { label: string; detail: string }[] = [
  { label: 'Reading the floor plan', detail: 'Finding walls, doors and windows' },
  { label: 'Finding rooms', detail: 'Naming each room and measuring it' },
  { label: 'Placing photos in rooms', detail: 'Lining each photo up with its walls' },
  { label: 'Building walls and floors', detail: 'Raising walls to ceiling height' },
  { label: 'Applying textures from your photos', detail: 'Projecting photos onto walls and floors' },
  { label: 'Creating 360° views', detail: 'Generating a panorama for each room' },
  { label: 'Final checks', detail: 'Looking for gaps and stretched textures' },
]
