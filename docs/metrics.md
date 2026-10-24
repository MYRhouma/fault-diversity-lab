# Metrics

All definitions are implemented in [`fdlab/diversity.py`](../fdlab/diversity.py) (used by `fdlab.report`) and in
[`web/src/features/run/stats.ts`](../web/src/features/run/stats.ts) (used by the dashboard's findings page). Both
work on the variant rows of the run API, so they give the same numbers.

## Versions and fault sets

A **version** is a variant with code: outcome `all_pass`, `partial` or `compile_error`
(see the [outcome ladder](run-folder.md#outcome-ladder)). Variants without code (`no_code`, `api_error`) are not
versions; they are reported as outcomes but take no part in voting.

The **fault set** of a version is the set of tests it fails. Skipped tests are neither passed nor failed. A
version that does not compile fails every test: its fault set is "all".

Two versions **share a fault** when their fault sets have at least one test in common. A version that does not
compile shares a fault with every version that fails at least one test, and with every other version that does not
compile. A version that passes every test shares nothing.

Versions are only compared with versions of the **same target**.

## Single-version failure rate

```
single = (versions that fail at least one test) / (versions)
```

This is the baseline: the chance that one version, used alone, gets at least one test wrong.

## 2-of-3 majority vote

N-version programming runs several independently written versions on the same input and takes the majority
answer. With three versions and a 2-of-3 vote, the system's answer on a test is wrong only when **at least two of
the three versions fail that same test**. A triple of versions therefore fails when some pair of it shares a
failing test.

Every triple of versions of one target is evaluated, and the triples are counted in two groups:

| Rate | Triples counted | Question it answers |
|---|---|---|
| `same` | three versions from the **same model** (any settings and samples) | Does repeated sampling of one model give diversity? |
| `diverse` | three versions from **three different models** | Do different models fail in different places? |

Triples with exactly two models are not counted in either group.

```
same    = (failing same-model triples)    / (same-model triples)
diverse = (failing three-model triples)   / (three-model triples)
```

Reading the numbers: if `diverse` is much lower than `single`, the vote masks most faults, because the models
rarely fail the same test. If `diverse` is close to `single`, the faults are **coincident**: the models tend to
make the same mistakes, and voting buys little. Comparing `diverse` with `same` shows whether using different
models gives more diversity than sampling one model several times.

Two variants of the vote are reported:

- **all versions**: versions that do not compile count as failing every test (a vote cannot use them);
- **compiled only** (`vote_compiled_only` in `report.json`, "only compiled" on the dashboard): versions that do
  not compile are left out, which isolates logic faults from compile errors.

The triples are not independent of each other (one version appears in many triples), so treat the vote rates as
descriptive: their Wilson intervals are likely too narrow.

## Coincident failures between two models

For a pair of models A and B, take every pair (a, b) of versions with a from A and b from B, both compiled and both
failing at least one test (outcome `partial`), of the same target:

```
overlap(A, B) = (pairs that share a failing test) / (all such pairs)
```

This is the conditional rate of coincident failure: when both models are wrong, how often are they wrong on the
same test. It is shown as the fault overlap heatmap (`overlap.png`, and "Fault overlap between models" on the
findings page in Advanced view).

The failures page also lists, for every pair of failing compiled versions, the size of the intersection and union
of their fault sets and the Jaccard index (`|a ∩ b| / |a ∪ b|`).

## Fault patterns and shared faults

Compiled versions that fail **exactly the same set of tests** have the same **fault pattern**. Patterns are named
F1, F2, ... by frequency (most common first). The results matrix labels each square with its pattern and, on
hover, highlights every variant with the same pattern.

**Shared faults** are the tests failed by the most compiled versions, with the number of different models that
fail them. A test failed by many models is a fault a vote cannot hide. With more than one target, a test is named
`<target>: <test>` in `report.json`.

## Confidence intervals

Rates are reported with a 95% **Wilson score interval**:

```
p      = k / n
centre = (p + z²/(2n)) / (1 + z²/n)
half   = z * sqrt(p(1 - p)/n + z²/(4n²)) / (1 + z²/n)
CI     = [max(0, centre - half), min(1, centre + half)]      with z = 1.96
```

Unlike the normal approximation, it stays inside [0, 1] and is reasonable for small n and for rates of 0 or 1.
With n = 0 the rate and interval are reported as 0 (and "n/a" on the dashboard).

The findings page (Advanced view) also gives a two-sided **Fisher exact test** for "reasoning off against on" per
model, on the 2x2 table of passing and not passing variants. With many models, a few small p-values appear by
chance; it is a screening aid, not a confirmatory test.

## What the numbers do not say

- Tests only find the faults they check. A version that passes every test can still be wrong.
- A vote that "fails" here fails on at least one test of the suite; it says nothing about how bad that is.
- Models, settings and samples are not a random sample of anything; generalise with care.
