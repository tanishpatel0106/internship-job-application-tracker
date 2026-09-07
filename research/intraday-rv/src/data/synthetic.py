"""Synthetic bbo-1m generator mirroring the verified record structure.

This exists so the whole pipeline -- cleaning, RV construction, commonality,
every model family, the evaluation harness and all Section 15 gates -- can be
exercised end to end without live Databento data.

It reproduces the properties the spec verified against the real feed:

* tz-aware UTC index on exact minute boundaries, spanning 04:00-19:00 ET
  (~884 rows/session), so the RTH filter has something to remove;
* `ts_event` strictly *before* its `ts_recv` boundary, matching the bar-close
  convention of Section 2.6;
* the full 16-column schema of Section 2.5 with the same dtypes;
* a reverse-J diurnal volatility shape (Figure 3) and a common market factor,
  so commonality R^2 is materially non-zero and the Phase 2 gate is meaningful.

The factor structure is deliberate: `market_loading` controls how much
commonality the panel carries, which is what makes the AUGMENTED-beats-SINGLE
gate testable on synthetic data.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.data.calendar import full_sessions

ET = "America/New_York"


def diurnal_profile(n_minutes: int = 390) -> np.ndarray:
    """Reverse-J intraday volatility multiplier (high open, dip, rise to close)."""
    u = np.linspace(0.0, 1.0, n_minutes)
    open_burst = 2.2 * np.exp(-u / 0.06)
    close_rise = 0.9 * np.exp(-(1.0 - u) / 0.13)
    return 0.55 + open_burst + close_rise


def generate_symbol(
    symbol: str,
    sessions: pd.DatetimeIndex,
    market_shocks: np.ndarray,
    diurnal: np.ndarray,
    rng: np.random.Generator,
    price0: float = 100.0,
    base_vol: float = 2.2e-4,
    market_loading: float = 0.72,
    spread_bps: float = 1.2,
    persistence: float = 0.94,
) -> pd.DataFrame:
    """One symbol's full-session bbo-1m frame, 04:00-19:00 ET per session."""
    n_rth = len(diurnal)
    n_days = len(sessions)

    # Persistent idiosyncratic log-vol, plus the shared market log-vol factor.
    idio = np.zeros(n_days)
    eps = rng.normal(0.0, 0.30, n_days)
    for d in range(1, n_days):
        idio[d] = persistence * idio[d - 1] + eps[d]
    log_scale = market_loading * market_shocks + np.sqrt(
        max(1e-12, 1.0 - market_loading**2)
    ) * idio
    day_scale = np.exp(log_scale - 0.5 * np.var(log_scale))

    frames = []
    px = price0
    for d, session in enumerate(sessions):
        day = pd.Timestamp(session).normalize()
        # Full pre/post session: 04:00 -> 19:00 ET, one snapshot per minute.
        idx = pd.date_range(
            day.tz_localize(ET) + pd.Timedelta(hours=4),
            day.tz_localize(ET) + pd.Timedelta(hours=19),
            freq="1min",
        )
        n = len(idx)

        vol = np.full(n, base_vol * 0.25)
        in_rth = (idx.hour * 60 + idx.minute >= 9 * 60 + 30) & (
            idx.hour * 60 + idx.minute <= 16 * 60
        )
        rth_pos = np.where(in_rth)[0]
        # 391 RTH snapshots -> 390 returns; the first carries no return.
        vol[rth_pos[1:]] = base_vol * diurnal * day_scale[d]

        r = rng.normal(0.0, vol)
        r[0] = 0.0
        mid = px * np.exp(np.cumsum(r))
        px = float(mid[rth_pos[-1]])

        half_spread = mid * (spread_bps * 1e-4) / 2.0
        # Tick-pin the quotes to a cent grid, as the real feed does.
        # Half-cent grid: liquid names quote penny-wide, so the mid takes
        # half-penny values.
        bid = np.round((mid - half_spread) * 200.0) / 200.0
        ask = np.round((mid + half_spread) * 200.0) / 200.0
        ask = np.where(ask <= bid, bid + 0.005, ask)

        ts_recv = idx.tz_convert("UTC")
        # ts_event precedes its ts_recv boundary (verified, Section 2.6).
        lag_ns = rng.integers(2_000_000, 59_000_000_000, size=n)
        ts_event = ts_recv - pd.to_timedelta(lag_ns, unit="ns")

        frames.append(pd.DataFrame({
            "ts_event": ts_event,
            "rtype": np.uint8(1),
            "publisher_id": np.uint16(2),
            "instrument_id": np.uint32(abs(hash(symbol)) % 1_000_000),
            "side": rng.choice(["B", "A", "N"], size=n),
            "price": np.round(mid, 2),
            "size": rng.integers(1, 500, size=n).astype(np.uint32),
            "flags": np.uint8(0),
            "sequence": np.arange(n, dtype=np.uint32),
            "bid_px_00": bid,
            "ask_px_00": ask,
            "bid_sz_00": rng.integers(1, 900, size=n).astype(np.uint32),
            "ask_sz_00": rng.integers(1, 900, size=n).astype(np.uint32),
            "bid_ct_00": rng.integers(1, 20, size=n).astype(np.uint32),
            "ask_ct_00": rng.integers(1, 20, size=n).astype(np.uint32),
            "symbol": symbol,
        }, index=ts_recv))

    out = pd.concat(frames)
    out.index.name = "ts_recv"
    return out


def generate_panel(
    symbols: list[str],
    start: str,
    end: str,
    seed: int = 0,
    market_loading: float = 0.72,
    loading_spread: float = 0.12,
) -> dict[str, pd.DataFrame]:
    """A whole synthetic universe sharing one market volatility factor."""
    rng = np.random.default_rng(seed)
    sessions = full_sessions(start, end)
    n_days = len(sessions)

    # Shared market log-vol factor, persistent as realised vol is.
    market = np.zeros(n_days)
    shock = rng.normal(0.0, 0.34, n_days)
    for d in range(1, n_days):
        market[d] = 0.965 * market[d - 1] + shock[d]

    diurnal = diurnal_profile()
    out: dict[str, pd.DataFrame] = {}
    for k, sym in enumerate(symbols):
        loading = float(np.clip(
            market_loading + rng.normal(0.0, loading_spread), 0.05, 0.98
        ))
        out[sym] = generate_symbol(
            sym, sessions, market, diurnal,
            np.random.default_rng(seed * 1000 + k),
            price0=float(rng.uniform(60.0, 400.0)),
            base_vol=float(rng.uniform(1.8e-4, 3.0e-4)),
            market_loading=loading,
            spread_bps=float(rng.uniform(0.7, 4.0)),
        )
    return out
