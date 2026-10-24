"""Test runner: result parsing for both runners, with fake `forge` and `gradlew` programs (no compiler is needed)."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import pytest

from fdlab.evaluate import ToolError, pending, run_one

FORGE_JSON = {
    "test/Counter.t.sol:CounterTest": {"test_results": {
        "test_increment()": {"status": "Success", "reason": None},
        "test_reset()": {"status": "Failure", "reason": "assertion failed: 1 != 0"},
        "test_later()": {"status": "Skipped", "reason": None}}},
    "test/Counter.t.sol:OwnerTest": {"test_results": {
        "test_onlyOwner()": {"status": "Failure", "reason": "call did not revert"}}},
}

JUNIT_XML = """<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="demo.CounterTests" tests="3" failures="1" errors="0" skipped="1">
  <testcase name="increments()" classname="demo.CounterTests" time="0.01"/>
  <testcase name="rejects &lt;0&gt;()" classname="demo.CounterTests" time="0.01">
    <failure message="expected: &lt;1&gt; but was: &lt;0&gt;" type="org.opentest4j.AssertionFailedError">trace</failure>
  </testcase>
  <testcase name="later()" classname="demo.CounterTests" time="0"><skipped/></testcase>
</testsuite>
"""


def script(path: Path, body: str) -> Path:
    path.write_text(f"#!{sys.executable}\n{body}")
    path.chmod(0o755)
    return path


@pytest.fixture
def fake_forge(tmp_path, monkeypatch):
    """A `forge` that builds unless the variant contains BROKEN, and prints FORGE_JSON for `forge test --json`."""
    forge = script(tmp_path / "forge", f"""
import json, pathlib, sys
if sys.argv[1] == "build":
    broken = "BROKEN" in pathlib.Path("src/Counter.sol").read_text()
    print("Error (2314): Expected ';' but got '}}'\\n --> src/Counter.sol:3:1:" if broken else "Compiler run successful")
    sys.exit(1 if broken else 0)
print(json.dumps({FORGE_JSON!r}))
""")
    monkeypatch.setenv("FORGE", str(forge))
    harness = tmp_path / "harness"
    (harness / "src").mkdir(parents=True)
    (harness / "out").mkdir()  # build output of an earlier run: never copied
    return {"id": "counter", "runner": "forge", "harness": str(harness), "slot": "src/Counter.sol"}


def read_rows(out: Path):
    return list(csv.DictReader(open(out / "results.csv")))


def test_forge_results(fake_forge, tmp_path):
    variant = tmp_path / "Counter.sol"
    variant.write_text("contract Counter {}\n")
    out = tmp_path / "result"
    summary = run_one(fake_forge, variant, out, timeout=60)
    assert summary["build"] == "ok" and summary["runner"] == "forge"
    assert summary["tests"] == {"passed": 1, "total": 3} and summary["skipped"] == 1
    assert summary["groups"] == {"CounterTest": {"passed": 1, "total": 2}, "OwnerTest": {"passed": 0, "total": 1}}
    rows = {r["test"]: r for r in read_rows(out)}
    assert rows["test_reset"]["status"] == "fail" and rows["test_reset"]["message"] == "assertion failed: 1 != 0"
    assert rows["test_later"]["status"] == "skipped" and rows["test_increment"]["group"] == "CounterTest"
    assert (out / "variant.sha256").read_text().strip() == __import__("hashlib").sha256(variant.read_bytes()).hexdigest()
    assert json.loads((out / "summary.json").read_text()) == summary
    assert not (Path(fake_forge["harness"]) / "src" / "Counter.sol").exists()  # the harness itself is never changed


def test_forge_compile_error(fake_forge, tmp_path):
    variant = tmp_path / "Counter.sol"
    variant.write_text("BROKEN\n")
    out = tmp_path / "result"
    summary = run_one(fake_forge, variant, out, timeout=60)
    assert summary["build"] == "failed" and summary["tests"] is None
    assert "Expected ';'" in (out / "build.log").read_text()
    assert read_rows(out) == []


def test_gradle_results(tmp_path):
    harness = tmp_path / "harness"
    harness.mkdir()
    gradlew = script(harness / "gradlew", f"""
