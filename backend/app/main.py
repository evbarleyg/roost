"""Roost backend — FastAPI app.

Local-first, single-couple apartment-scouting tool. Holds the Anthropic key and
proxies LLM intake + directions; all data lives in a flat JSON file.
"""
from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()  # pick up backend/.env (ANTHROPIC_API_KEY, optional directions keys)

from . import store  # noqa: E402  (after load_dotenv so env is ready)
from .routes import commute, export, intake, listings, saved_filters, settings, tags  # noqa: E402

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


for r in (listings, intake, tags, settings, saved_filters, commute, export):
    app.include_router(r.router)
