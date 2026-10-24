import { useQuery } from '@tanstack/react-query'
import { Ban, Check, CheckCircle2, Clock, CloudOff, Download, FileX2, FlaskConical, Hammer, Link2, Loader2, SlidersHorizontal, TriangleAlert, type LucideIcon } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { CollapseBody, FoldChevron } from '@/components/ui/collapsible'
import { Card, Tooltip } from '@/components/ui/primitives'
import { runApi, type RunFilter, type RunOutcome, type RunOverview, type RunScore } from '@/lib/api'
import { cn } from '@/lib/utils'

// Shared pieces of the run pages: outcome colours and icons, model badges, the URL filter bar, chart export.

/** Outcome ladder, best first. Colours are status colours, always shown with an icon and a label. */
export const OUTCOME: Record<RunOutcome, { label: string; short: string; color: string; icon: LucideIcon; text: string }> = {
  all_pass: { label: 'Passes every test', short: 'All pass', color: '#0ca30c', icon: CheckCircle2,
    text: 'Compiles and passes every test of the suite.' },
  partial: { label: 'Fails some tests', short: 'Some fail', color: '#fab219', icon: TriangleAlert,
    text: 'Compiles, but at least one test of the suite fails. These are the faults that are compared.' },
  compile_error: { label: 'Does not compile', short: 'No compile', color: '#ec835a', icon: Hammer,
    text: 'The compiler rejects the code, so no test can run.' },
  no_code: { label: 'No usable code', short: 'No code', color: '#d03b3b', icon: FileX2,
    text: 'The model answered, but the answer had no code block, was empty or was cut off at the token limit.' },
  api_error: { label: 'Request failed', short: 'API error', color: '#9b2c2c', icon: CloudOff,
    text: 'The request did not return a usable answer (HTTP error, wrong provider, or it needs a manual look).' },
  testing: { label: 'Waiting for tests', short: 'Testing', color: '#7aa7d9', icon: FlaskConical,
    text: 'The code is saved, and the test run has not finished yet.' },
  running: { label: 'Generating now', short: 'Running', color: '#2383e2', icon: Loader2,
    text: 'The request is in flight or being retried.' },
  pending: { label: 'Not started', short: 'Pending', color: '#c9c9c6', icon: Clock,
    text: 'Planned in the run config, not sent yet.' },
}
export const OUTCOME_ORDER: RunOutcome[] = ['all_pass', 'partial', 'compile_error', 'no_code', 'api_error', 'testing', 'running', 'pending']

export function OutcomeBadge({ outcome, className }: { outcome: RunOutcome; className?: string }) {
  const o = OUTCOME[outcome]
  const Icon = o.icon
  return (
    <Tooltip content={o.text}>
      <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-1.5 py-px text-[12px] leading-[18px]', className)}>
        <Icon className={cn('size-3.5', outcome === 'running' && 'animate-spin')} style={{ color: o.color }} strokeWidth={2} />
        {o.label}
      </span>
    </Tooltip>
  )
}

/** Plain-language names of the usual request settings; any other setting is described from its request fields. */
export const SETTING: Record<string, { label: string; text: string }> = {
  'OFF-T0.2': { label: 'Off, T 0.2', text: 'Reasoning off, temperature 0.2 (close to deterministic).' },
  'OFF-T0.8': { label: 'Off, T 0.8', text: 'Reasoning off, temperature 0.8 (more random).' },
  'ON-LOW': { label: 'On, low', text: 'Reasoning on, low effort. Temperature is the provider default.' },
  'ON-HIGH': { label: 'On, high', text: 'Reasoning on, high effort. Temperature is the provider default.' },
  'ON-DEFAULT': { label: 'On, default', text: 'Reasoning on at the model default (for models without effort levels).' },
}
export const settingLabel = (s: string) => SETTING[s]?.label ?? s
/** What a setting sends: its plain description, or its request fields from the run config. */
export function settingText(s: string, fields?: Record<string, unknown>) {
  return SETTING[s]?.text ?? (fields ? JSON.stringify(fields) : s)
}
/** Why a model has no cell for a setting. */
export const skipText = () => 'Not planned: this model skips the setting in the run config (skip_settings, or a null override).'

