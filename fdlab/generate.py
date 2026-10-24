"""Generator: one pinned OpenRouter request per (target, model, setting, sample), sent at most once.

Usage
-----
  python -m fdlab.generate config/example.json                    # plan only (default): requests, costs, checks
  python -m fdlab.generate config/example.json --only 'tipjar/*'  # plan a subset (glob on request ids, repeatable)
  OPENROUTER_API_KEY=... python -m fdlab.generate config/example.json --send --cap 2 --jobs 4
  OPENROUTER_API_KEY=... python -m fdlab.generate config/example.json --send --cap 2 \
      --retry tipjar/glm-5.3-flash/ON-LOW/s02                     # re-send ONE request explicitly (attempt k+1)

Plan mode never opens a network connection. --send needs OPENROUTER_API_KEY in the environment and an explicit
--cap (US$) that is <= the config's cap_usd. Request ids are <target>/<model label>/<setting>/s<NN>. Requests are
ordered sample-major (every s01 first, then s02, ...), so a run stopped by the cap leaves a balanced design.

Guarantees
----------
- Exactly once: before the POST, out_dir/requests/<id>.json is written atomically with status "in_flight", the full
  request body, the prompt sha256 and the worst-case cost. After any response, the raw bytes are written first
  (out_dir/raw/<id>.attempt<k>.json, never truncated), then parsed. A crash leaves "in_flight", which blocks the id.
- Automatic retry ONLY when nothing can have been billed: httpx.ConnectError / ConnectTimeout (the TCP/TLS connection
  never opened, so no request byte was sent) and HTTP 429 (backoff 30-120 s, at most 3 retries). Everything else
  (read/write timeout after sending, wall-clock limit, 5xx, an error inside a 200 answer) -> status "needs_review",
  never re-sent automatically. Use --retry <id> after checking the OpenRouter activity page.
- Cap: local ledger = reported usage.cost of every attempt (worst case when a sent attempt has no reported cost)
  + worst case of every in_flight request. Before each send: ledger + worst(next) <= --cap, under a lock shared by
  all --jobs workers; otherwise the run stops cleanly. With --send, GET /key must show a key limit (not null);
  the cap is also lowered to the key's limit_remaining.
- Worst case = (prompt chars / 2.5) x price_in + effective max_tokens x price_out, with the pinned endpoint's prices.
- Variant written only for status "ok" with finish_reason "stop" and a successful extraction, at
  out_dir/variants/<target>/<model label>/<setting>/s<NN>/<Output file> (sub-folders such as src/ are created).
  Existing records, raw files and variants are never overwritten (hard-link based exclusive create).
- Manifest: every --send writes out_dir/manifests/<UTC time>.json (config copy, prompt sha256, git commit and
  dirty files, generator sha256, python/httpx versions) so the run can be traced to the exact frozen inputs.
- Resume: ok / truncated / empty / provider_mismatch / http_error / parse_error records are done (not re-sent);
  in_flight / needs_review block their id; a record whose prompt sha256 or request body differs from the current
  plan stops the run with an error. "not_sent" records (connection never opened, or 429 retries exhausted) are
  safe to send again and are sent on the next run as a new attempt.

Why stream:false: the whole answer arrives in one JSON body that is saved byte for byte, with usage and cost in
it. A thinking model can stay silent for many minutes, so the read timeout is None (no false "timeout" after the
provider has started billing) and a separate wall-clock limit per request (request_timeout_s, default 3600 s)
bounds the wait. httpx.Timeout(connect=30, read=None, write=60, pool=30). If the wall-clock limit hits, the
request becomes needs_review; if the answer still arrives later while the program runs, it is saved as
raw/<id>.attempt<k>.late.json and logged ("late_response") so the paid answer is not lost.

Run config (see config/example.json and docs/configuration.md): targets [{id, prompt, ...}],
settings {name: request fields}, models [{id, label?, provider (exact provider_name, checked against the answer),
provider_tag? (endpoint tag such as "mistral/eu", sent instead of the name in provider.order/only), price_in,
price_out, max_output, settings?: {name: fields | null}, skip_settings?, reasoning_efforts?, supported_parameters?}],
samples, max_tokens, cap_usd, out_dir, base_url, request_timeout_s, read_timeout_s (null), endpoints_dir (optional:
checks provider, prices and max_output against the snapshot), rate_limit_backoff_s [30, 120], connect_backoff_s 10,
connect_retries 3, rate_limit_retries 3. Relative paths are resolved against the repository root. Target fields
other than id and prompt (name, runner,
harness, slot, ...) are used by the test runner and the dashboard, not here.
"""

from __future__ import annotations

import argparse
import copy
import fnmatch
import hashlib
import json
import os
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from fdlab.extract import THINK, extract

