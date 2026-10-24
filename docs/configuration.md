# Run configuration

A run is described by one JSON file, for example [`config/example.json`](../config/example.json). The same file is
read by every command: `fdlab.generate`, `fdlab.evaluate`, `fdlab.report`, `fdlab.serve` and (for the demo)
`fdlab.demo`. Relative paths are resolved against the repository root, not against the current directory.

The plan is the cross product **models x settings x targets x samples**, minus the settings a model skips. Every
planned request has the id

```
<target id>/<model label>/<setting name>/s<NN>
```

for example `tipjar/glm-5.3-flash/ON-LOW/s02`. Ids are stable: they name the record, the raw answers, the variant
and the test folder of that request.

Keys starting with `_` (such as `_note`) are ignored and can hold comments.

## Top level

| Field | Required | Default | Meaning |
|---|---|---|---|
| `title` | no | `"Fault diversity run"` | Shown on the dashboard. |
| `demo` | no | `false` | Marks a demo config. `fdlab.generate --send` refuses to send it. |
| `targets` | yes | | The programs to generate, see [Targets](#targets). |
| `settings` | yes | | Named request settings, see [Settings](#settings). |
| `models` | yes | | The models, see [Models](#models). |
| `samples` | yes | | Independent requests per (target, model, setting). |
| `max_tokens` | yes | | Output token limit sent with every request. A model whose `max_output` is lower gets its `max_output` instead (the plan marks it as "capped"). |
| `cap_usd` | yes | | Upper bound for `--cap`: `--send` refuses a cap above it. |
| `out_dir` | yes | | The run folder, see [run-folder.md](run-folder.md). One folder per run; never share it between configs. |
| `base_url` | no | `https://openrouter.ai/api/v1` | API base. Only change it to point at a local test server. |
| `request_timeout_s` | no | `3600` | Wall-clock limit per request. When it hits, the request becomes `needs_review` (it may have been billed). |
| `read_timeout_s` | no | `null` | Socket read timeout. `null` means none: a reasoning model can stay silent for minutes before it answers. |
| `rate_limit_backoff_s` | no | `[30, 120]` | After an HTTP 429, wait a random time in this range (seconds) before trying again. |
| `rate_limit_retries` | no | `3` | HTTP 429 retries per request. After that the request is `not_sent` and goes out again on the next run. |
| `connect_backoff_s` | no | `10` | Wait before retrying a connection that never opened (multiplied by the try number). |
| `connect_retries` | no | `3` | Retries for connections that never opened. |
| `endpoints_dir` | no | | Folder with OpenRouter endpoint snapshots; see [Endpoint snapshots](#endpoint-snapshots). |
| `test_timeout_s` | no | `1800` | Time limit for building and testing one variant. A variant that hits it gets no result and is tested again next time. |

## Targets

A target is one program the models are asked to write: a prompt plus a test harness.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Short name used in request ids. Must not contain `/`. |
| `name` | no | Display name on the dashboard (defaults to `id`). |
| `language` | no | Free text such as `solidity` or `java`, shown on the dashboard. |
| `prompt` | yes | Path of the prompt file. Format: [adding-a-target.md](adding-a-target.md#the-prompt-file). |
| `runner` | for tests | `forge` (Foundry) or `gradle` (Gradle with JUnit 5). |
| `harness` | for tests | Folder with the build files and the test suite. It is copied to a fresh temporary folder for every variant and never changed. |
| `slot` | no | Where the variant goes inside the harness copy. Default: `src/<Output file>` from the prompt. Java targets usually need a package path, for example `src/main/java/demo/Counter.java`. |

The generator only uses `id` and `prompt`. `runner`, `harness` and `slot` are used by `fdlab.evaluate`, and
`name` and `language` by the dashboard.

## Settings

`settings` maps a setting name to the request fields it adds. The name is free, but the dashboard has plain
labels for `OFF-T0.2`, `OFF-T0.8`, `ON-LOW`, `ON-HIGH` and `ON-DEFAULT`, and the findings page treats every
setting whose name starts with `OFF` as "reasoning off".

```json
"settings": {
  "OFF-T0.2": {"reasoning": {"enabled": false}, "temperature": 0.2},
  "ON-HIGH": {"reasoning": {"enabled": true, "effort": "high"}}
}
```

Allowed fields, checked before anything is sent:

| Field | Values |
|---|---|
| `reasoning` | `{"enabled": true or false, "effort"?, "max_tokens"?, "exclude"?}`. `effort` is one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and only allowed with `enabled: true`. |
| `temperature` | Number in [0, 2]. |
| `top_p` | Number. |

Any other field is an error. The fields are passed to OpenRouter unchanged.

## Models

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | OpenRouter model id, for example `z-ai/glm-5.3-flash`. The part before `/` is the vendor; the dashboard uses it for the letter badge and colour. |
| `label` | no | Name in request ids and on the dashboard. Default: the part of `id` after the last `/`. Must be unique and must not contain `/`. |
| `provider` | yes | Exact `provider_name` of the OpenRouter endpoint to use. Every request is pinned to it (`provider.order` and `provider.only`, no fallbacks, `require_parameters: true`), and an answer from any other provider is recorded as `provider_mismatch` and not used. `TBD` is refused. |
| `provider_tag` | no | Endpoint tag (such as `z-ai/fp8`) sent in `provider.order`/`only` instead of the name, when one provider has several endpoints. The answer must still name `provider`. |
| `price_in`, `price_out` | yes | US$ per million input and output tokens of that endpoint. Used only for the worst-case budget; the billed cost comes from OpenRouter's `usage.cost`. Set them to the endpoint's real prices or higher. |
| `max_output` | yes | The endpoint's output token limit. |
| `settings` | no | Per-setting overrides: `{"ON-HIGH": {...fields...}}` replaces that setting's fields for this model, and `{"OFF-T0.8": null}` skips it. Overrides for unknown setting names are an error. |
| `skip_settings` | no | List of setting names this model does not run (for example a model that cannot turn reasoning off). |
| `reasoning_efforts` | no | The effort levels the model accepts. A setting with another effort is an error for this model. |
| `supported_parameters` | no | The endpoint's supported parameters (from OpenRouter). A setting that uses `reasoning`, `temperature` or `top_p` without support is an error. |

A model that skips a setting has no cell for it: the results matrix shows a hatched square there.

## Worst case and the cap

For every request the plan computes a worst-case cost:

```
worst = (prompt characters / 2.5) x price_in + effective max_tokens x price_out      (prices per token)
```

Before each send, the generator checks `ledger + in flight + worst(next) <= --cap` and stops cleanly when the next
request does not fit. The ledger is the reported cost of every earlier attempt in this `out_dir`, with the worst
case for attempts whose cost is unknown. The cap therefore holds even when every answer uses its full output limit.

## Endpoint snapshots

If `endpoints_dir` is set, the plan checks every model against a saved copy of
`https://openrouter.ai/api/v1/models/<id>/endpoints`, stored as `<endpoints_dir>/<id with / replaced by _>.json`.
It reports an error when the pinned provider (and tag) is not among the endpoints, when the config prices are below
the endpoint's prices, or when `max_output` is above the endpoint's `max_completion_tokens`. Saving the snapshots
next to the config documents what the endpoints offered when the run was planned.

## Command-line options

`python -m fdlab.generate CONFIG`

| Option | Meaning |
|---|---|
| (none) | Plan only: prints every request with its provider, token limit, worst case and state. Opens no network connection. |
| `--send` | Really send. Needs `OPENROUTER_API_KEY` and `--cap`. The key must have a credit limit on openrouter.ai; if the key's remaining credit plus the ledger is below `--cap`, the cap is lowered to that sum. Each `--send` writes a manifest first. |
| `--cap USD` | Spending cap for this `out_dir`, at most `cap_usd`. |
| `--jobs N` | Requests in flight at the same time (default 4). |
| `--only GLOB` | Only request ids matching the glob, for example `'tipjar/*/ON-HIGH/*'`. Repeatable. |
| `--retry ID` | Send one request again on purpose, as a new attempt (after checking the OpenRouter activity page). A request with status `ok` and a variant is never re-sent. |
| `--no-key-check` | Skip the `GET /key` check. Only for a local test server. |

`python -m fdlab.evaluate CONFIG [--only GLOB] [--jobs N] [--force]` tests every variant without a result
(`--force` re-tests all). `--target ID --file PATH --out DIR` tests a single file, for example a reference
implementation.

`python -m fdlab.report CONFIG [--out DIR]` writes `report.json` and four charts (default `<out_dir>/report`).

`python -m fdlab.serve CONFIG [--host H] [--port P]` serves the dashboard (default `http://127.0.0.1:8765`).
