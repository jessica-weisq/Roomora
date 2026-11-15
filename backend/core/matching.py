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
import re
import time
from typing import Any

log = logging.getLogger(__name__)

# Override with ANTHROPIC_MODEL / GEMINI_MODEL if you want a different model.
DEFAULT_MODEL = "claude-sonnet-5-5"
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"  # fast; gemini-3.8-flash timed out even on "hi" for free keys


class VisionProviderError(RuntimeError):
    """A safe, actionable error from the configured vision provider."""

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
                    "fixtures": {
                        "type": "array",
                        "description": "Fittings and furniture DRAWN on the plan (not imagined)",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {"type": "string", "enum": ["kitchen_run", "island", "bath", "shower", "wc", "basin", "bed", "wardrobe", "sofa", "table"]},
                                "room": {"type": "string", "description": "The room it's in, exactly as in rooms"},
                                "box_2d": {"type": "array", "items": {"type": "integer"}, "description": "Its outline on the plan image: [ymin, xmin, ymax, xmax], each 0-1000"},
                            },
                            "required": ["type", "box_2d"],
                        },
                    },
                    "north_arrow_deg": {
                        "type": "number",
                        "description": "Only if the plan has a north arrow or compass: the direction it points on the page, "
                        "in degrees clockwise from straight up (0 = up, 90 = right). Leave out if there is none.",
                    },
                    "rooms": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "As labelled, e.g. 'Bedroom 2'. An unlabelled room: its type and where it is, e.g. 'En suite (Principal Bedroom)'. Unique."},
                                "box_2d": {
                                    "type": "array", "items": {"type": "integer"},
                                    "description": "Where the room is on the plan image, inside its walls: [ymin, xmin, ymax, xmax], each 0-1000",
                                },
                                "x_m": {"type": "number", "description": "Left edge, metres from the plan's left"},
                                "y_m": {"type": "number", "description": "Top edge, metres from the plan's top"},
                                "width_m": {"type": "number", "description": "Left to right, from the dimensions written on the plan if there are any, else estimated"},
                                "depth_m": {"type": "number", "description": "Top to bottom, from the dimensions written on the plan if there are any, else estimated"},
                            },
                            "required": ["name", "box_2d", "width_m", "depth_m"],
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

1. Read the floor plan. List every room, including the small ones: every bathroom, en suite, shower
   room, WC, cloakroom, utility room and labelled cupboard or store, plus hallways and landings.
   An en suite is a separate room even when it opens off a bedroom: give it its own box, and keep it out
   of the bedroom's box.
   Many plans don't label bathrooms, en suites, shower rooms or WCs at all, or give their sizes: find them
   by their fixtures (the symbols for a bath, shower tray, toilet or basin) and list them anyway. Name an
   unlabelled room by its type and where it is, e.g. "En suite (Principal Bedroom)", "Bathroom (by
   Bedroom 2)", "Cloakroom WC". A bathroom with a door into a bedroom is that bedroom's en suite.
   For each room give box_2d, its position on the plan image just inside its walls, as
   [ymin, xmin, ymax, xmax] on a 0-1000 scale across the image. Also give its width (left to right) and
   depth (top to bottom) in metres, read from the dimensions written on the plan; if there are none,
   estimate from typical sizes (a door is about 0.8 m wide). Approximate an L-shaped or irregular room
   with its bounding box. x_m and y_m (its position in metres) are optional.
   If the plan shows several floors, place them side by side, left to right, without overlapping.
   Give rooms with the same type distinct names (as labelled, e.g. "Bedroom 1", "Bedroom 2").
   Unlabelled spaces count too: an entrance lobby or hallway behind the front door, a corridor, a landing.
   Call them "Entrance hall", "Hall" or "Landing" and give each a box like any room.
   Then list the fixtures and furniture the plan actually draws, as fixtures: kitchen runs of worktop and
   units (kitchen_run, one per straight run), islands, baths, shower trays or enclosures, WCs, basins, beds,
   built-in wardrobes, sofas and tables, each with the room it's in and its box_2d on the image. Only what
   is drawn; leave out anything you'd be guessing.
   If the plan has a north arrow or compass rose, give the direction it points as north_arrow_deg
   (degrees clockwise from straight up the page). Leave it out if there isn't one; don't guess.