ROOT = Path(__file__).resolve().parents[1]

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
CHARS_PER_TOKEN = 2.5
EFFORTS = {"none", "minimal", "low", "medium", "high", "xhigh", "max"}
SETTING_KEYS = {"reasoning", "temperature", "top_p"}
DONE = {"ok", "truncated", "empty", "provider_mismatch", "http_error", "parse_error"}
BLOCKING = {"in_flight", "needs_review"}
KEPT_HEADERS = ("x-request-id", "cf-ray", "retry-after", "date")  # response headers saved with each attempt
STOP_HTTP = {401, 402, 403}  # key or credit problem: stop the whole run
JAVA_START = re.compile(r"^\s*(package\b|import\b|public\s+((final|abstract)\s+)?(class|interface|enum|record)\b)")


class PlanError(Exception):
    pass


# ---------------------------------------------------------------- small helpers

def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def sha256(data: bytes | str) -> str:
    return hashlib.sha256(data.encode() if isinstance(data, str) else data).hexdigest()


def safe_id(rid: str) -> str:
    return rid.replace("/", "__")


def _fsync_dir(path: Path) -> None:
    try:
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


def _write_tmp(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    return tmp


def atomic_replace(path: Path, data: bytes) -> None:
    """Write .tmp, fsync, os.replace (used only to update a record this process owns)."""
    tmp = _write_tmp(path, data)
    os.replace(tmp, path)
    _fsync_dir(path.parent)


def atomic_create(path: Path, data: bytes) -> None:
    """Like atomic_replace, but fails with FileExistsError instead of overwriting an existing file."""
    tmp = _write_tmp(path, data)
    try:
        os.link(tmp, path)  # atomic and exclusive
    finally:
        os.unlink(tmp)
    _fsync_dir(path.parent)


def dump(obj) -> bytes:
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode()


def messages(prompt: str) -> list[dict]:
    """Split a prompt file into chat messages: '=== SYSTEM ===' <system text> '=== USER ===' <user text>."""
    if "=== USER ===" not in prompt:
        raise PlanError("prompt has no '=== USER ===' line")
    system, user = prompt.split("=== USER ===", 1)
    system = system.replace("=== SYSTEM ===", "", 1)
    return [{"role": "system", "content": system.strip()}, {"role": "user", "content": user.strip()}]


def output_file(prompt: str) -> str:
    m = re.search(r"^Output file: (\S+)$", prompt, re.M)
    if not m:
        raise PlanError("prompt has no 'Output file:' line")
    name = m.group(1)
    if name.startswith("/") or ".." in Path(name).parts:
        raise PlanError(f"unsafe output file {name!r}")
    return name


def content_text(content) -> str | None:
    """message.content may be a string, None, or a list of parts ({type: text, text: ...})."""
    if content is None or isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, str):
                parts.append(p)
            elif isinstance(p, dict) and isinstance(p.get("text"), str) and p.get("type", "text") in ("text", "output_text"):
                parts.append(p["text"])
        return "".join(parts)
    return str(content)


def extract_code(content) -> dict:
    text = content_text(content)
    ex = extract(text)
    if ex["outcome"] == "no_code" and text:
        stripped = THINK.sub("", text)
        if JAVA_START.match(stripped) and stripped.strip():
            return {"outcome": "ok", "code": stripped, "sha256": sha256(stripped), "unfenced": True}
    return ex


# ---------------------------------------------------------------- plan

@dataclass
class Request:
    id: str
    target: str
    model: str
    label: str
    provider: str
    setting: str
    sample: int
    body: dict
    prompt_file: str
    prompt_sha256: str
    output_file: str
    worst_usd: float
    max_tokens: int
    capped: bool
    record_path: Path
    variant_path: Path
    state: str = "pending"  # pending | done | blocked | conflict
    note: str = ""
    attempts_so_far: int = 0


@dataclass
class Plan:
    cfg: dict
    out_dir: Path
    requests: list[Request] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    spent_usd: float = 0.0  # ledger from existing records (reported costs + worst case of unknown/in_flight)
    orphans: list[str] = field(default_factory=list)


def resolve(p: str) -> Path:
    path = Path(p)
    return path if path.is_absolute() else ROOT / path


def validate_setting(name: str, fields: dict, model: dict) -> list[str]:
    errs = []
    if not isinstance(fields, dict):
        return [f"setting {name}: must be an object"]
    extra = set(fields) - SETTING_KEYS
    if extra:
        errs.append(f"setting {name}: unknown fields {sorted(extra)}")
    r = fields.get("reasoning")
    if r is not None:
        if not isinstance(r, dict) or not isinstance(r.get("enabled"), bool):
            errs.append(f"setting {name}: reasoning must be {{'enabled': true|false, ...}}")
        else:
            unknown = sorted(set(r) - {"enabled", "effort", "max_tokens", "exclude"})
            if unknown:
                errs.append(f"setting {name}: unknown reasoning fields {unknown}")
            eff = r.get("effort")
            if eff is not None:
                if not r["enabled"]:
                    errs.append(f"setting {name}: effort given with reasoning disabled")
                if eff not in EFFORTS:
                    errs.append(f"setting {name}: unknown effort {eff!r}")
                elif model.get("reasoning_efforts") is not None and eff not in model["reasoning_efforts"]:
                    errs.append(f"setting {name}: effort {eff!r} not offered by {model['id']} "
                                f"(has {model['reasoning_efforts']})")
    t = fields.get("temperature")
    if t is not None and (not isinstance(t, (int, float)) or isinstance(t, bool) or not 0 <= t <= 2):
        errs.append(f"setting {name}: temperature must be a number in [0, 2]")
    sp = model.get("supported_parameters")
    if sp is not None:
        for key in ("reasoning", "temperature", "top_p"):
            if key in fields and key not in sp:
                errs.append(f"setting {name}: {model['id']} endpoint does not support '{key}'")
    return [f"{model['id']}: {e}" for e in errs]


