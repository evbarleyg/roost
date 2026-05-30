"""Hybrid auto-scorer for scraped listings (run under a Claude subscription, no API).

Fills ``listing.ratings["auto"]`` with 1-5 scores so the rank table isn't empty for
listings no human has rated yet. Human ratings ("you"/"fiance") are never touched;
``scoring.py`` uses "auto" only as a fallback when no human has scored a listing.

Method (see HANDOFF.md): a hybrid of math + encoded judgment.
  - value, space : computed from rent/sqft/beds, ranked into quintiles *within this
                   dataset* so scores are relative to what's actually on the market.
  - safety, views: a per-neighborhood table (the "judgment", encoded once below);
                   views also gets a bump when the listing text advertises a view.
  - quality      : amenity flags + finish keywords in the highlights, minus SRO /
                   shared-bath / efficiency penalties.
  - commute      : intentionally omitted; the app derives it from minutes.

Re-run any time after scraping more listings:
    python backend/scripts/autoscore.py            # scores listings missing ratings.auto
    python backend/scripts/autoscore.py --all      # re-score every listing
    python backend/scripts/autoscore.py --dry-run  # print summary, write nothing
It always writes a timestamped backup of db.json first.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
from bisect import bisect_left
from datetime import datetime, timezone
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "data" / "db.json"

# --- judgment, encoded: per-neighborhood (safety, view-baseline) on a 1-5 scale ---
# Ordered, first matching substring wins, so specific areas precede generic ones.
# safety: 5 = lowest concern. view: typical view potential before listing-text bumps.
NEIGHBORHOOD_RULES: list[tuple[str, int, int]] = [
    ("telegraph", 4, 4),
    ("north beach", 4, 4),
    ("north waterfront", 4, 5),
    ("russian hill", 5, 5),
    ("nob hill", 4, 4),
    ("lower nob", 3, 3),
    ("twin peaks", 5, 5),
    ("diamond", 5, 5),
    ("pac hts", 4, 4),
    ("pacific heights", 5, 5),
    ("pac heights", 4, 4),
    ("presidio heights", 5, 4),
    ("laurel", 5, 4),
    ("presidio", 5, 4),
    ("marina", 5, 4),
    ("cow hollow", 5, 4),
    ("noe valley", 5, 4),
    ("dolores", 4, 4),
    ("bernal", 4, 4),
    ("potrero", 4, 4),
    ("glen park", 5, 3),
    ("west portal", 5, 4),
    ("forest hill", 5, 4),
    ("miraloma", 5, 4),
    ("seacliff", 5, 4),
    ("richmond", 4, 3),
    ("inner sunset", 4, 3),
    ("ucsf", 4, 3),
    ("sunset", 4, 3),
    ("parkside", 4, 3),
    ("hayes valley", 4, 3),
    ("alamo", 4, 3),
    ("nopa", 4, 3),
    ("panhandle", 4, 3),
    ("usf", 4, 3),
    ("haight", 4, 3),
    ("cole valley", 4, 3),
    ("ashbury", 4, 3),
    ("buena vista", 4, 4),
    ("castro", 4, 3),
    ("upper market", 4, 3),
    ("eureka", 4, 3),
    ("duboce", 4, 3),
    ("financial district", 3, 4),
    ("south beach", 4, 4),
    ("mission bay", 3, 3),
    ("dogpatch", 3, 3),
    ("soma", 2, 3),
    ("mission district", 3, 3),
    ("western addition", 3, 3),
    ("polk", 3, 3),
    ("ingleside", 3, 2),
    ("sfsu", 3, 2),
    ("ccsf", 3, 2),
    ("excelsior", 3, 2),
    ("outer mission", 3, 2),
    ("portola", 3, 2),
    ("crocker", 3, 2),
    ("shipyard", 3, 3),
    ("bayview", 2, 2),
    ("visitacion", 2, 2),
    ("tenderloin", 1, 2),
    ("mid-market", 1, 2),
    ("civic", 2, 3),
    ("van ness", 2, 3),
    ("downtown", 2, 3),
]
DEFAULT_NB = (3, 3)  # generic "san francisco" / unrecognized

VIEW_KEYWORDS = [
    "view", "skyline", "panoram", "ocean", "overlooking", "bridge",
    "golden gate", "vista", "penthouse", "top floor", "top-floor",
    "floor-to-ceiling", "floor to ceiling", "rooftop", "roof deck", "roof-deck",
]
QUALITY_POS = [
    "renovated", "remodel", "updated", "upgraded", "modern", "luxur", "stainless",
    "granite", "quartz", "hardwood", "designer", "high-end", "high end", "marble",
    "custom", "chef", "gourmet", "brand new", "newly", "new construction",
    "concierge", "doorman", "spa",
]
QUALITY_NEG = [
    "sro", "single room occupancy", "shared bath", "shared kitchen", "efficiency",
    "residential hotel", "hostel", "micro studio", "micro-studio", "room in ",
]
AMENITY_BUMP = {
    "in_unit_laundry": 0.6, "parking": 0.3, "gym": 0.3, "elevator": 0.2,
    "doorman": 0.4, "roof_deck": 0.3, "balcony": 0.3, "ev_charging": 0.2,
    "storage": 0.1,
}


def neighborhood_scores(raw: str) -> tuple[int, int]:
    n = (raw or "").strip().lower()
    for kw, safety, view in NEIGHBORHOOD_RULES:
        if kw in n:
            return safety, view
    return DEFAULT_NB


def valid_beds(b) -> int | None:
    if not isinstance(b, (int, float)):
        return None
    b = int(b)
    return b if 0 <= b <= 8 else None


def bed_bucket(b: int | None) -> str:
    if b is None:
        return "unknown"
    if b == 0:
        return "studio"
    if b >= 3:
        return "3plus"
    return str(b)


def quintile(thresholds: list[float], value: float) -> int:
    """Map value to 1..5 using the 20/40/60/80-percentile thresholds (ascending)."""
    return min(5, bisect_left(thresholds, value) + 1)


def percentile_thresholds(values: list[float]) -> list[float]:
    s = sorted(values)
    if not s:
        return [0, 0, 0, 0]
    return [s[int(len(s) * q)] if int(len(s) * q) < len(s) else s[-1] for q in (0.2, 0.4, 0.6, 0.8)]


def clamp_round(x: float) -> int:
    return max(1, min(5, round(x)))


def score(listings: list[dict]) -> dict[str, dict]:
    """Return id -> auto ratings dict. Pure; the caller decides what to write."""
    # --- precompute dataset-relative bands for value & space ---
    ppsf = [(l["id"], l["rent"] / l["sqft"]) for l in listings if l.get("rent") and l.get("sqft")]
    ppsf_thr = percentile_thresholds([v for _, v in ppsf])

    sqft_vals = [l["sqft"] for l in listings if l.get("sqft")]
    sqft_thr = percentile_thresholds(sqft_vals)

    # rent within bed bucket, for the value fallback when sqft is missing
    rent_by_bucket: dict[str, list[float]] = {}
    for l in listings:
        if l.get("rent") and not l.get("sqft"):
            rent_by_bucket.setdefault(bed_bucket(valid_beds(l.get("beds"))), []).append(l["rent"])
    bucket_thr = {k: percentile_thresholds(v) for k, v in rent_by_bucket.items()}
    all_rent_thr = percentile_thresholds([l["rent"] for l in listings if l.get("rent")])

    out: dict[str, dict] = {}
    for l in listings:
        text = f"{l.get('name', '')} {l.get('highlights', '')}".lower()
        amen = l.get("amenities") or {}
        rent, sqft = l.get("rent"), l.get("sqft")
        beds = valid_beds(l.get("beds"))

        safety, view_base = neighborhood_scores(l.get("neighborhood", ""))

        # value: cheaper-for-what-you-get ranks higher (invert the quintile)
        if rent and sqft:
            value = 6 - quintile(ppsf_thr, rent / sqft)
        elif rent:
            thr = bucket_thr.get(bed_bucket(beds)) or all_rent_thr
            value = 6 - quintile(thr, rent)
        else:
            value = 3

        # space: bigger ranks higher
        if sqft:
            space = quintile(sqft_thr, sqft)
        elif beds is not None:
            space = {0: 2, 1: 3, 2: 4}.get(beds, 5)
        else:
            space = 3

        # quality: amenity flags + finish keywords, minus SRO/shared/efficiency
        q = 3.0
        for key, bump in AMENITY_BUMP.items():
            if amen.get(key):
                q += bump
        q += 0.4 * sum(1 for kw in QUALITY_POS if kw in text)
        q -= 1.2 * sum(1 for kw in QUALITY_NEG if kw in text)

        # views: neighborhood baseline + a bump if the text advertises a view
        view = view_base + min(2, sum(1 for kw in VIEW_KEYWORDS if kw in text))

        out[l["id"]] = {
            "safety": clamp_round(safety),
            "value": clamp_round(value),
            "quality": clamp_round(q),
            "views": clamp_round(view),
            "space": clamp_round(space),
            # commute deliberately omitted -> app derives it from minutes
        }
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--all", action="store_true", help="re-score every listing, not just unscored ones")
    ap.add_argument("--dry-run", action="store_true", help="print a summary and write nothing")
    args = ap.parse_args()

    db = json.loads(DB.read_text())
    listings = db["listings"]
    auto = score(listings)

    written = 0
    for l in listings:
        existing = (l.get("ratings") or {}).get("auto")
        if existing and not args.all:
            continue
        l.setdefault("ratings", {})["auto"] = auto[l["id"]]
        l["auto_scored"] = True
        written += 1

    # distribution summary so the result is auditable at a glance
    from collections import Counter
    dist = {dim: Counter() for dim in ("safety", "value", "quality", "views", "space")}
    for r in auto.values():
        for dim, v in r.items():
            dist[dim][v] += 1
    print(f"scored {len(auto)} listings; {written} written ({'all' if args.all else 'unscored only'})")
    for dim, c in dist.items():
        print(f"  {dim:8s} " + "  ".join(f"{k}:{c.get(k, 0):4d}" for k in range(1, 6)))

    if args.dry_run:
        print("dry-run: db.json not modified")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = DB.with_name(f"db.backup.autoscore-{stamp}.json")
    shutil.copy(DB, backup)
    DB.write_text(json.dumps(db, indent=2, ensure_ascii=False))
    print(f"wrote {DB}  (backup: {backup.name})")


if __name__ == "__main__":
    main()
