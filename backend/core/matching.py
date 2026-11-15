"""Read the floor plan and match each photo to a room, using a vision model.

One request: the plan plus a thumbnail of every photo. The model answers in structured JSON (a tool
call for Claude, a response schema for Gemini) that we validate rather than free text.

Which model: GEMINI_API_KEY set -> Gemini; else ANTHROPIC_API_KEY -> Claude.
Force one with MATCH_PROVIDER=gemini|claude.
"""

from __future__ import annotations

import base64
import copy
import json
import logging
import os
import time
import re
from typing import Any

log = logging.getLogger(__name__)

# Override with ANTHROPIC_MODEL / GEMINI_MODEL if you want a different model.
DEFAULT_MODEL = "claude-sonnet-5-5"
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"  # fast; gemini-3.8-flash timed out even on "hi" for free keys

TOOL = {
    "name": "report_layout",
    "description": "Report the rooms on the floor plan and which room each photo shows.",
    "input_schema": {
        "type": "object",
        "properties": {
            "plan": {
                "type": "object",
                "properties": {
                    "width_m": {"type": "number", "description": "Overall width of the plan in metres"},
                    "depth_m": {"type": "number", "description": "Overall depth (top to bottom) in metres"},
                    "rooms": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "As labelled, e.g. 'Bedroom 2'. Unique."},
                                "x_m": {"type": "number", "description": "Left edge, metres from the plan's left"},
                                "y_m": {"type": "number", "description": "Top edge, metres from the plan's top"},
                                "width_m": {"type": "number"},
                                "depth_m": {"type": "number"},
                            },
                            "required": ["name", "x_m", "y_m", "width_m", "depth_m"],
                        },
                    },
                },
                "required": ["width_m", "depth_m", "rooms"],
            },
            "photos": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "photo_index": {"type": "integer"},
                        "room_name": {
                            "type": ["string", "null"],
                            "description": "Best guess, exactly as in plan.rooms; null if not a room in this property",
                        },
                        "confident": {"type": "boolean"},
                        "candidate_rooms": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "If not confident: the rooms it could be, most likely first",
                        },
                        "reason": {
                            "type": "string",
                            "description": "If not confident: one short, plain sentence for the user",
                        },
                    },
                    "required": ["photo_index", "room_name", "confident"],
                },
            },
        },
        "required": ["plan", "photos"],
    },
}

INSTRUCTIONS = """You are helping turn a property's floor plan and room photos into a 3D model.

1. Read the floor plan. List every labelled room (include hallways and landings if labelled) as an
   axis-aligned rectangle in metres: x from the plan's left edge, y from its top edge.
   Use the dimensions written on the plan. If there are none, estimate from typical sizes (a door is
   about 0.8 m wide). Approximate an L-shaped or irregular room with its bounding rectangle.
   If the plan shows several floors, place them side by side, left to right, without overlapping.
   Give rooms with the same type distinct names as labelled (e.g. "Bedroom 1", "Bedroom 2").

2. For each photo, decide which room it shows. Set confident to true only when the photo clearly
   identifies one room. If it could be one of several (e.g. two similar bedrooms), set confident to
   false, list the candidates most likely first, and give a short reason a non-expert would understand,
   e.g. "It looks like a bedroom, but it could be either one."
   If a photo isn't of a room in this property (outside, a garden, a street), set room_name to null.

Report everything with the report_layout tool. Every photo index must appear exactly once."""

INSTRUCTIONS_JSON = INSTRUCTIONS.replace(
    "Report everything with the report_layout tool.",
    "Reply only with JSON matching the given schema. Use an empty string for room_name when a photo "
    "isn't of a room in this property.",
)


