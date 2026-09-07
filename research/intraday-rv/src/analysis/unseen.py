"""Unseen-stock generalization (spec Section 11.1).

Models are trained and validated on the 93 raw stocks only, then asked to
predict the 16 unseen stocks. The baseline is OLS fitted separately on each
unseen stock's *own* history -- the best a per-stock modeller could do without
the pooled panel.

Two structural points:

* SAM/SINGLE cannot be applied to unseen stocks by construction: there is no
  trained per-stock model for a stock that was never in training. That row is
  omitted rather than faked.
* CAM requires the Section 6.4 assignment rule, which uses the unseen stock's
  training-window history and never its test data or realized target.

Expected result: neural nets trained on pooled raw stocks beat the per-stock
OLS baseline at intraday horizons -- the "universal volatility mechanism".
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from src.clustering.assign import assign_unseen
from src.clustering.fit import fit_clusters
from src.config import HORIZONS, Cell, Fold
from src.eval.losses import mse, qlike
from src.features.lags import LagBuilder
from src.features.prepare import prepare_fold
from src.models.base import ChunkSource
from src.models.linear import OLS
from src.schemes.runner import run_cell

log = logging.getLogger(__name__)


def masks(panel, unseen_symbols: list[str]) -> tuple[np.ndarray, np.ndarray]:
    """`(member_mask, unseen_mask)` over the panel's symbol axis."""
    unseen = set(unseen_symbols)
    um = np.array([s in unseen for s in panel.symbols], dtype=bool)
    return ~um, um


def per_stock_ols_baseline(panel, fold: Fold, unseen_mask: np.ndarray) -> dict:
    """OLS fitted on each unseen stock's own history (the baseline to beat)."""
    p = HORIZONS[panel.horizon].n_lags
    prepared = prepare_fold(panel, fold, p)
    split = prepared.split
    builder = LagBuilder(prepared.flat, p)

    idx = np.where(unseen_mask)[0]
    preds = np.full((idx.size, split.test.size), np.nan)
    actuals = np.full((idx.size, split.test.size), np.nan)
    for k, i in enumerate(idx):
        model = OLS().fit(
            ChunkSource(builder, np.array([i]), split.train_val)
        )
        preds[k] = model.predict(ChunkSource(builder, np.array([i]), split.test))
        actuals[k] = builder.targets(int(i), split.test)
    return {
        "predictions": preds, "actuals": actuals,
        "symbols": [panel.symbols[i] for i in idx],
        "qlike": qlike(actuals, preds), "mse": mse(actuals, preds),
    }


def run_unseen_cell(
    cell: Cell, panel, fold: Fold, unseen_symbols: list[str],
    model_params: dict | None = None,
):
    """Train on raw stocks only; evaluate on the unseen stocks."""
    if cell.pooling == "SAM":
        raise ValueError(
            "SAM cannot be applied to unseen stocks by construction "
            "(no per-stock model exists); omit this row"
        )
    member, unseen = masks(panel, unseen_symbols)

    assignment = None
    if cell.pooling == "CAM":
        p = HORIZONS[panel.horizon].n_lags
        prepared = prepare_fold(panel, fold, p)
        assignment = fit_clusters(
            prepared.flat, panel.symbols, prepared.split.train,
            method=cell.clustering, k=cell.n_clusters, horizon=panel.horizon,
            fold=fold.index, member_mask=member,
        )
        labels, diag = assign_unseen(
            prepared.flat, assignment, prepared.split.train, unseen, member
        )
        assignment.labels = labels
        assignment.extra["unseen_assignment"] = diag

    return run_cell(cell, panel, fold, member_mask=member, eval_mask=unseen,
                    assignment=assignment, model_params=model_params)


def comparison_table(
    panel, fold: Fold, unseen_symbols: list[str],
    models: list[str] | None = None,
    poolings: list[str] | None = None,
    features: list[str] | None = None,
    model_params: dict | None = None,
) -> pd.DataFrame:
    """Full unseen-stock table, including the per-stock OLS baseline row."""
    _, unseen = masks(panel, unseen_symbols)
    base = per_stock_ols_baseline(panel, fold, unseen)
    rows = [{
        "model": "OLS (per-stock, own history)", "pooling": "baseline",
        "features": "own", "qlike": base["qlike"], "mse": base["mse"],
        "n_train_symbols": 1,
    }]

    for model in (models or ["OLS", "MLP"]):
        for pooling in (poolings or ["UAM", "CAM"]):
            for feat in (features or ["own", "augmented"]):
                cell = Cell(pooling, feat, panel.horizon, fold.index, model)
                try:
                    res = run_unseen_cell(cell, panel, fold, unseen_symbols,
                                          model_params)
                except Exception as exc:
                    log.warning("unseen cell %s failed: %s", cell.key(), exc)
                    continue
                rows.append({
                    "model": model, "pooling": pooling, "features": feat,
                    "qlike": qlike(res.actuals, res.predictions),
                    "mse": mse(res.actuals, res.predictions),
                    "n_train_symbols": int((~unseen).sum()),
                })

    df = pd.DataFrame(rows)
    b = float(df.loc[0, "qlike"])
    df["vs_baseline_pct"] = 100.0 * (b - df["qlike"]) / b
    df["beats_baseline"] = df["qlike"] < b
    return df
