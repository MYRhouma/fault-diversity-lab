import { ChevronDown } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

// Open/closed sections that remember their state in this browser, and a body that slides open smoothly.

/** Open state kept in localStorage under "fdlab.open.<id>", so a folded section stays folded on the next visit. */
export function usePersistedOpen(id: string, initial = true) {
  const key = `fdlab.open.${id}`
  const [open, setOpen] = React.useState(() => {
    try { const v = localStorage.getItem(key); return v === null ? initial : v === '1' } catch { return initial }
  })
  const set = React.useCallback((v: boolean) => {
    setOpen(v)
    try { localStorage.setItem(key, v ? '1' : '0') } catch { /* storage blocked */ }
  }, [key])
  return [open, set] as const
}

/** Animates height between 0 and auto (grid rows 0fr to 1fr). Closed content is not focusable. */
export function CollapseBody({ open, children, className }: { open: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')} inert={!open}>
      <div className={cn('min-h-0 overflow-hidden', className)}>{children}</div>
    </div>
  )
}

/** The round chevron used by every fold toggle: points down when open. */
export function FoldChevron({ open, className }: { open: boolean; className?: string }) {
  return <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-200', !open && '-rotate-90', className)} />
}