def _slug(name: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "room"
    slug, n = base, 2
    while slug in taken:
        slug, n = f"{base}-{n}", n + 1
    taken.add(slug)
    return slug


def normalize(raw: dict[str, Any], photo_ids: list[str]) -> dict[str, Any]:
    """Turn the model's tool input into the API's {plan, matches} shape, fixing what we can."""
    plan_in = raw.get("plan") or {}
    rooms: list[dict[str, Any]] = []
    by_name: dict[str, str] = {}
    taken: set[str] = set()
    for r in plan_in.get("rooms") or []:
        try:
            w, d = float(r["width_m"]), float(r["depth_m"])
            x, y = max(0.0, float(r["x_m"])), max(0.0, float(r["y_m"]))
        except (KeyError, TypeError, ValueError):
            continue
        if w <= 0.3 or d <= 0.3:
            continue
        name = str(r.get("name") or "Room").strip()
        rid = _slug(name, taken)
        if name.lower() in by_name:  # duplicate label: keep the room, give it a distinct name
            name = f"{name} ({rid.rsplit('-', 1)[-1]})"
        by_name.setdefault(name.lower(), rid)
        rooms.append({"id": rid, "name": name, "x": round(x, 3), "y": round(y, 3), "width": round(w, 3), "depth": round(d, 3)})
    if not rooms:
        raise ValueError("Couldn't find any rooms on the floor plan. Is it a clear, labelled plan?")

    width = max(float(plan_in.get("width_m") or 0), max(r["x"] + r["width"] for r in rooms))
    depth = max(float(plan_in.get("depth_m") or 0), max(r["y"] + r["depth"] for r in rooms))
    plan = {"width": round(width, 3), "depth": round(depth, 3), "rooms": rooms}

    def rid(name: Any) -> str | None:
        return by_name.get(str(name).strip().lower()) if name else None

    seen: dict[int, dict[str, Any]] = {}
    for p in raw.get("photos") or []:
        try:
            i = int(p["photo_index"])
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= i < len(photo_ids) and i not in seen:
            seen[i] = p

    matches = []
    for i, photo_id in enumerate(photo_ids):
        p = seen.get(i, {})
        room = rid(p.get("room_name"))
        candidates = [c for c in (rid(n) for n in p.get("candidate_rooms") or []) if c]
        confident = bool(p.get("confident")) and room is not None
        m: dict[str, Any] = {"photoId": photo_id, "roomId": room, "confident": confident}
        if not confident:
            if room and room not in candidates:
                candidates.insert(0, room)
            if candidates:
                m["candidates"] = list(dict.fromkeys(candidates))
            m["reason"] = (p.get("reason") or "").strip() or (
                "This doesn't look like a room in this property." if p and not p.get("room_name")
                else "We couldn't tell which room this is."
            )
        matches.append(m)
    return {"plan": plan, "matches": matches}


def provider() -> str | None:
    """'gemini', 'claude', or None when no key is set."""
    forced = os.environ.get("MATCH_PROVIDER", "").strip().lower()
    if forced in ("gemini", "claude"):
        return forced
    if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        return "gemini"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "claude"
    return None


def match_photos(plan_bytes: bytes, plan_mime: str, photos: list[tuple[str, bytes]]) -> dict[str, Any]:
    """photos: [(photoId, jpeg thumbnail bytes)] → {"plan": ..., "matches": [...]}"""
    which = provider()
    if which == "gemini":
        return match_photos_gemini(plan_bytes, plan_mime, photos)
    if which == "claude":
        return match_photos_claude(plan_bytes, plan_mime, photos)
    raise RuntimeError("No vision model configured: set GEMINI_API_KEY or ANTHROPIC_API_KEY.")


def _gemini_schema() -> dict[str, Any]:
    """The tool's JSON schema, with room_name as a plain string ('' = not a room here)."""
    schema = copy.deepcopy(TOOL["input_schema"])
    room_name = schema["properties"]["photos"]["items"]["properties"]["room_name"]
    room_name["type"] = "string"
    room_name["description"] = "Best guess, exactly as in plan.rooms; empty string if not a room in this property"
    return schema


def match_photos_gemini(plan_bytes: bytes, plan_mime: str, photos: list[tuple[str, bytes]], client: Any = None) -> dict[str, Any]:
    from google import genai
    from google.genai import types

    # Give up after 140 s (Modal web requests are cut at 150 s) and don't retry: the library's default
    # retries quietly with long back-offs, which looked like a 4-minute hang.
    client = client or genai.Client(  # reads GEMINI_API_KEY (or GOOGLE_API_KEY)
        http_options=types.HttpOptions(timeout=140_000, retry_options=types.HttpRetryOptions(attempts=1)),
    )

    def build_parts(per_part_resolution: bool) -> list[Any]:
        # The plan needs detail (small dimension labels); the photos only need "which room is this",
        # so they go at low resolution, which makes the request several times faster.
        res = (lambda level: {"media_resolution": {"level": level}}) if per_part_resolution else (lambda level: {})
        out: list[Any] = [types.Part.from_text(text="Floor plan:"),
                          types.Part.from_bytes(data=plan_bytes, mime_type=plan_mime, **res("MEDIA_RESOLUTION_HIGH"))]
        for i, (_, data) in enumerate(photos):
            out.append(types.Part.from_text(text=f"Photo {i}:"))
            out.append(types.Part.from_bytes(data=data, mime_type="image/jpeg", **res("MEDIA_RESOLUTION_LOW")))
        out.append(types.Part.from_text(text=INSTRUCTIONS_JSON))
        return out

    def config(per_part_resolution: bool, thinking: bool = True) -> Any:
        return types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=_gemini_schema(),
            temperature=0,
            max_output_tokens=16000,
            # Reading a plan and sorting photos doesn't need deep reasoning.
            thinking_config=types.ThinkingConfig(thinking_level=os.environ.get("GEMINI_THINKING", "LOW").upper()) if thinking else None,
            # Fallback when the API won't take per-image resolution: everything at medium.
            media_resolution=None if per_part_resolution else "MEDIA_RESOLUTION_MEDIUM",
        )

    def call(per_part_resolution: bool) -> Any:
        try:
            return client.models.generate_content(
                model=os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
                contents=build_parts(per_part_resolution),
                config=config(per_part_resolution),
            )
        except Exception as e:  # a model that doesn't take this thinking level: use its default instead
            if "400" in str(e) and "thinking" in str(e).lower():
                return client.models.generate_content(
                    model=os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
                    contents=build_parts(per_part_resolution),
                    config=config(per_part_resolution, thinking=False),
                )
            raise

    started = time.monotonic()
    try:
        try:
            response = call(per_part_resolution=True)
        except Exception as e:  # older API versions reject per-image resolution with a 400
            if "400" in str(e) and "resolution" in str(e).lower():
                response = call(per_part_resolution=False)
            else:
                raise
    except Exception as e:
        text = f"{type(e).__name__}: {e}"
        if "429" in text or "RESOURCE_EXHAUSTED" in text:  # the free tier's per-minute limit
            raise ValueError("The AI is busy right now (free-tier limit). Please wait a minute and try again.") from e
        if any(k in text.lower() for k in ("timeout", "timed out", "deadline")):
            raise ValueError("The AI took too long to answer. Please try again, perhaps with fewer photos.") from e
        raise
    print(f"Gemini matched {len(photos)} photos in {time.monotonic() - started:.1f}s", flush=True)  # shows in Modal logs
    try:
        raw = json.loads(response.text or "")
    except json.JSONDecodeError as e:
        raise ValueError("The vision model didn't return a layout. Please try again.") from e
    if not isinstance(raw, dict):
        raise ValueError("The vision model didn't return a layout. Please try again.")
    return normalize(raw, [pid for pid, _ in photos])


