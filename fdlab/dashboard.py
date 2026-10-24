"""Read-only API over one run folder (generation records, raw answers, variants, test results, event log).

fdlab.generate writes the generation side and fdlab.evaluate writes <out_dir>/tests. This module only reads, so it
is safe while a run is in progress: a file that is half written counts as "in progress" until it parses.
Everything is cached by file mtime, so the dashboard follows a run live.
"""

from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from fdlab.generate import resolve, safe_id

router = APIRouter(prefix="/api/run")

CHANNEL = "OpenRouter API"
# One ladder, worst to best. A variant has exactly one outcome.
OUTCOMES = ["pending", "running", "api_error", "no_code", "testing", "compile_error", "partial", "all_pass"]
NOT_FAILED = {"pass", "skipped"}  # a skipped test is neither passed nor failed, so it is not a fault

_state: dict = {"config": None}
_cache: dict[str, tuple[float, object]] = {}


def configure(config_path: Path) -> None:
    """Point the API at a run config (called once by fdlab.serve)."""
    _state["config"] = config_path.resolve()


def _config() -> dict:
    if _state["config"] is None:
        raise HTTPException(500, "no run config: start the server with python -m fdlab.serve <config>")
    return _json(_state["config"]) or {"targets": [], "models": [], "settings": {}, "samples": 0, "out_dir": "runs/none"}


def _run() -> Path:
    return resolve(_config()["out_dir"])


def _cached(path: Path, load):
    """load(path), cached until the file changes. None if the file is missing or not yet complete."""
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    key = str(path)
    hit = _cache.get(key)
    if hit and hit[0] == mtime:
        return hit[1]
    try:
        value = load(path)
    except (OSError, ValueError, UnicodeDecodeError):
        return None  # being written right now
    _cache[key] = (mtime, value)
    return value


def _json(path: Path):
    return _cached(path, lambda p: json.loads(p.read_text()))


def _text(path: Path) -> str | None:
    return _cached(path, lambda p: p.read_text(errors="replace"))


def _csv(path: Path) -> list[dict] | None:
    return _cached(path, lambda p: list(csv.DictReader(io.StringIO(p.read_text(errors="replace")))))


def _jsonl(path: Path) -> list[dict]:
    def load(p: Path):
        out = []
        for line in p.read_text(errors="replace").splitlines():
            try:
                out.append(json.loads(line))
            except ValueError:
                continue  # the last line may be half written
        return out
    return _cached(path, load) or []


# ---- compile errors ---------------------------------------------------------------------------------------------

JAVAC = re.compile(r"^(?:\S*/)?([\w.$-]+\.java):(\d+): error: (.+)$")
SOLC = re.compile(r"^Error(?: \((\d+)\))?: (.+)$")
SOLC_AT = re.compile(r"-->\s*(?:\S*/)?([\w.$-]+\.sol):(\d+):\d+")

CATEGORIES = [  # (category, plain explanation, pattern on the message)
    ("Syntax error", "The code is not valid Java or Solidity, for example a missing brace.",
     re.compile(r"expected|illegal start|without 'try'|unclosed|reached end of file|not a statement|ParserError|"
                r"Expected", re.I)),
    ("Unknown name", "Uses a class, method, variable or package that does not exist.",
     re.compile(r"cannot find symbol|does not exist|Undeclared identifier|not found|not visible", re.I)),
    ("Ambiguous import", "Two imported types have the same name, so the compiler cannot tell which one is meant.",
     re.compile(r"is ambiguous", re.I)),
    ("Static or instance misuse", "Calls an instance method as if it were static, or the other way round.",
     re.compile(r"static context", re.I)),
    ("Duplicate definition", "The same method or variable is defined twice.",
     re.compile(r"already defined|already declared|DeclarationError: Identifier already", re.I)),
    ("Type mismatch", "A value has the wrong type for where it is used.",
     re.compile(r"incompatible types|cannot be converted|TypeError|bad operand|Invalid implicit conversion", re.I)),
    ("Wrong override", "A method claims to override something that does not exist, or misses a required method.",
     re.compile(r"does not override|is not abstract and does not override|should be marked as abstract", re.I)),
    ("Unhandled exception", "A checked exception is thrown but not caught or declared.",
     re.compile(r"unreported exception", re.I)),
]


def _category(message: str) -> str:
    for name, _, pat in CATEGORIES:
        if pat.search(message):
            return name
    return "Other"


