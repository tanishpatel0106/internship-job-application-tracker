"""Clustering for CAM (spec Section 6).

Leakage is the main risk in this module, so the guard is structural: every
fitting function takes a `train_times` argument and slices the panel *itself*.
There is no code path by which a clustering routine can see a row outside its
training window, and `ClusterAssignment` records the window it was fitted on so
the Phase 5 audit can verify it after the fact.

Three methods, per the spec:

* `gics`     -- the eight sectors of Section 3. Fixed, no estimation, no
                leakage risk; the interpretable baseline.
* `spectral` -- spectral clustering on the pairwise correlation of log-RV.
* `sponge`   -- signed clustering on the signed correlation matrix, implemented
                directly as the generalized eigenproblem rather than depending
                on `signet`, which is unmaintained.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
from scipy import linalg

from src.universe import SECTOR_OF

log = logging.getLogger(__name__)

METHODS = ["gics", "spectral", "sponge"]


@dataclass
class ClusterAssignment:
    """Cluster labels plus the provenance needed to audit them."""

    labels: np.ndarray                  # (n_symbols,)
    symbols: list[str]
    method: str
    k: int
    horizon: str
    train_window: tuple[int, int]       # (min, max) flat time index actually seen
    n_train_times: int
    fold: int | None = None
    extra: dict = field(default_factory=dict)

    def sizes(self) -> dict[int, int]:
        u, c = np.unique(self.labels, return_counts=True)
        return {int(a): int(b) for a, b in zip(u, c)}

    def members(self, cluster: int) -> list[str]:
        return [s for s, l in zip(self.symbols, self.labels) if l == cluster]

    def as_dict(self) -> dict:
        return {
            "method": self.method, "k": self.k, "horizon": self.horizon,
            "fold": self.fold, "train_window": list(self.train_window),
            "n_train_times": self.n_train_times, "sizes": self.sizes(),
            "labels": {s: int(l) for s, l in zip(self.symbols, self.labels)},
        }


def _corr(flat: np.ndarray, train_times: np.ndarray) -> np.ndarray:
    """Pairwise correlation of log-RV over the training window ONLY."""
    t = np.asarray(train_times, dtype=np.int64)
    if t.size < 2:
        raise ValueError("need at least two training observations")
    sub = np.asarray(flat, dtype=np.float64)[:, t]
    sub = sub - sub.mean(axis=1, keepdims=True)
    sd = sub.std(axis=1)
    sd[sd <= 0] = 1.0
    c = (sub @ sub.T) / (t.size * np.outer(sd, sd))
    np.fill_diagonal(c, 1.0)
    return np.clip(c, -1.0, 1.0)


def gics_clusters(symbols: list[str]) -> np.ndarray:
    """Labels from the fixed GICS sector map."""
    sectors = sorted({SECTOR_OF.get(s, "Others") for s in symbols})
    code = {s: i for i, s in enumerate(sectors)}
    return np.array([code[SECTOR_OF.get(s, "Others")] for s in symbols],
                    dtype=np.int64)


def spectral_clusters(corr: np.ndarray, k: int, seed: int = 0) -> np.ndarray:
    """Spectral clustering on a correlation matrix.

    The correlation is mapped to a non-negative affinity by `(1 + rho) / 2`,
    which preserves the ordering of similarities and keeps a perfectly
    anti-correlated pair at affinity 0.
    """
    from sklearn.cluster import SpectralClustering

    aff = (1.0 + np.asarray(corr, dtype=np.float64)) / 2.0
    np.fill_diagonal(aff, 1.0)
    sc = SpectralClustering(n_clusters=k, affinity="precomputed",
                            random_state=seed, assign_labels="kmeans")
    return np.asarray(sc.fit_predict(aff), dtype=np.int64)


def sponge_clusters(corr: np.ndarray, k: int, tau_plus: float = 1.0,
                    tau_minus: float = 1.0, seed: int = 0) -> np.ndarray:
    """SPONGE signed clustering (Cucuringu et al.).

    Splits the signed correlation into its positive and negative parts and
    solves the generalized eigenproblem

        (L+ + tau- * D-) v = lambda (L- + tau+ * D+) v

    taking the k smallest eigenvectors and running k-means on them. A cluster
    under this objective is a set of assets that are mutually *positively*
    correlated while being negatively correlated with the rest -- a sharper
    notion than plain spectral clustering, and the apt one for signed data.
    """
    from sklearn.cluster import KMeans

    c = np.asarray(corr, dtype=np.float64).copy()
    np.fill_diagonal(c, 0.0)
    a_pos = np.where(c > 0, c, 0.0)
    a_neg = np.where(c < 0, -c, 0.0)

    d_pos = np.diag(a_pos.sum(axis=1))
    d_neg = np.diag(a_neg.sum(axis=1))
    l_pos = d_pos - a_pos
    l_neg = d_neg - a_neg

    n = c.shape[0]
    eps = 1e-8 * np.eye(n)
    A = l_pos + tau_minus * d_neg + eps
    B = l_neg + tau_plus * d_pos + eps
    try:
        vals, vecs = linalg.eigh(A, B)
    except linalg.LinAlgError:
        log.warning("SPONGE generalized eigenproblem failed; "
                    "falling back to spectral clustering")
        return spectral_clusters(corr, k, seed)
    emb = vecs[:, :k]
    norms = np.linalg.norm(emb, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return np.asarray(
        KMeans(n_clusters=k, n_init=10, random_state=seed).fit_predict(emb / norms),
        dtype=np.int64,
    )


def fit_clusters(
    flat: np.ndarray,
    symbols: list[str],
    train_times: np.ndarray,
    method: str = "gics",
    k: int = 8,
    horizon: str = "",
    fold: int | None = None,
    member_mask: np.ndarray | None = None,
    seed: int = 0,
) -> ClusterAssignment:
    """Fit clusters on the training window ONLY (spec Section 6.2).

    `member_mask` restricts which symbols are clustered -- unseen stocks must
    be excluded here and assigned afterwards via `assign.assign_unseen`.
    """
    if method not in METHODS:
        raise ValueError(f"unknown clustering method {method!r}; pick from {METHODS}")
    t = np.asarray(train_times, dtype=np.int64)
    mask = (np.ones(len(symbols), dtype=bool) if member_mask is None
            else np.asarray(member_mask, dtype=bool))
    sub_symbols = [s for s, m in zip(symbols, mask) if m]

    if method == "gics":
        labels_sub = gics_clusters(sub_symbols)
    else:
        corr = _corr(np.asarray(flat)[mask], t)
        if method == "spectral":
            labels_sub = spectral_clusters(corr, k, seed)
        else:
            labels_sub = sponge_clusters(corr, k, seed=seed)

    labels = np.full(len(symbols), -1, dtype=np.int64)
    labels[mask] = labels_sub

    assignment = ClusterAssignment(
        labels=labels, symbols=list(symbols), method=method,
        k=int(len(np.unique(labels_sub))), horizon=horizon,
        train_window=(int(t.min()), int(t.max())), n_train_times=int(t.size),
        fold=fold,
    )
    log.info("clusters: method=%s horizon=%s fold=%s k=%d sizes=%s "
             "(fitted on flat times [%d, %d])",
             method, horizon, fold, assignment.k, assignment.sizes(),
             *assignment.train_window)
    return assignment


def cluster_stability(a: ClusterAssignment, b: ClusterAssignment) -> float:
    """Adjusted Rand index between two assignments over shared symbols.

    Used to answer the Section 6.2 question of whether 10-min clusters differ
    from 65-min clusters. Near-identical assignments across horizons would
    itself be a finding.
    """
    from sklearn.metrics import adjusted_rand_score

    shared = [s for s in a.symbols if s in set(b.symbols)]
    ia = [a.symbols.index(s) for s in shared]
    ib = [b.symbols.index(s) for s in shared]
    return float(adjusted_rand_score(a.labels[ia], b.labels[ib]))
