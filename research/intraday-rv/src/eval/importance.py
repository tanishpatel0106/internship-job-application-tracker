"""Variable importance and interaction effects (spec Section 10.5).

Importance follows Sadhwani et al.: the summed absolute partial derivative of
the prediction with respect to each input, normalized to sum to one. For linear
models this reduces exactly to normalized absolute coefficients, which is
asserted in the tests rather than assumed.

A single finite-difference implementation is used for every non-linear family,
so XGBoost, MLP and LSTM importances are all the *same* quantity and are
directly comparable. Analytic gradients are used for torch models when
available, since they are both exact and cheaper.
"""

from __future__ import annotations

import numpy as np


def normalize(importance: np.ndarray) -> np.ndarray:
    """Scale to sum to one; an all-zero vector is returned unchanged."""
    imp = np.abs(np.asarray(importance, dtype=np.float64))
    total = imp.sum()
    return imp / total if total > 0 else imp


def linear_importance(coef: np.ndarray) -> np.ndarray:
    """Normalized absolute coefficients (the linear case of the definition)."""
    return normalize(np.asarray(coef, dtype=np.float64).ravel())


def finite_difference_importance(
    predict, X: np.ndarray, eps: float | None = None, max_rows: int = 2000,
    seed: int = 0,
) -> np.ndarray:
    """Mean |d yhat / d x_j| by central differences, normalized.

    `X` is subsampled to `max_rows` because the cost is 2 * n_features model
    evaluations per row; the estimate is an average over rows, so a random
    subsample is unbiased.
    """
    X = np.asarray(X, dtype=np.float64)
    n, p = X.shape
    if n > max_rows:
        rng = np.random.default_rng(seed)
        X = X[rng.choice(n, max_rows, replace=False)]
    # Per-feature step scaled to that feature's own dispersion.
    scale = X.std(axis=0)
    scale[scale <= 0] = 1.0
    h = (eps if eps is not None else 1e-4) * scale

    grads = np.empty(p)
    for j in range(p):
        Xp, Xm = X.copy(), X.copy()
        Xp[:, j] += h[j]
        Xm[:, j] -= h[j]
        d = (np.asarray(predict(Xp)).ravel() - np.asarray(predict(Xm)).ravel())
        grads[j] = np.mean(np.abs(d / (2.0 * h[j])))
    return normalize(grads)


def torch_gradient_importance(model, X: np.ndarray, batch_size: int = 1024,
                              device: str | None = None) -> np.ndarray:
    """Exact mean |d yhat / d x_j| by autograd, for torch models."""
    import torch

    dev = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    model = model.to(dev).eval()
    X = np.asarray(X, dtype=np.float32)
    total = np.zeros(X.shape[1], dtype=np.float64)
    n = 0
    for start in range(0, len(X), batch_size):
        xb = torch.tensor(X[start:start + batch_size], device=dev,
                          requires_grad=True)
        out = model(xb).sum()
        grad, = torch.autograd.grad(out, xb)
        total += grad.abs().sum(dim=0).detach().cpu().numpy()
        n += len(xb)
    return normalize(total / max(1, n))


def daily_periodicity_score(importance: np.ndarray, bins_per_day: int) -> float:
    """Ratio of mean importance at day-multiple lags to all other lags.

    The paper's finding is that sensitivity decays with lag and *spikes* every
    `bins_per_day` lags. A score above 1 confirms the periodicity; the
    magnitude says how pronounced it is.
    """
    imp = np.asarray(importance, dtype=np.float64).ravel()
    lags = np.arange(1, imp.size + 1)          # feature j is lag j+1
    on = (lags % bins_per_day) == 0
    if not on.any() or on.all():
        return float("nan")
    return float(imp[on].mean() / imp[~on].mean())


def lag_decay_slope(importance: np.ndarray) -> float:
    """OLS slope of log importance on log lag; negative means decay with lag."""
    imp = np.asarray(importance, dtype=np.float64).ravel()
    keep = imp > 0
    if keep.sum() < 3:
        return float("nan")
    x = np.log(np.arange(1, imp.size + 1)[keep])
    y = np.log(imp[keep])
    return float(np.polyfit(x, y, 1)[0])


def interaction_curves(
    predict,
    own_grid: np.ndarray,
    agg_quantile_values: dict[str, float],
    feature_means: np.ndarray,
    own_index: int = 0,
    agg_index: int | None = None,
) -> dict[str, np.ndarray]:
    """Predicted RV vs lag-1 own RV, conditioned on quantiles of lag-1 aggregate.

    Every other feature is held at its training mean. The paper's finding is
    that the curves are *non-parallel* (an interaction is present) and converge
    at high own-RV -- the market effect weakens when a stock is very volatile.
    Use `interaction_diagnostics` to quantify both.
    """
    mu = np.asarray(feature_means, dtype=np.float64).ravel()
    curves: dict[str, np.ndarray] = {}
    for label, agg_val in agg_quantile_values.items():
        X = np.tile(mu, (len(own_grid), 1))
        X[:, own_index] = own_grid
        if agg_index is not None:
            X[:, agg_index] = agg_val
        curves[label] = np.asarray(predict(X)).ravel()
    return curves


def interaction_diagnostics(curves: dict[str, np.ndarray]) -> dict:
    """Quantify non-parallelism and convergence of the interaction curves."""
    labels = list(curves)
    mat = np.stack([curves[k] for k in labels])
    spread = mat.max(axis=0) - mat.min(axis=0)
    n = spread.size
    lo, hi = spread[: max(1, n // 4)].mean(), spread[-max(1, n // 4):].mean()
    slopes = [float(np.polyfit(np.arange(n), mat[i], 1)[0]) for i in range(len(labels))]
    return {
        "labels": labels,
        "spread_low_own_rv": float(lo),
        "spread_high_own_rv": float(hi),
        "converges_at_high_own_rv": bool(hi < lo),
        "convergence_ratio": float(hi / lo) if lo > 0 else float("nan"),
        "slopes": slopes,
        "slope_range": float(max(slopes) - min(slopes)),
        "non_parallel": bool((max(slopes) - min(slopes)) > 1e-6),
    }


def delta_qlike_by_quintile(
    actual: np.ndarray, pred_a: np.ndarray, pred_b: np.ndarray,
    commonality: np.ndarray, n_quantiles: int = 5,
):
    """Mean QLIKE improvement of `a` over `b`, by commonality quintile.

    `commonality` is one R^2 per stock, aligned with axis 0 of the forecasts.
    """
    import pandas as pd

    from src.eval.losses import qlike_elementwise

    la = qlike_elementwise(actual, pred_a).mean(axis=1)
    lb = qlike_elementwise(actual, pred_b).mean(axis=1)
    c = np.asarray(commonality, dtype=np.float64).ravel()
    if c.size != la.size:
        raise ValueError(f"commonality has {c.size} entries, forecasts have {la.size}")
    q = pd.qcut(c, n_quantiles, labels=[f"Q{i+1}" for i in range(n_quantiles)],
                duplicates="drop")
    df = pd.DataFrame({"quintile": q, "loss_a": la, "loss_b": lb,
                       "commonality": c})
    g = df.groupby("quintile", observed=True)
    out = g.agg(n=("loss_a", "size"), mean_commonality=("commonality", "mean"),
                qlike_a=("loss_a", "mean"), qlike_b=("loss_b", "mean"))
    out["delta_qlike"] = out["qlike_a"] - out["qlike_b"]
    out["pct_improvement"] = 100.0 * (out["qlike_b"] - out["qlike_a"]) / out["qlike_b"]
    return out
