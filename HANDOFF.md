# Roost — session handoff

Context for continuing this work in Claude Code (VS Code). Read this first.

## What Roost is
Personal SF **rental**-hunting app (two raters: you + fiancé). FastAPI backend
(`backend/`, port 8000) with a flat-JSON store at `backend/data/db.json`; React +
Vite + Leaflet frontend (`frontend/`, port 5173, proxies `/api` → backend).

## State of the data
- **~1,210 Craigslist SF listings** in `db.json`, all in-SF, all with a link-out
  `url` (the 4 original hand-made candidates have empty `url`).
- **~573 deeply enriched** (beds/baths/sqft, photos, `listed_at` +
  `days_on_market`, amenities). The other **633 are list-level only** — exact
  predicate: `source == "Craigslist" AND listed_at IS null`.
- **Model auto-scores applied**: 1,207 listings have an `auto` rater on
  `ratings` (safety/value/quality/views/space). `scoring.py` uses `auto` only as a
  fallback when neither human has rated; `ranked_by()` reports human/auto/none.

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

## NEXT TASK / open follow-ups
- **Backfill the 633 list-level listings** — BLOCKED. A test request to a CL
  detail page returned **HTTP 403 (IP hard-blocked)**. Wait for the block to
  clear (hours–days) or use a different IP/proxy. When clear, run a **targeted
  in-place** backfill (NOT wholesale `enrich_all.mjs`): select
  `source=="Craigslist" && !listed_at`, fill only missing fields, skip-on-failure
  (idempotent), CONCURRENCY=2 + ~1.5s throttle, stop immediately on any 403/429.
  Scraper scripts: `/tmp/collect_craigslist.mjs`, `/tmp/enrich_all.mjs`.
- **PREREQUISITE for any LLM call** (intake dialog): `backend/.env` does not
  exist, so `ANTHROPIC_API_KEY` is unset. `cd backend && cp .env.example .env`
  then add the key.
- **Move scraper scripts into the repo** (they're one-offs in `/tmp/`).
- The 4 original listings have empty `url` (don't link out) — decide keep/drop.

## Run it
```bash
# backend (terminal 1)
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload
# frontend (terminal 2)
cd frontend && npm run dev      # http://localhost:5173
```
