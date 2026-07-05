# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
Roost is a local-first San Francisco rental explorer: a FastAPI flat-JSON backend (`backend/`)
and a React + Vite + Tailwind + Leaflet frontend (`frontend/`). It is a **read-only exploration
tool** (browse / filter / compare scraped listings); the only in-app edits are per-listing notes
and status. Ranking and all heavy data work happen out-of-band (see Architecture).

## Commands

Backend (port 8000):
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate   # first time only
pip install -r requirements.txt
uvicorn app.main:app --reload
```
- **No API key required** — the running app makes no LLM calls. `backend/.env` (see
  `.env.example`) is only for optional paid directions providers and `ROOST_ALLOW_REFRESH`;
  the default OSRM commute provider needs no key.
- API docs at http://localhost:8000/docs. `data/db.json` is seeded on first run.

Frontend (port 5173, dev-proxies `/api` → backend):
```bash
cd frontend && npm install && npm run dev
```

Verify: there is **no test suite**. The gate is the frontend typecheck:
```bash
cd frontend && npx tsc --noEmit
```
(No backend linter/tests are configured; `python -c "from app.main import app"` smoke-checks imports.)

Static build + deploy:
```bash
cd frontend && npm run build:static   # bakes db.json → public/data, builds dist/
```
Deployed on Vercel as a static site (no backend) at https://roost-mu.vercel.app. The GitHub repo
is linked, so **pushing to `main` auto-deploys**. `vercel.json` holds the build config.

## Architecture (the parts that span multiple files)

- **One flat-JSON store.** All state (settings, listings, tags, saved_filters) lives in
  `backend/data/db.json`. Every access goes through `backend/app/store.py` (atomic temp-file
  writes + a process lock) — the single place to change to swap in a real DB. db.json is
  intentionally git-tracked.

- **Scoring is mirrored on both sides; keep them in sync.** `backend/app/scoring.py` and
  `frontend/src/scoring.ts` implement the SAME weighted/combined score, $/sqft, commute-band,
  and filter logic. The frontend recomputes derived values on read for instant re-ranking; the
  server copy backs CSV export. Change one, change the other.

- **Derived data is never stored.** Scores, $/sqft, and the commute rating are computed on read
  (`scoring.py:enrich` / `scoring.ts:derive`), not persisted to db.json.

- **The app makes NO live LLM calls.** It is a pure data layer. The only remaining LLM work is
  **listing intake** — extracting a pasted listing into structured fields — done in a Claude Code
  session that writes directly into db.json (the old `/listings/extract` intake endpoint was
  removed). Listings carry a special `auto` rater (1–5 scores, now produced by `autoscore.py`,
  see below); `combined_score` falls back to `auto` when no human has rated, and `ranked_by`
  reports `human`/`auto`/`none`.

- **Auto-scoring is deterministic, not LLM.** `backend/scripts/autoscore.py` fills
  `ratings.auto` with pure math + encoded judgment: value/space from rent/sqft ranked into
  quintiles *within the dataset*, safety/views from a per-neighborhood table in the script,
  quality from amenity flags and keyword bumps/penalties. Commute is deliberately omitted (the
  app derives it from minutes). Human ratings are never touched. Flags: `--all` (re-score
  everything), `--dry-run`. It backs up db.json first.

- **Data-maintenance primitives** in `backend/scripts/` must run **on a VPN** (Craigslist
  IP-blocks scraping; it returns HTTP **410** for expired posts). The scrapers are idempotent,
  throttled, hard-stop on the first 403/429 or block page, and back up db.json first:
  - `collect_cl.mjs` — discover new CL posts, dedupe against existing ids, append (list-level;
    neighborhoods normalized via a canonical map embedded in the script).
  - `refresh_listings.mjs` — liveness-check every listing (sets `link_status` live/dead/unknown)
    and re-enrich missing detail fields. Flags: `--limit N`, `--fresh-within H`, `--dead-only`.
  - `dedupe_listings.mjs` — cluster reposts and mark all but one with `duplicate_of` (local,
    no network).
  - Typical incremental cycle: **collect → enrich (`--fresh-within 1`) → dedupe → autoscore →
    commit + push**. Three ways to run it: `backend/scripts/refresh.sh` (stops on first failing
    step), `POST /refresh` (runs all steps regardless, returns a per-step summary), or the
    top-bar **Refresh button** in the UI.

- **Operator-only refresh endpoint.** `backend/app/routes/refresh.py` exposes `GET /refresh`
  (enabled?) and `POST /refresh` (run the cycle as subprocesses). Gated by `ROOST_ALLOW_REFRESH`
  (default **on** — set to 0 if the backend is ever hosted for others). The frontend shows the
  Refresh button only when the backend reports it enabled; the static deploy has no backend, so
  it never appears there.

- **Static-deploy duality.** `frontend/src/api.ts` swaps between `liveApi` (`/api` → backend) and
  a localStorage-backed `staticApi` that reads baked `/data/*.json`, chosen by the `VITE_STATIC`
  build flag (`static.ts`; data baked by `scripts/build-static-data.mjs`). In static mode, edits
  persist per-browser to localStorage and backend-only affordances (CSV export, live commute,
  the Refresh button) are hidden.

- **Hidden-by-default listings.** The UI filters out `link_status === "dead"` and any listing with
  `duplicate_of` unless the "Show hidden" filter is on (`scoring.ts:passes`).

- **Frontend shape.** `store.ts` (zustand) holds the raw data; components derive everything via
  `scoring.ts`. Three views (RankTable / CardGallery / MapView) + a DetailDrawer + a FilterRail
  that collapses into a slide-over drawer on mobile.

## Conventions & gotchas
- Neighborhoods are normalized to ~45 canonical names; the original free-text is preserved in
  `neighborhood_raw`. Keep new listings consistent via `collect_cl.mjs`'s embedded map.
- Don't hand-edit db.json — go through `store.py` (backend) or the scripts (which back up first).
  The `db.backup.*.json` snapshots are gitignored.
- `anthropic` and `beautifulsoup4` remain in `backend/requirements.txt` but are now unused.
- **`README.md` is partially stale** — it predates this work and still describes a live LLM intake
  endpoint, a required Anthropic key, and "not a scraper." The first line of `.env.example`
  ("ANTHROPIC_API_KEY is required") is stale for the same reason. Trust this file and the code
  over them.
- `HANDOFF.md` tracks current data/feature state and is a good first read for ongoing context.
