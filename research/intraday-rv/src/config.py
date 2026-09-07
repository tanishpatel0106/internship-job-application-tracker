"""Central configuration: horizons, folds, experiment cells, paths.

Everything downstream derives its shapes from `HORIZONS`, so the 390-minute
RTH session and the divisibility constraint (spec Section 4.3) are asserted
here once rather than re-derived.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

# --- Session geometry (spec Sections 2.7, 4.3) ---------------------------

RTH_MINUTES = 390           # 09:30 -> 16:00 ET, exclusive of the 09:30 snapshot
RTH_SNAPSHOTS = 391         # 09:30:00 .. 16:00:00 inclusive
LAG_DAYS = 21               # all features come from the last 21 trading days


@dataclass(frozen=True)
class Horizon:
    name: str
    minutes: int

    @property
    def bins_per_day(self) -> int:
        return RTH_MINUTES // self.minutes

    @property
    def n_lags(self) -> int:
        """p = 21 x bins_per_day (spec Section 4.3)."""
        return LAG_DAYS * self.bins_per_day

    def __post_init__(self) -> None:
        if RTH_MINUTES % self.minutes:
            raise ValueError(
                f"horizon {self.minutes}min does not divide the {RTH_MINUTES}"
                "-minute session evenly"
            )


HORIZONS: dict[str, Horizon] = {
    "10min": Horizon("10min", 10),
    "30min": Horizon("30min", 30),
    "65min": Horizon("65min", 65),
    "1day": Horizon("1day", 390),
}

INTRADAY_HORIZONS = ["10min", "30min", "65min"]


# --- Sample schedule (spec Section 8) ------------------------------------

@dataclass(frozen=True)
class Fold:
    index: int
    train_start: str
    train_end: str
    val_start: str
    val_end: str
    test_start: str
    test_end: str
    label: str = ""


FOLDS: list[Fold] = [
    Fold(1, "2018-05-01", "2021-06-30", "2021-07-01", "2022-06-30",
         "2022-07-01", "2023-06-30"),
    Fold(2, "2018-05-01", "2022-06-30", "2022-07-01", "2023-06-30",
         "2023-07-01", "2024-06-30"),
    Fold(3, "2018-05-01", "2023-06-30", "2023-07-01", "2024-06-30",
         "2024-07-01", "2025-06-30"),
    Fold(4, "2018-05-01", "2024-06-30", "2024-07-01", "2025-06-30",
         "2025-07-01", "2026-06-30"),
]

# Spec Section 8.1: reported separately, never pooled with the main folds.
COVID_PROBE = Fold(
    0, "2018-06-01", "2019-06-30", "2019-07-01", "2019-12-31",
    "2020-01-01", "2020-12-31", label="covid_probe",
)


# --- The 2 x 3 experiment grid (spec Section 1.2) ------------------------
#
# Pooling axis: which stocks' rows enter the training set.
# Feature axis:  what predictors each row carries.
# These are orthogonal; the paper ran only 3 of the 6 cells.

Pooling = Literal["SAM", "CAM", "UAM"]
Features = Literal["own", "augmented"]

POOLINGS: list[str] = ["SAM", "CAM", "UAM"]
FEATURE_SETS: list[str] = ["own", "augmented"]

#: Which paper scheme each cell corresponds to, where one exists.
PAPER_SCHEME: dict[tuple[str, str], str | None] = {
    ("SAM", "own"): "SINGLE",
    ("SAM", "augmented"): None,        # new cell
    ("CAM", "own"): None,              # new cell
    ("CAM", "augmented"): None,        # new cell
    ("UAM", "own"): "UNIVERSAL",
    ("UAM", "augmented"): "AUGMENTED",
}

#: For augmented cells, which aggregate series the extra p features carry.
AGGREGATE_FOR: dict[str, str] = {
    "SAM": "market",     # SAM-augmented uses market RV (spec Section 7)
    "CAM": "cluster",    # CAM-augmented uses the stock's own cluster RV
    "UAM": "market",
}

MODEL_FAMILIES = ["SARIMA", "HAR-D", "OLS", "LASSO", "XGBoost", "MLP", "LSTM"]

#: SARIMA is per-stock by construction (spec Section 5).
SAM_ONLY_MODELS = {"SARIMA"}


# --- Evaluation constants (spec Section 10.4) ----------------------------

SHARPE_RATIO = 0.4
RISK_AVERSION = 2.0
TC_SPREAD_WINDOW = 90       # trailing trading days for the median spread

#: Perfect-forecast realized utility, SR^2 / (2 * gamma). Asserted in tests.
PERFECT_RU = SHARPE_RATIO**2 / (2 * RISK_AVERSION)


# --- Cleaning constants (spec Section 4.6) -------------------------------

WINSOR_LOWER = 0.005
WINSOR_UPPER = 0.995
RV_FLOOR = 1e-12            # floor on the squared-return sum before logging
SPLIT_RETURN_THRESHOLD = 0.20   # |1-min log return| above this => corp action


# --- Paths ---------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
OUTPUTS = ROOT / "outputs"
PANELS = OUTPUTS / "panels"
PREDICTIONS = OUTPUTS / "predictions"
METRICS = OUTPUTS / "metrics"
FIGURES = OUTPUTS / "figures"
TABLES = OUTPUTS / "tables"
RAW_DATA = ROOT / "data" / "raw"
INTERIM_DATA = ROOT / "data" / "interim"


def ensure_dirs() -> None:
    for p in (PANELS, PREDICTIONS, METRICS, FIGURES, TABLES,
              RAW_DATA, INTERIM_DATA):
        p.mkdir(parents=True, exist_ok=True)


# --- Experiment cell -----------------------------------------------------

@dataclass(frozen=True)
class Cell:
    """One point in the (pooling x features x horizon x fold x model) grid."""

    pooling: str
    features: str
    horizon: str
    fold: int
    model: str
    clustering: str = "gics"     # only meaningful when pooling == "CAM"
    n_clusters: int = 8          # only meaningful when pooling == "CAM"
    seeds: int = 10              # NN ensemble size
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.pooling not in POOLINGS:
            raise ValueError(f"unknown pooling {self.pooling!r}")
        if self.features not in FEATURE_SETS:
            raise ValueError(f"unknown feature set {self.features!r}")
        if self.horizon not in HORIZONS:
            raise ValueError(f"unknown horizon {self.horizon!r}")
        if self.model in SAM_ONLY_MODELS and self.pooling != "SAM":
            raise ValueError(f"{self.model} is per-stock only; got {self.pooling}")

    @property
    def n_features(self) -> int:
        p = HORIZONS[self.horizon].n_lags
        return 2 * p if self.features == "augmented" else p

    @property
    def aggregate(self) -> str | None:
        return AGGREGATE_FOR[self.pooling] if self.features == "augmented" else None

    @property
    def paper_scheme(self) -> str | None:
        return PAPER_SCHEME[(self.pooling, self.features)]

    def key(self) -> str:
        parts = [self.pooling, self.features, self.horizon, f"f{self.fold}",
                 self.model]
        if self.pooling == "CAM":
            parts.append(f"{self.clustering}k{self.n_clusters}")
        return "_".join(parts)

    def config_hash(self) -> str:
        """Stable hash of the full config, recorded in every cache manifest."""
        blob = json.dumps(asdict(self), sort_keys=True, default=str)
        return hashlib.sha256(blob.encode()).hexdigest()[:16]
