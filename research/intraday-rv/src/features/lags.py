"""Lazy lag views into the RV panel (spec Sections 7 and 12.1).

The design matrix is never materialized. At the 10-min horizon, UAM-augmented,
fold 4, it would be ~93 stocks x ~1550 days x 39 bins x 1638 features x 4 bytes
~= 37 GB. Instead:

* `lag_windows` returns a `sliding_window_view` -- a genuine zero-copy view --
  into the flat per-stock series, reversed so column j is lag j+1;
* `LagBuilder.iter_chunks` assembles small `(chunk, p)` blocks on demand, which
  is all any consumer (Gram accumulation, a torch `Dataset`, XGBoost binning)
  ever needs.

Alignment, stated once because everything depends on it. For a target at flat
time index `tau`, the features are `x[tau-1], x[tau-2], ..., x[tau-p]`: strictly
past, never including `tau` itself. Valid targets are `p <= tau < T`, which is
exactly the 21-trading-day warm-up the spec requires.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view


def lag_windows(series: np.ndarray, p: int) -> np.ndarray:
    """Zero-copy `(T-p, p)` lag view; row k is the feature vector for tau=k+p.

    Column j holds lag j+1, i.e. `out[k, 0] == series[k+p-1]` is the most
    recent observation and `out[k, p-1] == series[k]` is the oldest.
    """
    x = np.asarray(series)
    if x.ndim != 1:
        raise ValueError(f"expected a 1-D series, got {x.ndim}-D")
    if p < 1:
        raise ValueError("p must be >= 1")
    if x.size <= p:
        raise ValueError(f"series of length {x.size} is too short for p={p}")
    w = sliding_window_view(x, p)          # (T-p+1, p), row k = x[k:k+p]
    return w[:-1, ::-1]                    # drop the target-less last row; reverse


def target_slice(series: np.ndarray, p: int) -> np.ndarray:
    """Targets aligned with `lag_windows`: `series[p:]`."""
    return np.asarray(series)[p:]


def valid_target_times(n_times: int, p: int) -> np.ndarray:
    """Flat time indices that have a full lag window behind them."""
    return np.arange(p, n_times)


@dataclass
class LagBuilder:
    """Assembles feature chunks from a flat RV panel without materializing it.

    Parameters
    ----------
    flat:
        `(n_symbols, n_times)` log-RV, already winsorized with train-window
        thresholds for the fold in question.
    p:
        Number of own lags, `21 * bins_per_day`.
    agg:
        `(n_agg_series, n_times)` aggregate log-RV. One row for a market
        aggregate; one row per cluster for CAM. `None` for own-only cells.
    agg_of_symbol:
        `(n_symbols,)` mapping each symbol to its row in `agg`. All zeros for a
        market aggregate.
    """

    flat: np.ndarray
    p: int
    agg: np.ndarray | None = None
    agg_of_symbol: np.ndarray | None = None

    def __post_init__(self) -> None:
        self.flat = np.asarray(self.flat)
        if self.flat.ndim != 2:
            raise ValueError("flat must be (n_symbols, n_times)")
        if self.agg is not None:
            self.agg = np.asarray(self.agg)
            if self.agg.ndim != 2 or self.agg.shape[1] != self.flat.shape[1]:
                raise ValueError("agg must be (n_agg_series, n_times)")
            if self.agg_of_symbol is None:
                if self.agg.shape[0] != 1:
                    raise ValueError(
                        "agg_of_symbol is required when agg has multiple rows"
                    )
                self.agg_of_symbol = np.zeros(self.n_symbols, dtype=np.int64)
            self.agg_of_symbol = np.asarray(self.agg_of_symbol, dtype=np.int64)
            if self.agg_of_symbol.size != self.n_symbols:
                raise ValueError("agg_of_symbol must have one entry per symbol")

    @property
    def n_symbols(self) -> int:
        return self.flat.shape[0]

    @property
    def n_times(self) -> int:
        return self.flat.shape[1]

    @property
    def augmented(self) -> bool:
        return self.agg is not None

    @property
    def n_features(self) -> int:
        return 2 * self.p if self.augmented else self.p

    # --- row assembly ---

    def own_block(self, symbol: int, times: np.ndarray) -> np.ndarray:
        """`(len(times), p)` own-lag block. This is the byte-identity anchor.

        It depends only on the symbol, the target times and `p` -- never on the
        pooling scheme -- which is what makes the Section 15 feature-set
        identity gate pass by construction rather than by convention.
        """
        t = np.asarray(times, dtype=np.int64)
        if t.size and (t.min() < self.p or t.max() >= self.n_times):
            raise IndexError(
                f"target times must lie in [{self.p}, {self.n_times}); "
                f"got [{t.min()}, {t.max()}]"
            )
        return lag_windows(self.flat[symbol], self.p)[t - self.p]

    def agg_block(self, symbol: int, times: np.ndarray) -> np.ndarray:
        """`(len(times), p)` aggregate-lag block for this symbol's aggregate."""
        if not self.augmented:
            raise ValueError("this builder has no aggregate series")
        row = int(self.agg_of_symbol[symbol])
        t = np.asarray(times, dtype=np.int64)
        return lag_windows(self.agg[row], self.p)[t - self.p]

    def rows(self, symbol: int, times: np.ndarray) -> np.ndarray:
        """Full feature block: own lags, then aggregate lags if augmented."""
        own = self.own_block(symbol, times)
        if not self.augmented:
            return own
        return np.hstack([own, self.agg_block(symbol, times)])

    def targets(self, symbol: int, times: np.ndarray) -> np.ndarray:
        return self.flat[symbol][np.asarray(times, dtype=np.int64)]

    # --- chunked iteration ---

    def iter_chunks(
        self,
        symbols: np.ndarray,
        times: np.ndarray,
        chunk_size: int = 4096,
        dtype=np.float64,
        shuffle: bool = False,
        seed: int = 0,
    ):
        """Yield `(X, y, symbol_ids, time_ids)` blocks over the (symbol, time) grid.

        Chunks never cross a symbol boundary, which keeps every block a
        contiguous slice of one symbol's lag view.
        """
        syms = np.asarray(symbols, dtype=np.int64)
        t = np.asarray(times, dtype=np.int64)
        if shuffle:
            rng = np.random.default_rng(seed)
            syms = rng.permutation(syms)
        for s in syms:
            tt = rng.permutation(t) if shuffle else t
            for start in range(0, tt.size, chunk_size):
                block = tt[start:start + chunk_size]
                X = np.ascontiguousarray(self.rows(s, block), dtype=dtype)
                y = np.ascontiguousarray(self.targets(s, block), dtype=dtype)
                yield X, y, np.full(block.size, s, dtype=np.int64), block

    def n_rows(self, symbols: np.ndarray, times: np.ndarray) -> int:
        return int(len(symbols) * len(times))

    # --- LSTM shaping (spec Section 5.1, DECISION) ---

    def sequence_rows(
        self, symbol: int, times: np.ndarray, bins_per_day: int,
    ) -> np.ndarray:
        """`(n, 21, bins_per_day * n_series)` sequences for the recurrent nets.

        The naive shaping is `p` timesteps of one feature -- 819 steps at
        10-min, impractically deep for an LSTM. The spec's DECISION is to make
        the *trading day* the sequence unit: 21 timesteps, each carrying that
        day's bin vector. Under augmented cells the aggregate's bin vector is
        concatenated along the feature axis (21 x 78 at 10-min).

        Timesteps run oldest-first, which is the order an LSTM expects.
        """
        own = self.own_block(symbol, times)                 # (n, p), lag-1 first
        n = own.shape[0]
        days = self.p // bins_per_day
        if days * bins_per_day != self.p:
            raise ValueError(f"p={self.p} is not a multiple of {bins_per_day}")
        # Reverse to chronological order, then split into day blocks.
        seq = own[:, ::-1].reshape(n, days, bins_per_day)
        if not self.augmented:
            return np.ascontiguousarray(seq)
        agg = self.agg_block(symbol, times)[:, ::-1].reshape(n, days, bins_per_day)
        return np.ascontiguousarray(np.concatenate([seq, agg], axis=2))
