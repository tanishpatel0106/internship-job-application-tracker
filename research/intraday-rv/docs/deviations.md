# Deviations from the paper

Every item in spec Section 16, plus the choices this build had to make where the
paper or the spec left something open. Each entry states what was done, why, and
where in the code it lives.

---

## 1. Sample period: 2018-05 to 2026-09, not 2011-07 to 2021-06

**Data availability.** `metadata.get_dataset_range(dataset="XNAS.ITCH")` returns
`2018-05-01` to `2026-09-05` for all fifteen schemas. The paper's window cannot
be reproduced from this source at any price.

Four out-of-sample test years instead of six (`src/config.py::FOLDS`). Frame this
in the writeup as an **out-of-sample replication on a later period** — arguably a
stronger test of the paper's claims than re-running their exact years, since
nothing in the model design was chosen with knowledge of 2022-2026.

## 2. March 2020 is in-sample for every main fold

A direct consequence of (1): the training window of every fold begins 2018-05-01,
so COVID sits in-sample throughout. **The paper's Figure 7 finding — that
AUGMENTED helps most during turmoil — cannot be reproduced on this schedule.**

Mitigation: `src/config.py::COVID_PROBE`, a separate fold that trains on
2018-06 to 2019-06, validates on 2019-07 to 2019-12 and tests on calendar 2020.
Report it in its own table, never pooled with the four main folds, and state the
short training window as a caveat. Its purpose is to probe the turmoil claim, not
to produce headline numbers.

## 3. Nasdaq regional book, not consolidated NBBO

`XNAS.ITCH` is the same Nasdaq TotalView-ITCH feed the paper reached through
LOBSTER, so the mid-price here is the Nasdaq best bid/ask — this **matches** the
paper rather than departing from it, and using WRDS TAQ NBBO would not.

Two consequences to carry into the writeup:

- **RU-TC is biased conservative.** The transaction-cost input is the trailing
  90-day median spread, and the Nasdaq regional spread sits at or above the NBBO
  for NYSE-listed names. Never present these utility numbers as if they were
  directly comparable to NBBO-based ones. Noted in
  `src/eval/utility.py::trading_costs`.
- A **wide-spread robustness run** repeats the headline table excluding the
  widest decile of stocks by median relative spread, confirming no result depends
  on regional-book names.

## 4. LSTM sequence shaping: 21 days x bins-per-day

The paper does not specify its shaping. The naive reading is `p` timesteps of one
feature — 819 steps at the 10-min horizon, impractically deep for a recurrent net
and slow at every horizon.

**DECISION** (`src/features/lags.py::LagBuilder.sequence_rows`): the trading day
is the sequence unit. 21 timesteps, each carrying that day's bin vector; under
augmented cells the aggregate's bin vector is concatenated along the feature axis
(21 x 78 at 10-min). This preserves the diurnal vector as a coherent per-step
observation and cuts sequence length ~40x at the shortest horizon. Defensible as
an architecture in its own right, but it is a choice and must be reported.

## 5. XGBoost row subsampling at 10-min and 30-min

Even a binned `QuantileDMatrix` at 10-min UAM is ~9 GB. Rows are subsampled to
**20%** at the 10-min and 30-min horizons, **stratified by stock and
bin-of-day** (`src/models/trees.py::stratified_time_subsample`).

Stratification is not incidental: intraday RV has a strong diurnal profile, so a
plain random subsample would leave some buckets-of-day materially thinner than
others. 65-min and 1-day use the full sample.

## 6. NN ensemble size

The spec asks for 10 seeds. The runner takes `seeds` per cell and records the
actual count in `meta_["seeds"]` for every fitted model. **Report the number
actually used**; reduce it only if runtime demands and say so explicitly.

## 7. Half-days dropped from the intraday panel

An early 13:00 ET close gives ~210 minutes and therefore ragged bin counts at
every horizon. Half-days are dropped by calendar
(`src/data/calendar.py::full_sessions`), which logs the count — 19 over
2018-05 to 2026-09.

Sessions that are ragged for any *other* reason (a late open, a halt, a feed gap)
are dropped separately and logged separately, so the two causes are never
conflated (`src/data/clean.py::validate_sessions`).

## 8. CAM is an extension, not part of the original paper

The paper's three schemes conflate two orthogonal axes. Separating them is the
contribution:

|                        | Own RV only         | Own RV + aggregate RV        |
| ---------------------- | ------------------- | ---------------------------- |
| **SAM** (per stock)    | = paper's SINGLE    | new cell (aggregate: market) |
| **CAM** (per cluster)  | new cell            | new cell (aggregate: cluster)|
| **UAM** (all stocks)   | = paper's UNIVERSAL | = paper's AUGMENTED          |

The pooling axis controls which stocks' rows enter the training set; the feature
axis controls what predictors each row carries. All six cells are reported.
Present CAM explicitly as an extension with the 2x3 factorization made explicit.

---

# Additional choices this build made

