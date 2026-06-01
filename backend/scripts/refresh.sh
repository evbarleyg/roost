#!/usr/bin/env bash
# Incremental "recent only" data refresh — run by hand as an alternative to the
# in-app Refresh button (POST /refresh runs these same four steps). Discovers new
# Craigslist posts, enriches just the newly-added ones, dedupes reposts, and
# auto-scores. No LLM / API key needed (auto-scoring is pure math). Run on a VPN
# so Craigslist doesn't IP-block the fetches.
#
# Usage:  backend/scripts/refresh.sh        (works from any directory)
#
# Stops on the first failing step (e.g. a Craigslist block). To skip the enrich
# step's freshness window and re-check everything, run the scripts directly instead.
set -euo pipefail

# Resolve the repo root from this script's own location so cwd doesn't matter
# (collect/refresh/dedupe read backend/data/db.json relative to the working dir).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PY="${PYTHON:-python3}"

echo "==> 1/4 collect: discover new Craigslist posts"
node backend/scripts/collect_cl.mjs

echo "==> 2/4 enrich: fill details for just-added listings"
node backend/scripts/refresh_listings.mjs --fresh-within 1

echo "==> 3/4 dedupe: mark reposts (local, no network)"
node backend/scripts/dedupe_listings.mjs

echo "==> 4/4 autoscore: score new listings (local, no network)"
"$PY" backend/scripts/autoscore.py

echo "==> done. Review and commit backend/data/db.json to publish."
