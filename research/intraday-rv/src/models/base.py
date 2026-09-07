"""Common model interface (spec Section 13, "Model interface contract").

Every family exposes the same `fit(train, val) -> self` and `predict(source)
-> np.ndarray`, taking *chunk sources* rather than materialized arrays, so the
scheme runner can swap any model into any cell without special-casing.

A `ChunkSource` is re-iterable by design. Passing bare generators here would be
a correctness trap: a linear model needs two passes (Gram, then predictions)
and a neural net needs one pass per epoch, and a spent generator fails silently
by yielding nothing.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import numpy as np


@dataclass
class ChunkSource:
    """Re-iterable view over a (symbols x times) grid of an `RVPanel`."""

    builder: object                      # LagBuilder
    symbols: np.ndarray
    times: np.ndarray
    chunk_size: int = 4096
    dtype: type = np.float64
    shuffle: bool = False
    seed: int = 0

    def __post_init__(self) -> None:
        self.symbols = np.atleast_1d(np.asarray(self.symbols, dtype=np.int64))
        self.times = np.asarray(self.times, dtype=np.int64)

    def __iter__(self):
        return self.builder.iter_chunks(
            self.symbols, self.times, self.chunk_size, self.dtype,
            self.shuffle, self.seed,
        )

    def __len__(self) -> int:
        """Number of rows, not chunks."""
        return int(self.symbols.size * self.times.size)

    @property
    def n_features(self) -> int:
        return self.builder.n_features

    def subset(self, symbols=None, times=None, **kw) -> "ChunkSource":
        return ChunkSource(
            self.builder,
            self.symbols if symbols is None else symbols,
            self.times if times is None else times,
            kw.get("chunk_size", self.chunk_size), kw.get("dtype", self.dtype),
            kw.get("shuffle", self.shuffle), kw.get("seed", self.seed),
        )

    def materialize(self) -> tuple[np.ndarray, np.ndarray]:
        """Concatenate into dense arrays.

        Only for small cells (1-day and 65-min) and for tests. Calling this at
        the 10-min horizon under UAM pooling is exactly the 37 GB allocation
        the chunked design exists to avoid, so it refuses above a row budget.
        """
        budget = 60_000_000                       # ~0.5 GB at p=1638 float64/8
        cost = len(self) * self.n_features
        if cost > budget:
            raise MemoryError(
                f"materializing {len(self):,} rows x {self.n_features} features "
                f"({cost * 8 / 1e9:.1f} GB) is what iter_chunks exists to avoid; "
                "use the chunked path"
            )
        Xs, ys = [], []
        for X, y, _, _ in self:
            Xs.append(X)
            ys.append(y)
        if not Xs:
            return (np.empty((0, self.n_features)), np.empty(0))
        return np.vstack(Xs), np.concatenate(ys)

    def ids(self) -> tuple[np.ndarray, np.ndarray]:
        """`(symbol_ids, time_ids)` in the exact order `predict` returns."""
        s, t = [], []
        for _, _, sid, tid in self:
            s.append(sid)
            t.append(tid)
        if not s:
            return np.empty(0, dtype=np.int64), np.empty(0, dtype=np.int64)
        return np.concatenate(s), np.concatenate(t)


class Model(ABC):
    """Base class for every family. Subclasses implement `_fit` and `_predict`."""

    name: str = "model"
    #: Families with nothing to tune train on train+validation (spec Section 5.2).
    uses_validation: bool = True

    def __init__(self, **params):
        self.params = params
        self.fitted_ = False
        self.meta_: dict = {}

    @abstractmethod
    def _fit(self, train: ChunkSource, val: ChunkSource | None) -> None: ...

    @abstractmethod
    def _predict(self, source: ChunkSource) -> np.ndarray: ...

    def fit(self, train: ChunkSource, val: ChunkSource | None = None) -> "Model":
        if len(train) == 0:
            raise ValueError(f"{self.name}: empty training source")
        self._fit(train, val)
        self.fitted_ = True
        return self

    def predict(self, source: ChunkSource) -> np.ndarray:
        if not self.fitted_:
            raise RuntimeError(f"{self.name}: predict() before fit()")
        out = np.asarray(self._predict(source), dtype=np.float64).ravel()
        if out.size != len(source):
            raise AssertionError(
                f"{self.name}: predicted {out.size} values for {len(source)} rows"
            )
        return out

    def importance(self, source: ChunkSource) -> np.ndarray | None:
        """Normalized variable importance, or None if not implemented."""
        return None

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.params})"


@dataclass
class GramAccumulator:
    """Streaming X'X and X'y (spec Section 12.1, pattern 2).

    Cost is O(p^2) in memory and O(n p^2) in time, but crucially the *memory*
    is independent of n: 1638^2 x 8 bytes ~= 21 MB at the 10-min horizon,
    regardless of how many millions of rows stream through.

    A leading intercept column is maintained implicitly, so the solved
    coefficient vector is `[intercept, beta...]`.
    """

    n_features: int
    fit_intercept: bool = True
    xtx: np.ndarray = field(init=False)
    xty: np.ndarray = field(init=False)
    n: int = 0
    yty: float = 0.0

    def __post_init__(self) -> None:
        d = self.n_features + (1 if self.fit_intercept else 0)
        self.xtx = np.zeros((d, d), dtype=np.float64)
        self.xty = np.zeros(d, dtype=np.float64)

    def update(self, X: np.ndarray, y: np.ndarray) -> None:
        X = np.asarray(X, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64).ravel()
        if self.fit_intercept:
            X = np.hstack([np.ones((X.shape[0], 1)), X])
        self.xtx += X.T @ X
        self.xty += X.T @ y
        self.yty += float(y @ y)
        self.n += X.shape[0]

    def consume(self, source: ChunkSource) -> "GramAccumulator":
        for X, y, _, _ in source:
            self.update(X, y)
        return self

    @property
    def dim(self) -> int:
        return self.xtx.shape[0]
