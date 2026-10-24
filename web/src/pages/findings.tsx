import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Brain, CircleHelp, Coins, GitFork, Layers, ShieldCheck } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/common'
import { CollapseBody, FoldChevron, usePersistedOpen } from '@/components/ui/collapsible'
import { Card, Skeleton, Tooltip } from '@/components/ui/primitives'
import { Measured, RUN_STATE, runState, RunStateDot, ChartCard, LogoSvg, OUTCOME, OutcomeBarsSvg, prettyModel, useRunOverview } from '@/features/run/shared'
import { fisher, finished, hasCode, overlap, pct, rate, readableTest, reasoningOff, sharedFaults, vote, type Rate } from '@/features/run/stats'
import { runApi, type RunOverview, type RunVariant } from '@/lib/api'
import { cn, usd } from '@/lib/utils'

// The home page: what the data says so far, one picture per question, each with one sentence made only from its numbers.

const C = { one: '#e8833a', same: '#9aa3b2', diverse: '#2f6fe4', off: '#9aa3b2', on: '#2f6fe4' }

// ---- small pieces ----------------------------------------------------------------------------------------------

function Sentence({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-foreground">{children}</p>
}

/** "How to read this": folded by default, remembered per chart. */
function HowTo({ id, children }: { id: string; children: React.ReactNode }) {
  const [open, setOpen] = usePersistedOpen(`howto.${id}`, false)
  return (
    <div className="mt-3 border-t pt-2">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <CircleHelp className="size-3.5" />How to read this<FoldChevron open={open} className="size-3.5" />
      </button>
      <CollapseBody open={open}><div className="space-y-1.5 pt-2 text-xs leading-relaxed text-muted-foreground">{children}</div></CollapseBody>
    </div>
  )
}

function Tile({ label, value, hint, icon: Icon, to }: { label: string; value: React.ReactNode; hint: React.ReactNode; icon: typeof Layers; to?: string }) {
  const body = (
    <Card className={cn('h-full p-4 transition-colors', to && 'hover:border-primary/40')}>
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">{label}<Icon className="size-4" strokeWidth={1.75} /></div>
      <div className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight tabular-nums">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{hint}</div>
    </Card>
  )
  return to ? <Link to={to} className="block">{body}</Link> : body
}

function Section({ icon: Icon, title, children, kicker }: { icon: typeof Layers; title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {kicker && <span className="text-xs text-muted-foreground max-sm:hidden">{kicker}</span>}
      </div>
      {children}
    </section>
  )
}

// ---- charts (plain SVG so they can be downloaded) ---------------------------------------------------------------------

type BarRow = { key: string; label: string; family?: string; r: Rate; color: string }

/** Horizontal bars of a rate, sorted by the caller; the thin whisker is the 95% interval (advanced). */
function RateBars({ rows, advanced, width = 720 }: { rows: BarRow[]; advanced: boolean; width?: number }) {
  const labelW = 190, rightW = advanced ? 150 : 96, rowH = 28, barH = 14
  const plotW = width - labelW - rightW
  const height = rows.length * rowH + 22
  return (
    <svg data-chart viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="text-foreground" role="img">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={labelW + t * plotW} x2={labelW + t * plotW} y1={0} y2={height - 18} stroke="currentColor" opacity={0.08} />
          <text x={labelW + t * plotW} y={height - 4} fontSize={10} textAnchor="middle" fill="currentColor" opacity={0.5}>{t * 100}%</text>
        </g>
      ))}
      {rows.map((row, i) => {
        const y = i * rowH + (rowH - barH) / 2
        const logo = row.family !== undefined
        return (
          <g key={row.key}>
            {logo && <LogoSvg family={row.family ?? ''} cx={labelW - 18} cy={y + barH / 2} />}
            <text x={labelW - (logo ? 32 : 10)} y={y + barH / 2} dominantBaseline="middle" textAnchor="end" fontSize={12} fill="currentColor">{row.label}</text>
            <rect x={labelW} y={y} width={plotW} height={barH} rx={4} fill="currentColor" opacity={0.05} />
            <rect x={labelW} y={y} width={Math.max(row.r.p * plotW, row.r.n ? 2 : 0)} height={barH} rx={4} fill={row.color}><title>{`${row.label}: ${row.r.k} of ${row.r.n}`}</title></rect>
            {advanced && row.r.n > 0 && <g stroke="currentColor" strokeWidth={1.2} opacity={0.55}>
              <line x1={labelW + row.r.lo * plotW} x2={labelW + row.r.hi * plotW} y1={y + barH / 2} y2={y + barH / 2} />
              <line x1={labelW + row.r.lo * plotW} x2={labelW + row.r.lo * plotW} y1={y + 3} y2={y + barH - 3} />
              <line x1={labelW + row.r.hi * plotW} x2={labelW + row.r.hi * plotW} y1={y + 3} y2={y + barH - 3} />
            </g>}
            <text x={width - rightW + 10} y={y + barH / 2} dominantBaseline="middle" fontSize={11} fill="currentColor">
              <tspan fontWeight={600}>{row.r.n ? pct(row.r.p) : 'n/a'}</tspan>
              <tspan opacity={0.55}>{` ${row.r.k}/${row.r.n}`}{advanced && row.r.n ? `  [${pct(row.r.lo)}, ${pct(row.r.hi)}]` : ''}</tspan>
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Two dots per model: pass-all rate with reasoning off and on, joined by a line. */
function Dumbbell({ rows, width = 720 }: { rows: { key: string; label: string; family: string; off: Rate; on: Rate }[]; width?: number }) {
  const labelW = 190, rightW = 70, rowH = 28
  const plotW = width - labelW - rightW
  const height = rows.length * rowH + 22
  const x = (p: number) => labelW + p * plotW
  return (
    <svg data-chart viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="text-foreground" role="img">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={0} y2={height - 18} stroke="currentColor" opacity={0.08} />
          <text x={x(t)} y={height - 4} fontSize={10} textAnchor="middle" fill="currentColor" opacity={0.5}>{t * 100}%</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const cy = i * rowH + rowH / 2
        const d = r.on.p - r.off.p
        return (
          <g key={r.key}>
            <LogoSvg family={r.family} cx={labelW - 18} cy={cy} />
            <text x={labelW - 32} y={cy} dominantBaseline="middle" textAnchor="end" fontSize={12} fill="currentColor">{r.label}</text>
            <line x1={x(r.off.p)} x2={x(r.on.p)} y1={cy} y2={cy} stroke={d >= 0 ? C.on : C.one} strokeWidth={3} opacity={0.35} strokeLinecap="round" />
            <circle cx={x(r.off.p)} cy={cy} r={5.5} fill={C.off}><title>{`Reasoning off: ${r.off.k} of ${r.off.n}`}</title></circle>
            <circle cx={x(r.on.p)} cy={cy} r={5.5} fill={C.on}><title>{`Reasoning on: ${r.on.k} of ${r.on.n}`}</title></circle>
            <text x={width - rightW + 10} y={cy} dominantBaseline="middle" fontSize={11} fontWeight={600} fill={d > 0 ? C.on : d < 0 ? C.one : 'currentColor'}>{d > 0 ? '+' : ''}{Math.round(d * 100)} pt</text>
          </g>
        )
      })}
    </svg>
  )
}

/** Per target: how often one version fails, and how often a 2-of-3 vote of the same model or of three models fails. */
function VoteBars({ rows, advanced, width = 720 }: { rows: { key: string; label: string; v: ReturnType<typeof vote> }[]; advanced: boolean; width?: number }) {
  const labelW = 110, rightW = 120, barH = 12, gap = 4, groupGap = 18
  const plotW = width - labelW - rightW
  const groupH = 3 * barH + 2 * gap
  const height = rows.length * (groupH + groupGap) + 4
  const parts = [['single', 'One version', C.one], ['same', '3 of the same model', C.same], ['diverse', '3 different models', C.diverse]] as const
  return (
    <svg data-chart viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="text-foreground" role="img">
      {rows.map((r, gi) => {
        const y0 = gi * (groupH + groupGap) + 2
        return (
          <g key={r.key}>
            <text x={0} y={y0 + groupH / 2} dominantBaseline="middle" fontSize={12} fontWeight={600} fill="currentColor">{r.label}</text>
            {parts.map(([k, name, color], i) => {
              const v = r.v[k]
              const y = y0 + i * (barH + gap)
              return (
                <g key={k}>
                  <rect x={labelW} y={y} width={plotW} height={barH} rx={3} fill="currentColor" opacity={0.05} />
                  <rect x={labelW} y={y} width={Math.max(v.p * plotW, v.n ? 2 : 0)} height={barH} rx={3} fill={color}><title>{`${r.label}, ${name}: fails at least one test in ${v.k} of ${v.n}`}</title></rect>
                  <text x={width - rightW + 10} y={y + barH / 2} dominantBaseline="middle" fontSize={11} fill="currentColor">
                    <tspan fontWeight={600}>{v.n ? pct(v.p) : 'n/a'}</tspan>
                    {advanced && v.n > 0 && <tspan opacity={0.55}>{` of ${v.n.toLocaleString()}`}</tspan>}
                  </text>
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(([label, color]) => <span key={label} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: color }} />{label}</span>)}
    </div>
  )
}

/** Cost per variant (x, log scale) against pass-all rate (y), one dot per OpenRouter model. */
function CostScatter({ rows, width = 720 }: { rows: { key: string; label: string; family: string; cost: number; r: Rate }[]; width?: number }) {
  const h = 300, l = 48, b = 34, t = 12, rr = 16
  const costs = rows.map((r) => r.cost)
  const lo = Math.log10(Math.min(...costs) / 1.5), hi = Math.log10(Math.max(...costs) * 1.5)
  const x = (c: number) => l + ((Math.log10(c) - lo) / (hi - lo || 1)) * (width - l - rr)
  const y = (p: number) => t + (1 - p) * (h - t - b)
  const ticks = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1].filter((c) => Math.log10(c) >= lo && Math.log10(c) <= hi)
  return (
    <svg data-chart viewBox={`0 0 ${width} ${h}`} width={width} height={h} className="text-foreground" role="img">
      {[0, 0.5, 1].map((p) => <g key={p}><line x1={l} x2={width - rr} y1={y(p)} y2={y(p)} stroke="currentColor" opacity={0.08} /><text x={l - 8} y={y(p)} fontSize={10} textAnchor="end" dominantBaseline="middle" fill="currentColor" opacity={0.5}>{p * 100}%</text></g>)}
      {ticks.map((c) => <text key={c} x={x(c)} y={h - b + 16} fontSize={10} textAnchor="middle" fill="currentColor" opacity={0.5}>${c}</text>)}
      <text x={(width + l) / 2} y={h - 4} fontSize={10.5} textAnchor="middle" fill="currentColor" opacity={0.6}>mean cost per variant (log scale)</text>
      {placeLabels(rows.map((r) => ({ r, cx: x(r.cost), cy: y(r.r.p) })), width - rr).map(({ r, cx, cy, lx, ly, anchor }) => {
        return (
          <g key={r.key}>
            <circle cx={cx} cy={cy} r={11} fill="var(--card, #fff)" stroke="currentColor" strokeOpacity={0.2} />
            <LogoSvg family={r.family} cx={cx} cy={cy} size={14} />
            <text x={lx} y={ly} fontSize={11} dominantBaseline="middle" textAnchor={anchor} fill="currentColor">{r.label}</text>
            <title>{`${r.label}: ${usd(r.cost)} per variant, passes every test in ${r.r.k} of ${r.r.n}`}</title>
          </g>
        )
      })}
    </svg>
  )
}

/** Label beside each dot: on the left near the right edge, and pushed down when it would sit on another label. */
function placeLabels<T extends { r: { label: string }; cx: number; cy: number }>(pts: T[], right: number) {
  const placed: { x0: number; x1: number; y: number }[] = []
  return [...pts].sort((a, b) => a.cy - b.cy).map((p) => {
    const w = p.r.label.length * 6.2
    const left = p.cx + 15 + w > right
    const x0 = left ? p.cx - 15 - w : p.cx + 15
    let ly = p.cy
    while (placed.some((q) => Math.abs(q.y - ly) < 13 && q.x0 < x0 + w && x0 < q.x1)) ly += 13
    placed.push({ x0, x1: x0 + w, y: ly })
    return { ...p, lx: left ? p.cx - 15 : p.cx + 15, ly, anchor: (left ? 'end' : 'start') as 'end' | 'start' }
  })
}

/** Advanced: how often the faults of two models overlap (share of failing pairs with a common failing test). */
function OverlapHeatmap({ data, families }: { data: ReturnType<typeof overlap>; families: Record<string, string> }) {
  const ms = data.models
  if (ms.length < 2) return <p className="text-xs text-muted-foreground">Needs failing variants of at least two models.</p>
  const cell = 26, labelW = 150
  // the column labels are rotated, so they reach past the last column: leave room on the right
  const w = labelW + ms.length * cell + Math.max(...ms.map((m) => prettyModel(m).length)) * 4.6 + 8, h = labelW + ms.length * cell
  return (
    <svg data-chart viewBox={`0 0 ${w} ${h}`} className="w-full text-foreground" style={{ maxWidth: w * 1.25, minWidth: Math.min(w, 420) }} role="img">
      {ms.map((m, i) => (
        <g key={m}>
          <text x={labelW - 6} y={labelW + i * cell + cell / 2} fontSize={11} textAnchor="end" dominantBaseline="middle" fill="currentColor">{prettyModel(m)}</text>
          <text transform={`translate(${labelW + i * cell + cell / 2}, ${labelW - 6}) rotate(-50)`} fontSize={11} fill="currentColor">{prettyModel(m)}</text>
          {ms.map((m2, j) => {
            const c = i === j ? undefined : data.get(m, m2)
            const p = c && c.n ? c.k / c.n : null
            return (
              <rect key={m2} x={labelW + j * cell + 1} y={labelW + i * cell + 1} width={cell - 2} height={cell - 2} rx={3}
                fill={p === null ? 'currentColor' : C.one} opacity={p === null ? 0.05 : 0.12 + 0.88 * p}>
                <title>{i === j ? prettyModel(m) : c ? `${prettyModel(m)} and ${prettyModel(m2)}: ${c.k} of ${c.n} failing pairs share a failing test` : 'no failing pairs'}</title>
              </rect>
            )
          })}
        </g>
      ))}
      <title>{Object.keys(families).length ? 'Fault overlap between models' : ''}</title>
    </svg>
  )
}

// ---- the page --------------------------------------------------------------------------------------------------

function StatusStrip({ o }: { o: RunOverview }) {
  const state = runState(o)
  const pctDone = Math.round((o.done / Math.max(o.planned, 1)) * 100)
  return (
    <Link to="/run/status" className="group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-4 py-2.5 text-sm transition-colors hover:border-primary/40">
      <span className="flex items-center gap-2 font-medium"><RunStateDot state={state} />{RUN_STATE[state].label}</span>
      <span className="flex min-w-40 flex-1 items-center gap-2 text-xs text-muted-foreground">
        <span className="h-1.5 max-w-64 flex-1 overflow-hidden rounded-full bg-secondary"><span className="block h-full rounded-full bg-primary" style={{ width: `${pctDone}%` }} /></span>
        <span className="tabular-nums">{o.done} of {o.planned} generated</span>
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">{usd(o.spent_usd)} billed</span>
      <span className="ml-auto flex items-center gap-1 text-xs text-primary">Run status<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></span>
    </Link>
  )
}

function TargetPicker({ targets, value, onChange }: { targets: RunOverview['targets']; value: string; onChange: (v: string) => void }) {
  const opts = [['', 'All targets'], ...targets.map((t) => [t.id, t.name])]
  return (
    <div className="flex gap-0.5 overflow-x-auto rounded-lg border bg-muted/60 p-0.5">
      {opts.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)} aria-pressed={value === id}
          className={cn('h-7 shrink-0 cursor-pointer rounded-md px-2.5 text-[13px] whitespace-nowrap transition-colors', value === id ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
      ))}
    </div>
  )
}

export function FindingsPage() {
  const o = useRunOverview().data
  const q = useQuery({ queryKey: ['run', 'variants', {}], queryFn: () => runApi.variants({}), refetchInterval: 30000 })
  const [spec, setSpec] = React.useState('')
  const [advanced, setAdvanced] = usePersistedOpen('findings.advanced', false)
  const all = React.useMemo(() => q.data ?? [], [q.data])
  const rows = React.useMemo(() => all.filter((v) => !spec || v.target === spec), [all, spec])
  const families = React.useMemo(() => Object.fromEntries((o?.models ?? []).map((m) => [m.label, m.family])), [o])
  const votes = React.useMemo(() => (o?.targets ?? []).filter((t) => !spec || t.id === spec)
    .map((t) => ({ key: t.id, label: t.name, name: t.name, v: vote(all.filter((r) => r.target === t.id)), vc: advanced ? vote(all.filter((r) => r.target === t.id), true) : null }))
    .filter((x) => x.v.versions >= 3), [o, all, spec, advanced])
  if (!o || !q.data) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-12" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-80" /></div>

  const fin = rows.filter(finished)
  const code = rows.filter(hasCode)
  const compiled = code.filter((v) => v.outcome !== 'compile_error')
  const pass = fin.filter((v) => v.outcome === 'all_pass')
  const specName = spec ? o.targets.find((t) => t.id === spec)?.name : null
  const scope = specName ? `in ${specName}` : 'over all targets'
  const patterns = new Set(rows.filter((v) => v.outcome === 'partial').map((v) => v.signature)).size

  // outcomes per target
  const specRows = o.targets.filter((t) => !spec || t.id === spec).map((t) => {
    const rs = all.filter((v) => v.target === t.id && !['pending'].includes(v.outcome))
    const counts = Object.fromEntries(Object.keys(OUTCOME).map((k) => [k, rs.filter((v) => v.outcome === k).length]))
    return { key: t.id, label: t.name, counts, total: rs.length }
  }).filter((r) => r.total > 0)
  const bestSpec = [...o.targets].map((t) => ({ t, r: rate(all.filter((v) => v.target === t.id && finished(v) && v.outcome === 'all_pass').length, all.filter((v) => v.target === t.id && finished(v)).length) }))
    .filter((x) => x.r.n > 0).sort((a, b) => b.r.p - a.r.p)

  // models
  const modelRows: BarRow[] = o.models.map((m) => {
    const vs = fin.filter((v) => v.model === m.label)
    return { key: m.label, label: prettyModel(m.label), family: m.family, r: rate(vs.filter((v) => v.outcome === 'all_pass').length, vs.length), color: C.diverse }
  }).filter((r) => r.r.n > 0).sort((a, b) => b.r.p - a.r.p || b.r.n - a.r.n)
  const top = modelRows[0]

  // reasoning off vs on
  const dumb = o.models.map((m) => {
    const vs = fin.filter((v) => v.model === m.label)
    const off = vs.filter((v) => reasoningOff(v.setting)), on = vs.filter((v) => !reasoningOff(v.setting))
    const k = (xs: RunVariant[]) => xs.filter((v) => v.outcome === 'all_pass').length
    return { key: m.label, label: prettyModel(m.label), family: m.family, off: rate(k(off), off.length), on: rate(k(on), on.length) }
  }).filter((r) => r.off.n > 0 && r.on.n > 0).sort((a, b) => (b.on.p - b.off.p) - (a.on.p - a.off.p))
  const better = dumb.filter((r) => r.on.p > r.off.p).length, worse = dumb.filter((r) => r.on.p < r.off.p).length

  // cost, from the billed cost that OpenRouter reports per request
  const costRows = o.models.map((m) => {
    const vs = fin.filter((v) => v.model === m.label && v.cost_usd !== null)
    return { key: m.label, label: prettyModel(m.label), family: m.family, cost: vs.reduce((s, v) => s + (v.cost_usd ?? 0), 0) / Math.max(vs.length, 1), r: rate(vs.filter((v) => v.outcome === 'all_pass').length, vs.length) }
  }).filter((r) => r.r.n > 0 && r.cost > 0)
  const cheapestGood = [...costRows].filter((r) => r.r.p >= 0.5).sort((a, b) => a.cost - b.cost)[0]

  const shared = sharedFaults(rows)
  const ov = advanced ? overlap(rows) : null
  const firstVote = votes[0]

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Experiment" title="Findings"
        description="What the data says so far. Each sentence is computed from the chart under it and updates while the run goes on."
        actions={
          <div className="flex rounded-lg border bg-muted/60 p-0.5" role="group" aria-label="View">
            {[[false, 'Simple'], [true, 'Advanced']].map(([v, l]) => (
              <button key={String(v)} onClick={() => setAdvanced(v as boolean)} aria-pressed={advanced === v}
                className={cn('h-7 cursor-pointer rounded-md px-3 text-[13px] transition-colors', advanced === v ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{l as string}</button>
            ))}
          </div>
        } />

      <div className="space-y-3">
        <StatusStrip o={o} />
        <div className="z-20 -mx-1 rounded-xl bg-background/85 px-1 py-1 backdrop-blur-md md:sticky md:top-2">
          <TargetPicker targets={o.targets} value={spec} onChange={setSpec} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Variants finished" icon={Layers} value={fin.length} hint={`generated and tested, ${scope}`} to="/run/matrix" />
        <Tile label="Compile" icon={ShieldCheck} value={code.length ? pct(compiled.length / code.length) : 'n/a'} hint={`${compiled.length} of ${code.length} with code`} />
        <Tile label="Pass every test" icon={ShieldCheck} value={fin.length ? pct(pass.length / fin.length) : 'n/a'} hint={`${pass.length} of ${fin.length} finished`} />
        <Tile label="Distinct fault patterns" icon={GitFork} value={patterns} hint="different sets of failing tests" to="/run/failures" />
      </div>

      <Section icon={Layers} title="How the variants came out" kicker="per target">
        <ChartCard title="Outcome per target" name="findings-outcome-per-target">
          <div className="mb-3"><Sentence>{bestSpec.length > 1
            ? <>{bestSpec[0].t.name} is the easiest so far: <b>{pct(bestSpec[0].r.p)}</b> of its finished variants pass every test. {bestSpec[bestSpec.length - 1].t.name} is the hardest with <b>{pct(bestSpec[bestSpec.length - 1].r.p)}</b>.</>
            : bestSpec[0] ? <>{pct(bestSpec[0].r.p)} of the finished variants of {bestSpec[0].t.name} pass every test.</> : 'No target has finished variants yet.'}</Sentence></div>
          <OutcomeBarsSvg rows={specRows} />
          <HowTo id="outcome-target"><p>One bar per target, split by how each variant came out: green passes every test of the suite, yellow compiles but fails some tests, orange does not compile, red has no usable code or the request failed. Variants still waiting for tests are light blue. The number on the right is how many are done out of all planned.</p></HowTo>
        </ChartCard>
      </Section>

      <Section icon={ShieldCheck} title="Which models do best" kicker={scope}>
        <ChartCard title="Share of variants that pass every test" name="findings-pass-per-model">
          <div className="mb-3"><Sentence>{top ? <><b>{top.label}</b> passes every test in {top.r.k} of {top.r.n} finished variants ({pct(top.r.p)}){modelRows.length > 1 ? <>; <b>{modelRows[modelRows.length - 1].label}</b> in {modelRows[modelRows.length - 1].r.k} of {modelRows[modelRows.length - 1].r.n}</> : null}.</> : 'No finished variants yet.'}</Sentence></div>
          <Measured>{(w) => <RateBars rows={modelRows} advanced={advanced} width={Math.min(w, 1100)} />}</Measured>
          <HowTo id="models"><p>Each bar is the share of a model's finished variants (all settings and samples) that pass every test. A variant that does not compile or has no code counts as not passing. The letter badge marks the model vendor.</p>{advanced && <p>The whisker is the 95% Wilson interval: with few variants the true rate can be far from the bar. Bars whose whiskers overlap a lot are not clearly different.</p>}</HowTo>
        </ChartCard>
      </Section>

      <Section icon={Brain} title="Does reasoning help?" kicker="off against on, same model">
        <ChartCard title="Pass every test: reasoning off and on" name="findings-reasoning" description={<Legend items={[['Reasoning off', C.off], ['Reasoning on', C.on]]} />}>
          <div className="mb-3"><Sentence>{dumb.length ? <>With reasoning on, <b>{better} of {dumb.length}</b> models pass every test more often than with it off; {worse} pass less often{dumb.length - better - worse ? `, and ${dumb.length - better - worse} the same` : ''}.</> : 'No model has finished variants with both reasoning off and on yet.'}</Sentence></div>
          {dumb.length > 0 && <Measured>{(w) => <Dumbbell rows={dumb} width={Math.min(w, 1100)} />}</Measured>}
          {advanced && dumb.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead><tr className="border-b text-muted-foreground"><th className="py-1.5 text-left font-medium">Model</th><th className="text-right font-medium">Off</th><th className="text-right font-medium">On</th><th className="text-right font-medium">Difference</th><th className="pr-1 text-right font-medium"><Tooltip content="Two-sided Fisher exact test of pass/not pass, off against on. Below 0.05 is usually read as a real difference; with many models some small values appear by chance."><span className="cursor-help underline decoration-dotted">Fisher p</span></Tooltip></th></tr></thead>
                <tbody>{dumb.map((r) => { const p = fisher(r.off.k, r.off.n - r.off.k, r.on.k, r.on.n - r.on.k); return (
                  <tr key={r.key} className="border-b last:border-0"><td className="py-1.5">{r.label}</td><td className="text-right">{r.off.k}/{r.off.n}</td><td className="text-right">{r.on.k}/{r.on.n}</td><td className="text-right">{Math.round((r.on.p - r.off.p) * 100)} pt</td><td className={cn('pr-1 text-right', p < 0.05 && 'font-semibold text-primary')}>{p < 0.001 ? '<0.001' : p.toFixed(3)}</td></tr>) })}</tbody>
              </table>
            </div>
          )}
          <HowTo id="reasoning"><p>Grey dot: share of a model's variants with reasoning off that pass every test. Blue dot: the same with reasoning on (any effort). The number on the right is the difference in percentage points. Models that only run one way are left out.</p><p>A setting counts as "off" when its name starts with OFF; every other setting counts as "on".</p></HowTo>
        </ChartCard>
      </Section>

      <Section icon={GitFork} title="N-version view: do different models fail in different places?" kicker="2-of-3 majority vote">
        <ChartCard title="How often a 2-of-3 majority vote still gets a test wrong" name="findings-majority-vote"
          description={<Legend items={[['One version alone', C.one], ['Vote of 3 samples of the same model', C.same], ['Vote of 3 different models', C.diverse]]} />}>
          <div className="mb-3"><Sentence>{firstVote
            ? <>In {firstVote.name}, one version alone fails at least one test in <b>{pct(firstVote.v.single.p)}</b> of cases. A majority vote of three <b>different models</b> fails in <b>{pct(firstVote.v.diverse.p)}</b>, and a vote of three samples of the <b>same model</b> in <b>{pct(firstVote.v.same.p)}</b>.</>
            : 'A target needs at least three versions with code for this view.'}</Sentence></div>
          {votes.length > 0 && <Measured>{(w) => <VoteBars rows={votes.map((x) => ({ key: x.key, label: x.label, v: x.v }))} advanced={advanced} width={Math.min(w, 1100)} />}</Measured>}
          {advanced && votes.some((x) => x.vc) && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead><tr className="border-b text-muted-foreground"><th className="py-1.5 text-left font-medium">Target</th><th className="text-right font-medium">Versions</th><th className="text-right font-medium">Models</th><th className="text-right font-medium">One fails</th><th className="text-right font-medium">Same-model vote fails</th><th className="pr-1 text-right font-medium">3-model vote fails</th></tr></thead>
                <tbody>{votes.map((x) => (
                  <React.Fragment key={x.key}>
                    <tr className="border-b"><td className="py-1.5">{x.label}, all with code</td><td className="text-right">{x.v.versions}</td><td className="text-right">{x.v.models}</td><td className="text-right">{x.v.single.k}/{x.v.single.n}</td><td className="text-right">{x.v.same.k.toLocaleString()}/{x.v.same.n.toLocaleString()}</td><td className="pr-1 text-right">{x.v.diverse.k.toLocaleString()}/{x.v.diverse.n.toLocaleString()}</td></tr>
                    {x.vc && <tr className="border-b text-muted-foreground"><td className="py-1.5 pl-3">only compiled</td><td className="text-right">{x.vc.versions}</td><td className="text-right">{x.vc.models}</td><td className="text-right">{pct(x.vc.single.p)}</td><td className="text-right">{x.vc.same.n ? pct(x.vc.same.p) : 'n/a'}</td><td className="pr-1 text-right">{x.vc.diverse.n ? pct(x.vc.diverse.p) : 'n/a'}</td></tr>}
                  </React.Fragment>
                ))}</tbody>
              </table>
            </div>
          )}
          <HowTo id="vote">
            <p>N-version programming runs several independently written versions and takes the majority answer. The vote is only wrong on a test when at least two of the three versions fail that same test. So diversity matters: if the versions fail in different places, the vote hides their faults.</p>
            <p>For every target, every possible group of three versions is checked: groups of three samples of one model, and groups of three different models. A version that does not compile counts as failing every test. Lower bars are better. If the blue bar is much lower than the grey one, different models fail in more different places than repeated samples of one model.</p>
            {advanced && <p>The table counts every triple once. "Only compiled" leaves out versions that do not compile, which isolates the effect of logic faults.</p>}
          </HowTo>
        </ChartCard>

        <div className={cn('grid gap-4', advanced && 'xl:grid-cols-2')}>
          <ChartCard title="Faults that many versions share" name="findings-shared-faults" description="Tests failed by the most compiled versions. Shared faults are what a vote cannot hide.">
            {shared.tests.length ? <>
              <div className="mb-3"><Sentence>The most shared fault, <b>{readableTest(shared.tests[0].test)}</b>, appears in {shared.tests[0].variants} of {shared.compiled} compiled versions, from <b>{shared.tests[0].models} different models</b>.</Sentence></div>
              <ul className="space-y-2.5">
                {shared.tests.map((t) => (
                  <li key={t.test} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                    <Tooltip content={t.test}><span className="truncate text-[13px]">{readableTest(t.test)}</span></Tooltip>
                    <span className="text-xs text-muted-foreground tabular-nums">{t.variants} version{t.variants === 1 ? '' : 's'} · {t.models} model{t.models === 1 ? '' : 's'}</span>
                    <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-secondary"><span className="block h-full rounded-full" style={{ width: `${(t.variants / Math.max(shared.compiled, 1)) * 100}%`, background: C.one }} /></span>
                  </li>
                ))}
              </ul>
              <Link to={`/run/failures${spec ? `?target=${spec}` : ''}`} className="mt-4 inline-flex items-center gap-1 text-xs text-primary hover:underline">All failing tests and patterns<ArrowRight className="size-3.5" /></Link>
            </> : <p className="text-sm text-muted-foreground">No compiled version fails a test yet.</p>}
          </ChartCard>
          {advanced && ov && (
            <ChartCard title="Fault overlap between models" name="findings-fault-overlap" description="Darker: when both models fail, they more often fail a common test. Pairs of failing compiled versions, different models.">
              <OverlapHeatmap data={ov} families={families} />
            </ChartCard>
          )}
        </div>
      </Section>

      {costRows.length > 1 && (
        <Section icon={Coins} title="Cost against quality" kicker="billed cost per variant">
          <ChartCard title="Mean cost per variant and share passing every test" name="findings-cost-quality">
            <div className="mb-3"><Sentence>{cheapestGood ? <>The cheapest model that passes every test in at least half of its variants is <b>{cheapestGood.label}</b>, at {usd(cheapestGood.cost)} per variant ({pct(cheapestGood.r.p)} pass).</> : 'No model passes every test in half of its variants yet.'}</Sentence></div>
            <Measured>{(w) => <CostScatter rows={costRows} width={Math.min(w, 1100)} />}</Measured>
            <HowTo id="cost"><p>Each badge is one model: further right costs more per variant (billed cost, log scale), higher passes every test more often. Up and to the left is best. Models without a reported cost are not shown.</p></HowTo>
          </ChartCard>
        </Section>
      )}
    </div>
  )
}