2. For each photo, decide which room it shows. Set confident to true only when the photo clearly
   identifies one room. If it could be one of several (e.g. two similar bedrooms), set confident to
   false, list the candidates most likely first, and give a short reason a non-expert would understand,
   e.g. "It looks like a bedroom, but it could be either one."
   Bathrooms, en suites, shower rooms and WCs look alike, so match them on what the plan shows: whether
   it has a bath or only a shower or just a WC and basin, where its window is, which way the door opens
   and what's visible through it (a bed through the doorway means an en suite), and its size and shape.
   If two of them could still fit, set confident to false and list both.
   Use room names exactly as you wrote them in plan.rooms.
   Every photo taken inside a home belongs to one of this property's rooms: if you can't tell which, give
   the likeliest room of the right type (a bathroom photo goes to a bathroom, en suite, shower room or WC),
   set confident to false and list the others of that type. Set room_name to null only for a photo that
   isn't of a room in this property (outside, a garden, a street).

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


def _box(value: Any) -> list[float] | None:
    """box_2d [ymin, xmin, ymax, xmax] on 0-1000 -> [x0, y0, x1, y1] as fractions of the image, or None."""
    try:
        ymin, xmin, ymax, xmax = (min(max(float(v), 0.0), 1000.0) / 1000 for v in value[:4])
    except (TypeError, ValueError):
        return None
    if xmax - xmin < 0.005 or ymax - ymin < 0.005:
        return None
    return [xmin, ymin, xmax, ymax]


FIXTURE_TYPES = {"kitchen_run", "island", "bath", "shower", "wc", "basin", "bed", "wardrobe", "sofa", "table"}


def _median(values: list[float]) -> float:
    s = sorted(values)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def _place_from_boxes(entries: list[dict[str, Any]]) -> tuple[float, float] | None:
    """Put rooms in metres using where they are on the drawing (the boxes) and the scale their written sizes give.

    Vision models are much better at pointing at a room on the image than at turning it into coordinates in
    metres, and small rooms (bathrooms, en suites, WCs) suffer most from the latter. So positions and extents
    come from the boxes, and metres per image width / height come from the median of each room's written size
    over its box, which shrugs off the odd misread dimension.
    """
    boxed = [e for e in entries if e["box"]]
    if not boxed:
        return None
    sx = [e["w"] / (e["box"][2] - e["box"][0]) for e in boxed if e["w"]]
    sy = [e["d"] / (e["box"][3] - e["box"][1]) for e in boxed if e["d"]]
    if not sx or not sy:
        return None
    mx, my = _median(sx), _median(sy)   # metres across the whole image, and down it
    for e in boxed:
        x0, y0, x1, y1 = e["box"]
        e["x"], e["y"], e["w"], e["d"] = x0 * mx, y0 * my, (x1 - x0) * mx, (y1 - y0) * my
        e["placed"] = True
    return mx, my