def check_endpoint(model: dict, endpoints_dir: Path) -> list[str]:
    f = endpoints_dir / (model["id"].replace("/", "_") + ".json")
    if not f.exists():
        return [f"{model['id']}: no endpoint snapshot {f.name} in {endpoints_dir}"]
    eps = [e for e in json.loads(f.read_text())["data"]["endpoints"] if e.get("provider_name") == model["provider"]]
    if model.get("provider_tag"):
        eps = [e for e in eps if e.get("tag") == model["provider_tag"]]
    if not eps:
        return [f"{model['id']}: provider {model['provider']!r} (tag {model.get('provider_tag')}) "
                f"not among the snapshot's endpoints"]
    errs = []
    p_in = max(float(e["pricing"]["prompt"]) for e in eps) * 1e6
    p_out = max(float(e["pricing"]["completion"]) for e in eps) * 1e6
    if model["price_in"] + 1e-9 < p_in or model["price_out"] + 1e-9 < p_out:
        errs.append(f"{model['id']}: config prices {model['price_in']}/{model['price_out']} below the endpoint's "
                    f"{p_in:.4f}/{p_out:.4f} $/M")
    caps = [e.get("max_completion_tokens") for e in eps if e.get("max_completion_tokens")]
    if caps and model["max_output"] > min(caps):
        errs.append(f"{model['id']}: max_output {model['max_output']} > endpoint max_completion_tokens {min(caps)}")
    if len(eps) > 1:
        errs.append(f"WARN {model['id']}: {model['provider']!r} matches {len(eps)} endpoints "
                    f"({', '.join(e.get('tag', '?') for e in eps)}); the highest price is used for the check")
    return errs


def build_plan(cfg: dict, only: list[str] | None = None) -> Plan:
    out_dir = resolve(cfg["out_dir"])
    plan = Plan(cfg=cfg, out_dir=out_dir)
    for key in ("targets", "settings", "models", "samples", "max_tokens", "cap_usd", "out_dir"):
        if key not in cfg:
            raise PlanError(f"config: missing '{key}'")
    endpoints_dir = resolve(cfg["endpoints_dir"]) if cfg.get("endpoints_dir") else None
    targets = []
    for t in cfg["targets"]:
        path = resolve(t["prompt"])
        text = path.read_text()
        msgs = messages(text)
        chars = sum(len(m["content"]) for m in msgs)
        targets.append((t["id"], t["prompt"], text, msgs, output_file(text), chars))
    labels = set()
    for m in cfg["models"]:
        missing = [k for k in ("id", "provider", "price_in", "price_out", "max_output") if m.get(k) in (None, "")]
        if missing:
            plan.errors.append(f"model {m.get('id')}: missing {missing}")
            continue
        label = m.get("label") or m["id"].split("/")[-1]
        if label in labels or "/" in label:
            plan.errors.append(f"model {m['id']}: label {label!r} duplicate or contains '/'")
        labels.add(label)
        if str(m["provider"]).strip().upper() in ("TBD", "") or "TBD" in str(m["provider"]).upper():
            plan.errors.append(f"model {m['id']}: provider is TBD")
        if endpoints_dir:
            for e in check_endpoint(m, endpoints_dir):
                (plan.warnings if e.startswith("WARN ") else plan.errors).append(e.removeprefix("WARN "))
        eff_max = min(int(cfg["max_tokens"]), int(m["max_output"]))
        route = m.get("provider_tag") or m["provider"]  # sent in provider.order/only; answer must name m["provider"]
        overrides = m.get("settings") or {}
        for oname in overrides:
            if oname not in cfg["settings"]:
                plan.errors.append(f"model {m['id']}: override for unknown setting {oname!r}")
        for sname, base in cfg["settings"].items():
            if sname in (m.get("skip_settings") or []):
                continue
            fields = overrides.get(sname, base)
            if fields is None:  # explicit null = skip this setting for this model
                continue
            errs = validate_setting(sname, fields, m)
            plan.errors.extend(errs)
            if errs:
                continue
            for tid, tprompt, text, msgs, outfile, chars in targets:
                for s in range(1, int(cfg["samples"]) + 1):
                    rid = f"{tid}/{label}/{sname}/s{s:02d}"
                    body = {"model": m["id"], "messages": msgs, "max_tokens": eff_max, **copy.deepcopy(fields),
                            "usage": {"include": True},
                            "provider": {"order": [route], "only": [route],
                                         "allow_fallbacks": False, "require_parameters": True}}
                    worst = (chars / CHARS_PER_TOKEN * m["price_in"] + eff_max * m["price_out"]) / 1e6
                    plan.requests.append(Request(
                        id=rid, target=tid, model=m["id"], label=label, provider=m["provider"], setting=sname,
                        sample=s, body=body, prompt_file=tprompt, prompt_sha256=sha256(text), output_file=outfile,
                        worst_usd=worst, max_tokens=eff_max, capped=eff_max < int(cfg["max_tokens"]),
                        record_path=out_dir / "requests" / f"{safe_id(rid)}.json",
                        variant_path=out_dir / "variants" / tid / label / sname / f"s{s:02d}" / outfile))
    plan.requests.sort(key=lambda r: (r.sample, r.model, r.setting, r.target))
    if only:
        plan.requests = [r for r in plan.requests if any(fnmatch.fnmatchcase(r.id, pat) for pat in only)]
    # resume state and ledger from existing records
    known = {r.record_path.name: r for r in plan.requests}
    req_dir = out_dir / "requests"
    if req_dir.exists():
        for f in sorted(req_dir.glob("*.json")):
            rec = json.loads(f.read_text())
            plan.spent_usd += record_cost(rec)
            r = known.get(f.name)
            if r is None:
                plan.orphans.append(rec.get("id", f.name))
                continue
            r.attempts_so_far = len(rec.get("attempts", []))
            if rec.get("prompt_sha256") != r.prompt_sha256 or rec.get("request_body") != r.body:
                what = "prompt sha256" if rec.get("prompt_sha256") != r.prompt_sha256 else "request body"
                r.state, r.note = "conflict", f"{what} differs from the existing record"
                plan.errors.append(f"{r.id}: {what} differs from the existing record {f}")
            elif rec.get("status") in BLOCKING:
                r.state, r.note = "blocked", rec["status"]
            elif rec.get("status") in DONE:
                r.state, r.note = "done", rec["status"]
            else:  # not_sent: nothing billed, may be sent again
                r.state, r.note = "pending", f"resend ({rec.get('status')})"
    return plan


