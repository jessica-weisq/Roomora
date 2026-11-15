import type { Plan } from '../api/types'

/**
 * Join rooms up: neighbours meet at their shared walls, and edges that nearly line up are lined up.
 * Room boxes from the vision model sit just inside each room's walls, so rooms either side of a wall come out
 * a wall's thickness apart and float as separate boxes. Same rules as the backend's core/plan_tidy.py.
 */
const GAP = 0.6
const ALIGN = 0.25
const MIN_SIZE = 0.5

export function tidyPlan(plan: Plan): Plan {
  return tidyPlanWithShift(plan).plan
}

/** The joined-up plan, and how far its origin moved: tidied = original − shift (so a model built on the original lines up). */
export function tidyPlanWithShift(plan: Plan): { plan: Plan; shift: [number, number] } {
  const rooms = plan.rooms
  if (rooms.length < 2) return { plan, shift: [0, 0] }
  const boxes = rooms.map((r) => [r.x, r.y, r.x + r.width, r.y + r.depth])
  const original = boxes.map((b) => b.slice())

  // 1. neighbours either side of a wall meet in its middle
  for (const axis of [0, 1]) {
    const lo = axis, hi = axis + 2, olo = 1 - axis, ohi = 3 - axis
    for (const a of boxes)
      for (const b of boxes) {
        if (a === b) continue
        const gap = b[lo] - a[hi]
        const along = Math.min(a[ohi], b[ohi]) - Math.max(a[olo], b[olo])
        if (gap >= -0.2 && gap <= GAP && along >= 0.3) a[hi] = b[lo] = (a[hi] + b[lo]) / 2
      }
  }

  // 2. edges that nearly line up are lined up, weighted by edge length
  for (const axis of [0, 1]) {
    const edges: { v: number; len: number; b: number[]; k: number }[] = []
    for (const b of boxes) {
      const len = b[3 - axis] - b[1 - axis]
      edges.push({ v: b[axis], len, b, k: axis }, { v: b[axis + 2], len, b, k: axis + 2 })
    }
    edges.sort((p, q) => p.v - q.v)
    let group: typeof edges = []
    const flush = () => {
      if (group.length > 1) {
        const total = group.reduce((s, e) => s + e.len, 0) || 1
        const mean = group.reduce((s, e) => s + e.v * e.len, 0) / total
        for (const e of group) e.b[e.k] = mean
      }
    }
    for (const e of edges) {
      if (!group.length || e.v - group[0].v <= ALIGN) group.push(e)
      else { flush(); group = [e] }
    }
    flush()
  }

  boxes.forEach((b, i) => {
    if (b[2] - b[0] < MIN_SIZE || b[3] - b[1] < MIN_SIZE) boxes[i] = original[i]
  })
  const ox = Math.min(...boxes.map((b) => b[0])), oy = Math.min(...boxes.map((b) => b[1]))
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  const out = rooms.map((r, i) => {
    const b = boxes[i]
    return { ...r, x: r3(b[0] - ox), y: r3(b[1] - oy), width: r3(b[2] - b[0]), depth: r3(b[3] - b[1]) }
  })
  // fixtures drawn on the plan move with its origin
  const fixtures = plan.fixtures?.map((f) => (f.x != null && f.y != null ? { ...f, x: r3(f.x - ox), y: r3(f.y - oy) } : f))
  return {
    plan: { ...plan, rooms: out, ...(fixtures ? { fixtures } : {}), width: r3(Math.max(...out.map((r) => r.x + r.width))), depth: r3(Math.max(...out.map((r) => r.y + r.depth))) },
    shift: [ox, oy],
  }
}
