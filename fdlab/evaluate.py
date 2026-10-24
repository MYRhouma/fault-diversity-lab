"""Test runner: compile every generated variant inside its target's harness and run the target's test suite.

Usage
-----
  python -m fdlab.evaluate config/demo.json                      # test every variant that has no result yet
  python -m fdlab.evaluate config/demo.json --only 'tipjar/*'    # a subset (glob on variant ids, repeatable)
  python -m fdlab.evaluate config/demo.json --jobs 2 --force     # 2 in parallel, re-test variants that have a result
  python -m fdlab.evaluate config/demo.json --target tipjar \
      --file specs/tip-jar/reference/TipJar.sol --out /tmp/ref   # test one file by hand (e.g. the reference)

The harness folder is copied to a fresh temporary directory for every variant, so runs never share state and the
harness itself is never changed. The variant goes to the target's `slot` (default: src/<Output file of the prompt>).

Runners (target field `runner`)
-------------------------------
  forge   Foundry: `forge build`, then `forge test --json`. Groups are the test contracts.
  gradle  Gradle + JUnit 5: `./gradlew test --continue`, results from build/test-results/test/*.xml. Groups are the
          test classes. A run without any JUnit report did not compile.

Output, in <out_dir>/tests/<variant id>/
  variant.sha256   sha256 of the tested file
  build.log        compiler output (forge) or the whole Gradle output (gradle)
  results.csv      test,group,status,message (status: pass | fail | skipped)
  summary.json     {"build": "ok" | "failed", "tests": {"passed", "total"}, "groups": {...}, "runner", "seconds"}

A run stopped by the time limit (`test_timeout_s`, default 1800 s) writes no summary.json, so it is tested again
on the next call. forge runs with --offline; only when the pinned solc is not installed yet does it build once
without --offline, which downloads that compiler. Tools: FORGE (default `forge` on PATH, then ~/.foundry/bin/forge)
and GRADLE_OPTS are honoured.
"""

from __future__ import annotations

import argparse
import csv
import fnmatch
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fdlab.generate import output_file, resolve

RUNNERS = ("forge", "gradle")
MISSING_SOLC = re.compile(r"can't install missing solc (\S+) in offline mode")
_install_lock = threading.Lock()  # one compiler download at a time


class ToolError(Exception):
    pass
SKIP_COPY = {"forge": {"out", "cache", "broadcast"}, "gradle": {"build", ".gradle"}}


def forge_bin() -> str:
    if os.environ.get("FORGE"):
        return os.environ["FORGE"]
    found = shutil.which("forge")
    return found or str(Path.home() / ".foundry" / "bin" / "forge")


def target_slot(target: dict) -> str:
    if target.get("slot"):
        return target["slot"]
    return f"src/{output_file(resolve(target['prompt']).read_text())}"


def _copy_harness(harness: Path, work: Path, runner: str) -> None:
    skip = SKIP_COPY[runner]
    shutil.copytree(harness, work, dirs_exist_ok=True, symlinks=True,
                    ignore=lambda d, names: [n for n in names if Path(d) == harness and n in skip])


def _run(cmd: list[str], cwd: Path, log: Path, timeout: float, append: bool = False) -> int | None:
    """Run cmd, write stdout+stderr to log. None when the time limit stopped it."""
    with open(log, "ab" if append else "wb") as f:
        try:
            return subprocess.run(cmd, cwd=cwd, stdout=f, stderr=subprocess.STDOUT, timeout=timeout).returncode
        except subprocess.TimeoutExpired:
            f.write(f"\nTIMEOUT: stopped after {timeout:g} s\n".encode())
            return None


def _forge(work: Path, out: Path, timeout: float) -> list[tuple] | None:
    forge = forge_bin()
    try:
        rc = _run([forge, "build", "--offline"], work, out / "build.log", timeout)
    except FileNotFoundError as e:
        raise ToolError(f"forge not found ({forge}); install Foundry from https://getfoundry.sh or set FORGE") from e
    if rc is None:
        raise TimeoutError
    if rc != 0 and MISSING_SOLC.search((out / "build.log").read_text(errors="replace")):
        # the pinned compiler is not installed yet: build once online, which only downloads solc (the libraries
        # are already in the harness). This is the only network access of the test runner.
        with _install_lock:
            rc = _run([forge, "build"], work, out / "build.log", timeout)
        if rc is None:
            raise TimeoutError
    if rc != 0:
        return []
    raw = out / "forge.json"
    with open(raw, "wb") as f:
        try:
            subprocess.run([forge, "test", "--offline", "--json"], cwd=work, stdout=f, stderr=subprocess.DEVNULL,
                           timeout=timeout)
        except subprocess.TimeoutExpired as e:
            raise TimeoutError from e
    try:
        data = json.loads(raw.read_text())
    except ValueError:
        return []
    rows = []
    for suite, res in data.items():
        group = suite.split(":")[-1]
        for name, r in (res.get("test_results") or {}).items():
            status = {"Success": "pass", "Skipped": "skipped"}.get(r.get("status"), "fail")
            rows.append((name.split("(")[0], group, status, (r.get("reason") or "")[:500]))
    return rows


TESTCASE = re.compile(r'<testcase name="(.*?)" classname="(.*?)"[^>]*?(?:/>|>(.*?)</testcase>)', re.S)
FAILURE = re.compile(r'<(failure|error)[^>]*?message="(.*?)"', re.S)


