"""Intraday2Daily: next-day RV from past *intraday* RVs (spec Section 11).

    RV_{i,t+1}^(d) = F( RV_{i,t}^(h), ..., RV_{i,t-(p-1)h}^(h),
                        RV_{i,t-1}^(d), ..., RV_{i,t-(p-1)}^(d) )

The lag-1 daily RV is decomposed into its constituent intraday bins; longer
daily lags are retained as daily aggregates. Run at h in {10min, 30min, 65min},
with the target always next-day RV, against a "Traditional" baseline built on
daily RVs only.

Key result to reproduce: under the augmented scheme with 30-min features (13
coefficients, one per bucket), the **15:30-16:00 bucket should carry the
largest coefficient** (paper Figure 12).
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from src.config import HORIZONS, LAG_DAYS
from src.features.har import harq_features, shar_features
from src.features.lags import lag_windows

log = logging.getLogger(__name__)


def bucket_labels(bins_per_day: int) -> list[str]:
    """ET clock labels for each intraday bucket, e.g. '15:30-16:00'."""
    minutes = 390 // bins_per_day
    out = []
    for b in range(bins_per_day):
        s, e = 570 + b * minutes, 570 + (b + 1) * minutes
        out.append(f"{s // 60:02d}:{s % 60:02d}-{e // 60:02d}:{e % 60:02d}")
    return out


def build_features(
    intraday_flat: np.ndarray,
    daily_flat: np.ndarray,
    symbol: int,
    bins_per_day: int,
    n_daily_lags: int = LAG_DAYS,
    agg_intraday: np.ndarray | None = None,
    agg_daily: np.ndarray | None = None,
) -> tuple[np.ndarray, list[str], np.ndarray, np.ndarray]:
    """Features for predicting day d+1 from day d's bins plus prior daily RVs.

    Returns `(X, columns, y, day_index)`. Row k corresponds to predicting the
    daily RV of `day_index[k]`, using only data from strictly earlier days.
    """
    B = bins_per_day
    daily = np.asarray(daily_flat, dtype=np.float64)[symbol]
    intr = np.asarray(intraday_flat, dtype=np.float64)[symbol]
    n_days = daily.size
    if intr.size != n_days * B:
        raise ValueError(
            f"intraday series has {intr.size} points, expected {n_days * B}"
        )

    first = max(1, n_daily_lags)
    days = np.arange(first, n_days)

    # Lag-1 day decomposed into its B buckets (chronological within the day).
    bins_prev = np.stack([intr[(d - 1) * B:d * B] for d in days])
    cols = [f"bin_{lab}" for lab in bucket_labels(B)]

    # Daily lags 2..n_daily_lags (lag 1 is already represented by the bins).
    daily_lags = np.stack(
        [daily[days - k] for k in range(2, n_daily_lags + 1)], axis=1
    ) if n_daily_lags >= 2 else np.empty((days.size, 0))
    cols += [f"daily_lag{k}" for k in range(2, n_daily_lags + 1)]

    blocks = [bins_prev, daily_lags]
    if agg_intraday is not None:
        a_i = np.asarray(agg_intraday, dtype=np.float64)
        blocks.append(np.stack([a_i[(d - 1) * B:d * B] for d in days]))
        cols += [f"agg_bin_{lab}" for lab in bucket_labels(B)]
    if agg_daily is not None:
        a_d = np.asarray(agg_daily, dtype=np.float64)
        blocks.append(np.stack([a_d[days - k] for k in range(2, n_daily_lags + 1)],
                               axis=1))
        cols += [f"agg_daily_lag{k}" for k in range(2, n_daily_lags + 1)]

    X = np.hstack([b for b in blocks if b.size or b.shape[0]])
    return X, cols, daily[days], days


def traditional_features(
    daily_flat: np.ndarray, symbol: int, n_daily_lags: int = LAG_DAYS,
) -> tuple[np.ndarray, list[str], np.ndarray, np.ndarray]:
    """The "Traditional" baseline: daily RV lags only."""
    daily = np.asarray(daily_flat, dtype=np.float64)[symbol]
    days = np.arange(n_daily_lags, daily.size)
    X = np.stack([daily[days - k] for k in range(1, n_daily_lags + 1)], axis=1)
    cols = [f"daily_lag{k}" for k in range(1, n_daily_lags + 1)]
    return X, cols, daily[days], days


def fit_ols(X_tr, y_tr, X_te):
    """OLS with intercept, returning `(predictions, coefficients)`."""
    from src.models.linear import solve_ridge

    A = np.hstack([np.ones((X_tr.shape[0], 1)), X_tr])
    beta = solve_ridge(A.T @ A, A.T @ y_tr)
    return beta[0] + X_te @ beta[1:], beta


def bucket_importance(
    coefficients: np.ndarray, bins_per_day: int,
) -> pd.DataFrame:
    """Coefficient on each intraday bucket (paper Figure 12).

    `coefficients` excludes the intercept; the first `bins_per_day` entries are
    the lag-1 day's buckets in chronological order.
    """
    labels = bucket_labels(bins_per_day)
    coef = np.asarray(coefficients, dtype=np.float64)[:bins_per_day]
    df = pd.DataFrame({"bucket": labels, "coefficient": coef,
                       "abs_coefficient": np.abs(coef)})
    df["rank"] = df["abs_coefficient"].rank(ascending=False).astype(int)
    return df


def closing_bucket_is_largest(df: pd.DataFrame) -> bool:
    """Whether the final bucket carries the largest absolute coefficient."""
    return bool(df["abs_coefficient"].idxmax() == len(df) - 1)


def shar_design(daily_flat, pos_flat, neg_flat, symbol, n_daily_lags=LAG_DAYS):
    """SHAR features (spec Section 11)."""
    p = n_daily_lags
    daily = np.asarray(daily_flat, dtype=np.float64)[symbol]
    return shar_features(np.asarray(pos_flat)[symbol], np.asarray(neg_flat)[symbol],
                         daily, p, 1)


def harq_design(daily_flat, rq_flat, symbol, n_daily_lags=LAG_DAYS):
    """HARQ features (spec Section 11)."""
    daily = np.asarray(daily_flat, dtype=np.float64)[symbol]
    return harq_features(daily, np.asarray(rq_flat)[symbol], n_daily_lags, 1)