def compile_errors(log: str | None) -> list[dict]:
    if not log:
        return []
    out: list[dict] = []
    lines = log.splitlines()
    for i, line in enumerate(lines):
        m = JAVAC.match(line.strip())
        if m:
            out.append({"file": m[1], "line": int(m[2]), "message": m[3], "category": _category(m[3])})
            continue
        m = SOLC.match(line.strip())
        if m:
            at = next((SOLC_AT.search(x) for x in lines[i + 1:i + 4] if SOLC_AT.search(x)), None)
            out.append({"file": at[1] if at else None, "line": int(at[2]) if at else None, "message": m[2],
                        "category": _category(m[2])})
    return out


def _normal(message: str) -> str:
    """The message without the specific names, so the same kind of mistake groups across variants."""
    return re.sub(r"\s+", " ", re.sub(r"'[^']*'|\"[^\"]*\"", "'…'", message)).strip()


# ---- plan and index ---------------------------------------------------------------------------------------------

def _label(m: dict) -> str:
    return m.get("label") or m["id"].split("/")[-1]


def _model_settings(cfg: dict, m: dict) -> list[str]:
    return [s for s in cfg.get("settings", {}) if s not in (m.get("skip_settings") or [])
            and (m.get("settings") or {}).get(s, 0) is not None]


def planned() -> list[dict]:
    """Every request the config plans, with the same ids as fdlab.generate.build_plan."""
    cfg = _config()
    out = []
    for m in cfg.get("models", []):
        for sname in _model_settings(cfg, m):
            for t in cfg.get("targets", []):
                for s in range(1, int(cfg.get("samples", 0)) + 1):
                    out.append({"id": f"{t['id']}/{_label(m)}/{sname}/s{s:02d}", "target": t["id"], "model": _label(m),
                                "model_id": m["id"], "provider": m.get("provider"), "setting": sname, "sample": s})
    return out


def family(model_id: str) -> str:
    """The model's vendor (the part of the OpenRouter id before the slash), used to colour and group models."""
    return model_id.split("/")[0].lower()


def _tests_dir(p: dict) -> Path:
    return _run() / "tests" / p["target"] / p["model"] / p["setting"] / f"s{p['sample']:02d}"


def _test_rows(d: Path) -> list[dict]:
    return [{"test": r.get("test"), "group": r.get("group"), "result": r.get("status"), "message": r.get("message", "")}
            for r in _csv(d / "results.csv") or []]


def _tested(v: dict, d: Path) -> dict:
    """The test part of a variant row, from its test folder."""
    summary = _json(d / "summary.json")
    if summary is None:
        v["outcome"] = "testing"
        return v
    v["compiled"] = summary.get("build") == "ok"
    v["main"] = summary.get("tests")
    if not v["compiled"]:
        errs = compile_errors(_text(d / "build.log"))
        v |= {"outcome": "compile_error", "compile_errors": len(errs),
              "error_categories": sorted({e["category"] for e in errs})}
        return v
    main = v["main"] or {}
    v["outcome"] = "all_pass" if main.get("total") and main.get("passed") == main.get("total") else "partial"
    v["failing"] = sorted(r["test"] for r in _test_rows(d) if r.get("result") not in NOT_FAILED)
    return v


def _empty_row(p: dict) -> dict:
    return {**p, "family": family(p["model_id"]), "channel": CHANNEL, "outcome": "pending", "status": None,
            "reason": None, "cost_usd": None, "total_cost_usd": None, "prompt_tokens": None, "completion_tokens": None,
            "reasoning_tokens": None, "seconds": None, "attempts": 0, "rate_limited": 0, "finish_reason": None,
            "provider_returned": None, "time_start": None, "time_end": None, "compiled": None, "main": None,
            "compile_errors": 0, "error_categories": [], "failing": []}


