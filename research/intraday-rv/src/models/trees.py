"""XGBoost (spec Sections 5, 12.1).

XGBoost is the awkward family: it needs its data resident, and even a binned
`QuantileDMatrix` at 10-min UAM is ~9 GB. Two things keep it feasible.

1. The `QuantileDMatrix` is built directly from the chunk iterator through
   XGBoost's `DataIter` protocol, so the float32 design matrix is never
   materialized -- only the uint8 binned form is held.
2. Spec DECISION: rows are subsampled to 20% at the 10-min and 30-min horizons,
   *stratified by stock and bin-of-day*. Stratification matters here: intraday
   RV has a strong diurnal profile, so a plain random subsample would leave
   some buckets-of-day materially thinner than others. Recorded as a deviation.
"""

from __future__ import annotations

import logging

import numpy as np

from src.models.base import ChunkSource, Model

log = logging.getLogger(__name__)

#: Spec Section 12.1 DECISION: subsample fraction by horizon.
SUBSAMPLE_FRACTION = {"10min": 0.20, "30min": 0.20, "65min": 1.0, "1day": 1.0}


def stratified_time_subsample(
    times: np.ndarray, bins_per_day: int, fraction: float, seed: int = 0,
) -> np.ndarray:
    """Subsample target times, stratified by bin-of-day.

    Because the same time grid is used for every stock, stratifying the *times*
    by bin-of-day yields a sample that is exactly stratified by (stock,
    bin-of-day) jointly, which is what the spec asks for.
    """
    t = np.asarray(times, dtype=np.int64)
    if fraction >= 1.0:
        return t
    rng = np.random.default_rng(seed)
    bod = t % bins_per_day
    keep = []
    for b in np.unique(bod):
        grp = t[bod == b]
        k = max(1, int(round(fraction * grp.size)))
        keep.append(rng.choice(grp, size=k, replace=False))
    return np.sort(np.concatenate(keep))


class _ChunkIter:
    """Adapts a `ChunkSource` to XGBoost's external-memory `DataIter`."""

    def __init__(self, source: ChunkSource):
        import xgboost as xgb

        self._source = source
        self._it = None

        class _Iter(xgb.core.DataIter):
            def __init__(inner):
                super().__init__()
                inner._gen = None

            def reset(inner):
                inner._gen = iter(source)

            def next(inner, input_data):
                if inner._gen is None:
                    inner.reset()
                try:
                    X, y, _, _ = next(inner._gen)
                except StopIteration:
                    return 0
                input_data(data=np.asarray(X, dtype=np.float32),
                           label=np.asarray(y, dtype=np.float32))
                return 1

        self.iterator = _Iter()


class XGBoostModel(Model):
    """Gradient-boosted trees. Hyperparameters are the paper's Appendix B."""

    name = "XGBoost"
    uses_validation = True

    def _fit(self, train: ChunkSource, val: ChunkSource | None) -> None:
        import xgboost as xgb

        params = {
            "objective": "reg:squarederror",
            "learning_rate": self.params.get("learning_rate", 0.1),
            "max_depth": self.params.get("max_depth", 10),
            "tree_method": "hist",
            "nthread": self.params.get("nthread", 0),
            "seed": self.params.get("seed", 0),
        }
        n_rounds = self.params.get("n_estimators", 2000)
        early = self.params.get("early_stopping_rounds", 10)

        dtrain = xgb.QuantileDMatrix(_ChunkIter(train).iterator)
        evals = [(dtrain, "train")]
        if val is not None and len(val) > 0:
            dval = xgb.QuantileDMatrix(_ChunkIter(val).iterator, ref=dtrain)
            evals.append((dval, "val"))

        self.booster_ = xgb.train(
            params, dtrain, num_boost_round=n_rounds, evals=evals,
            early_stopping_rounds=early if len(evals) > 1 else None,
            verbose_eval=False,
        )
        self.meta_ = {
            "best_iteration": int(getattr(self.booster_, "best_iteration", n_rounds)),
            "n_train_rows": len(train),
            "n_features": train.n_features,
            "params": params,
        }
        log.info("XGBoost: %d rounds used (of %d), %d train rows",
                 self.meta_["best_iteration"], n_rounds, len(train))

    def _predict(self, source: ChunkSource) -> np.ndarray:
        import xgboost as xgb

        best = getattr(self.booster_, "best_iteration", None)
        rng = (0, best + 1) if best is not None else None
        out = []
        for X, _, _, _ in source:
            d = xgb.DMatrix(np.asarray(X, dtype=np.float32))
            out.append(self.booster_.predict(d, iteration_range=rng))
        return np.concatenate(out) if out else np.empty(0)

    def importance(self, source: ChunkSource | None = None) -> np.ndarray | None:
        """Finite-difference sensitivity, the same definition as the NNs.

        XGBoost's own `gain` is a *different* quantity and is not comparable
        across families, so the summed-absolute-partial-derivative definition
        of Section 10.5 is used for every non-linear model alike.
        """
        if source is None:
            return None
        from src.eval.importance import finite_difference_importance

        Xs = []
        for chunk, _, _, _ in source:
            Xs.append(chunk)
            if sum(c.shape[0] for c in Xs) >= 2000:
                break
        Xc = np.vstack(Xs)[:2000]
        return finite_difference_importance(
            lambda Z: self._predict_dense(Z), Xc, eps=1e-3
        )

    def _predict_dense(self, X: np.ndarray) -> np.ndarray:
        import xgboost as xgb

        best = getattr(self.booster_, "best_iteration", None)
        rng = (0, best + 1) if best is not None else None
        return self.booster_.predict(
            xgb.DMatrix(np.asarray(X, dtype=np.float32)), iteration_range=rng
        )
