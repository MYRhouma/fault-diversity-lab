import { useQuery } from '@tanstack/react-query'
import { Fingerprint, Hammer, ListX, Network, X } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Badge, Card, Skeleton, Table, TBody, TD, TH, THead, TR, Tooltip } from '@/components/ui/primitives'
import { ChartCard, EmptyNote, FilterBar, OUTCOME, parseId, prettyModel, settingLabel, useFamilies, useRunFilter, useRunOverview, VariantLink } from '@/features/run/shared'
import { readableTest } from '@/features/run/stats'
import { runApi, type RunFailures } from '@/lib/api'

// What went wrong, grouped so that the same mistake is counted once: compiler error kinds, failing tests,
// identical failure sets (fault patterns), and how much the failures of two variants overlap.

const short = (id: string) => {
  const p = parseId(id)
  return `${prettyModel(p.model)}, ${settingLabel(p.setting)}, s0${p.sample}`
}
const testName = (t: string) => t.split('.').slice(1).join('.') || t

function CompileErrors({ f, families }: { f: RunFailures; families: Record<string, string> }) {
  if (!f.compile.length) return <EmptyNote icon={Hammer}>No compile failures in this selection.</EmptyNote>
  const max = Math.max(...f.compile.map((c) => c.variants.length))
  return (
    <div className="space-y-3">
      {f.compile.map((c) => (
        <Card key={c.category} className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{c.category}</h3>
            <span className="text-xs text-muted-foreground">{c.variants.length} variant{c.variants.length > 1 ? 's' : ''}, {c.errors} error lines</span>
          </div>
          <p className="text-xs text-muted-foreground">{c.explanation}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full" style={{ width: `${(c.variants.length / max) * 100}%`, background: OUTCOME.compile_error.color }} /></div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {c.variants.map((v) => <span key={v.id}><VariantLink id={v.id} families={families} /> <span className="text-muted-foreground">({v.errors})</span></span>)}
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-primary">Most common messages</summary>
            <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {c.messages.map((m) => <li key={m.message}>{m.count}x {m.message}</li>)}
            </ul>
          </details>
        </Card>
      ))}
    </div>
  )
}

/** Test x variant grid: only failing tests and only variants that compiled with at least one failure. */
function FailingHeatmap({ f, families }: { f: RunFailures; families: Record<string, string> }) {
  const variants = Object.keys(f.variant_failing)
  const tests = f.failing_tests
  if (!tests.length) return <EmptyNote icon={ListX}>No failing tests among the variants that compiled.</EmptyNote>
  const cell = 18
  const labelW = 300
  const headH = 26
  const width = labelW + variants.length * (cell + 4) + 40
  const height = headH + tests.length * (cell + 3) + 4
  return (
    <ChartCard name="failing-tests-heatmap" title="Which tests fail in which variant"
      description="Columns are the variants listed below the chart. A filled square means the test fails in that variant. The number on the right is how many variants fail the test together (coincident failures).">
      <div className="overflow-x-auto">
        <svg data-chart width={width} height={height} className="text-foreground" role="img">
          {variants.map((v, j) => (
            <text key={v} x={labelW + j * (cell + 4) + cell / 2} y={headH - 9} textAnchor="middle" fontSize={11} fontWeight={600} fill="currentColor"><title>{short(v)}</title>{j + 1}</text>
          ))}
          {tests.map((t, i) => (
            <g key={t.test} transform={`translate(0, ${headH + i * (cell + 3)})`}>
              <text x={labelW - 10} y={cell / 2} dominantBaseline="middle" textAnchor="end" fontSize={11} fill="currentColor"><title>{t.test}</title>{readableTest(t.test).length > 46 ? `${readableTest(t.test).slice(0, 44)}…` : readableTest(t.test)}</text>
              {variants.map((v, j) => {
                const fails = t.variants.includes(v)
                return <rect key={v} x={labelW + j * (cell + 4)} y={0} width={cell} height={cell} rx={4}
                  fill={fails ? OUTCOME.partial.color : 'currentColor'} opacity={fails ? 1 : 0.07}>
                  <title>{`${testName(t.test)}\n${short(v)}: ${fails ? 'fails' : 'passes'}`}</title>
                </rect>
              })}
              <text x={labelW + variants.length * (cell + 4) + 8} y={cell / 2} dominantBaseline="middle" fontSize={11} fill="currentColor" opacity={0.7}>{t.variants.length}</text>
            </g>
          ))}
        </svg>
      </div>
      <ol className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {variants.map((v, j) => <li key={v} className="inline-flex items-center gap-1.5"><span className="font-semibold tabular-nums">{j + 1}</span><VariantLink id={v} families={families} /></li>)}
      </ol>
    </ChartCard>
  )
}

