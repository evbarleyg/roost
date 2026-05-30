"""Commute endpoint (Section 10: GET /commute?listing_id=...).

Computes minutes to the anchor via the configured directions provider, caches the
result on the listing (and back-fills geocoded lat/lng), and returns it. A bulk
recompute is handy after changing the anchor or provider in Settings.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import commute as commute_svc
from .. import scoring, store

router = APIRouter(prefix="/commute", tags=["commute"])


def _apply(db: dict, listing: dict) -> dict:
    result = commute_svc.compute(listing, db["settings"])
    # Back-fill coordinates discovered during geocoding so the map and future
    # lookups don't have to repeat it.
    lat, lng = result.pop("_lat", None), result.pop("_lng", None)
    if lat is not None and listing.get("lat") is None:
        listing["lat"] = lat
    if lng is not None and listing.get("lng") is None:
        listing["lng"] = lng
    listing["commute"] = result
    listing["updated_at"] = store.now_iso()
    return result


@router.get("")
def get_commute(listing_id: str):
    def _do(db):
        listing = next((l for l in db["listings"] if l["id"] == listing_id), None)
        if not listing:
            raise HTTPException(404, "listing not found")
        result = _apply(db, listing)
        return {"listing_id": listing_id, "commute": result,
                "derived": scoring.enrich(listing, db["settings"])["derived"]}

    return store.mutate(_do)


@router.post("/recompute")
def recompute_all():
    def _do(db):
        updated = 0
        for listing in db["listings"]:
            _apply(db, listing)
            updated += 1
        return {"recomputed": updated}

    return store.mutate(_do)
