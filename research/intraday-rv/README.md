# Intraday Realized Volatility Forecasting

Replication of **Zhang, Zhang, Cucuringu & Qian (2024)**, *Volatility Forecasting
with Machine Learning and Intraday Commonality*, Journal of Financial
Econometrics 22(2), 492–530 — plus a **Cluster Asset Model (CAM)** extension
adapting the SAM/CAM/UAM structure of Cucuringu, Li & Zhang (2025).

---

## Status

The pipeline is complete and tested end to end. **It has not been run on live
market data**, for two reasons stated plainly:

- **No Databento API key is present in this environment.** The download layer is
  finished, cost-checked and resumable, and refuses to submit anything until a
  key is exported. Priced total for the full pull: **$69.44** (112 raw symbols x
  ~100 months x $0.0062/symbol-month), inside the $125 new-account credit.
- **The full grid is 608 cells** (7 model families x 6 experiment cells x 4
  horizons x 4 folds, minus SAM-only SARIMA) with 10-seed neural ensembles. That
  is many CPU-days and cannot run in an ephemeral container.

Everything that can be validated without live data has been:
**55 unit and gate tests pass**, and a synthetic end-to-end smoke run exercises
all nine build phases. Every number produced so far comes from a synthetic
generator and validates *machinery*, not findings.

## What is verified, and how

| Claim | Evidence |
| --- | --- |
| QLIKE is correct | `QLIKE(x,x) == 0` exactly; matches the level-space definition `s2/sh2 - log(s2/sh2) - 1`; minimised at the truth; asymmetric the right way; overflow-safe |
| Realized utility is correct | `RU(perfect) == SR^2/(2g) == 0.04` to 1e-15, elementwise as well as in the mean; maximised at the truth |
| DM is correct | Recovers a known ordering; antisymmetric; empirical size 7% at nominal 5% over 300 replications |
| MCS is correct | Two independent implementations (`arch` and a local range-statistic version) return *identical* included sets |
| LASSO-on-Gram is correct | Matches `sklearn.Lasso` to 1e-14 across the whole penalty path; recovers the exact planted support |
| Importance is correct | Finite-difference sensitivity reproduces normalized `abs(beta)` exactly on a linear model |
| RV construction is correct | Hand-computed against closed-form values: 10-min RV `= 10 * 0.001^2`, 1-day `= 390e-6`, RQ `= (M/3) * sum r^4` |
| No lookahead | Winsorization thresholds provably unmoved by a +50 shift in the test window; scaler fitted on train differs from all-rows; clusters unchanged when the test window is replaced by noise |
| No overnight returns | Sessions are reshaped to their own rows *before* differencing, so an overnight return is unconstructible |
| Feature-set identity | The own-lag block is **byte-identical** across all six (pooling x features) cells |
| Memory architecture | The 10-min UAM-augmented design matrix would be **36.3 GB**; iteration peaks at **26.8 MB** per chunk, 1354x smaller |

## Quick start

```bash
pip install numpy scipy pandas pyarrow scikit-learn statsmodels \
            torch xgboost arch databento exchange_calendars matplotlib pytest

python -m pytest tests/ -q          # 55 tests
python tests/smoke.py               # full synthetic end-to-end run

export DATABENTO_API_KEY=...        # never hardcode it
python pipeline.py download --dry-run   # prices the pull, submits nothing
```

`pipeline.py` drives the phases: `download`, `data`, `commonality`, `harness`,
`models`, `smoke`. Any phase accepts `--synthetic` to run without a key.

### Unpacking on macOS

Extract **without `sudo`**:

```bash
unzip intraday-rv.zip -d ~/Desktop/Research     # zip stores no ownership
```

`sudo tar xzf` would leave the tree root-owned, and Python then raises
`PermissionError: [Errno 1] Operation not permitted` while trying to write
`__pycache__/*.pyc` beside each module it imports. That looks like a test
failure but is purely a filesystem-permission artefact.