const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
export const familyColor = (family: string) => PALETTE[[...family].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length]

export const familyLetter = (family: string) => (family || '?').replace(/^demo-lab-/, '')[0] ?? '?'

/** The letter badge drawn inside an SVG chart, centred on (cx, cy). */
export function LogoSvg({ family, cx, cy, size = 16 }: { family: string; cx: number; cy: number; size?: number }) {
  return (
    <g aria-hidden>
      <rect x={cx - size / 2} y={cy - size / 2} width={size} height={size} rx={3} fill={familyColor(family || '?')} />
      <text x={cx} y={cy + 0.5} fontSize={size * 0.58} fontWeight={600} textAnchor="middle" dominantBaseline="middle" fill="#fff" style={{ textTransform: 'uppercase' }}>{familyLetter(family)}</text>
    </g>
  )
}

/** A small badge with the first letter of the model's vendor, in a colour that stays the same for that vendor. */
export function Logo({ family, className }: { family: string; className?: string }) {
  return (
    <span className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded text-[9px] font-semibold uppercase text-white', className)}
      style={{ background: familyColor(family || '?') }} aria-hidden>{familyLetter(family)}</span>
  )
}

/** Model labels from the config, made readable: "deepseek-v4-pro" becomes "DeepSeek V4 Pro". */
const WORDS: Record<string, string> = { deepseek: 'DeepSeek', qwen: 'Qwen', minimax: 'MiniMax', gemini: 'Gemini', mistral: 'Mistral', kimi: 'Kimi', glm: 'GLM', gpt: 'GPT' }
export function prettyModel(label: string) {
  return label.split('-').map((w) => {
    const base = w.replace(/[\d.]+$/, '')
    const tail = w.slice(base.length)
    if (WORDS[w]) return WORDS[w]
    if (base && WORDS[base]) return WORDS[base] + tail
    if (/^[a-z]\d/.test(w)) return w.toUpperCase()
    return /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w
  }).join(' ')
}

export function ModelName({ label, family, className }: { label: string; family: string; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <Logo family={family} />
      <span className="truncate">{prettyModel(label)}</span>
    </span>
  )
}

/** "tipjar/glm-5.3/ON-HIGH/s01" as its parts. */
export function parseId(id: string) {
  const [target, model, setting, sample] = id.split('/')
  return { target, model, setting, sample: Number(sample?.slice(1)) }
}
export const variantLink = (id: string) => `/run/v?id=${encodeURIComponent(id)}`

export function VariantLink({ id, families, className }: { id: string; families?: Record<string, string>; className?: string }) {
  const p = parseId(id)
  return (
    <Link to={variantLink(id)} className={cn('inline-flex items-center gap-1.5 hover:underline', className)}>
      {families && <Logo family={families[p.model] ?? ''} className="size-3.5" />}
      <span>{prettyModel(p.model)}</span>
      <span className="text-muted-foreground">{settingLabel(p.setting)}, s{String(p.sample).padStart(2, '0')}</span>
    </Link>
  )
}

/**
 * What the OpenRouter generator is doing, one rule for every page: requests in flight = generating; the last event is
 * a stop_cap event since the run's credit check = stopped at its spending cap; everything done = complete; otherwise paused (no generator running).
 */
