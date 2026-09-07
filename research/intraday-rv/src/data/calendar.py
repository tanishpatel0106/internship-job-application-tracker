"""NYSE/Nasdaq session calendar: full sessions vs. half-days (spec Section 2.7).

DECISION (spec Section 2.7): half-days are dropped entirely from the intraday
panel, because an early 13:00 ET close yields ~210 minutes and therefore ragged
bin counts at every horizon. This module is the single source of truth for
which sessions survive, and it logs the drop count.

`exchange_calendars` is used when installed; otherwise a hard-coded table of
US equity early closes covering 2018-2026 is used. Either way the result is
cross-checked against the data itself in `clean.py`, which flags any session
whose observed snapshot count disagrees with the calendar.
"""

from __future__ import annotations

import datetime as dt
import logging
from functools import lru_cache

import pandas as pd

from src.config import RTH_SNAPSHOTS

log = logging.getLogger(__name__)

#: US equity early closes (13:00 ET) 2018-2026. Independence Day, Thanksgiving
#: Friday, and Christmas Eve when they fall on a weekday, plus Black Friday.
#: Used only when `exchange_calendars` is unavailable.
_FALLBACK_EARLY_CLOSES = [
    "2018-07-03", "2018-11-23", "2018-12-24",
    "2019-07-03", "2019-11-29", "2019-12-24",
    "2020-11-27", "2020-12-24",
    "2021-11-26",
    "2022-11-25",
    "2023-07-03", "2023-11-24",
    "2024-07-03", "2024-11-29", "2024-12-24",
    "2025-07-03", "2025-11-28", "2025-12-24",
    "2026-07-02", "2026-11-27", "2026-12-24",
]


@lru_cache(maxsize=4)
def _xnys():
    try:
        import exchange_calendars as xcals
    except ImportError:
        return None
    try:
        return xcals.get_calendar("XNYS")
    except Exception as exc:  # pragma: no cover - calendar data problem
        log.warning("exchange_calendars present but XNYS unavailable: %s", exc)
        return None


def sessions(start: str, end: str) -> pd.DatetimeIndex:
    """All trading sessions in [start, end], as tz-naive dates."""
    cal = _xnys()
    if cal is not None:
        idx = cal.sessions_in_range(start, end)
        return pd.DatetimeIndex(pd.to_datetime(idx).tz_localize(None).normalize())
    # Fallback: weekdays minus a conservative US holiday list.
    days = pd.bdate_range(start, end)
    return pd.DatetimeIndex([d for d in days if d.normalize() not in _holidays()])


@lru_cache(maxsize=1)
def _holidays() -> frozenset:
    """Conservative US market holiday set for the fallback path."""
    from pandas.tseries.holiday import USFederalHolidayCalendar

    hol = USFederalHolidayCalendar().holidays("2018-01-01", "2027-01-01")
    extra = pd.to_datetime([
        # Good Fridays 2018-2026 (not a federal holiday, but markets close).
        "2018-03-30", "2019-04-19", "2020-04-10", "2021-04-02", "2022-04-15",
        "2023-04-07", "2024-03-29", "2025-04-18", "2026-04-03",
        # One-off closures.
        "2018-12-05",  # G.H.W. Bush national day of mourning
        "2025-01-09",  # Carter national day of mourning
    ])
    return frozenset(pd.DatetimeIndex(hol).normalize()) | frozenset(extra.normalize())


def early_closes(start: str, end: str) -> pd.DatetimeIndex:
    """Sessions with an early (13:00 ET) close in [start, end]."""
    cal = _xnys()
    if cal is not None:
        sess = cal.sessions_in_range(start, end)
        closes = cal.closes.reindex(sess).dt.tz_convert("America/New_York")
        short = closes[closes.dt.hour < 16]
        return pd.DatetimeIndex(
            pd.to_datetime(short.index).tz_localize(None).normalize()
        )
    within = [d for d in pd.to_datetime(_FALLBACK_EARLY_CLOSES)
              if pd.Timestamp(start) <= d <= pd.Timestamp(end)]
    return pd.DatetimeIndex(within).normalize()


def full_sessions(start: str, end: str) -> pd.DatetimeIndex:
    """Sessions that run the full 09:30-16:00 ET, i.e. the modelling calendar.

    This is the calendar the RV panel is built on. Half-days are excluded per
    the Section 2.7 DECISION.
    """
    allsess = sessions(start, end)
    short = set(early_closes(start, end))
    keep = pd.DatetimeIndex([d for d in allsess if d not in short])
    n_dropped = len(allsess) - len(keep)
    log.info(
        "calendar %s..%s: %d sessions, %d half-days dropped, %d full sessions "
        "(source=%s)",
        start, end, len(allsess), n_dropped, len(keep),
        "exchange_calendars" if _xnys() is not None else "fallback-table",
    )
    return keep


def half_day_report(start: str, end: str) -> pd.DataFrame:
    """Per-session table of what the calendar expects, for the Phase 1 gate."""
    allsess = sessions(start, end)
    short = set(early_closes(start, end))
    return pd.DataFrame({
        "session": allsess,
        "is_half_day": [d in short for d in allsess],
        "expected_snapshots": [
            RTH_SNAPSHOTS if d not in short else None for d in allsess
        ],
    }).set_index("session")


def rth_bounds(session: dt.date) -> tuple[pd.Timestamp, pd.Timestamp]:
    """(09:30, 16:00) ET bounds for a full session, tz-aware."""
    day = pd.Timestamp(session).normalize()
    tz = "America/New_York"
    return (day.tz_localize(tz) + pd.Timedelta(hours=9, minutes=30),
            day.tz_localize(tz) + pd.Timedelta(hours=16))
