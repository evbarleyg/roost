# Roost — session handoff

Context for continuing this work in Claude Code (VS Code). Read this first.

## What Roost is
Personal SF **rental**-hunting app (two raters: you + fiancé). FastAPI backend
(`backend/`, port 8000) with a flat-JSON store at `backend/data/db.json`; React +
Vite + Leaflet frontend (`frontend/`, port 5173, proxies `/api` → backend).

## What was just done
- **Scraped the full active Craigslist SF apartment inventory** into `db.json`:
  partitioned the search by 9 price bands (CL caps each query at 357 static
  results), deduped by post id → **~1,210 listings**, all in-SF, **all with a
  link-out `url`**.
- **~573 deeply enriched** from detail pages (beds/baths/sqft, photos, real
  posting date `listed_at` + `days_on_market`, amenities). The other **~633 were
  rate-limited** and have list-level fields only (rent, geo, neighborhood, beds
  parsed from title) — they still link out.
- Original 4 hand-made candidates are kept (their `url` is empty).
- Backup of the pre-scrape db: `backend/data/db.backup.1780174622635.json`.
- One-off scraper scripts live in `/tmp/` (`collect_craigslist.mjs`,
  `enrich_all.mjs`) — not yet in the repo.

## NEXT TASK: model autoscoring (the active request)
Goal: have **Claude auto-rate listings** on the 1–5 dimensions so the rank table
isn't empty for the 1,210 scraped rows (they currently have empty `ratings`).

What already exists to build on:
- `backend/app/scoring.py` — weighted score over `DIMENSIONS = [safety, value,
  commute, quality, views, space]`, per-rater (`you`/`fiance`), `combined_score`
  = mean of raters. `commute` is derived from minutes→bands, not rated by hand.
- `backend/app/intake.py` — **already calls Claude** via tool-use
  (`save_listing_draft`) and returns `suggested_ratings` (1–5 per dimension) using
  a **cached system block + taxonomy**. Model = `settings.extract_model`
  (`claude-sonnet-4-6`). Key stays server-side. **Reuse this pattern.**

Design decisions for autoscoring (recommend):
1. **Where auto scores go.** Add a dedicated rater key `"auto"` on
   `listing.ratings` (don't overwrite human `you`/`fiance`). Then extend
   `combined_score` / ranking to use `auto` as a fallback when no human has rated.
   Alternative: prefill empty `you`/`fiance` as editable suggestions.
2. **Batch the calls.** ~1,210 listings → batch ~25/call with the static
   instructions in a cached system block → ~50 calls. Score from
   `name + highlights + neighborhood + rent + sqft + beds/baths + amenities`.
   Leave `commute` null (app derives it).
3. **Surface it.** Add `POST /listings/{id}/autoscore` and a bulk
   `POST /listings/autoscore-all`; add an "Auto-score" button in the frontend.
   Keep server scoring math (`scoring.py`) and the frontend copy in sync.
4. **Never overwrite human ratings**; mark auto rows so the UI can show "AI" vs
   "rated by you".

## PREREQUISITE — do this first
`backend/.env` does **not** exist, so `ANTHROPIC_API_KEY` is unset and any LLM call
will fail:
```bash
cd backend && cp .env.example .env   # then add ANTHROPIC_API_KEY=sk-ant-...
```

## Other open follow-ups
- **git**: repo is NOT initialized. `git init`, add `.gitignore`
  (`node_modules/`, `.venv/`, `.env`, `backend/data/db.backup.*.json`), commit a
  baseline before more changes.
- **Backfill the ~633** list-level listings (re-run detail enrichment after a
  Craigslist cooldown) for fuller photos/sqft/dates — better autoscore inputs.
- **Normalize neighborhoods** (Craigslist free-text → your 5 canonical hoods).
- **Map performance**: 1,210 Leaflet pins — add marker clustering or cap.
- The 4 original listings have empty `url` (don't link out) — decide keep/drop.

## Run it
```bash
# backend (terminal 1)
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload
# frontend (terminal 2)
cd frontend && npm run dev      # http://localhost:5173
```
