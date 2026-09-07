"""Spec Section 15: the validation gates, as executable assertions.

These are the checks a referee would run. Each is written so that it fails if
the guarantee is ever broken by a future edit, not merely documented as true.
"""

import numpy as np
import pandas as pd
import pytest

from src.clustering.fit import fit_clusters
from src.config import HORIZONS, Cell, Fold
from src.data.clean import clean_symbol
from src.data.panel import (
    build_panels, intraday_returns, log_rv, session_matrix,
)
from src.data.synthetic import generate_panel
from src.features.aggregates import cluster_rv, market_rv
from src.features.lags import LagBuilder, lag_windows
from src.features.prepare import fit_scaler, fit_winsor, make_split
from src.schemes.runner import build_aggregate, build_feature_source, training_groups

START, END = "2022-01-03", "2022-09-30"
SYMS = [f"S{i:02d}" for i in range(6)]


@pytest.fixture(scope="module")
def panels():
    raw = generate_panel(SYMS, START, END, seed=5)
    cleaned = {s: clean_symbol(d, START, END, symbol=s)[0] for s, d in raw.items()}
    return build_panels(cleaned, horizons=["65min", "1day"])


# --- Gate: timestamp audit -----------------------------------------------

def test_no_shift_applied_before_differencing(panels):
    """Hand-compute one stock-day's RV from raw quotes and match the panel."""
    raw = generate_panel(["Z"], START, "2022-01-14", seed=5)["Z"]
    clean, _ = clean_symbol(raw, START, "2022-01-14", symbol="Z")

    mat, dates = session_matrix(clean)
    day = 3
    mids = mat[day]
    assert mids.size == 391

    # By hand: 390 within-session returns, summed in squares over 65-min bins.
    manual = np.diff(np.log(mids))
    assert manual.size == 390
    bin0 = float(np.log(np.sum(manual[:65] ** 2)))

    r = intraday_returns(mat)
    lrv, _ = log_rv(r, 6)
    assert np.isclose(lrv[day, 0], bin0, rtol=1e-12)


def test_first_return_of_session_is_0931_vs_0930(panels):
    """An overnight return must be unconstructible, not merely unconstructed."""
    raw = generate_panel(["Z"], START, "2022-01-14", seed=5)["Z"]
    clean, _ = clean_symbol(raw, START, "2022-01-14", symbol="Z")
    mat, _ = session_matrix(clean)
    r = intraday_returns(mat)
    # Row d holds only day d's returns: the close-to-open gap never appears.
    assert r.shape[1] == 390
    manual_day1 = np.diff(np.log(mat[1]))
    assert np.allclose(r[1], manual_day1)
    overnight = np.log(mat[1][0] / mat[0][-1])
    assert not np.any(np.isclose(r[1], overnight, atol=1e-15)) or overnight == 0.0


def test_rth_filter_uses_eastern_time_across_dst():
    """A fixed UTC offset would corrupt half the panel; ET must be used."""
    raw = generate_panel(["Z"], "2022-03-07", "2022-03-18", seed=1)["Z"]
    clean, _ = clean_symbol(raw, "2022-03-07", "2022-03-18", symbol="Z")
    et = clean.index
    assert str(et.tz) == "America/New_York"
    # Every session starts 09:30 and ends 16:00 *local*, spanning the 13 March
    # DST transition; the corresponding UTC hour differs before and after.
    times = pd.Series(et.strftime("%H:%M"))
    assert times.min() == "09:30" and times.max() == "16:00"
    utc_hours = set(et.tz_convert("UTC").hour)
    assert len(utc_hours) > 1


# --- Gate: lookahead audit -----------------------------------------------

def test_winsor_thresholds_ignore_the_test_window():
    rng = np.random.default_rng(0)
    flat = rng.normal(0.0, 1.0, (3, 1000))
    train = np.arange(600)
    before = fit_winsor(flat, train)
    flat_poisoned = flat.copy()
    flat_poisoned[:, 800:] += 50.0
    after = fit_winsor(flat_poisoned, train)
    assert np.allclose(before.lower, after.lower)
    assert np.allclose(before.upper, after.upper)


def test_scaler_sees_training_rows_only():
    rng = np.random.default_rng(0)
    flat = rng.normal(0.0, 1.0, (3, 1000))
    flat[:, 600:] += 40.0
    b = LagBuilder(flat, p=10)
    train_only = fit_scaler(b, np.arange(3), np.arange(10, 600))
    with_test = fit_scaler(b, np.arange(3), np.arange(10, 1000))
    assert not np.allclose(train_only.mean, with_test.mean)
    assert abs(train_only.mean[0]) < 1.0        # unpoisoned


