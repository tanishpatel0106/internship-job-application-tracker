"""Unseen-stock cluster assignment (spec Section 6.4).

Rule: assign each unseen stock to the cluster whose mean log-RV series has the
highest correlation with that stock's log-RV *over the training window*.

This is the step a referee will check, so the guarantees are worth stating
plainly. The rule uses the unseen stock's own past data, which it is entitled
to -- the stock is unseen to the *training set*, not non-existent. It never
touches test-period data, and never touches the realized target. Both are
enforced by the signature: the function receives `train_times` and slices with
it, and it never receives the targets at all.
"""

from __future__ import annotations

import logging

import numpy as np

from src.clustering.fit import ClusterAssignment

log = logging.getLogger(__name__)


def cluster_means(
    flat: np.ndarray, labels: np.ndarray, train_times: np.ndarray,
    member_mask: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Mean training-window log-RV series per cluster, `(k, n_train_times)`."""
    x = np.asarray(flat, dtype=np.float64)
    t = np.asarray(train_times, dtype=np.int64)
    lab = np.asarray(labels, dtype=np.int64)
    mask = (np.ones(x.shape[0], dtype=bool) if member_mask is None
            else np.asarray(member_mask, dtype=bool))
    valid = np.unique(lab[mask & (lab >= 0)])
    out = np.empty((valid.size, t.size))
    for i, c in enumerate(valid):
        out[i] = x[np.ix_((lab == c) & mask, t)].mean(axis=0)
    return out, valid


def assign_unseen(
    flat: np.ndarray,
    assignment: ClusterAssignment,
    train_times: np.ndarray,
    unseen_mask: np.ndarray,
    member_mask: np.ndarray | None = None,
) -> tuple[np.ndarray, dict]:
    """Assign unseen stocks by max correlation with a cluster mean.

    Returns `(labels, diagnostics)` where `labels` is the full label vector
    with unseen entries filled in.
    """
    x = np.asarray(flat, dtype=np.float64)
    t = np.asarray(train_times, dtype=np.int64)
    unseen = np.asarray(unseen_mask, dtype=bool)
    members = (~unseen if member_mask is None
               else np.asarray(member_mask, dtype=bool))

    means, cluster_ids = cluster_means(x, assignment.labels, t, members)
    m = means - means.mean(axis=1, keepdims=True)
    m_sd = m.std(axis=1)
    m_sd[m_sd <= 0] = 1.0

    labels = assignment.labels.copy()
    diagnostics: dict[str, dict] = {}
    for i in np.where(unseen)[0]:
        s = x[i, t]
        s = s - s.mean()
        sd = s.std() or 1.0
        corr = (m @ s) / (t.size * m_sd * sd)
        best = int(np.argmax(corr))
        labels[i] = int(cluster_ids[best])
        diagnostics[assignment.symbols[i]] = {
            "cluster": int(cluster_ids[best]),
            "correlation": float(corr[best]),
            "runner_up": float(np.sort(corr)[-2]) if corr.size > 1 else float("nan"),
            "margin": float(corr[best] - np.sort(corr)[-2]) if corr.size > 1 else float("nan"),
        }
    log.info("assigned %d unseen stocks to clusters by training-window "
             "correlation (mean corr %.3f)", int(unseen.sum()),
             float(np.mean([d["correlation"] for d in diagnostics.values()]))
             if diagnostics else float("nan"))
    return labels, diagnostics
