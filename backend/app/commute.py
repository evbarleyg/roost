"""Commute computation (Section 8).

A pluggable directions client. The default provider is OSRM's public server, which
needs no API key but only really does driving — good enough for a relative ranking
and as the no-friction default. Set ``directions_provider`` to ``google``/``mapbox``/
``ors`` (with the matching key in the environment) for true transit/walking. Results
are cached on the listing; haversine straight-line distance is always attached as a
sanity check and as the fallback when a lookup fails.
"""
from __future__ import annotations

import math
import os
from datetime import datetime, timezone
from typing import Optional

import httpx

_UA = "Roost/1.0 (personal apartment-scouting app)"
_TIMEOUT = httpx.Timeout(12.0)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return round(2 * r * math.asin(math.sqrt(a)), 3)


def geocode(address: str) -> Optional[tuple[float, float]]:
    """Address -> (lat, lng) via OpenStreetMap Nominatim (no key). Best-effort."""
    if not address.strip():
        return None
    try:
        resp = httpx.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": address, "format": "json", "limit": 1},
            headers={"User-Agent": _UA},
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        if data:
            return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception:
        return None
    return None


# --- providers: each returns (minutes, distance_km) or raises ---------------

def _osrm(lat1, lng1, lat2, lng2, mode) -> tuple[float, float]:
    # Public OSRM server only serves the car profile; transit/walking fall back to it.
    url = f"https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}"
    resp = httpx.get(url, params={"overview": "false"}, headers={"User-Agent": _UA}, timeout=_TIMEOUT)
    resp.raise_for_status()
    route = resp.json()["routes"][0]
    return route["duration"] / 60.0, route["distance"] / 1000.0


def _google(lat1, lng1, lat2, lng2, mode) -> tuple[float, float]:
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key:
        raise RuntimeError("GOOGLE_MAPS_API_KEY not set")
    resp = httpx.get(
        "https://maps.googleapis.com/maps/api/directions/json",
        params={"origin": f"{lat1},{lng1}", "destination": f"{lat2},{lng2}", "mode": mode, "key": key},
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    leg = resp.json()["routes"][0]["legs"][0]
    return leg["duration"]["value"] / 60.0, leg["distance"]["value"] / 1000.0


def _mapbox(lat1, lng1, lat2, lng2, mode) -> tuple[float, float]:
    token = os.environ.get("MAPBOX_TOKEN")
    if not token:
        raise RuntimeError("MAPBOX_TOKEN not set")
    profile = {"transit": "driving", "walking": "walking", "driving": "driving", "cycling": "cycling"}.get(mode, "driving")
    url = f"https://api.mapbox.com/directions/v5/mapbox/{profile}/{lng1},{lat1};{lng2},{lat2}"
    resp = httpx.get(url, params={"access_token": token, "overview": "false"}, timeout=_TIMEOUT)
    resp.raise_for_status()
    route = resp.json()["routes"][0]
    return route["duration"] / 60.0, route["distance"] / 1000.0


def _ors(lat1, lng1, lat2, lng2, mode) -> tuple[float, float]:
    key = os.environ.get("ORS_API_KEY")
    if not key:
        raise RuntimeError("ORS_API_KEY not set")
    profile = {"walking": "foot-walking", "cycling": "cycling-regular", "driving": "driving-car", "transit": "driving-car"}.get(mode, "driving-car")
    resp = httpx.post(
        f"https://api.openrouteservice.org/v2/directions/{profile}",
        json={"coordinates": [[lng1, lat1], [lng2, lat2]]},
        headers={"Authorization": key, "User-Agent": _UA},
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    summary = resp.json()["routes"][0]["summary"]
    return summary["duration"] / 60.0, summary["distance"] / 1000.0


_PROVIDERS = {"osrm": _osrm, "google": _google, "mapbox": _mapbox, "ors": _ors}


def compute(listing: dict, settings: dict) -> dict:
    """Return a CommuteResult-shaped dict for one listing. Geocodes the address if
    the listing has no coordinates yet. Never raises — failures land in ``error``
    with the haversine distance still populated."""
    anchor = settings["anchor_latlng"]
    provider_name = settings.get("directions_provider", "osrm")
    mode = settings.get("directions_mode", "driving")

    lat, lng = listing.get("lat"), listing.get("lng")
    if lat is None or lng is None:
        coords = geocode(listing.get("address") or listing.get("name", ""))
        if coords:
            lat, lng = coords
    if lat is None or lng is None:
        return {"minutes": None, "distance_km": None, "mode": mode, "provider": provider_name,
                "haversine_km": None, "computed_at": _now(), "error": "no coordinates (geocode failed)"}

    hav = haversine_km(lat, lng, anchor[0], anchor[1])
    provider = _PROVIDERS.get(provider_name, _osrm)
    try:
        minutes, dist = provider(lat, lng, anchor[0], anchor[1], mode)
        return {"minutes": round(minutes, 1), "distance_km": round(dist, 2), "mode": mode,
                "provider": provider_name, "haversine_km": hav, "computed_at": _now(), "error": None,
                "_lat": lat, "_lng": lng}
    except Exception as exc:  # noqa: BLE001 - report, don't crash the request
        return {"minutes": None, "distance_km": None, "mode": mode, "provider": provider_name,
                "haversine_km": hav, "computed_at": _now(), "error": f"{type(exc).__name__}: {exc}",
                "_lat": lat, "_lng": lng}
