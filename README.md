# 🪺 Roost

A personal, single-couple web app for hunting an SF rental. It replaces a
weighted-scoring spreadsheet with a live ranking **plus** qualitative tag
filtering ("modern luxury finishes", "high-rise with view", "bright"), and a
paste-a-listing intake step where Claude drafts the structured fields, suggested
ratings, and tags for you to edit.

Local-first, two users (you + your fiancé), no accounts. Built from the design spec.

## Decisions baked in (v1)

| Decision | Choice |
|---|---|
| Run mode | **Local-only** — no auth, no hosting |
| Commute | **Live directions API**, pluggable (OSRM default = no key; Google/Mapbox/ORS for transit) + haversine sanity check |
| Intake | **Auto-fetch URL** with graceful fallback to paste-the-text |
| Storage | **Flat JSON** (`backend/data/db.json`, atomic writes, git-trackable) |
| Ratings | Embedded per-rater for the two-rater divergence view |

## Stack

- **Backend:** FastAPI + a flat JSON store. Holds the Anthropic key and proxies
  LLM intake + directions.
- **Frontend:** React + Vite + Tailwind. TanStack/shadcn were suggested in the
  spec; this build hand-rolls a sortable table and Tailwind components to keep the
  dependency surface small. Map is Leaflet + OpenStreetMap (no key).

## Quick start

Two terminals.

### 1. Backend (port 8000)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add ANTHROPIC_API_KEY for LLM intake
uvicorn app.main:app --reload
```

On first run it seeds `data/db.json` with the defaults (anchor = 500 Howard,
2-bed, $6k cap, the five target neighborhoods), the tag taxonomy, the two saved
filters, and the four existing candidates (923 Folsom fully populated; the other
three are stubs to edit). API docs at <http://localhost:8000/docs>.

### 2. Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The dev server proxies `/api` → the backend.

## What works

- **Rank table** — sortable, color-scale score column, inline-editable rating
  cells (per rater), clickable source links. Default sort: combined score desc.
- **Card** and **Map** views (markers colored by score, 500 Howard anchor pinned).
- **Filter rail** — rent/sqft/commute/beds/neighborhood/min-score, must-have
  toggles, and **faceted tag chips with live counts** (AND across categories, OR
  within). Saved presets ("Fiancé's picks", "Under $5k + bright + view").
- **LLM intake** — paste a URL (auto-fetched) or text → Claude draft → review &
  edit every field/rating/tag → save. Opens the detail drawer to confirm.
- **Detail drawer** — full edit, **dual-rater scoring side by side** with a
  "you disagree" flag (Δ ≥ threshold), commute lookup, tags, amenities, notes.
- **Settings** — weights (live re-rank as you drag), commute bands, anchor,
  provider, defaults. CSV export round-trips with your spreadsheet.

## Configuration

`backend/.env` (copy from `.env.example`):

- `ANTHROPIC_API_KEY` — **required for intake only.** Stays server-side.
- `GOOGLE_MAPS_API_KEY` / `MAPBOX_TOKEN` / `ORS_API_KEY` — only if you switch the
  directions provider in Settings to get true transit/walking times. The default
  OSRM provider needs no key (driving only).

## Layout

```
backend/
  app/
    main.py            FastAPI app + routers
    models.py          Pydantic shapes (DIMENSIONS, Listing, Settings…)
    store.py           flat-file JSON store (atomic writes, locking)
    seed.py            defaults, taxonomy, saved filters, candidates
    scoring.py         weighted score, $/sqft, commute bands, divergence
    commute.py         geocode + pluggable directions providers + haversine
    intake.py          URL fetch + Claude structured extraction (prompt-cached)
    routes/            listings, tags, settings, saved_filters, intake, commute, export
  data/db.json         created on first run
frontend/
  src/
    scoring.ts         client mirror of scoring.py (instant re-rank)
    store.ts           zustand state
    api.ts  types.ts
    components/        RankTable, CardGallery, MapView, FilterRail,
                       DetailDrawer, IntakeDialog, SettingsDialog, …
```

## Notes & non-goals

- Not a scraper — intake is single-listing, user-initiated.
- The client computes scores/filters off stored ratings + weights for instant
  re-ranking; `scoring.ts` and `scoring.py` must stay in sync.
- No accounts, payments, or identity data.
