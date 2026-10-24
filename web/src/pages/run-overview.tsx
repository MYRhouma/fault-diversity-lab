import { Activity, ArrowRight, Boxes, CheckCircle2, CircleDollarSign, Fingerprint, Hammer, Radio, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader, StatCard } from '@/components/common'
import { Card, Progress, Skeleton, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives'
import { RUN_STATE, runState, RunStateDot, ChartCard, ModelName, OutcomeBarsSvg, OutcomeLegend, prettyModel, settingLabel, settingText, useRunOverview } from '@/features/run/shared'
import type { RunOverview } from '@/lib/api'
import { relativeTime, usd } from '@/lib/utils'

// The run at a glance: what is planned, what is done, where the money went, and how the variants came out.

function LiveBanner({ o }: { o: RunOverview }) {
  const state = runState(o)
  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
      <span className="inline-flex items-center gap-2 font-medium"><RunStateDot state={state} />{RUN_STATE[state].label}</span>
      {o.in_flight.length > 0 && <span className="text-muted-foreground">{o.in_flight.length} request{o.in_flight.length > 1 ? 's' : ''} in flight</span>}
      {o.last_event && (
        <span className="text-muted-foreground">
          Last event: <span className="text-foreground">{o.last_event.event.replaceAll('_', ' ')}</span>
          {o.last_event.id && <> on {o.last_event.id.split('/').slice(1).join(' / ')}</>}, {relativeTime(o.last_event.time)}
        </span>
      )}
      {o.last_command && (
        <details className="group w-full text-xs text-muted-foreground">
          <summary className="inline-flex cursor-pointer select-none items-center gap-1 hover:text-foreground">
            <ChevronRight className="size-3 transition-transform group-open:rotate-90" />{state === 'generating' ? 'Command that is running' : 'Last command that ran'}
          </summary>
          <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted px-2 py-1.5 font-mono text-[11px]">{o.last_command.join(' ')}</pre>
        </details>
      )}
    </Card>
  )
}

export function RunOverviewPage() {
  const q = useRunOverview()
  const o = q.data
  if (!o) return <div className="space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-28" /><Skeleton className="h-80" /></div>
  const finished = o.done
  const allPass = o.by_outcome.all_pass
  // the same rule as Findings and the other pages: of the finished variants (no usable code counts as not passing; API errors are left out)
  const passBase = o.by_outcome.all_pass + o.by_outcome.partial + o.by_outcome.compile_error + o.by_outcome.no_code
  const families = Object.fromEntries(o.models.map((m) => [m.label, m.family]))
  const modelRows = o.models.map((m) => ({ key: m.label, label: prettyModel(m.label), counts: o.by_model[m.label] ?? {}, total: o.by_model[m.label]?.total ?? 0 }))
  const settingRows = Object.keys(o.settings).map((s) => ({ key: s, label: settingLabel(s), counts: o.by_setting[s] ?? {}, total: o.by_setting[s]?.total ?? 0 }))
  const credit = o.credit
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Experiment" title="Run status"
        description="Each model gets the same frozen prompt and writes one program; the same test suite runs on every program unchanged. This page follows the run live and refreshes every 15 seconds." />
      <LiveBanner o={o} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Variants generated" value={`${finished} / ${o.planned}`} hint={`${o.targets.length} target${o.targets.length === 1 ? '' : 's'}, ${o.models.length} models, ${o.samples} samples`} icon={Boxes} />
        <StatCard label="Compile" value={o.tested ? `${Math.round((o.compiled / o.tested) * 100)}%` : 'n/a'} hint={`${o.compiled} of ${o.tested} with code`} icon={Hammer} />
        <StatCard label="Pass every test" value={passBase ? `${Math.round((allPass / passBase) * 100)}%` : 'n/a'} hint={`${allPass} of ${passBase} finished`} icon={CheckCircle2} tone="success" />
        <StatCard label="Distinct fault patterns" value={o.fault_signatures} hint={<Link to="/run/failures" className="text-primary hover:underline">See the faults</Link>} icon={Fingerprint} />
        <StatCard label="Billed so far" value={usd(o.spent_usd)} hint={credit ? `OpenRouter credit left ${usd(credit.limit_remaining)}` : `cap ${usd(o.cap_usd)}`} icon={CircleDollarSign} />
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Activity className="size-4 text-muted-foreground" />Progress per target and sample</h3>
          <OutcomeLegend counts={o.by_outcome} />
        </div>
        <div className="grid gap-x-8 gap-y-3 md:grid-cols-3">
          {o.progress.map((p) => (
            <div key={`${p.target}-${p.sample}`} className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span>{o.targets.find((t) => t.id === p.target)?.name ?? p.target}, sample {p.sample}</span>
                <span className="tabular-nums text-muted-foreground">{p.done}/{p.planned}</span>
              </div>
              <Progress value={(p.done / Math.max(p.planned, 1)) * 100} />
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="Outcome per model" name="outcome-per-model" description="All planned variants of each model. Grey is not done yet.">
          <OutcomeBarsSvg rows={modelRows} />
        </ChartCard>
        <ChartCard title="Outcome per setting" name="outcome-per-setting" description="All planned variants of each request setting, over every model that runs it.">
          <OutcomeBarsSvg rows={settingRows} />
        </ChartCard>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4">
          <h3 className="text-sm font-semibold">Models in the run</h3>
          <Link to="/run/matrix" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Open the results matrix <ArrowRight className="size-3" /></Link>
        </div>
        <Table className="mt-2">
          <THead><TR><TH>Model</TH><TH>Provider</TH><TH className="text-right">Price in / out per 1M</TH><TH className="text-right">Done</TH><TH className="text-right">All pass</TH><TH className="text-right">Some fail</TH><TH className="text-right">No compile</TH><TH className="text-right">Billed</TH></TR></THead>
          <TBody>
            {o.models.map((m) => {
              const g = o.by_model[m.label]
              const done = g ? g.total - g.pending - g.running : 0
              return (
                <TR key={m.label}>
                  <TD><Link to={`/run/matrix?model=${m.label}`} className="hover:underline"><ModelName label={m.label} family={families[m.label]} /></Link></TD>
                  <TD className="text-muted-foreground">{m.provider ?? 'n/a'}</TD>
                  <TD className="text-right tabular-nums text-muted-foreground">{m.price_in === null ? 'n/a' : `$${m.price_in} / $${m.price_out}`}</TD>
                  <TD className="text-right tabular-nums">{done}/{g?.total ?? 0}</TD>
                  <TD className="text-right tabular-nums">{g?.all_pass ?? 0}</TD>
                  <TD className="text-right tabular-nums">{g?.partial ?? 0}</TD>
                  <TD className="text-right tabular-nums">{g?.compile_error ?? 0}</TD>
                  <TD className="text-right tabular-nums">{usd(g?.cost_usd)}</TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Radio className="size-4 text-muted-foreground" />Request settings</h3>
        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(o.settings).map(([k, v]) => (
            <div key={k} className="rounded-md border px-3 py-2">
              <div className="font-medium">{settingLabel(k)} <span className="font-mono text-[11px] text-muted-foreground">{k}</span></div>
              <div className="text-xs text-muted-foreground">{settingText(k)}</div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">{JSON.stringify(v)}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Every request: max_tokens {o.max_tokens?.toLocaleString() ?? 'n/a'}, one pinned provider with no fallback, no automatic re-send once a request may have been billed, and the model never sees compiler or test output.
          The generator's own cap ledger (unknown costs counted at worst case) is at {usd(o.ledger_usd)}.
        </p>
      </Card>
    </div>
  )
}
