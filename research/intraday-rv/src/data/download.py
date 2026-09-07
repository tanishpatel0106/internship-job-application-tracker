"""Databento batch download: cost-checked, chunked by year, resumable.

Spec Section 2: XNAS.ITCH / bbo-1m, the same Nasdaq ITCH feed the paper reached
through LOBSTER. ~200M raw records (~10 GB DBN) exceeds the 5 GB streaming
threshold, so the bulk pull goes through `batch.submit_job`, chunked by year so
jobs stay manageable and restartable.

Hard rule (spec Section 2.4): `metadata.get_cost` is called before every batch
submission and the job is refused if the quote exceeds the configured budget.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

from src.config import RAW_DATA
from src.universe import all_request_symbols

log = logging.getLogger(__name__)

DATASET = "XNAS.ITCH"
SCHEMA = "bbo-1m"

# Verified coverage (spec Section 2.3).
COVERAGE_START = "2018-05-01"
COVERAGE_END = "2026-09-05"

# Verified unit cost: $0.006199777126 per symbol-month (spec Section 2.4).
UNIT_COST_SYMBOL_MONTH = 0.006199777126

MANIFEST = RAW_DATA / "download_manifest.json"


class BudgetExceeded(RuntimeError):
    """Raised when a priced job would breach the configured budget."""


@dataclass
class DownloadPlan:
    """One year-chunk of the pull."""

    start: str
    end: str
    symbols: list[str]
    job_id: str | None = None
    cost_usd: float | None = None
    state: str = "pending"     # pending -> priced -> submitted -> done
    files: list[str] = field(default_factory=list)

    @property
    def chunk_id(self) -> str:
        return f"{self.start}_{self.end}"


def _client(api_key: str | None = None):
    """Databento historical client. The key is read from the environment."""
    key = api_key or os.environ.get("DATABENTO_API_KEY")
    if not key:
        raise RuntimeError(
            "DATABENTO_API_KEY is not set. Export it before running the "
            "download; never hardcode it (spec Section 2.1)."
        )
    import databento as db

    return db.Historical(key)


def verify_coverage(client=None) -> dict:
    """Confirm the dataset range still spans what the spec verified."""
    client = client or _client()
    rng = client.metadata.get_dataset_range(dataset=DATASET)
    start, end = str(rng["start"]), str(rng["end"])
    log.info("%s coverage: %s .. %s", DATASET, start, end)
    if not start.startswith(COVERAGE_START[:7]):
        log.warning(
            "coverage start %s differs from the spec-verified %s -- the sample "
            "schedule in config.FOLDS may need revisiting", start, COVERAGE_START
        )
    return {"start": start, "end": end}


def build_plans(
    start: str = COVERAGE_START,
    end: str = COVERAGE_END,
    symbols: list[str] | None = None,
) -> list[DownloadPlan]:
    """Split the pull into calendar-year chunks (spec Section 2.11)."""
    symbols = symbols or all_request_symbols()
    plans: list[DownloadPlan] = []
    y0, y1 = int(start[:4]), int(end[:4])
    for year in range(y0, y1 + 1):
        chunk_start = max(f"{year}-01-01", start)
        chunk_end = min(f"{year + 1}-01-01", end)
        if chunk_start >= chunk_end:
            continue
        plans.append(DownloadPlan(chunk_start, chunk_end, list(symbols)))
    return plans


def price_plan(plan: DownloadPlan, client=None) -> float:
    """Price one chunk with `metadata.get_cost`. Always called before submit."""
    client = client or _client()
    cost = client.metadata.get_cost(
        dataset=DATASET,
        symbols=plan.symbols,
        schema=SCHEMA,
        start=plan.start,
        end=plan.end,
        stype_in="raw_symbol",
    )
    plan.cost_usd = float(cost)
    plan.state = "priced"
    log.info("chunk %s: $%.4f (%d symbols)", plan.chunk_id, cost, len(plan.symbols))
    return plan.cost_usd


def estimate_total(plans: list[DownloadPlan], client=None) -> float:
    """Price every chunk and return the total. Cheap; call before committing."""
    client = client or _client()
    total = sum(price_plan(p, client) for p in plans)
    log.info("TOTAL ESTIMATED COST: $%.2f across %d chunks", total, len(plans))
    return total


def submit_plan(
    plan: DownloadPlan,
    client=None,
    budget_usd: float = 125.0,
    spent_so_far: float = 0.0,
) -> str:
    """Price, budget-check, then submit one chunk as a batch job."""
    client = client or _client()
    if plan.cost_usd is None:
        price_plan(plan, client)
    if spent_so_far + plan.cost_usd > budget_usd:
        raise BudgetExceeded(
            f"chunk {plan.chunk_id} costs ${plan.cost_usd:.4f}; "
            f"${spent_so_far:.2f} already committed against a "
            f"${budget_usd:.2f} budget"
        )
    job = client.batch.submit_job(
        dataset=DATASET,
        symbols=plan.symbols,
        schema=SCHEMA,
        start=plan.start,
        end=plan.end,
        stype_in="raw_symbol",
        encoding="dbn",
        compression="zstd",
        split_duration="month",
    )
    plan.job_id = job["id"]
    plan.state = "submitted"
    log.info("submitted chunk %s as job %s", plan.chunk_id, plan.job_id)
    return plan.job_id


def await_job(plan: DownloadPlan, client=None, poll_seconds: int = 60,
              timeout_seconds: int = 24 * 3600) -> str:
    """Block until a batch job reaches a terminal state."""
    client = client or _client()
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        jobs = {j["id"]: j for j in client.batch.list_jobs()}
        state = jobs.get(plan.job_id, {}).get("state", "unknown")
        log.info("job %s state=%s", plan.job_id, state)
        if state in ("done", "expired"):
            return state
        if state in ("failed", "cancelled"):
            raise RuntimeError(f"batch job {plan.job_id} ended in state {state}")
        time.sleep(poll_seconds)
    raise TimeoutError(f"batch job {plan.job_id} did not finish in time")


def download_job(plan: DownloadPlan, client=None,
                 out_dir: Path | None = None) -> list[str]:
    """Download a finished job's files, skipping any already on disk."""
    client = client or _client()
    out_dir = Path(out_dir or RAW_DATA / plan.chunk_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    client.batch.download(job_id=plan.job_id, output_dir=str(out_dir))
    files = sorted(str(p) for p in out_dir.rglob("*.dbn.zst"))
    plan.files = files
    plan.state = "done"
    log.info("chunk %s: %d files in %s", plan.chunk_id, len(files), out_dir)
    return files


# --- Manifest: makes the whole pull resumable ----------------------------

def load_manifest() -> dict[str, dict]:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {}


def save_manifest(plans: list[DownloadPlan]) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        p.chunk_id: {
            "start": p.start, "end": p.end, "job_id": p.job_id,
            "cost_usd": p.cost_usd, "state": p.state,
            "n_symbols": len(p.symbols), "files": p.files,
        }
        for p in plans
    }
    MANIFEST.write_text(json.dumps(payload, indent=2))