def normalize(raw: dict[str, Any], photo_ids: list[str]) -> dict[str, Any]:
    """Turn the model's tool input into the API's {plan, matches} shape, fixing what we can."""
    plan_in = raw.get("plan") or {}
    entries: list[dict[str, Any]] = []
    for r in plan_in.get("rooms") or []:
        if not isinstance(r, dict):
            continue
        box = _box(r.get("box_2d"))
        num = lambda k: float(r[k]) if isinstance(r.get(k), (int, float)) else None  # noqa: E731
        e = {"r": r, "box": box, "w": num("width_m"), "d": num("depth_m"), "x": num("x_m"), "y": num("y_m"), "placed": False}
        if e["w"] is not None and e["w"] <= 0:
            e["w"] = None
        if e["d"] is not None and e["d"] <= 0:
            e["d"] = None
        entries.append(e)
    scale = _place_from_boxes(entries)
    # rooms placed from boxes start at the drawing's corner; shift so the plan starts at 0, 0
    placed = [e for e in entries if e["placed"]]
    ox = oy = 0.0
    if placed:
        ox, oy = min(e["x"] for e in placed), min(e["y"] for e in placed)
        for e in placed:
            e["x"] -= ox
            e["y"] -= oy

    rooms: list[dict[str, Any]] = []
    by_name: dict[str, str] = {}
    taken: set[str] = set()
    for e in entries:
        r = e["r"]
        if e["x"] is None or e["y"] is None or not e["w"] or not e["d"]:
            continue
        w, d, x, y = e["w"], e["d"], max(0.0, e["x"]), max(0.0, e["y"])
        if w <= 0.3 or d <= 0.3:
            continue
        name = str(r.get("name") or "Room").strip()
        rid = _slug(name, taken)
        if name.lower() in by_name:  # duplicate label: keep the room, give it a distinct name
            name = f"{name} ({rid.rsplit('-', 1)[-1]})"
        by_name.setdefault(name.lower(), rid)
        room: dict[str, Any] = {"id": rid, "name": name, "x": round(x, 3), "y": round(y, 3), "width": round(w, 3), "depth": round(d, 3)}
        if e["box"]:
            room["box"] = [round(v, 4) for v in e["box"]]   # where it is on the plan image, for the walk-through
        rooms.append(room)
    if not rooms:
        raise ValueError("Couldn't find any rooms on the floor plan. Is it a clear, labelled plan?")

    width = max(float(plan_in.get("width_m") or 0), max(r["x"] + r["width"] for r in rooms))
    depth = max(float(plan_in.get("depth_m") or 0), max(r["y"] + r["depth"] for r in rooms))
    from .plan_tidy import tidy

    # rooms joined at their shared walls (boxes inside the walls would otherwise float a wall apart)
    plan: dict[str, Any] = {"width": round(width, 3), "depth": round(depth, 3), "rooms": rooms}
    # north: the compass bearing the top of the plan faces, from the north arrow if there is one
    try:
        arrow = float(plan_in["north_arrow_deg"])
        if arrow == arrow and abs(arrow) <= 720:  # not NaN, sane
            plan["north"] = round((360 - arrow) % 360, 1)
    except (KeyError, TypeError, ValueError):
        pass

    def key(name: Any) -> str:
        return re.sub(r"[^a-z0-9]+", "", str(name).lower())

    by_key: dict[str, str] = {}
    for n, i in by_name.items():
        by_key.setdefault(key(n), i)

    def rid(name: Any) -> str | None:
        """Plan room id for a name the model wrote; forgiving about case, spaces and punctuation
        ("En-suite" = "En suite"), or a shortened name that fits exactly one room ("Principal en suite"
        isn't, but "Utility" for "Utility room" is). None when it fits no room or more than one."""
        if not name:
            return None
        exact = by_name.get(str(name).strip().lower())
        if exact:
            return exact
        k = key(name)
        if not k:
            return None
        if k in by_key:
            return by_key[k]
        hits = {i for kk, i in by_key.items() if k in kk or kk in k}
        return hits.pop() if len(hits) == 1 else None

    # fixtures drawn on the plan: where they are on the image, and (when rooms were placed from boxes) in metres
    fixtures = []
    for f in plan_in.get("fixtures") or []:
        if not isinstance(f, dict) or f.get("type") not in FIXTURE_TYPES:
            continue
        box = _box(f.get("box_2d"))
        if not box:
            continue
        fx: dict[str, Any] = {"type": f["type"], "box": [round(v, 4) for v in box]}
        room_id = rid(f.get("room"))
        if room_id:
            fx["room"] = room_id
        if scale:
            mx, my = scale
            fx.update(x=round(box[0] * mx - ox, 3), y=round(box[1] * my - oy, 3),
                      width=round((box[2] - box[0]) * mx, 3), depth=round((box[3] - box[1]) * my, 3))
        fixtures.append(fx)
        if len(fixtures) >= 60:
            break
    if fixtures:
        plan["fixtures"] = fixtures
    plan = tidy(plan)   # (after the fixtures, so they move with the rooms)

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
    # This used to become an opaque 502 in the API, which made a missing Modal
    # secret look exactly like an upload problem.
    raise VisionProviderError("AI analysis is not configured. Please try again later.")


def _provider_error(error: Exception) -> VisionProviderError | None:
    """Translate common provider failures without exposing credentials or internals."""
    text = f"{type(error).__name__}: {error}".lower()
    if "429" in text or "resource_exhausted" in text:
        return VisionProviderError("The AI is busy right now. Please wait a minute and try again.")
    if any(value in text for value in ("timeout", "timed out", "deadline")):
        return VisionProviderError("The AI took too long to answer. Please try again with fewer photos.")
    if any(value in text for value in ("401", "403", "unauthenticated", "permission_denied", "api key")):
        return VisionProviderError("AI analysis is temporarily unavailable. Please try again later.")
    if "404" in text and "model" in text:
        return VisionProviderError("The configured AI model is unavailable. Please try again later.")
    return None


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
        friendly = _provider_error(e)
        if friendly:
            raise friendly from e
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

    try:
        response = client.messages.create(
            model=os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL),
            max_tokens=8000,
            tools=[TOOL],
            tool_choice={"type": "tool", "name": TOOL["name"]},
            messages=[{"role": "user", "content": content}],
        )
    except Exception as e:
        friendly = _provider_error(e)
        if friendly:
            raise friendly from e
        raise
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