The suite is hardened against this regardless: `tests/conftest.py` sets
`sys.dont_write_bytecode = True` and `pytest.ini` passes
`-p no:cacheprovider`, so nothing is written into the source tree and the tests
pass from a fully read-only checkout. If you hit permission trouble anyway:

```bash
sudo chown -R "$(whoami)" ~/Desktop/Research/intraday-rv   # if extracted as root
xattr -dr com.apple.quarantine ~/Desktop/Research/intraday-rv   # downloaded-file flag
```

If *every* file under `~/Desktop` is unreadable to your shell, that is macOS TCC
rather than these files: grant your terminal Full Disk Access under System
Settings > Privacy & Security.

## The extension

The paper's three schemes conflate two orthogonal axes. Separating them is the
contribution:

|                       | Own RV only         | Own RV + aggregate RV         |
| --------------------- | ------------------- | ----------------------------- |
| **SAM** (per stock)   | = paper's SINGLE    | new cell (aggregate: market)  |
| **CAM** (per cluster) | new cell            | new cell (aggregate: cluster) |
| **UAM** (all stocks)  | = paper's UNIVERSAL | = paper's AUGMENTED           |

The **pooling** axis controls which stocks' rows enter the training set; the
**feature** axis controls what predictors each row carries. In the code these are
read by two functions that cannot see each other's arguments
(`training_groups` and `build_aggregate`), which is why the byte-identity gate
passes by construction rather than by convention. All six cells are reported.

Clusters come from three methods — GICS sectors, correlation spectral
clustering, and SPONGE signed clustering — fitted on the **training window only**
and refitted every fold, with `k` swept over {2, 4, 6, 8, 11}.

## Architecture notes

**The design matrix is never materialized.** At 10-min UAM-augmented it would be
37 GB. Instead the canonical store is the RV panel, shaped `(stock, day, bin)`
(~36 MB), and every lag vector is a zero-copy `sliding_window_view` into it.
Linear models stream `X'X` and `X'y`, so their cost is O(p^2) *independent of n*;
neural nets batch on the fly; XGBoost builds its `QuantileDMatrix` straight from
the chunk iterator.

**Two bugs were found by testing rather than assumed away**, both recorded in
`docs/deviations.md`:

1. `SARIMAX(simple_differencing=True)` differences up front, shifting every
   prediction index and returning forecasts of the *differenced* series. Fixing
   it took SARIMA from worse-than-naive to 45% of naive RMSE.
2. Neural targets were unstandardized. Log RV sits ~9 standard deviations from a
   fresh network's near-zero output, so the nets never reached the level:
   QLIKE ~12 against ~0.19 for OLS. With train-window target standardization
   they land at ~0.21. Linear models were immune because the intercept absorbs it.

## Layout

```
src/
  data/        download (cost-checked, resumable), clean, panel, calendar,
               symbology, synthetic
  features/    lags (zero-copy views), aggregates, har, prepare (lookahead guards)
  clustering/  fit (GICS/spectral/SPONGE), assign (unseen-stock rule)
  models/      base (chunk-source contract), linear (Gram), sarima, trees, nn
  schemes/     runner (the 2x3 grid), grid (driver, caching, tables)
  eval/        losses, dm, mcs, utility, importance
  analysis/    commonality, intraday2daily, unseen
tests/         55 tests + smoke.py end-to-end run
configs/       YAML per experiment
docs/          deviations.md  <- read before writing up
```

## Before writing up

Read **`docs/deviations.md`**. It records all eight Section 16 deviations, nine
further choices this build had to make where the paper or spec left something
open, and six open items to resolve against live data — including the
`instrument_id` continuity audit for ticker changes and the ambiguous SARIMA
intraday seasonal order.

Two findings that **cannot** be reproduced on this sample and must be framed
accordingly: the paper's 2011–2021 window is unavailable from this source, and
March 2020 is in-sample for every main fold, so the turmoil result is addressed
only via the separate, clearly-labelled COVID probe.
