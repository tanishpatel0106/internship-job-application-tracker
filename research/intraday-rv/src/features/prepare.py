"""Fold preparation: winsorization and scaling, train-window-only (spec Section 15).

This module is where the lookahead audit is *enforced structurally* rather than
by convention. Two transforms are fitted per fold:

* winsorization thresholds, per stock, from the training slice only;
* feature mean/variance, accumulated in streaming fashion over training rows only.

Both are then *applied* to validation and test. Applying a train-derived
threshold to test data is not lookahead -- the threshold carries no test
information. Fitting it on the full sample would be, which is why
`fit_fold_transforms` physically receives only the training slice and the
functions that fit take no test argument at all.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from src.config import Fold, WINSOR_LOWER, WINSOR_UPPER

log = logging.getLogger(__name__)


@dataclass
class FoldSplit:
    """Flat target-time indices for one fold, plus the dates they came from."""

    fold: Fold
    train: np.ndarray
    val: np.ndarray
    test: np.ndarray
    warmup: int

    def __post_init__(self) -> None:
        for name in ("train", "val", "test"):
            setattr(self, name, np.asarray(getattr(self, name), dtype=np.int64))
        self.assert_disjoint_and_ordered()

    def assert_disjoint_and_ordered(self) -> None:
        """No overlap, and train < val < test in time. Checked, not assumed."""
        for a, b in (("train", "val"), ("val", "test"), ("train", "test")):
            x, y = getattr(self, a), getattr(self, b)
            overlap = np.intersect1d(x, y)
            if overlap.size:
                raise AssertionError(
                    f"{a}/{b} overlap by {overlap.size} target times "
                    f"(first={overlap[0]})"
                )
        if self.train.size and self.val.size and self.train.max() >= self.val.min():
            raise AssertionError("train extends into the validation window")
        if self.val.size and self.test.size and self.val.max() >= self.test.min():
            raise AssertionError("validation extends into the test window")

    @property
    def train_val(self) -> np.ndarray:
        """Train + validation, for models with no hyperparameters to tune.

        HAR-D and OLS have nothing to select on validation, so the paper trains
        them on the combined window (spec Section 5.2).
        """
        return np.concatenate([self.train, self.val])

    def summary(self) -> dict:
        return {"fold": self.fold.index, "n_train": int(self.train.size),
                "n_val": int(self.val.size), "n_test": int(self.test.size),
                "warmup": self.warmup}


def make_split(panel, fold: Fold, p: int) -> FoldSplit:
    """Flat time indices for a fold, honouring the p-lag warm-up.

    Fold membership is decided by the *target's* date, which is the date the
    forecast is for.
    """
    dates = pd.DatetimeIndex(pd.to_datetime(panel.flat_dates()))
    idx = np.arange(panel.n_times)
    valid = idx >= p                       # 21-day warm-up

    def window(a: str, b: str) -> np.ndarray:
        m = np.asarray((dates >= pd.Timestamp(a)) & (dates <= pd.Timestamp(b)))
        return idx[m & valid]

    return FoldSplit(
        fold=fold,
        train=window(fold.train_start, fold.train_end),
        val=window(fold.val_start, fold.val_end),
        test=window(fold.test_start, fold.test_end),
        warmup=p,
    )


# --- Winsorization -------------------------------------------------------

@dataclass
class WinsorTransform:
    """Per-stock clip bounds fitted on a training slice."""

    lower: np.ndarray            # (n_symbols,)
    upper: np.ndarray            # (n_symbols,)
    n_train_times: int
    quantiles: tuple[float, float]

    def apply(self, flat: np.ndarray) -> np.ndarray:
        """Clip every column with the per-stock train-derived bounds."""
        return np.clip(np.asarray(flat), self.lower[:, None], self.upper[:, None])


def fit_winsor(
    flat: np.ndarray, train_times: np.ndarray,
    lower: float = WINSOR_LOWER, upper: float = WINSOR_UPPER,
) -> WinsorTransform:
    """Fit clip bounds. Takes `train_times` only -- there is no test argument."""
    x = np.asarray(flat, dtype=np.float64)
    t = np.asarray(train_times, dtype=np.int64)
    if t.size == 0:
        raise ValueError("cannot fit winsorization on an empty training window")
    sub = x[:, t]
    lo = np.nanquantile(sub, lower, axis=1)
    hi = np.nanquantile(sub, upper, axis=1)
    return WinsorTransform(lo, hi, int(t.size), (lower, upper))


# --- Streaming standardization -------------------------------------------

@dataclass
class Scaler:
    """Per-feature mean/std, accumulated without materializing the matrix."""

    mean: np.ndarray
    scale: np.ndarray
    n_rows: int

    def transform(self, X: np.ndarray) -> np.ndarray:
        return (np.asarray(X, dtype=np.float64) - self.mean) / self.scale

    def inverse_transform(self, X: np.ndarray) -> np.ndarray:
        return np.asarray(X, dtype=np.float64) * self.scale + self.mean


@dataclass
class _Moments:
    n: int = 0
    total: np.ndarray | None = None
    total_sq: np.ndarray | None = None

    def update(self, X: np.ndarray) -> None:
        X = np.asarray(X, dtype=np.float64)
        if self.total is None:
            self.total = np.zeros(X.shape[1])
            self.total_sq = np.zeros(X.shape[1])
        self.total += X.sum(axis=0)
        self.total_sq += (X ** 2).sum(axis=0)
        self.n += X.shape[0]

    def finish(self, eps: float = 1e-12) -> Scaler:
        if self.n == 0 or self.total is None:
            raise ValueError("no rows accumulated")
        mean = self.total / self.n
        var = np.maximum(self.total_sq / self.n - mean ** 2, 0.0)
        scale = np.sqrt(var)
        # A constant feature scales by 1 rather than dividing by zero.
        scale[scale < eps] = 1.0
        return Scaler(mean, scale, self.n)


def fit_scaler(builder, symbols: np.ndarray, train_times: np.ndarray,
               chunk_size: int = 4096) -> Scaler:
    """Fit a `Scaler` over training rows only, one chunk at a time.

    The signature takes `train_times`; there is deliberately no way to pass
    validation or test times in.
    """
    m = _Moments()
    for X, _, _, _ in builder.iter_chunks(symbols, train_times, chunk_size):
        m.update(X)
    sc = m.finish()
    log.info("scaler fitted on %d training rows x %d features", sc.n_rows,
             sc.mean.size)
    return sc


@dataclass
class PreparedFold:
    """Everything one experiment cell needs, with the fitted transforms."""

    split: FoldSplit
    winsor: WinsorTransform
    flat: np.ndarray                     # winsorized panel
    scaler: Scaler | None = None
    provenance: dict = field(default_factory=dict)


def prepare_fold(panel, fold: Fold, p: int,
                 winsorize: bool = True) -> PreparedFold:
    """Split, then winsorize with train-window-only thresholds."""
    split = make_split(panel, fold, p)
    flat = panel.flat().astype(np.float64)
    if winsorize:
        w = fit_winsor(flat, split.train)
        flat = w.apply(flat)
    else:
        n = flat.shape[0]
        w = WinsorTransform(np.full(n, -np.inf), np.full(n, np.inf),
                            int(split.train.size), (0.0, 1.0))
    return PreparedFold(
        split=split, winsor=w, flat=flat,
        provenance={
            "fold": fold.index, "p": p, "winsorized": winsorize,
            "n_train_times": int(split.train.size),
            "quantiles": list(w.quantiles),
        },
    )
