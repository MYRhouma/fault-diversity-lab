"""Fault-diversity measures on hand-made rows."""

import pytest

from fdlab.diversity import ALL, fault_set, overlap, shared_faults, shares, vote, wilson


def v(model: str, outcome: str, failing=()):
    return {"model": model, "outcome": outcome, "failing": list(failing)}


def test_wilson():
    assert wilson(0, 0) == {"k": 0, "n": 0, "p": 0.0, "lo": 0.0, "hi": 0.0}
    r = wilson(5, 10)
    assert r["p"] == 0.5 and r["lo"] == pytest.approx(0.2366, abs=1e-4) and r["hi"] == pytest.approx(0.7634, abs=1e-4)
    assert wilson(0, 10)["lo"] == 0.0 and wilson(10, 10)["hi"] == 1.0


def test_shares():
    assert fault_set(v("a", "compile_error")) == ALL
    assert shares(ALL, ALL) and shares(ALL, frozenset({"x"})) and not shares(ALL, frozenset())
    assert shares(frozenset({"x", "y"}), frozenset({"y"})) and not shares(frozenset({"x"}), frozenset({"y"}))


def test_vote_same_and_diverse():
    rows = [
        v("A", "partial", ["t1"]), v("A", "partial", ["t1"]), v("A", "all_pass"),   # A always fails t1 when it fails
        v("B", "partial", ["t2"]),
        v("C", "compile_error"),
        v("D", "no_code"),                                                          # no code: not a version
    ]
    r = vote(rows)
    assert r["versions"] == 5 and r["models"] == 3
    assert (r["single"]["k"], r["single"]["n"]) == (4, 5)
    # same model: the only triple is A,A,A and its two failing versions share t1
    assert (r["same"]["k"], r["same"]["n"]) == (1, 1)
    # three different models: 3 (choice of A) x B x C = 3 triples; C fails every test, so it shares with B every time
    assert (r["diverse"]["k"], r["diverse"]["n"]) == (3, 3)
    c = vote(rows, only_compiled=True)
    assert c["versions"] == 4 and c["diverse"]["n"] == 0


def test_vote_masks_unshared_faults():
    rows = [v("A", "partial", ["t1"]), v("B", "partial", ["t2"]), v("C", "partial", ["t3"])]
    assert vote(rows)["diverse"]["k"] == 0 and vote(rows)["single"]["k"] == 3


def test_overlap_and_shared_faults():
    rows = [v("A", "partial", ["t1"]), v("A", "partial", ["t2"]), v("B", "partial", ["t1", "t3"]), v("C", "all_pass")]
    ov = overlap(rows)
    assert list(ov) == [("A", "B")] and (ov["A", "B"]["k"], ov["A", "B"]["n"]) == (1, 2)
    assert shared_faults(rows)[0] == {"test": "t1", "variants": 2, "models": 2}


def test_versions_of_different_targets_are_never_compared():
    rows = [{**v("A", "partial", ["t1"]), "target": "x"}, {**v("B", "partial", ["t1"]), "target": "y"},
            {**v("C", "partial", ["t1"]), "target": "x"}, {**v("D", "partial", ["t1"]), "target": "y"}]
    assert vote(rows)["diverse"]["n"] == 0
    assert set(overlap(rows)) == {("A", "C"), ("B", "D")}
    assert [f["test"] for f in shared_faults(rows)] == ["x: t1", "y: t1"]
