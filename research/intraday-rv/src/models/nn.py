"""MLP and LSTM (spec Sections 5, 5.1, 12.1).

Batches are assembled *on the fly* from the RV panel (spec Section 12.1,
pattern 3). One batch of 1024 x 1638 float32 is ~6.7 MB, against 37 GB for the
dense design matrix.

Shuffling uses a superchunk buffer rather than per-row gathers. Drawing one
batch as 1024 independent (symbol, time) lookups would mean ~93 separate
gathers per batch and dominate the runtime; instead a large block is gathered
with one vectorized call per symbol, shuffled in memory, and emitted as
batches. The mixing is what batch normalization needs, at a fraction of the
cost.

LSTM shaping is the Section 5.1 DECISION: 21 timesteps (days) x bins_per_day
features, not `p` timesteps of one feature. At the 10-min horizon that is 21
steps instead of 819.
"""

from __future__ import annotations

import logging

import numpy as np

from src.models.base import ChunkSource, Model

log = logging.getLogger(__name__)


def pick_device(prefer: str | None = None) -> str:
    """MPS when available (spec Section 12), else CUDA, else CPU."""
    import torch

    if prefer:
        return prefer
    if getattr(torch.backends, "mps", None) is not None and \
            torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def batch_iterator(
    builder, symbols: np.ndarray, times: np.ndarray, batch_size: int,
    shuffle: bool, seed: int, sequence: bool = False,
    bins_per_day: int | None = None, superchunk: int = 65536,
    scaler=None,
):
    """Yield `(X, y)` float32 batches, assembled lazily from the panel."""
    syms = np.asarray(symbols, dtype=np.int64)
    ts = np.asarray(times, dtype=np.int64)
    rng = np.random.default_rng(seed)

    # (symbol, time) pairs, in blocks that keep gathers vectorized per symbol.
    per_symbol = max(1, superchunk // max(1, syms.size))
    order = rng.permutation(ts.size) if shuffle else np.arange(ts.size)
    ts_ordered = ts[order]

    for start in range(0, ts_ordered.size, per_symbol):
        block_times = ts_ordered[start:start + per_symbol]
        Xs, ys = [], []
        for s in syms:
            if sequence:
                Xb = builder.sequence_rows(int(s), block_times, bins_per_day)
                if scaler is not None:
                    Xb = scaler.transform(Xb)
            else:
                Xb = builder.rows(int(s), block_times)
                if scaler is not None:
                    Xb = scaler.transform(Xb)
            Xs.append(np.asarray(Xb, dtype=np.float32))
            ys.append(np.asarray(builder.targets(int(s), block_times),
                                 dtype=np.float32))
        X = np.concatenate(Xs, axis=0)
        y = np.concatenate(ys, axis=0)
        if shuffle:
            perm = rng.permutation(X.shape[0])
            X, y = X[perm], y[perm]
        for b in range(0, X.shape[0], batch_size):
            yield X[b:b + batch_size], y[b:b + batch_size]


class ScalarNormalizer:
    """Single (mean, std) for log-RV, applied to inputs of any rank.

    Lagged log-RV features and the log-RV target are the *same variable* in the
    same units, so one scalar standardization is the principled choice for the
    sequence path, where a per-column scaler over a (21, bins_per_day) tensor
    would fit a separate mean to each bucket-of-day for no reason.
    """

    def __init__(self, mean: float, std: float):
        self.mean = float(mean)
        self.scale = float(std) if std > 1e-12 else 1.0

    def transform(self, X):
        return (np.asarray(X, dtype=np.float32) - self.mean) / self.scale

    def inverse(self, X):
        return np.asarray(X, dtype=np.float64) * self.scale + self.mean


def target_stats(builder, symbols, times, chunk: int = 65536) -> tuple[float, float]:
    """Streaming mean/std of the target over TRAINING rows only.

    Neural forecasts of log RV are the one place in this build where an
    unstandardized target is fatal: log RV sits around -12, roughly nine
    standard deviations from a freshly initialized network's near-zero output,
    so the fit spends its whole epoch budget travelling to the level instead of
    learning the signal. Linear models are immune because the intercept absorbs
    it. Fitted on `times` only, so it carries no validation or test information.
    """
    total = total_sq = 0.0
    n = 0
    for s in np.asarray(symbols, dtype=np.int64):
        for start in range(0, len(times), chunk):
            y = np.asarray(builder.targets(int(s), np.asarray(times)[start:start + chunk]),
                           dtype=np.float64)
            total += y.sum()
            total_sq += float(y @ y)
            n += y.size
    if n == 0:
        return 0.0, 1.0
    mean = total / n
    var = max(total_sq / n - mean ** 2, 0.0)
    return float(mean), float(np.sqrt(var))


def _build_mlp(n_features: int, hidden=(128, 64, 32), batch_norm: bool = True,
               dropout: float = 0.0):
    import torch.nn as nn

    layers: list = []
    prev = n_features
    for h in hidden:
        layers.append(nn.Linear(prev, h))
        if batch_norm:
            layers.append(nn.BatchNorm1d(h))
        layers.append(nn.ReLU())
        if dropout:
            layers.append(nn.Dropout(dropout))
        prev = h
    layers.append(nn.Linear(prev, 1))
    return nn.Sequential(*layers)


def _build_lstm(n_input: int, hidden: int = 64, layers: int = 2):
    import torch
    import torch.nn as nn

    class LSTMNet(nn.Module):
        """2-layer LSTM over 21 daily timesteps; no batch norm (spec Section 5)."""

        def __init__(self):
            super().__init__()
            self.lstm = nn.LSTM(n_input, hidden, num_layers=layers,
                                batch_first=True)
            self.head = nn.Linear(hidden, 1)

        def forward(self, x):
            out, _ = self.lstm(x)
            return self.head(out[:, -1, :])       # last timestep

    return LSTMNet()


class NeuralModel(Model):
    """Shared training loop, early stopping, and seed ensembling."""

    name = "NN"
    uses_validation = True
    sequence = False

    def _make_net(self, sample_shape):
        raise NotImplementedError

    def _fit(self, train: ChunkSource, val: ChunkSource | None) -> None:
        import torch

        self.device_ = pick_device(self.params.get("device"))
        n_seeds = int(self.params.get("seeds", 10))
        epochs = int(self.params.get("epochs", 100))
        patience = int(self.params.get("early_stopping_rounds", 10))
        batch = int(self.params.get("batch_size", 1024))
        lr = float(self.params.get("lr", 1e-3))
        self.bins_per_day_ = self.params.get("bins_per_day")

        # Target standardization, fitted on training rows only.
        self.y_mean_, self.y_std_ = target_stats(
            train.builder, train.symbols, train.times
        )
        if self.y_std_ <= 1e-12:
            self.y_std_ = 1.0

        # Input scaling. The MLP uses the per-feature scaler of Section 5.2;
        # the LSTM uses the scalar normalizer, since its input is a
        # (21, bins_per_day) tensor of the same variable.
        if self.params.get("scaler") is None:
            self.params["scaler"] = ScalarNormalizer(self.y_mean_, self.y_std_)

        # One probe batch fixes the input shape for the architecture.
        probe = next(iter(self._batches(train, batch, False, 0)))
        self.input_shape_ = probe[0].shape[1:]

        self.nets_, histories = [], []
        for s in range(n_seeds):
            net, hist = self._train_one(train, val, seed=s, epochs=epochs,
                                        patience=patience, batch=batch, lr=lr)
            self.nets_.append(net)
            histories.append(hist)
        self.meta_ = {
            "device": self.device_, "seeds": n_seeds,
            "input_shape": list(self.input_shape_),
            "epochs_used": [h["best_epoch"] for h in histories],
            "best_val": [h["best_val"] for h in histories],
            "n_train_rows": len(train),
            "y_mean": self.y_mean_, "y_std": self.y_std_,
        }
        log.info("%s: %d seeds on %s, epochs used %s", self.name, n_seeds,
                 self.device_, self.meta_["epochs_used"])

    def _batches(self, source: ChunkSource, batch: int, shuffle: bool, seed: int):
        return batch_iterator(
            source.builder, source.symbols, source.times, batch, shuffle, seed,
            sequence=self.sequence, bins_per_day=self.bins_per_day_,
            scaler=self.params.get("scaler"),
        )

    def _train_one(self, train, val, seed, epochs, patience, batch, lr):
        import torch
        import torch.nn as nn

        torch.manual_seed(seed)
        np.random.seed(seed)
        dev = torch.device(self.device_)
        net = self._make_net(self.input_shape_).to(dev)
        opt = torch.optim.Adam(net.parameters(), lr=lr)
        lossf = nn.MSELoss()

        best_val, best_state, best_epoch, bad = np.inf, None, 0, 0
        for epoch in range(epochs):
            net.train()
            for Xb, yb in self._batches(train, batch, True, seed * 1000 + epoch):
                if Xb.shape[0] < 2:
                    continue                       # BatchNorm needs 2+ rows
                xb = torch.from_numpy(Xb).to(dev)
                yz = (yb - self.y_mean_) / self.y_std_
                yt = torch.from_numpy(yz.astype(np.float32)).to(dev).unsqueeze(1)
                opt.zero_grad()
                loss = lossf(net(xb), yt)
                loss.backward()
                opt.step()

            if val is None or len(val) == 0:
                best_state = {k: v.detach().clone() for k, v in net.state_dict().items()}
                best_epoch = epoch
                continue

            net.eval()
            tot, n = 0.0, 0
            with torch.no_grad():
                for Xb, yb in self._batches(val, batch, False, 0):
                    xb = torch.from_numpy(Xb).to(dev)
                    pred = net(xb).squeeze(1).cpu().numpy() * self.y_std_ + self.y_mean_
                    tot += float(np.sum((pred - yb) ** 2))
                    n += yb.size
            v = tot / max(1, n)
            if v < best_val - 1e-9:
                best_val, best_epoch, bad = v, epoch, 0
                best_state = {k: t.detach().clone() for k, t in net.state_dict().items()}
            else:
                bad += 1
                if bad >= patience:
                    break

        if best_state is not None:
            net.load_state_dict(best_state)
        return net, {"best_val": float(best_val), "best_epoch": int(best_epoch)}

    def _predict(self, source: ChunkSource) -> np.ndarray:
        """Mean prediction across the seed ensemble (spec Section 5)."""
        import torch

        dev = torch.device(self.device_)
        batch = int(self.params.get("batch_size", 1024))
        preds = []
        for net in self.nets_:
            net.eval()
            chunks = []
            with torch.no_grad():
                for Xb, _ in self._batches(source, batch, False, 0):
                    xb = torch.from_numpy(Xb).to(dev)
                    chunks.append(net(xb).squeeze(1).cpu().numpy())
            raw = np.concatenate(chunks) if chunks else np.empty(0)
            preds.append(raw * self.y_std_ + self.y_mean_)
        return np.mean(np.stack(preds), axis=0)

    def importance(self, source: ChunkSource | None = None) -> np.ndarray | None:
        if source is None or self.sequence:
            return None
        from src.eval.importance import torch_gradient_importance

        Xs, n = [], 0
        for Xb, _ in self._batches(source, 1024, False, 0):
            Xs.append(Xb)
            n += Xb.shape[0]
            if n >= 4096:
                break
        X = np.vstack(Xs)[:4096]
        imps = [torch_gradient_importance(net, X, device=self.device_)
                for net in self.nets_]
        return np.mean(np.stack(imps), axis=0)


class MLPModel(NeuralModel):
    """3 hidden layers (128, 64, 32), ReLU, batch norm on (spec Section 5)."""

    name = "MLP"
    sequence = False

    def _make_net(self, shape):
        return _build_mlp(
            int(shape[0]),
            hidden=tuple(self.params.get("hidden", (128, 64, 32))),
            batch_norm=self.params.get("batch_norm", True),
            dropout=float(self.params.get("dropout", 0.0)),
        )


class LSTMModel(NeuralModel):
    """2-layer LSTM, no batch norm, 21 x bins_per_day input (spec Section 5.1)."""

    name = "LSTM"
    sequence = True

    def _make_net(self, shape):
        _, n_input = int(shape[0]), int(shape[1])
        return _build_lstm(n_input,
                           hidden=int(self.params.get("hidden", 64)),
                           layers=int(self.params.get("layers", 2)))
