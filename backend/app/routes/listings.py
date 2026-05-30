"""Listing CRUD + filtered/sorted listing feed (Sections 8, 10).

Filtering and sorting are offered server-side for completeness, but the frontend
re-ranks client-side off stored ratings + weights for instant feedback, so this
endpoint is also happy to just return everything enriched.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from .. import scoring, store
from ..models import ListingCreate, ListingUpdate

router = APIRouter(prefix="/listings", tags=["listings"])


def _category_map() -> dict[str, str]:
    return {t["label"]: t["category"] for t in store.list_tags()}


def _register_tags(db: dict, labels: list[str]) -> None:
    """Add any never-seen tag labels to the vocabulary as 'custom' so they become
    filterable facets (Section 4: the vocabulary is data, not code)."""
    known = {t["label"] for t in db["tags"]}
    for label in labels:
        if label and label not in known:
            db["tags"].append({"label": label, "category": "custom"})
            known.add(label)


def _passes(listing: dict, settings: dict, f: dict, cat_map: dict[str, str]) -> bool:
    d = scoring.enrich(listing, settings)["derived"]
    rent = listing.get("rent")
    if f["rent_min"] is not None and (rent is None or rent < f["rent_min"]):
        return False
    if f["rent_max"] is not None and (rent is None or rent > f["rent_max"]):
        return False
    if f["sqft_min"] is not None and (listing.get("sqft") is None or listing["sqft"] < f["sqft_min"]):
        return False
    if f["beds"] is not None and (listing.get("beds") is None or listing["beds"] < f["beds"]):
        return False
    if f["commute_max"] is not None:
        cm = d["commute_minutes"]
        if cm is None or cm > f["commute_max"]:
            return False
    if f["min_score"] is not None and (d["score_combined"] is None or d["score_combined"] < f["min_score"]):
        return False
    if f["neighborhoods"] and listing.get("neighborhood") not in f["neighborhoods"]:
        return False
    if f["status"] and listing.get("status") not in f["status"]:
        return False
    # Must-have quick toggles
    amen = listing.get("amenities") or {}
    if f["in_unit_laundry"] and not amen.get("in_unit_laundry"):
        return False
    if f["parking"] and not amen.get("parking"):
        return False
    if f["pet_friendly"]:
        policy = (amen.get("pet_policy") or "").lower()
        if "no pet" in policy or not policy:
            return False
    # Faceted tags: AND across categories, OR within a category
    if f["tags"]:
        want_by_cat: dict[str, set[str]] = {}
        for label in f["tags"]:
            want_by_cat.setdefault(cat_map.get(label, "custom"), set()).add(label)
        have = set(listing.get("tags") or [])
        for _cat, wanted in want_by_cat.items():
            if not (wanted & have):
                return False
    return True


def _sort_key(listing: dict, settings: dict, sort: str):
    d = scoring.enrich(listing, settings)["derived"]
    return {
        "score": (d["score_combined"] is None, d["score_combined"] or 0),
        "rent": (listing.get("rent") is None, listing.get("rent") or 0),
        "ppsqft": (d["dollar_per_sqft"] is None, d["dollar_per_sqft"] or 0),
        "sqft": (listing.get("sqft") is None, listing.get("sqft") or 0),
        "commute": (d["commute_minutes"] is None, d["commute_minutes"] or 0),
        "recency": (False, listing.get("created_at", "")),
    }.get(sort, (d["score_combined"] is None, d["score_combined"] or 0))


@router.get("")
def get_listings(
    rent_min: Optional[float] = None,
    rent_max: Optional[float] = None,
    sqft_min: Optional[float] = None,
    commute_max: Optional[float] = None,
    beds: Optional[float] = None,
    neighborhoods: Optional[list[str]] = Query(None),
    min_score: Optional[float] = None,
    tags: Optional[list[str]] = Query(None),
    status: Optional[list[str]] = Query(None),
    in_unit_laundry: bool = False,
    parking: bool = False,
    pet_friendly: bool = False,
    sort: str = "score",
    order: str = "desc",
):
    db = store.load()
    settings = db["settings"]
    f = {
        "rent_min": rent_min, "rent_max": rent_max, "sqft_min": sqft_min,
        "commute_max": commute_max, "beds": beds, "neighborhoods": neighborhoods,
        "min_score": min_score, "tags": tags, "status": status,
        "in_unit_laundry": in_unit_laundry, "parking": parking, "pet_friendly": pet_friendly,
    }
    cat_map = {t["label"]: t["category"] for t in db["tags"]}
    rows = [l for l in db["listings"] if _passes(l, settings, f, cat_map)]
    rows.sort(key=lambda l: _sort_key(l, settings, sort), reverse=(order == "desc"))
    return [scoring.enrich(l, settings) for l in rows]


@router.get("/{listing_id}")
def get_listing(listing_id: str):
    db = store.load()
    listing = next((l for l in db["listings"] if l["id"] == listing_id), None)
    if not listing:
        raise HTTPException(404, "listing not found")
    return scoring.enrich(listing, db["settings"])


@router.post("", status_code=201)
def create_listing(payload: ListingCreate):
    def _do(db):
        listing = payload.model_dump()
        listing["id"] = store.new_id()
        listing["commute"] = None
        listing["created_at"] = store.now_iso()
        listing["updated_at"] = listing["created_at"]
        _register_tags(db, listing.get("tags") or [])
        db["listings"].append(listing)
        return scoring.enrich(listing, db["settings"])

    return store.mutate(_do)


@router.patch("/{listing_id}")
def update_listing(listing_id: str, payload: ListingUpdate):
    def _do(db):
        listing = next((l for l in db["listings"] if l["id"] == listing_id), None)
        if not listing:
            raise HTTPException(404, "listing not found")
        changes = payload.model_dump(exclude_unset=True)
        if "tags" in changes:
            _register_tags(db, changes["tags"] or [])
        listing.update(changes)
        listing["updated_at"] = store.now_iso()
        return scoring.enrich(listing, db["settings"])

    return store.mutate(_do)


@router.delete("/{listing_id}", status_code=204)
def delete_listing(listing_id: str):
    def _do(db):
        before = len(db["listings"])
        db["listings"] = [l for l in db["listings"] if l["id"] != listing_id]
        if len(db["listings"]) == before:
            raise HTTPException(404, "listing not found")
        return None

    store.mutate(_do)
    return None
