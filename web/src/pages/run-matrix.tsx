import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, List } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { CollapseBody, FoldChevron, usePersistedOpen } from '@/components/ui/collapsible'
import { Card, Skeleton, Switch, Table, TBody, TD, TH, THead, TR, Tooltip } from '@/components/ui/primitives'
import { FilterBar, ModelName, OUTCOME, OUTCOME_ORDER, OutcomeBadge, OutcomeBar, OutcomeLegend, prettyModel, Score, settingLabel, settingText, skipText, useRunFilter, useRunOverview, variantLink } from '@/features/run/shared'
import { runApi, type RunOverview, type RunVariant } from '@/lib/api'
import { cn, int, usd } from '@/lib/utils'

// Every variant in one grid: a row per model, a column per setting and sample. Colour, icon and number say how it came out.

/** Shared-fault highlight: hovering a square with a fault pattern lights up every square with the same pattern.
 *  It writes one <style> rule instead of re-rendering the grid, and waits a moment before clearing so moving between squares does not flicker. */
type Patterns = Map<string, { variants: number; models: number }>
const PatternCtx = React.createContext<{ enter: (sig: string | null) => void; leave: () => void; patterns: Patterns }>({ enter: () => {}, leave: () => {}, patterns: new Map() })

const HL_BASE = '.mx-cell{outline:2px solid transparent;outline-offset:1px;transition:opacity .25s ease,filter .25s ease,outline-color .25s ease}'
const hlRule = (sig: string) => `${HL_BASE}
.mx-grid .mx-cell:not([data-sig="${sig}"]){opacity:.3;filter:saturate(.35)}
.mx-grid .mx-cell[data-sig="${sig}"]{outline-color:color-mix(in srgb,var(--foreground) 55%,transparent)}`

function useHighlight(enabled: boolean) {
  const style = React.useRef<HTMLStyleElement>(null)
  const timer = React.useRef<number>(undefined)
  const cur = React.useRef<string | null>(null)
  const show = React.useCallback((sig: string | null) => {
    if (cur.current === sig || !style.current) return
    cur.current = sig
    style.current.textContent = sig ? hlRule(sig) : HL_BASE
  }, [])
  const enter = React.useCallback((sig: string | null) => {
    window.clearTimeout(timer.current)
    if (!enabled) return
    // a square with a pattern switches at once when one is already lit, after a short pause otherwise; a square without one clears after a grace period
    timer.current = window.setTimeout(() => show(sig), sig ? (cur.current ? 0 : 90) : 160)
  }, [enabled, show])
  const leave = React.useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => show(null), 160)
  }, [show])
  React.useEffect(() => { if (!enabled) show(null) }, [enabled, show])
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  return { style, enter, leave }
}

function patternsOf(rows: RunVariant[]): Patterns {
  const by = new Map<string, RunVariant[]>()
  rows.forEach((r) => r.signature && by.set(r.signature, [...(by.get(r.signature) ?? []), r]))
  return new Map([...by].map(([k, vs]) => [k, { variants: vs.length, models: new Set(vs.map((v) => v.model)).size }]))
}

const pct = (x: number) => `${Math.round(x * 100)}%`

