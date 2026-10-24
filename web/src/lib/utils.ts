import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Shown where a value does not exist (not measured yet, not applicable). */
export const EMPTY = 'n/a'

export const pct = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined || Number.isNaN(x) ? EMPTY : `${(x * 100).toFixed(digits)}%`

export const num = (x: number | null | undefined, digits = 3) =>
  x === null || x === undefined || Number.isNaN(x) ? EMPTY : x.toFixed(digits)

export const usd = (x: number | null | undefined) =>
  x === null || x === undefined ? EMPTY : x < 0.01 && x > 0 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`

export const int = (x: number | null | undefined) => (x === null || x === undefined ? EMPTY : x.toLocaleString())

export function relativeTime(iso?: string | null) {
  if (!iso) return EMPTY
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}

/** "1 condition", "3 conditions". */
