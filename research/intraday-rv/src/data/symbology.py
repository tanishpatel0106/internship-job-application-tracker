"""Ticker-change audit (spec Section 2.8, OPEN).

`stype_in="raw_symbol"` returned a nonzero cost for a retired ticker, which
proves *something* matched -- not that it matched correctly. This module
closes that gap by asserting `instrument_id` continuity across each known
ticker transition, and falls back to an explicit `instrument_id` join when
continuity breaks.

Run `audit_ticker_continuity()` once against live data before trusting any
symbol that appears in `universe.TICKER_CHANGES`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import pandas as pd

from src.universe import TICKER_CHANGES, TickerChange

log = logging.getLogger(__name__)


@dataclass
class ContinuityResult:
    canonical: str
    old_symbol: str
    new_symbol: str
    old_instrument_id: int | None
    new_instrument_id: int | None
    continuous: bool
    note: str = ""

    @property
    def needs_instrument_id_join(self) -> bool:
        return not self.continuous


def _instrument_id_around(
    client, symbol: str, date: str, window_days: int = 5,
) -> int | None:
    """The `instrument_id` a raw symbol resolved to near `date`, if any."""
    from src.data.download import DATASET, SCHEMA

    start = (pd.Timestamp(date) - pd.Timedelta(days=window_days)).date().isoformat()
    end = (pd.Timestamp(date) + pd.Timedelta(days=window_days)).date().isoformat()
    try:
        data = client.timeseries.get_range(
            dataset=DATASET, symbols=[symbol], schema=SCHEMA,
            start=start, end=end, stype_in="raw_symbol",
        )
        df = data.to_df()
    except Exception as exc:
        log.warning("resolution failed for %s near %s: %s", symbol, date, exc)
        return None
    if df.empty:
        return None
    ids = pd.unique(df["instrument_id"])
    if len(ids) > 1:
        log.warning("%s resolved to %d instrument_ids near %s", symbol, len(ids), date)
    return int(ids[0])


def audit_change(client, change: TickerChange) -> ContinuityResult:
    """Check one ticker transition for `instrument_id` continuity."""
    before = (pd.Timestamp(change.effective) - pd.Timedelta(days=20)).date().isoformat()
    after = (pd.Timestamp(change.effective) + pd.Timedelta(days=20)).date().isoformat()

    old_id = _instrument_id_around(client, change.old_symbol, before)
    new_id = _instrument_id_around(client, change.new_symbol, after)

    if old_id is None or new_id is None:
        return ContinuityResult(
            change.canonical, change.old_symbol, change.new_symbol,
            old_id, new_id, continuous=False,
            note="one side did not resolve; request both raw symbols and "
                 "concatenate, or switch to an instrument_id join",
        )
    continuous = old_id == new_id
    note = "" if continuous else (
        "instrument_id changes across the transition; switch this name to "
        'stype_in="instrument_id" with a definition-schema join'
    )
    if not continuous:
        log.warning("%s: %s(%d) -> %s(%d) NOT continuous",
                    change.canonical, change.old_symbol, old_id,
                    change.new_symbol, new_id)
    return ContinuityResult(change.canonical, change.old_symbol,
                            change.new_symbol, old_id, new_id, continuous, note)


def audit_ticker_continuity(client=None) -> pd.DataFrame:
    """Audit every known ticker change. Run before the bulk download."""
    from src.data.download import _client

    client = client or _client()
    rows = [audit_change(client, ch).__dict__ for ch in TICKER_CHANGES]
    df = pd.DataFrame(rows)
    if not df.empty and (~df["continuous"]).any():
        log.warning(
            "%d ticker transition(s) need an instrument_id join: %s",
            int((~df["continuous"]).sum()),
            df.loc[~df["continuous"], "canonical"].tolist(),
        )
    return df


def stitch_symbol_history(frames: dict[str, pd.DataFrame],
                          canonical: str) -> pd.DataFrame:
    """Concatenate the raw-symbol frames covering one canonical symbol.

    Overlapping timestamps are resolved in favour of the later-filed symbol,
    which is the correct precedence at a rename boundary.
    """
    from src.universe import request_symbols

    parts = [frames[s] for s in request_symbols(canonical) if s in frames]
    if not parts:
        raise KeyError(f"no frames supplied for {canonical}")
    out = pd.concat(parts).sort_index()
    out = out[~out.index.duplicated(keep="last")]
    out["symbol"] = canonical
    return out
