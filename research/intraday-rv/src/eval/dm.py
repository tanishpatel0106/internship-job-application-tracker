"""Modified Diebold-Mariano test (spec Section 10.2).

Following Gu, Kelly & Xiu, the loss differential is averaged
*cross-sectionally first*, and the DM test is then run on the resulting scalar
time series:

    d_t^(a-b) = (1/N) sum_i [ L(e_{i,t}^a) - L(e_{i,t}^b) ]

This is NOT per-asset DM. Running DM per asset and pooling the statistics
would badly overstate significance, because forecast errors are strongly
cross-sectionally correlated -- which is precisely the commonality this paper
is about.

The standard error is Newey-West with the Bartlett kernel; the default
bandwidth is the Newey-West plug-in rule floor(4*(T/100)^(2/9)).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import stats

from src.eval.losses import ELEMENTWISE


@dataclass
class DMResult:
    stat: float
    pvalue: float
    mean_diff: float
    n_obs: int
    lag: int
    better: str          # "a", "b", or "tie"
    loss: str

    def stars(self, levels=(0.01, 0.05, 0.10)) -> str:
        for k, lv in enumerate(levels):
            if self.pvalue < lv:
                return "*" * (len(levels) - k)
        return ""


def nw_bandwidth(n: int) -> int:
    """Newey-West plug-in lag: floor(4 * (T/100)^(2/9))."""
    return max(0, int(np.floor(4.0 * (n / 100.0) ** (2.0 / 9.0))))


def newey_west_var(d: np.ndarray, lag: int | None = None) -> float:
    """Long-run variance of the mean of `d` under a Bartlett kernel."""
    d = np.asarray(d, dtype=np.float64)
    n = d.size
    if n < 2:
        raise ValueError("need at least two observations")
    lag = nw_bandwidth(n) if lag is None else lag
    e = d - d.mean()
    gamma0 = float(e @ e) / n
    total = gamma0
    for k in range(1, lag + 1):
        if k >= n:
            break
        gk = float(e[k:] @ e[:-k]) / n
        total += 2.0 * (1.0 - k / (lag + 1.0)) * gk
    # A negative long-run variance is possible in finite samples; fall back to
    # the contemporaneous variance rather than returning a nan statistic.
    return total if total > 0 else gamma0


def cross_sectional_differential(
    actual: np.ndarray, pred_a: np.ndarray, pred_b: np.ndarray,
    loss: str = "qlike",
) -> np.ndarray:
    """d_t: the loss differential averaged across stocks at each date."""
    fn = ELEMENTWISE[loss]
    la, lb = fn(actual, pred_a), fn(actual, pred_b)
    return (la - lb).mean(axis=0)


def diebold_mariano(
    actual: np.ndarray, pred_a: np.ndarray, pred_b: np.ndarray,
    loss: str = "qlike", lag: int | None = None,
) -> DMResult:
    """Modified DM. A *negative* statistic means model `a` has the lower loss."""
    d = cross_sectional_differential(actual, pred_a, pred_b, loss)
    n = d.size
    lag = nw_bandwidth(n) if lag is None else lag
    lrv = newey_west_var(d, lag)
    se = np.sqrt(lrv / n)
    mean_d = float(d.mean())
    stat = mean_d / se if se > 0 else 0.0
    # Small-sample t reference distribution, as is standard for DM.
    pval = float(2.0 * stats.t.sf(abs(stat), df=max(1, n - 1)))
    if pval < 0.10:
        better = "a" if mean_d < 0 else "b"
    else:
        better = "tie"
    return DMResult(float(stat), pval, mean_d, n, lag, better, loss)


def pairwise_table(
    actual: np.ndarray, preds: dict[str, np.ndarray],
    loss: str = "qlike", lag: int | None = None,
):
    """Full pairwise DM matrix, as in the paper's Appendix C.

    Entry (row, col) is the DM statistic for `row` versus `col`; negative means
    the row model is more accurate.
    """
    import pandas as pd

    names = list(preds)
    stat = pd.DataFrame(np.nan, index=names, columns=names, dtype=float)
    pval = pd.DataFrame(np.nan, index=names, columns=names, dtype=float)
    for i, a in enumerate(names):
        for j, b in enumerate(names):
            if i == j:
                continue
            r = diebold_mariano(actual, preds[a], preds[b], loss, lag)
            stat.loc[a, b] = r.stat
            pval.loc[a, b] = r.pvalue
    return stat, pval