These are not in spec Section 16, but they are decisions a referee would ask
about, so they are recorded here rather than buried in code.

## 9. Neural targets are standardized (train-window statistics)

**This is a correctness fix, not a stylistic choice.** Log RV sits around -12,
roughly nine standard deviations from a freshly initialized network's near-zero
output. Without target standardization the MLP and LSTM spend their entire epoch
budget travelling to the level rather than learning the signal: measured QLIKE
was ~12 against ~0.19 for OLS on identical data. With standardization they land
at ~0.21. Linear models are immune because the intercept absorbs the level.

Mean and standard deviation are computed by streaming over **training rows only**
(`src/models/nn.py::target_stats`) and inverted at prediction time.

## 10. HAR-D daily/weekly/monthly terms are rolling means of *log* RV

The paper does not pin down whether the d/w/m aggregation happens in log or level
space. Log space is used throughout, forced by two things the spec does fix: "log
RV throughout" (Section 4.2), and the market aggregate defined as a mean of log
RVs (Section 4.4).

At the 1-day horizon (`bins_per_day == 1`) this collapses to **exactly** standard
Corsi HAR — lag-1 daily, 5-day mean, 21-day mean — which is asserted in
`tests/test_gates.py`. See `src/features/har.py`.

## 11. The HAR-D diurnal term uses the trailing 21 days at the target's own bucket

`D_{i,tau}` is the mean log RV in the *target's* bucket-of-day over days
`d-21 .. d-1`, never the target's own day. Its furthest lookback is exactly
`tau - 21*bins_per_day`, the same p-lag boundary the lag models use, so HAR-D
gets no information they do not.

## 12. LASSO penalty selection: validation window, not 5-fold CV

Spec Section 5 says "lambda by 5-fold CV"; Section 5.2 says every model other
than HAR-D and OLS selects on the validation window. **These conflict.**

Default is validation-window selection: it matches Section 5.2, is consistent
with how every other tuned family selects here, and cannot leak across the fold
boundary. Blocked 5-fold CV on the training window is available via `cv=5` and is
**blocked, not random** — random k-fold on serially dependent data would let each
held-out fold's immediate neighbours sit in its training set. See
`src/models/linear.py::LassoGram`.

## 13. SARIMA intraday specification is ambiguous

"SARIMA with seasonal period = bins per day, other seasonal parameters zero"
reads literally as `P=D=Q=0`, which makes the seasonal period inert and reduces
the model to ARIMA(1,1,1) on the intraday series. That literal reading is the
default; `seasonal_order` is exposed so a genuine seasonal term such as
`(0,1,0,s)` can be run as a sensitivity check. **OPEN** — resolve before the
final writeup. See `src/models/sarima.py`.

## 14. A small adaptive ridge stabilizes the OLS Gram solve

At p=1638 with strongly collinear lagged RVs, `X'X` is routinely rank-deficient
in floating point. `solve_ridge` escalates a ridge from 1e-12 x trace/d until the
Cholesky succeeds, and logs when it bites. Without it a "pure" OLS solve returns
numerical garbage rather than failing loudly. The intercept is never penalized.

## 15. Realized utility uses `exp(forecast)`, not a log-normal correction

`E_t[exp(RV)]` is taken as `exp(forecast)`. A log-normal correction
`exp(mu + s^2/2)` would break the identity the spec requires as its unit test —
a perfect forecast must give exactly `SR^2/(2*gamma) = 0.04`, which only holds
with the plain exponential. The correction is available behind
`lognormal_correction` for a sensitivity check and is off by default.

## 16. RU-TC position scale is arbitrary but consistent

Because RV here is the variance of a single horizon-bin, raw mean-variance
positions are large in absolute terms. RU itself is scale-free; only the RU-TC
cost term's magnitude *relative* to RU depends on the scale. It is identical
across models, so model comparisons are unaffected. **Report the scale used
alongside any RU-TC table.**

## 17. Repository location

The spec's Section 13 layout assumes a fresh repository. This build lives under
`research/intraday-rv/`, preserving that layout exactly within the subdirectory,
because the repository root is an unrelated Next.js application.

---

# Open items to resolve before the final writeup

| # | Item | Where |
| - | ---- | ----- |
| 1 | Confirm `instrument_id` continuity across every ticker change against live data | `src/data/symbology.py::audit_ticker_continuity` |
| 2 | Verify the `BRK.B` raw-symbol spelling on XNAS.ITCH (`BRK B` / `BRK.B` / `BRKB`) | `src/universe.py::SYMBOL_ALIASES` |
| 3 | Decide the SARIMA intraday seasonal order (item 13) | `src/models/sarima.py` |
| 4 | Confirm the 10-min zero-return floor rate is near zero on live liquid names | `src/data/panel.py::log_rv` logs it |
| 5 | Cross-check detected corporate actions against Databento's `statistics` schema | `src/data/clean.py::detect_corporate_actions` |
| 6 | Report the NN seed count actually used | `meta_["seeds"]` per cell |