import pathlib
d = pathlib.Path("build/test-results/test")
d.mkdir(parents=True)
(d / "TEST-demo.CounterTests.xml").write_text({JUNIT_XML!r})
print("BUILD FAILED: 1 test failed")
""")
    gradlew.chmod(0o644)  # the runner makes it executable in its copy
    target = {"id": "counter-java", "runner": "gradle", "harness": str(harness), "slot": "src/main/java/demo/Counter.java"}
    variant = tmp_path / "Counter.java"
    variant.write_text("package demo; public class Counter {}\n")
    out = tmp_path / "result"
    summary = run_one(target, variant, out, timeout=60)
    assert summary["build"] == "ok" and summary["tests"] == {"passed": 1, "total": 2} and summary["skipped"] == 1
    rows = {r["test"]: r for r in read_rows(out)}
    assert rows["rejects <0>"] == {"test": "rejects <0>", "group": "CounterTests", "status": "fail",
                                   "message": "expected: <1> but was: <0>"}
    assert (out / "junit" / "TEST-demo.CounterTests.xml").exists()


def test_gradle_without_reports_did_not_compile(tmp_path):
    harness = tmp_path / "harness"
    harness.mkdir()
    script(harness / "gradlew", "import sys\nprint('Counter.java:1: error: cannot find symbol')\nsys.exit(1)\n")
    target = {"id": "j", "runner": "gradle", "harness": str(harness), "slot": "src/main/java/Counter.java"}
    variant = tmp_path / "Counter.java"
    variant.write_text("class Counter { x }\n")
    summary = run_one(target, variant, tmp_path / "result", timeout=60)
    assert summary["build"] == "failed" and summary["tests"] is None


def test_unknown_runner(tmp_path):
    with pytest.raises(ValueError, match="runner must be one of"):
        run_one({"id": "x", "runner": "make", "harness": str(tmp_path)}, tmp_path / "x", tmp_path / "out", 1)


def test_pending_lists_only_untested_ok_variants(tmp_path):
    run = tmp_path / "run"
    (run / "requests").mkdir(parents=True)
    for rid, status in [("t/m/S/s01", "ok"), ("t/m/S/s02", "ok"), ("t/m/S/s03", "truncated")]:
        rec = {"id": rid, "target": "t", "status": status, "variant_file": f"variants/{rid}/A.sol" if status == "ok" else None}
        (run / "requests" / (rid.replace("/", "__") + ".json")).write_text(json.dumps(rec))
    (run / "tests" / "t/m/S/s01").mkdir(parents=True)
    (run / "tests" / "t/m/S/s01" / "summary.json").write_text("{}")
    (run / "requests" / "half.json").write_text('{"id": ')  # being written right now
    cfg = {"out_dir": str(run), "targets": [{"id": "t"}]}
    assert [vid for _, vid, _, _ in pending(cfg, None, False)] == ["t/m/S/s02"]
    assert [vid for _, vid, _, _ in pending(cfg, None, True)] == ["t/m/S/s01", "t/m/S/s02"]
    assert pending(cfg, ["t/x/*"], True) == []


def test_missing_solc_is_installed_once_online(tmp_path, monkeypatch):
    """forge build --offline fails without the pinned solc; the runner then builds once without --offline."""
    calls = tmp_path / "calls.txt"
    forge = script(tmp_path / "forge", f"""
import json, sys
open({str(calls)!r}, "a").write(" ".join(sys.argv[1:]) + "\\n")
if sys.argv[1:] == ["build", "--offline"]:
    print("Error: can't install missing solc 0.8.30 in offline mode")
    sys.exit(1)
if sys.argv[1] == "test":
    print(json.dumps({{"t:T": {{"test_results": {{"test_a()": {{"status": "Success"}}}}}}}}))
""")
    monkeypatch.setenv("FORGE", str(forge))
    (tmp_path / "harness").mkdir()
    target = {"id": "c", "runner": "forge", "harness": str(tmp_path / "harness"), "slot": "src/C.sol"}
    (tmp_path / "C.sol").write_text("contract C {}\n")
    summary = run_one(target, tmp_path / "C.sol", tmp_path / "out", 60)
    assert summary["build"] == "ok" and summary["tests"] == {"passed": 1, "total": 1}
    assert calls.read_text().splitlines() == ["build --offline", "build", "test --offline --json"]


def test_missing_tool_is_an_error_not_a_compile_error(tmp_path, monkeypatch):
    monkeypatch.setenv("FORGE", str(tmp_path / "no-such-forge"))
    (tmp_path / "harness").mkdir()
    target = {"id": "c", "runner": "forge", "harness": str(tmp_path / "harness"), "slot": "src/C.sol"}
    (tmp_path / "C.sol").write_text("contract C {}\n")
    with pytest.raises(ToolError, match="forge not found"):
        run_one(target, tmp_path / "C.sol", tmp_path / "out", 60)
    assert not (tmp_path / "out" / "summary.json").exists()  # tested again on the next run
