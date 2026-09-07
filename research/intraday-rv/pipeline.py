#!/usr/bin/env python3
"""Phase-based CLI for the intraday RV build (spec Section 14).

Each phase ends with a gate; a failed gate stops the run rather than letting a
downstream phase build on bad inputs.

    python pipeline.py download --dry-run       # price the Databento pull
    python pipeline.py data                     # clean + build RV panels
    python pipeline.py commonality              # Section 9
    python pipeline.py harness                  # Phase 3 metric assertions
    python pipeline.py models --horizon 65min   # Phases 4-7
    python pipeline.py smoke                    # full synthetic end-to-end

`--synthetic` runs any phase against generated data, which is how the whole
pipeline is exercised without a Databento key.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np

from src.config import COVID_PROBE, FOLDS, HORIZONS, ensure_dirs

log = logging.getLogger("pipeline")


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


# --- Phase 1 -------------------------------------------------------------

def cmd_download(args) -> int:
    from src.data.download import run

    try:
        plans = run(budget_usd=args.budget, dry_run=args.dry_run)
    except RuntimeError as exc:
        print(f"cannot price the pull: {exc}")
        return 1
    total = sum(p.cost_usd or 0.0 for p in plans)
    print(f"\n{len(plans)} chunks, total quoted cost ${total:.2f}")
    for p in plans:
        print(f"  {p.chunk_id}  ${p.cost_usd or 0:.4f}  {p.state}")
    if args.dry_run:
        print("\nDRY RUN -- nothing submitted. Re-run with --no-dry-run to commit.")
    return 0


def _synthetic_panels(args):
    from src.data.clean import clean_symbol
    from src.data.panel import build_panels
    from src.data.synthetic import generate_panel

    syms = [f"S{i:02d}" for i in range(args.n_symbols)]
    log.info("generating %d synthetic symbols %s..%s", len(syms), args.start, args.end)
    raw = generate_panel(syms, args.start, args.end, seed=args.seed)
    cleaned = {}
    for s, df in raw.items():
        c, rep = clean_symbol(df, args.start, args.end, symbol=s)
        cleaned[s] = c
    return build_panels(cleaned, horizons=args.horizons)


def cmd_data(args) -> int:
    ensure_dirs()
    if not args.synthetic:
        print("Live data path requires the Databento download to have completed.")
        print("Run `python pipeline.py download --no-dry-run` first, or use "
              "--synthetic to exercise the pipeline.")
        return 1
    panels = _synthetic_panels(args)
    for h, p in panels.items():
        p.save()
        print(f"{h:6s} panel {p.values.shape}  floored={p.meta['n_floored']}/"
              f"{p.meta['n_cells']}")
    return 0


# --- Phase 2 -------------------------------------------------------------

def cmd_commonality(args) -> int:
    from src.analysis.commonality import (
        commonality_by_bucket, diurnal_profile, summarize,
    )

    panels = _synthetic_panels(args) if args.synthetic else _load_panels(args)
    print(f"\n{'horizon':8s} {'mean R2':>9s} {'std':>7s} {'months':>7s}")
    for h in args.horizons:
        s = summarize(panels[h])
        print(f"{h:8s} {s['mean']:9.4f} {s['std']:7.4f} {s['n_months']:7d}")

    h0 = args.horizons[0]
    d = diurnal_profile(panels[h0])
    shape = d["normalized"].to_numpy()
    n = len(shape)
    reverse_j = shape[0] > shape.min() * 1.5 and shape[-1] > shape.min() * 1.2
    print(f"\ndiurnal reverse-J at {h0}: {reverse_j} "
          f"(open={shape[0]:.2f} min={shape.min():.2f} close={shape[-1]:.2f})")

    b = commonality_by_bucket(panels[h0])
    rising = b["mean_r2"].iloc[-1] > b["mean_r2"].iloc[0]
    print(f"commonality rises toward the close: {rising} "
          f"(open={b['mean_r2'].iloc[0]:.3f} close={b['mean_r2'].iloc[-1]:.3f})")
    return 0


def _load_panels(args):
    from src.data.panel import RVPanel

    return {h: RVPanel.load(h) for h in args.horizons}


# --- Phase 3 -------------------------------------------------------------

def cmd_harness(args) -> int:
    """Assert the metric identities before any model is trained."""
    from src.config import PERFECT_RU
    from src.eval.losses import qlike
    from src.eval.utility import realized_utility

    rng = np.random.default_rng(0)
    a = rng.normal(-12.0, 1.0, (20, 500))
    checks = [
        ("QLIKE(perfect) == 0", qlike(a, a) == 0.0),
        (f"RU(perfect) == {PERFECT_RU}", abs(realized_utility(a, a) - PERFECT_RU) < 1e-15),
    ]
    ok = True
    for name, passed in checks:
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
        ok &= passed
    import subprocess

    r = subprocess.run([sys.executable, "-m", "pytest", "tests/", "-q"],
                       cwd=Path(__file__).parent)
    return 0 if (ok and r.returncode == 0) else 1


# --- Phases 4-7 ----------------------------------------------------------

def cmd_models(args) -> int:
    from src.eval.losses import qlike
    from src.schemes.grid import build_grid, run_grid, save_tables

    panels = _synthetic_panels(args) if args.synthetic else _load_panels(args)
    folds = {f.index: f for f in FOLDS}
    if args.synthetic:
        # Synthetic runs use a single fold sized to the generated window.
        from src.config import Fold

        sessions = panels[args.horizons[0]].sessions
        n = len(sessions)
        folds = {1: Fold(1, str(sessions[0]), str(sessions[int(n * 0.55)]),
                         str(sessions[int(n * 0.55) + 1]), str(sessions[int(n * 0.78)]),
                         str(sessions[int(n * 0.78) + 1]), str(sessions[-1]))}
    cells = build_grid(args.models, args.horizons, list(folds),
                       poolings=args.poolings, features=args.features)
    log.info("running %d cells", len(cells))
    results = run_grid(cells, panels, folds, use_cache=not args.no_cache,
                       model_params=args.model_params)
    if not results:
        print("no cells produced results")
        return 1
    written = save_tables(results)
    for k, v in written.items():
        print(f"wrote {k}: {v}")
    from src.schemes.grid import headline_table

    print("\nHeadline QLIKE by cell:")
    print(headline_table(results).to_string())
    return 0


def cmd_smoke(args) -> int:
    """Full synthetic end-to-end run across every phase."""
    import subprocess

    return subprocess.run(
        [sys.executable, str(Path(__file__).parent / "tests" / "smoke.py")]
    ).returncode


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, synthetic_default=False):
        p.add_argument("--synthetic", action="store_true", default=synthetic_default)
        p.add_argument("--n-symbols", type=int, default=12)
        p.add_argument("--start", default="2019-01-02")
        p.add_argument("--end", default="2021-12-31")
        p.add_argument("--seed", type=int, default=42)
        p.add_argument("--horizons", nargs="+", default=["65min", "1day"],
                       choices=list(HORIZONS))

    d = sub.add_parser("download")
    d.add_argument("--budget", type=float, default=125.0)
    d.add_argument("--dry-run", action="store_true", default=True)
    d.add_argument("--no-dry-run", dest="dry_run", action="store_false")
    d.set_defaults(func=cmd_download)

    for name, fn in [("data", cmd_data), ("commonality", cmd_commonality)]:
        p = sub.add_parser(name)
        common(p)
        p.set_defaults(func=fn)

    h = sub.add_parser("harness")
    h.set_defaults(func=cmd_harness)

    m = sub.add_parser("models")
    common(m)
    m.add_argument("--models", nargs="+", default=["OLS", "LASSO"])
    m.add_argument("--poolings", nargs="+", default=None)
    m.add_argument("--features", nargs="+", default=None)
    m.add_argument("--no-cache", action="store_true")
    m.set_defaults(func=cmd_models, model_params={})

    s = sub.add_parser("smoke")
    s.set_defaults(func=cmd_smoke)

    args = ap.parse_args(argv)
    _setup_logging(args.verbose)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
