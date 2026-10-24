import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowLeft, Brain, ChevronLeft, ChevronRight, Fingerprint, Download, FileCode2, FileJson, Hammer, ListChecks, MessageSquareText, ScrollText, Send } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CodeBlock, JsonView, KeyValue, Markdown, PageHeader, StatCard } from '@/components/common'
import { CollapseBody, FoldChevron } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Badge, Card, Skeleton, Switch, Table, Tabs, TabsContent, TabsList, TabsTrigger, TBody, TD, TH, THead, TR } from '@/components/ui/primitives'
import { EmptyNote, Logo, OUTCOME, OutcomeBadge, prettyModel, Score, settingLabel, settingText, useRunOverview, variantLink } from '@/features/run/shared'
import { runApi, runFileUrl, type RunTestRow, type RunVariantDetail } from '@/lib/api'
import { cn, int, usd } from '@/lib/utils'

// One variant, everything that was logged for it: request, every attempt, the answer, the code, the build and every test.

function Summary({ d, fields }: { d: RunVariantDetail; fields?: Record<string, unknown> }) {
  const v = d.variant
  const r = d.record as Record<string, string | number | null>
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">Request</h3>
        <KeyValue items={[
          ['Model', <span className="font-mono text-xs">{v.model_id}</span>],
          ['Pinned provider', `${v.provider ?? 'n/a'}${v.provider_returned && v.provider_returned !== v.provider ? ` (answered by ${v.provider_returned})` : ''}`],
          ['Setting', <span>{settingLabel(v.setting)} <span className="text-muted-foreground">({settingText(v.setting, fields)})</span></span>],
          ['Prompt file', <span className="font-mono text-xs">{String(r.prompt_file ?? 'n/a')}</span>],
          ['Prompt SHA-256', <span className="break-all font-mono text-[11px] text-muted-foreground">{String(r.prompt_sha256 ?? 'n/a')}</span>],
          ['Sent at', v.time_start ? new Date(v.time_start).toLocaleString() : 'n/a'],
          ['Finished at', v.time_end ? new Date(v.time_end).toLocaleString() : 'n/a'],
          ['Generation id', <span className="font-mono text-[11px]">{String(r.generation_id ?? 'n/a')}</span>],
        ]} />
      </Card>
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">Answer and result</h3>
        <KeyValue items={[
          ['Status', <span>{v.status ?? 'n/a'}{v.reason && <span className="text-muted-foreground">: {v.reason}</span>}</span>],
          ['Finish reason', v.finish_reason ?? 'n/a'],
          ['Input tokens', int(v.prompt_tokens)],
          ['Output tokens', <span>{int(v.completion_tokens)} <span className="text-muted-foreground">of which reasoning {int(v.reasoning_tokens)}</span></span>],
          ['Cost (billed)', usd(v.cost_usd)],
          ['Answer time', v.seconds !== null ? `${v.seconds.toFixed(1)} s` : 'n/a'],
          ['Attempts', `${v.attempts}${v.rate_limited ? `, ${v.rate_limited} rate limited (HTTP 429, not billed)` : ''}`],
          ['Code SHA-256', <span className="break-all font-mono text-[11px] text-muted-foreground">{String(r.code_sha256 ?? 'n/a')}</span>],
          ['Tests passed', <Score s={v.main} />],
        ]} />
      </Card>
      <Card className="p-4 lg:col-span-2">
        <h3 className="mb-3 text-sm font-semibold">Request parameters, exactly as sent</h3>
        <JsonView value={d.params} maxHeight="16rem" />
      </Card>
      <Card className="overflow-x-auto lg:col-span-2">
        <h3 className="px-4 pt-4 text-sm font-semibold">Attempts</h3>
        <p className="px-4 text-xs text-muted-foreground">A rate-limited request (HTTP 429) was never processed and is retried. Once a request may have been billed, it is never sent again automatically.</p>
        <Table className="mt-2">
          <THead><TR><TH>#</TH><TH>Sent at</TH><TH>HTTP</TH><TH>Status</TH><TH className="text-right">Seconds</TH><TH className="text-right">Cost</TH><TH>Provider</TH><TH>Detail</TH><TH /></TR></THead>
          <TBody>
            {d.attempts.map((a) => (
              <TR key={a.k}>
                <TD className="tabular-nums">{a.k}</TD>
                <TD className="whitespace-nowrap text-xs">{new Date(a.time_sent).toLocaleTimeString()}</TD>
                <TD><Badge variant={a.http_status === 200 ? 'success' : a.http_status === 429 ? 'warning' : 'destructive'}>{a.http_status ?? 'none'}</Badge></TD>
                <TD className="text-xs">{a.status ?? 'n/a'}</TD>
                <TD className="text-right tabular-nums">{a.seconds ?? 'n/a'}</TD>
                <TD className="text-right tabular-nums">{usd(a.cost_usd)}</TD>
                <TD className="text-xs">{a.provider_returned ?? ''}</TD>
                <TD className="max-w-md truncate text-xs text-muted-foreground" title={a.error ?? ''}>{a.error ?? a.finish_reason ?? ''}</TD>
                <TD>{a.raw_file && <a href={runFileUrl(`raw?path=${encodeURIComponent(a.raw_file)}`)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Download className="size-3" />raw</a>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  )
}

const SKIPPED = new Set(['skipped', 'skip'])
const isFail = (r: RunTestRow) => r.result !== 'pass' && !SKIPPED.has(r.result)

/** One test: readable name, result, and the failure message folded to two lines (click to read it all). */
function TestRow({ r }: { r: RunTestRow }) {
  const [full, setFull] = React.useState(false)
  const name = r.test.includes('.') ? r.test.split('.').slice(1).join('.') : r.test
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1 break-words font-mono text-[12px]">{name}</span>
        {r.result === 'pass' ? <Badge variant="success">pass</Badge> : SKIPPED.has(r.result) ? <Badge variant="secondary">skipped</Badge> : <Badge variant="destructive">{r.result}</Badge>}
      </div>
      {r.message && isFail(r) && (
        <button onClick={() => setFull(!full)} className="mt-1 block w-full cursor-pointer text-left">
          <span className={cn('block whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground', !full && 'line-clamp-2')}>{r.message}</span>
        </button>
      )}
    </li>
  )
}

/** A test class as a fold: groups with failures open, passing groups closed. */
function TestGroup({ name, list, onlyFail }: { name: string; list: RunTestRow[]; onlyFail: boolean }) {
  const bad = list.filter(isFail).length
  const [open, setOpen] = React.useState(bad > 0)
  const shown = onlyFail ? list.filter(isFail) : list
  if (onlyFail && !bad) return null
  return (
    <Card className="overflow-hidden p-0">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className={cn('flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-muted/50', open && 'border-b')}>
        <FoldChevron open={open} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{list.length - bad}/{list.length} pass</span>
        <span className="flex h-1.5 w-16 overflow-hidden rounded-full bg-secondary"><span className="h-full bg-success" style={{ width: `${((list.length - bad) / list.length) * 100}%` }} /><span className="h-full bg-destructive" style={{ width: `${(bad / list.length) * 100}%` }} /></span>
      </button>
      <CollapseBody open={open}><ul className="divide-y">{shown.map((r) => <TestRow key={r.test} r={r} />)}</ul></CollapseBody>
    </Card>
  )
}

function Tests({ rows }: { rows: RunTestRow[] }) {
  const [onlyFail, setOnlyFail] = React.useState(true)
  if (!rows.length) return <EmptyNote>No test results. The code did not compile, or the tests have not run yet.</EmptyNote>
  const groups = new Map<string, RunTestRow[]>()
  for (const r of rows) groups.set(r.group || 'Tests', [...(groups.get(r.group || 'Tests') ?? []), r])
  const failing = rows.filter(isFail).length
  const skipped = rows.filter((r) => SKIPPED.has(r.result)).length
  // groups with failures first
  const ordered = [...groups.entries()].sort(([, a], [, b]) => b.filter(isFail).length - a.filter(isFail).length)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span><b className="font-semibold tabular-nums">{rows.length - failing - skipped}</b> pass, <b className={cn('font-semibold tabular-nums', failing && 'text-destructive')}>{failing}</b> fail{skipped ? <span className="text-muted-foreground">, {skipped} skipped by the suite</span> : null}</span>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><Switch checked={onlyFail} onCheckedChange={setOnlyFail} />Only failing tests</label>
      </div>
      {onlyFail && !failing ? <EmptyNote>Every test passes.</EmptyNote> : ordered.map(([g, list]) => <TestGroup key={g} name={g} list={list} onlyFail={onlyFail} />)}
    </div>
  )
}

/** Other variants of the same target that fail exactly the same tests. */
function SamePattern({ signature, list }: { signature: string; list: { id: string; model: string; setting: string; sample: number; family: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const shown = open ? list : list.slice(0, 8)
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Fingerprint className="size-4 text-muted-foreground" />
        <span>Fault pattern <b>{signature}</b> also appears in <b>{list.length}</b> other variant{list.length === 1 ? '' : 's'}</span>
        <span className="text-xs text-muted-foreground">from {new Set(list.map((x) => x.model)).size} model{new Set(list.map((x) => x.model)).size === 1 ? '' : 's'}: exactly the same failing tests.</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {shown.map((x) => (
          <Link key={x.id} to={variantLink(x.id)} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors hover:border-primary/40 hover:bg-accent">
            <Logo family={x.family} className="size-3.5" />{prettyModel(x.model)}<span className="text-muted-foreground">{settingLabel(x.setting)}, s{x.sample}</span>
          </Link>
        ))}
        {list.length > 8 && <button onClick={() => setOpen(!open)} className="cursor-pointer rounded-md px-2 py-1 text-xs text-primary hover:bg-accent">{open ? 'Show fewer' : `Show all ${list.length}`}</button>}
      </div>
    </Card>
  )
}

function Code({ d }: { d: RunVariantDetail }) {
  if (!d.code) return <EmptyNote icon={FileCode2}>No code was extracted from this answer.</EmptyNote>
  const lines = d.code.split('\n')
  return (
    <div className="space-y-3">
      {d.compile_errors.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Hammer className="size-4" style={{ color: OUTCOME.compile_error.color }} />{d.compile_errors.length} compiler errors</h3>
          <div className="max-h-80 space-y-2 overflow-auto">
            {d.compile_errors.map((e, i) => (
              <div key={i} className="rounded-md border px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2"><Badge variant="warning">{e.category}</Badge><span className="font-mono">line {e.line ?? '?'}</span><span>{e.message}</span></div>
                {e.line && lines[e.line - 1] !== undefined && <pre className="mt-1.5 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-[11px]">{e.line}: {lines[e.line - 1]}</pre>}
              </div>
            ))}
          </div>
        </Card>
      )}
      <CodeBlock code={d.code} title={d.code_file ?? undefined} maxHeight="70vh" />
    </div>
  )
}

/** Previous and next variant in matrix order (target, model, setting, sample); arrow keys move too. */
function useNeighbours(id: string, enabled: boolean) {
  const o = useRunOverview().data
  const all = useQuery({ queryKey: ['run', 'variants', {}], queryFn: () => runApi.variants({}), enabled, staleTime: 30000 })
  return React.useMemo(() => {
    if (!o || !all.data) return null
    const t = Object.fromEntries(o.targets.map((x, i) => [x.id, i]))
    const m = Object.fromEntries(o.models.map((x, i) => [x.label, i]))
    const st = Object.fromEntries(Object.keys(o.settings).map((x, i) => [x, i]))
    const list = all.data.filter((v) => !['pending', 'running'].includes(v.outcome))
      .sort((a, b) => t[a.target] - t[b.target] || m[a.model] - m[b.model] || (st[a.setting] ?? 99) - (st[b.setting] ?? 99) || a.setting.localeCompare(b.setting) || a.sample - b.sample)
    const i = list.findIndex((v) => v.id === id)
    return { i, n: list.length, prev: list[i - 1], next: list[i + 1], all: list }
  }, [o, all.data, id])
}

export function RunVariantPage() {
  const [params] = useSearchParams()
  const id = params.get('id') ?? ''
  const q = useQuery({ queryKey: ['run', 'variant', id], queryFn: () => runApi.variant(id), enabled: !!id, placeholderData: keepPreviousData })
  if (!q.data) return q.isError ? <EmptyNote>{String(q.error)}</EmptyNote> : <div className="space-y-4"><Skeleton className="h-10 w-full max-w-96" /><Skeleton className="h-24" /><Skeleton className="h-96" /></div>
  return <div className={cn('transition-opacity duration-150', q.isPlaceholderData && 'opacity-60')}><VariantView d={q.data} /></div>
}

function VariantView({ d }: { d: RunVariantDetail }) {
  const v = d.variant
  const navigate = useNavigate()
  const fields = useRunOverview().data?.settings[v.setting]
  const nb = useNeighbours(v.id, true)
  React.useEffect(() => {
    if (!nb) return
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft' && nb.prev) navigate(variantLink(nb.prev.id))
      if (e.key === 'ArrowRight' && nb.next) navigate(variantLink(nb.next.id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nb, navigate])
  const same = nb && v.signature ? nb.all.filter((x) => x.signature === v.signature && x.target === v.target && x.id !== v.id) : []
  const user = d.messages.find((m) => m.role === 'user')?.content ?? ''
  const system = d.messages.find((m) => m.role === 'system')?.content ?? ''
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/run/matrix" className="inline-flex items-center gap-1 rounded-md py-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />Results matrix</Link>
        {nb && nb.i >= 0 && (
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 hidden text-xs text-muted-foreground tabular-nums sm:inline">{nb.i + 1} of {nb.n}</span>
            <Button variant="outline" size="xs" disabled={!nb.prev} onClick={() => nb.prev && navigate(variantLink(nb.prev.id))} title="Previous variant (left arrow key)"><ChevronLeft />Previous</Button>
            <Button variant="outline" size="xs" disabled={!nb.next} onClick={() => nb.next && navigate(variantLink(nb.next.id))} title="Next variant (right arrow key)">Next<ChevronRight /></Button>
          </div>
        )}
      </div>
      <PageHeader eyebrow={<span className="font-mono">{v.id}</span>}
        title={`${prettyModel(v.model)}, ${settingLabel(v.setting)}, sample ${v.sample}`}
        actions={<span className="flex items-center gap-2"><Logo family={v.family} className="size-6" /><OutcomeBadge outcome={v.outcome} className="text-sm" /></span>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Tests passed" value={<Score s={v.main} />} hint={v.signature ? `fault pattern ${v.signature}` : OUTCOME[v.outcome].short} />
        <StatCard label="Output tokens" value={int(v.completion_tokens)} hint={`reasoning ${int(v.reasoning_tokens)}`} />
        <StatCard label="Time" value={v.seconds !== null ? `${Math.round(v.seconds)} s` : 'n/a'} hint={`${v.attempts} attempt${v.attempts === 1 ? '' : 's'}`} />
        <StatCard label="Cost" value={usd(v.cost_usd)} hint={v.provider ?? undefined} />
      </div>
      {same.length > 0 && <SamePattern signature={v.signature!} list={same} />}
      <Tabs key={v.id} defaultValue={v.outcome === 'compile_error' ? 'code' : v.outcome === 'partial' ? 'tests' : 'summary'}>
        <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 -mx-4 bg-background/90 px-4 backdrop-blur-md sm:-mx-6 sm:px-6 md:top-0 md:-mx-8 md:px-8">
        <div className="flex items-center gap-3">
        <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground lg:flex"><Logo family={v.family} className="size-4" />{prettyModel(v.model)}, s{v.sample}</span>
        <TabsList className="min-w-0 flex-1">
          <TabsTrigger value="summary"><Send className="size-3.5" />Summary</TabsTrigger>
          <TabsTrigger value="prompt"><MessageSquareText className="size-3.5" />Prompt</TabsTrigger>
          <TabsTrigger value="answer"><ScrollText className="size-3.5" />Answer</TabsTrigger>
          <TabsTrigger value="reasoning"><Brain className="size-3.5" />Reasoning{!d.reasoning && <span className="text-[11px] font-normal opacity-60">(none)</span>}</TabsTrigger>
          <TabsTrigger value="code"><FileCode2 className="size-3.5" />Code{d.compile_errors.length > 0 && <Badge variant="warning" className="ml-1">{d.compile_errors.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="build"><Hammer className="size-3.5" />Build log</TabsTrigger>
          <TabsTrigger value="tests"><ListChecks className="size-3.5" />Tests</TabsTrigger>
          <TabsTrigger value="raw"><FileJson className="size-3.5" />Record</TabsTrigger>
        </TabsList>
        </div>
        </div>
        <TabsContent value="summary"><Summary d={d} fields={fields} /></TabsContent>
        <TabsContent value="prompt" className="space-y-3">
          <CodeBlock code={system} title="System message" language="text" maxHeight="10rem" />
          <Card className="max-h-[70vh] overflow-auto p-4 sm:p-5"><Markdown>{user}</Markdown></Card>
        </TabsContent>
        <TabsContent value="answer">{d.answer ? <CodeBlock code={d.answer} title="Full answer, as returned" language="markdown" maxHeight="70vh" /> : <EmptyNote>No answer text was saved.</EmptyNote>}</TabsContent>
        <TabsContent value="reasoning">{d.reasoning ? <CodeBlock code={d.reasoning} title={`Reasoning, ${int(v.reasoning_tokens)} tokens`} language="text" maxHeight="70vh" /> : <EmptyNote icon={Brain}>{v.reasoning_tokens ? `The model used ${int(v.reasoning_tokens)} reasoning tokens, but the provider did not return the text.` : v.setting.startsWith('OFF') ? 'Reasoning was switched off for this setting.' : 'The provider returned no reasoning text.'}</EmptyNote>}</TabsContent>
        <TabsContent value="code"><Code d={d} /></TabsContent>
        <TabsContent value="build" className="space-y-3">
          {d.build_log ? <CodeBlock code={d.build_log} title="build.log" language="text" maxHeight="40rem" /> : <EmptyNote>No build log yet.</EmptyNote>}
        </TabsContent>
        <TabsContent value="tests"><Tests rows={d.tests} /></TabsContent>
        <TabsContent value="raw" className="space-y-3">
          <JsonView value={d.record} maxHeight="30rem" />
          <h3 className="text-sm font-semibold">Event log for this variant</h3>
          <JsonView value={d.events} maxHeight="24rem" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