export type RunState = 'generating' | 'stopped_cap' | 'complete' | 'paused'
export function runState(o: RunOverview): RunState {
  if (o.in_flight.length > 0) return 'generating'
  if (o.done >= o.planned && o.planned > 0) return 'complete'
  if (o.stopped_cap) return 'stopped_cap'
  return 'paused'
}
export const RUN_STATE: Record<RunState, { label: string; dot: string; live: boolean }> = {
  generating: { label: 'Generating now', dot: 'bg-primary', live: true },
  stopped_cap: { label: 'Stopped at the spending cap', dot: 'bg-warning', live: false },
  complete: { label: 'Run complete', dot: 'bg-success', live: false },
  paused: { label: 'Paused, no request running', dot: 'bg-muted-foreground/40', live: false },
}

/** The coloured dot of a run state; it pulses while requests are in flight. */
export function RunStateDot({ state }: { state: RunState }) {
  const s = RUN_STATE[state]
  return (
    <span className="relative flex size-2 shrink-0">
      {s.live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />}
      <span className={cn('relative inline-flex size-2 rounded-full', s.dot)} />
    </span>
  )
}

export function useRunOverview() {
  return useQuery({ queryKey: ['run', 'overview'], queryFn: runApi.overview, refetchInterval: 15000 })
}
/** label -> family, for logos next to variant ids. */
export function useFamilies() {
  const o = useRunOverview()
  return React.useMemo(() => Object.fromEntries((o.data?.models ?? []).map((m) => [m.label, m.family])), [o.data])
}

/** Filters live in the URL, so a view can be shared as a link. */
export function useRunFilter(): [RunFilter, (k: keyof RunFilter, v: string) => void] {
  const [params, setParams] = useSearchParams()
  const f: RunFilter = {
    target: params.get('target') ?? undefined, model: params.get('model') ?? undefined,
    setting: params.get('setting') ?? undefined, outcome: params.get('outcome') ?? undefined,
    sample: params.get('sample') ? Number(params.get('sample')) : undefined,
  }
  const set = (k: keyof RunFilter, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }
  return [f, set]
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground max-sm:w-[calc(50%-0.5rem)] max-sm:flex-col max-sm:items-stretch max-sm:gap-0.5">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border bg-card px-2 text-[13px] sm:h-8 text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40">
        <option value="">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

/** Copies the current address, filters included, so a view can be sent to someone. */
export function CopyLinkButton({ className }: { className?: string }) {
  const [done, setDone] = React.useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setDone(true); setTimeout(() => setDone(false), 1600) } catch { /* clipboard blocked */ }
  }
  return (
    <Tooltip content="Copy a link to exactly this view, filters included">
      <button onClick={copy} className={cn('inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground', className)}>
        {done ? <Check className="size-3.5 text-success" /> : <Link2 className="size-3.5" />}{done ? 'Copied' : 'Copy link'}
      </button>
    </Tooltip>
  )
}

/**
 * The filters of a page. Desktop: one row that stays at the top while the page scrolls.
 * Phone: a single "Filters" row that opens the selects, so it never takes half the screen.
 */
