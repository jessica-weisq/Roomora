"""Read the floor plan and match each photo to a room, using Claude's vision.

One request: the plan plus a thumbnail of every photo. Claude answers through a tool call, so the
reply is structured JSON we can validate rather than free text.
"""

from __future__ import annotations

import base64
import os
import re
from typing import Any

# Override with ANTHROPIC_MODEL if you want a different (e.g. cheaper) model.
DEFAULT_MODEL = "claude-sonnet-5-5"

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
                "This doesn't look like a room in this property." if p and p.get("room_name") is None
                else "We couldn't tell which room this is."
            )
        matches.append(m)
    return {"plan": plan, "matches": matches}


def match_photos(plan_bytes: bytes, plan_mime: str, photos: list[tuple[str, bytes]], client: Any = None) -> dict[str, Any]:
    """photos: [(photoId, jpeg thumbnail bytes)] → {"plan": ..., "matches": [...]}"""
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
# Offline stand-in, used by local.py when there's no ANTHROPIC_API_KEY.
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
