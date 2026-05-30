"""Seed data: the defaults from Section 2, the tag taxonomy from Section 4, the two
saved filters from Section 8, and the existing candidates from Phase 0.

Kept as plain dicts (not model instances) so this module has no import-time
dependency on the store and can't create a cycle.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _id() -> str:
    return uuid.uuid4().hex[:12]


def default_settings() -> dict:
    return {
        "weights": {
            "safety": 0.20,
            "value": 0.20,
            "commute": 0.15,
            "quality": 0.15,
            "views": 0.15,
            "space": 0.15,
        },
        # Evaluated ascending; first band whose max_minutes >= minutes wins.
        "commute_bands": [
            {"max_minutes": 15, "rating": 5},
            {"max_minutes": 20, "rating": 4},
            {"max_minutes": 30, "rating": 3},
            {"max_minutes": 40, "rating": 2},
            {"max_minutes": None, "rating": 1},
        ],
        "anchor_address": "Anthropic, 500 Howard St, San Francisco, CA 94105",
        "anchor_latlng": [37.7879, -122.3972],
        "budget_cap": 6000,
        "default_beds": 2,
        "default_neighborhoods": [
            "Pacific Heights",
            "North Beach",
            "Nob Hill",
            "Polk Gulch",
            "Russian Hill",
        ],
        "directions_provider": "osrm",
        "directions_mode": "driving",
        "extract_model": "claude-sonnet-4-6",
        "divergence_threshold": 2,
    }


def default_taxonomy() -> list[dict]:
    """Controlled vocabulary grouped by category. The three spec examples
    (modern luxury finishes / high-rise+split townhome / city view / bright) are
    all present. New free-form tags users type get appended at runtime."""
    groups: dict[str, list[str]] = {
        "finish": [
            "modern luxury finishes",
            "renovated",
            "designer/high-end",
            "standard",
            "dated",
            "original/period details",
        ],
        "building": [
            "high-rise",
            "mid-rise",
            "low-rise walk-up",
            "Victorian/Edwardian flat",
            "split townhome / two-level",
            "loft",
            "garden/in-law unit",
        ],
        "views": [
            "city/skyline view",
            "bay/water view",
            "bridge view",
            "park view",
            "courtyard/interior",
            "no view",
            "top-floor",
        ],
        "light": [
            "bright / abundant natural light",
            "sun-drenched",
            "multiple exposures",
            "corner unit",
            "dim / north-facing",
        ],
        "layout": [
            "open-plan",
            "split bedrooms (privacy)",
            "separate dining",
            "home office/den",
            "large kitchen",
        ],
        "amenities": [
            "in-unit laundry",
            "in-building laundry",
            "garage parking",
            "EV charging",
            "pet-friendly (cats/dogs)",
            "elevator",
            "doorman/secured",
            "shared roof deck",
            "gym",
            "balcony",
            "private patio/yard",
            "furnished",
            "storage",
        ],
    }
    return [{"label": label, "category": cat} for cat, labels in groups.items() for label in labels]


def default_saved_filters() -> list[dict]:
    return [
        {
            "id": _id(),
            "name": "Fiancé's picks",
            "query": {
                "neighborhoods": [
                    "Pacific Heights",
                    "North Beach",
                    "Nob Hill",
                    "Polk Gulch",
                    "Russian Hill",
                ]
            },
        },
        {
            "id": _id(),
            "name": "Under $5k + bright + view",
            "query": {
                "rent_max": 5000,
                "tags": [
                    "bright / abundant natural light",
                    "city/skyline view",
                    "bay/water view",
                ],
            },
        },
    ]


def _listing(**kw) -> dict:
    """Build a listing dict with all fields defaulted, then overlay kw."""
    base = {
        "id": _id(),
        "name": "",
        "address": "",
        "neighborhood": "",
        "source": "",
        "url": "",
        "rent": None,
        "sqft": None,
        "beds": 2,
        "baths": None,
        "lat": None,
        "lng": None,
        "amenities": {},
        "highlights": "",
        "photo_urls": [],
        "tags": [],
        "notes": "",
        "status": "candidate",
        "ratings": {},
        "commute_minutes_manual": None,
        "commute": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    base.update(kw)
    return base


def default_listings() -> list[dict]:
    """The existing candidates so there's data on day one (Phase 0). 923 Folsom is
    fully populated from the spec example; the other three are light stubs flagged
    in ``highlights`` for you to edit. lat/lng are approximate SoMa coordinates so
    the map renders immediately."""
    return [
        _listing(
            name="923 Folsom",
            address="923 Folsom St, San Francisco, CA",
            neighborhood="SoMa",
            source="Zillow",
            url="",
            rent=5400,
            sqft=984,
            beds=2,
            baths=2,
            lat=37.7786,
            lng=-122.4057,
            amenities={"in_unit_laundry": True, "parking": False, "pet_policy": "cats only"},
            highlights="Spacious 2BR, strong reviews, floor-to-ceiling windows",
            tags=[
                "modern luxury finishes",
                "high-rise",
                "city/skyline view",
                "bright / abundant natural light",
            ],
            ratings={"you": {"safety": 4, "value": 3, "quality": 5, "views": 5, "space": 4}},
        ),
        _listing(
            name="Soma at 788",
            address="788 Minna St, San Francisco, CA",
            neighborhood="SoMa",
            source="Apartments.com",
            rent=5200,
            sqft=900,
            baths=2,
            lat=37.7779,
            lng=-122.4090,
            tags=["high-rise", "city/skyline view"],
            highlights="Seed stub — edit me.",
        ),
        _listing(
            name="Mosso",
            address="900 Folsom St, San Francisco, CA",
            neighborhood="SoMa",
            source="Zumper",
            rent=5500,
            sqft=1000,
            baths=2,
            lat=37.7800,
            lng=-122.4030,
            tags=["high-rise", "modern luxury finishes"],
            highlights="Seed stub — edit me.",
        ),
        _listing(
            name="The Lofts",
            address="San Francisco, CA",
            neighborhood="SoMa",
            source="Zillow",
            rent=4800,
            sqft=1100,
            baths=2,
            lat=37.7822,
            lng=-122.4012,
            tags=["loft", "high-rise"],
            highlights="Seed stub — edit me.",
        ),
    ]