def attempt_cost(a: dict, worst: float) -> float:
    if a.get("sent") is False:  # connection never opened, or HTTP 429: nothing billed
        return 0.0
    c = a.get("cost_usd")
    # sent with unknown cost, or still in flight (sent is None): assume the worst case
    return float(c) if isinstance(c, (int, float)) else worst


def record_cost(rec: dict) -> float:
    worst = rec.get("worst_case_usd", 0.0)
    total = sum(attempt_cost(a, worst) for a in rec.get("attempts", []))
    if rec.get("status") == "in_flight" and not any(a.get("sent") is None for a in rec.get("attempts", [])):
        total += worst  # in_flight always counts at its worst case
    return total


def print_plan(plan: Plan, cap: float | None) -> None:
    print(f"out_dir {plan.out_dir}")
    print(f"{'request id':58} {'provider':18} {'max_tok':>8} {'worst $':>8}  state")
    for r in plan.requests:
        flag = " (capped at max_output)" if r.capped else ""
        note = f" [{r.note}]" if r.note else ""
        print(f"{r.id:58} {r.provider:18} {r.max_tokens:>8} {r.worst_usd:8.4f}  {r.state}{note}{flag}")
    by = {s: [r for r in plan.requests if r.state == s] for s in ("pending", "done", "blocked", "conflict")}
    worst_pending = sum(r.worst_usd for r in by["pending"])
    print(f"\nrequests {len(plan.requests)}: pending {len(by['pending'])}, done {len(by['done'])}, "
          f"blocked {len(by['blocked'])}, conflict {len(by['conflict'])}")
    print(f"worst case of all pending ${worst_pending:.2f}; ledger already spent ${plan.spent_usd:.4f}; "
          f"config cap ${plan.cfg['cap_usd']}" + (f"; --cap ${cap}" if cap is not None else ""))
    per_model: dict[str, float] = {}
    for r in by["pending"]:
        per_model[r.label] = per_model.get(r.label, 0) + r.worst_usd
    for label, w in per_model.items():
        print(f"  {label:32} worst ${w:.2f}")
    for b in by["blocked"]:
        print(f"BLOCKED {b.id}: {b.note} (check the OpenRouter activity page, then --retry {b.id})")
    for o in plan.orphans:
        print(f"note: record not in the current plan: {o} (its cost is in the ledger)")
    for w in plan.warnings:
        print(f"WARNING {w}")
    for e in plan.errors:
        print(f"ERROR {e}")


