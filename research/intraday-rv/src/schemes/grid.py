"""Grid driver: run many cells, assemble the paper's tables (spec Sections 10, 13).

Caching is at every level (spec Section 12.3): each cell's predictions are
written with a manifest recording the config hash that produced them, so a
re-run skips anything already computed under an identical configuration. The
build gets re-run many times; nothing expensive should ever be recomputed.
"""

from __future__ import annotations

import itertools
import json
import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import (
    FEATURE_SETS, FOLDS, HORIZONS, METRICS, POOLINGS, PREDICTIONS,
    SAM_ONLY_MODELS, TABLES, Cell, Fold,
)
from src.eval.dm import pairwise_table
from src.eval.losses import mse, qlike
from src.eval.mcs import model_confidence_set
from src.eval.utility import realized_utility, realized_utility_tc
from src.schemes.runner import CellResult, run_cell

log = logging.getLogger(__name__)


def build_grid(
    models: list[str], horizons: list[str], folds: list[int],
    poolings: list[str] | None = None, features: list[str] | None = None,
    **cell_kw,
) -> list[Cell]:
    """Every valid (pooling x features x horizon x fold x model) combination."""
    cells = []
    for model, pooling, feat, horizon, fold in itertools.product(
        models, poolings or POOLINGS, features or FEATURE_SETS, horizons, folds
    ):
        if model in SAM_ONLY_MODELS and pooling != "SAM":
            continue
        cells.append(Cell(pooling, feat, horizon, fold, model, **cell_kw))
    return cells


def run_grid(
    cells: list[Cell], panels: dict, folds: dict[int, Fold],
    member_mask=None, eval_mask=None, model_params: dict | None = None,
    use_cache: bool = True, out_dir: Path | None = None,
) -> dict[str, CellResult]:
    """Run every cell, skipping any already cached under the same config hash."""
    out_dir = Path(out_dir or PREDICTIONS)
    results: dict[str, CellResult] = {}
    for i, cell in enumerate(cells, 1):
        key = cell.key()
        if use_cache and CellResult.cached(cell, out_dir):
            log.info("[%d/%d] %s cached; skipping", i, len(cells), key)
            continue
        t0 = time.time()
        try:
            res = run_cell(
                cell, panels[cell.horizon], folds[cell.fold],
                member_mask=member_mask, eval_mask=eval_mask,
                model_params=(model_params or {}).get(cell.model, {}),
            )
        except Exception as exc:
            log.exception("[%d/%d] %s FAILED: %s", i, len(cells), key, exc)
            continue
        res.save(out_dir)
        results[key] = res
        log.info("[%d/%d] %s done in %.1fs", i, len(cells), key, time.time() - t0)
    return results


def load_result(cell: Cell, directory: Path | None = None) -> CellResult | None:
    d = Path(directory or PREDICTIONS)
    npz, js = (d / cell.key()).with_suffix(".npz"), (d / cell.key()).with_suffix(".json")
    if not (npz.exists() and js.exists()):
        return None
    z = np.load(npz)
    meta = json.loads(js.read_text())
    return CellResult(cell, z["predictions"], z["actuals"],
                      meta["eval_symbols"], z["test_times"], meta["meta"])


def metrics_row(res: CellResult, spread: np.ndarray | None = None) -> dict:
    """MSE, QLIKE, RU and (if a spread is supplied) RU-TC for one cell."""
    a, p = res.actuals, res.predictions
    ok = np.isfinite(a) & np.isfinite(p)
    if not ok.all():
        keep = ok.all(axis=0)
        a, p = a[:, keep], p[:, keep]
    row = {
        "model": res.cell.model, "pooling": res.cell.pooling,
        "features": res.cell.features, "paper_scheme": res.cell.paper_scheme,
        "horizon": res.cell.horizon, "fold": res.cell.fold,
        "n_features": res.meta.get("n_features"),
        "mse": mse(a, p), "qlike": qlike(a, p), "ru": realized_utility(a, p),
    }
    if spread is not None:
        row["ru_tc"] = realized_utility_tc(a, p, spread)
    return row


def results_table(results: dict[str, CellResult],
                  spread: np.ndarray | None = None) -> pd.DataFrame:
    return pd.DataFrame([metrics_row(r, spread) for r in results.values()])


def mark_mcs(
    results: dict[str, CellResult], horizon: str, fold: int,
    loss: str = "qlike", alpha: float = 0.05, n_boot: int = 1000,
) -> dict:
    """Run MCS across all cells sharing a horizon and fold."""
    sel = {k: r for k, r in results.items()
           if r.cell.horizon == horizon and r.cell.fold == fold}
    if len(sel) < 2:
        return {}
    ref = next(iter(sel.values()))
    preds = {k: r.predictions for k, r in sel.items()}
    return model_confidence_set(ref.actuals, preds, loss, alpha, n_boot)


def dm_matrix(results: dict[str, CellResult], horizon: str, fold: int,
              loss: str = "qlike"):
    """Pairwise modified-DM table for one horizon and fold (paper Appendix C)."""
    sel = {k: r for k, r in results.items()
           if r.cell.horizon == horizon and r.cell.fold == fold}
    if len(sel) < 2:
        return None, None
    ref = next(iter(sel.values()))
    return pairwise_table(ref.actuals, {k: r.predictions for k, r in sel.items()},
                          loss)


def headline_table(results: dict[str, CellResult],
                   spread: np.ndarray | None = None) -> pd.DataFrame:
    """The 2x3 grid the extension exists to report, averaged over folds.

    Rows are model families, columns are the six (pooling x features) cells.
    The three cells the paper ran are labelled with their paper scheme name;
    the three new ones are labelled by their (pooling, features) pair.
    """
    df = results_table(results, spread)
    if df.empty:
        return df
    df["cell"] = df.apply(
        lambda r: r["paper_scheme"] or f"{r['pooling']}/{r['features']}", axis=1
    )
    return df.pivot_table(index=["horizon", "model"], columns="cell",
                          values="qlike", aggfunc="mean")


def save_tables(results: dict[str, CellResult], out_dir: Path | None = None,
                spread: np.ndarray | None = None) -> dict[str, Path]:
    d = Path(out_dir or TABLES)
    d.mkdir(parents=True, exist_ok=True)
    written = {}
    full = results_table(results, spread)
    full.to_csv(d / "all_cells.csv", index=False)
    written["all_cells"] = d / "all_cells.csv"
    head = headline_table(results, spread)
    if not head.empty:
        head.to_csv(d / "headline_qlike.csv")
        written["headline"] = d / "headline_qlike.csv"
    for horizon in sorted({r.cell.horizon for r in results.values()}):
        for fold in sorted({r.cell.fold for r in results.values()}):
            stat, _ = dm_matrix(results, horizon, fold)
            if stat is not None:
                path = d / f"dm_{horizon}_f{fold}.csv"
                stat.to_csv(path)
                written[f"dm_{horizon}_f{fold}"] = path
    return written
