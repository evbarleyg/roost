"""LLM-assisted intake (Section 5).

Two steps, both server-side so the Anthropic key never touches the frontend:

1. ``fetch_url`` best-effort fetches a pasted listing URL and strips it to text.
   Many SF rental sites block bots, so this is allowed to fail — the route then
   asks the user to paste the text instead.
2. ``extract`` sends the text to Claude and forces a structured draft via tool-use.
   The draft is *suggestions only*; the human confirms/edits before anything is
   saved. Commute is intentionally left null here — it's computed app-side.

The static instructions + taxonomy are sent as a cached system block so repeated
intakes hit the prompt cache.
"""
from __future__ import annotations

import os
import re
from typing import Optional

import httpx
from bs4 import BeautifulSoup

from .models import DIMENSIONS

# A real browser UA gets us past the most naive bot checks; the polite failure path
# (paste the text) covers everything stricter.
_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
_MAX_TEXT = 12000


class IntakeError(RuntimeError):
    """Raised for user-facing intake failures (e.g. missing API key)."""


def fetch_url(url: str) -> tuple[str, bool]:
    """Return ``(text, ok)``. ``ok`` is False when the page can't be fetched or is
    too thin to be useful, signalling the caller to fall back to manual paste."""
    try:
        resp = httpx.get(
            url,
            headers={"User-Agent": _BROWSER_UA, "Accept": "text/html,application/xhtml+xml"},
            follow_redirects=True,
            timeout=httpx.Timeout(15.0),
        )
        resp.raise_for_status()
    except Exception:
        return "", False

    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "header", "footer", "nav"]):
        tag.decompose()
    text = re.sub(r"\s+", " ", soup.get_text(" ")).strip()
    if len(text) < 200:  # likely a JS shell or a block page
        return text, False
    return text[:_MAX_TEXT], True


def _draft_tool() -> dict:
    """Tool schema mirroring the Section 5 draft shape. tool_choice forces it."""
    return {
        "name": "save_listing_draft",
        "description": "Return the structured draft extracted from the listing.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Short building/listing name"},
                "address": {"type": "string"},
                "neighborhood": {"type": "string"},
                "source": {"type": "string", "description": "Zillow | Zumper | Apartments.com | other"},
                "url": {"type": "string"},
                "rent": {"type": ["number", "null"], "description": "Monthly rent in USD"},
                "sqft": {"type": ["number", "null"]},
                "beds": {"type": ["number", "null"]},
                "baths": {"type": ["number", "null"]},
                "amenities": {
                    "type": "object",
                    "properties": {
                        "in_unit_laundry": {"type": ["boolean", "null"]},
                        "parking": {"type": ["boolean", "null"]},
                        "pet_policy": {"type": ["string", "null"]},
                    },
                    "additionalProperties": True,
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Qualitative tags; prefer the controlled vocabulary, invent only when needed.",
                },
                "suggested_ratings": {
                    "type": "object",
                    "properties": {d: {"type": ["integer", "null"]} for d in DIMENSIONS},
                    "description": "1-5 suggestions. Leave commute null — it is computed app-side.",
                },
                "highlights": {"type": "string", "description": "One or two sentence summary"},
            },
            "required": ["name"],
        },
    }


def _system_block(vocabulary: list[dict]) -> list[dict]:
    by_cat: dict[str, list[str]] = {}
    for t in vocabulary:
        by_cat.setdefault(t["category"], []).append(t["label"])
    vocab_lines = "\n".join(f"- {cat}: {', '.join(labels)}" for cat, labels in by_cat.items())
    text = (
        "You extract structured data from a single residential rental listing for a "
        "personal apartment-scouting app (San Francisco, 2-bed search). Return ONE call "
        "to save_listing_draft. Rules:\n"
        "- Only use facts present in the text; use null when unknown. Never invent rent, "
        "sqft, or addresses.\n"
        "- Ratings are 1-5 SUGGESTIONS a human will confirm. Base them on the listing's "
        "own claims (finishes, light, views, space, building quality, safety cues). Leave "
        "commute null.\n"
        "- For tags, prefer labels from this controlled vocabulary; add a new short tag "
        "only when nothing fits:\n"
        f"{vocab_lines}\n"
    )
    # Cache the static instructions + vocabulary across intake calls.
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


def extract(text: str, url: str, settings: dict, vocabulary: list[dict]) -> dict:
    """Call Claude and return the draft dict. Raises IntakeError on config problems."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise IntakeError("ANTHROPIC_API_KEY is not set on the server.")
    try:
        from anthropic import Anthropic
    except ImportError as exc:  # pragma: no cover
        raise IntakeError("The 'anthropic' package is not installed.") from exc

    client = Anthropic()
    user_content = (f"Listing URL: {url}\n\n" if url else "") + f"Listing text:\n{text.strip()}"
    msg = client.messages.create(
        model=settings.get("extract_model", "claude-sonnet-4-6"),
        max_tokens=1500,
        system=_system_block(vocabulary),
        tools=[_draft_tool()],
        tool_choice={"type": "tool", "name": "save_listing_draft"},
        messages=[{"role": "user", "content": user_content}],
    )
    for block in msg.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "save_listing_draft":
            draft = dict(block.input)
            draft.setdefault("url", url)
            # Guard the app-side-only rule even if the model slips.
            draft.setdefault("suggested_ratings", {})
            draft["suggested_ratings"]["commute"] = None
            return draft
    raise IntakeError("Model did not return a structured draft.")