def write_manifest(plan: Plan, argv: list[str], config_path: str) -> Path:
    """Snapshot of what produced this run: config, prompts, code version. One file per --send invocation."""
    import platform
    import subprocess

    def git(*args: str) -> str | None:
        try:
            return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            return None
    try:
        import httpx
        httpx_version = httpx.__version__
    except ImportError:
        httpx_version = None
    cfg_text = Path(config_path).read_text()
    prompts = {}
    for t in plan.cfg["targets"]:
        prompts[t["id"]] = {"file": t["prompt"], "sha256": sha256(resolve(t["prompt"]).read_bytes())}
    manifest = {
        "time": now(), "argv": argv, "config_file": config_path, "config_sha256": sha256(cfg_text),
        "config": json.loads(cfg_text), "prompts": prompts,
        "git_commit": git("rev-parse", "HEAD"), "git_describe": git("describe", "--tags", "--always"),
        "git_dirty_files": (git("status", "--porcelain") or "").splitlines(),
        "generator_sha256": sha256(Path(__file__).read_bytes()),
        "python": sys.version.split()[0], "httpx": httpx_version, "host": platform.node(),
        "requests_planned": len(plan.requests),
    }
    path = plan.out_dir / "manifests" / f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    atomic_create(path, dump(manifest))
    return path


# ---------------------------------------------------------------- runner

