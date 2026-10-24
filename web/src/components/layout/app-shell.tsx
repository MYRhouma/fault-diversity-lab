import { FolderGit2, Menu, Moon, Sun, X } from 'lucide-react'
import * as React from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LabLogo } from '@/components/brand'
import { Skeleton, Tooltip } from '@/components/ui/primitives'
import { PAGES, type NavItem } from '@/components/layout/nav'
import { runState, RunStateDot, useRunOverview } from '@/features/run/shared'
import { cn, usd } from '@/lib/utils'

const REPO = 'https://github.com/MYRhouma/fault-diversity-lab'

function pageTitle(pathname: string) {
  if (pathname.startsWith('/run/v')) return 'Variant'
  return PAGES.find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to) && i.to !== '/'))?.label ?? 'Fault Diversity Lab'
}

function useTheme() {
  const [dark, setDark] = React.useState(() => document.documentElement.classList.contains('dark'))
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('theme', dark ? 'dark' : 'light') } catch { /* storage blocked */ }
  }, [dark])
  return [dark, setDark] as const
}

function Brand() {
  const { data: o } = useRunOverview()
  return (
    <NavLink to="/" className="flex min-w-0 items-center gap-2.5 rounded-md">
      <LabLogo className="size-9 shrink-0 drop-shadow-sm" />
      <div className="min-w-0 leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">Fault Diversity Lab</div>
        <div className="truncate text-[11px] leading-snug text-muted-foreground">{o?.title ?? 'Faults in LLM-generated programs'}</div>
      </div>
    </NavLink>
  )
}

export function AppShell() {
  const [dark, setDark] = useTheme()
  const { pathname } = useLocation()
  const { data: o } = useRunOverview()
  React.useEffect(() => { window.scrollTo(0, 0) }, [pathname])  // every page opens at its top
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => { setOpen(false) }, [pathname])
  // While the phone drawer is open: no page scrolling behind it, Escape closes it.
  React.useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [open])
  React.useEffect(() => { document.title = `${pageTitle(pathname)} · Fault Diversity Lab` }, [pathname])
  const ThemeIcon = dark ? Sun : Moon
  return (
    <div className="flex min-h-screen">
      {/* phone top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md md:hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="flex size-10 cursor-pointer items-center justify-center rounded-md hover:bg-accent active:bg-accent">
          <Menu className="size-5" />
        </button>
        <NavLink to="/" aria-label="Findings"><LabLogo className="size-7" /></NavLink>
        <div className="min-w-0 flex-1 truncate text-[15px] font-semibold">{pageTitle(pathname)}</div>
        <button onClick={() => setDark(!dark)} aria-label={dark ? 'Light mode' : 'Dark mode'} className="flex size-10 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent active:bg-accent">
          <ThemeIcon className="size-[18px]" />
        </button>
      </header>
      {/* phone backdrop */}
      <div onClick={() => setOpen(false)} aria-hidden
        className={cn('fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] transition-opacity md:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')} />
      <aside aria-label="Navigation"
        className={cn('fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[min(18rem,85vw)] shrink-0 flex-col border-r border-black/[0.05] bg-sidebar transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] dark:border-white/[0.05] md:sticky md:top-0 md:z-auto md:h-screen md:w-60 md:translate-x-0',
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full')}>
        <div className="flex items-center gap-2 px-4 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1"><Brand /></div>
          <button onClick={() => setOpen(false)} aria-label="Close menu" className="flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:hidden">
            <X className="size-4" />
          </button>
        </div>
        <RunStatus />
        <nav className="flex-1 overflow-y-auto overscroll-contain px-2.5 pb-3 pt-1">
          <NavGroup items={PAGES} />
        </nav>
        <div className="space-y-0.5 border-t p-2.5" style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}>
          {o?.demo && <div className="mb-1 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-800 dark:text-amber-300">Demo data: fictional models, real test runs.</div>}
          <a href={REPO} target="_blank" rel="noreferrer" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <FolderGit2 className="size-3.5" /> Source on GitHub
          </a>
          <button onClick={() => setDark(!dark)} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <ThemeIcon className="size-3.5" /> {dark ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1400px] px-4 pt-[calc(4.5rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 md:px-8 md:pt-[calc(2rem+env(safe-area-inset-top))] md:pb-12 min-[1800px]:max-w-[1720px] min-[1800px]:px-12"><React.Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64" /></div>}><Outlet /></React.Suspense></div>
      </main>
      <TabBar />
    </div>
  )
}

/** Phone only: the five main pages, always one tap away. */
function TabBar() {
  const tabs = PAGES.filter((p) => p.to !== '/run/log')
  return (
    <nav aria-label="Main pages" className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/90 backdrop-blur-md md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {tabs.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => cn('flex h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium transition-colors', isActive ? 'text-primary' : 'text-muted-foreground active:text-foreground')}>
          {({ isActive }) => <><Icon className="size-5" strokeWidth={isActive ? 2.1 : 1.75} />{label.split(' ')[0]}</>}
        </NavLink>
      ))}
    </nav>
  )
}

/** A small live card at the top of the sidebar: how far the run is. */
function RunStatus() {
  const { data: o } = useRunOverview()
  if (!o || !o.planned) return null
  const pct = Math.round((o.done / o.planned) * 100)
  const state = runState(o)
  return (
    <NavLink to="/run/status" className="mx-2.5 mb-3 block rounded-lg border bg-card px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors hover:border-primary/40">
      <div className="flex items-center gap-2 text-[12px]">
        <RunStateDot state={state} />
        <span className="truncate font-medium">{{ generating: 'Running now', stopped_cap: 'Stopped at cap', complete: 'Run complete', paused: 'Paused' }[state]}</span>
        <span className="ml-auto tabular-nums text-muted-foreground">{o.done}/{o.planned}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>{pct}% generated</span><span className="tabular-nums">{usd(o.spent_usd)} billed</span>
      </div>
    </NavLink>
  )
}

const linkClass = ({ isActive }: { isActive: boolean }) => cn('group relative flex items-center gap-3 rounded-md px-3 py-2 text-[14px] transition-colors max-md:py-2.5',
  isActive ? 'bg-black/[0.055] font-medium text-foreground dark:bg-white/[0.07]' : 'text-[#5f5e5b] hover:bg-black/[0.035] hover:text-foreground dark:text-muted-foreground dark:hover:bg-white/[0.05]')

function NavGroup({ items }: { items: NavItem[] }) {
  return (
    <div className="space-y-0.5">
      {items.map(({ to, label, icon: Icon, end, hint }) => (
        <Tooltip key={to} content={hint} side="right">
          <NavLink to={to} end={end} className={linkClass}>
            {({ isActive }) => (<>
              {isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-primary" />}
              <Icon className={cn('size-[17px] shrink-0', isActive && 'text-primary')} strokeWidth={1.75} />
              <span className="flex-1">{label}</span>
            </>)}
          </NavLink>
        </Tooltip>
      ))}
    </div>
  )
}