def match_photos_claude(plan_bytes: bytes, plan_mime: str, photos: list[tuple[str, bytes]], client: Any = None) -> dict[str, Any]:
    import anthropic

    client = client or anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
    b64 = lambda b: base64.standard_b64encode(b).decode()  # noqa: E731

    plan_block = (
        {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64(plan_bytes)}}
        if plan_mime == "application/pdf"
        else {"type": "image", "source": {"type": "base64", "media_type": plan_mime, "data": b64(plan_bytes)}}
    )
    content: list[dict[str, Any]] = [{"type": "text", "text": "Floor plan:"}, plan_block]
    for i, (_, data) in enumerate(photos):
        content.append({"type": "text", "text": f"Photo {i}:"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64(data)}})
    content.append({"type": "text", "text": INSTRUCTIONS})

    response = client.messages.create(
        model=os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL),
        max_tokens=8000,
        tools=[TOOL],
        tool_choice={"type": "tool", "name": TOOL["name"]},
        messages=[{"role": "user", "content": content}],
    )
    tool_input = next((b.input for b in response.content if getattr(b, "type", "") == "tool_use"), None)
    if not isinstance(tool_input, dict):
        raise ValueError("The vision model didn't return a layout. Please try again.")
    return normalize(tool_input, [pid for pid, _ in photos])


# ---------------------------------------------------------------------------
# Offline stand-in, used by local.py when no AI key is set.
DEMO_PLAN = {
    "width": 10, "depth": 7,
    "rooms": [
        {"id": "living", "name": "Living room", "x": 0, "y": 0, "width": 6, "depth": 4},
        {"id": "kitchen", "name": "Kitchen", "x": 6, "y": 0, "width": 4, "depth": 4},
        {"id": "bed1", "name": "Bedroom 1", "x": 0, "y": 4, "width": 5, "depth": 3},
        {"id": "bath", "name": "Bathroom", "x": 5, "y": 4, "width": 2, "depth": 3},
        {"id": "bed2", "name": "Bedroom 2", "x": 7, "y": 4, "width": 3, "depth": 3},
    ],
}


def demo_match(plan_bytes: bytes, plan_mime: str, photos: list[tuple[str, bytes]]) -> dict[str, Any]:
    ids = [r["id"] for r in DEMO_PLAN["rooms"]]
    matches = [{"photoId": pid, "roomId": ids[i % len(ids)], "confident": True} for i, (pid, _) in enumerate(photos)]
    if len(matches) >= 2:
        matches[-1].update(confident=False, roomId="bed2", candidates=["bed2", "bed1"],
                           reason="It looks like a bedroom, but it could be either one.")
    return {"plan": DEMO_PLAN, "matches": matches}
