import type { RunVariant } from '@/lib/api'

// The numbers behind the Findings page, computed in the browser from /api/run/variants.

/** A variant counts once its generation is over and, if it has code, its tests ran. */
export const finished = (v: RunVariant) => ['all_pass', 'partial', 'compile_error', 'no_code'].includes(v.outcome)
/** A version in the N-version sense: the model wrote code (it may not compile). */
export const hasCode = (v: RunVariant) => ['all_pass', 'partial', 'compile_error'].includes(v.outcome)
export const reasoningOff = (setting: string) => setting.startsWith('OFF')

export type Rate = { k: number; n: number; p: number; lo: number; hi: number }

/** k of n with a 95% Wilson interval (sound for small n and for 0 or n). */
export function rate(k: number, n: number): Rate {
  if (!n) return { k, n, p: 0, lo: 0, hi: 0 }
  const z = 1.96
  const p = k / n
  const d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return { k, n, p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) }
}

const logFact = (() => { const t = [0]; for (let i = 1; i <= 2000; i++) t[i] = t[i - 1] + Math.log(i); return (n: number) => t[n] })()

/** Two-sided Fisher exact test of a 2x2 table [[a, b], [c, d]]. */
export function fisher(a: number, b: number, c: number, d: number) {
  const r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2
  const prob = (x: number) => Math.exp(logFact(r1) + logFact(r2) + logFact(c1) + logFact(n - c1) - logFact(n) - logFact(x) - logFact(r1 - x) - logFact(c1 - x) - logFact(r2 - c1 + x))
  const p0 = prob(a)
  let p = 0
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) { const q = prob(x); if (q <= p0 * (1 + 1e-7)) p += q }
  return Math.min(1, p)
}

/** The failing tests of a version; a version that does not compile fails every test ("all"). */
export function faultSet(v: RunVariant): Set<string> | 'all' {
  if (v.outcome === 'compile_error') return 'all'
  return new Set(v.failing)
}

function shares(a: Set<string> | 'all', b: Set<string> | 'all') {
  if (a === 'all') return b === 'all' || b.size > 0
  if (b === 'all') return a.size > 0
  const [s, l] = a.size < b.size ? [a, b] : [b, a]
  for (const t of s) if (l.has(t)) return true
  return false
}

export type Vote = { single: Rate; same: Rate; diverse: Rate; versions: number; models: number }

/**
 * N-version view of one target. A 2-of-3 majority vote gets a test wrong only when at least two versions fail that test,
 * so a triple fails when some pair of it shares a failing test. Counts every triple of versions: three samples of one
 * model ("same") and three different models ("diverse"). onlyCompiled leaves out versions that do not compile.
 */
export function vote(rows: RunVariant[], onlyCompiled = false): Vote {
  const vs = rows.filter((v) => (onlyCompiled ? v.outcome === 'all_pass' || v.outcome === 'partial' : hasCode(v)))
  const sets = vs.map(faultSet)
  const n = vs.length
  const pair = Array.from({ length: n }, () => new Uint8Array(n))
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pair[i][j] = pair[j][i] = shares(sets[i], sets[j]) ? 1 : 0
  let sameN = 0, sameF = 0, divN = 0, divF = 0
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    const a = vs[i].model, b = vs[j].model, c = vs[k].model
    const fail = pair[i][j] || pair[i][k] || pair[j][k]
    if (a === b && b === c) { sameN++; sameF += fail } else if (a !== b && b !== c && a !== c) { divN++; divF += fail }
  }
  const singleF = sets.filter((s) => s === 'all' || s.size > 0).length
  return { single: rate(singleF, n), same: rate(sameF, sameN), diverse: rate(divF, divN), versions: n, models: new Set(vs.map((v) => v.model)).size }
}

/** How often the faults of two models overlap: of all pairs of their failing compiled versions (same target), the share with a common failing test. */
export function overlap(rows: RunVariant[]) {
  const vs = rows.filter((v) => v.outcome === 'partial')
  const sets = vs.map((v) => faultSet(v) as Set<string>)
  const models = [...new Set(vs.map((v) => v.model))]
  const cell = new Map<string, { k: number; n: number }>()
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
    if (vs[i].model === vs[j].model || vs[i].target !== vs[j].target) continue
    const key = [vs[i].model, vs[j].model].sort().join('|')
    const c = cell.get(key) ?? { k: 0, n: 0 }
    c.n++; if (shares(sets[i], sets[j])) c.k++
    cell.set(key, c)
  }
  return { models, get: (a: string, b: string) => cell.get([a, b].sort().join('|')) }
}

/** Tests that fail in the most versions (compiled only), with how many different models. */
export function sharedFaults(rows: RunVariant[], top = 6) {
  const by = new Map<string, { variants: number; models: Set<string> }>()
  for (const v of rows) if (v.outcome === 'partial') for (const t of faultSet(v) as Set<string>) {
    const e = by.get(t) ?? { variants: 0, models: new Set() }
    e.variants++; e.models.add(v.model)
    by.set(t, e)
  }
  const compiled = rows.filter((v) => v.outcome === 'all_pass' || v.outcome === 'partial').length
  return { compiled, tests: [...by.entries()].map(([test, e]) => ({ test, variants: e.variants, models: e.models.size })).sort((a, b) => b.variants - a.variants || b.models - a.models).slice(0, top) }
}

/** "test_tipTooSmall_reverts" or "TipTests.should_reject_zero" as something a person can read. */
export function readableTest(t: string) {
  const s = t.replace(/^test_*/, '')
  const parts = s.split(/__|\./).filter(Boolean)
  return (parts[parts.length - 1] ?? s).replace(/_/g, ' ')
}

export const pct = (x: number) => `${Math.round(x * 100)}%`
