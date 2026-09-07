"""HAR-D features: diurnal plus daily/weekly/monthly terms (spec Section 5).

    RV_{i,t+h}^(h) = a + b_tau*D_{i,tau(t+h)} + b_s*RV_{i,t}^(h)
                     + b_d*RV_{i,t}^(d) + b_w*RV_{i,t}^(w) + b_m*RV_{i,t}^(m)

Two definitional choices, both documented as deviations because the paper does
not pin them down:

1. The d/w/m terms are *rolling means of log RV* over the trailing 1, 5 and 21
   days of bins. Working in log space is forced by the spec's "log RV
   throughout" (Section 4.2) and is consistent with the market aggregate, which
   Section 4.4 defines as a mean of log RVs. At the 1-day horizon
   (bins_per_day == 1) this collapses to *exactly* standard HAR: lag-1 daily,
   5-day mean, 21-day mean.

2. The diurnal term `D_{i,tau}` is the mean log RV in the target's own
   bucket-of-day over the trailing 21 days -- days `d-21 .. d-1`, never the
   target's own day. Its furthest lookback is `tau - 21*bins_per_day`, exactly
   the p-lag boundary, so HAR-D uses no information the lag models do not.

At the 1-day horizon the diurnal and intraday terms are dropped, as the spec
requires, and the model reduces to Corsi's HAR.
"""

from __future__ import annotations

import numpy as np

from src.features.lags import lag_windows

HAR_D_COLUMNS = ["diurnal", "rv_h", "rv_d", "rv_w", "rv_m"]
HAR_COLUMNS = ["rv_d", "rv_w", "rv_m"]


def _trailing_mean(series: np.ndarray, p: int, window: int) -> np.ndarray:
    """Mean of the `window` most recent lags, aligned with `lag_windows`."""
    if window > p:
        raise ValueError(f"window {window} exceeds the lag budget p={p}")
    return lag_windows(series, p)[:, :window].mean(axis=1)


def har_features(
    series: np.ndarray,
    p: int,
    bins_per_day: int,
    times: np.ndarray | None = None,
    include_diurnal: bool = True,
) -> tuple[np.ndarray, list[str]]:
    """HAR-D design block for one symbol: `(n, 5)` intraday, `(n, 3)` at 1-day.

    `times` are flat target indices; `None` means every valid target.
    """
    x = np.asarray(series, dtype=np.float64)
    W = lag_windows(x, p)
    daily = bins_per_day
    weekly = 5 * bins_per_day
    monthly = 21 * bins_per_day

    rv_h = W[:, 0]                                    # most recent h-bin log RV
    rv_d = W[:, :daily].mean(axis=1)
    rv_w = W[:, :weekly].mean(axis=1)
    rv_m = W[:, :monthly].mean(axis=1)

    is_daily_horizon = bins_per_day == 1
    if is_daily_horizon or not include_diurnal:
        # Standard HAR: the diurnal and separate intraday terms collapse away,
        # because at bins_per_day == 1 rv_h and rv_d are the same quantity.
        cols = HAR_COLUMNS
        block = np.column_stack([rv_d, rv_w, rv_m])
    else:
        # Bucket-of-day mean over the trailing 21 days: take every
        # bins_per_day-th lag, which lands on the same bucket on prior days.
        diurnal = W[:, daily - 1::daily][:, :21].mean(axis=1)
        cols = HAR_D_COLUMNS
        block = np.column_stack([diurnal, rv_h, rv_d, rv_w, rv_m])

    if times is not None:
        t = np.asarray(times, dtype=np.int64)
        block = block[t - p]
    return np.ascontiguousarray(block), list(cols)


def har_augmented_features(
    series: np.ndarray,
    agg_series: np.ndarray,
    p: int,
    bins_per_day: int,
    times: np.ndarray | None = None,
) -> tuple[np.ndarray, list[str]]:
    """HAR-D with the aggregate's d/w/m terms appended (augmented cells)."""
    own, cols = har_features(series, p, bins_per_day, times)
    agg, agg_cols = har_features(agg_series, p, bins_per_day, times,
                                 include_diurnal=False)
    return (np.ascontiguousarray(np.hstack([own, agg])),
            cols + [f"agg_{c}" for c in agg_cols])


