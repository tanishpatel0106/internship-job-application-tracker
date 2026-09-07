"""Spec Section 10.5: importance, periodicity, interaction effects."""

import numpy as np

from src.eval.importance import (
    daily_periodicity_score, delta_qlike_by_quintile,
    finite_difference_importance, interaction_curves, interaction_diagnostics,
    lag_decay_slope, linear_importance,
)


def test_finite_difference_reduces_to_normalized_abs_coefficients():
    """The definition must agree with its closed form in the linear case."""
    beta = np.array([3.0, -1.0, 0.5, 0.0, 2.0])
    X = np.random.default_rng(0).normal(0.0, 1.0, (4000, 5))
    fd = finite_difference_importance(lambda Z: Z @ beta, X)
    assert np.allclose(fd, linear_importance(beta), atol=1e-6)
    assert np.isclose(fd.sum(), 1.0)


def test_daily_periodicity_score_detects_planted_spikes():
    imp = np.full(120, 0.01)
    imp[38::39] = 0.2                      # spike every 39th lag
    assert daily_periodicity_score(imp, 39) > 5.0
    assert np.isclose(daily_periodicity_score(np.full(120, 0.01), 39), 1.0)


def test_lag_decay_slope_recovers_a_planted_exponent():
    imp = 1.0 / np.arange(1, 101) ** 0.8
    assert abs(lag_decay_slope(imp) + 0.8) < 0.01


def test_interaction_curves_detect_non_parallelism_and_convergence():
    """The paper's finding: non-parallel curves that converge at high own-RV."""
    def predict(X):
        return X[:, 0] + X[:, 1] * (1.0 - X[:, 0] / 10.0)

    grid = np.linspace(0.0, 10.0, 50)
    curves = interaction_curves(predict, grid, {"Q1": -2.0, "Q3": 0.0, "Q5": 2.0},
                                np.zeros(3), own_index=0, agg_index=1)
    d = interaction_diagnostics(curves)
    assert d["non_parallel"]
    assert d["converges_at_high_own_rv"]
    assert d["convergence_ratio"] < 0.5


def test_additive_model_shows_no_interaction():
    def predict(X):
        return X[:, 0] + X[:, 1]

    grid = np.linspace(0.0, 10.0, 50)
    d = interaction_diagnostics(
        interaction_curves(predict, grid, {"Q1": -2.0, "Q5": 2.0},
                           np.zeros(3), 0, 1)
    )
    assert not d["non_parallel"]
    assert not d["converges_at_high_own_rv"]


def test_delta_qlike_improvement_rises_with_commonality():
    rng = np.random.default_rng(2)
    n_s, n_t = 50, 300
    comm = rng.uniform(0.1, 0.9, n_s)
    actual = rng.normal(-10.0, 1.0, (n_s, n_t))
    a = actual + rng.normal(0.0, 1.0, (n_s, n_t)) * (1.0 - comm)[:, None]
    b = actual + rng.normal(0.0, 1.0, (n_s, n_t)) * 0.55
    tab = delta_qlike_by_quintile(actual, a, b, comm)
    assert len(tab) == 5
    assert tab["pct_improvement"].iloc[-1] > tab["pct_improvement"].iloc[0]
