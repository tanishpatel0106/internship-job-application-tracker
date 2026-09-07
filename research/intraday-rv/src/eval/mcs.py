"""Model Confidence Set, Hansen, Lunde & Nason (2011) (spec Section 10.3).

`arch.bootstrap.MCS` is used when available. A self-contained implementation is
kept as a fallback so the harness never silently skips MCS marking, and so the
two can be cross-checked against each other.

Consistent with the modified DM test, MCS is run on the *cross-sectionally
averaged* loss series: one column per model, one row per date.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from src.eval.losses import ELEMENTWISE

log = logging.getLogger(__name__)


@dataclass
class MCSResult:
    included: list[str]
    pvalues: dict[str, float]
    alpha: float
    method: str
    eliminated_order: list[str] = field(default_factory=list)

    def mark(self, name: str) -> str:
        """Superscript marker for results tables."""
        return "*" if name in self.included else ""


def cross_sectional_losses(
    actual: np.ndarray, preds: dict[str, np.ndarray], loss: str = "qlike",
) -> pd.DataFrame:
    """`(n_dates, n_models)` frame of cross-sectionally averaged losses."""
    fn = ELEMENTWISE[loss]
    return pd.DataFrame({
        name: fn(actual, p).mean(axis=0) for name, p in preds.items()
    })


def _mcs_arch(losses: pd.DataFrame, alpha: float, n_boot: int,
              block_size: int | None, seed: int) -> MCSResult | None:
    try:
        from arch.bootstrap import MCS
    except ImportError:
        return None
    try:
        mcs = MCS(losses, size=alpha, reps=n_boot, block_size=block_size,
                  method="R", seed=seed)
        mcs.compute()
        pvals = mcs.pvalues["Pvalue"].to_dict()
        included = list(mcs.included)
        excluded = list(mcs.excluded)
        return MCSResult(included, {k: float(v) for k, v in pvals.items()},
                         alpha, "arch", excluded)
    except Exception as exc:  # pragma: no cover - depends on arch internals
        log.warning("arch MCS failed (%s); falling back to the local implementation", exc)
        return None


def _mcs_local(losses: pd.DataFrame, alpha: float, n_boot: int,
               block_size: int | None, seed: int) -> MCSResult:
    """Range-statistic MCS with a stationary block bootstrap.

    Iteratively: bootstrap the t-statistics of all pairwise mean loss
    differences, form the range statistic T_R = max |t_ij|, compare against its
    bootstrap distribution, and eliminate the worst model until the null of
    equal predictive ability is no longer rejected.
    """
    rng = np.random.default_rng(seed)
    L = losses.to_numpy(dtype=np.float64)
    n, m = L.shape
    names = list(losses.columns)
    block = block_size or max(1, int(round(n ** (1.0 / 3.0))))

    # Shared bootstrap index set, so every elimination round is comparable.
    idx = np.empty((n_boot, n), dtype=np.int64)
    for b in range(n_boot):
        pos, out = 0, np.empty(n, dtype=np.int64)
        while pos < n:
            start = rng.integers(0, n)
            take = min(block, n - pos)
            out[pos:pos + take] = (start + np.arange(take)) % n
            pos += take
        idx[b] = out

    alive = list(range(m))
    pvals: dict[str, float] = {}
    eliminated: list[str] = []

    while len(alive) > 1:
        sub = L[:, alive]
        k = len(alive)
        dbar = sub.mean(axis=0)
        # Pairwise mean differences and their bootstrap standard errors.
        dij = dbar[:, None] - dbar[None, :]
        boot_means = np.stack([sub[idx[b]].mean(axis=0) for b in range(n_boot)])
        boot_dij = boot_means[:, :, None] - boot_means[:, None, :]
        var_ij = boot_dij.var(axis=0, ddof=1)
        se = np.sqrt(np.maximum(var_ij, 1e-300))
        np.fill_diagonal(se, np.inf)

        t_obs = np.abs(dij) / se
        TR = float(np.nanmax(t_obs))
        centred = np.abs(boot_dij - dij[None, :, :]) / se[None, :, :]
        TR_boot = np.nanmax(centred.reshape(n_boot, -1), axis=1)
        p = float((TR_boot >= TR).mean())

        for i in alive:
            pvals[names[i]] = max(p, pvals.get(names[i], 0.0))

        if p >= alpha:
            break
        # Eliminate the model with the largest standardised excess loss.
        t_elim = (dij / se).max(axis=1)
        worst = int(np.argmax(t_elim))
        eliminated.append(names[alive[worst]])
        alive.pop(worst)

    for i in alive:
        pvals.setdefault(names[i], 1.0)
    return MCSResult([names[i] for i in alive], pvals, alpha, "local", eliminated)


def model_confidence_set(
    actual: np.ndarray,
    preds: dict[str, np.ndarray],
    loss: str = "qlike",
    alpha: float = 0.05,
    n_boot: int = 1000,
    block_size: int | None = None,
    seed: int = 0,
    prefer: str = "arch",
) -> MCSResult:
    """MCS at the `alpha` level over the cross-sectionally averaged losses."""
    losses = cross_sectional_losses(actual, preds, loss)
    if losses.shape[1] < 2:
        name = list(preds)[0]
        return MCSResult([name], {name: 1.0}, alpha, "trivial")
    if prefer == "arch":
        res = _mcs_arch(losses, alpha, n_boot, block_size, seed)
        if res is not None:
            return res
    return _mcs_local(losses, alpha, n_boot, block_size, seed)