function Cell({ v }: { v: RunVariant | undefined }) {
  const navigate = useNavigate()
  const { enter, leave, patterns } = React.useContext(PatternCtx)
  if (!v) return <div className="h-11 rounded-md border border-dashed opacity-40" />
  const o = OUTCOME[v.outcome]
  const Icon = o.icon
  const tip = (
    <div className="space-y-0.5 text-xs">
      <div className="font-medium">{prettyModel(v.model)}, {settingLabel(v.setting)}, sample {v.sample}</div>
      <div>{o.label}</div>
      {v.main && <div>Tests {v.main.passed}/{v.main.total} ({pct(v.main.passed / Math.max(v.main.total, 1))})</div>}
      {v.compile_errors > 0 && <div>{v.compile_errors} compiler errors: {v.error_categories.join(', ')}</div>}
      {v.signature && <div>Fault pattern {v.signature}{(() => { const p = patterns.get(v.signature!); return p && p.variants > 1 ? `: same failing tests in ${p.variants} variants from ${p.models} model${p.models === 1 ? '' : 's'}` : ': no other variant fails the same tests' })()}</div>}
      {v.cost_usd !== null && <div>{usd(v.cost_usd)}, {int(v.completion_tokens)} output tokens</div>}
      {v.rate_limited > 0 && <div>Rate limited {v.rate_limited}x (HTTP 429) before it was answered</div>}
    </div>
  )
  const pending = v.outcome === 'pending' && !v.attempts
  // only "some fail" squares carry a number (tests passed) and a thin bar of how far they got; the icon stays for colour-blind readers
  const frac = v.outcome === 'partial' && v.main ? v.main.passed / Math.max(v.main.total, 1) : null
  return (
    <Tooltip content={tip}>
      <button onClick={() => !pending && navigate(variantLink(v.id))} disabled={pending} aria-label={`${prettyModel(v.model)}, ${settingLabel(v.setting)}, sample ${v.sample}: ${o.label}`}
        data-sig={v.signature ?? undefined} onMouseEnter={() => enter(v.signature ?? null)} onMouseLeave={leave} onFocus={() => enter(v.signature ?? null)} onBlur={leave}
        className={cn('mx-cell relative flex h-9 w-full min-w-0 items-center justify-center gap-0.5 overflow-hidden rounded-md border text-[11px] font-medium tabular-nums', pending ? 'cursor-default border-dashed opacity-50' : 'cursor-pointer hover:brightness-[.97] focus-visible:ring-2 focus-visible:ring-ring')}
        style={{ background: pending ? undefined : `${o.color}1f`, borderColor: pending ? undefined : `${o.color}70` }}>
        <Icon className={cn('shrink-0', frac != null ? 'size-3' : 'size-3.5', v.outcome === 'running' && 'animate-spin')} style={{ color: o.color }} strokeWidth={2.25} />
        {frac != null && <span>{v.main!.passed}</span>}
        {v.signature && <span className="absolute top-0.5 right-0.5 text-[9px] leading-none font-semibold text-muted-foreground">{v.signature}</span>}
        {frac != null && <span className="absolute bottom-0 left-0 h-[3px]" style={{ width: pct(frac), background: o.color }} />}
      </button>
    </Tooltip>
  )
}

const FINISHED = ['all_pass', 'partial', 'compile_error', 'no_code']  // finished, as on every page

/** How a group of variants came out: "2/3 pass" and a thin bar of the outcomes; the tooltip adds the mean share of tests passed. */
function RowSummary({ cells, center }: { cells: RunVariant[]; center?: boolean }) {
  const done = cells.filter((c) => FINISHED.includes(c.outcome))
  const pass = done.filter((c) => c.outcome === 'all_pass').length
  const tested = done.filter((c) => c.main && c.main.total > 0)
  const mean = tested.length ? tested.reduce((a, c) => a + c.main!.passed / c.main!.total, 0) / tested.length : null
  const tip = done.length ? <div className="text-xs">{pass} of {done.length} finished variants pass every test{mean != null && <><br />Mean share of tests passed: {pct(mean)} (over {tested.length} that compiled)</>}</div> : null
  return (
    <Tooltip content={tip}>
      <div className={cn('min-w-0 cursor-default text-[11px] leading-tight text-muted-foreground tabular-nums', center ? 'text-center' : 'text-right')}>
        {done.length ? <span className={cn('font-medium whitespace-nowrap', pass ? 'text-foreground' : '')}>{pass}/{done.length}</span> : 'n/a'}
        <div className={cn('mt-1 flex h-1 w-full max-w-14 overflow-hidden rounded-full bg-muted', center ? 'mx-auto' : 'ml-auto')}>
          {cells.map((c) => <span key={c.id} className="h-full flex-1" style={{ background: ['pending', 'running', 'testing'].includes(c.outcome) ? 'transparent' : OUTCOME[c.outcome].color }} />)}
        </div>
      </div>
    </Tooltip>
  )
}

