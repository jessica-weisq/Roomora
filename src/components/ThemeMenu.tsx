import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useTheme } from '../state/theme'
import type { ThemeMode } from '../state/theme'

const OPTIONS: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: 'light', label: 'Light', icon: 'sun' },
  { mode: 'dark', label: 'Dark', icon: 'moon' },
  { mode: 'system', label: 'System', icon: 'monitor' },
]

/** Sun/moon button in the header that opens a small Light / Dark / System menu. */
export function ThemeMenu() {
  const { mode, resolved, setMode } = useTheme()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  // Close on a click outside or on Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (m: ThemeMode) => {
    setMode(m)
    setOpen(false)
    button.current?.focus()
  }

  return (
    <div className="theme-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="theme-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${mode === 'system' ? `system (${resolved})` : mode}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={resolved === 'dark' ? 'moon' : 'sun'} size={18} />
        <Icon name="chevronDown" size={14} className="theme-chevron" />
      </button>
      {open && (
        <div className="theme-list" role="menu" aria-label="Theme">
          {OPTIONS.map((o) => (
            <button
              key={o.mode}
              type="button"
              role="menuitemradio"
              aria-checked={mode === o.mode}
              onClick={() => choose(o.mode)}
              autoFocus={mode === o.mode}
            >
              <Icon name={o.icon} size={16} />
              <span>{o.label}</span>
              {mode === o.mode && <Icon name="check" size={14} strokeWidth={2.5} className="theme-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