def variant(p: dict) -> dict:
    """The summary row of one planned request."""
    path = _run() / "requests" / f"{safe_id(p['id'])}.json"
    rec = _json(path)
    v = _empty_row(p)
    if path.exists() and rec is None:
        v["outcome"] = "running"
        return v
    if rec is None:
        return v
    usage = rec.get("usage") or {}
    attempts = rec.get("attempts") or []
    last = next((a for a in reversed(attempts) if a.get("sent")), attempts[-1] if attempts else {})
    v |= {"status": rec.get("status"), "reason": rec.get("reason"), "cost_usd": rec.get("cost_usd"),
          "total_cost_usd": rec.get("total_cost_usd"), "prompt_tokens": usage.get("prompt_tokens"),
          "completion_tokens": usage.get("completion_tokens"), "reasoning_tokens": usage.get("reasoning_tokens"),
          "seconds": last.get("seconds"), "attempts": len(attempts),
          "rate_limited": sum(a.get("status") == "rate_limited" for a in attempts),
          "finish_reason": rec.get("finish_reason"), "provider_returned": rec.get("provider_returned"),
          "time_start": rec.get("time_start"), "time_end": rec.get("time_end")}
    if not rec.get("time_end") or rec.get("status") == "in_flight":
        v["outcome"] = "running"
        return v
    if rec.get("status") != "ok":
        v["outcome"] = "no_code" if rec.get("status") in ("empty", "truncated") else "api_error"
        return v
    if (rec.get("extraction") or {}).get("outcome") != "ok":
        v["outcome"] = "no_code"
        return v
    return _tested(v, _tests_dir(p))


def index() -> list[dict]:
    return [variant(p) for p in planned()]


def _filter(rows: list[dict], target: str | None, model: str | None, setting: str | None, sample: int | None,
            outcome: str | None) -> list[dict]:
    def ok(r):
        return ((not target or r["target"] == target) and (not model or r["model"] == model)
                and (not setting or r["setting"] == setting) and (not sample or r["sample"] == sample)
                and (not outcome or r["outcome"] == outcome))
    return [r for r in rows if ok(r)]


def _events() -> list[dict]:
    return _jsonl(_run() / "events.jsonl")


def signatures(rows: list[dict]) -> dict[tuple, str]:
    """Identical sets of failing tests get one short name (F1, F2, ...), most common first."""
    counts: dict[tuple, int] = {}
    for r in rows:
        if r["outcome"] == "partial":
            key = tuple(r["failing"])
            counts[key] = counts.get(key, 0) + 1
    ordered = sorted(counts, key=lambda k: (-counts[k], len(k), k))
    return {k: f"F{i + 1}" for i, k in enumerate(ordered)}


def _cap_from_argv(argv: list[str]) -> float | None:
    try:
        return float(argv[argv.index("--cap") + 1])
    except (ValueError, IndexError):
        return None


# ---- endpoints --------------------------------------------------------------------------------------------------

@router.get("/overview")
def overview():
    rows = index()
    cfg = _config()
    events = _events()
    by_outcome = {o: sum(r["outcome"] == o for r in rows) for o in OUTCOMES}
    done = [r for r in rows if r["outcome"] not in ("pending", "running")]
    tested = [r for r in rows if r["compiled"] is not None]
    key_checks = [e for e in events if e.get("event") == "key_check"]
    in_flight = {e["id"] for e in events if e.get("event") == "start"} - {e["id"] for e in events if e.get("event") == "end"}
    manifests = sorted((_run() / "manifests").glob("*.json")) if (_run() / "manifests").exists() else []
    last_manifest = _json(manifests[-1]) if manifests else None

    def group(key):
        out = {}
        for r in rows:
            g = out.setdefault(r[key], {o: 0 for o in OUTCOMES} | {"total": 0, "cost_usd": 0.0})
            g[r["outcome"]] += 1
            g["total"] += 1
            g["cost_usd"] += r["cost_usd"] or 0
        return out

    progress = {}
    for r in rows:
        g = progress.setdefault(f"{r['target']}|s{r['sample']:02d}", {"target": r["target"], "sample": r["sample"],
                                                                      "channel": CHANNEL, "planned": 0, "done": 0})
        g["planned"] += 1
        g["done"] += r["outcome"] not in ("pending", "running")
    return {
        "title": cfg.get("title") or "Fault diversity run",
        "demo": bool(cfg.get("demo")),
        "targets": [{"id": t["id"], "name": t.get("name", t["id"]), "language": t.get("language"),
                     "platform": t.get("platform") or t.get("runner"), "prompt": t.get("prompt")}
                    for t in cfg.get("targets", [])],
        "models": [{"label": _label(m), "id": m["id"], "family": family(m["id"]), "provider": m.get("provider"),
                    "price_in": m.get("price_in"), "price_out": m.get("price_out"), "channel": CHANNEL,
                    "settings": _model_settings(cfg, m)} for m in cfg.get("models", [])],
        "settings": cfg.get("settings", {}),
        "channels": [CHANNEL],
        "samples": cfg.get("samples"),
        "max_tokens": cfg.get("max_tokens"),
        "planned": len(rows), "done": len(done), "by_outcome": by_outcome,
        "compiled": sum(bool(r["compiled"]) for r in tested), "tested": len(tested),
        "fault_signatures": len(signatures(rows)),
        "spent_usd": round(sum(r["cost_usd"] or 0 for r in rows), 4),  # billed, as OpenRouter reported it
        "ledger_usd": round(sum(r["total_cost_usd"] or 0 for r in rows), 4),  # the cap ledger: unknown costs at worst case
        "cap_usd": _cap_from_argv(last_manifest.get("argv") or []) if last_manifest else cfg.get("cap_usd"),
        "credit": key_checks[-1] if key_checks else None,
        "in_flight": sorted(in_flight),
        "last_event": events[-1] if events else None,
        # the generator's last run ended at its spending cap: a stop_cap event after the run's credit check
        "stopped_cap": next((e["time"] for e in reversed(events) if e.get("event") == "stop_cap"), "")
                       > next((e["time"] for e in reversed(events) if e.get("event") == "key_check"), ""),
        "last_command": (last_manifest or {}).get("argv"),
        "manifests": len(manifests),
        "by_model": group("model"), "by_setting": group("setting"), "progress": list(progress.values()),
    }


