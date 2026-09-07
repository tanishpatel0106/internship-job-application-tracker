"""Stock universe, GICS sector map, and ticker-change handling (spec Section 3).

The 93 "raw" names are the paper's Table 1 universe; the 16 "unseen" names are
held out entirely from training and used only for the Section 11.1
generalization test.
"""

from __future__ import annotations

from dataclasses import dataclass

# --- Section 3: the 93 raw stocks, by GICS sector -------------------------

GICS_SECTORS: dict[str, list[str]] = {
    "Information Technology": [
        "AAPL", "ACN", "ADBE", "ADP", "AVGO", "CRM", "CSCO", "FIS", "FISV",
        "IBM", "INTC", "INTU", "MA", "MSFT", "MU", "NVDA", "ORCL", "QCOM",
        "TXN", "V",
    ],
    "Health Care": [
        "ABT", "AMGN", "BDX", "BMY", "BSX", "CI", "CVS", "DHR", "GILD",
        "ISRG", "JNJ", "LLY", "MDT", "MRK", "PFE", "SYK", "TMO", "UNH",
        "VRTX",
    ],
    "Financials": [
        "AXP", "BAC", "BLK", "BRK.B", "C", "CB", "CME", "GS", "JPM", "MMC",
        "MS", "PNC", "SCHW", "USB", "WFC",
    ],
    "Industrials": [
        "BA", "CAT", "CSX", "GE", "HON", "LMT", "MMM", "UNP", "UPS",
    ],
    "Consumer Discretionary": [
        "AMZN", "HD", "LOW", "MCD", "NKE", "SBUX", "TGT", "TJX",
    ],
    "Consumer Staples": [
        "CL", "COST", "KO", "MO", "PEP", "PG", "PM", "WMT",
    ],
    "Communication Services": [
        "CMCSA", "DIS", "GOOG", "NFLX", "T", "VZ",
    ],
    "Others": [
        "AMT", "CCI", "COP", "CVX", "D", "DUK", "SO", "XOM",
    ],
}

RAW_STOCKS: list[str] = sorted(t for ts in GICS_SECTORS.values() for t in ts)

# Section 3: 16 stocks never seen during training.
UNSEEN_STOCKS: list[str] = [
    "AMAT", "APD", "BIIB", "COF", "DE", "EQIX", "EW", "GPN", "HUM", "ICE",
    "ILMN", "ITW", "NOC", "NSC", "PLD", "SLB",
]

ALL_SYMBOLS: list[str] = RAW_STOCKS + UNSEEN_STOCKS

SECTOR_OF: dict[str, str] = {
    t: sector for sector, ts in GICS_SECTORS.items() for t in ts
}


# --- Ticker changes within the 2018-05 .. 2026-09 sample ------------------
#
# Databento `stype_in="raw_symbol"` resolves point-in-time, so a request for
# the *current* ticker will not return history filed under the old one (and
# vice versa). Each entry records the symbol we canonicalize to, and the raw
# symbols that must be requested to cover the full sample.
#
# `instrument_id` continuity across each transition is asserted by
# `src/data/symbology.py::audit_ticker_continuity` (spec Section 2.8, OPEN).


@dataclass(frozen=True)
class TickerChange:
    canonical: str          # symbol used everywhere downstream
    old_symbol: str
    new_symbol: str
    effective: str          # ISO date the new symbol took effect
    note: str = ""


TICKER_CHANGES: list[TickerChange] = [
    TickerChange(
        canonical="FISV", old_symbol="FISV", new_symbol="FI",
        effective="2024-02-05",
        note="Fiserv rebranded; ticker FISV -> FI.",
    ),
]

# Symbols whose Databento raw_symbol differs from the canonical GICS spelling.
# Databento uses a space rather than a dot for share-class suffixes on
# XNAS.ITCH. Verified during the symbology audit (Section 2.8).
SYMBOL_ALIASES: dict[str, list[str]] = {
    "BRK.B": ["BRK B", "BRK.B", "BRKB"],
}


def request_symbols(canonical: str) -> list[str]:
    """All raw symbols that must be requested to cover `canonical`'s history."""
    if canonical in SYMBOL_ALIASES:
        return list(SYMBOL_ALIASES[canonical])
    out = [canonical]
    for ch in TICKER_CHANGES:
        if ch.canonical == canonical:
            for s in (ch.old_symbol, ch.new_symbol):
                if s not in out:
                    out.append(s)
    return out


def canonicalize(raw_symbol: str) -> str:
    """Map a raw Databento symbol back to its canonical universe symbol."""
    for canon, aliases in SYMBOL_ALIASES.items():
        if raw_symbol in aliases:
            return canon
    for ch in TICKER_CHANGES:
        if raw_symbol in (ch.old_symbol, ch.new_symbol):
            return ch.canonical
    return raw_symbol


def all_request_symbols() -> list[str]:
    """Flat, de-duplicated list of raw symbols to request from Databento."""
    seen: dict[str, None] = {}
    for canon in ALL_SYMBOLS:
        for s in request_symbols(canon):
            seen.setdefault(s, None)
    return list(seen)
