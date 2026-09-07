"""Linear families solved from sufficient statistics (spec Sections 5, 12.1).

OLS and LASSO are fitted from streamed `X'X` and `X'y`, never from a
materialized design matrix. The cost is O(p^2) per iteration and *independent
of n*, which is what makes every linear cell trivially feasible even at the
10-min horizon where the dense matrix would be 37 GB.

A note on the LASSO penalty path. Spec Section 5 says "lambda by 5-fold CV",
while Section 5.2 says every model other than HAR-D and OLS selects on the
validation window. These conflict. The default here is validation-window
selection, because it matches Section 5.2, is consistent with how every other
tuned family in this build selects, and cannot leak across the fold boundary.
Blocked 5-fold CV on the training window is available via `cv=5` and is
*blocked*, not random -- random k-fold on serially dependent data would let
each fold's neighbours leak into it. Recorded as a deviation.
"""

from __future__ import annotations

import logging

import numpy as np
from scipy import linalg

from src.eval.losses import qlike
from src.models.base import ChunkSource, GramAccumulator, Model

log = logging.getLogger(__name__)


def solve_ridge(xtx: np.ndarray, xty: np.ndarray, ridge: float = 0.0,
                skip_first: bool = True) -> np.ndarray:
    """Cholesky solve with an escalating ridge if the Gram is near-singular.

    A tiny ridge is not a modelling choice here -- at p=1638 with strongly
    collinear lagged RVs the Gram is routinely rank-deficient in floating
    point, and a pure OLS solve would return garbage rather than fail loudly.
    The intercept is never penalized.
    """
    d = xtx.shape[0]
    pen = np.eye(d)
    if skip_first:
        pen[0, 0] = 0.0
    scale = float(np.trace(xtx)) / max(1, d)
    for factor in [ridge] + [10.0 ** k for k in range(-12, 0)]:
        A = xtx + factor * scale * pen
        try:
            c, low = linalg.cho_factor(A, lower=True, check_finite=False)
            beta = linalg.cho_solve((c, low), xty, check_finite=False)
            if np.all(np.isfinite(beta)):
                if factor > ridge:
                    log.debug("Gram needed ridge %.1e x trace/d for stability",
                              factor)
                return beta
        except linalg.LinAlgError:
            continue
    log.warning("Cholesky failed at every ridge level; falling back to lstsq")
    return np.asarray(linalg.lstsq(xtx, xty)[0])


def lasso_gram(
    xtx: np.ndarray, xty: np.ndarray, n: int, alpha: float,
    max_iter: int = 1000, tol: float = 1e-7, skip_first: bool = True,
    beta_init: np.ndarray | None = None,
) -> np.ndarray:
    """Coordinate descent for LASSO using only the Gram matrix.

    Minimizes `(1/2n)||y - Xb||^2 + alpha*||b||_1` -- the scikit-learn
    objective, so the two are directly comparable (asserted in the tests).
    Index 0 is the intercept and is left unpenalized.
    """
    d = xtx.shape[0]
    beta = np.zeros(d) if beta_init is None else beta_init.astype(np.float64).copy()
    diag = np.diag(xtx).copy()
    diag[diag <= 0] = 1e-12
    # Running gradient term X'X b, updated incrementally per coordinate.
    xtxb = xtx @ beta
    n_alpha = n * alpha

    for _ in range(max_iter):
        max_step = 0.0
        for j in range(d):
            bj = beta[j]
            # Partial residual correlation, excluding coordinate j's own effect.
            rho = xty[j] - xtxb[j] + diag[j] * bj
            if skip_first and j == 0:
                new = rho / diag[j]
            else:
                new = np.sign(rho) * max(abs(rho) - n_alpha, 0.0) / diag[j]
            delta = new - bj
            if delta != 0.0:
                beta[j] = new
                xtxb += delta * xtx[:, j]
                max_step = max(max_step, abs(delta))
        if max_step < tol:
            break
    return beta


class LinearModel(Model):
    """Shared plumbing: accumulate the Gram, solve, predict in chunks."""

    name = "linear"

    def _accumulate(self, source: ChunkSource) -> GramAccumulator:
        return GramAccumulator(source.n_features).consume(source)

    def _predict(self, source: ChunkSource) -> np.ndarray:
        out = []
        for X, _, _, _ in source:
            out.append(self.intercept_ + X @ self.coef_)
        return np.concatenate(out) if out else np.empty(0)

    def importance(self, source: ChunkSource | None = None) -> np.ndarray:
        from src.eval.importance import linear_importance

        return linear_importance(self.coef_)


class OLS(LinearModel):
    """OLS on raw lagged features (spec Section 5).

    Has no hyperparameters, so it trains on train + validation combined.
    """

    name = "OLS"
    uses_validation = False

    def _fit(self, train: ChunkSource, val: ChunkSource | None) -> None:
        g = self._accumulate(train)
        beta = solve_ridge(g.xtx, g.xty, self.params.get("ridge", 0.0))
        self.intercept_, self.coef_ = float(beta[0]), beta[1:]
        self.meta_ = {"n_train_rows": g.n, "n_features": g.dim - 1}


