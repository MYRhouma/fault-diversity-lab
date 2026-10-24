"""Dashboard API on a tiny hand-made run folder: one variant per outcome."""

from __future__ import annotations

import csv
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from fdlab import dashboard
from fdlab.generate import safe_id


def record(rid: str, status: str = "ok", extraction: str = "ok", cost: float = 0.01) -> dict:
    return {"id": rid, "status": status, "reason": None, "cost_usd": cost, "total_cost_usd": cost,
            "time_start": "2026-01-01T10:00:00+00:00", "time_end": "2026-01-01T10:01:00+00:00",
            "finish_reason": "stop", "provider_returned": "Prov A", "extraction": {"outcome": extraction},
            "usage": {"prompt_tokens": 50, "completion_tokens": 20, "reasoning_tokens": 0},
            "variant_file": f"variants/{rid}/Counter.sol" if extraction == "ok" else None,
            "request_body": {"model": "lab-a/model-one", "messages": [{"role": "user", "content": "hi"}], "temperature": 0.2},
            "attempts": [{"k": 1, "sent": True, "status": status, "seconds": 3.0,
                          "raw_file": f"raw/{safe_id(rid)}.attempt1.json"}]}


def write_tests(run, rid: str, build: str, results: list[tuple[str, str]]):
    d = run / "tests" / rid
    d.mkdir(parents=True)
    passed = sum(s == "pass" for _, s in results)
    total = sum(s != "skipped" for _, s in results)  # as fdlab.evaluate counts: a skipped test is not counted
    (d / "summary.json").write_text(json.dumps({"build": build, "tests": {"passed": passed, "total": total}
                                                if build == "ok" else None}))
    (d / "build.log").write_text("" if build == "ok" else "Error (2314): Expected ';' but got '}'\n --> src/Counter.sol:4:5:\n")
    with open(d / "results.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["test", "group", "status", "message"])
        w.writerows((t, "CounterTest", s, "boom" if s == "fail" else "") for t, s in results)


@pytest.fixture
def client(tmp_path):
    run = tmp_path / "run"
    (run / "requests").mkdir(parents=True)
    (run / "raw").mkdir()
    prompt = tmp_path / "prompt.md"
    prompt.write_text("=== SYSTEM ===\ns\n=== USER ===\nu\nOutput file: Counter.sol\n")
    cfg = {"title": "tiny", "targets": [{"id": "t", "name": "Target T", "prompt": str(prompt), "runner": "forge"}],
           "settings": {"S": {"temperature": 0.2}},
           "models": [{"id": "lab-a/model-one", "provider": "Prov A", "price_in": 1, "price_out": 2},
                      {"id": "lab-b/model-two", "provider": "Prov B", "price_in": 1, "price_out": 2}],
           "samples": 4, "max_tokens": 100, "cap_usd": 1, "out_dir": str(run)}
    (tmp_path / "config.json").write_text(json.dumps(cfg))
    # model-one: all pass, partial (fails a), compile error, no code; model-two: partial (fails a), partial (a, b),
    # request failed, s04 not sent yet
    rows = {"t/model-one/S/s01": ("ok", "ok"), "t/model-one/S/s02": ("ok", "ok"), "t/model-one/S/s03": ("ok", "ok"),
            "t/model-one/S/s04": ("ok", "no_code"), "t/model-two/S/s01": ("ok", "ok"), "t/model-two/S/s02": ("ok", "ok"),
            "t/model-two/S/s03": ("needs_review", "none")}
    for rid, (status, ex) in rows.items():
        (run / "requests" / f"{safe_id(rid)}.json").write_text(json.dumps(record(rid, status, ex)))
    (run / "raw" / f"{safe_id('t/model-one/S/s01')}.attempt1.json").write_text(
        json.dumps({"choices": [{"message": {"content": "```\ncontract C {}\n```", "reasoning": "thought"}}]}))
    (run / "variants" / "t/model-one/S/s01").mkdir(parents=True)
    (run / "variants" / "t/model-one/S/s01" / "Counter.sol").write_text("contract C {}\n")
    write_tests(run, "t/model-one/S/s01", "ok", [("a", "pass"), ("b", "pass"), ("c", "skipped")])
    write_tests(run, "t/model-one/S/s02", "ok", [("a", "fail"), ("b", "pass")])
    write_tests(run, "t/model-one/S/s03", "failed", [])
    write_tests(run, "t/model-two/S/s01", "ok", [("a", "fail"), ("b", "pass")])
    write_tests(run, "t/model-two/S/s02", "ok", [("a", "fail"), ("b", "fail")])
    (run / "events.jsonl").write_text("\n".join(json.dumps(e) for e in [
        {"time": "2026-01-01T09:59:00+00:00", "event": "key_check", "limit": 5, "limit_remaining": 4, "usage": 1},
        {"time": "2026-01-01T10:00:00+00:00", "event": "start", "id": "t/model-one/S/s01"},
        {"time": "2026-01-01T10:01:00+00:00", "event": "end", "id": "t/model-one/S/s01"}]) + "\n{\"half")
    dashboard.configure(tmp_path / "config.json")
    dashboard._cache.clear()
    app = FastAPI()
    app.include_router(dashboard.router)
    return TestClient(app)


def test_outcome_ladder(client):
    out = {v["id"].split("/", 1)[1]: v["outcome"] for v in client.get("/api/run/variants").json()}
    assert out == {"model-one/S/s01": "all_pass", "model-one/S/s02": "partial", "model-one/S/s03": "compile_error",
                   "model-one/S/s04": "no_code", "model-two/S/s01": "partial", "model-two/S/s02": "partial",
                   "model-two/S/s03": "api_error", "model-two/S/s04": "pending"}


def test_overview(client):
    o = client.get("/api/run/overview").json()
    assert o["title"] == "tiny" and o["planned"] == 8 and o["done"] == 7 and o["tested"] == 5 and o["compiled"] == 4
    assert o["by_outcome"]["partial"] == 3 and o["fault_signatures"] == 2
    assert o["models"][0]["family"] == "lab-a" and o["credit"]["limit_remaining"] == 4 and o["in_flight"] == []
    assert o["spent_usd"] == pytest.approx(0.07)


def test_signatures_and_filters(client):
    rows = client.get("/api/run/variants", params={"outcome": "partial"}).json()
    assert {r["id"]: r["signature"] for r in rows} == {"t/model-one/S/s02": "F1", "t/model-two/S/s01": "F1",
                                                      "t/model-two/S/s02": "F2"}
    assert len(client.get("/api/run/variants", params={"model": "model-two", "sample": 1}).json()) == 1


def test_variant_detail(client):
    d = client.get("/api/run/variant", params={"id": "t/model-one/S/s01"}).json()
    assert d["code"] == "contract C {}\n" and d["reasoning"] == "thought" and d["params"] == {"model": "lab-a/model-one",
                                                                                            "temperature": 0.2}
    assert [t["result"] for t in d["tests"]] == ["pass", "pass", "skipped"] and len(d["events"]) == 2
    assert client.get("/api/run/variant", params={"id": "t/nope/S/s01"}).status_code == 404


def test_failures(client):
    f = client.get("/api/run/failures").json()
    assert f["compile"][0]["category"] == "Syntax error" and f["compile"][0]["errors"] == 1
    assert [(t["test"], len(t["variants"])) for t in f["failing_tests"]] == [("a", 3), ("b", 1)]
    assert f["with_failures"] == 3 and len(f["pairs"]) == 3
    pair = next(p for p in f["pairs"] if p["a"] == "t/model-one/S/s02" and p["b"] == "t/model-two/S/s02")
    assert pair == {"a": "t/model-one/S/s02", "b": "t/model-two/S/s02", "both": 1, "union": 2, "jaccard": 0.5}


def test_raw_prompt_events_export(client):
    assert client.get("/api/run/raw", params={"path": "raw/t__model-one__S__s01.attempt1.json"}).status_code == 200
    assert client.get("/api/run/raw", params={"path": "../config.json"}).status_code == 404
    assert client.get("/api/run/prompt", params={"target": "t"}).json()["text"].startswith("=== SYSTEM ===")
    ev = client.get("/api/run/events").json()
    assert ev["total"] == 3 and ev["events"][0]["event"] == "end"  # newest first; the half-written line is skipped
    csv_text = client.get("/api/run/export/variants.csv").text
    assert csv_text.splitlines()[0].startswith("id,target,model") and len(csv_text.splitlines()) == 9


def test_compile_error_parsing():
    log = "src/main/java/demo/A.java:12: error: cannot find symbol\nError: Undeclared identifier.\n --> src/X.sol:7:3:\n"
    assert dashboard.compile_errors(log) == [
        {"file": "A.java", "line": 12, "message": "cannot find symbol", "category": "Unknown name"},
        {"file": "X.sol", "line": 7, "message": "Undeclared identifier.", "category": "Unknown name"}]
