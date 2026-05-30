"""Saved filter presets (Section 8/10). Seeded with "Fiancé's picks" and
"Under $5k + bright + view"."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import store

router = APIRouter(prefix="/saved-filters", tags=["saved-filters"])


class SavedFilterIn(BaseModel):
    name: str
    query: dict[str, Any] = Field(default_factory=dict)


@router.get("")
def list_saved_filters():
    return store.list_saved_filters()


@router.post("", status_code=201)
def create_saved_filter(payload: SavedFilterIn):
    def _do(db):
        sf = {"id": store.new_id(), "name": payload.name, "query": payload.query}
        db["saved_filters"].append(sf)
        return sf

    return store.mutate(_do)


@router.put("/{filter_id}")
def update_saved_filter(filter_id: str, payload: SavedFilterIn):
    def _do(db):
        sf = next((s for s in db["saved_filters"] if s["id"] == filter_id), None)
        if not sf:
            raise HTTPException(404, "saved filter not found")
        sf["name"] = payload.name
        sf["query"] = payload.query
        return sf

    return store.mutate(_do)


@router.delete("/{filter_id}", status_code=204)
def delete_saved_filter(filter_id: str):
    def _do(db):
        before = len(db["saved_filters"])
        db["saved_filters"] = [s for s in db["saved_filters"] if s["id"] != filter_id]
        if len(db["saved_filters"]) == before:
            raise HTTPException(404, "saved filter not found")
        return None

    store.mutate(_do)
    return None
