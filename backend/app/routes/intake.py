"""LLM intake endpoint (Section 10: POST /listings/extract).

Returns a draft only — never writes to the DB. The frontend shows the draft in the
intake drawer for accept/edit before a separate POST /listings actually saves it.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, model_validator

from .. import intake, store

router = APIRouter(prefix="/listings", tags=["intake"])


class ExtractIn(BaseModel):
    url: Optional[str] = None
    text: Optional[str] = None

    @model_validator(mode="after")
    def _need_one(self):
        if not (self.url or self.text):
            raise ValueError("provide a url or text")
        return self


@router.post("/extract")
def extract_listing(payload: ExtractIn):
    text = (payload.text or "").strip()
    url = (payload.url or "").strip()

    # Auto-fetch the URL when no text was pasted; fall back to manual paste on failure.
    if not text and url:
        fetched, ok = intake.fetch_url(url)
        if not ok:
            return {
                "needs_paste": True,
                "url": url,
                "message": "Couldn't fetch that URL (the site likely blocks bots). "
                           "Paste the listing text instead.",
            }
        text = fetched

    if not text:
        raise HTTPException(400, "no listing text to extract from")

    db = store.load()
    try:
        draft = intake.extract(text, url, db["settings"], db["tags"])
    except intake.IntakeError as exc:
        raise HTTPException(400, str(exc))
    return {"needs_paste": False, "draft": draft}