def _gradle(work: Path, out: Path, timeout: float) -> list[tuple] | None:
    gradlew = work / "gradlew"
    if gradlew.exists():
        gradlew.chmod(gradlew.stat().st_mode | 0o111)
    cmd = [str(gradlew) if gradlew.exists() else "gradle", "--offline", "--console=plain", "test", "--continue"]
    try:
        rc = _run(cmd, work, out / "build.log", timeout)
    except FileNotFoundError as e:
        raise ToolError("neither ./gradlew in the harness nor gradle on PATH") from e
    if rc is None:
        raise TimeoutError
    reports = sorted((work / "build" / "test-results" / "test").glob("*.xml"))
    if not reports:
        return []
    junit = out / "junit"
    shutil.rmtree(junit, ignore_errors=True)
    junit.mkdir()
    rows = []
    for f in reports:
        shutil.copy(f, junit / f.name)
        for m in TESTCASE.finditer(f.read_text(encoding="utf-8", errors="replace")):
            name, cls, inner = html.unescape(m[1]).removesuffix("()"), m[2].split(".")[-1], m[3] or ""
            if "<skipped" in inner:
                rows.append((name, cls, "skipped", ""))
                continue
            fail = FAILURE.search(inner)
            rows.append((name, cls, "fail" if fail else "pass", html.unescape(fail[2])[:500] if fail else ""))
    return rows


def run_one(target: dict, variant: Path, out: Path, timeout: float) -> dict | None:
    """Test one file. Returns the summary, or None when the time limit stopped the run (nothing is kept)."""
    runner = target.get("runner")
    if runner not in RUNNERS:
        raise ValueError(f"target {target['id']}: runner must be one of {RUNNERS}, not {runner!r}")
    harness = resolve(target["harness"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "summary.json").unlink(missing_ok=True)
    (out / "variant.sha256").write_text(hashlib.sha256(variant.read_bytes()).hexdigest() + "\n")
    t0 = time.time()
    with tempfile.TemporaryDirectory(prefix="fdlab-") as tmp:
        work = Path(tmp) / "harness"
        _copy_harness(harness, work, runner)
        slot = work / target_slot(target)
        slot.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(variant, slot)
        try:
            rows = (_forge if runner == "forge" else _gradle)(work, out, timeout)
        except TimeoutError:
            return None
    rows = sorted(rows or [])
    with open(out / "results.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["test", "group", "status", "message"])
        w.writerows(rows)
    counted = [r for r in rows if r[2] != "skipped"]
    groups: dict[str, dict] = {}
    for r in counted:
        g = groups.setdefault(r[1], {"passed": 0, "total": 0})
        g["total"] += 1
        g["passed"] += r[2] == "pass"
    summary = {"build": "ok" if rows else "failed", "runner": runner,
               "tests": {"passed": sum(r[2] == "pass" for r in counted), "total": len(counted)} if rows else None,
               "skipped": sum(r[2] == "skipped" for r in rows), "groups": groups, "seconds": round(time.time() - t0, 1)}
    (out / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    return summary


def pending(cfg: dict, only: list[str] | None, force: bool) -> list[tuple[dict, str, Path, Path]]:
    """(target, variant id, variant file, test folder) of every generated variant still to test."""
    out_dir = resolve(cfg["out_dir"])
    targets = {t["id"]: t for t in cfg["targets"]}
    todo = []
    for f in sorted((out_dir / "requests").glob("*.json")):
        try:
            rec = json.loads(f.read_text())
        except ValueError:
            continue  # being written by the generator right now
        if rec.get("status") != "ok" or not rec.get("variant_file") or rec.get("target") not in targets:
            continue
        if only and not any(fnmatch.fnmatchcase(rec["id"], p) for p in only):
            continue
        tests = out_dir / "tests" / rec["id"]
        if not force and (tests / "summary.json").exists():
            continue
        todo.append((targets[rec["target"]], rec["id"], out_dir / rec["variant_file"], tests))
    return todo


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m fdlab.evaluate", description="Compile and test generated variants.")
    ap.add_argument("config")
    ap.add_argument("--only", action="append", metavar="GLOB", help="restrict to variant ids matching GLOB")
    ap.add_argument("--jobs", type=int, default=1, help="variants tested in parallel (default 1)")
    ap.add_argument("--force", action="store_true", help="also re-test variants that already have a result")
    ap.add_argument("--target", help="with --file and --out: test one file against this target")
    ap.add_argument("--file", type=Path)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args(argv)
    cfg = json.loads(Path(a.config).read_text())
    timeout = float(cfg.get("test_timeout_s", 1800))
    if a.file or a.target or a.out:
        if not (a.file and a.target and a.out):
            print("ERROR --target, --file and --out go together")
            return 2
        target = next((t for t in cfg["targets"] if t["id"] == a.target), None)
        if target is None:
            print(f"ERROR unknown target {a.target!r}")
            return 2
        try:
            summary = run_one(target, a.file.resolve(), a.out.resolve(), timeout)
        except ToolError as e:
            print(f"ERROR {e}")
            return 2
        print(json.dumps(summary) if summary else "TIMEOUT")
        return 0 if summary else 1
    todo = pending(cfg, a.only, a.force)
    print(f"{len(todo)} variant(s) to test")

    def one(item):
        target, vid, file, tests = item
        s = run_one(target, file, tests, timeout)
        score = "timeout" if s is None else s["build"] if s["build"] != "ok" else \
            f"{s['tests']['passed']}/{s['tests']['total']} passed"
        print(f"{vid}: {score}", flush=True)
        return s is not None

    try:
        with ThreadPoolExecutor(max_workers=max(1, a.jobs)) as pool:
            results = list(pool.map(one, todo))
    except ToolError as e:
        print(f"ERROR {e}")
        return 2
    print(f"tested {sum(results)}, timed out {len(results) - sum(results)}")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
