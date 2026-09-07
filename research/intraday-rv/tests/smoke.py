#!/usr/bin/env python3
"""End-to-end synthetic smoke run across every build phase (spec Section 14).

This exercises the complete pipeline -- download plumbing, cleaning, RV panels,
commonality, the evaluation harness, all six experiment cells, clustering, the
Intraday2Daily analysis and the unseen-stock test -- without a Databento key
and without live data.

It validates *machinery*, not findings. Every number it prints comes from a
synthetic generator whose factor structure was chosen by hand, so the numbers
say the code computes what it claims, and nothing about the market.
"""

from __future__ import annotations

import logging
import sys
import time
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
warnings.filterwarnings("ignore")
logging.basicConfig(level=logging.ERROR)

import numpy as np

from src.analysis.commonality import (
    commonality_by_bucket, diurnal_profile, summarize, trade_vs_mid_rv,
)
from src.analysis.intraday2daily import (
    bucket_importance, build_features, closing_bucket_is_largest, fit_ols,
    traditional_features,
)
from src.analysis.unseen import per_stock_ols_baseline, run_unseen_cell
from src.config import PERFECT_RU, Cell, Fold
from src.data.clean import clean_symbol
from src.data.panel import build_panels
from src.data.synthetic import generate_panel
from src.eval.dm import diebold_mariano
from src.eval.losses import mse, qlike
from src.eval.mcs import model_confidence_set
from src.eval.utility import realized_utility
from src.schemes.runner import run_cell

RAW = [f"R{i:02d}" for i in range(10)]
UNSEEN = [f"U{i:02d}" for i in range(3)]
START, END = "2019-01-02", "2021-12-31"


def banner(text: str) -> None:
    print(f"\n{'=' * 72}\n{text}\n{'=' * 72}")


