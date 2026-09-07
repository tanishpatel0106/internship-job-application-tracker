"""Cleaning: RTH filter, half-day drop, corporate actions, winsorization.

The three load-bearing decisions from spec Section 2 are enforced here:

1. Session filtering is on *Eastern local time*, never a fixed UTC offset --
   the sample spans eight years of DST transitions (Section 2.7).
2. No `.shift()` is ever applied to the mid series before differencing. A
   `bbo-1m` record stamped T is the book at the close of (T-1, T], so
   `r_t = log(mid_t / mid_{t-1})` is already correctly aligned (Section 2.6).
3. Winsorization thresholds are computed on the *training window only*;
   computing them on the full sample is lookahead (Section 4.6).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import (
    RTH_SNAPSHOTS, SPLIT_RETURN_THRESHOLD, WINSOR_LOWER, WINSOR_UPPER,
)
from src.data.calendar import early_closes
from src.universe import canonicalize

log = logging.getLogger(__name__)

ET = "America/New_York"

#: Columns kept from the 16-column bbo-1m record (spec Section 2.5).
#: `price`/`size`/`side` are retained for the free trade-price series that
#: powers the Section 2.10 bid-ask-bounce robustness table.
KEEP_COLUMNS = [
    "symbol", "bid_px_00", "ask_px_00", "bid_sz_00", "ask_sz_00",
    "price", "size", "side", "ts_event",
]


@dataclass
class CleanReport:
    """Everything the Phase 1 gate needs to check, accumulated during cleaning."""

    symbol: str
    n_raw_rows: int = 0
    n_rth_rows: int = 0
    n_sessions: int = 0
    n_full_sessions: int = 0
    n_half_days_dropped: int = 0
    n_ragged_sessions_dropped: int = 0
    n_nan_quotes: int = 0
    n_crossed_quotes: int = 0
    corporate_actions: list[dict] = field(default_factory=list)
    ragged_sessions: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        d = dict(self.__dict__)
        d["corporate_actions"] = len(self.corporate_actions)
        d["ragged_sessions"] = len(self.ragged_sessions)
        return d


# --- Loading -------------------------------------------------------------

def load_dbn(path: str | Path) -> pd.DataFrame:
    """Read one DBN(.zst) file into a DataFrame indexed by `ts_recv`."""
    import databento as db

    store = db.DBNStore.from_file(str(path))
    df = store.to_df()
    return df


def to_eastern(df: pd.DataFrame) -> pd.DataFrame:
    """Convert the tz-aware UTC index to Eastern local time.

    Filtering must happen in local time; a hardcoded -5h/-4h offset would
    corrupt roughly half the panel across DST transitions (spec Section 2.7).
    """
    idx = df.index
    if not isinstance(idx, pd.DatetimeIndex):
        raise TypeError(f"expected a DatetimeIndex, got {type(idx).__name__}")
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    out = df.copy()
    out.index = idx.tz_convert(ET)
    out.index.name = "ts_recv"
    return out


def filter_rth(df: pd.DataFrame) -> pd.DataFrame:
    """Keep only 09:30:00-16:00:00 ET inclusive: 391 snapshots per session."""
    return df.between_time("09:30", "16:00")


# --- Quote hygiene -------------------------------------------------------

def quote_diagnostics(df: pd.DataFrame) -> dict:
    """NaN and crossed-quote counts, for the Phase 1 gate."""
    bid, ask = df["bid_px_00"], df["ask_px_00"]
    nan = int(bid.isna().sum() + ask.isna().sum())
    valid = bid.notna() & ask.notna()
    crossed = int((valid & (ask <= bid)).sum())
    return {"n_nan_quotes": nan, "n_crossed_quotes": crossed}


def mid_price(df: pd.DataFrame) -> pd.Series:
    """(bid + ask) / 2. Prices are already decimal -- no scaling (Section 2.5)."""
    return (df["bid_px_00"] + df["ask_px_00"]) / 2.0


def relative_spread(df: pd.DataFrame) -> pd.Series:
    """(ask - bid) / mid, the input to the RU-TC trading-cost model."""
    mid = mid_price(df)
    return (df["ask_px_00"] - df["bid_px_00"]) / mid.replace(0.0, np.nan)


# --- Session validation --------------------------------------------------

def session_counts(df: pd.DataFrame) -> pd.Series:
    """Snapshots per session date, after RTH filtering."""
    return df.groupby(df.index.normalize().date).size()


def validate_sessions(
    df: pd.DataFrame, start: str, end: str, report: CleanReport | None = None,
) -> tuple[pd.DataFrame, CleanReport]:
    """Drop half-days and any session that is not exactly 391 snapshots.

    Half-days are dropped by calendar (spec Section 2.7 DECISION). Sessions
    that are ragged for any *other* reason -- a late open, a halt, a gap in the
    feed -- are dropped too, and logged separately so the two causes are never
    conflated.
    """
    report = report or CleanReport(symbol=str(df["symbol"].iloc[0]) if len(df) else "?")
    counts = session_counts(df)
    report.n_sessions = len(counts)

    half = {d.date() for d in early_closes(start, end)}
    is_half = pd.Series({d: (d in half) for d in counts.index})
    ragged = (counts != RTH_SNAPSHOTS) & (~is_half)

    report.n_half_days_dropped = int(is_half.sum())
    report.n_ragged_sessions_dropped = int(ragged.sum())
    report.ragged_sessions = [
        f"{d}:{int(counts[d])}" for d in counts.index[ragged]
    ]
    if report.n_ragged_sessions_dropped:
        log.warning(
            "%s: dropping %d ragged session(s) (expected %d snapshots): %s",
            report.symbol, report.n_ragged_sessions_dropped, RTH_SNAPSHOTS,
            report.ragged_sessions[:5],
        )

    drop = set(counts.index[is_half.to_numpy() | ragged.to_numpy()])
    keep_mask = ~pd.Index(df.index.normalize().date).isin(drop)
    out = df[keep_mask]
    report.n_full_sessions = len(session_counts(out))
    report.n_rth_rows = len(out)
    return out, report


# --- Corporate actions (spec Section 4.6, OPEN) --------------------------

#: Common split ratios; a one-minute return is treated as a corporate action
#: when exp(r) lands near one of these (or its reciprocal).
_SPLIT_RATIOS = [2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 3 / 2, 5 / 4, 4 / 3, 5 / 3]


def detect_corporate_actions(
    mid: pd.Series, threshold: float = SPLIT_RETURN_THRESHOLD, tol: float = 0.03,
) -> list[dict]:
    """Flag intra-session one-minute returns too large to be a price move.

    `XNAS.ITCH` raw prices are unadjusted, so a split appears as a single
    enormous one-minute return. These are handled explicitly rather than left
    for winsorization to mask (spec Section 4.6).

    A flagged move is classified as a probable split when the price ratio sits
    within `tol` of a common split ratio, and as `unclassified` otherwise --
    the latter needs a look before it is trusted.
    """
    r = np.log(mid / mid.shift(1))
    # Only within-session moves; the first bar of each session has no
    # predecessor within the session and must never be differenced across the
    # overnight gap.
    same_session = mid.index.normalize() == mid.index.normalize().to_series().shift(1).to_numpy()
    r = r.where(same_session)

    hits = r[r.abs() > threshold]
    events = []
    for ts, val in hits.items():
        ratio = float(np.exp(val))
        kind, matched = "unclassified", None
        for cand in _SPLIT_RATIOS:
            for target in (cand, 1.0 / cand):
                if abs(ratio - target) / target < tol:
                    kind, matched = "probable_split", target
                    break
            if matched:
                break
        events.append({
            "ts": str(ts), "log_return": float(val), "ratio": ratio,
            "kind": kind, "matched_ratio": matched,
        })
    return events


def adjust_for_splits(mid: pd.Series, events: list[dict]) -> pd.Series:
    """Back-adjust the mid series across detected split events.

    Prices *before* a split are divided by the ratio, so the series becomes
    continuous. Only `probable_split` events are applied; `unclassified` ones
    are left alone and must be reviewed.
    """
    out = mid.copy()
    for ev in events:
        if ev["kind"] != "probable_split":
            continue
        ts = pd.Timestamp(ev["ts"])
        ratio = ev["matched_ratio"]
        out.loc[out.index < ts] = out.loc[out.index < ts] * ratio
        log.info("adjusted split at %s by ratio %.4f", ts, ratio)
    return out


# --- Winsorization (spec Section 4.6) ------------------------------------

def winsor_thresholds(
    values: np.ndarray, lower: float = WINSOR_LOWER, upper: float = WINSOR_UPPER,
) -> tuple[float, float]:
    """Percentile thresholds. MUST be given the training slice only."""
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    if v.size == 0:
        return (-np.inf, np.inf)
    return (float(np.quantile(v, lower)), float(np.quantile(v, upper)))


def apply_winsor(values: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Clip with train-derived thresholds.

    Clipping *test* data with *training* thresholds is not lookahead -- the
    thresholds carry no test information. Computing them on the full sample
    would be.
    """
    return np.clip(values, lo, hi)