@router.get("/variants")
def variants(target: str | None = None, model: str | None = None, setting: str | None = None,
             sample: int | None = None, outcome: str | None = None):
    rows = index()
    sigs = signatures(rows)
    out = _filter(rows, target, model, setting, sample, outcome)
    for r in out:
        r["signature"] = sigs.get(tuple(r["failing"])) if r["outcome"] == "partial" else None
    return out


@router.get("/variant")
def variant_detail(id: str = Query(...)):
    """Everything logged for one variant. The id contains slashes, so it is a query parameter."""
    p = next((p for p in planned() if p["id"] == id), None)
    if p is None:
        raise HTTPException(404, "variant not found")
    run = _run()
    rows = index()
    sigs = signatures(rows)
    v = next(r for r in rows if r["id"] == id)
    rec = _json(run / "requests" / f"{safe_id(id)}.json") or {}
    body = rec.get("request_body") or {}
    attempts = []
    answer = reasoning = None
    for a in rec.get("attempts") or []:
        raw = _json(run / a["raw_file"]) if a.get("raw_file") else None
        error = None
        if isinstance(raw, dict) and isinstance(raw.get("error"), dict):
            error = (raw["error"].get("metadata") or {}).get("raw") or raw["error"].get("message")
        attempts.append({k: a.get(k) for k in ("k", "time_sent", "sent", "seconds", "http_status", "status",
                                                "cost_usd", "usage", "provider_returned", "finish_reason",
                                                "generation_id", "raw_file", "raw_bytes")} | {"error": error})
        if isinstance(raw, dict) and raw.get("choices"):
            msg = raw["choices"][0].get("message") or {}
            answer, reasoning = msg.get("content"), msg.get("reasoning")
    d = _tests_dir(p)
    return {
        "variant": v | {"signature": sigs.get(tuple(v["failing"])) if v["outcome"] == "partial" else None},
        "record": {k: val for k, val in rec.items() if k not in ("request_body", "attempts")},
        "params": {k: val for k, val in body.items() if k != "messages"},
        "messages": body.get("messages") or [],
        "attempts": attempts,
        "answer": answer, "reasoning": reasoning,
        "code": _text(run / rec["variant_file"]) if rec.get("variant_file") else None,
        "code_file": rec.get("output_file"),
        "build_log": _text(d / "build.log"),
        "compile_errors": compile_errors(_text(d / "build.log")),
        "tests": _test_rows(d),
        "events": [e for e in _events() if e.get("id") == id],
    }


@router.get("/raw")
def raw_file(path: str = Query(...)):
    """One raw answer file as it was received, for download."""
    run = _run()
    f = (run / path).resolve()
    if not f.is_relative_to((run / "raw").resolve()) or not f.is_file():
        raise HTTPException(404, "not found")
    return Response(f.read_bytes(), media_type="application/json",
                    headers={"Content-Disposition": f"attachment; filename={f.name}"})


