"""Realized utility RU and RU-TC (spec Section 10.4).

    RU_t = (SR^2/g) * sqrt(exp(RV_{t+1})) / sqrt(E_t[exp(RV_{t+1})])
         - (SR^2/2g) * exp(RV_{t+1}) / E_t[exp(RV_{t+1})]

with SR = 0.4 and g = 2. A perfect forecast gives exactly SR^2/(2g) = 0.04,
asserted in `tests/test_utility.py` before any RU number is trusted.

`E_t[exp(RV_{t+1})]` is taken as `exp(forecast)`. This is deliberate and not an
oversight: a log-normal correction `exp(mu + s^2/2)` would break the 0.04
identity the spec requires as the unit test, since it would no longer equal
`exp(RV)` under a perfect forecast. The correction is available behind
`lognormal_correction` for a sensitivity check, and is off by default.

Both terms are computed from the *difference* `RV - RVhat` rather than from the
two exponentials separately, which is algebraically identical and cannot
overflow.

The implied position is

    w_t = SR / (g * sqrt(E_t[exp(RV_{t+1})]))

which is what RU-TC charges its trading cost against.
"""

from __future__ import annotations

import numpy as np

from src.config import RISK_AVERSION, SHARPE_RATIO, TC_SPREAD_WINDOW


def _as_2d(a: np.ndarray, p: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    a = np.asarray(a, dtype=np.float64)
    p = np.asarray(p, dtype=np.float64)
    if a.shape != p.shape:
        raise ValueError(f"shape mismatch: actual {a.shape} vs pred {p.shape}")
    if a.ndim == 1:
        a, p = a[None, :], p[None, :]
    return a, p


def realized_utility_elementwise(
    actual: np.ndarray,
    pred: np.ndarray,
    sharpe: float = SHARPE_RATIO,
    gamma: float = RISK_AVERSION,
    lognormal_correction: float | None = None,
) -> np.ndarray:
    """Per-observation RU on log-RV inputs."""
    a, p = _as_2d(actual, pred)
    if lognormal_correction:
        # E[exp(x)] = exp(mu + s^2/2); shifts the forecast level only.
        p = p + 0.5 * float(lognormal_correction)
    d = a - p
    return (sharpe**2 / gamma) * np.exp(d / 2.0) \
        - (sharpe**2 / (2.0 * gamma)) * np.exp(d)


def positions(
    pred: np.ndarray,
    sharpe: float = SHARPE_RATIO,
    gamma: float = RISK_AVERSION,
    position_scale: float = 1.0,
) -> np.ndarray:
    """Mean-variance position w_t = SR / (g * sqrt(E_t[exp(RV)])).

    `position_scale` rescales the position vector uniformly. It has no effect
    on RU (which is scale-free by construction) and changes only the magnitude
    of the RU-TC cost term relative to RU. Because RV here is the variance of a
    single horizon-bin, the raw positions are large in absolute terms; the
    scale is arbitrary but identical across models, so model *comparisons* are
    unaffected. Report the scale used alongside any RU-TC table.
    """
    p = np.asarray(pred, dtype=np.float64)
    return position_scale * sharpe / (gamma * np.exp(p / 2.0))


def realized_utility(
    actual: np.ndarray,
    pred: np.ndarray,
    sharpe: float = SHARPE_RATIO,
    gamma: float = RISK_AVERSION,
    lognormal_correction: float | None = None,
) -> float:
    """Mean over time within stock, then across stocks."""
    ru = realized_utility_elementwise(
        actual, pred, sharpe, gamma, lognormal_correction
    )
    return float(ru.mean(axis=1).mean())


def trading_costs(
    pred: np.ndarray,
    spread: np.ndarray,
    sharpe: float = SHARPE_RATIO,
    gamma: float = RISK_AVERSION,
    position_scale: float = 1.0,
    initial_position: np.ndarray | None = None,
) -> np.ndarray:
    """Cost linear in |change in position|, priced at the full median spread.

    `spread` is the trailing-90-day median *relative* bid-ask spread per asset,
    broadcast to the shape of `pred` (or a per-asset column vector).

    The spec specifies the *full* median spread rather than the half-spread,
    which is conservative. It is conservative twice over for NYSE-listed names,
    because the Nasdaq regional spread sits at or above the NBBO (spec
    Section 2.9) -- state this caveat wherever RU-TC is reported.
    """
    w = positions(pred, sharpe, gamma, position_scale)
    if w.ndim == 1:
        w = w[None, :]
    s = np.asarray(spread, dtype=np.float64)
    if s.ndim == 1:
        s = s[:, None] if s.shape[0] == w.shape[0] else s[None, :]
    prev = np.empty_like(w)
    prev[:, 1:] = w[:, :-1]
    prev[:, 0] = w[:, 0] if initial_position is None else np.asarray(
        initial_position, dtype=np.float64
    ).reshape(-1)
    return s * np.abs(w - prev)


def realized_utility_tc(
    actual: np.ndarray,
    pred: np.ndarray,
    spread: np.ndarray,
    sharpe: float = SHARPE_RATIO,
    gamma: float = RISK_AVERSION,
    position_scale: float = 1.0,
) -> float:
    """RU net of simulated trading costs."""
    ru = realized_utility_elementwise(actual, pred, sharpe, gamma)
    tc = trading_costs(pred, spread, sharpe, gamma, position_scale)
    return float((ru - tc).mean(axis=1).mean())


def rolling_median_spread(
    rel_spread: np.ndarray, window: int = TC_SPREAD_WINDOW,
) -> np.ndarray:
    """Trailing median relative spread per asset, `(n_assets, n_days)`.

    Strictly trailing: the value at day t uses days [t-window, t-1] and never
    day t itself, so it carries no contemporaneous information.
    """
    x = np.asarray(rel_spread, dtype=np.float64)
    if x.ndim == 1:
        x = x[None, :]
    n_a, n_t = x.shape
    out = np.full((n_a, n_t), np.nan)
    for t in range(1, n_t):
        lo = max(0, t - window)
        out[:, t] = np.nanmedian(x[:, lo:t], axis=1)
    # Day 0 has no history; back-fill from the first computable value.
    out[:, 0] = out[:, 1] if n_t > 1 else np.nanmedian(x, axis=1)
    return out
