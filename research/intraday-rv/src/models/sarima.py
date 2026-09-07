"""SARIMA (spec Section 5). Per-stock only, by construction.

The spec says: "ARIMA(1,1,1) for the daily horizon. For intraday, SARIMA with
seasonal period = bins per day, other seasonal parameters zero."

Read literally, seasonal orders of P=D=Q=0 make the seasonal period inert, so
the intraday specification reduces to ARIMA(1,1,1) on the intraday series. That
literal reading is the default here, because it is what the spec says; the
seasonal order is exposed as a parameter so the alternative reading -- a
genuine seasonal term such as (0,1,0,s) -- can be run as a sensitivity check.
Flagged as an OPEN item in docs/deviations.md.

Fitting is done once per fold on the training window. Test-period forecasts are
produced by *filtering* the fitted parameters forward over the realized data
(`append(..., refit=False)`), which is the standard rolling one-step-ahead
protocol: each forecast uses only observations up to its own origin, and no
test observation ever influences the estimated parameters.
"""

from __future__ import annotations

import logging
import warnings

import numpy as np

from src.models.base import ChunkSource, Model

log = logging.getLogger(__name__)


class SARIMA(Model):
    """ARIMA/SARIMA on a single stock's log-RV series."""

    name = "SARIMA"
    uses_validation = False

    def _fit(self, train: ChunkSource, val: ChunkSource | None) -> None:
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        if train.symbols.size != 1:
            raise ValueError(
                f"SARIMA is per-stock; got {train.symbols.size} symbols"
            )
        sym = int(train.symbols[0])
        series = np.asarray(train.builder.flat[sym], dtype=np.float64)

        times = np.asarray(train.times)
        if val is not None and len(val) > 0 and not self.params.get("train_only", False):
            times = np.concatenate([times, np.asarray(val.times)])
        self.fit_end_ = int(times.max())
        endog = series[: self.fit_end_ + 1]

        order = self.params.get("order", (1, 1, 1))
        seasonal = self.params.get("seasonal_order", (0, 0, 0, 0))

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            # simple_differencing must stay False: it differences the data
            # up front, which shifts every prediction index by d and returns
            # forecasts of the differenced series rather than of the level.
            model = SARIMAX(endog, order=order, seasonal_order=seasonal,
                            enforce_stationarity=False,
                            enforce_invertibility=False,
                            simple_differencing=False)
            self.res_ = model.fit(disp=False,
                                  maxiter=self.params.get("maxiter", 50))
        self.series_ = series
        self.symbol_ = sym
        self.meta_ = {"order": order, "seasonal_order": seasonal,
                      "n_train_obs": int(endog.size), "symbol": sym,
                      "aic": float(self.res_.aic)}

    def _predict(self, source: ChunkSource) -> np.ndarray:
        """Rolling one-step-ahead forecasts over the requested target times.

        Parameters stay frozen at their training values; only the state is
        filtered forward, so no test observation informs the fit.
        """
        times = np.asarray(source.times, dtype=np.int64)
        if times.size == 0:
            return np.empty(0)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            res = self.res_.append(
                self.series_[self.fit_end_ + 1: int(times.max())],
                refit=False,
            ) if int(times.max()) > self.fit_end_ + 1 else self.res_
            # One-step-ahead in-sample+appended predictions, indexed by target.
            pred = res.get_prediction(start=0, end=int(times.max())).predicted_mean
        pred = np.asarray(pred, dtype=np.float64)
        out = pred[times]
        return np.where(np.isfinite(out), out, float(np.nanmean(self.series_)))
