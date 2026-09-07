"""The (pooling x features x horizon x fold x model) grid driver (spec Section 13).

The pooling axis controls *which stocks' rows enter the training set*; the
feature axis controls *what predictors each row carries*. Keeping them
genuinely orthogonal is the point of the CAM extension, and this module is
where that separation is realized:

* `training_groups` reads only the pooling axis;
* `build_feature_source` reads only the feature axis.

Neither can see the other's argument, so the pooling axis cannot leak into the
feature axis -- which is what makes the Section 15 feature-set identity gate
pass by construction.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from src.config import (
    HORIZONS, METRICS, PREDICTIONS, Cell, Fold,
)
from src.clustering.fit import ClusterAssignment, fit_clusters
from src.features.aggregates import cluster_rv, market_rv
from src.features.har import HARFeatureBuilder
from src.features.lags import LagBuilder
from src.features.prepare import PreparedFold, fit_scaler, prepare_fold
from src.models.base import ChunkSource
from src.models.linear import HARD, OLS, LassoGram, Ridge
from src.models.nn import LSTMModel, MLPModel
from src.models.sarima import SARIMA
from src.models.trees import SUBSAMPLE_FRACTION, XGBoostModel, stratified_time_subsample

log = logging.getLogger(__name__)

MODEL_REGISTRY = {
    "OLS": OLS, "Ridge": Ridge, "LASSO": LassoGram, "HAR-D": HARD,
    "SARIMA": SARIMA, "XGBoost": XGBoostModel, "MLP": MLPModel,
    "LSTM": LSTMModel,
}


def training_groups(
    pooling: str, n_symbols: int, labels: np.ndarray | None,
    member_mask: np.ndarray,
) -> dict[int, np.ndarray]:
    """Which symbols' rows train each model. Reads the pooling axis ONLY.

    * SAM -- one model per stock, trained on that stock alone.
    * CAM -- one model per cluster, trained on that cluster's members.
    * UAM -- a single model trained on every member stock.

    Only `member_mask` symbols ever contribute training rows, so unseen stocks
    cannot enter any training set.
    """
    members = np.where(member_mask)[0]
    if pooling == "SAM":
        return {int(i): np.array([i]) for i in members}
    if pooling == "UAM":
        return {0: members}
    if pooling == "CAM":
        if labels is None:
            raise ValueError("CAM requires cluster labels")
        out = {}
        for c in np.unique(labels[member_mask]):
            if c < 0:
                continue
            out[int(c)] = np.where((labels == c) & member_mask)[0]
        return out
    raise ValueError(f"unknown pooling {pooling!r}")


def evaluation_groups(
    pooling: str, eval_symbols: np.ndarray, labels: np.ndarray | None,
    groups: dict[int, np.ndarray],
) -> dict[int, np.ndarray]:
    """Which symbols each fitted model is asked to predict."""
    if pooling == "SAM":
        return {int(i): np.array([i]) for i in eval_symbols if int(i) in groups}
    if pooling == "UAM":
        return {0: eval_symbols}
    out: dict[int, list[int]] = {g: [] for g in groups}
    for i in eval_symbols:
        c = int(labels[i])
        if c in out:
            out[c].append(int(i))
    return {g: np.array(v) for g, v in out.items() if len(v)}


def build_aggregate(
    cell: Cell, flat: np.ndarray, member_mask: np.ndarray,
    labels: np.ndarray | None, weights: np.ndarray | None = None,
):
    """Aggregate series for augmented cells. Reads the feature axis ONLY."""
    if cell.features != "augmented":
        return None, None
    if cell.aggregate == "cluster":
        if labels is None:
            raise ValueError("CAM-augmented requires cluster labels")
        return cluster_rv(flat, labels, member_mask)
    return market_rv(flat, member_mask, weights), None


def build_feature_source(cell: Cell, flat, agg, agg_of_symbol, horizon: str):
    """Feature builder for the cell. HAR-D gets its own compact block."""
    p = HORIZONS[horizon].n_lags
    if cell.model == "HAR-D":
        return HARFeatureBuilder(flat, p, HORIZONS[horizon].bins_per_day,
                                 agg, agg_of_symbol)
    return LagBuilder(flat, p, agg, agg_of_symbol)


@dataclass
class CellResult:
    cell: Cell
    predictions: np.ndarray          # (n_eval_symbols, n_test_times)
    actuals: np.ndarray
    eval_symbols: list[str]
    test_times: np.ndarray
    meta: dict = field(default_factory=dict)

    def save(self, directory: Path | None = None) -> Path:
        d = Path(directory or PREDICTIONS)
        d.mkdir(parents=True, exist_ok=True)
        stem = d / self.cell.key()
        np.savez_compressed(
            stem.with_suffix(".npz"), predictions=self.predictions,
            actuals=self.actuals, test_times=self.test_times,
        )
        stem.with_suffix(".json").write_text(json.dumps({
            "cell": {k: v for k, v in self.cell.__dict__.items()},
            "config_hash": self.cell.config_hash(),
            "eval_symbols": self.eval_symbols,
            "meta": self.meta,
        }, indent=2, default=str))
        return stem.with_suffix(".npz")

    @classmethod
    def cached(cls, cell: Cell, directory: Path | None = None) -> bool:
        d = Path(directory or PREDICTIONS)
        js = (d / cell.key()).with_suffix(".json")
        if not js.exists():
            return False
        try:
            return json.loads(js.read_text()).get("config_hash") == cell.config_hash()
        except Exception:
            return False


def _model_params(cell: Cell, horizon: str, prepared, extra: dict) -> dict:
    p = dict(extra)
    if cell.model in ("MLP", "LSTM"):
        p.setdefault("seeds", cell.seeds)
        p.setdefault("bins_per_day", HORIZONS[horizon].bins_per_day)
    return p


def run_cell(
    cell: Cell,
    panel,
    fold: Fold,
    member_mask: np.ndarray | None = None,
    eval_mask: np.ndarray | None = None,
    assignment: ClusterAssignment | None = None,
    model_params: dict | None = None,
    use_cache: bool = True,
    scale_features: bool = True,
) -> CellResult:
    """Fit and evaluate one grid cell end to end."""
    t0 = time.time()
    horizon = cell.horizon
    p = HORIZONS[horizon].n_lags
    n_sym = panel.n_symbols

    member_mask = (np.ones(n_sym, dtype=bool) if member_mask is None
                   else np.asarray(member_mask, dtype=bool))
    eval_mask = member_mask if eval_mask is None else np.asarray(eval_mask, dtype=bool)

    prepared: PreparedFold = prepare_fold(panel, fold, p)
    split = prepared.split
    flat = prepared.flat

    labels = None
    if cell.pooling == "CAM":
        if assignment is None:
            assignment = fit_clusters(
                flat, panel.symbols, split.train, method=cell.clustering,
                k=cell.n_clusters, horizon=horizon, fold=fold.index,
                member_mask=member_mask,
            )
        labels = assignment.labels

    agg, agg_of_symbol = build_aggregate(cell, flat, member_mask, labels)
    builder = build_feature_source(cell, flat, agg, agg_of_symbol, horizon)

    groups = training_groups(cell.pooling, n_sym, labels, member_mask)
    eval_groups = evaluation_groups(
        cell.pooling, np.where(eval_mask)[0], labels, groups
    )

    train_times = split.train
    if cell.model == "XGBoost":
        frac = SUBSAMPLE_FRACTION.get(horizon, 1.0)
        train_times = stratified_time_subsample(
            train_times, HORIZONS[horizon].bins_per_day, frac,
            seed=cell.extra.get("seed", 0),
        )

    cls = MODEL_REGISTRY[cell.model]
    params = _model_params(cell, horizon, prepared, model_params or {})

    n_eval = int(eval_mask.sum())
    eval_index = {int(s): k for k, s in enumerate(np.where(eval_mask)[0])}
    preds = np.full((n_eval, split.test.size), np.nan)
    actuals = np.full((n_eval, split.test.size), np.nan)
    group_meta = {}

    for gid, train_syms in groups.items():
        targets = eval_groups.get(gid)
        if targets is None or targets.size == 0:
            continue
        model = cls(**params)

        use_val = getattr(cls, "uses_validation", True)
        fit_times = train_times if use_val else np.concatenate(
            [train_times, split.val]
        )
        train_src = ChunkSource(builder, train_syms, fit_times)
        val_src = ChunkSource(builder, train_syms, split.val) if use_val else None

        if scale_features and cell.model == "MLP":
            # Per-feature standardization (spec Section 5.2), fitted on this
            # cell's training rows only. The LSTM instead uses the scalar
            # normalizer it builds itself, since its input is a
            # (21, bins_per_day) tensor of one variable.
            model = cls(**{**params,
                           "scaler": fit_scaler(builder, train_syms, fit_times)})

        model.fit(train_src, val_src)
        test_src = ChunkSource(builder, targets, split.test)
        yhat = model.predict(test_src)

        # ChunkSource iterates symbol-major, so predictions reshape cleanly.
        yhat = yhat.reshape(targets.size, split.test.size)
        for k, s in enumerate(targets):
            row = eval_index[int(s)]
            preds[row] = yhat[k]
            actuals[row] = builder.targets(int(s), split.test)
        group_meta[str(gid)] = {"n_train_symbols": int(train_syms.size),
                                **{k: v for k, v in model.meta_.items()
                                   if isinstance(v, (int, float, str, list))}}

    result = CellResult(
        cell=cell, predictions=preds, actuals=actuals,
        eval_symbols=[panel.symbols[i] for i in np.where(eval_mask)[0]],
        test_times=split.test,
        meta={
            "fold": fold.index, "horizon": horizon, "pooling": cell.pooling,
            "features": cell.features, "model": cell.model,
            "paper_scheme": cell.paper_scheme, "aggregate": cell.aggregate,
            "n_groups": len(groups), "n_features": builder.n_features,
            "split": split.summary(), "winsor": prepared.provenance,
            "clusters": assignment.as_dict() if assignment else None,
            "groups": group_meta,
            "train_times_used": int(train_times.size),
            "elapsed_seconds": round(time.time() - t0, 2),
        },
    )
    log.info("cell %s done in %.1fs (%d groups, %d features)",
             cell.key(), time.time() - t0, len(groups), builder.n_features)
    return result