# --- Top-level per-symbol clean -----------------------------------------

def clean_symbol(
    df: pd.DataFrame, start: str, end: str, symbol: str | None = None,
    adjust_splits: bool = True,
) -> tuple[pd.DataFrame, CleanReport]:
    """Raw bbo-1m frame for one symbol -> clean RTH frame + report."""
    symbol = symbol or canonicalize(str(df["symbol"].iloc[0]))
    report = CleanReport(symbol=symbol, n_raw_rows=len(df))

    df = to_eastern(df)
    df = filter_rth(df)
    diag = quote_diagnostics(df)
    report.n_nan_quotes = diag["n_nan_quotes"]
    report.n_crossed_quotes = diag["n_crossed_quotes"]

    df, report = validate_sessions(df, start, end, report)
    if df.empty:
        return df, report

    mid = mid_price(df)
    events = detect_corporate_actions(mid)
    report.corporate_actions = events
    if events:
        kinds = {}
        for e in events:
            kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
        log.warning("%s: corporate-action candidates %s", symbol, kinds)
    if adjust_splits and events:
        mid = adjust_for_splits(mid, events)

    out = pd.DataFrame({
        "symbol": symbol,
        "mid": mid.to_numpy(),
        "trade_price": df["price"].to_numpy(),
        "rel_spread": relative_spread(df).to_numpy(),
    }, index=df.index)
    return out, report
