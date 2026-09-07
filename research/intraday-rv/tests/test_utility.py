"""Spec Phase 3 gate: realized utility.

A perfect forecast must give exactly SR^2/(2*gamma) = 0.04. Asserted before any
RU number is trusted (spec Section 10.4).
"""

import numpy as np
import pytest

from src.config import PERFECT_RU, RISK_AVERSION, SHARPE_RATIO
from src.eval.utility import (
    positions, realized_utility, realized_utility_elementwise,
    realized_utility_tc, rolling_median_spread, trading_costs,
)


@pytest.fixture
def panel():
    rng = np.random.default_rng(0)
    return rng.normal(-14.0, 1.0, (15, 400))


def test_perfect_forecast_gives_sr2_over_2gamma(panel):
    assert PERFECT_RU == SHARPE_RATIO**2 / (2 * RISK_AVERSION)
    assert abs(realized_utility(panel, panel) - PERFECT_RU) < 1e-15


def test_perfect_forecast_elementwise(panel):
    ru = realized_utility_elementwise(panel, panel)
    assert np.allclose(ru, PERFECT_RU, atol=1e-15)


def test_ru_is_maximised_at_the_truth(panel):
    eps = np.linspace(-1.0, 1.0, 41)
    vals = [realized_utility(panel, panel + e) for e in eps]
    assert abs(eps[int(np.argmax(vals))]) < 1e-12
    for v, e in zip(vals, eps):
        if abs(e) > 1e-9:
            assert v < PERFECT_RU


def test_ru_is_scale_free_in_rv_level():
    """RU depends only on the forecast error, not the level of RV."""
    rng = np.random.default_rng(1)
    err = rng.normal(0.0, 0.3, (5, 100))
    lo = rng.normal(-20.0, 1.0, (5, 100))
    hi = lo + 8.0
    assert np.isclose(realized_utility(lo, lo - err),
                      realized_utility(hi, hi - err))


def test_positions_shrink_as_forecast_vol_rises():
    w = positions(np.array([[-14.0, -12.0, -10.0]]))
    assert w[0, 0] > w[0, 1] > w[0, 2]


def test_constant_forecast_incurs_no_trading_cost():
    pred = np.full((3, 50), -14.0)
    spread = np.full((3, 1), 2e-4)
    assert float(np.abs(trading_costs(pred, spread)).max()) == 0.0


def test_ru_tc_equals_ru_when_positions_are_not_scaled(panel):
    spread = np.full((panel.shape[0], 1), 2e-4)
    got = realized_utility_tc(panel, panel, spread, position_scale=0.0)
    assert abs(got - PERFECT_RU) < 1e-15


def test_ru_tc_never_exceeds_ru(panel):
    spread = np.full((panel.shape[0], 1), 5e-4)
    rng = np.random.default_rng(2)
    pred = panel + rng.normal(0.0, 0.3, panel.shape)
    assert realized_utility_tc(panel, pred, spread) <= realized_utility(panel, pred)


def test_trailing_spread_median_excludes_the_current_day():
    x = np.array([[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]])
    r = rolling_median_spread(x, window=3)
    for t in range(1, x.shape[1]):
        lo = max(0, t - 3)
        assert np.isclose(r[0, t], np.median(x[0, lo:t]))
        assert not np.isclose(r[0, t], x[0, t])
