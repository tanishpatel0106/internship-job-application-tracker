"""MSE and QLIKE (spec Section 10.1).

QLIKE is the single most common silent failure in replications of this paper,
because it is evaluated on *log* RV inputs but exponentiates back out of log
space:

    QLIKE = exp(RV) / exp(RVhat) - (RV - RVhat) - 1

A perfect forecast gives exactly 1 - 0 - 1 = 0. That identity is asserted in
`tests/test_losses.py`, not merely assumed.

Both losses average over time within a stock first, then across stocks, which
is the order the paper's formulas specify. With a balanced panel this is the
same as a flat mean; with an unbalanced one it is not, and equal weight per
*stock* is what the paper intends.
"""

from __future__ import annotations

import numpy as np


def _as_2d(actual: np.ndarray, pred: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Coerce to `(n_stocks, n_times)`; a 1-D pair is treated as one stock."""
    a = np.asarray(actual, dtype=np.float64)
    p = np.asarray(pred, dtype=np.float64)
    if a.shape != p.shape:
        raise ValueError(f"shape mismatch: actual {a.shape} vs pred {p.shape}")
    if a.ndim == 1:
        a, p = a[None, :], p[None, :]
    if a.ndim != 2:
        raise ValueError(f"expected 1-D or 2-D arrays, got {a.ndim}-D")
    return a, p


def squared_error(actual: np.ndarray, pred: np.ndarray) -> np.ndarray:
    """Elementwise squared error on log RV."""
    a, p = _as_2d(actual, pred)
    return (a - p) ** 2


def qlike_elementwise(actual: np.ndarray, pred: np.ndarray) -> np.ndarray:
    """Elementwise QLIKE on log-RV inputs.

    `exp(a - p)` is used rather than `exp(a) / exp(p)` so that large log-RV
    values cannot overflow to inf/inf; the two are algebraically identical.
    """
    a, p = _as_2d(actual, pred)
    d = a - p
    return np.exp(d) - d - 1.0


def mse(actual: np.ndarray, pred: np.ndarray) -> float:
    """Mean over time within stock, then over stocks (spec Section 10.1)."""
    return float(squared_error(actual, pred).mean(axis=1).mean())


def qlike(actual: np.ndarray, pred: np.ndarray) -> float:
    """Mean over time within stock, then over stocks (spec Section 10.1)."""
    return float(qlike_elementwise(actual, pred).mean(axis=1).mean())


LOSSES = {"mse": mse, "qlike": qlike}
ELEMENTWISE = {"mse": squared_error, "qlike": qlike_elementwise}


def loss_table(actual: np.ndarray, preds: dict[str, np.ndarray]) -> dict:
    """`{model: {mse, qlike}}` for a set of forecasts of the same target."""
    return {
        name: {"mse": mse(actual, p), "qlike": qlike(actual, p)}
        for name, p in preds.items()
    }
