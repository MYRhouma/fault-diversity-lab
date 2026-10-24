"""Fault-diversity measures over the variant rows of fdlab.dashboard (the same definitions as the dashboard).

A version is a variant with code (it may not compile). Its fault set is the set of tests it fails; a version that
does not compile fails every test. A 2-of-3 majority vote over three versions gets a test wrong only when at least
two of them fail that test, so a triple fails when some pair of it shares a failing test. Versions are only ever
compared with versions of the same target (rows without a "target" key count as one target).
"""

from __future__ import annotations

import math
from itertools import combinations

ALL = "all"  # the fault set of a version that does not compile
WITH_CODE = ("all_pass", "partial", "compile_error")


def wilson(k: int, n: int, z: float = 1.96) -> dict:
    """k of n with a 95% Wilson interval (sound for small n and for 0 or n)."""
    if not n:
        return {"k": k, "n": n, "p": 0.0, "lo": 0.0, "hi": 0.0}
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return {"k": k, "n": n, "p": p, "lo": max(0.0, c - h), "hi": min(1.0, c + h)}


def fault_set(v: dict) -> frozenset | str:
    return ALL if v["outcome"] == "compile_error" else frozenset(v["failing"])


def shares(a, b) -> bool:
    """True when two versions fail at least one common test."""
    if a == ALL:
        return b == ALL or bool(b)
    if b == ALL:
        return bool(a)
    return bool(a & b)


def versions(rows: list[dict], only_compiled: bool = False) -> list[dict]:
    keep = ("all_pass", "partial") if only_compiled else WITH_CODE
    return [v for v in rows if v["outcome"] in keep]


def _by_target(rows: list[dict]) -> list[list[dict]]:
    groups: dict[str | None, list[dict]] = {}
    for v in rows:
        groups.setdefault(v.get("target"), []).append(v)
    return list(groups.values())


def vote(rows: list[dict], only_compiled: bool = False) -> dict:
    """Failure rates of one version, of 2-of-3 votes over three samples of one model ("same") and over three
    different models ("diverse"). Every triple of versions of the same target is counted."""
    vs = versions(rows, only_compiled)
    same_n = same_f = div_n = div_f = 0
    for group in _by_target(vs):
        sets = [fault_set(v) for v in group]
        pair = {(i, j): shares(sets[i], sets[j]) for i, j in combinations(range(len(group)), 2)}
        for i, j, k in combinations(range(len(group)), 3):
            models = {group[i]["model"], group[j]["model"], group[k]["model"]}
            fail = pair[i, j] or pair[i, k] or pair[j, k]
            if len(models) == 1:
                same_n, same_f = same_n + 1, same_f + fail
            elif len(models) == 3:
                div_n, div_f = div_n + 1, div_f + fail
    single = sum(fault_set(v) == ALL or bool(fault_set(v)) for v in vs)
    return {"versions": len(vs), "models": len({v["model"] for v in vs}), "single": wilson(single, len(vs)),
            "same": wilson(same_f, same_n), "diverse": wilson(div_f, div_n)}


def overlap(rows: list[dict]) -> dict[tuple[str, str], dict]:
    """For each pair of models: of all pairs of their compiled, failing versions, the share with a common failing
    test (the coincident-failure rate between the two models). Pairs are formed within a target."""
    vs = [v for v in rows if v["outcome"] == "partial"]
    cells: dict[tuple[str, str], list[int]] = {}
    for a, b in combinations(vs, 2):
        if a["model"] == b["model"] or a.get("target") != b.get("target"):
            continue
        key = tuple(sorted((a["model"], b["model"])))
        c = cells.setdefault(key, [0, 0])
        c[1] += 1
        c[0] += shares(fault_set(a), fault_set(b))
    return {k: wilson(*c) for k, c in cells.items()}


def shared_faults(rows: list[dict], top: int = 10) -> list[dict]:
    """The tests that fail in the most compiled versions, with how many different models fail them. With more than
    one target, a test is named "<target>: <test>"."""
    many = len({v.get("target") for v in rows}) > 1
    by: dict[str, dict] = {}
    for v in rows:
        if v["outcome"] == "partial":
            for test in v["failing"]:
                t = f"{v.get('target')}: {test}" if many else test
                e = by.setdefault(t, {"test": t, "variants": 0, "models": set()})
                e["variants"] += 1
                e["models"].add(v["model"])
    out = [{"test": e["test"], "variants": e["variants"], "models": len(e["models"])} for e in by.values()]
    return sorted(out, key=lambda e: (-e["variants"], -e["models"], e["test"]))[:top]