export function FilterBar({ overview, show = ['target', 'model', 'setting', 'sample', 'outcome'] }: { overview?: RunOverview; show?: (keyof RunFilter)[] }) {
  const [f, set] = useRunFilter()
  const [open, setOpen] = React.useState(false)
  if (!overview) return null
  const on = show.filter((k) => f[k] !== undefined).length
  const selects = <>
    {show.includes('target') && <Select label="Target" value={f.target ?? ''} onChange={(v) => set('target', v)} options={overview.targets.map((t) => [t.id, t.name])} />}
    {show.includes('model') && <Select label="Model" value={f.model ?? ''} onChange={(v) => set('model', v)} options={overview.models.map((m) => [m.label, prettyModel(m.label)])} />}
    {show.includes('setting') && <Select label="Setting" value={f.setting ?? ''} onChange={(v) => set('setting', v)} options={Object.keys(overview.settings).map((s) => [s, settingLabel(s)])} />}
    {show.includes('sample') && <Select label="Sample" value={f.sample ? String(f.sample) : ''} onChange={(v) => set('sample', v)} options={Array.from({ length: overview.samples }, (_, i) => [String(i + 1), `s${String(i + 1).padStart(2, '0')}`])} />}
    {show.includes('outcome') && <Select label="Outcome" value={f.outcome ?? ''} onChange={(v) => set('outcome', v)} options={OUTCOME_ORDER.map((o) => [o, OUTCOME[o].label])} />}
  </>
  const clear = on > 0 && <Link to="?" replace className="inline-flex h-8 items-center rounded-md px-2 text-xs text-primary hover:bg-accent">Clear</Link>
  return (
    <div className="z-20 rounded-lg border bg-card/95 shadow-[0_1px_2px_rgba(0,0,0,0.03)] backdrop-blur-md md:sticky md:top-3">
      <div className="flex items-center gap-1 px-3 py-2 md:hidden">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-8 flex-1 cursor-pointer items-center gap-2 text-left text-[13px] font-medium">
          <SlidersHorizontal className="size-4 text-muted-foreground" />Filters
          {on > 0 ? <span className="rounded-full bg-primary px-1.5 text-[11px] leading-[18px] text-primary-foreground tabular-nums">{on}</span> : <span className="text-xs font-normal text-muted-foreground">showing all</span>}
          <FoldChevron open={open} className="ml-auto" />
        </button>
        {clear}
      </div>
      <div className="md:hidden"><CollapseBody open={open}><div className="flex flex-wrap gap-x-4 gap-y-2 border-t px-3 pt-2 pb-3">{selects}</div></CollapseBody></div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 max-md:hidden">
        {selects}
        <div className="ml-auto flex items-center gap-1">{clear}<CopyLinkButton /></div>
      </div>
    </div>
  )
}

export function Score({ s, className }: { s: RunScore | null | undefined; className?: string }) {
  if (!s || !s.total) return <span className="text-muted-foreground">n/a</span>
  return <span className={cn('tabular-nums', className)}>{s.passed}<span className="text-muted-foreground">/{s.total}</span></span>
}

