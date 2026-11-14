import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PhotoMatch, Plan } from '../api/types'

export interface Photo {
  id: string
  file: File
  url: string
}

export interface FloorPlanFile {
  file: File
  url: string
}

interface ProjectState {
  floorPlan: FloorPlanFile | null
  photos: Photo[]
  projectId: string | null
  plan: Plan | null
  matches: PhotoMatch[]
  /** photoId → roomId ("" = not decided, "skip" = not this property) */
  assignments: Record<string, string>
  jobId: string | null
  modelUrl: string | null
}

interface ProjectApi extends ProjectState {
  setFloorPlan: (file: File | null) => void
  addPhotos: (files: File[]) => void
  removePhoto: (id: string) => void
  setMatchResult: (projectId: string, plan: Plan, matches: PhotoMatch[]) => void
  assign: (photoId: string, roomId: string) => void
  setJob: (jobId: string | null) => void
  setModelUrl: (url: string | null) => void
  reset: () => void
}

const empty: ProjectState = {
  floorPlan: null,
  photos: [],
  projectId: null,
  plan: null,
  matches: [],
  assignments: {},
  jobId: null,
  modelUrl: null,
}

const Ctx = createContext<ProjectApi | null>(null)

let counter = 0
const newId = () => `photo-${Date.now().toString(36)}-${(counter++).toString(36)}`

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProjectState>(empty)

  const setFloorPlan = useCallback((file: File | null) => {
    setState((s) => {
      if (s.floorPlan) URL.revokeObjectURL(s.floorPlan.url)
      return { ...s, floorPlan: file ? { file, url: URL.createObjectURL(file) } : null, plan: null, matches: [] }
    })
  }, [])

  const addPhotos = useCallback((files: File[]) => {
    const added = files
      .filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
      .map((file) => ({ id: newId(), file, url: URL.createObjectURL(file) }))
    setState((s) => ({ ...s, photos: [...s.photos, ...added], plan: null, matches: [] }))
  }, [])

  const removePhoto = useCallback((id: string) => {
    setState((s) => {
      const p = s.photos.find((x) => x.id === id)
      if (p) URL.revokeObjectURL(p.url)
      return { ...s, photos: s.photos.filter((x) => x.id !== id), plan: null, matches: [] }
    })
  }, [])

  const setMatchResult = useCallback((projectId: string, plan: Plan, matches: PhotoMatch[]) => {
    const assignments: Record<string, string> = {}
    for (const m of matches) assignments[m.photoId] = m.confident && m.roomId ? m.roomId : ''
    setState((s) => ({ ...s, projectId, plan, matches, assignments, jobId: null, modelUrl: null }))
  }, [])

  const assign = useCallback((photoId: string, roomId: string) => {
    setState((s) => ({ ...s, assignments: { ...s.assignments, [photoId]: roomId } }))
  }, [])

  const setJob = useCallback((jobId: string | null) => setState((s) => ({ ...s, jobId })), [])
  const setModelUrl = useCallback((modelUrl: string | null) => setState((s) => ({ ...s, modelUrl })), [])

  const reset = useCallback(() => {
    setState((s) => {
      if (s.floorPlan) URL.revokeObjectURL(s.floorPlan.url)
      s.photos.forEach((p) => URL.revokeObjectURL(p.url))
      return empty
    })
  }, [])

  const value = useMemo<ProjectApi>(
    () => ({ ...state, setFloorPlan, addPhotos, removePhoto, setMatchResult, assign, setJob, setModelUrl, reset }),
    [state, setFloorPlan, addPhotos, removePhoto, setMatchResult, assign, setJob, setModelUrl, reset],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useProject(): ProjectApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useProject must be used inside ProjectProvider')
  return v
}

/** Final assignments to send to the build: undecided photos fall back to the model's best guess. */
export function resolvedAssignments(matches: PhotoMatch[], assignments: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of matches) {
    const chosen = assignments[m.photoId]
    const fallback = m.roomId ?? m.candidates?.[0] ?? 'skip'
    out[m.photoId] = chosen || fallback
  }
  return out
}