class Runner:
    def __init__(self, plan: Plan, cap: float, key: str, jobs: int):
        cfg = plan.cfg
        self.plan, self.cap, self.key, self.jobs = plan, cap, key, jobs
        self.base = (cfg.get("base_url") or DEFAULT_BASE_URL).rstrip("/")
        self.wall = float(cfg.get("request_timeout_s", 3600))
        self.read_timeout = cfg.get("read_timeout_s")  # None = no read timeout (see docstring)
        self.rl_backoff = cfg.get("rate_limit_backoff_s", [30, 120])
        self.rl_retries = int(cfg.get("rate_limit_retries", 3))
        self.conn_backoff = float(cfg.get("connect_backoff_s", 10))
        self.conn_retries = int(cfg.get("connect_retries", 3))
        self.lock = threading.Lock()
        self.log_lock = threading.Lock()
        self.ledger = plan.spent_usd  # reported costs + worst case of sent attempts with unknown cost
        self.reserved = 0.0           # worst case of requests in flight in this process
        self.stop = threading.Event()
        self.stop_reason = ""
        self.events = plan.out_dir / "events.jsonl"
        plan.out_dir.mkdir(parents=True, exist_ok=True)

    # -- log
    def log(self, event: str, r: Request | None = None, **kw) -> None:
        entry = {"time": now(), "event": event}
        if r is not None:
            entry |= {"id": r.id, "model": r.model, "provider": r.provider, "setting": r.setting}
        entry |= kw
        line = (json.dumps(entry, ensure_ascii=False) + "\n").encode()
        with self.log_lock:
            with open(self.events, "ab") as f:
                f.write(line)
                f.flush()
                os.fsync(f.fileno())

    def client(self):
        import httpx
        return httpx.Client(timeout=httpx.Timeout(connect=30, read=self.read_timeout, write=60, pool=30),
                            headers={"Authorization": f"Bearer {self.key}",
                                     "HTTP-Referer": "https://github.com/MYRhouma/fault-diversity-lab",
                                     "X-Title": "fault-diversity-lab"})

    def key_check(self) -> str | None:
        """GET /key: refuse a key without a limit; lower the cap to limit_remaining."""
        import httpx
        try:
            with self.client() as c:
                d = c.get(f"{self.base}/key").json()["data"]
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
            return f"/key check failed: {type(e).__name__}: {e}"
        if d.get("limit") is None:
            return "the API key has no credit limit (limit is null); set a limit on openrouter.ai/settings/keys"
        remaining = d.get("limit_remaining")
        if isinstance(remaining, (int, float)) and self.ledger + remaining < self.cap:
            print(f"key limit_remaining ${remaining:.4f} + ledger ${self.ledger:.4f} < --cap ${self.cap}: cap lowered")
            self.cap = float(remaining) + self.ledger
        self.log("key_check", limit=d.get("limit"), limit_remaining=remaining, usage=d.get("usage"))
        return None

    # -- ledger
    def reserve(self, r: Request) -> bool:
        with self.lock:
            if self.stop.is_set():
                return False
            if self.ledger + self.reserved + r.worst_usd > self.cap + 1e-12:
                self.stop_reason = (f"cap: ledger ${self.ledger:.4f} + in flight ${self.reserved:.4f} + "
                                    f"worst ${r.worst_usd:.4f} > cap ${self.cap:.4f}")
                self.stop.set()
                self.log("stop_cap", r, ledger=round(self.ledger, 6), reserved=round(self.reserved, 6),
                         worst=round(r.worst_usd, 6), cap=self.cap)
                return False
            self.reserved += r.worst_usd
            return True

    def settle(self, r: Request, attempts: list[dict]) -> None:
        with self.lock:
            self.reserved -= r.worst_usd
            self.ledger += sum(attempt_cost(a, r.worst_usd) for a in attempts)

    # -- one request
    def run_one(self, r: Request, retry: bool = False) -> str:
        if self.stop.is_set() or not self.reserve(r):
            return "stopped"
        try:
            return self._run_reserved(r, retry)
        except Exception as e:  # never lose the reservation silently
            self.log("error", r, error=f"{type(e).__name__}: {e}")
            raise

    def _run_reserved(self, r: Request, retry: bool) -> str:
        if r.record_path.exists():
            rec = json.loads(r.record_path.read_text())
            if not retry and rec.get("status") not in ("not_sent",):
                self.settle(r, [])
                return "skipped"
            prev_cost = record_cost(rec)
            for a in rec.get("attempts", []):
                if a.get("sent") is None:  # crashed attempt, explicitly retried: unknown outcome and cost
                    a |= {"sent": True, "status": "lost_in_flight", "cost_usd": None,
                          "note": "process ended while in flight; outcome unknown; counted at worst case"}
            history = rec.get("history", [])
            history.append({k: rec.get(k) for k in ("status", "time_end", "finish_reason", "cost_usd")})
            rec["history"] = history
        else:
            prev_cost = 0.0
            rec = {"id": r.id, "target": r.target, "model": r.model, "label": r.label,
                   "pinned_provider": r.provider, "setting": r.setting, "sample": r.sample,
                   "prompt_file": r.prompt_file, "prompt_sha256": r.prompt_sha256, "output_file": r.output_file,
                   "max_tokens": r.max_tokens, "worst_case_usd": round(r.worst_usd, 6),
                   "request_body": r.body, "attempts": []}
        rec |= {"status": "in_flight", "time_start": now()}
        if r.record_path.exists():
            atomic_replace(r.record_path, dump(rec))
        else:
            atomic_create(r.record_path, dump(rec))  # never overwrites a record of another run
        self.log("start", r, worst=round(r.worst_usd, 6), retry=retry)
        new_attempts = self._send(r, rec)
        # the crashed in_flight attempt (if any) was already counted in the plan ledger; count only new ones
        self.settle(r, new_attempts)
        self.log("end", r, status=rec["status"], cost=rec.get("cost_usd"),
                 tokens=rec.get("usage"), finish_reason=rec.get("finish_reason"),
                 provider_returned=rec.get("provider_returned"), extraction=rec.get("extraction", {}).get("outcome"),
                 record_cost=round(prev_cost + sum(attempt_cost(a, r.worst_usd) for a in new_attempts), 6))
        return rec["status"]

    def _post(self, r: Request, k: int):
        """POST in a helper thread, bounded by the wall-clock limit. Returns (kind, value)."""
        import httpx
        box: dict = {}
        done = threading.Event()
        state = {"abandoned": False}

        def work():
            try:
                with self.client() as c:
                    resp = c.post(f"{self.base}/chat/completions", json=r.body)
                    box["resp"] = (resp.status_code, dict(resp.headers), resp.content)
            except (httpx.ConnectError, httpx.ConnectTimeout) as e:
                box["connect_error"] = f"{type(e).__name__}: {e}"
            except BaseException as e:
                box["error"] = f"{type(e).__name__}: {e}"
            done.set()
            if state["abandoned"] and "resp" in box:  # the answer arrived after the wall-clock limit
                path = self.plan.out_dir / "raw" / f"{safe_id(r.id)}.attempt{k}.late.json"
                try:
                    atomic_create(path, box["resp"][2])
                    self.log("late_response", r, attempt=k, http_status=box["resp"][0], file=str(path))
                except OSError:
                    pass

        t = threading.Thread(target=work, daemon=True)
        t.start()
        if not done.wait(self.wall):
            state["abandoned"] = True
            if not done.is_set():
                return "wall", f"no answer within the wall-clock limit of {self.wall:g} s"
        if "resp" in box:
            return "resp", box["resp"]
        if "connect_error" in box:
            return "connect", box["connect_error"]
        return "error", box["error"]

    def _send(self, r: Request, rec: dict) -> list[dict]:
        new: list[dict] = []
        conn_tries = rl_tries = 0
        while True:
            k = len(rec["attempts"]) + 1
            att = {"k": k, "time_sent": now(), "sent": None}  # None = maybe sent (until we know)
            rec["attempts"].append(att)
            new.append(att)
            atomic_replace(r.record_path, dump(rec))
            self.log("attempt_sent", r, attempt=k)
            t0 = time.time()
            kind, val = self._post(r, k)
            att["seconds"] = round(time.time() - t0, 2)
            if kind == "connect":
                att |= {"sent": False, "status": "connect_error", "error": val}
                conn_tries += 1
                if conn_tries <= self.conn_retries and not self.stop.is_set():
                    self.log("error", r, attempt=k, error=val, action="retry (nothing was sent)")
                    atomic_replace(r.record_path, dump(rec))
                    time.sleep(self.conn_backoff * conn_tries)
                    continue
                return self._finish(r, rec, "not_sent", f"connection failed {conn_tries} times: {val}", new)
            if kind in ("wall", "error"):
                att |= {"sent": True, "status": "needs_review", "error": val, "cost_usd": None}
                self.log("error", r, attempt=k, error=val, action="needs_review")
                return self._finish(r, rec, "needs_review", val, new)
            status_code, headers, raw = val
            raw_path = self.plan.out_dir / "raw" / f"{safe_id(r.id)}.attempt{k}.json"
            atomic_create(raw_path, raw)  # first: the untruncated bytes
            att |= {"http_status": status_code, "raw_file": str(raw_path.relative_to(self.plan.out_dir)),
                    "raw_sha256": sha256(raw), "raw_bytes": len(raw),
                    "headers": {h: v for h, v in headers.items() if h.lower() in KEPT_HEADERS}}
            self.log("raw_saved", r, attempt=k, http_status=status_code, bytes=len(raw))
            if status_code == 429:
                att |= {"sent": False, "status": "rate_limited", "cost_usd": 0.0}
                rl_tries += 1
                if rl_tries <= self.rl_retries and not self.stop.is_set():
                    lo, hi = self.rl_backoff
                    wait = random.uniform(lo, hi)
                    self.log("error", r, attempt=k, error="HTTP 429", action=f"retry after {wait:.1f} s")
                    atomic_replace(r.record_path, dump(rec))
                    time.sleep(wait)
                    continue
                return self._finish(r, rec, "not_sent", f"HTTP 429 {rl_tries} times", new)
            att["sent"] = True
            return self._parse(r, rec, att, status_code, raw, new)

    def _parse(self, r, rec, att, status_code, raw, new) -> list[dict]:
        try:
            data = json.loads(raw)
        except ValueError as e:
            att |= {"status": "parse_error" if status_code == 200 else "needs_review", "error": f"not JSON: {e}",
                    "cost_usd": None}
            if status_code != 200:
                return self._finish(r, rec, "needs_review", f"HTTP {status_code}, body not JSON", new)
            return self._finish(r, rec, "parse_error", f"not JSON: {e}", new)
        try:
            return self._interpret(r, rec, att, status_code, data, new)
        except Exception as e:
            att |= {"status": "parse_error", "error": f"{type(e).__name__}: {e}"}
            att.setdefault("cost_usd", None)
            return self._finish(r, rec, "parse_error", f"{type(e).__name__}: {e}", new)

    def _interpret(self, r, rec, att, status_code, data, new) -> list[dict]:
        if not isinstance(data, dict):
            raise ValueError("response JSON is not an object")
        usage = data.get("usage") or {}
        details = usage.get("completion_tokens_details") or {}
        cost = usage.get("cost")
        att |= {"cost_usd": cost if isinstance(cost, (int, float)) else None,
                "usage": {"prompt_tokens": usage.get("prompt_tokens"),
                          "completion_tokens": usage.get("completion_tokens"),
                          "reasoning_tokens": details.get("reasoning_tokens")},
                "generation_id": data.get("id"), "provider_returned": data.get("provider"),
                "model_returned": data.get("model")}
        if status_code != 200:
            err = str(data.get("error") or data)[:2000]
            if status_code in STOP_HTTP or (400 <= status_code < 500 and status_code != 408):
                att["status"] = "http_error"
                if status_code in STOP_HTTP:
                    self.stop_reason = f"HTTP {status_code}: {err[:300]}"
                    self.stop.set()
                    self.log("error", r, error=self.stop_reason, action="stop run")
                return self._finish(r, rec, "http_error", f"HTTP {status_code}: {err}", new)
            att["status"] = "needs_review"
            return self._finish(r, rec, "needs_review", f"HTTP {status_code}: {err}", new)
        choices = data.get("choices")
        choice = choices[0] if isinstance(choices, list) and choices else None
        choice_err = data.get("error") or (choice or {}).get("error") or \
            ((choice or {}).get("finish_reason") == "error" and "finish_reason error")
        if choice_err:
            att["status"] = "needs_review"
            return self._finish(r, rec, "needs_review", f"error inside HTTP 200: {str(choice_err)[:1000]}", new)
        if choice is None:
            att["status"] = "empty"
            return self._finish(r, rec, "empty", "no choices in the answer", new)
        msg = choice.get("message") or {}
        att |= {"finish_reason": choice.get("finish_reason"), "native_finish_reason": choice.get("native_finish_reason")}
        ex = extract_code(msg.get("content"))
        att["extraction"] = {k: v for k, v in ex.items() if k != "code"}
        if data.get("provider") != r.provider:
            att["status"] = "provider_mismatch"
            return self._finish(r, rec, "provider_mismatch",
                                f"answered by {data.get('provider')!r}, pinned {r.provider!r}", new)
        if choice.get("finish_reason") != "stop":
            att["status"] = "truncated"
            return self._finish(r, rec, "truncated", f"finish_reason {choice.get('finish_reason')!r}", new)
        text = content_text(msg.get("content"))
        if not text or not text.strip():
            att["status"] = "empty"
            return self._finish(r, rec, "empty", "empty content", new)
        att["status"] = "ok"
        if ex.get("code"):
            try:
                atomic_create(r.variant_path, ex["code"].encode())
                att["variant_file"] = str(r.variant_path.relative_to(self.plan.out_dir))
            except FileExistsError:
                att["variant_file"] = None
                att["variant_error"] = "variant file already exists; not overwritten"
                return self._finish(r, rec, "needs_review", "variant file already exists", new)
        return self._finish(r, rec, "ok", None, new)

    def _finish(self, r: Request, rec: dict, status: str, reason: str | None, new: list[dict]) -> list[dict]:
        last = rec["attempts"][-1]
        rec |= {"status": status, "reason": reason, "time_end": now(),
                "cost_usd": last.get("cost_usd"), "usage": last.get("usage"),
                "provider_returned": last.get("provider_returned"), "finish_reason": last.get("finish_reason"),
                "native_finish_reason": last.get("native_finish_reason"), "generation_id": last.get("generation_id"),
                "extraction": last.get("extraction", {}), "code_sha256": (last.get("extraction") or {}).get("sha256"),
                "variant_file": last.get("variant_file")}
        rec["total_cost_usd"] = round(record_cost(rec), 8)  # after the status update, so no in-flight worst case
        atomic_replace(r.record_path, dump(rec))
        return new

    def run(self, requests: list[Request]) -> dict:
        todo = [r for r in requests if r.state == "pending"]
        for r in todo:
            self.log("planned", r, worst=round(r.worst_usd, 6))
        counts: dict[str, int] = {}
        with ThreadPoolExecutor(max_workers=max(1, self.jobs)) as pool:
            for status in pool.map(self.run_one, todo):
                counts[status] = counts.get(status, 0) + 1
        return counts