/** Pairwise Jaccard overlap of failing-test sets. 1 = the two variants fail exactly the same tests. */
function OverlapMatrix({ f }: { f: RunFailures }) {
  const ids = Object.keys(f.variant_failing)
  if (ids.length < 2) return <EmptyNote icon={Network}>Needs at least two variants with failing tests.</EmptyNote>
  const get = (a: string, b: string) => f.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))
  const cell = 34
  const labelW = 230
  const width = labelW + ids.length * cell + 8
  const height = ids.length * cell + 8
  return (
    <ChartCard name="failure-overlap" title="How similar the failures are (Jaccard overlap)"
      description="For every pair of variants that fail tests: shared failing tests divided by all their failing tests. 1.00 means they fail exactly the same tests, 0 means no shared failure. Darker is more similar.">
      <div className="overflow-x-auto">
        <svg data-chart width={width} height={height} className="text-foreground" role="img">
          {ids.map((a, i) => (
            <g key={a}>
              <text x={labelW - 8} y={i * cell + cell / 2} dominantBaseline="middle" textAnchor="end" fontSize={11} fill="currentColor">{short(a)}</text>
              {ids.map((b, j) => {
                const p = a === b ? null : get(a, b)
                const jv = a === b ? 1 : p?.jaccard ?? 0
                return (
                  <g key={b}>
                    <rect x={labelW + j * cell} y={i * cell} width={cell - 2} height={cell - 2} rx={4} fill="#2383e2" opacity={a === b ? 0.08 : 0.1 + jv * 0.85}>
                      <title>{a === b ? short(a) : `${short(a)}\n${short(b)}\nshared ${p?.both} of ${p?.union} failing tests, Jaccard ${jv.toFixed(2)}`}</title>
                    </rect>
                    {a !== b && <text x={labelW + j * cell + (cell - 2) / 2} y={i * cell + (cell - 2) / 2} dominantBaseline="middle" textAnchor="middle" fontSize={9.5} fill={jv > 0.5 ? '#fff' : 'currentColor'}>{jv.toFixed(2)}</text>}
                  </g>
                )
              })}
            </g>
          ))}
        </svg>
      </div>
    </ChartCard>
  )
}

