"""Tag taxonomy + per-tag match counts (Section 10: GET /tags).

Counts here are global (over all listings). The filter rail computes *faceted*
counts (reflecting the current filter) client-side, since it already holds the full
listing set for instant re-ranking.
"""
from __future__ import annotations

from collections import Counter

from fastapi import APIRouter
from pydantic import BaseModel

from .. import store

router = APIRouter(prefix="/tags", tags=["tags"])


class NewTag(BaseModel):
    label: str
    category: str = "custom"


@router.get("")
def get_tags():
    db = store.load()
    counts: Counter[str] = Counter()
    for listing in db["listings"]:
        counts.update(listing.get("tags") or [])
    tags = [{**t, "count": counts.get(t["label"], 0)} for t in db["tags"]]
    categories: dict[str, list[str]] = {}
    for t in tags:
        categories.setdefault(t["category"], []).append(t["label"])
    return {"tags": tags, "categories": categories}


@router.post("", status_code=201)
def add_tag(payload: NewTag):
    def _do(db):
        if any(t["label"] == payload.label for t in db["tags"]):
            return {"label": payload.label, "category": payload.category, "added": False}
        db["tags"].append({"label": payload.label, "category": payload.category})
        return {"label": payload.label, "category": payload.category, "added": True}

    return store.mutate(_do)