# ---------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m fdlab.generate",
                                 description="Generate variants through OpenRouter (plan by default; --send to pay).")
    ap.add_argument("config")
    ap.add_argument("--send", action="store_true", help="really send (needs OPENROUTER_API_KEY and --cap)")
    ap.add_argument("--cap", type=float, help="spending cap in US$ for this out_dir (<= config cap_usd)")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--retry", metavar="ID", help="re-send this one request id explicitly (new attempt)")
    ap.add_argument("--only", action="append", metavar="GLOB", help="restrict to request ids matching GLOB")
    ap.add_argument("--no-key-check", action="store_true", help="skip GET /key (only for the local fake server)")
    a = ap.parse_args(argv)
    cfg = json.loads(Path(a.config).read_text())
    try:
        plan = build_plan(cfg, a.only)
    except PlanError as e:
        print(f"ERROR {e}")
        return 2
    print_plan(plan, a.cap)
    if plan.errors:
        print(f"\n{len(plan.errors)} error(s): nothing is sent.")
        return 2
    if not a.send:
        print("\nplan only: nothing was sent (add --send --cap <US$> to run).")
        return 0
    if cfg.get("demo"):
        print("ERROR this is a demo config (\"demo\": true): its models are fictional and it is never sent")
        return 2
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        print("ERROR --send needs the environment variable OPENROUTER_API_KEY")
        return 2
    if a.cap is None or a.cap > float(cfg["cap_usd"]) or a.cap <= 0:
        print(f"ERROR --send needs an explicit --cap in (0, {cfg['cap_usd']}]")
        return 2
    runner = Runner(plan, a.cap, key, a.jobs)
    if not a.no_key_check:
        err = runner.key_check()
        if err:
            print(f"ERROR {err}")
            return 2
    print(f"manifest {write_manifest(plan, list(argv if argv is not None else sys.argv[1:]), a.config)}")
    if a.retry:
        r = next((x for x in plan.requests if x.id == a.retry), None)
        if r is None:
            print(f"ERROR --retry {a.retry}: not in the plan")
            return 2
        if not r.record_path.exists():
            print(f"ERROR --retry {a.retry}: no record yet (a normal run sends it)")
            return 2
        rec = json.loads(r.record_path.read_text())
        if rec.get("status") == "ok" and rec.get("variant_file"):
            print(f"ERROR --retry {a.retry}: status ok with a variant; it is never replaced")
            return 2
        if rec.get("status") == "in_flight":
            # its earlier attempt is already in the ledger at worst case (from the plan)
            print(f"note: {a.retry} was in flight (crash); the lost attempt stays in the ledger at worst case")
        status = runner.run_one(r, retry=True)
        print(f"retry {a.retry}: {status}" + (f" ({runner.stop_reason})" if runner.stop_reason else ""))
        print(f"ledger ${runner.ledger:.4f} of cap ${runner.cap:.4f}")
        return 0 if status != "stopped" else 1
    counts = runner.run(plan.requests)
    print(f"\nfinished: {counts}; ledger ${runner.ledger:.4f} of cap ${runner.cap:.4f}")
    if runner.stop_reason:
        print(f"stopped: {runner.stop_reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
