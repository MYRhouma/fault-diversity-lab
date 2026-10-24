"""Offline demo: a complete run folder for config/demo.json without any API call.

Usage
-----
  python -m fdlab.demo              # writes runs/demo (replacing an earlier demo), tests every variant with Foundry
  python -m fdlab.demo --jobs 4     # test 4 variants in parallel
  python -m fdlab.serve config/demo.json

The four models of the demo config are fictional. Each of their variants is the Tip Jar reference implementation
with faults injected by hand (FAULTS below), chosen so the demo shows every outcome: variants that pass, variants
that fail a few tests, faults that several models share, compile errors, a truncated answer and an API error.
The generation records follow the generator's format exactly, so every page of the dashboard works on them, and
each one carries "demo": true. The tests are real: fdlab.evaluate compiles and runs every variant.
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fdlab import evaluate
from fdlab.generate import ROOT, atomic_create, build_plan, dump, record_cost, safe_id, sha256

CONFIG = ROOT / "config" / "demo.json"
REFERENCE = ROOT / "specs" / "tip-jar" / "reference" / "TipJar.sol"

# name -> (what the fault does, text in the reference, replacement)
FAULTS = {
    "min_exclusive": ("rejects a tip of exactly MIN_TIP",
                      "msg.value < MIN_TIP", "msg.value <= MIN_TIP"),
    "note_limit": ("rejects a note of exactly MAX_NOTE_BYTES",
                   "bytes(note).length > MAX_NOTE_BYTES", "bytes(note).length >= MAX_NOTE_BYTES"),
    "no_pause_check": ("accepts tips while paused",
                       "        if (paused) revert JarPaused();\n", ""),
    "no_count": ("never increments tipCount",
                 "        tipCount += 1;\n", ""),
    "event_note": ("emits Tipped without the note",
                   "emit Tipped(msg.sender, msg.value, note);", 'emit Tipped(msg.sender, msg.value, "");'),
    "withdraw_total": ("lowers totalTips on withdraw",
                       "        emit Withdrawn(owner, amount);\n",
                       "        totalTips -= amount;\n        emit Withdrawn(owner, amount);\n"),
    "withdraw_anyone": ("lets anyone withdraw",
                        "function withdraw(uint256 amount) external onlyOwner {", "function withdraw(uint256 amount) external {"),
    "balance_args": ("reports the wrong numbers in InsufficientBalance",
                     "revert InsufficientBalance(amount, address(this).balance);", "revert InsufficientBalance(amount, amount);"),
    "zero_owner": ("allows the zero address as owner",
                   "        if (newOwner == address(0)) revert ZeroAddress();\n", ""),
    "no_import": ("does not import the interface (compile error)",
                  'import {ITipJar} from "./ITipJar.sol";\n', ""),
    "owner_type": ("assigns msg.value to the owner (compile error)",
                   "owner = msg.sender;", "owner = msg.value;"),
}
# (model label, setting) -> one entry per sample: a list of faults, "truncated" or "api_error"
PLAN = {
    ("alpha-coder", "OFF-T0.2"): [["min_exclusive"], ["min_exclusive", "no_count"], ["min_exclusive"]],
    ("alpha-coder", "ON-HIGH"): [[], ["min_exclusive"], []],
    ("beta-instruct", "OFF-T0.2"): [["no_pause_check"], ["no_import"], ["no_pause_check", "event_note"]],
    ("beta-instruct", "ON-HIGH"): [["no_pause_check"], [], ["balance_args"]],
    ("gamma-reasoner", "OFF-T0.2"): [[], ["zero_owner"], "truncated"],
    ("gamma-reasoner", "ON-HIGH"): [[], [], ["zero_owner"]],
    ("delta-mini", "OFF-T0.2"): [["min_exclusive", "withdraw_anyone"], ["owner_type"], ["min_exclusive", "note_limit"]],
    ("delta-mini", "ON-HIGH"): [["note_limit"], "api_error", ["withdraw_total"]],
}


def mutate(source: str, faults: list[str]) -> str:
    for name in faults:
        _, old, new = FAULTS[name]
        if source.count(old) != 1:
            raise ValueError(f"fault {name}: its text must occur once in the reference")
        source = source.replace(old, new)
    return source


def build(jobs: int) -> Path:
    cfg = json.loads(CONFIG.read_text())
    out = (ROOT / cfg["out_dir"]).resolve()
    if out.exists():
        shutil.rmtree(out)
    plan = build_plan(cfg)
    if plan.errors:
        raise SystemExit("demo config has errors: " + "; ".join(plan.errors))
    reference = REFERENCE.read_text()
    rng = random.Random(7)
    clock = datetime(2026, 1, 15, 9, 0, tzinfo=UTC)
    events = []

    def at(t: datetime) -> str:
        return t.isoformat(timespec="milliseconds")

    for r in plan.requests:
        outcome = PLAN[(r.label, r.setting)][r.sample - 1]
        model = next(m for m in cfg["models"] if m["id"] == r.model)
        reasoning_on = r.body.get("reasoning", {}).get("enabled", False)
        code = mutate(reference, outcome) if isinstance(outcome, list) else None
        prompt_tokens = 1180 + rng.randint(0, 40)
        reasoning_tokens = rng.randint(1500, 9000) if reasoning_on else 0
        completion = (len(code) // 3 if code else r.max_tokens if outcome == "truncated" else 0) + reasoning_tokens
        seconds = round(completion / rng.uniform(60, 140), 2) if completion else 4.1
        cost = round((prompt_tokens * model["price_in"] + completion * model["price_out"]) / 1e6, 8)
        start, end = clock, clock + timedelta(seconds=seconds)
        clock = end + timedelta(seconds=rng.randint(2, 20))
        raw_name = f"raw/{safe_id(r.id)}.attempt1.json"
        common = {"id": f"gen-demo-{sha256(r.id)[:16]}", "provider": r.provider, "model": r.model}
        usage = {"prompt_tokens": prompt_tokens, "completion_tokens": completion, "cost": cost,
                 "completion_tokens_details": {"reasoning_tokens": reasoning_tokens}}
        if outcome == "api_error":
            reason = "error inside HTTP 200: upstream provider error"
            status, finish, cost, usage = "needs_review", None, None, None
            raw = {**common, "choices": [{"finish_reason": "error", "error": {"code": 502, "message": "upstream provider error"},
                                          "message": {"role": "assistant", "content": ""}}]}
        else:
            finish = "length" if outcome == "truncated" else "stop"
            content = ("```solidity\n" + reference[: len(reference) // 2]) if outcome == "truncated" \
                else f"```solidity\n{code}```\n"
            message = {"role": "assistant", "content": content}
            if reasoning_on:
                message["reasoning"] = "(demo record: the reasoning text of a real run is shown here)"
            raw = {**common, "choices": [{"finish_reason": finish, "native_finish_reason": finish, "message": message}],
                   "usage": usage}
            status = "truncated" if outcome == "truncated" else "ok"
            reason = "finish_reason 'length'" if outcome == "truncated" else None
        raw_bytes = json.dumps(raw, indent=1).encode()
        atomic_create(out / raw_name, raw_bytes)
        tokens = {"prompt_tokens": prompt_tokens, "completion_tokens": completion,
                  "reasoning_tokens": reasoning_tokens} if usage else None
        extraction = {"outcome": "ok", "sha256": sha256(code)} if code else {"outcome": "unterminated_fence"} \
            if outcome == "truncated" else {}
        attempt = {"k": 1, "time_sent": at(start), "sent": True, "seconds": seconds, "http_status": 200,
                   "raw_file": raw_name, "raw_sha256": sha256(raw_bytes), "raw_bytes": len(raw_bytes),
                   "status": status, "cost_usd": cost, "usage": tokens, "generation_id": common["id"],
                   "provider_returned": r.provider, "model_returned": r.model, "finish_reason": finish,
                   "native_finish_reason": finish, "extraction": extraction}
        rec = {"id": r.id, "demo": True, "target": r.target, "model": r.model, "label": r.label,
               "pinned_provider": r.provider, "setting": r.setting, "sample": r.sample,
               "prompt_file": r.prompt_file, "prompt_sha256": r.prompt_sha256, "output_file": r.output_file,
               "max_tokens": r.max_tokens, "worst_case_usd": round(r.worst_usd, 6), "request_body": r.body,
               "attempts": [attempt], "status": status, "time_start": at(start), "reason": reason, "time_end": at(end),
               "cost_usd": cost, "usage": tokens, "provider_returned": r.provider, "finish_reason": finish,
               "native_finish_reason": finish, "generation_id": common["id"], "extraction": extraction,
               "code_sha256": extraction.get("sha256"), "variant_file": None,
               "injected_faults": outcome if isinstance(outcome, list) else []}
        if code:
            atomic_create(r.variant_path, code.encode())
            rec["variant_file"] = attempt["variant_file"] = str(r.variant_path.relative_to(out))
        rec["total_cost_usd"] = round(record_cost(rec), 8)
        atomic_create(r.record_path, dump(rec))
        base = {"id": r.id, "model": r.model, "provider": r.provider, "setting": r.setting}
        events += [{"time": at(start), "event": "start", **base, "worst": round(r.worst_usd, 6), "retry": False},
                   {"time": at(start), "event": "attempt_sent", **base, "attempt": 1},
                   {"time": at(end), "event": "raw_saved", **base, "attempt": 1, "http_status": 200, "bytes": len(raw_bytes)},
                   {"time": at(end), "event": "end", **base, "status": status, "cost": cost, "tokens": tokens,
                    "finish_reason": finish, "provider_returned": r.provider,
                    "extraction": extraction.get("outcome"), "record_cost": rec["total_cost_usd"]}]
    events.sort(key=lambda e: e["time"])
    (out / "events.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events))
    print(f"{len(plan.requests)} demo records written to {out}")

    todo = evaluate.pending(cfg, None, force=True)
    timeout = float(cfg.get("test_timeout_s", 600))

    def one(item):
        target, vid, file, tests = item
        s = evaluate.run_one(target, file, tests, timeout)
        print(f"  {vid}: " + ("timeout" if s is None else s["build"] if s["build"] != "ok"
                              else f"{s['tests']['passed']}/{s['tests']['total']} passed"), flush=True)
        return s

    with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
        results = list(pool.map(one, todo))
    if any(s is None for s in results):
        raise SystemExit("some demo tests timed out; run python -m fdlab.demo again")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m fdlab.demo", description="Build the offline demo run (runs/demo).")
    ap.add_argument("--jobs", type=int, default=2, help="variants tested in parallel (default 2)")
    a = ap.parse_args(argv)
    if not shutil.which(evaluate.forge_bin()) and not Path(evaluate.forge_bin()).exists():
        print("ERROR Foundry's forge was not found (install: https://getfoundry.sh, or set FORGE=/path/to/forge)")
        return 2
    try:
        out = build(a.jobs)
    except evaluate.ToolError as e:
        print(f"ERROR {e}")
        return 2
    print(f"done. Open the dashboard: python -m fdlab.serve config/demo.json   ({out.relative_to(ROOT)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