@router.get("/failures")
def failures(target: str | None = None, model: str | None = None, setting: str | None = None):
    all_rows = index()
    rows = _filter(all_rows, target, model, setting, None, None)
    cats: dict[str, dict] = {}
    for r in rows:
        if r["outcome"] != "compile_error":
            continue
        for e in compile_errors(_text(_tests_dir(r) / "build.log")):
            c = cats.setdefault(e["category"], {"category": e["category"], "errors": 0, "variants": {}, "messages": {}})
            c["errors"] += 1
            c["variants"][r["id"]] = c["variants"].get(r["id"], 0) + 1
            n = _normal(e["message"])
            c["messages"][n] = c["messages"].get(n, 0) + 1
    explain = {name: text for name, text, _ in CATEGORIES} | {"Other": "Any other compiler error."}
    compile_out = sorted(({"category": c["category"], "explanation": explain[c["category"]], "errors": c["errors"],
                           "variants": [{"id": k, "errors": n} for k, n in sorted(c["variants"].items())],
                           "messages": sorted(({"message": m, "count": n} for m, n in c["messages"].items()),
                                              key=lambda x: -x["count"])[:12]}
                          for c in cats.values()), key=lambda c: -len(c["variants"]))
    tested = [r for r in rows if r["compiled"]]
    meta: dict[str, dict] = {}
    fails: dict[str, list[str]] = {}
    for r in tested:
        for t in _test_rows(_tests_dir(r)):
            m = meta.setdefault(t["test"], {"test": t["test"], "group": t.get("group"), "messages": {}})
            if t.get("result") not in NOT_FAILED:
                fails.setdefault(t["test"], []).append(r["id"])
                msg = (t.get("message") or "").strip()[:200]
                m["messages"][msg] = m["messages"].get(msg, 0) + 1
    failing_tests = sorted(({**meta[t], "variants": ids,
                             "messages": sorted(({"message": k, "count": n} for k, n in meta[t]["messages"].items()),
                                                key=lambda x: -x["count"])[:3]}
                            for t, ids in fails.items()), key=lambda x: (-len(x["variants"]), x["test"]))
    sigs = signatures(all_rows)
    sig_rows: dict[str, dict] = {}
    for r in tested:
        if r["outcome"] == "partial":
            name = sigs[tuple(r["failing"])]
            sig_rows.setdefault(name, {"id": name, "tests": r["failing"], "variants": []})["variants"].append(r["id"])
    # pairwise overlap of the failing-test sets of the variants that compile and fail at least one test (same target)
    with_fail = [r for r in tested if r["outcome"] == "partial"]
    pairs = []
    for i, a in enumerate(with_fail):
        for b in with_fail[i + 1:]:
            if a["target"] != b["target"]:
                continue
            sa, sb = set(a["failing"]), set(b["failing"])
            pairs.append({"a": a["id"], "b": b["id"], "both": len(sa & sb), "union": len(sa | sb),
                          "jaccard": round(len(sa & sb) / len(sa | sb), 3) if sa | sb else None})
    return {
        "variants": len(rows), "tested": len(tested), "compiled_fail": sum(r["outcome"] == "compile_error" for r in rows),
        "with_failures": len(with_fail),
        "compile": compile_out,
        "failing_tests": failing_tests,
        "signatures": sorted(sig_rows.values(), key=lambda s: int(s["id"][1:])),
        "variant_failing": {r["id"]: r["failing"] for r in with_fail},
        "pairs": pairs,
        "tests_total": len(meta),
    }


@router.get("/events")
def events(kind: str | None = None, limit: int = 2000):
    ev = _events()
    shown = [e for e in ev if e.get("event") == kind] if kind else ev
    return {"total": len(ev), "kinds": sorted({e.get("event") for e in ev}), "events": shown[-limit:][::-1]}


@router.get("/prompt")
def prompt(target: str):
    t = next((t for t in _config().get("targets", []) if t["id"] == target), None)
    if not t:
        raise HTTPException(404, "target not found")
    return {"target": target, "file": t["prompt"], "text": _text(resolve(t["prompt"]))}


@router.get("/export/variants.csv")
def export_variants():
    cols = ["id", "target", "model", "model_id", "setting", "sample", "outcome", "status", "finish_reason",
            "compiled", "passed", "total", "failing", "cost_usd", "prompt_tokens", "completion_tokens",
            "reasoning_tokens", "seconds"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for r in index():
        main = r["main"] or {}
        w.writerow([r["id"], r["target"], r["model"], r["model_id"], r["setting"], r["sample"], r["outcome"],
                    r["status"], r["finish_reason"], r["compiled"], main.get("passed"), main.get("total"),
                    " ".join(r["failing"]), r["cost_usd"], r["prompt_tokens"], r["completion_tokens"],
                    r["reasoning_tokens"], r["seconds"]])
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=variants-{stamp}.csv"})
