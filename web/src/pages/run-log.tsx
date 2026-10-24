import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, CircleDot, KeyRound, OctagonX, Play, Save, Send, Square } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/common'
import { Badge, Card, Skeleton, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives'
import { prettyModel, settingLabel, variantLink } from '@/features/run/shared'
import { runApi, type RunEvent } from '@/lib/api'
import { cn, relativeTime, usd } from '@/lib/utils'

// The generator's event log (runs/main/events.jsonl), newest first.

const KIND: Record<string, { label: string; icon: typeof Play; variant: 'secondary' | 'info' | 'success' | 'warning' | 'destructive' }> = {
  key_check: { label: 'Credit check', icon: KeyRound, variant: 'secondary' },
  planned: { label: 'Planned', icon: CircleDot, variant: 'secondary' },
  start: { label: 'Start', icon: Play, variant: 'info' },
  attempt_sent: { label: 'Sent', icon: Send, variant: 'info' },
  raw_saved: { label: 'Answer saved', icon: Save, variant: 'success' },
  end: { label: 'End', icon: Square, variant: 'success' },
  error: { label: 'Error', icon: AlertTriangle, variant: 'warning' },
  stop_cap: { label: 'Stopped at cap', icon: OctagonX, variant: 'warning' },
  late_response: { label: 'Late answer saved', icon: Save, variant: 'warning' },
}

function detail(e: RunEvent) {
  if (e.event === 'key_check') return `credit left ${usd(e.limit_remaining as number)}, used ${usd(e.usage as number)} of ${usd(e.limit as number)}`
  if (e.event === 'error') return `${e.error ?? ''}${e.action ? `, ${e.action}` : ''}`
  if (e.event === 'raw_saved') return `HTTP ${e.http_status}, ${Number(e.bytes ?? 0).toLocaleString()} bytes`
  if (e.event === 'end') return `${e.status ?? ''}${e.cost_usd !== undefined ? `, ${usd(e.cost_usd as number)}` : ''}`
  if (e.event === 'planned') return `worst case ${usd(e.worst as number)}`
  if (e.event === 'attempt_sent') return `attempt ${e.attempt}`
  if (e.event === 'stop_cap') return `not sent: ledger ${usd(e.ledger as number)} + reserved ${usd(e.reserved as number)} + this request's worst case ${usd(e.worst as number)} would pass the cap of ${usd(e.cap as number)}`
  return ''
}

export function RunLogPage() {
  const [kind, setKind] = React.useState('')
  const q = useQuery({ queryKey: ['run', 'events', kind], queryFn: () => runApi.events(kind || undefined), refetchInterval: 10000 })
  if (!q.data) return <div className="space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-96" /></div>
  const d = q.data
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Experiment" title="Run log"
        description="Every step the generator logged, newest first: planning, sending, retries after rate limits, saved answers and errors. Refreshes every 10 seconds." />
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {['', ...d.kinds].map((k) => {
          const Icon = k ? KIND[k]?.icon ?? CheckCircle2 : null
          return (
            <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
              className={cn('inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors', kind === k ? 'border-primary bg-primary/10 font-medium text-foreground' : 'bg-card text-muted-foreground hover:text-foreground')}>
              {Icon && <Icon className="size-3.5" />}{k ? KIND[k]?.label ?? k : `All (${d.total})`}
            </button>
          )
        })}
      </div>
      {/* phones: one card per event */}
      <ul className="divide-y overflow-hidden rounded-lg border bg-card md:hidden">
        {d.events.map((e, i) => {
          const k = KIND[e.event] ?? { label: e.event, icon: CheckCircle2, variant: 'secondary' as const }
          const Icon = k.icon
          const [, model, setting, sample] = (e.id ?? '').split('/')
          return (
            <li key={`${e.time}-${i}`} className="space-y-1 px-3 py-2.5">
              <div className="flex items-center gap-2"><Badge variant={k.variant}><Icon />{k.label}</Badge><span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{relativeTime(e.time)}</span></div>
              {e.id && <Link to={variantLink(e.id)} className="block text-[13px] hover:underline">{prettyModel(model)} <span className="text-muted-foreground">{settingLabel(setting)}, {sample}</span></Link>}
              {detail(e) && <p className="break-words text-xs text-muted-foreground">{detail(e)}</p>}
            </li>
          )
        })}
      </ul>
      <Card className="max-h-[75vh] overflow-auto max-md:hidden">
        <Table>
          <THead className="sticky top-0 z-10 bg-card"><TR><TH>Time (UTC)</TH><TH>Event</TH><TH>Variant</TH><TH>Provider</TH><TH>Detail</TH></TR></THead>
          <TBody>
            {d.events.map((e, i) => {
              const k = KIND[e.event] ?? { label: e.event, icon: CheckCircle2, variant: 'secondary' as const }
              const Icon = k.icon
              const [, model, setting, sample] = (e.id ?? '').split('/')
              return (
                <TR key={`${e.time}-${i}`}>
                  <TD className="whitespace-nowrap font-mono text-[11px]">{e.time.slice(5, 19).replace('T', ' ')}</TD>
                  <TD><Badge variant={k.variant}><Icon />{k.label}</Badge></TD>
                  <TD className="text-xs">{e.id ? <Link to={variantLink(e.id)} className="hover:underline">{prettyModel(model)} <span className="text-muted-foreground">{settingLabel(setting)}, {sample}</span></Link> : ''}</TD>
                  <TD className="text-xs text-muted-foreground">{e.provider ?? ''}</TD>
                  <TD className="max-w-xl truncate text-xs text-muted-foreground" title={detail(e)}>{detail(e)}</TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  )
}
