// Typed client for the read-only run API (fdlab/dashboard.py).

export type RunOutcome = 'pending' | 'running' | 'api_error' | 'no_code' | 'testing' | 'compile_error' | 'partial' | 'all_pass'
export type RunScore = { total: number; passed: number }
export type RunVariant = {
  id: string; target: string; model: string; model_id: string; family: string; provider: string | null; setting: string
  sample: number; channel: string; outcome: RunOutcome; status: string | null; reason: string | null
  cost_usd: number | null; total_cost_usd: number | null; prompt_tokens: number | null; completion_tokens: number | null
  reasoning_tokens: number | null; seconds: number | null; attempts: number; rate_limited: number
  finish_reason: string | null; provider_returned: string | null; time_start: string | null; time_end: string | null
  compiled: boolean | null; main: RunScore | null; compile_errors: number; error_categories: string[]; failing: string[]
  signature?: string | null
}
export type RunGroup = Record<RunOutcome, number> & { total: number; cost_usd: number }
export type RunEvent = { time: string; event: string; id?: string; model?: string; provider?: string; setting?: string; attempt?: number; [k: string]: unknown }
export type RunTarget = { id: string; name: string; platform?: string | null; language?: string | null; prompt?: string }
export type RunModel = {
  label: string; id: string; family: string; provider: string | null; price_in: number | null; price_out: number | null
  channel: string; settings: string[]
}
export type RunOverview = {
  title: string; demo: boolean
  targets: RunTarget[]; models: RunModel[]
  settings: Record<string, Record<string, unknown>>; samples: number; max_tokens: number; channels: string[]
  planned: number; done: number; by_outcome: Record<RunOutcome, number>; compiled: number; tested: number
  fault_signatures: number; spent_usd: number; ledger_usd: number; cap_usd: number | null
  credit: { time: string; limit: number; limit_remaining: number; usage: number } | null
  in_flight: string[]; last_event: RunEvent | null; stopped_cap: boolean; last_command: string[] | null; manifests: number
  by_model: Record<string, RunGroup>; by_setting: Record<string, RunGroup>
  progress: { target: string; sample: number; planned: number; done: number; channel: string }[]
}
export type RunTestRow = { test: string; group: string; result: string; message: string }
export type RunCompileError = { file: string | null; line: number | null; message: string; category: string }
export type RunAttempt = {
  k: number; time_sent: string; sent: boolean | null; seconds: number | null; http_status: number | null; status: string | null
  cost_usd: number | null; usage: Record<string, number> | null; provider_returned: string | null; finish_reason: string | null
  generation_id: string | null; raw_file: string | null; raw_bytes: number | null; error: string | null
}
export type RunVariantDetail = {
  variant: RunVariant; record: Record<string, unknown>; params: Record<string, unknown>
  messages: { role: string; content: string }[]; attempts: RunAttempt[]; answer: string | null; reasoning: string | null
  code: string | null; code_file: string | null; build_log: string | null
  compile_errors: RunCompileError[]; tests: RunTestRow[]; events: RunEvent[]
}
export type RunFailures = {
  variants: number; tested: number; compiled_fail: number; with_failures: number; tests_total: number
  compile: { category: string; explanation: string; errors: number; variants: { id: string; errors: number }[]; messages: { message: string; count: number }[] }[]
  failing_tests: { test: string; group: string; variants: string[]; messages: { message: string; count: number }[] }[]
  signatures: { id: string; tests: string[]; variants: string[] }[]
  variant_failing: Record<string, string[]>
  pairs: { a: string; b: string; both: number; union: number; jaccard: number | null }[]
}
export type RunFilter = { target?: string; model?: string; setting?: string; sample?: number; outcome?: string }

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}api${path}`)
  if (!res.ok) {
    let detail = res.statusText
    try { detail = (await res.json()).detail ?? detail } catch { /* not JSON */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return res.json() as Promise<T>
}

function query(f: Record<string, string | number | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') q.set(k, String(v))
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const runApi = {
  overview: () => request<RunOverview>('/run/overview'),
  variants: (f: RunFilter = {}) => request<RunVariant[]>(`/run/variants${query(f)}`),
  variant: (id: string) => request<RunVariantDetail>(`/run/variant${query({ id })}`),
  failures: (f: RunFilter = {}) => request<RunFailures>(`/run/failures${query({ target: f.target, model: f.model, setting: f.setting })}`),
  events: (kind?: string) => request<{ total: number; kinds: string[]; events: RunEvent[] }>(`/run/events${query({ kind })}`),
  prompt: (target: string) => request<{ target: string; file: string; text: string }>(`/run/prompt${query({ target })}`),
}
/** Downloads are plain links into the API. */
export const runFileUrl = (path: string) => `${import.meta.env.BASE_URL}api/run/${path}`