/** One target as a card that folds to its title row; the fold is remembered in this browser. */
function SpecCard({ id, title, meta, counts, children }: { id: string; title: string; meta: string; counts: RunVariant[]; children: React.ReactNode }) {
  const [open, setOpen] = usePersistedOpen(`matrix.${id}`)
  const done = counts.filter((r) => r.outcome !== 'pending')
  const tally = Object.fromEntries(OUTCOME_ORDER.map((k) => [k, done.filter((r) => r.outcome === k).length]))
  // headline numbers: pass rate, distinct fault patterns, widest pattern (most models with the same failing tests)
  const finished = done.filter((r) => FINISHED.includes(r.outcome))
  const pats = [...patternsOf(done).entries()].sort((a, b) => b[1].models - a[1].models || b[1].variants - a[1].variants)
  const facts = [
    finished.length ? `${tally.all_pass}/${finished.length} pass every test` : null,
    pats.length ? `${pats.length} fault pattern${pats.length === 1 ? '' : 's'}` : null,
    pats[0] && pats[0][1].models > 1 ? `${pats[0][0]} shared by ${pats[0][1].models} models` : null,
  ].filter(Boolean)
  return (
    <Card className="overflow-hidden p-0">
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className={cn('flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-muted/50', open && 'border-b')}>
        <FoldChevron open={open} />
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{meta}</span>
        {facts.length > 0 && <span className="text-xs text-foreground tabular-nums">{facts.join(' · ')}</span>}
        <OutcomeBar counts={tally} total={done.length} height={6} className="ml-auto w-full max-w-48 max-sm:ml-7" />
      </button>
      <CollapseBody open={open}>{children}</CollapseBody>
    </Card>
  )
}

const idOf = (tid: string, m: string, s: string, n: number) => `${tid}/${m}/${s}/s${String(n).padStart(2, '0')}`