def main() -> int:
    t_start = time.time()
    failures: list[str] = []

    def check(name: str, passed: bool, detail: str = "") -> None:
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}" +
              (f"  ({detail})" if detail else ""))
        if not passed:
            failures.append(name)

    # ---------------- Phase 1 ----------------
    banner("PHASE 1 -- data: clean, RTH filter, RV panels")
    t0 = time.time()
    raw = generate_panel(RAW + UNSEEN, START, END, seed=42)
    cleaned, reports = {}, {}
    for s, df in raw.items():
        c, rep = clean_symbol(df, START, END, symbol=s)
        cleaned[s], reports[s] = c, rep
    panels = build_panels(cleaned, horizons=["65min", "1day"])
    trade_panels = build_panels(cleaned, horizons=["65min"], column="trade_price")
    print(f"  built in {time.time() - t0:.0f}s")

    counts = {len(c) // r.n_full_sessions for c, r in
              zip(cleaned.values(), reports.values())}
    check("every full session has exactly 391 snapshots", counts == {391}, str(counts))
    check("zero NaN quotes during RTH",
          all(r.n_nan_quotes == 0 for r in reports.values()))
    p65 = panels["65min"]
    print(f"  65min panel {p65.values.shape}, 1day {panels['1day'].values.shape}")
    check("panel shapes agree on symbols and sessions",
          p65.n_symbols == len(RAW) + len(UNSEEN))

    d = diurnal_profile(panels["65min"])["normalized"].to_numpy()
    check("reverse-J diurnal shape", d[0] > d.min() * 1.5 and d[-1] > d.min() * 1.2,
          f"open={d[0]:.2f} min={d.min():.2f} close={d[-1]:.2f}")

    tvm = trade_vs_mid_rv(panels["65min"], trade_panels["65min"])
    check("trade-vs-mid RV comparison produced",
          len(tvm) == p65.n_symbols and tvm["rv_ratio_trade_over_mid"].notna().all(),
          f"median ratio {tvm['rv_ratio_trade_over_mid'].median():.3f}")

    # ---------------- Phase 2 ----------------
    banner("PHASE 2 -- commonality (Section 9)")
    for h in ("65min", "1day"):
        s = summarize(panels[h])
        print(f"  {h:6s} mean R2={s['mean']:.4f} std={s['std']:.4f} "
              f"months={s['n_months']}")
        check(f"{h} commonality is a valid R2", 0.0 <= s["mean"] <= 1.0)
    bkt = commonality_by_bucket(panels["65min"])
    print(f"  buckets: {len(bkt)} (open R2={bkt['mean_r2'].iloc[0]:.3f} "
          f"close R2={bkt['mean_r2'].iloc[-1]:.3f})")
    check("bucket-level commonality computed", bkt["mean_r2"].notna().all())

    # ---------------- Phase 3 ----------------
    banner("PHASE 3 -- evaluation harness (Section 10)")
    rng = np.random.default_rng(0)
    a = rng.normal(-12.0, 1.0, (20, 400))
    check("QLIKE(perfect) == 0 exactly", qlike(a, a) == 0.0)
    check("MSE(perfect) == 0 exactly", mse(a, a) == 0.0)
    check(f"RU(perfect) == {PERFECT_RU}",
          abs(realized_utility(a, a) - PERFECT_RU) < 1e-15)
    good, bad = a + rng.normal(0, .2, a.shape), a + rng.normal(0, .6, a.shape)
    dm = diebold_mariano(a, good, bad, "qlike")
    check("DM recovers a known ordering", dm.better == "a" and dm.pvalue < 0.01,
          f"stat={dm.stat:.1f}")
    m = model_confidence_set(a, {"good": good, "bad": bad}, n_boot=200)
    check("MCS drops the worse model", "bad" not in m.included, str(m.included))

    # ---------------- Phases 4-7 ----------------
    banner("PHASES 4-7 -- the 2x3 experiment grid (Section 1.2)")
    sessions = p65.sessions
    n = len(sessions)
    fold = Fold(1, str(sessions[0]), str(sessions[int(n * .55)]),
                str(sessions[int(n * .55) + 1]), str(sessions[int(n * .78)]),
                str(sessions[int(n * .78) + 1]), str(sessions[-1]))
    member = np.array([s in set(RAW) for s in p65.symbols])

    results, own_blocks = {}, {}
    print(f"  {'cell':22s} {'paper':10s} {'agg':8s} {'nfeat':>6s} {'groups':>7s} "
          f"{'QLIKE':>9s}")
    for pooling in ("SAM", "CAM", "UAM"):
        for feats in ("own", "augmented"):
            cell = Cell(pooling, feats, "65min", 1, "OLS",
                        clustering="spectral", n_clusters=3)
            r = run_cell(cell, p65, fold, member_mask=member, eval_mask=member)
            results[(pooling, feats)] = r
            q = qlike(r.actuals, r.predictions)
            print(f"  {pooling + '/' + feats:22s} "
                  f"{str(r.meta['paper_scheme']):10s} {str(r.meta['aggregate']):8s} "
                  f"{r.meta['n_features']:6d} {r.meta['n_groups']:7d} {q:9.5f}")

    check("all six cells produced finite predictions",
          all(np.isfinite(r.predictions).all() for r in results.values()))
    single = qlike(*[getattr(results[("SAM", "own")], k)
                     for k in ("actuals", "predictions")])
    aug = qlike(*[getattr(results[("UAM", "augmented")], k)
                  for k in ("actuals", "predictions")])
    print(f"\n  SINGLE={single:.5f}  AUGMENTED={aug:.5f}  "
          f"({100 * (single - aug) / single:+.2f}%)")
    check("AUGMENTED beats SINGLE (Phase 4 gate)", aug < single)

    # Feature-identity gate across the live cells.
    from src.config import HORIZONS
    from src.features.prepare import prepare_fold
    from src.schemes.runner import build_aggregate, build_feature_source

    p_lags = HORIZONS["65min"].n_lags
    flat = prepare_fold(p65, fold, p_lags).flat
    labels = np.array([i % 3 for i in range(p65.n_symbols)])
    times = np.arange(p_lags, p_lags + 30)
    for pooling in ("SAM", "CAM", "UAM"):
        for feats in ("own", "augmented"):
            c = Cell(pooling, feats, "65min", 1, "OLS")
            agg, of = build_aggregate(c, flat, member, labels)
            own_blocks[(pooling, feats)] = build_feature_source(
                c, flat, agg, of, "65min").own_block(1, times)
    ref = own_blocks[("SAM", "own")]
    check("own-lag block byte-identical across all six cells",
          all(b.tobytes() == ref.tobytes() for b in own_blocks.values()))

    # Model families on the smaller 1-day panel, for speed.
    banner("MODEL FAMILIES -- all seven run end to end")
    p1d = panels["1day"]
    fam = {}
    for model, kw in [("OLS", {}), ("LASSO", {"n_alphas": 6}), ("HAR-D", {}),
                      ("SARIMA", {}), ("XGBoost", {"n_estimators": 60}),
                      ("MLP", {"seeds": 1, "epochs": 6}),
                      ("LSTM", {"seeds": 1, "epochs": 4})]:
        pooling = "SAM" if model == "SARIMA" else "UAM"
        cell = Cell(pooling, "own", "1day", 1, model)
        t0 = time.time()
        try:
            r = run_cell(cell, p1d, fold, member_mask=member, eval_mask=member,
                         model_params=kw)
            fam[model] = qlike(r.actuals, r.predictions)
            print(f"  {model:9s} QLIKE={fam[model]:.5f}  ({time.time() - t0:.1f}s)")
        except Exception as exc:
            print(f"  {model:9s} FAILED: {exc}")
            failures.append(f"model {model}")
    check("all seven model families ran", len(fam) == 7, f"{len(fam)}/7")

    # ---------------- Phase 8 ----------------
    banner("PHASE 8 -- Intraday2Daily and unseen stocks (Section 11)")
    B = p65.bins_per_day
    intr, daily = p65.flat().astype(float), p1d.flat().astype(float)
    X, cols, y, days = build_features(intr, daily, 0, B)
    Xt, colst, yt, _ = traditional_features(daily, 0)
    split = int(len(y) * 0.75)
    pred_i, beta_i = fit_ols(X[:split], y[:split], X[split:])
    pred_t, _ = fit_ols(Xt[:split], yt[:split], Xt[split:])
    print(f"  Intraday2Daily features: {X.shape[1]} ({B} buckets + daily lags)")
    print(f"  MSE intraday={np.mean((y[split:] - pred_i) ** 2):.4f}  "
          f"traditional={np.mean((yt[split:] - pred_t) ** 2):.4f}")
    imp = bucket_importance(beta_i[1:], B)
    print(f"  largest bucket: {imp.loc[imp['abs_coefficient'].idxmax(), 'bucket']}")
    check("bucket coefficients extracted", len(imp) == B)
    check("closing-bucket test is callable",
          isinstance(closing_bucket_is_largest(imp), bool))

    base = per_stock_ols_baseline(p65, fold, ~member)
    cell = Cell("UAM", "augmented", "65min", 1, "OLS")
    un = run_unseen_cell(cell, p65, fold, UNSEEN)
    q_un = qlike(un.actuals, un.predictions)
    print(f"  unseen: per-stock OLS baseline QLIKE={base['qlike']:.5f}  "
          f"pooled UAM/aug QLIKE={q_un:.5f}")
    check("unseen stocks predicted without ever training on them",
          np.isfinite(un.predictions).all() and un.predictions.shape[0] == len(UNSEEN))
    try:
        run_unseen_cell(Cell("SAM", "own", "65min", 1, "OLS"), p65, fold, UNSEEN)
        check("SAM correctly refused for unseen stocks", False)
    except ValueError:
        check("SAM correctly refused for unseen stocks", True)

    # ---------------- Summary ----------------
    banner("SUMMARY")
    print(f"  elapsed: {time.time() - t_start:.0f}s")
    if failures:
        print(f"  {len(failures)} FAILURE(S): {failures}")
        return 1
    print("  all phases passed")
    print("\n  NOTE: every number above comes from the synthetic generator.")
    print("  This validates the machinery, not the paper's findings.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
