"""Commonality in intraday RV (spec Section 9).

Per stock, per month:

    RV_{i,t}^(h) = a_i + b_i * RV_{M,t}^(h) + e_{i,t}

The adjusted R^2 is averaged across stocks within each month to give the
commonality series. This is the first substantive output and the best early
sanity check on the whole pipeline.

Expected shape of the answer (paper Table 2): ~0.56 at 10-min, ~0.73 at 30-min,
~0.74 at 65-min, and markedly lower and more volatile at ~0.36 for 1-day.
Commonality should also *rise* toward the close, in contrast to the reverse-J
diurnal volatility pattern.

If measured commonality comes out materially lower than the table, the first
suspect is microstructure noise in the RV estimator -- which is idiosyncratic
and therefore attenuates R^2. Cross-check against `trade_vs_mid_rv` before
concluding the pipeline is wrong.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)


def adjusted_r2(y: np.ndarray, x: np.ndarray) -> float:
    """Adjusted R^2 of a univariate OLS of y on x with an intercept."""
    y = np.asarray(y, dtype=np.float64)
    x = np.asarray(x, dtype=np.float64)
    ok = np.isfinite(y) & np.isfinite(x)
    y, x = y[ok], x[ok]
    n = y.size
    if n < 3:
        return np.nan
    xc, yc = x - x.mean(), y - y.mean()
    denom = float(xc @ xc)
    if denom <= 0:
        return np.nan
    beta = float(xc @ yc) / denom
    resid = yc - beta * xc
    ss_res, ss_tot = float(resid @ resid), float(yc @ yc)
    if ss_tot <= 0:
        return np.nan
    r2 = 1.0 - ss_res / ss_tot
    return float(1.0 - (1.0 - r2) * (n - 1) / (n - 2))


def monthly_commonality(panel, member_mask: np.ndarray | None = None) -> pd.DataFrame:
    """Per-stock, per-month adjusted R^2 against the equal-weighted market RV."""
    from src.features.aggregates import market_rv

    flat = panel.flat().astype(np.float64)
    mask = (np.ones(panel.n_symbols, dtype=bool) if member_mask is None
            else np.asarray(member_mask, dtype=bool))
    mkt = market_rv(flat, mask)[0]

    dates = pd.DatetimeIndex(pd.to_datetime(panel.flat_dates()))
    months = dates.to_period("M")
    rows = []
    for m in months.unique():
        sel = np.asarray(months == m)
        if sel.sum() < 3:
            continue
        for i, sym in enumerate(panel.symbols):
            if not mask[i]:
                continue
            rows.append({"month": str(m), "symbol": sym,
                         "r2": adjusted_r2(flat[i, sel], mkt[sel]),
                         "n_obs": int(sel.sum())})
    return pd.DataFrame(rows)


def commonality_series(monthly: pd.DataFrame) -> pd.Series:
    """Cross-sectional mean R^2 by month: the commonality time series."""
    return monthly.groupby("month")["r2"].mean()


def summarize(panel, member_mask=None) -> dict:
    """Mean and std of monthly commonality, comparable to paper Table 2."""
    monthly = monthly_commonality(panel, member_mask)
    s = commonality_series(monthly)
    return {"horizon": panel.horizon, "mean": float(s.mean()),
            "std": float(s.std()), "n_months": int(s.size),
            "min": float(s.min()), "max": float(s.max())}


def commonality_by_bucket(panel, member_mask=None,
                          bucket_minutes: int = 30) -> pd.DataFrame:
    """Commonality per half-hour bucket of the session (paper Figure 5).

    The paper's finding is that commonality *rises* toward the close, in
    contrast to the reverse-J shape of volatility itself.
    """
    from src.config import HORIZONS
    from src.features.aggregates import market_rv

    flat = panel.flat().astype(np.float64)
    mask = (np.ones(panel.n_symbols, dtype=bool) if member_mask is None
            else np.asarray(member_mask, dtype=bool))
    mkt = market_rv(flat, mask)[0]

    bod = panel.flat_bin_of_day()
    minutes = HORIZONS[panel.horizon].minutes
    bucket = (bod * minutes) // bucket_minutes

    rows = []
    for b in np.unique(bucket):
        sel = bucket == b
        start = int(b) * bucket_minutes
        label = f"{9 + (570 + start) // 60 - 9:02d}:{(570 + start) % 60:02d}"
        r2s = [adjusted_r2(flat[i, sel], mkt[sel])
               for i in range(panel.n_symbols) if mask[i]]
        rows.append({"bucket": int(b), "start_et": label,
                     "mean_r2": float(np.nanmean(r2s)),
                     "n_obs": int(sel.sum())})
    return pd.DataFrame(rows)


def diurnal_profile(panel, member_mask=None) -> pd.DataFrame:
    """Mean RV level by bin-of-day: the reverse-J shape (paper Figure 3)."""
    flat = panel.values
    mask = (np.ones(panel.n_symbols, dtype=bool) if member_mask is None
            else np.asarray(member_mask, dtype=bool))
    lvl = np.exp(flat[mask].astype(np.float64)).mean(axis=(0, 1))
    return pd.DataFrame({
        "bin_of_day": np.arange(lvl.size),
        "mean_rv": lvl,
        "normalized": lvl / lvl.mean(),
    })


def vix_correlation(series: pd.Series, vix: pd.Series) -> float:
    """Correlation of monthly commonality with monthly average VIX."""
    a = series.copy()
    a.index = pd.PeriodIndex(a.index, freq="M")
    b = vix.copy()
    b.index = pd.PeriodIndex(pd.to_datetime(b.index), freq="M")
    b = b.groupby(level=0).mean()
    joined = pd.concat([a.rename("r2"), b.rename("vix")], axis=1).dropna()
    if len(joined) < 3:
        return float("nan")
    return float(joined["r2"].corr(joined["vix"]))


def sentiment_regression(series: pd.Series, indices: pd.DataFrame) -> dict:
    """Logistic-transformed commonality on normalized sentiment indices.

    Regresses `log[R^2 / (1 - R^2)]` on the normalized VIX / CSI / EPU columns
    supplied (spec Appendix A).
    """
    r2 = series.clip(1e-6, 1 - 1e-6)
    y = np.log(r2 / (1 - r2))
    y.index = pd.PeriodIndex(y.index, freq="M")

    X = indices.copy()
    X.index = pd.PeriodIndex(pd.to_datetime(X.index), freq="M")
    X = X.groupby(level=0).mean()
    X = (X - X.mean()) / X.std()

    df = pd.concat([y.rename("y"), X], axis=1).dropna()
    if len(df) < len(X.columns) + 2:
        return {"error": "insufficient overlapping observations",
                "n": int(len(df))}
    import statsmodels.api as sm

    design = sm.add_constant(df[list(X.columns)])
    res = sm.OLS(df["y"], design).fit()
    return {
        "n": int(len(df)), "r2": float(res.rsquared),
        "params": {k: float(v) for k, v in res.params.items()},
        "tvalues": {k: float(v) for k, v in res.tvalues.items()},
        "pvalues": {k: float(v) for k, v in res.pvalues.items()},
    }


def trade_vs_mid_rv(mid_panel, trade_panel) -> pd.DataFrame:
    """RV from trade prices vs RV from mids (spec Section 2.10).

    The ratio quantifies bid-ask bounce contamination and shows empirically why
    quote-based RV is the right choice. It also bounds how much commonality
    R^2 is attenuated by microstructure noise, since that noise is idiosyncratic.
    """
    mid = mid_panel.values.astype(np.float64)
    trd = trade_panel.values.astype(np.float64)
    if mid.shape != trd.shape:
        raise ValueError(f"panel shape mismatch: {mid.shape} vs {trd.shape}")
    # Ratio of RV levels, averaged per stock.
    ratio = np.exp(trd - mid).mean(axis=(1, 2))
    return pd.DataFrame({
        "symbol": mid_panel.symbols,
        "mean_log_rv_mid": mid.mean(axis=(1, 2)),
        "mean_log_rv_trade": trd.mean(axis=(1, 2)),
        "rv_ratio_trade_over_mid": ratio,
        "excess_pct": 100.0 * (ratio - 1.0),
    })