def shar_features(
    log_rv_pos: np.ndarray, log_rv_neg: np.ndarray, series: np.ndarray,
    p: int, bins_per_day: int, times: np.ndarray | None = None,
) -> tuple[np.ndarray, list[str]]:
    """SHAR: lag-1 RV split into signed semivariances (spec Section 11)."""
    Wp = lag_windows(log_rv_pos, p)[:, 0]
    Wn = lag_windows(log_rv_neg, p)[:, 0]
    base, cols = har_features(series, p, bins_per_day, include_diurnal=False)
    # Replace the lag-1 daily term with its signed decomposition.
    block = np.column_stack([Wp, Wn, base[:, 1], base[:, 2]])
    names = ["rv_d_pos", "rv_d_neg", "rv_w", "rv_m"]
    if times is not None:
        block = block[np.asarray(times, dtype=np.int64) - p]
    return np.ascontiguousarray(block), names


def harq_features(
    series: np.ndarray, rq: np.ndarray, p: int, bins_per_day: int,
    times: np.ndarray | None = None,
) -> tuple[np.ndarray, list[str]]:
    """HARQ: HAR plus the realized-quarticity interaction (spec Section 11).

        RV_{t+1} = a + (b_d + b_Q*sqrt(RQ_t))*RV_t^(d) + b_w*RV^(w) + b_m*RV^(m)

    The `sqrt(RQ)*RV_d` product is supplied as an explicit column, so the model
    stays linear in its parameters and OLS recovers b_Q directly.
    """
    base, cols = har_features(series, p, bins_per_day, include_diurnal=False)
    sqrt_rq = np.sqrt(np.maximum(lag_windows(np.asarray(rq, dtype=np.float64), p)[:, 0], 0.0))
    block = np.column_stack([base[:, 0], sqrt_rq * base[:, 0], base[:, 1], base[:, 2]])
    names = ["rv_d", "sqrtRQ_x_rv_d", "rv_w", "rv_m"]
    if times is not None:
        block = block[np.asarray(times, dtype=np.int64) - p]
    return np.ascontiguousarray(block), names


class HARFeatureBuilder:
    """Adapter exposing the `LagBuilder` protocol for HAR-style feature blocks.

    HAR-D is defined on aggregated d/w/m terms rather than raw lags, but the
    scheme runner should not have to special-case it. This wrapper presents the
    same `rows` / `targets` / `iter_chunks` surface, so `ChunkSource` and every
    model work against it unchanged.
    """

    def __init__(self, flat, p, bins_per_day, agg=None, agg_of_symbol=None):
        self.flat = np.asarray(flat, dtype=np.float64)
        self.p = int(p)
        self.bins_per_day = int(bins_per_day)
        self.agg = None if agg is None else np.asarray(agg, dtype=np.float64)
        if self.agg is not None:
            self.agg_of_symbol = (
                np.zeros(self.flat.shape[0], dtype=np.int64)
                if agg_of_symbol is None
                else np.asarray(agg_of_symbol, dtype=np.int64)
            )
        else:
            self.agg_of_symbol = None
        self._cache: dict[int, tuple[np.ndarray, list[str]]] = {}

    @property
    def augmented(self) -> bool:
        return self.agg is not None

    @property
    def n_times(self) -> int:
        return self.flat.shape[1]

    def _block(self, symbol: int):
        if symbol not in self._cache:
            if self.augmented:
                self._cache[symbol] = har_augmented_features(
                    self.flat[symbol], self.agg[int(self.agg_of_symbol[symbol])],
                    self.p, self.bins_per_day,
                )
            else:
                self._cache[symbol] = har_features(
                    self.flat[symbol], self.p, self.bins_per_day
                )
        return self._cache[symbol]

    @property
    def columns(self) -> list[str]:
        return self._block(0)[1]

    @property
    def n_features(self) -> int:
        return self._block(0)[0].shape[1]

    def rows(self, symbol: int, times: np.ndarray) -> np.ndarray:
        block, _ = self._block(int(symbol))
        return block[np.asarray(times, dtype=np.int64) - self.p]

    def targets(self, symbol: int, times: np.ndarray) -> np.ndarray:
        return self.flat[int(symbol)][np.asarray(times, dtype=np.int64)]

    def iter_chunks(self, symbols, times, chunk_size=4096, dtype=np.float64,
                    shuffle=False, seed=0):
        syms = np.asarray(symbols, dtype=np.int64)
        t = np.asarray(times, dtype=np.int64)
        rng = np.random.default_rng(seed)
        if shuffle:
            syms = rng.permutation(syms)
        for s in syms:
            tt = rng.permutation(t) if shuffle else t
            for start in range(0, tt.size, chunk_size):
                blk = tt[start:start + chunk_size]
                yield (np.ascontiguousarray(self.rows(s, blk), dtype=dtype),
                       np.ascontiguousarray(self.targets(s, blk), dtype=dtype),
                       np.full(blk.size, s, dtype=np.int64), blk)
