"""Live data ingest: downloaded DBN files -> cleaned per-symbol frames -> RV panels.

Databento batch jobs are split by *time*, not by symbol: each file holds every
requested symbol for one month. Building panels needs the opposite orientation,
so ingest runs in two passes:

  Pass 1  DBN files -> one Parquet per symbol   (`extract_symbols`)
  Pass 2  per-symbol Parquet -> clean -> panels (`build_live_panels`)

Both passes are resumable and neither ever holds more than one file or one
symbol in memory, so the full 112-symbol / 8-year pull fits on a laptop.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from src.config import HORIZONS, INTERIM_DATA, RAW_DATA
from src.data.clean import KEEP_COLUMNS, clean_symbol
from src.data.panel import build_panels
from src.universe import ALL_SYMBOLS, canonicalize

log = logging.getLogger(__name__)


def discover_dbn_files(raw_dir: Path | None = None) -> list[Path]:
    """Every downloaded DBN file, in chronological order."""
    raw = Path(raw_dir or RAW_DATA)
    files = sorted(raw.rglob("*.dbn.zst")) + sorted(raw.rglob("*.dbn"))
    if not files:
        raise FileNotFoundError(
            f"no .dbn/.dbn.zst files under {raw}. Run "
            "`python pipeline.py download --no-dry-run` first, or pass "
            "--raw-dir if the download landed elsewhere."
        )
    log.info("found %d DBN file(s) under %s", len(files), raw)
    return files


def extract_symbols(
    files: list[Path] | None = None,
    raw_dir: Path | None = None,
    interim_dir: Path | None = None,
    force: bool = False,
) -> dict[str, Path]:
    """Pass 1: split time-ordered DBN files into one Parquet per symbol.

    Resumable: a file already recorded in the marker is skipped, so an
    interrupted ingest picks up where it stopped.
    """
    files = files or discover_dbn_files(raw_dir)
    out = Path(interim_dir or INTERIM_DATA)
    out.mkdir(parents=True, exist_ok=True)
    marker = out / "_ingested_files.txt"

    done: set[str] = set()
    if marker.exists() and not force:
        done = set(marker.read_text().splitlines())

    parts_dir = out / "parts"
    parts_dir.mkdir(exist_ok=True)

    for i, f in enumerate(files, 1):
        if str(f) in done:
            log.info("[%d/%d] %s already ingested; skipping", i, len(files), f.name)
            continue
        log.info("[%d/%d] reading %s", i, len(files), f.name)
        import databento as db

        df = db.DBNStore.from_file(str(f)).to_df()
        if df.empty:
            done.add(str(f))
            continue
        keep = [c for c in KEEP_COLUMNS if c in df.columns]
        df = df[keep]
        df["symbol"] = df["symbol"].map(canonicalize)
        for sym, g in df.groupby("symbol", observed=True):
            if sym not in set(ALL_SYMBOLS):
                continue
            g.to_parquet(parts_dir / f"{sym}__{f.stem}.parquet")
        done.add(str(f))
        marker.write_text("\n".join(sorted(done)))

    # Consolidate each symbol's parts into a single file.
    written: dict[str, Path] = {}
    for sym in ALL_SYMBOLS:
        parts = sorted(parts_dir.glob(f"{sym}__*.parquet"))
        if not parts:
            continue
        target = out / f"{sym}.parquet"
        if target.exists() and not force:
            written[sym] = target
            continue
        frame = pd.concat([pd.read_parquet(p) for p in parts]).sort_index()
        frame = frame[~frame.index.duplicated(keep="last")]
        frame.to_parquet(target)
        written[sym] = target
        log.info("%s: %d rows -> %s", sym, len(frame), target.name)

    log.info("pass 1 complete: %d symbols in %s", len(written), out)
    return written


def load_clean_symbols(
    start: str, end: str, interim_dir: Path | None = None,
    symbols: list[str] | None = None,
) -> tuple[dict[str, pd.DataFrame], pd.DataFrame]:
    """Pass 2a: clean each symbol. Returns `(cleaned, report_table)`."""
    out = Path(interim_dir or INTERIM_DATA)
    files = {p.stem: p for p in out.glob("*.parquet") if p.stem in set(ALL_SYMBOLS)}
    if symbols:
        files = {k: v for k, v in files.items() if k in set(symbols)}
    if not files:
        raise FileNotFoundError(
            f"no per-symbol Parquet under {out}. Run extract_symbols first."
        )

    cleaned, rows = {}, []
    for i, (sym, path) in enumerate(sorted(files.items()), 1):
        raw = pd.read_parquet(path)
        c, rep = clean_symbol(raw, start, end, symbol=sym)
        if c.empty:
            log.warning("%s: nothing survived cleaning; dropping", sym)
            rows.append({**rep.as_dict(), "dropped": True})
            continue
        cleaned[sym] = c
        rows.append({**rep.as_dict(), "dropped": False})
        log.info("[%d/%d] %s: %d RTH rows, %d sessions", i, len(files), sym,
                 rep.n_rth_rows, rep.n_full_sessions)
    return cleaned, pd.DataFrame(rows)


def build_live_panels(
    start: str, end: str, horizons: list[str] | None = None,
    interim_dir: Path | None = None, symbols: list[str] | None = None,
    also_trade_prices: bool = True,
):
    """Pass 2b: cleaned frames -> RV panels (and the trade-price panels)."""
    cleaned, report = load_clean_symbols(start, end, interim_dir, symbols)
    horizons = horizons or list(HORIZONS)
    panels = build_panels(cleaned, horizons=horizons, column="mid")
    trade = (build_panels(cleaned, horizons=horizons, column="trade_price")
             if also_trade_prices else {})
    return panels, trade, report
