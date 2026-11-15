import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

// Light/dark theme. Every page load starts on 'system' (the device's setting); the menu in the
// header can override it for this visit. The resolved theme is put on <html data-theme="...">,
// which is what styles.css keys its dark palette on. index.html sets it before React loads to
// avoid a flash of the wrong theme.

export type ThemeMode = 'system' | 'light' | 'dark'
type Resolved = 'light' | 'dark'

const QUERY = '(prefers-color-scheme: dark)'
const systemTheme = (): Resolved => (typeof window !== 'undefined' && window.matchMedia?.(QUERY).matches ? 'dark' : 'light')

const ThemeContext = createContext<{ mode: ThemeMode; resolved: Resolved; setMode: (m: ThemeMode) => void } | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('system')
  const [system, setSystem] = useState<Resolved>(systemTheme)

  // Follow the device if it changes while the page is open (e.g. automatic dark mode at sunset).
  useEffect(() => {
    const m = window.matchMedia?.(QUERY)
    if (!m) return
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light')
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [])

  const resolved: Resolved = mode === 'system' ? system : mode
  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
