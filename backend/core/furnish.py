"""Furnish a room for the walk-through: which furniture its photos show, roughly where it stands, and the floor.

Same provider choice as matching.py (Gemini or Claude, structured output we validate). The walk-through
draws each item with its own models, so we only need types, positions, sizes and colours, not geometry.
Positions are approximate: the photos don't say where they were taken from.
"""

from __future__ import annotations

import base64
import json
import os
import re
from typing import Any

from .matching import DEFAULT_GEMINI_MODEL, DEFAULT_MODEL, provider

# The furniture the walk-through can draw (public/tour/js/furnish2.js). Keep the two lists in step.
ITEM_TYPES: dict[str, str] = {
    "sofa": "sofa or settee (len = length in metres)",
    "armchair": "armchair or tub chair",
    "ottoman": "ottoman, footstool or pouffe (w, d)",
    "sideboard": "sideboard, credenza or low cabinet (len)",
    "coffeeRound": "round coffee table (r = radius)",
    "coffee": "rectangular coffee table (w, d)",
    "table": "dining table (w = length, d = width)",
    "chair": "single chair on its own",
    "bed": "bed (w = width, d = length)",
    "nightstand": "bedside table",
    "bench": "bench or end-of-bed stool (len)",
    "dresser": "chest of drawers or dresser (len)",
    "wardrobe": "freestanding or built-in wardrobe (len)",
    "desk": "desk (w)",
    "bookcase": "bookcase or open shelving (len)",
    "shelving": "tall built-in shelving unit (len)",
    "tv": "wall-mounted TV",
    "rug": "rug (w, d)",
    "floorLamp": "floor lamp",
    "plant": "large potted plant",
    "console": "console table, often with a mirror (len)",
    "island": "kitchen island (w, d)",
    "counter": "kitchen worktop run with cupboards (len)",
    "bath": "bath (len)",
    "vanity": "basin vanity unit (len)",
    "wc": "toilet",
    "hottub": "hot tub (w)",
    "planter": "planter box (len)",
    "lounger": "sun lounger",
    "roundTable": "small round table with chairs (r)",
}
FLOORS = ["oak", "dark-oak", "carpet", "stone", "tile"]
FACES = ["up", "down", "left", "right"]
MAX_ITEMS = 24

ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": list(ITEM_TYPES)},
        "x": {"type": "number", "description": "Centre, 0 = left wall of the room on the plan, 1 = right wall"},
        "y": {"type": "number", "description": "Centre, 0 = top wall of the room on the plan, 1 = bottom wall"},
        "faces": {"type": "string", "enum": FACES, "description": "Direction its front or seat faces on the plan"},
        "len": {"type": "number"}, "w": {"type": "number"}, "d": {"type": "number"}, "r": {"type": "number"},
        "color": {"type": "string", "description": "Main colour as #rrggbb"},
        "accent": {"type": "array", "items": {"type": "string"}, "description": "Cushion or detail colours as #rrggbb"},
    },
    "required": ["type", "x", "y", "faces"],
}
MAX_ART = 6
ART_SCHEMA = {
    "type": "object",
    "properties": {
        "photo": {"type": "integer", "description": "Which photo shows it best (1 = the first photo)"},
        "box_2d": {
            "type": "array", "items": {"type": "integer"},
            "description": "The picture's outline in that photo, inside the frame: [ymin, xmin, ymax, xmax], each 0-1000",
        },
        "wall": {"type": "string", "enum": FACES, "description": "Which wall of the room it hangs on, as on the plan (up = top wall)"},
        "at": {"type": "number", "description": "Where along that wall: 0 = its left end (or top end for left/right walls), 1 = the other end"},
        "w": {"type": "number", "description": "Width in metres, including the frame"},
        "h": {"type": "number", "description": "Height in metres, including the frame"},
    },
    "required": ["photo", "box_2d", "wall", "at"],
}
TOOL = {
    "name": "report_furniture",
    "description": "Report the furniture visible in the room's photos, the floor finish and the wall colour.",
    "input_schema": {
        "type": "object",
        "properties": {
            "floor": {"type": "string", "enum": FLOORS + ["unknown"]},
            "walls": {"type": "string", "description": "Main wall colour as #rrggbb (the paint, not trim or tiles)"},
            "items": {"type": "array", "items": ITEM_SCHEMA},
            "art": {"type": "array", "items": ART_SCHEMA, "description": "Framed pictures, paintings and prints on the walls"},
        },
        "required": ["floor", "items"],
    },
}


