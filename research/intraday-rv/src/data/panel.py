"""Mid-prices, returns, and the canonical RV panel (spec Section 4).

The canonical intermediate is the *RV panel*, shaped `(stock, day, bin)`, not a
lag matrix (spec Section 12.1). At 10-min that is 109 x ~2100 x 39 float32
~= 36 MB; every lag vector downstream is a *view* into it built by index
arithmetic, never a materialized copy.

Two structural guarantees are worth stating because they are what make the
Section 15 timestamp audit pass:

* Returns are formed by reshaping each session to its own row *before*
  differencing, so an overnight return cannot be constructed even in principle.
  The first return of a session is 09:31 vs 09:30.
* No `.shift()` is applied to the mid series. A `bbo-1m` record stamped T is
  the book at the close of (T-1, T], so `log(mid_t / mid_{t-1})` is already the
  return over that minute (spec Section 2.6).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import (
    HORIZONS, PANELS, RTH_MINUTES, RTH_SNAPSHOTS, RV_FLOOR,
)

log = logging.getLogger(__name__)


# --- Returns -------------------------------------------------------------

def session_matrix(clean: pd.DataFrame, column: str = "mid") -> tuple[np.ndarray, np.ndarray]:
    """Reshape a cleaned series to `(n_days, 391)` plus the session dates.

    Raises if any session is not exactly 391 snapshots -- `clean.validate_sessions`
    is responsible for having removed those already.
    """
    dates = pd.DatetimeIndex(clean.index).normalize()
    day_keys = np.asarray(dates.date)
    uniq, counts = np.unique(day_keys, return_counts=True)
    bad = uniq[counts != RTH_SNAPSHOTS]
    if bad.size:
        raise ValueError(
            f"{bad.size} session(s) do not have {RTH_SNAPSHOTS} snapshots, "
            f"first={bad[0]}; run clean.validate_sessions first"
        )
    order = np.argsort(day_keys, kind="stable")
    vals = np.asarray(clean[column].to_numpy(dtype=np.float64))[order]
    return vals.reshape(len(uniq), RTH_SNAPSHOTS), uniq


def intraday_returns(prices_by_session: np.ndarray) -> np.ndarray:
    """`(n_days, 391)` prices -> `(n_days, 390)` within-session log returns.

    No overnight return is produced: differencing happens *along* each session
    row, never across rows.
    """
    if prices_by_session.shape[1] != RTH_SNAPSHOTS:
        raise ValueError(
            f"expected {RTH_SNAPSHOTS} snapshots per session, "
            f"got {prices_by_session.shape[1]}"
        )
    p = np.asarray(prices_by_session, dtype=np.float64)
    if np.any(p <= 0):
        raise ValueError("non-positive price encountered; clean the input first")
    return np.diff(np.log(p), axis=1)


# --- Realized volatility -------------------------------------------------

def _binned(returns: np.ndarray, bins_per_day: int) -> np.ndarray:
    """`(n_days, 390)` -> `(n_days, bins_per_day, minutes_per_bin)`."""
    n_days, n_min = returns.shape
    if n_min != RTH_MINUTES:
        raise ValueError(f"expected {RTH_MINUTES} returns per session, got {n_min}")
    per_bin, rem = divmod(RTH_MINUTES, bins_per_day)
    if rem:
        raise ValueError(f"{bins_per_day} bins do not divide {RTH_MINUTES} evenly")
    return returns.reshape(n_days, bins_per_day, per_bin)


def realized_variance(returns: np.ndarray, bins_per_day: int) -> np.ndarray:
    """Sum of squared returns per bin, in *levels*: `(n_days, bins_per_day)`."""
    return (_binned(returns, bins_per_day) ** 2).sum(axis=2)


def log_rv(returns: np.ndarray, bins_per_day: int,
           floor: float = RV_FLOOR) -> tuple[np.ndarray, int]:
    """Log realized volatility per bin, with the zero-variance floor.

    Returns `(log_rv, n_floored)`. A bin with no price movement gives
    RV = log(0) = -inf; the spec's DECISION is to floor the squared-return sum
    at 1e-12 before logging and to log how often that bites (Section 4.6).
    """
    rv = realized_variance(returns, bins_per_day)
    n_floored = int((rv < floor).sum())
    return np.log(np.maximum(rv, floor)), n_floored


def semivariances(returns: np.ndarray, bins_per_day: int,
                  floor: float = RV_FLOOR) -> tuple[np.ndarray, np.ndarray]:
    """Signed semivariances for SHAR (spec Section 11), in log space."""
    b = _binned(returns, bins_per_day)
    pos = (np.where(b > 0, b, 0.0) ** 2).sum(axis=2)
    neg = (np.where(b < 0, b, 0.0) ** 2).sum(axis=2)
    return np.log(np.maximum(pos, floor)), np.log(np.maximum(neg, floor))


def realized_quarticity(returns: np.ndarray, bins_per_day: int) -> np.ndarray:
    """RQ = (M/3) * sum r^4, in *levels* (spec Section 11, HARQ)."""
    b = _binned(returns, bins_per_day)
    m = b.shape[2]
    return (m / 3.0) * (b ** 4).sum(axis=2)


# --- The panel container -------------------------------------------------

@dataclass
class RVPanel:
    """Canonical `(stock, day, bin)` log-RV store for one horizon."""

    horizon: str
    symbols: list[str]
    sessions: np.ndarray            # dtype=object (datetime.date), length n_days
    values: np.ndarray              # (n_symbols, n_days, n_bins) float32
    meta: dict

    def __post_init__(self) -> None:
        n_s, n_d, n_b = self.values.shape
        if n_s != len(self.symbols):
            raise ValueError("values/symbols length mismatch")
        if n_d != len(self.sessions):
            raise ValueError("values/sessions length mismatch")
        if n_b != HORIZONS[self.horizon].bins_per_day:
            raise ValueError(
                f"{self.horizon} expects {HORIZONS[self.horizon].bins_per_day} "
                f"bins/day, got {n_b}"
            )

    @property
    def n_symbols(self) -> int:
        return len(self.symbols)

    @property
    def n_days(self) -> int:
        return len(self.sessions)

    @property
    def bins_per_day(self) -> int:
        return self.values.shape[2]

    @property
    def n_times(self) -> int:
        """Flat time length: n_days * bins_per_day."""
        return self.n_days * self.bins_per_day

    def flat(self) -> np.ndarray:
        """`(n_symbols, n_days * bins_per_day)` view; time runs bin-within-day."""
        return self.values.reshape(self.n_symbols, -1)

    def index_of(self, symbol: str) -> int:
        return self.symbols.index(symbol)

    def flat_dates(self) -> np.ndarray:
        """Session date for each flat time index."""
        return np.repeat(np.asarray(self.sessions), self.bins_per_day)

    def flat_bin_of_day(self) -> np.ndarray:
        """Bin-of-day for each flat time index."""
        return np.tile(np.arange(self.bins_per_day), self.n_days)

    def time_mask(self, start: str, end: str) -> np.ndarray:
        """Boolean mask over flat time for dates in [start, end] inclusive."""
        d = pd.DatetimeIndex(pd.to_datetime(self.flat_dates()))
        return np.asarray((d >= pd.Timestamp(start)) & (d <= pd.Timestamp(end)))

    # --- persistence ---
    def save(self, directory: Path | None = None) -> Path:
        directory = Path(directory or PANELS)
        directory.mkdir(parents=True, exist_ok=True)
        stem = directory / f"rv_{self.horizon}"
        np.save(stem.with_suffix(".npy"), self.values)
        payload = {
            "horizon": self.horizon,
            "symbols": self.symbols,
            "sessions": [str(s) for s in self.sessions],
            "meta": self.meta,
            "shape": list(self.values.shape),
        }
        stem.with_suffix(".json").write_text(json.dumps(payload, indent=2))
        log.info("saved %s panel %s -> %s", self.horizon, self.values.shape, stem)
        return stem.with_suffix(".npy")

    @classmethod
    def load(cls, horizon: str, directory: Path | None = None) -> "RVPanel":
        directory = Path(directory or PANELS)
        stem = directory / f"rv_{horizon}"
        payload = json.loads(stem.with_suffix(".json").read_text())
        values = np.load(stem.with_suffix(".npy"))
        sessions = np.asarray(
            [pd.Timestamp(s).date() for s in payload["sessions"]], dtype=object
        )
        return cls(payload["horizon"], payload["symbols"], sessions, values,
                   payload["meta"])


def build_panels(
    cleaned: dict[str, pd.DataFrame],
    horizons: list[str] | None = None,
    column: str = "mid",
) -> dict[str, RVPanel]:
    """Cleaned per-symbol frames -> one `RVPanel` per horizon.

    Symbols are intersected onto a common session calendar; any symbol missing
    sessions is dropped, per the paper's filtering rule that a stock must span
    the entire sample (spec Section 3). Every drop is logged with its reason.
    """
    horizons = horizons or list(HORIZONS)
    symbols = sorted(cleaned)

    per_symbol_sessions = {}
    for sym, df in cleaned.items():
        mat, dates = session_matrix(df, column=column)
        per_symbol_sessions[sym] = (mat, dates)

    common = None
    for sym, (_, dates) in per_symbol_sessions.items():
        s = set(dates.tolist())
        common = s if common is None else (common & s)
    common_sessions = np.asarray(sorted(common), dtype=object)
    log.info("common calendar: %d sessions across %d symbols",
             len(common_sessions), len(symbols))

    kept, dropped = [], {}
    for sym, (_, dates) in per_symbol_sessions.items():
        missing = len(common_sessions) - len(set(dates.tolist()) & set(common_sessions.tolist()))
        coverage = 1.0 - missing / max(1, len(common_sessions))
        if coverage < 1.0:
            dropped[sym] = f"covers {coverage:.4f} of the common calendar"
        else:
            kept.append(sym)
    for sym, why in dropped.items():
        log.warning("dropping %s: %s", sym, why)
    if not kept:
        raise ValueError("no symbol spans the common calendar")

    panels: dict[str, RVPanel] = {}
    floored_counts: dict[str, dict[str, int]] = {}
    for hname in horizons:
        b = HORIZONS[hname].bins_per_day
        arr = np.empty((len(kept), len(common_sessions), b), dtype=np.float32)
        floored_counts[hname] = {}
        for i, sym in enumerate(kept):
            mat, dates = per_symbol_sessions[sym]
            sel = np.isin(dates, common_sessions)
            order = np.argsort(dates[sel], kind="stable")
            r = intraday_returns(mat[sel][order])
            lrv, n_floored = log_rv(r, b)
            arr[i] = lrv.astype(np.float32)
            floored_counts[hname][sym] = n_floored
        total_floored = sum(floored_counts[hname].values())
        total_cells = arr.size
        log.info(
            "%s panel %s: %d/%d bins floored (%.4f%%)",
            hname, arr.shape, total_floored, total_cells,
            100.0 * total_floored / total_cells,
        )
        panels[hname] = RVPanel(
            horizon=hname, symbols=list(kept), sessions=common_sessions,
            values=arr,
            meta={
                "dropped_symbols": dropped,
                "n_floored": total_floored,
                "n_cells": int(total_cells),
                "floor": RV_FLOOR,
                "price_column": column,
            },
        )
    return panels