def test_clusters_are_fitted_on_the_training_window_only():
    rng = np.random.default_rng(0)
    T = 1000
    f = [rng.normal(0, 1, T) for _ in range(2)]
    flat = np.array([0.9 * f[i // 4] + 0.3 * rng.normal(0, 1, T) for i in range(8)])
    syms = [f"S{i}" for i in range(8)]
    train = np.arange(600)
    a = fit_clusters(flat, syms, train, "spectral", 2)
    poisoned = flat.copy()
    poisoned[:, 600:] = rng.normal(0, 50, (8, 400))
    b = fit_clusters(poisoned, syms, train, "spectral", 2)
    assert np.array_equal(a.labels, b.labels)
    assert a.train_window == (0, 599)


def test_lag_features_are_strictly_past():
    x = np.arange(50.0)
    p = 7
    W = lag_windows(x, p)
    for k in range(W.shape[0]):
        tau = k + p
        assert W[k].max() < x[tau]
        # Column j is lag j+1: explicit indices avoid a wrapping negative slice.
        expected = np.array([x[tau - 1 - j] for j in range(p)])
        assert np.array_equal(W[k], expected)


def test_fold_split_windows_are_disjoint_and_ordered(panels):
    p = HORIZONS["65min"].n_lags
    fold = Fold(1, START, "2022-04-30", "2022-05-01", "2022-07-31",
                "2022-08-01", END)
    split = make_split(panels["65min"], fold, p)
    split.assert_disjoint_and_ordered()          # raises on violation
    assert split.train.min() >= p                # 21-day warm-up honoured


# --- Gate: feature-set identity ------------------------------------------

def test_own_lag_block_is_byte_identical_across_poolings(panels):
    """The pooling axis must not leak into the feature axis (spec Section 15).

    SAM, CAM and UAM at the same horizon and feature configuration must receive
    byte-identical own-lag vectors for any given stock-timestamp. The check is
    on *unscaled* features: the scaler is deliberately fitted on each cell's own
    training rows, so scaled features differ by design.
    """
    panel = panels["65min"]
    p = HORIZONS["65min"].n_lags
    flat = panel.flat().astype(np.float64)
    member = np.ones(panel.n_symbols, dtype=bool)
    labels = np.array([i % 2 for i in range(panel.n_symbols)])
    times = np.arange(p, p + 40)

    blocks = {}
    for pooling in ("SAM", "CAM", "UAM"):
        for feats in ("own", "augmented"):
            cell = Cell(pooling, feats, "65min", 1, "OLS")
            agg, agg_of = build_aggregate(cell, flat, member, labels)
            builder = build_feature_source(cell, flat, agg, agg_of, "65min")
            blocks[(pooling, feats)] = builder.own_block(2, times)

    ref = blocks[("SAM", "own")]
    for key, blk in blocks.items():
        assert blk.shape == ref.shape, key
        assert blk.tobytes() == ref.tobytes(), (
            f"own-lag block for {key} differs from SAM/own -- the pooling axis "
            "has leaked into the feature axis"
        )


def test_augmented_aggregate_differs_by_design(panels):
    """CAM carries cluster RV, UAM carries market RV. That difference is the point."""
    panel = panels["65min"]
    p = HORIZONS["65min"].n_lags
    flat = panel.flat().astype(np.float64)
    member = np.ones(panel.n_symbols, dtype=bool)
    labels = np.array([i % 2 for i in range(panel.n_symbols)])
    times = np.arange(p, p + 20)

    cam = Cell("CAM", "augmented", "65min", 1, "OLS")
    uam = Cell("UAM", "augmented", "65min", 1, "OLS")
    a_cam, of_cam = build_aggregate(cam, flat, member, labels)
    a_uam, of_uam = build_aggregate(uam, flat, member, labels)
    b_cam = build_feature_source(cam, flat, a_cam, of_cam, "65min")
    b_uam = build_feature_source(uam, flat, a_uam, of_uam, "65min")
    assert not np.allclose(b_cam.agg_block(0, times), b_uam.agg_block(0, times))
    assert a_cam.shape[0] == 2 and a_uam.shape[0] == 1


def test_feature_widths_match_the_spec(panels):
    for horizon, expected_p in [("65min", 126), ("1day", 21)]:
        assert HORIZONS[horizon].n_lags == expected_p
        assert Cell("UAM", "own", horizon, 1, "OLS").n_features == expected_p
        assert Cell("UAM", "augmented", horizon, 1, "OLS").n_features == 2 * expected_p


# --- Gate: unseen stocks never train -------------------------------------

def test_unseen_stocks_never_enter_a_training_group():
    labels = np.array([0, 0, 1, 1, 2, 2, 0, 2])
    member = np.array([True] * 6 + [False, False])
    for pooling in ("SAM", "CAM", "UAM"):
        groups = training_groups(pooling, 8, labels, member)
        for g in groups.values():
            assert 6 not in g and 7 not in g


def test_market_aggregate_excludes_unseen_stocks():
    flat = np.arange(24.0).reshape(4, 6)
    member = np.array([True, True, True, False])
    agg = market_rv(flat, member)
    assert np.allclose(agg[0], flat[:3].mean(axis=0))
    assert not np.allclose(agg[0], flat.mean(axis=0))


def test_cluster_aggregate_excludes_unseen_from_its_own_mean():
    flat = np.arange(24.0).reshape(4, 6)
    labels = np.array([0, 0, 1, 1])
    member = np.array([True, True, True, False])
    agg, of = cluster_rv(flat, labels, member)
    assert np.allclose(agg[1], flat[2])          # row 3 excluded from cluster 1
    assert of[3] == 1                            # but still reads cluster 1


# --- Gate: session geometry ----------------------------------------------

def test_every_session_has_exactly_391_snapshots(panels):
    raw = generate_panel(["Z"], START, END, seed=3)["Z"]
    clean, report = clean_symbol(raw, START, END, symbol="Z")
    counts = clean.groupby(clean.index.normalize().date).size()
    assert set(counts.to_numpy().tolist()) == {391}
    assert report.n_nan_quotes == 0


def test_horizons_divide_the_session_evenly():
    for name, h in HORIZONS.items():
        assert 390 % h.minutes == 0
        assert h.bins_per_day * h.minutes == 390
        assert h.n_lags == 21 * h.bins_per_day