/** One target: a row per model, a column per setting and sample. */
function Grid({ tid, models, settings, samples, byId, fields }: { tid: string; models: RunOverview['models']; settings: string[]; samples: number[]; byId: Map<string, RunVariant>; fields: RunOverview['settings'] }) {
  const cols = settings.filter((s) => models.some((m) => samples.some((n) => byId.has(idOf(tid, m.label, s, n)))))
  const hatch = skipText()
  return (
    <div className="isolate max-h-[75vh] overflow-auto overscroll-x-contain">
      <table className="min-w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <th rowSpan={2} className="sticky top-0 left-0 z-30 min-w-32 border-r border-b bg-card px-2 align-bottom sm:px-3 text-[11px] font-medium text-muted-foreground sm:min-w-48">Model</th>
            {cols.map((s) => (
              <th key={s} colSpan={samples.length} className="sticky top-0 z-20 h-8 border-b border-l bg-card px-2 text-center text-xs font-medium whitespace-nowrap">
                <Tooltip content={<div className="max-w-80 text-xs">{settingText(s, fields[s])}</div>}><span className="cursor-help">{settingLabel(s)}</span></Tooltip>
              </th>
            ))}
            <th rowSpan={2} aria-hidden className="w-full border-b bg-card" />
            <th rowSpan={2} className="top-0 z-30 min-w-14 border-b border-l sm:sticky sm:right-0 bg-card px-2 text-right align-bottom text-[11px] font-medium text-muted-foreground">Pass</th>
          </tr>
          <tr>
            {cols.map((s) => samples.map((n, i) => (
              <th key={`${s}${n}`} className={cn('sticky top-8 z-20 h-6 border-b bg-card text-center text-[10px] font-normal text-muted-foreground tabular-nums', i === 0 && 'border-l')}>s{String(n).padStart(2, '0')}</th>
            )))}
          </tr>
        </thead>
        <tbody>
          {models.map((m) => {
            const all = cols.flatMap((s) => samples.map((n) => byId.get(idOf(tid, m.label, s, n)))).filter((c): c is RunVariant => !!c)
            return (
              <tr key={m.label} className="group">
                <th scope="row" className="sticky left-0 z-10 border-r border-b bg-card px-2 py-1 sm:px-3 font-normal group-hover:bg-muted">
                  <Link to={`?model=${m.label}`} className="flex max-w-[8.5rem] overflow-hidden text-[13px] whitespace-nowrap hover:underline sm:max-w-none"><ModelName label={m.label} family={m.family} className="[&>span:last-child]:truncate" /></Link>
                </th>
                {cols.map((s) => samples.map((n, i) => {
                  const v = byId.get(idOf(tid, m.label, s, n))
                  return (
                    <td key={`${s}${n}`} className={cn('border-b p-0.5 group-hover:bg-muted/50', i === 0 && 'border-l pl-1.5', i === samples.length - 1 && 'pr-1.5')}>
                      <div className="w-11">{v ? <Cell v={v} /> : <Tooltip content={<div className="max-w-72 text-xs">{hatch}</div>}><div className="h-9 rounded-md bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,var(--border)_4px,var(--border)_5px)] opacity-60" aria-label={hatch} /></Tooltip>}</div>
                    </td>
                  )
                }))}
                <td aria-hidden className="border-b group-hover:bg-muted/50" />
                <td className="z-10 border-b border-l bg-card px-2 group-hover:bg-muted sm:sticky sm:right-0"><RowSummary cells={all} /></td>
              </tr>
            )
          })}
          {models.length > 1 && (
            <tr>
              <th scope="row" className="sticky left-0 z-10 border-r bg-card px-2 py-1.5 text-left text-[11px] font-medium text-muted-foreground sm:px-3">Pass per setting</th>
              {cols.map((s) => (
                <td key={s} colSpan={samples.length} className="border-l px-1.5 py-1.5">
                  <RowSummary center cells={models.flatMap((m) => samples.map((n) => byId.get(idOf(tid, m.label, s, n)))).filter((c): c is RunVariant => !!c)} />
                </td>
              ))}
              <td aria-hidden />
              <td className="z-10 border-l bg-card px-2 py-1.5 sm:sticky sm:right-0"><RowSummary cells={models.flatMap((m) => cols.flatMap((s) => samples.map((n) => byId.get(idOf(tid, m.label, s, n))))).filter((c): c is RunVariant => !!c)} /></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/** Loading state shaped like the page: header, filters, legend and one target card of squares that pulse in a soft diagonal wave. */
function MatrixSkeleton() {
  const wave = (r: number, c: number) => ({ animationDelay: `${(r + c) * 60}ms`, animationDuration: '1.6s' })
  const groups = 3, per = 6, rows = 7
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading the results matrix">
      <div className="flex items-end justify-between gap-4">
        <div className="w-full max-w-2xl space-y-2.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-60" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
        <Skeleton className="h-8 w-32 shrink-0 max-sm:hidden" />
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
        {[44, 52, 48, 40].map((w, i) => <div key={i} className="flex items-center gap-2"><Skeleton className="h-3 w-10" /><Skeleton className="h-8" style={{ width: `${w * 3}px` }} /></div>)}
      </div>
      <div className="flex flex-wrap gap-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-3.5 w-16" />)}</div>
      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Skeleton className="size-4 rounded" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-40 max-sm:hidden" />
          <Skeleton className="ml-auto h-1.5 w-48 rounded-full max-sm:hidden" />
        </div>
        <div className="overflow-hidden p-3">
          <div className="flex gap-3 pb-2 pl-36 sm:pl-52">
            {Array.from({ length: groups }, (_, g) => <div key={g} className="flex justify-center" style={{ width: `${per * 48}px` }}><Skeleton className="h-3 w-16" /></div>)}
          </div>
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="flex items-center gap-3 py-1">
              <div className="flex w-32 shrink-0 items-center gap-2 sm:w-48"><Skeleton className="size-4 rounded-full" /><Skeleton className="h-3.5" style={{ width: `${55 + ((r * 37) % 40)}%` }} /></div>
              {Array.from({ length: groups }, (_, g) => (
                <div key={g} className="flex shrink-0 gap-1">
                  {Array.from({ length: per }, (_, c) => <Skeleton key={c} className="h-9 w-11 bg-muted/80" style={wave(r, g * per + c)} />)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

export function RunMatrixPage() {
  const o = useRunOverview().data
  const [f] = useRunFilter()
  const [listView, setListView] = usePersistedOpen('matrix.list', false)  // remembered in this browser
  const view = listView ? 'list' : 'grid'
  const setView = (v: 'grid' | 'list') => setListView(v === 'list')
  const q = useQuery({ queryKey: ['run', 'variants', f], queryFn: () => runApi.variants(f), refetchInterval: 15000 })
  const [hlOn, setHlOn] = usePersistedOpen('matrix.highlight', true)  // remembered in this browser
  const { style: hlStyle, enter, leave } = useHighlight(hlOn)
  const ctx = React.useMemo(() => ({ enter, leave, patterns: new Map() as Patterns }), [enter, leave])
  if (!o || !q.data) return <MatrixSkeleton />
  const rows = q.data
  const families = Object.fromEntries(o.models.map((m) => [m.label, m.family]))
  const settings = Object.keys(o.settings).filter((s) => !f.setting || s === f.setting)
  const samples = Array.from({ length: o.samples }, (_, i) => i + 1).filter((s) => !f.sample || s === f.sample)
  const models = o.models.filter((m) => !f.model || m.label === f.model)
  const byId = new Map(rows.map((r) => [r.id, r]))
  ctx.patterns = patternsOf(rows)
  const counts = Object.fromEntries(Object.keys(OUTCOME).map((k) => [k, rows.filter((r) => r.outcome === k).length]))
  return (
    <PatternCtx.Provider value={ctx}>
    <style ref={hlStyle}>{HL_BASE}</style>
    <div className="space-y-5">
      <PageHeader eyebrow="Experiment" title="Results matrix"
        description={`One square per variant. Click a square for its prompt, answer, code and every test result. A number means some tests fail: it is how many pass, and the bar at its bottom shows the share.${hlOn ? ' Hover a square with a fault label (F1, F2, ...) to light up every variant that fails the same tests.' : ''}`}
        actions={<>
          <div className="flex rounded-md border bg-card p-0.5">
            <Button size="xs" variant={view === 'grid' ? 'secondary' : 'ghost'} onClick={() => setView('grid')}><LayoutGrid />Grid</Button>
            <Button size="xs" variant={view === 'list' ? 'secondary' : 'ghost'} onClick={() => setView('list')}><List />List</Button>
          </div>
        </>} />
      <div><FilterBar overview={o} show={view === 'grid' ? ['target', 'model', 'setting', 'sample'] : ['target', 'model', 'setting', 'sample', 'outcome']} /></div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <OutcomeLegend counts={counts} />
        {view === 'grid' && (
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
            <Switch checked={hlOn} onCheckedChange={setHlOn} aria-label="Highlight shared faults on hover" />
            Highlight shared faults
          </label>
        )}
      </div>

      {view === 'grid' ? (
        <div className="mx-grid space-y-6">
          {(f.target ? [f.target] : o.targets.map((t) => t.id).filter((t) => rows.some((r) => r.target === t && r.outcome !== 'pending'))).map((tid) => {
            const shown = models.filter((m) => settings.some((s) => samples.some((n) => byId.has(idOf(tid, m.label, s, n)))))
            return (
              <SpecCard key={tid} id={tid} title={o.targets.find((t) => t.id === tid)?.name ?? tid} counts={rows.filter((r) => r.target === tid)}
                meta={`${shown.length} models · ${samples.length} samples per setting`}>
                <Grid tid={tid} models={shown} settings={settings} samples={samples} byId={byId} fields={o.settings} />
              </SpecCard>
            )
          })}
          {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>}
          <div className="space-y-1 text-xs text-muted-foreground">
            {!f.target && o.targets.filter((t) => !rows.some((r) => r.target === t.id && r.outcome !== 'pending')).length > 0 && (
              <p>Not started yet: {o.targets.filter((t) => !rows.some((r) => r.target === t.id && r.outcome !== 'pending')).map((t) => t.name).join(', ')}. Pick one in the Target filter to see its planned grid.</p>
            )}
            <p>Hatched square: setting not planned for that model (hover it for the reason). Dashed square: not run yet.</p>
          </div>
        </div>
      ) : (<>
        {/* phones: one card per variant, the whole card opens it */}
        <ul className="space-y-2 md:hidden">
          {rows.filter((r) => r.outcome !== 'pending').map((r) => (
            <li key={r.id}>
              <Link to={variantLink(r.id)} className="block rounded-lg border bg-card p-3 transition-colors active:bg-accent">
                <div className="flex items-center gap-2">
                  <ModelName label={r.model} family={families[r.model]} className="min-w-0 flex-1 text-[14px] font-medium" />
                  <span className="shrink-0 text-xs text-muted-foreground">{settingLabel(r.setting)}, s{String(r.sample).padStart(2, '0')}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <OutcomeBadge outcome={r.outcome} />
                  {r.signature && <span className="text-xs text-muted-foreground">pattern {r.signature}</span>}
                  {r.main && <span className="ml-auto text-sm"><Score s={r.main} /> <span className="text-[11px] text-muted-foreground">tests</span></span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                  <span>{o.targets.find((t) => t.id === r.target)?.name ?? r.target}</span>
                  <span>{int(r.completion_tokens)} output tokens</span>
                  {r.seconds !== null && <span>{Math.round(r.seconds)} s</span>}
                  <span>{usd(r.cost_usd)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <Card className="max-h-[75vh] overflow-auto max-md:hidden">
          <Table>
            <THead className="sticky top-0 z-10 bg-card"><TR><TH>Variant</TH><TH>Outcome</TH><TH className="text-right">Tests passed</TH><TH className="text-right">Output tokens</TH><TH className="text-right">Reasoning</TH><TH className="text-right">Time</TH><TH className="text-right">Cost</TH><TH className="text-right">Attempts</TH></TR></THead>
            <TBody>
              {rows.filter((r) => r.outcome !== 'pending').map((r) => (
                <TR key={r.id}>
                  <TD><Link to={variantLink(r.id)} className="hover:underline"><ModelName label={r.model} family={families[r.model]} /></Link>
                    <div className="pl-6 text-xs text-muted-foreground">{o.targets.find((t) => t.id === r.target)?.name ?? r.target} · {settingLabel(r.setting)}, s{String(r.sample).padStart(2, '0')}</div></TD>
                  <TD><OutcomeBadge outcome={r.outcome} />{r.signature && <span className="ml-1.5 text-xs text-muted-foreground">{r.signature}</span>}</TD>
                  <TD className="text-right"><Score s={r.main} /></TD>
                  <TD className="text-right tabular-nums">{int(r.completion_tokens)}</TD>
                  <TD className="text-right tabular-nums">{int(r.reasoning_tokens)}</TD>
                  <TD className="text-right tabular-nums">{r.seconds !== null ? `${Math.round(r.seconds)} s` : 'n/a'}</TD>
                  <TD className="text-right tabular-nums">{usd(r.cost_usd)}</TD>
                  <TD className="text-right tabular-nums">{r.attempts}{r.rate_limited > 0 && <span className="text-muted-foreground"> ({r.rate_limited}x 429)</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </>)}
    </div>
    </PatternCtx.Provider>
  )
}
