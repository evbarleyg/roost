"""Incremental data-refresh endpoint (operator-only).

Runs the lightweight "recent only" maintenance cycle that keeps db.json current
without the heavy full re-scrape: discover new Craigslist posts, enrich just the
newly-added ones, dedupe reposts, and auto-score. None of this needs an LLM or an
API key — auto-scoring is pure math (see scripts/autoscore.py). The only real
requirement is masked egress for the Craigslist fetches: run the backend on a VPN.

This route only exists while the FastAPI backend is running, so the public static
deploy (which has no backend) never exposes it. It is additionally gated by the
ROOST_ALLOW_REFRESH env var so you can turn it off if you ever host this backend
for other people. The same cycle can be run by hand via scripts/refresh.sh.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from .. import store

router = APIRouter(prefix="/refresh", tags=["refresh"])

# repo root = .../roost  (this file is roost/backend/app/routes/refresh.py)
REPO_ROOT = Path(__file__).resolve().parents[3]

_SCRIPTS = "backend/scripts"
# The incremental cycle, in order. The Craigslist scripts resolve db.json relative
# to cwd (backend/data/db.json), so we run from the repo root; autoscore.py resolves
# relative to its own path, so cwd doesn't matter for it. --fresh-within 1 makes the
# enrich step touch only listings not checked in the last hour (i.e. the just-added
# ones), keeping the Craigslist footprint tiny.
_STEPS: list[tuple[str, list[str]]] = [
    ("collect", ["node", f"{_SCRIPTS}/collect_cl.mjs"]),
    ("enrich", ["node", f"{_SCRIPTS}/refresh_listings.mjs", "--fresh-within", "1"]),
    ("dedupe", ["node", f"{_SCRIPTS}/dedupe_listings.mjs"]),
    ("autoscore", [sys.executable, f"{_SCRIPTS}/autoscore.py"]),
]
_STEP_TIMEOUT = 600  # seconds per step


def _enabled() -> bool:
    return os.environ.get("ROOST_ALLOW_REFRESH", "1").strip().lower() not in ("0", "false", "no", "off", "")


@router.get("")
def refresh_status() -> dict:
    """Whether the in-app Refresh button should be shown / the endpoint will run."""
    return {"enabled": _enabled()}


@router.post("")
def run_refresh() -> dict:
    """Run the incremental collect -> enrich -> dedupe -> autoscore cycle.

    Synchronous: returns once every step has finished (or hard-stopped). Steps run
    even if an earlier one fails — the local dedupe/autoscore steps are always safe,
    and a Craigslist block just yields an empty collect. Each step's tail output is
    returned so the caller can see what happened.
    """
    if not _enabled():
        raise HTTPException(403, "Data refresh is disabled (set ROOST_ALLOW_REFRESH=1 to enable).")

    before = len(store.list_listings())
    steps_out: list[dict] = []
    for name, argv in _STEPS:
        try:
            proc = subprocess.run(
                argv,
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                timeout=_STEP_TIMEOUT,
                env=os.environ.copy(),
            )
            combined = ((proc.stdout or "") + (proc.stderr or "")).strip()
            steps_out.append({
                "step": name,
                "ok": proc.returncode == 0,
                "returncode": proc.returncode,
                "tail": combined[-800:],
            })
        except FileNotFoundError as e:
            # e.g. `node` not on PATH for the uvicorn process.
            steps_out.append({"step": name, "ok": False, "returncode": None, "tail": f"command not found: {e}"})
        except subprocess.TimeoutExpired:
            steps_out.append({"step": name, "ok": False, "returncode": None, "tail": f"timed out after {_STEP_TIMEOUT}s"})

    after = len(store.list_listings())  # store reads db.json fresh each call
    return {
        "ok": all(s["ok"] for s in steps_out),
        "listings_before": before,
        "listings_after": after,
        "added": max(0, after - before),
        "steps": steps_out,
    }
