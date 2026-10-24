"""Report: the fault-diversity numbers of one run as text, JSON and four PNG charts.

Usage
-----
  python -m fdlab.report config/demo.json                    # writes runs/demo/report/
  python -m fdlab.report config/demo.json --out docs/images  # somewhere else

Files: report.json (every number below), outcomes.png (outcome of every variant, per model), voting.png (failure
rate of one version vs. a 2-of-3 vote over one model or three different models), overlap.png (coincident failures
between models) and faults.png (the tests that fail most often). Definitions: fdlab/diversity.py.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from fdlab import dashboard, diversity
from fdlab.generate import resolve

OUTCOMES = [  # (outcome, label, colour): the dashboard's ladder, best first
    ("all_pass", "Passes every test", "#0ca30c"),
    ("partial", "Fails some tests", "#fab219"),
    ("compile_error", "Does not compile", "#ec835a"),
    ("no_code", "No usable code", "#d03b3b"),
    ("api_error", "Request failed", "#9b2c2c"),
]
INK, MUTED, GRID, BLUE, GRAY = "#1f2328", "#59636e", "#e6e8eb", "#2a78d6", "#9aa3b2"


def _style(plt) -> None:
    plt.rcParams.update({
        "font.family": "DejaVu Sans", "font.size": 10, "axes.edgecolor": GRID, "axes.labelcolor": MUTED,
        "xtick.color": MUTED, "ytick.color": MUTED, "axes.spines.top": False, "axes.spines.right": False,
        "axes.titlesize": 12, "axes.titleweight": "bold", "axes.titlecolor": INK, "axes.titlelocation": "left",
        "figure.dpi": 150, "savefig.bbox": "tight", "savefig.facecolor": "white",
    })


def outcomes_chart(plt, rows: list[dict], models: list[str], path: Path) -> None:
    fig, ax = plt.subplots(figsize=(7.5, 0.55 * len(models) + 1.6))
    left = [0] * len(models)
    for key, label, color in OUTCOMES:
        counts = [sum(r["model"] == m and r["outcome"] == key for r in rows) for m in models]
        ax.barh(models, counts, left=left, color=color, label=label, height=0.62, edgecolor="white", linewidth=2)
        for i, c in enumerate(counts):
            if c:
                dark = key in ("no_code", "api_error")  # white text on the two dark reds
                ax.text(left[i] + c / 2, i, str(c), ha="center", va="center", fontsize=9, color="white" if dark else INK)
        left = [a + b for a, b in zip(left, counts, strict=True)]
    ax.invert_yaxis()
    ax.set_xlabel("variants")
    ax.xaxis.grid(True, color=GRID)
    ax.set_axisbelow(True)
    ax.set_title("Outcome of every variant")
    ax.legend(ncol=3, frameon=False, loc="upper left", bbox_to_anchor=(0, -0.18 if len(models) > 3 else -0.25),
              fontsize=9)
    fig.savefig(path)
    plt.close(fig)


def voting_chart(plt, vote: dict, path: Path) -> None:
    bars = [("One version", vote["single"], GRAY), ("2-of-3 vote,\none model", vote["same"], GRAY),
            ("2-of-3 vote,\nthree models", vote["diverse"], BLUE)]
    fig, ax = plt.subplots(figsize=(6.5, 3.6))
    for i, (_label, r, color) in enumerate(bars):
        ax.bar(i, r["p"], color=color, width=0.55)
        ax.errorbar(i, r["p"], yerr=[[r["p"] - r["lo"]], [r["hi"] - r["p"]]], color=INK, capsize=4, lw=1)
        ax.text(i, r["hi"] + 0.03, f"{r['p']:.0%}", ha="center", color=INK, fontsize=10, fontweight="bold")
    ax.set_xticks(range(3), [f"{label}\n({r['k']} of {r['n']})" for label, r, _ in bars], fontsize=9)
    ax.set_ylim(0, 1.12)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f"{y:.0%}"))
    ax.yaxis.grid(True, color=GRID)
    ax.set_axisbelow(True)
    ax.set_ylabel("share that fails at least one test")
    ax.set_title("Does majority voting help?")
    fig.savefig(path)
    plt.close(fig)


def overlap_chart(plt, cells: dict, models: list[str], path: Path) -> None:
    import numpy as np

    n = len(models)
    grid = np.full((n, n), np.nan)
    for (a, b), r in cells.items():
        i, j = models.index(a), models.index(b)
        grid[i, j] = grid[j, i] = r["p"]
    fig, ax = plt.subplots(figsize=(1.15 * n + 2.2, 1.0 * n + 1.2))
    cmap = plt.get_cmap("Blues").copy()
    cmap.set_bad("#f3f4f6")
    im = ax.imshow(grid, cmap=cmap, vmin=0, vmax=1)
    for (a, b), r in cells.items():
        i, j = models.index(a), models.index(b)
        for x, y in ((i, j), (j, i)):
            ax.text(y, x, f"{r['p']:.0%}\n{r['k']}/{r['n']}", ha="center", va="center", fontsize=8,
                    color="white" if r["p"] > 0.6 else INK)
    ax.set_xticks(range(n), models, rotation=30, ha="right")
    ax.set_yticks(range(n), models)
    ax.spines[:].set_visible(False)
    ax.set_title("Coincident failures between models")
    cb = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04, format=plt.FuncFormatter(lambda y, _: f"{y:.0%}"))
    cb.outline.set_visible(False)
    fig.savefig(path)
    plt.close(fig)


def faults_chart(plt, faults: list[dict], path: Path) -> None:
    fig, ax = plt.subplots(figsize=(7.5, 0.42 * max(1, len(faults)) + 1.2))
    names = [f["test"].removeprefix("test_") for f in faults]
    ax.barh(names, [f["variants"] for f in faults], color=BLUE, height=0.6)
    for i, f in enumerate(faults):
        ax.text(f["variants"] + 0.1, i, f"{f['models']} model{'s' if f['models'] != 1 else ''}", va="center",
                fontsize=8, color=MUTED)
    ax.invert_yaxis()
    ax.set_xlabel("compiled variants that fail the test")
    ax.xaxis.grid(True, color=GRID)
    ax.set_axisbelow(True)
    ax.set_title("Most frequent failing tests")
    fig.savefig(path)
    plt.close(fig)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m fdlab.report", description="Fault-diversity numbers and charts.")
    ap.add_argument("config", type=Path)
    ap.add_argument("--out", type=Path, help="output folder (default <out_dir>/report)")
    a = ap.parse_args(argv)
    cfg = json.loads(a.config.read_text())
    dashboard.configure(a.config)
    rows = dashboard.index()
    out = a.out or resolve(cfg["out_dir"]) / "report"
    out.mkdir(parents=True, exist_ok=True)
    models = [m.get("label") or m["id"].split("/")[-1] for m in cfg["models"]]
    report = {"variants": len(rows), "by_outcome": {k: sum(r["outcome"] == k for r in rows) for k, _, _ in OUTCOMES},
              "vote": diversity.vote(rows), "vote_compiled_only": diversity.vote(rows, only_compiled=True),
              "overlap": {f"{a} | {b}": r for (a, b), r in sorted(diversity.overlap(rows).items())},
              "shared_faults": diversity.shared_faults(rows), "per_target": {}}
    for t in cfg["targets"]:
        report["per_target"][t["id"]] = diversity.vote([r for r in rows if r["target"] == t["id"]])
    (out / "report.json").write_text(json.dumps(report, indent=1) + "\n")

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    _style(plt)
    outcomes_chart(plt, rows, models, out / "outcomes.png")
    voting_chart(plt, report["vote"], out / "voting.png")
    overlap_chart(plt, diversity.overlap(rows), models, out / "overlap.png")
    faults_chart(plt, report["shared_faults"][:8], out / "faults.png")

    v = report["vote"]
    print(f"{len(rows)} variants: " + ", ".join(f"{k} {n}" for k, n in report["by_outcome"].items()))
    print(f"versions with code: {v['versions']} from {v['models']} models")
    for key, label in (("single", "one version fails"), ("same", "2-of-3 vote, one model, fails"),
                       ("diverse", "2-of-3 vote, three models, fails")):
        r = v[key]
        print(f"  {label:34} {r['p']:6.1%}  ({r['k']} of {r['n']}, 95% CI {r['lo']:.0%}-{r['hi']:.0%})")
    print(f"written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