class Ridge(LinearModel):
    """Ridge, useful as a stability check on OLS at p=1638."""

    name = "Ridge"
    uses_validation = True

    def _fit(self, train: ChunkSource, val: ChunkSource | None) -> None:
        g = self._accumulate(train)
        grid = self.params.get("alphas", [1e-8, 1e-6, 1e-4, 1e-2, 1.0])
        if val is None or len(val) == 0:
            best = self.params.get("alpha", 1e-6)
            beta = solve_ridge(g.xtx, g.xty, best)
        else:
            y_val = np.concatenate([y for _, y, _, _ in val])
            best, best_loss, beta = None, np.inf, None
            for a in grid:
                b = solve_ridge(g.xtx, g.xty, a)
                self.intercept_, self.coef_ = float(b[0]), b[1:]
                self.fitted_ = True
                loss = qlike(y_val, self._predict(val))
                if loss < best_loss:
                    best, best_loss, beta = a, loss, b
        self.intercept_, self.coef_ = float(beta[0]), beta[1:]
        self.meta_ = {"alpha": best, "n_train_rows": g.n}


class LassoGram(LinearModel):
    """LASSO via coordinate descent on the precomputed Gram (spec Section 12.1)."""

    name = "LASSO"
    uses_validation = True

    def _alpha_grid(self, g: GramAccumulator) -> np.ndarray:
        if "alphas" in self.params:
            return np.asarray(self.params["alphas"], dtype=np.float64)
        # alpha_max is the smallest penalty that zeroes every coefficient.
        alpha_max = float(np.max(np.abs(g.xty[1:]))) / max(1, g.n)
        n_alphas = self.params.get("n_alphas", 20)
        eps = self.params.get("eps", 1e-3)
        return np.logspace(np.log10(alpha_max), np.log10(alpha_max * eps), n_alphas)

    def _fit(self, train: ChunkSource, val: ChunkSource | None) -> None:
        g = self._accumulate(train)
        alphas = self._alpha_grid(g)
        cv = self.params.get("cv", "validation")

        if cv == "validation" and val is not None and len(val) > 0:
            y_val = np.concatenate([y for _, y, _, _ in val])
            best, best_loss, best_beta = None, np.inf, None
            beta = None
            for a in alphas:                      # warm-started down the path
                beta = lasso_gram(g.xtx, g.xty, g.n, a, beta_init=beta,
                                  max_iter=self.params.get("max_iter", 1000))
                self.intercept_, self.coef_ = float(beta[0]), beta[1:]
                self.fitted_ = True
                loss = qlike(y_val, self._predict(val))
                if loss < best_loss:
                    best, best_loss, best_beta = a, loss, beta.copy()
            beta = best_beta
            self.meta_ = {"alpha": best, "selection": "validation-qlike",
                          "val_qlike": best_loss}
        else:
            k = 5 if cv == "validation" else int(cv)
            best, beta = self._blocked_cv(train, alphas, k)
            self.meta_ = {"alpha": best, "selection": f"blocked-{k}fold-cv"}

        self.intercept_, self.coef_ = float(beta[0]), beta[1:]
        self.meta_.update({
            "n_train_rows": g.n,
            "n_nonzero": int(np.sum(np.abs(self.coef_) > 1e-12)),
            "n_features": g.dim - 1,
        })

    def _blocked_cv(self, train: ChunkSource, alphas: np.ndarray, k: int):
        """Blocked k-fold over *contiguous time*, never random.

        Random k-fold on serially dependent data lets each held-out fold's
        immediate neighbours sit in the training set, which inflates the
        apparent fit and picks a penalty that is too small.
        """
        times = np.asarray(train.times)
        blocks = np.array_split(times, k)
        scores = np.zeros(len(alphas))
        for i in range(k):
            tr_times = np.concatenate([b for j, b in enumerate(blocks) if j != i])
            te_times = blocks[i]
            g = GramAccumulator(train.n_features).consume(
                train.subset(times=tr_times)
            )
            te = train.subset(times=te_times)
            y_te = np.concatenate([y for _, y, _, _ in te])
            beta = None
            for ai, a in enumerate(alphas):
                beta = lasso_gram(g.xtx, g.xty, g.n, a, beta_init=beta)
                self.intercept_, self.coef_ = float(beta[0]), beta[1:]
                self.fitted_ = True
                scores[ai] += qlike(y_te, self._predict(te))
        best_a = float(alphas[int(np.argmin(scores))])
        g_full = GramAccumulator(train.n_features).consume(train)
        return best_a, lasso_gram(g_full.xtx, g_full.xty, g_full.n, best_a)


class HARD(LinearModel):
    """HAR-D, estimated by OLS on the small HAR design block (spec Section 5).

    Unlike the other linear families this does not consume the p-lag source;
    it is handed its own compact feature block by the runner, because HAR-D is
    defined on aggregated terms rather than raw lags.
    """

    name = "HAR-D"
    uses_validation = False

    def _fit(self, train: ChunkSource, val: ChunkSource | None) -> None:
        g = self._accumulate(train)
        beta = solve_ridge(g.xtx, g.xty, self.params.get("ridge", 0.0))
        self.intercept_, self.coef_ = float(beta[0]), beta[1:]
        self.meta_ = {"n_train_rows": g.n, "columns": self.params.get("columns")}

    def coefficients(self) -> dict:
        cols = self.params.get("columns") or [
            f"x{i}" for i in range(self.coef_.size)
        ]
        return {"intercept": self.intercept_, **dict(zip(cols, self.coef_))}
