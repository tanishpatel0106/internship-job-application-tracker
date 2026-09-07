"""Spec Phase 3 gate: DM and MCS reproduce a known ordering.

These are correctness assertions on the metric code, not synthetic *results*:
each test constructs a forecast pair whose true ordering is known by
construction and checks the machinery recovers it.
"""

import numpy as np
import pytest

from src.eval.dm import (
    diebold_mariano, newey_west_var, nw_bandwidth, pairwise_table,
)
from src.eval.mcs import model_confidence_set


@pytest.fixture
def known_ordering():
    rng = np.random.default_rng(3)
    actual = rng.normal(-10.0, 1.0, (30, 600))
    good = actual + rng.normal(0.0, 0.20, actual.shape)
    bad = actual + rng.normal(0.0, 0.60, actual.shape)
    return actual, good, bad


def test_dm_recovers_the_known_ordering(known_ordering):
    actual, good, bad = known_ordering
    r = diebold_mariano(actual, good, bad, "qlike")
    assert r.better == "a"
    assert r.stat < 0
    assert r.pvalue < 0.01


def test_dm_is_antisymmetric(known_ordering):
    actual, good, bad = known_ordering
    fwd = diebold_mariano(actual, good, bad, "qlike")
    rev = diebold_mariano(actual, bad, good, "qlike")
    assert np.isclose(rev.stat, -fwd.stat)
    assert rev.better == "b"


def test_dm_reports_a_tie_for_identical_forecasts(known_ordering):
    actual, good, _ = known_ordering
    r = diebold_mariano(actual, good, good, "qlike")
    assert r.better == "tie"
    assert r.mean_diff == 0.0


@pytest.mark.parametrize("loss", ["qlike", "mse"])
def test_dm_ordering_holds_under_both_losses(known_ordering, loss):
    actual, good, bad = known_ordering
    assert diebold_mariano(actual, good, bad, loss).better == "a"


def test_dm_has_approximately_correct_size():
    """Two equally-good forecasts should reject at roughly the nominal rate."""
    rejects = 0
    reps = 200
    for k in range(reps):
        rng = np.random.default_rng(1000 + k)
        a = rng.normal(-10.0, 1.0, (20, 250))
        p1 = a + rng.normal(0.0, 0.4, a.shape)
        p2 = a + rng.normal(0.0, 0.4, a.shape)
        if diebold_mariano(a, p1, p2, "qlike").pvalue < 0.05:
            rejects += 1
    assert 0.01 < rejects / reps < 0.15


def test_newey_west_inflates_variance_under_serial_correlation():
    e = np.random.default_rng(5).normal(0.0, 1.0, 2000)
    ar = np.zeros(2000)
    for i in range(1, 2000):
        ar[i] = 0.8 * ar[i - 1] + e[i]
    assert newey_west_var(ar) > 2.0 * ar.var()


def test_newey_west_bandwidth_matches_the_plug_in_rule():
    for n in (100, 250, 600, 2000):
        assert nw_bandwidth(n) == int(np.floor(4.0 * (n / 100.0) ** (2.0 / 9.0)))


def test_pairwise_table_is_antisymmetric(known_ordering):
    actual, good, bad = known_ordering
    stat, pval = pairwise_table(actual, {"good": good, "bad": bad})
    assert np.isclose(stat.loc["good", "bad"], -stat.loc["bad", "good"])
    assert np.isclose(pval.loc["good", "bad"], pval.loc["bad", "good"])
    assert np.isnan(stat.loc["good", "good"])


@pytest.fixture
def mcs_panel():
    rng = np.random.default_rng(11)
    actual = rng.normal(-10.0, 1.0, (25, 500))
    return actual, {
        "best": actual + rng.normal(0.0, 0.15, actual.shape),
        "tied": actual + rng.normal(0.0, 0.15, actual.shape),
        "mid": actual + rng.normal(0.0, 0.45, actual.shape),
        "worst": actual + rng.normal(0.0, 1.10, actual.shape),
    }


@pytest.mark.parametrize("prefer", ["arch", "local"])
def test_mcs_keeps_the_best_and_drops_the_worst(mcs_panel, prefer):
    actual, preds = mcs_panel
    r = model_confidence_set(actual, preds, "qlike", alpha=0.05, n_boot=400,
                             seed=1, prefer=prefer)
    assert "best" in r.included
    assert "worst" not in r.included


def test_both_mcs_implementations_agree(mcs_panel):
    """The local fallback cross-checks arch, so neither can drift unnoticed."""
    actual, preds = mcs_panel
    a = model_confidence_set(actual, preds, "qlike", 0.05, 400, seed=1, prefer="arch")
    b = model_confidence_set(actual, preds, "qlike", 0.05, 400, seed=1, prefer="local")
    assert a.method == "arch" and b.method == "local"
    assert sorted(a.included) == sorted(b.included)


def test_mcs_with_a_single_model_is_trivially_that_model(mcs_panel):
    actual, preds = mcs_panel
    r = model_confidence_set(actual, {"only": preds["best"]})
    assert r.included == ["only"]
