import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp } from 'lucide-react'
import * as React from 'react'
import { PageHeader } from '@/components/common'
import { Card, Skeleton, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives'
import { ChartCard, FilterBar, Measured, ModelName, OutcomeBarsSvg, prettyModel, settingLabel, SETTING, useRunFilter, useRunOverview } from '@/features/run/shared'
import { runApi, type RunVariant } from '@/lib/api'
import { cn, int, usd } from '@/lib/utils'

// Models and settings side by side: how often the code compiles and passes, and what it costs in tokens, time and money.

type Stat = { key: string; label: string; family?: string; done: number; finished: number; tested: number; compiled: number; allPass: number; tokens: number | null; reasoning: number | null; seconds: number | null; cost: number | null; rows: RunVariant[] }

const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

function stats(rows: RunVariant[], key: (r: RunVariant) => string, label: (k: string) => string, order: string[], family?: (k: string) => string): Stat[] {
  return order.map((k) => {
    const g = rows.filter((r) => key(r) === k)
    const done = g.filter((r) => r.outcome !== 'pending' && r.outcome !== 'running')
    const tested = g.filter((r) => r.compiled !== null)
    return {
      key: k, label: label(k), family: family?.(k), rows: g, done: done.length, tested: tested.length,
      finished: g.filter((r) => ['all_pass', 'partial', 'compile_error', 'no_code'].includes(r.outcome)).length,
      compiled: tested.filter((r) => r.compiled).length, allPass: g.filter((r) => r.outcome === 'all_pass').length,
      tokens: mean(done.map((r) => r.completion_tokens)), reasoning: mean(done.map((r) => r.reasoning_tokens)),
      seconds: mean(done.map((r) => r.seconds)), cost: mean(done.map((r) => r.cost_usd)),
    }
  })
}

/** Simple horizontal bars for one measure. One hue, the value is printed at the end of each bar. */
type BarDatum = { label: string; value: number | null }
function BarsSvg({ data, format }: { data: BarDatum[]; format: (v: number) => string }) {
  return <Measured min={480}>{(w) => <Bars data={data} format={format} width={Math.min(w, 900)} />}</Measured>
}

function Bars({ data, format, width }: { data: BarDatum[]; format: (v: number) => string; width: number }) {
  const labelW = 170
  const rowH = 24
  const plotW = width - labelW - 70
  const max = Math.max(...data.map((d) => d.value ?? 0), 1e-9)
  return (
    <svg data-chart viewBox={`0 0 ${width} ${data.length * rowH + 4}`} width={width} height={data.length * rowH + 4} className="text-foreground" role="img">
      {data.map((d, i) => {
        const w = ((d.value ?? 0) / max) * plotW
        const y = i * rowH + 5
        return (
          <g key={d.label}>
            <text x={labelW - 10} y={y + 7} dominantBaseline="middle" textAnchor="end" fontSize={12} fill="currentColor">{d.label}</text>
            <rect x={labelW} y={y} width={Math.max(w, d.value ? 2 : 0)} height={14} rx={4} fill="#2383e2"><title>{`${d.label}: ${d.value === null ? 'n/a' : format(d.value)}`}</title></rect>
            <text x={labelW + w + 6} y={y + 7} dominantBaseline="middle" fontSize={11} fill="currentColor" opacity={0.7}>{d.value === null ? 'n/a' : format(d.value)}</text>
          </g>
        )
      })}
    </svg>
  )
}

type SortKey = 'label' | 'done' | 'compiled' | 'allPass' | 'tokens' | 'reasoning' | 'seconds' | 'cost'
const share = (a: number, b: number) => (b ? a / b : -1)

/** A rate as a number and a thin bar under it, so the column can be scanned at a glance. */
function RateCell({ k, n, color }: { k: number; n: number; color: string }) {
  if (!n) return <span className="text-muted-foreground">n/a</span>
  return (
    <div className="ml-auto w-24">
      <div className="tabular-nums"><span className="font-medium">{Math.round((k / n) * 100)}%</span> <span className="text-[11px] text-muted-foreground">{k}/{n}</span></div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full" style={{ width: `${(k / n) * 100}%`, background: color }} /></div>
    </div>
  )
}

function StatTable({ rows, first }: { rows: Stat[]; first: string }) {
  const [sort, setSort] = React.useState<{ key: SortKey; desc: boolean }>({ key: 'label', desc: false })
  const [showAll, setShowAll] = React.useState(false)
  const value = (s: Stat, k: SortKey): number | string => k === 'label' ? '' : k === 'compiled' ? share(s.compiled, s.tested) : k === 'allPass' ? share(s.allPass, s.finished) : (s[k] as number | null) ?? -1
  const started = rows.filter((s) => s.done > 0)
  const list = (showAll ? rows : started).map((s, i) => ({ s, i }))
  if (sort.key !== 'label') list.sort((a, b) => ((value(a.s, sort.key) as number) - (value(b.s, sort.key) as number)) * (sort.desc ? -1 : 1))
  const head = (k: SortKey, label: string, right = true) => (
    <TH className={cn('sticky top-0 z-10 bg-card', right && 'text-right')}>
      <button onClick={() => setSort({ key: k, desc: sort.key === k ? !sort.desc : k !== 'label' })} className={cn('inline-flex cursor-pointer items-center gap-1 hover:text-foreground', sort.key === k && 'text-foreground')}>
        {label}{sort.key === k && k !== 'label' ? (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />) : null}
      </button>
    </TH>
  )
  return (
    <Card className="overflow-hidden">
      <div className="max-h-[70vh] overflow-auto">
        <Table>
          <THead><TR>{head('label', first, false)}{head('done', 'Done')}{head('compiled', 'Compiles')}{head('allPass', 'Passes all')}{head('tokens', 'Output tokens')}{head('reasoning', 'Reasoning tokens')}{head('seconds', 'Time')}{head('cost', 'Cost')}</TR></THead>
          <TBody>
            {list.map(({ s }) => (
              <TR key={s.key} className={cn(!s.done && 'opacity-50')}>
                <TD className="whitespace-nowrap">{s.family ? <ModelName label={s.key} family={s.family} /> : s.label}</TD>
                <TD className="text-right tabular-nums">{s.done}<span className="text-muted-foreground">/{s.rows.length}</span></TD>
                <TD className="text-right"><RateCell k={s.compiled} n={s.tested} color="#9aa3b2" /></TD>
                <TD className="text-right"><RateCell k={s.allPass} n={s.finished} color="#0ca30c" /></TD>
                <TD className="text-right tabular-nums">{int(s.tokens === null ? null : Math.round(s.tokens))}</TD>
                <TD className="text-right tabular-nums">{int(s.reasoning === null ? null : Math.round(s.reasoning))}</TD>
                <TD className="text-right tabular-nums">{s.seconds === null ? 'n/a' : `${Math.round(s.seconds)} s`}</TD>
                <TD className="text-right tabular-nums">{s.cost === null ? <span className="text-muted-foreground">n/a</span> : usd(s.cost)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
        <span>Compiles: of the variants with code. Passes all: of the finished variants (no usable code counts as not passing, failed requests are left out). Means per finished variant. Click a column title to sort.</span>
        {rows.length > started.length && <button onClick={() => setShowAll(!showAll)} className="ml-auto cursor-pointer text-primary hover:underline">{showAll ? 'Hide' : 'Show'} {rows.length - started.length} not started yet</button>}
      </div>
    </Card>
  )
}

export function RunComparePage() {
  const o = useRunOverview().data
  const [f] = useRunFilter()
  const q = useQuery({ queryKey: ['run', 'variants', { target: f.target, sample: f.sample }], queryFn: () => runApi.variants({ target: f.target, sample: f.sample }), refetchInterval: 30000 })
  const [by, setBy] = React.useState<'model' | 'setting' | 'reasoning'>('model')
  if (!o || !q.data) return <div className="space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-96" /></div>
  const rows = q.data
  const families = Object.fromEntries(o.models.map((m) => [m.label, m.family]))
  const groups = by === 'model'
    ? stats(rows, (r) => r.model, prettyModel, o.models.map((m) => m.label), (k) => families[k])
    : by === 'setting'
      ? stats(rows, (r) => r.setting, settingLabel, Object.keys(o.settings))
      : stats(rows, (r) => (r.setting.startsWith('OFF') ? 'off' : 'on'), (k) => (k === 'off' ? 'Reasoning off' : 'Reasoning on'), ['off', 'on'])
  const tested = groups.filter((g) => g.tested > 0)
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Experiment" title="Models and settings"
        description="Compare the models, the request settings, or reasoning off against on. Every chart can be downloaded as PNG or SVG." />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border bg-muted/60 p-0.5 text-[13px]">
          {(['model', 'setting', 'reasoning'] as const).map((k) => (
            <button key={k} onClick={() => setBy(k)} aria-pressed={by === k} className={cn('h-7 cursor-pointer rounded-md px-3 transition-colors', by === k ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {k === 'model' ? 'By model' : k === 'setting' ? 'By setting' : 'Reasoning off vs on'}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1"><FilterBar overview={o} show={['target', 'sample']} /></div>
      </div>
      {by === 'setting' && <p className="text-xs text-muted-foreground">{Object.keys(o.settings).map((s) => `${settingLabel(s)}: ${SETTING[s]?.text ?? s}`).join(' ')}</p>}

      <StatTable rows={groups} first={by === 'model' ? 'Model' : 'Setting'} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="Outcomes" name={`outcomes-by-${by}`} description="Every planned variant in this selection.">
          <OutcomeBarsSvg rows={groups.filter((g) => g.done > 0).map((g) => ({ key: g.key, label: g.label, total: g.rows.length,
            counts: Object.fromEntries(['all_pass', 'partial', 'compile_error', 'no_code', 'api_error', 'testing', 'running'].map((k) => [k, g.rows.filter((r) => r.outcome === k).length])) }))} />
        </ChartCard>
        <ChartCard title="Passes every test, share of finished variants" name={`all-pass-rate-by-${by}`} description="No usable code counts as not passing; failed requests are left out. The same rule as on Findings.">
          <BarsSvg data={groups.filter((g) => g.finished > 0).map((g) => ({ label: g.label, value: g.allPass / g.finished }))} format={(v) => `${Math.round(v * 100)}%`} />
        </ChartCard>
        <ChartCard title="Mean output tokens" name={`output-tokens-by-${by}`} description="Includes reasoning tokens, which are billed as output.">
          <BarsSvg data={groups.filter((g) => g.tokens !== null).map((g) => ({ label: g.label, value: g.tokens }))} format={(v) => Math.round(v).toLocaleString()} />
        </ChartCard>
        <ChartCard title="Mean answer time" name={`time-by-${by}`} description="Seconds from sending the request to the full answer.">
          <BarsSvg data={groups.filter((g) => g.seconds !== null).map((g) => ({ label: g.label, value: g.seconds }))} format={(v) => `${Math.round(v)} s`} />
        </ChartCard>
        <ChartCard title="Mean cost per variant" name={`cost-by-${by}`} description="As billed by OpenRouter (usage.cost of each answer).">
          <BarsSvg data={groups.filter((g) => g.cost !== null).map((g) => ({ label: g.label, value: g.cost }))} format={(v) => `$${v.toFixed(4)}`} />
        </ChartCard>
        <ChartCard title="Compiles, share of variants with code" name={`compile-rate-by-${by}`}>
          <BarsSvg data={tested.map((g) => ({ label: g.label, value: g.compiled / g.tested }))} format={(v) => `${Math.round(v * 100)}%`} />
        </ChartCard>
      </div>
    </div>
  )
}
