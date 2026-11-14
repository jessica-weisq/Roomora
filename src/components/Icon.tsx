const PATHS: Record<string, string[]> = {
  cube: ['M12 2l9 5v10l-9 5-9-5V7l9-5z', 'M3 7l9 5 9-5', 'M12 12v10'],
  check: ['M5 12l5 5L20 7'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3'],
  x: ['M6 6l12 12M18 6L6 18'],
  arrowRight: ['M5 12h14M13 6l6 6-6 6'],
  arrowLeft: ['M19 12H5M11 6l-6 6 6 6'],
  alert: ['M12 3l9 16H3l9-16z', 'M12 10v4M12 17v.01'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  reset: ['M4 12a8 8 0 1 0 2.3-5.6', 'M4 4v4h4'],
  expand: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M4 20h16'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  chevronDown: ['M6 9l6 6 6-6'],
  file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z', 'M14 3v5h5'],
}

export function Icon({ name, size = 18, strokeWidth = 2, className }: { name: keyof typeof PATHS | string; size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'image' ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="2" />
          <path d="M21 16l-5-5-9 9" />
        </>
      ) : (
        (PATHS[name] ?? []).map((d) => <path key={d} d={d} />)
      )}
    </svg>
  )
}