def _instructions(room_name: str, width: float, depth: float, n: int) -> str:
    kinds = "\n".join(f"- {k}: {v}" for k, v in ITEM_TYPES.items())
    return (
        f"These {n} photo(s) show the {room_name} of a home. On the floor plan the room is about {width:.1f} m wide "
        f"(x, left to right) and {depth:.1f} m deep (y, top to bottom). We don't know where each photo was taken from.\n\n"
        "List the furniture you can see as a plan view of the room, placed where it plausibly stands: against walls "
        "where the photos show it against a wall, in the middle where it's in the middle, keeping pieces that are "
        "together in the photos together. Count each real object once even if several photos show it. "
        f"At most {MAX_ITEMS} items. Give sizes in metres where you can judge them, colours as #rrggbb, the floor "
        "finish (oak, dark-oak, carpet, stone, tile, or unknown), and the main wall colour as #rrggbb (the paint "
        "most of the walls have, allowing for the lighting in the photos).\n\nAllowed types:\n"
        f"{kinds}\n\nSkip anything that isn't one of these types, and small things such as books and vases.\n\n"
        f"Also list up to {MAX_ART} framed pictures, paintings or prints hanging on the walls (not mirrors, windows "
        "or TVs): the photo that shows each best and its outline in that photo as box_2d [ymin, xmin, ymax, xmax] "
        "from 0 to 1000, just inside the frame; which wall it hangs on and where along it, as for the furniture; and "
        "its size in metres."
    )


_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def normalize(raw: dict[str, Any]) -> dict[str, Any]:
    """Keep only well-formed items, clamp positions, drop unknown types and bad colours."""
    floor = raw.get("floor")
    out: dict[str, Any] = {"floor": floor if floor in FLOORS else None, "items": []}
    walls = raw.get("walls")
    out["walls"] = walls.lower() if isinstance(walls, str) and _HEX.match(walls) else None
    for it in raw.get("items") or []:
        if not isinstance(it, dict) or it.get("type") not in ITEM_TYPES:
            continue
        try:
            x, y = float(it["x"]), float(it["y"])
        except (KeyError, TypeError, ValueError):
            continue
        item: dict[str, Any] = {
            "type": it["type"],
            "x": round(min(max(x, 0.0), 1.0), 3),
            "y": round(min(max(y, 0.0), 1.0), 3),
            "faces": it.get("faces") if it.get("faces") in FACES else "down",
        }
        for k in ("len", "w", "d", "r"):
            v = it.get(k)
            if isinstance(v, (int, float)) and 0 < v < 20:
                item[k] = round(float(v), 2)
        if isinstance(it.get("color"), str) and _HEX.match(it["color"]):
            item["color"] = it["color"]
        acc = [a for a in (it.get("accent") or []) if isinstance(a, str) and _HEX.match(a)][:3]
        if acc:
            item["accent"] = acc
        out["items"].append(item)
        if len(out["items"]) >= MAX_ITEMS:
            break
    out["art"] = []
    for a in raw.get("art") or []:
        try:
            photo = int(a["photo"])
            ymin, xmin, ymax, xmax = (min(max(float(v), 0.0), 1000.0) / 1000 for v in a["box_2d"][:4])
            at = min(max(float(a.get("at", 0.5)), 0.0), 1.0)
        except (KeyError, TypeError, ValueError):
            continue
        if photo < 1 or xmax - xmin < 0.03 or ymax - ymin < 0.03 or a.get("wall") not in FACES:
            continue
        art: dict[str, Any] = {"photo": photo, "box": [round(xmin, 3), round(ymin, 3), round(xmax, 3), round(ymax, 3)],
                               "wall": a["wall"], "at": round(at, 3)}
        for k in ("w", "h"):
            v = a.get(k)
            if isinstance(v, (int, float)) and 0.15 <= v <= 3:
                art[k] = round(float(v), 2)
        out["art"].append(art)
        if len(out["art"]) >= MAX_ART:
            break
    return out


def furnish_room(photos: list[bytes], room_name: str, width: float, depth: float) -> dict[str, Any]:
    """photos: jpeg bytes (thumbnails are fine) → {"floor": ..., "items": [...]}"""
    which = provider()
    if which == "gemini":
        return furnish_gemini(photos, room_name, width, depth)
    if which == "claude":
        return furnish_claude(photos, room_name, width, depth)
    raise RuntimeError("No vision model configured: set GEMINI_API_KEY or ANTHROPIC_API_KEY.")


