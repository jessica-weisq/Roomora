import type { Plan } from '../api/types'

interface Props {
  plan: Plan
  /** roomId → fill colour */
  fills?: Record<string, string>
  onSelect?: (roomId: string) => void
  /** Extra line under each room name, e.g. "4 photos" */
  sublabels?: Record<string, string>
  /** Show the room name, a short version, or nothing */
  labels?: 'full' | 'short' | 'none'
  maxWidth?: number
  ariaLabel?: string
}

/** "Bedroom 2" → "2"; rooms without a number get no short label. */
const short = (name: string) => name.match(/(\d+)$/)?.[1] ?? ''

/** A 2D floor plan drawn from room rectangles. Click or press Enter on a room to select it. */
export function FloorPlan({ plan, fills = {}, onSelect, sublabels, labels = 'full', maxWidth = 420, ariaLabel }: Props) {
  const pad = 0.08
  const fontSize = Math.max(plan.width, plan.depth) / 28
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${plan.width + pad * 2} ${plan.depth + pad * 2}`}
      style={{ width: '100%', maxWidth, height: 'auto', display: 'block' }}
      role={onSelect ? 'group' : 'img'}
      aria-label={ariaLabel ?? 'Floor plan'}
    >
      {/* big rooms first, so small ones drawn inside them (an en suite in a bedroom's corner) stay on top */}
      {[...plan.rooms].sort((a, b) => b.width * b.depth - a.width * a.depth).map((r) => {
        const interactive = !!onSelect
        const tight = r.width < 2.6
        const label =
          labels === 'full' ? (tight ? r.name.split(' ')[0].slice(0, 4) : r.name) : labels === 'short' ? short(r.name) : ''
        return (
          <g
            key={r.id}
            className={interactive ? 'plan-room interactive' : 'plan-room'}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `Select ${r.name}` : undefined}
            onClick={interactive ? () => onSelect?.(r.id) : undefined}
            onKeyDown={
              interactive
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect?.(r.id)
                    }
                  }
                : undefined
            }
          >
            <rect
              x={r.x}
              y={r.y}
              width={r.width}
              height={r.depth}
              style={{ stroke: 'var(--plan-line)', fill: fills[r.id] ?? 'var(--surface)', transition: 'fill 300ms ease' }}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            {label && (
              <text
                x={r.x + r.width / 2}
                y={r.y + r.depth / 2 - (sublabels ? fontSize * 0.4 : -fontSize * 0.35)}
                textAnchor="middle"
                fontSize={tight && labels === 'full' ? fontSize * 0.85 : fontSize}
                fontWeight={600}
                style={{ fill: 'var(--ink)' }}
                pointerEvents="none"
              >
                {label}
              </text>
            )}
            {sublabels?.[r.id] && (
              <text
                x={r.x + r.width / 2}
                y={r.y + r.depth / 2 + fontSize * 0.9}
                textAnchor="middle"
                fontSize={fontSize * 0.8}
                style={{ fill: 'var(--plan-text-2)' }}
                pointerEvents="none"
              >
                {sublabels[r.id]}
              </text>
            )}
          </g>
        )
      })}
      <rect
        x={0}
        y={0}
        width={plan.width}
        height={plan.depth}
        fill="none"
        style={{ stroke: 'var(--plan-line)' }}
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    </svg>
  )
}
