"""Market and cluster aggregate log-RV (spec Sections 4.4, 4.5).

    RV_M,t^(h) = (1/N) sum_i RV_{i,t}^(h)

The average is taken over *log* RVs, as the spec specifies, and over the raw
stocks only -- unseen stocks must never enter the market aggregate, or the
Section 11.1 generalization test leaks.
"""

from __future__ import annotations

import logging

import numpy as np

log = logging.getLogger(__name__)


def market_rv(
    flat: np.ndarray,
    member_mask: np.ndarray | None = None,
    weights: np.ndarray | None = None,
) -> np.ndarray:
    """`(1, n_times)` equal- or value-weighted mean log-RV across members.

    `member_mask` selects which rows of `flat` count toward the aggregate; it
    is how unseen stocks are excluded. `weights` enables the value-weighted
    robustness check (spec Section 4.4).
    """
    x = np.asarray(flat, dtype=np.float64)
    mask = (np.ones(x.shape[0], dtype=bool) if member_mask is None
            else np.asarray(member_mask, dtype=bool))
    if not mask.any():
        raise ValueError("market aggregate has no members")
    sub = x[mask]
    if weights is None:
        agg = sub.mean(axis=0)
    else:
        w = np.asarray(weights, dtype=np.float64)[mask]
        if w.ndim == 1:
            w = w[:, None]
        w = w / w.sum(axis=0, keepdims=True)
        agg = (sub * w).sum(axis=0)
    return agg[None, :]


def cluster_rv(
    flat: np.ndarray,
    labels: np.ndarray,
    member_mask: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Per-cluster mean log-RV.

    Returns `(agg, agg_of_symbol)` where `agg` is `(n_clusters, n_times)` and
    `agg_of_symbol` maps each row of `flat` to its cluster row -- exactly the
    pair `LagBuilder` expects.

    Only stocks in `member_mask` contribute to a cluster's mean, but *every*
    stock is assigned an aggregate row, so unseen stocks can read a cluster
    average they did not help form (spec Section 6.4).
    """
    x = np.asarray(flat, dtype=np.float64)
    lab = np.asarray(labels, dtype=np.int64)
    if lab.size != x.shape[0]:
        raise ValueError("labels must have one entry per symbol")
    mask = (np.ones(x.shape[0], dtype=bool) if member_mask is None
            else np.asarray(member_mask, dtype=bool))

    uniq = np.unique(lab)
    agg = np.empty((uniq.size, x.shape[1]), dtype=np.float64)
    remap = {int(c): k for k, c in enumerate(uniq)}
    for c in uniq:
        sel = (lab == c) & mask
        if not sel.any():
            # A cluster with no training members falls back to the whole
            # training universe rather than producing NaNs.
            log.warning("cluster %d has no contributing members; using the "
                        "full member average", int(c))
            sel = mask
        agg[remap[int(c)]] = x[sel].mean(axis=0)
    agg_of_symbol = np.array([remap[int(c)] for c in lab], dtype=np.int64)
    return agg, agg_of_symbol


def commonality_inputs(
    flat: np.ndarray, member_mask: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """`(flat, market)` for the Section 9 commonality regressions."""
    return np.asarray(flat, dtype=np.float64), market_rv(flat, member_mask)[0]
