"""Flat-file JSON store.

One pretty-printed ``db.json`` holds everything (settings, listings, tags, saved
filters). This is deliberately dead-simple and git-trackable per the design spec's
storage decision. Writes are atomic (temp file + ``os.replace``) and guarded by a
process-level lock so concurrent requests can't corrupt the file. For a two-person
tool with tens of listings this is more than enough; the access goes through this
one module so swapping in SQLite later is a contained change.
"""
from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import seed

# data/db.json sits next to the backend package by default; override for tests.
DATA_DIR = Path(os.environ.get("ROOST_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DB_PATH = DATA_DIR / "db.json"

_lock = threading.RLock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def _empty_db() -> dict[str, Any]:
    return {
        "settings": seed.default_settings(),
        "listings": [],
        "tags": seed.default_taxonomy(),
        "saved_filters": seed.default_saved_filters(),
    }


def init() -> None:
    """Create db.json with seed data on first run. Idempotent."""
    with _lock:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if not DB_PATH.exists():
            db = _empty_db()
            db["listings"] = seed.default_listings()
            _write(db)


def _read() -> dict[str, Any]:
    if not DB_PATH.exists():
        init()
    with DB_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _write(db: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DB_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(db, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, DB_PATH)  # atomic on POSIX


def load() -> dict[str, Any]:
    with _lock:
        return _read()


def mutate(fn):
    """Run ``fn(db)`` under the lock and persist the result. ``fn`` mutates the dict
    in place and returns whatever the caller needs (e.g. the created listing)."""
    with _lock:
        db = _read()
        result = fn(db)
        _write(db)
        return result


# --- convenience accessors -------------------------------------------------

def list_listings() -> list[dict]:
    return load()["listings"]


def get_listing(listing_id: str) -> dict | None:
    return next((l for l in load()["listings"] if l["id"] == listing_id), None)


def get_settings() -> dict:
    return load()["settings"]


def list_tags() -> list[dict]:
    return load()["tags"]


def list_saved_filters() -> list[dict]:
    return load()["saved_filters"]
