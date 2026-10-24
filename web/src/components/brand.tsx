import * as React from 'react'

/**
 * The Fault Diversity Lab mark: fault diversity at a glance. Each row is one independently written version, each column one test.
 * Every version fails one test (orange), but never the same one, so each test still has a 2-of-3 majority and the
 * voter of an N-version system gets the right answer. The same drawing is the favicon (public/favicon.svg).
 */
export function LabLogo({ className }: { className?: string }) {
  const id = React.useId().replace(/:/g, '')
  const cells = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => ({ r, c, fault: c === [2, 0, 1][r] })))
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3d7bf0" /><stop offset="1" stopColor="#1b3a9e" />
        </linearGradient>
        <linearGradient id={`${id}sh`} x1="16" y1="0" x2="16" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity=".22" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id}bg)`} />
      <rect x=".5" y=".5" width="31" height="31" rx="7.5" fill={`url(#${id}sh)`} stroke="#fff" strokeOpacity=".16" />
      {cells.map(({ r, c, fault }) => (
        <rect key={`${r}${c}`} x={5 + c * 8} y={5 + r * 8} width="6" height="6" rx="1.6" fill={fault ? '#ff8a5c' : '#fff'} fillOpacity={fault ? 1 : 0.92} />
      ))}
    </svg>
  )
}
