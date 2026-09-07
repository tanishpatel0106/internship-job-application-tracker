"""Spec Phase 3 gate: QLIKE and MSE correctness.

The identity that matters is QLIKE(x, x) == 0 exactly. Getting QLIKE wrong is
the single most common silent failure in replications of this paper, so it is
tested from five directions, not one.
"""

import numpy as np
import pytest

from src.eval.losses import (
    ELEMENTWISE, mse, qlike, qlike_elementwise, squared_error,
)


@pytest.fixture
def panel():
    rng = np.random.default_rng(0)
    return rng.normal(-10.0, 1.0, (20, 500))


def test_qlike_perfect_forecast_is_exactly_zero(panel):
    assert qlike(panel, panel) == 0.0
    assert np.all(qlike_elementwise(panel, panel) == 0.0)


def test_mse_perfect_forecast_is_exactly_zero(panel):
    assert mse(panel, panel) == 0.0


def test_qlike_matches_level_space_definition():
    """QLIKE on logs must equal s2/sh2 - log(s2/sh2) - 1 in levels."""
    for s2, sh2 in [(4.0, 2.5), (0.001, 0.004), (1.0, 1.0), (12.0, 3.0)]:
        expected = s2 / sh2 - np.log(s2 / sh2) - 1.0
        got = qlike(np.array([[np.log(s2)]]), np.array([[np.log(sh2)]]))
        assert np.isclose(got, expected, rtol=1e-12)


def test_qlike_is_minimised_at_the_truth(panel):
    eps = np.linspace(-1.0, 1.0, 41)
    vals = [qlike(panel, panel + e) for e in eps]
    assert abs(eps[int(np.argmin(vals))]) < 1e-12
    for v, e in zip(vals, eps):
        if abs(e) > 1e-9:
            assert v > 0.0


def test_qlike_penalises_under_prediction_more(panel):
    """QLIKE is asymmetric: forecasting too low costs more than too high."""
    assert qlike(panel, panel - 0.5) > qlike(panel, panel + 0.5)


def test_qlike_does_not_overflow_on_extreme_log_rv():
    """exp(a-p) rather than exp(a)/exp(p) keeps large log-RV finite."""
    out = qlike(np.array([[0.0]]), np.array([[-700.0]]))
    assert np.isfinite(out)


def test_losses_average_per_stock_then_across_stocks():
    """An unbalanced-quality panel must weight stocks equally, not rows."""
    a = np.zeros((2, 4))
    p = np.array([[1.0, 1.0, 1.0, 1.0], [0.0, 0.0, 0.0, 0.0]])
    # stock 0 has MSE 1, stock 1 has MSE 0 -> mean over stocks is 0.5
    assert mse(a, p) == 0.5


def test_shape_mismatch_raises():
    with pytest.raises(ValueError):
        qlike(np.zeros((2, 3)), np.zeros((2, 4)))


@pytest.mark.parametrize("name", list(ELEMENTWISE))
def test_elementwise_shapes_match_input(name, panel):
    assert ELEMENTWISE[name](panel, panel + 0.1).shape == panel.shape


def test_1d_input_treated_as_single_stock():
    a = np.array([1.0, 2.0, 3.0])
    assert squared_error(a, a).shape == (1, 3)
    assert qlike(a, a) == 0.0
