"""Scoring math (Section 3).

The frontend re-implements this for instant re-ranking when weights change; this
server copy backs CSV export and any server-side sorting. Keep the two in sync —
both derive ``$/sqft``, the commute rating, and the weighted/combined scores rather
than storing them.
"""
from __future__ import annotations

from typing import Optional

from .models import DIMENSIONS


def commute_minutes(listing: dict) -> Optional[float]:
    """Manual override wins (Section 8 fallback), else the cached directions result."""
    if listing.get("commute_minutes_manual") is not None:
        return listing["commute_minutes_manual"]
    commute = listing.get("commute") or {}
    return commute.get("minutes")


def minutes_to_rating(minutes: Optional[float], bands: list[dict]) -> Optional[int]:
    """Map commute minutes onto a 1-5 rating via the editable bands. Bands are
    evaluated ascending; a band with ``max_minutes is None`` is the catch-all."""
    if minutes is None:
        return None
    ordered = sorted(bands, key=lambda b: (b["max_minutes"] is None, b["max_minutes"] or 0))
    for band in ordered:
        if band["max_minutes"] is None or minutes <= band["max_minutes"]:
            return band["rating"]
    return ordered[-1]["rating"] if ordered else None


def effective_ratings(listing: dict, rater: str, settings: dict) -> dict[str, int]:
    """A rater's ratings with the commute dimension filled in from minutes when the
    human hasn't overridden it. Only dimensions with a numeric value are returned."""
    raw = (listing.get("ratings") or {}).get(rater) or {}
    out: dict[str, int] = {d: v for d, v in raw.items() if isinstance(v, (int, float)) and v is not None}
    if out.get("commute") is None:
        derived = minutes_to_rating(commute_minutes(listing), settings["commute_bands"])
        if derived is not None:
            out["commute"] = derived
    return out


def weighted_score(ratings: dict[str, int], weights: dict[str, float]) -> Optional[float]:
    """Weighted average over the dimensions that have a value, renormalizing the
    weights across only those present so a missing rating doesn't drag the score to
    zero. Returns a 1-5 float, or None if nothing is rated."""
    num = 0.0
    denom = 0.0
    for dim in DIMENSIONS:
        val = ratings.get(dim)
        if val is None:
            continue
        w = weights.get(dim, 0.0)
        num += val * w
        denom += w
    if denom == 0:
        return None
    return round(num / denom, 3)


def rater_score(listing: dict, rater: str, settings: dict) -> Optional[float]:
    return weighted_score(effective_ratings(listing, rater, settings), settings["weights"])


def combined_score(listing: dict, settings: dict) -> Optional[float]:
    """Mean of whichever humans have scored. Used as the default ranking key. Falls
    back to the model's ``auto`` rating when neither human has rated, so scraped-but-
    unrated listings still rank instead of dropping to the bottom. Human ratings
    always win — ``auto`` is consulted only when both humans are silent."""
    scores = [s for r in ("you", "fiance") if (s := rater_score(listing, r, settings)) is not None]
    if scores:
        return round(sum(scores) / len(scores), 3)
    return rater_score(listing, "auto", settings)


def ranked_by(listing: dict) -> str:
    """Who produced the combined score: a human rated it, or the model auto-scored it."""
    human = (listing.get("ratings") or {})
    if any((human.get(r) or {}).get(d) is not None for r in ("you", "fiance") for d in DIMENSIONS):
        return "human"
    if (listing.get("ratings") or {}).get("auto"):
        return "auto"
    return "none"


def dollar_per_sqft(listing: dict) -> Optional[float]:
    rent, sqft = listing.get("rent"), listing.get("sqft")
    if not rent or not sqft:
        return None
    return round(rent / sqft, 2)


def divergence(listing: dict, settings: dict) -> dict:
    """Per-dimension disagreement between the two raters. Flagged when any dimension
    differs by >= the configured threshold (Section 7, default 2)."""
    threshold = settings.get("divergence_threshold", 2)
    you = (listing.get("ratings") or {}).get("you") or {}
    fiance = (listing.get("ratings") or {}).get("fiance") or {}
    rows = []
    worst = 0
    for dim in DIMENSIONS:
        a, b = you.get(dim), fiance.get(dim)
        if a is None or b is None:
            continue
        diff = abs(a - b)
        worst = max(worst, diff)
        rows.append({"dimension": dim, "you": a, "fiance": b, "diff": diff})
    return {"flagged": worst >= threshold, "max_diff": worst, "dimensions": rows}


def enrich(listing: dict, settings: dict) -> dict:
    """Attach all derived fields to a listing for API responses. Stored data is left
    untouched; these live only on the wire."""
    return {
        **listing,
        "derived": {
            "dollar_per_sqft": dollar_per_sqft(listing),
            "commute_minutes": commute_minutes(listing),
            "score_you": rater_score(listing, "you", settings),
            "score_fiance": rater_score(listing, "fiance", settings),
            "score_auto": rater_score(listing, "auto", settings),
            "score_combined": combined_score(listing, settings),
            "ranked_by": ranked_by(listing),
            "divergence": divergence(listing, settings),
        },
    }
