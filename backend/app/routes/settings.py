"""Settings: the single source of truth for weights, commute bands, anchor and
defaults (Section 6/10). Updating weights here drives the live re-rank everywhere."""
from __future__ import annotations

from fastapi import APIRouter

from .. import store
from ..models import Settings

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("")
def get_settings():
    return store.get_settings()


@router.put("")
def put_settings(payload: Settings):
    def _do(db):
        db["settings"] = payload.model_dump()
        return db["settings"]

    return store.mutate(_do)
