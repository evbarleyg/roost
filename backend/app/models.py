"""Pydantic models for Roost.

The persistence layer is a flat JSON file (see ``store.py``), so these models are
used mainly for request/response validation and as the canonical shape of the data.
Ratings are embedded per-rater on the listing so the two-rater divergence view
(Section 7 of the design spec) is a pure read off a single object.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

# The six scored dimensions. "commute" is promoted to a scored dimension and is
# normally derived from minutes-to-anchor via the editable bands (see scoring.py).
DIMENSIONS: list[str] = ["safety", "value", "commute", "quality", "views", "space"]

RATERS: list[str] = ["you", "fiance"]

Status = Literal["candidate", "toured", "rejected", "applied"]


class Amenities(BaseModel):
    """Loosely-typed amenity bag. Known booleans get their own quick-toggle in the
    filter rail; anything else is preserved verbatim via ``model_config extra``."""

    model_config = {"extra": "allow"}

    in_unit_laundry: Optional[bool] = None
    in_building_laundry: Optional[bool] = None
    parking: Optional[bool] = None
    ev_charging: Optional[bool] = None
    elevator: Optional[bool] = None
    doorman: Optional[bool] = None
    gym: Optional[bool] = None
    roof_deck: Optional[bool] = None
    balcony: Optional[bool] = None
    storage: Optional[bool] = None
    furnished: Optional[bool] = None
    # Free-text because "cats only" / "dogs ok" / "no pets" all show up in listings.
    pet_policy: Optional[str] = None


class CommuteResult(BaseModel):
    """Cached output of a directions lookup for one listing."""

    minutes: Optional[float] = None
    distance_km: Optional[float] = None
    mode: Optional[str] = None
    provider: Optional[str] = None
    # haversine straight-line distance, always computable, used as a sanity check
    haversine_km: Optional[float] = None
    computed_at: Optional[str] = None
    error: Optional[str] = None


class Listing(BaseModel):
    id: str
    name: str
    address: str = ""
    neighborhood: str = ""
    source: str = ""
    url: str = ""
    rent: Optional[float] = None
    sqft: Optional[float] = None
    beds: Optional[float] = None
    baths: Optional[float] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    amenities: Amenities = Field(default_factory=Amenities)
    highlights: str = ""
    photo_urls: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    notes: str = ""
    status: Status = "candidate"
    # ratings["you"]["views"] -> 1..5 (or null). Missing dimensions => unrated.
    ratings: dict[str, dict[str, Optional[int]]] = Field(default_factory=dict)
    # Manual minutes override (Section 8 fallback). If set, wins over the cache.
    commute_minutes_manual: Optional[float] = None
    commute: Optional[CommuteResult] = None
    created_at: str = ""
    updated_at: str = ""


class ListingCreate(BaseModel):
    """Everything optional except a name, so the intake draft can be saved as-is
    and refined later."""

    name: str
    address: str = ""
    neighborhood: str = ""
    source: str = ""
    url: str = ""
    rent: Optional[float] = None
    sqft: Optional[float] = None
    beds: Optional[float] = None
    baths: Optional[float] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    amenities: Amenities = Field(default_factory=Amenities)
    highlights: str = ""
    photo_urls: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    notes: str = ""
    status: Status = "candidate"
    ratings: dict[str, dict[str, Optional[int]]] = Field(default_factory=dict)
    commute_minutes_manual: Optional[float] = None


class ListingUpdate(BaseModel):
    """All-optional patch. Only provided fields are written."""

    name: Optional[str] = None
    address: Optional[str] = None
    neighborhood: Optional[str] = None
    source: Optional[str] = None
    url: Optional[str] = None
    rent: Optional[float] = None
    sqft: Optional[float] = None
    beds: Optional[float] = None
    baths: Optional[float] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    amenities: Optional[Amenities] = None
    highlights: Optional[str] = None
    photo_urls: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    notes: Optional[str] = None
    status: Optional[Status] = None
    ratings: Optional[dict[str, dict[str, Optional[int]]]] = None
    commute_minutes_manual: Optional[float] = None


class CommuteBand(BaseModel):
    """If minutes <= ``max_minutes`` the commute rating is ``rating``. Bands are
    evaluated in ascending order; the catch-all has ``max_minutes = null``."""

    max_minutes: Optional[float]
    rating: int


class Tag(BaseModel):
    label: str
    category: str


class SavedFilter(BaseModel):
    id: str
    name: str
    query: dict[str, Any] = Field(default_factory=dict)


class Settings(BaseModel):
    # weights sum is normalized at score time, so they need not total exactly 1.0.
    weights: dict[str, float]
    commute_bands: list[CommuteBand]
    anchor_address: str
    anchor_latlng: list[float]  # [lat, lng]
    budget_cap: float
    default_beds: int
    default_neighborhoods: list[str]
    # directions provider config (Section 8). "osrm" needs no key.
    directions_provider: str = "osrm"
    directions_mode: str = "driving"  # transit|walking|driving|cycling (provider-dependent)
    # Claude model used for paste-intake extraction (Section 5).
    extract_model: str = "claude-sonnet-4-6"
    # Flag a divergence when the two raters differ by >= this on any dimension.
    divergence_threshold: int = 2
