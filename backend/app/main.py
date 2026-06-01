"""Roost backend — FastAPI app.

Local-first, single-couple apartment-scouting tool. This is a pure data layer: it
serves and mutates a flat JSON file and proxies directions lookups. It makes NO
LLM calls — listing extraction and auto-scoring are done out-of-band in a Claude
Code session that writes results straight into db.json (no API key required).
"""
from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()  # pick up backend/.env (optional directions API keys; no LLM key needed)

from . import store  # noqa: E402  (after load_dotenv so env is ready)
from .routes import commute, export, listings, refresh, saved_filters, settings, tags  # noqa: E402

app = FastAPI(title="Roost", version="0.1.0", description="Personal apartment-scouting app")

# Local-only tool: allow the Vite dev server origins.
_origins = os.environ.get("ROOST_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    store.init()  # seed db.json on first run


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


for r in (listings, tags, settings, saved_filters, commute, export, refresh):
    app.include_router(r.router)