def furnish_gemini(photos: list[bytes], room_name: str, width: float, depth: float, client: Any = None) -> dict[str, Any]:
    from google import genai
    from google.genai import types

    # Same protections as matching.py: give up after 140 s, one attempt, low thinking.
    client = client or genai.Client(
        http_options=types.HttpOptions(timeout=140_000, retry_options=types.HttpRetryOptions(attempts=1)),
    )
    parts: list[Any] = []
    for i, data in enumerate(photos):
        parts.append(types.Part.from_text(text=f"Photo {i + 1}:"))
        parts.append(types.Part.from_bytes(data=data, mime_type="image/jpeg"))
    parts.append(types.Part.from_text(text=_instructions(room_name, width, depth, len(photos)) + "\nReply only with JSON matching the given schema."))
    def config(thinking: bool) -> Any:
        return types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=TOOL["input_schema"],
            temperature=0,
            max_output_tokens=8000,
            thinking_config=types.ThinkingConfig(thinking_level=os.environ.get("GEMINI_THINKING", "LOW").upper()) if thinking else None,
        )

    model = os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    try:
        try:
            response = client.models.generate_content(model=model, contents=parts, config=config(True))
        except Exception as e:  # a model that doesn't take this thinking level: use its default
            if "400" in str(e) and "thinking" in str(e).lower():
                response = client.models.generate_content(model=model, contents=parts, config=config(False))
            else:
                raise
    except Exception as e:
        text = f"{type(e).__name__}: {e}"
        if "429" in text or "RESOURCE_EXHAUSTED" in text:
            raise ValueError("The AI is busy right now (free-tier limit). Please wait a minute and try again.") from e
        if any(k in text.lower() for k in ("timeout", "timed out", "deadline")):
            raise ValueError("The AI took too long to look at this room. Please try again.") from e
        raise
    try:
        raw = json.loads(response.text or "")
    except json.JSONDecodeError as e:
        raise ValueError("The vision model didn't describe the room. Please try again.") from e
    if not isinstance(raw, dict):
        raise ValueError("The vision model didn't describe the room. Please try again.")
    return normalize(raw)


def furnish_claude(photos: list[bytes], room_name: str, width: float, depth: float, client: Any = None) -> dict[str, Any]:
    import anthropic

    client = client or anthropic.Anthropic()
    content: list[dict[str, Any]] = []
    for i, data in enumerate(photos):
        content.append({"type": "text", "text": f"Photo {i + 1}:"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(data).decode()}})
    content.append({"type": "text", "text": _instructions(room_name, width, depth, len(photos)) + "\nReport it with the report_furniture tool."})
    response = client.messages.create(
        model=os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL),
        max_tokens=4000,
        tools=[TOOL],
        tool_choice={"type": "tool", "name": TOOL["name"]},
        messages=[{"role": "user", "content": content}],
    )
    tool_input = next((b.input for b in response.content if getattr(b, "type", "") == "tool_use"), None)
    if not isinstance(tool_input, dict):
        raise ValueError("The vision model didn't describe the room. Please try again.")
    return normalize(tool_input)


# ---------------------------------------------------------------------------
# Offline stand-in, used by local.py when no AI key is set: a plausible set for the room's name.
def demo_furnish(photos: list[bytes], room_name: str, width: float, depth: float) -> dict[str, Any]:
    n = room_name.lower()
    if "bed" in n:
        items = [{"type": "bed", "x": 0.45, "y": 0.4, "faces": "down", "w": 1.6, "d": 2.1, "color": "#a9b4a3"},
                 {"type": "nightstand", "x": 0.2, "y": 0.1, "faces": "down"}, {"type": "nightstand", "x": 0.7, "y": 0.1, "faces": "down"}]
        floor, walls = "carpet", "#e8e1d6"
    elif "bath" in n:
        items = [{"type": "bath", "x": 0.5, "y": 0.15, "faces": "down", "len": 1.6}, {"type": "vanity", "x": 0.5, "y": 0.9, "faces": "up", "len": 1.0}]
        floor, walls = "stone", "#f1efea"
    elif "kitchen" in n:
        items = [{"type": "counter", "x": 0.5, "y": 0.08, "faces": "down", "len": max(1.2, width - 0.6)},
                 {"type": "table", "x": 0.5, "y": 0.62, "faces": "down", "w": 1.6, "d": 0.9}]
        floor, walls = "tile", "#eef0ec"
    else:
        items = [{"type": "rug", "x": 0.5, "y": 0.5, "faces": "down", "w": 3.0, "d": 2.0},
                 {"type": "sofa", "x": 0.5, "y": 0.8, "faces": "up", "len": 2.4, "color": "#7d8a99"},
                 {"type": "coffee", "x": 0.5, "y": 0.5, "faces": "down", "w": 1.1, "d": 0.6},
                 {"type": "armchair", "x": 0.2, "y": 0.4, "faces": "right"}]
        floor, walls = "oak", "#d9d4c7"
    # one picture, taken from the middle of the first photo, so the demo shows artwork too
    art = [{"photo": 1, "box_2d": [250, 380, 550, 620], "wall": "up", "at": 0.5, "w": 0.7, "h": 0.9}] if "living" in n else []
    return normalize({"floor": floor, "walls": walls, "items": items, "art": art})