/** One test picked in the search (?test=): where it fails, how often, and the messages it fails with. */
function TestFocus({ f, test, families }: { f: RunFailures; test: string; families: Record<string, string> }) {
  const [params, setParams] = useSearchParams()
  const t = f.failing_tests.find((x) => x.test === test)
  const clear = () => { const next = new URLSearchParams(params); next.delete('test'); setParams(next, { replace: true }) }
  const models = t ? new Set(t.variants.map((v) => parseId(v).model)).size : 0
  return (
    <Card className="border-primary/40 p-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <ListX className="mt-0.5 size-4 text-primary" />
        <div className="min-w-0 flex-1 basis-60">
          <div className="text-sm font-semibold">{readableTest(test)}</div>
          <div className="break-all font-mono text-[11px] text-muted-foreground">{test}</div>
        </div>
        <Button variant="ghost" size="xs" onClick={clear}><X />Close</Button>
      </div>
      {!t ? <p className="mt-3 text-sm text-muted-foreground">This test does not fail in any variant of the current selection.</p> : <>
        <p className="mt-3 text-sm">Fails in <b>{t.variants.length}</b> of {f.tested} compiled variants in this selection, from <b>{models}</b> model{models === 1 ? '' : 's'}.</p>
        {t.messages.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {t.messages.map((m) => <li key={m.message} className="flex gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground"><span className="shrink-0 tabular-nums text-foreground">{m.count}x</span><span className="break-words">{m.message || '(no message)'}</span></li>)}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {t.variants.map((v) => <VariantLink key={v} id={v} families={families} className="rounded-md border px-2 py-1 text-xs hover:border-primary/40 hover:bg-accent hover:no-underline" />)}
        </div>
      </>}
    </Card>
  )
}

export function RunFailuresPage() {
  const o = useRunOverview().data
  const [filter] = useRunFilter()
  const families = useFamilies()
  const q = useQuery({ queryKey: ['run', 'failures', filter], queryFn: () => runApi.failures(filter), refetchInterval: 30000 })
  const [tab, setTab] = React.useState<'tests' | 'compile' | 'patterns'>('tests')
  const [params] = useSearchParams()
  const focus = params.get('test')
  React.useEffect(() => { if (focus) setTab('tests') }, [focus])
  if (!q.data || !o) return <div className="space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-24" /><Skeleton className="h-96" /></div>
  const f = q.data
  const tabs = [
    ['tests', 'Failing tests', ListX, f.failing_tests.length],
    ['patterns', 'Fault patterns', Fingerprint, f.signatures.length],
    ['compile', 'Compiler errors', Hammer, f.compiled_fail],
  ] as const
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Experiment" title="Faults and failures"
        description="Everything that went wrong, grouped so that the same mistake is counted once. Use the filters to look at one target, model or setting." />
      <FilterBar overview={o} show={['target', 'model', 'setting']} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Compiled and tested" value={f.tested} hint={`of ${f.variants} planned in this selection`} />
        <StatCard label="Do not compile" value={f.compiled_fail} icon={Hammer} />
        <StatCard label="Compile but fail tests" value={f.with_failures} icon={ListX} />
        <StatCard label="Distinct fault patterns" value={f.signatures.length} hint="identical sets of failing tests" icon={Fingerprint} />
      </div>
      {focus && <TestFocus f={f} test={focus} families={families} />}
      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map(([k, label, Icon, n]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`-mb-px inline-flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <Icon className="size-4" />{label}<Badge variant="secondary">{n}</Badge>
          </button>
        ))}
      </div>

      {tab === 'compile' && <CompileErrors f={f} families={families} />}

      {tab === 'tests' && (
        <div className="space-y-4">
          <FailingHeatmap f={f} families={families} />
          {f.failing_tests.length > 0 && (
            <Card className="overflow-x-auto">
              <Table>
                <THead><TR><TH>Test</TH><TH className="text-right">Variants failing</TH><TH>Typical message</TH></TR></THead>
                <TBody>
                  {f.failing_tests.map((t) => (
                    <TR key={t.test}>
                      <TD className="font-mono text-[11px]">{testName(t.test)}<div className="font-sans text-[11px] text-muted-foreground">{t.group}</div></TD>
                      <TD className="text-right tabular-nums"><Tooltip content={<div className="text-xs">{t.variants.map((v) => <div key={v}>{short(v)}</div>)}</div>}><span className="cursor-help">{t.variants.length}</span></Tooltip></TD>
                      <TD className="max-w-lg truncate font-mono text-[11px] text-muted-foreground" title={t.messages[0]?.message}>{t.messages[0]?.message}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {tab === 'patterns' && (
        <div className="space-y-4">
          {f.signatures.length === 0 ? <EmptyNote icon={Fingerprint}>No fault patterns yet.</EmptyNote> : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {f.signatures.map((s) => (
                <Card key={s.id} className="p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold">Pattern {s.id}</h3>
                    <span className="text-xs text-muted-foreground">{s.tests.length} failing tests, {s.variants.length} variant{s.variants.length > 1 ? 's' : ''}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">{s.variants.map((v) => <VariantLink key={v} id={v} families={families} />)}</div>
                  {s.variants.length > 1 && <p className="mt-2 text-xs" style={{ color: OUTCOME.partial.color }}>Different variants fail exactly the same tests: a coincident failure.</p>}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-primary">Show the {s.tests.length} tests</summary>
                    <ul className="mt-1.5 max-h-60 space-y-0.5 overflow-auto font-mono text-[11px] text-muted-foreground">{s.tests.map((t) => <li key={t}>{testName(t)}</li>)}</ul>
                  </details>
                </Card>
              ))}
            </div>
          )}
          <OverlapMatrix f={f} />
          <p className="text-xs text-muted-foreground">Patterns are numbered by how often they occur (F1 is the most common). <Link to="/run/export" className="text-primary hover:underline">Download the variant by test table</Link> for your own analysis.</p>
        </div>
      )}
    </div>
  )
}