/** A horizontal stacked bar of outcomes, with a 2px gap between segments and a tooltip per segment. */
export function OutcomeBar({ counts, total, className, height = 10 }: { counts: Partial<Record<RunOutcome, number>>; total: number; className?: string; height?: number }) {
  return (
    <div className={cn('flex w-full gap-[2px] overflow-hidden rounded-full bg-secondary', className)} style={{ height }}>
      {OUTCOME_ORDER.filter((o) => o !== 'pending' && (counts[o] ?? 0) > 0).map((o) => (
        <Tooltip key={o} content={`${OUTCOME[o].label}: ${counts[o]} of ${total}`}>
          <div className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${((counts[o] ?? 0) / Math.max(total, 1)) * 100}%`, background: OUTCOME[o].color }} />
        </Tooltip>
      ))}
    </div>
  )
}

export function OutcomeLegend({ counts, hide = [] }: { counts?: Partial<Record<RunOutcome, number>>; hide?: RunOutcome[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {OUTCOME_ORDER.filter((o) => !hide.includes(o)).map((o) => {
        const Icon = OUTCOME[o].icon
        return (
          <Tooltip key={o} content={OUTCOME[o].text}>
            <span className="inline-flex cursor-help items-center gap-1.5">
              <Icon className="size-3.5" style={{ color: OUTCOME[o].color }} strokeWidth={2} />
              {OUTCOME[o].short}{counts && <span className="tabular-nums text-foreground">{counts[o] ?? 0}</span>}
            </span>
          </Tooltip>
        )
      })}
    </div>
  )
}

// ---- chart export ---------------------------------------------------------------------------------------------

function svgText(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const style = getComputedStyle(svg)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('style', `font-family:${style.fontFamily};color:${style.color};background:${getComputedStyle(document.body).backgroundColor}`)
  return new XMLSerializer().serializeToString(clone).replaceAll('currentColor', style.color)
}

function save(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function exportChart(svg: SVGSVGElement, name: string, kind: 'svg' | 'png') {
  const text = svgText(svg)
  if (kind === 'svg') return save(new Blob([text], { type: 'image/svg+xml' }), `${name}.svg`)
  const { width, height } = svg.getBoundingClientRect()
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = width * 2
    c.height = height * 2
    const ctx = c.getContext('2d')!
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.scale(2, 2)
    ctx.drawImage(img, 0, 0, width, height)
    c.toBlob((b) => b && save(b, `${name}.png`))
  }
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
}

/** A card holding one SVG chart, with PNG and SVG download buttons. */
export function ChartCard({ title, description, name, children, className }: { title: string; description?: React.ReactNode; name: string; children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const go = (kind: 'svg' | 'png') => { const svg = ref.current?.querySelector('svg[data-chart]'); if (svg) exportChart(svg as SVGSVGElement, name, kind) }
  return (
    <Card className={cn('min-w-0 p-4', className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-60">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <div className="mt-1 text-xs text-muted-foreground">{description}</div>}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="xs" title="Download as PNG image" onClick={() => go('png')}><Download />PNG</Button>
          <Button variant="ghost" size="xs" title="Download as SVG (vector)" onClick={() => go('svg')}><Download />SVG</Button>
        </div>
      </div>
      <div ref={ref} className="-mx-4 overflow-x-auto px-4">{children}</div>
    </Card>
  )
}

/** Renders a chart at the real width of its box, so its 11-12 px text never scales up or down with the screen. */
export function Measured({ children, min = 520 }: { children: (width: number) => React.ReactNode; min?: number }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [w, setW] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return <div ref={ref} className="w-full">{w > 0 && children(Math.max(min, w))}</div>
}

/**
 * Horizontal stacked bars as SVG (so it can be downloaded): one row per group, segments per outcome.
 * Rows are labelled on the left; totals on the right. A native tooltip names every segment.
 */
type OutcomeRow = { key: string; label: string; counts: Partial<Record<RunOutcome, number>>; total: number }
export function OutcomeBarsSvg({ rows }: { rows: OutcomeRow[] }) {
  return <Measured>{(w) => <OutcomeBars rows={rows} width={Math.min(w, 1100)} />}</Measured>
}

function OutcomeBars({ rows, width }: { rows: OutcomeRow[]; width: number }) {
  const labelW = 170
  const rightW = 64
  const rowH = 26
  const barH = 14
  const plotW = width - labelW - rightW
  const shown = OUTCOME_ORDER.filter((o) => o !== 'pending')
  const height = rows.length * rowH + 4
  return (
    <svg data-chart viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="text-foreground" role="img">
      {rows.map((r, i) => {
        let x = labelW
        const y = i * rowH + (rowH - barH) / 2
        const done = shown.reduce((n, o) => n + (r.counts[o] ?? 0), 0)
        return (
          <g key={r.key}>
            <text x={labelW - 10} y={y + barH / 2} dominantBaseline="middle" textAnchor="end" fontSize={12} fill="currentColor">{r.label}</text>
            <rect x={labelW} y={y} width={plotW} height={barH} rx={4} fill="currentColor" opacity={0.06} />
            {shown.map((o) => {
              const n = r.counts[o] ?? 0
              if (!n) return null
              const w = (n / Math.max(r.total, 1)) * plotW
              const seg = <rect key={o} x={x} y={y} width={Math.max(w - 2, 1)} height={barH} rx={3} fill={OUTCOME[o].color}><title>{`${r.label}: ${OUTCOME[o].label} ${n} of ${r.total}`}</title></rect>
              x += w
              return seg
            })}
            <text x={width - rightW + 8} y={y + barH / 2} dominantBaseline="middle" fontSize={11} fill="currentColor" opacity={0.65}>{done}/{r.total}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function EmptyNote({ icon: Icon = Ban, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return <div className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground"><Icon className="size-4" />{children}</div>
}
