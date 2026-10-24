# The run folder

Everything a run produces lives in its `out_dir` (for example `runs/demo`). The generator and the test runner
write it; the dashboard and the report only read it. Request ids contain `/`; in file names they are written with
`__` instead (`tipjar/alpha-coder/ON-HIGH/s02` becomes `tipjar__alpha-coder__ON-HIGH__s02`).

```
runs/<name>/
  requests/<id with __>.json            one record per request (written by fdlab.generate)
  raw/<id with __>.attempt<k>.json      the HTTP answer of attempt k, byte for byte
  raw/<id with __>.attempt<k>.late.json an answer that arrived after the wall-clock limit (rare)
  variants/<target>/<model>/<setting>/s<NN>/<Output file>   the extracted code
  tests/<target>/<model>/<setting>/s<NN>/                   test results (written by fdlab.evaluate)
    variant.sha256   SHA-256 of the file that was tested
    build.log        compiler output (forge) or the whole Gradle output
    results.csv      one row per test: test,group,status,message
    summary.json     build result and test counts
    forge.json       raw `forge test --json` output (forge targets)
    junit/           copies of the JUnit XML reports (gradle targets)
  events.jsonl       one JSON object per line, in time order
  manifests/<UTC time>.json   one per --send: config, prompt hashes, git commit, versions
  report/            written by fdlab.report (report.json and the charts)
```

Files are written atomically (temporary file, `fsync`, rename), and records, raw answers and variants are created
with an exclusive link, so an existing file is never overwritten. A run folder can be copied, archived or served
while a run is in progress.

## Request record (`requests/*.json`)

Created with status `in_flight` **before** the request is sent, and updated after each attempt.

| Field | Meaning |
|---|---|
| `id`, `target`, `model`, `label`, `setting`, `sample` | Which request this is. `model` is the OpenRouter id, `label` the short name. |
| `pinned_provider` | The provider the request was pinned to. |
| `prompt_file`, `prompt_sha256` | The prompt and its hash at planning time. |
| `output_file`, `max_tokens`, `worst_case_usd` | From the plan. |
| `request_body` | The exact JSON body that is POSTed. |
| `status` | See the table below. |
| `reason` | Why the status is not `ok`, in words. |
| `time_start`, `time_end` | ISO 8601, UTC. |
| `cost_usd` | Billed cost of the last attempt (OpenRouter `usage.cost`). |
| `total_cost_usd` | Cost of all attempts as counted by the cap ledger (unknown costs at worst case). |
| `usage` | `prompt_tokens`, `completion_tokens`, `reasoning_tokens` of the last attempt. |
| `provider_returned`, `finish_reason`, `native_finish_reason`, `generation_id` | From the answer. |
| `extraction` | `{"outcome": "ok" or a failure, "sha256": ...}` (see [adding-a-target.md](adding-a-target.md#the-prompt-file)). |
| `code_sha256`, `variant_file` | The extracted code and where it was saved (only for status `ok`). |
| `attempts` | One entry per attempt: `k`, `time_sent`, `sent` (`true`, `false` = nothing billed, or `null` = unknown), `seconds`, `http_status`, `status`, `cost_usd`, `usage`, `raw_file`, `raw_sha256`, `raw_bytes`, selected response headers, `error`. |
| `history` | Earlier final states, when a request was sent again with `--retry`. |

| Status | Meaning | Sent again? |
|---|---|---|
| `in_flight` | Being sent, or the process ended while it was in flight. Counted at worst case. | No, blocks the id. Check, then `--retry`. |
| `ok` | HTTP 200, finish reason `stop`, non-empty answer from the pinned provider. A variant was saved if extraction succeeded. | Never. |
| `truncated` | The answer hit the token limit or stopped for another reason (`finish_reason` is not `stop`). | No. |
| `empty` | No choices, or empty content. | No. |
| `provider_mismatch` | Answered by another provider than the pinned one. | No. |
| `http_error` | HTTP 4xx (except 408 and 429). 401, 402 and 403 also stop the run. | No. |
| `parse_error` | HTTP 200 with a body that is not valid JSON or not understood. | No. |
| `needs_review` | It may have been billed but has no usable answer: read timeout after sending, wall-clock limit, HTTP 5xx or 408, an error answer that is not JSON, an error inside a 200 answer, or a variant file that already existed. | No, blocks the id. Check the OpenRouter activity page, then `--retry`. |
| `not_sent` | The connection never opened, or HTTP 429 after all retries. Nothing was billed. | Yes, on the next run. |

## Test summary (`tests/.../summary.json`)

```json
{"build": "ok", "runner": "forge", "tests": {"passed": 17, "total": 18}, "skipped": 0,
 "groups": {"TipTest": {"passed": 8, "total": 9}, "AdminTest": {"passed": 9, "total": 9}}, "seconds": 1.9}
```

`build` is `"failed"` (and `tests` is `null`) when the variant does not compile. Skipped tests are not counted in
`passed` or `total`. A variant whose test run hit `test_timeout_s` has no `summary.json` and is tested again by the
next `fdlab.evaluate`.

`results.csv` has one row per test. `status` is `pass`, `fail` or `skipped`, and `message` holds the first 500
characters of the failure reason.

## Event log (`events.jsonl`)

Every line has `time` and `event`; request events also have `id`, `model`, `provider` and `setting`.

| Event | When |
|---|---|
| `key_check` | `GET /key` at the start of `--send`: `limit`, `limit_remaining`, `usage`. |
| `planned` | Each request this run will try. |
| `start`, `end` | A request begins and finishes (`end` has status, cost, tokens, extraction outcome). |
| `attempt_sent`, `raw_saved` | Each attempt, and its saved answer. |
| `error` | A failed attempt and the action taken (`retry`, `needs_review`, `stop run`). |
| `stop_cap` | The next request would exceed the cap; the run stops. |
| `late_response` | An answer arrived after the wall-clock limit and was saved as `.late.json`. |

## Outcome ladder

The dashboard and the report give every planned request exactly one outcome, from its record and test summary:

| Outcome | Shown as | Rule |
|---|---|---|
| `pending` | Not started | No record yet. |
| `running` | Generating now | Record is `in_flight` or still being written. |
| `api_error` | Request failed | Final status other than `ok`, `empty` or `truncated`. |
| `no_code` | No usable code | Status `empty` or `truncated`, or `ok` without a successfully extracted code block. |
| `testing` | Waiting for tests | Code saved, no `summary.json` yet. |
| `compile_error` | Does not compile | `build` is `failed`. |
| `partial` | Fails some tests | Compiles, at least one test fails. |
| `all_pass` | Passes every test | Compiles and every counted test passes. |

The rules are checked in this order. Only `compile_error`, `partial` and `all_pass` are *versions* in the
N-version sense; see [metrics.md](metrics.md).
