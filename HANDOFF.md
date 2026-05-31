# Roost — session handoff

Context for continuing this work in Claude Code (VS Code). Read this first.

## What Roost is
Personal SF **rental**-hunting app. FastAPI backend (`backend/`, port 8000) with a
flat-JSON store at `backend/data/db.json`; React + Vite + Leaflet frontend
(`frontend/`, port 5173, proxies `/api` → backend). It is an **exploratory browser**,
not a rating tool: rich read-only listing info, light notes/status only.

## Architecture: the app makes NO LLM calls
The running app is a pure data layer (serve + mutate `db.json`, proxy directions).
There is **no API key and no live LLM path** — the old `/listings/extract` intake
endpoint and `backend/app/intake.py` were removed. All LLM work is done **in a
Claude Code session** (the user's subscription, not metered API) writing straight
into `db.json`:
- **Auto-scoring** listings on the 1–5 dimensions → the `auto` rater on `ratings`.
- **Listing intake**: paste a URL/listing text to Claude Code; it extracts the
  structured fields and adds the row (this replaces the old in-app intake dialog).
Re-scoring/adding listings is therefore a dev-session task, not a runtime feature.

## State of the data
- **1,306 listings** in `db.json` (1,302 Craigslist + 4 hand-made). Nearly all
  deeply enriched (beds/baths/sqft, photos, `listed_at`, amenities).
- **Liveness tracked** via `link_status` (`live` / `dead` / `unknown`) + `checked_at`.
  Last refresh: ~1,072 live, ~130 dead (expired/deleted CL posts, hidden in the UI
  by default — "Show expired" toggle reveals them).
- **Every listing auto-scored**: `ratings.auto` (safety/value/quality/views/space) +
  `auto_scored: true`. `scoring.py`/`scoring.ts` use `auto` only as a fallback when
  no human rated; `ranked_by()` reports human/auto/none.
- Neighborhoods normalized to **45 canonical** SF names; original in `neighborhood_raw`.

## Done recently
- **git initialized** + baseline commit. `.gitignore` excludes `node_modules/`,
  `.venv/`, `backend/.env`, and `backend/data/db.backup.*.json`. `db.json` is
  tracked on purpose.
- **Neighborhoods normalized**: the 74 free-text Craigslist neighborhood strings
  collapsed to **45 canonical** SF names. Original kept on each listing as
  `neighborhood_raw`; 136 pure city/address-junk values blanked to `""`. The
  frontend filter (`FilterRail`) now shows clean canonical toggles.
- **Map clustering**: `MapView.tsx` clusters the ~1,210 pins client-side in
  pixel-space (60px grid, re-derives on pan/zoom), no new dependency. Single-pin
  cells keep the original interactive marker; multi-pin cells are a count badge
  that zooms into its members on click. `.roost-cluster` styles in `index.css`.

## Data-maintenance primitives (run ON A VPN — CL IP-blocks scraping)
Two idempotent, throttled, block-aware scripts in `backend/scripts/`. The usual
cycle is collect → refresh → auto-score:
- **`collect_cl.mjs`** — discover NEW CL posts (9 price-band searches), dedupe
  against existing ids, append new in-SF rows (list-level, neighborhoods
  normalized via an embedded canonical map). ~9 light requests.
- **`refresh_listings.mjs`** — one pass over CL listings: liveness-check (sets
  `link_status`) + re-enrich missing fields. Flags: `--limit N`, `--fresh-within H`
  (skip recently-checked — use after a collect to hit only new rows), `--dead-only`.
  Note CL returns **HTTP 410** (not 404) for expired posts.
- **Auto-scoring** new rows is done in a Claude Code session (see Architecture).

## Open follow-ups
- `anthropic` / `beautifulsoup4` in `backend/requirements.txt` are now unused — drop.
- The auto-score workflow's index-range batching can double-score/skip; the run is
  deduped + gap-filled by hand. Make the batching robust before reusing at scale.
- The 4 original listings have empty `url` (don't link out) — decide keep/drop.

## Run it
```bash
# backend (terminal 1)
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload
# frontend (terminal 2)
cd frontend && npm run dev      # http://localhost:5173
```