def apply_manifest(plans: list[DownloadPlan]) -> list[DownloadPlan]:
    """Restore prior progress so a re-run resumes rather than re-submits."""
    saved = load_manifest()
    for p in plans:
        prev = saved.get(p.chunk_id)
        if not prev:
            continue
        p.job_id = prev.get("job_id")
        p.cost_usd = prev.get("cost_usd")
        p.state = prev.get("state", "pending")
        p.files = prev.get("files", [])
    return plans


def run(
    start: str = COVERAGE_START,
    end: str = COVERAGE_END,
    symbols: list[str] | None = None,
    budget_usd: float = 125.0,
    dry_run: bool = True,
) -> list[DownloadPlan]:
    """Full pull. `dry_run=True` prices everything and submits nothing.

    Always run once with `dry_run=True` and read the quoted total before
    committing spend.
    """
    client = _client()
    verify_coverage(client)
    plans = apply_manifest(build_plans(start, end, symbols))

    total = 0.0
    for plan in plans:
        if plan.state == "done":
            total += plan.cost_usd or 0.0
            log.info("chunk %s already complete; skipping", plan.chunk_id)
            continue
        if plan.cost_usd is None:
            price_plan(plan, client)
        total += plan.cost_usd

    log.info("priced total: $%.2f (budget $%.2f)", total, budget_usd)
    if total > budget_usd:
        raise BudgetExceeded(f"total ${total:.2f} exceeds budget ${budget_usd:.2f}")
    save_manifest(plans)

    if dry_run:
        log.info("DRY RUN -- nothing submitted. Re-run with dry_run=False.")
        return plans

    spent = 0.0
    for plan in plans:
        if plan.state == "done":
            spent += plan.cost_usd or 0.0
            continue
        if plan.state != "submitted":
            submit_plan(plan, client, budget_usd=budget_usd, spent_so_far=spent)
            save_manifest(plans)
        spent += plan.cost_usd or 0.0
        await_job(plan, client)
        download_job(plan, client)
        save_manifest(plans)
    return plans
