"""CSV export (Phase 4) so the app round-trips with the original spreadsheet."""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from .. import scoring, store
from ..models import DIMENSIONS

router = APIRouter(tags=["export"])

_COLUMNS = [
    "name", "address", "neighborhood", "source", "url", "rent", "sqft",
    "dollar_per_sqft", "beds", "baths", "commute_minutes",
    "score_you", "score_fiance", "score_combined", "divergence", "status", "tags",
]


@router.get("/export.csv")
def export_csv():
    db = store.load()
    settings = db["settings"]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_COLUMNS + [f"you_{d}" for d in DIMENSIONS] + [f"fiance_{d}" for d in DIMENSIONS])
    for listing in db["listings"]:
        d = scoring.enrich(listing, settings)["derived"]
        you = (listing.get("ratings") or {}).get("you") or {}
        fiance = (listing.get("ratings") or {}).get("fiance") or {}
        writer.writerow([
            listing.get("name", ""), listing.get("address", ""), listing.get("neighborhood", ""),
            listing.get("source", ""), listing.get("url", ""), listing.get("rent", ""),
            listing.get("sqft", ""), d["dollar_per_sqft"], listing.get("beds", ""),
            listing.get("baths", ""), d["commute_minutes"], d["score_you"], d["score_fiance"],
            d["score_combined"], "yes" if d["divergence"]["flagged"] else "", listing.get("status", ""),
            "; ".join(listing.get("tags") or []),
        ] + [you.get(dim, "") for dim in DIMENSIONS] + [fiance.get(dim, "") for dim in DIMENSIONS])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=roost.csv"},
    )
