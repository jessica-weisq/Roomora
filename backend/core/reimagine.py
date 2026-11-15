"""Reimagine a redesigned room with fal: the walk-through's 3D render of the new design, made photographic in
the room's real setting.

Two pictures go to an image-editing model that takes several images (default fal-ai/nano-banana/edit, about
$0.04 an image): the room's original photo, for the real room (walls, windows, the view outside, floor,
light), and a render of the visitor's design from the 3D walk, for what's in it and where (furniture,
layout, colours, wall finish). The result is an AI impression, and the walk-through labels it so.

Check it works with your key:  FAL_KEY=... python -m core.reimagine design.jpg photo.jpg "Bedroom"
Use another fal model with FAL_REIMAGINE_MODEL (it must accept image_urls and a prompt).
"""

from __future__ import annotations

import io
import os
import sys
from typing import Callable

from .panorama import first_image_url

DEFAULT_MODEL = "fal-ai/nano-banana/edit"
MAX_SIDE = 1536


MAX_FURNITURE = 40


def prompt_for(room_name: str, with_photo: bool, notes: str = "", photo_is_this_room: bool = True,
               stronger: bool = False, furniture: list[str] | None = None) -> str:
    """The instructions for Fal: re-render the simulation as a photograph, changing nothing but the rendering.

    furniture lists the pieces in view, each with its colour and where it is in the picture ("a teal sofa,
    centre left, in the middle distance"). Models hold on to named objects far better than to "all the
    furniture", so the list is what keeps every piece present, in place and its own colour.
    """
    room = (room_name or "room").lower()
    p = (
        f"The first image is a 3D simulation of a {room} from an interior design tool: flat shading, simple "
        "textures, computer lighting. Turn it into a real photograph of the same room.\n\n"
        "Keep everything exactly as it is:\n"
        "- Use every piece of furniture and every object in the image, and nothing else. Don't add, remove, "
        "duplicate or swap anything: no extra plants, lamps, cushions, art, rugs, decor or people.\n"
        "- Keep each piece exactly where it is, at the same size, angle and orientation, with the same gaps between "
        "pieces. Nothing moves, rotates or changes scale.\n"
        "- Keep every colour exactly: each piece's colour, the rug's colour and pattern, the wall colour or "
        "wallpaper, the floor's colour and pattern. Match the hues, don't reinterpret them.\n"
        "- Keep the room itself: walls, windows, doors, ceiling, floor layout and the view through the windows.\n"
        "- Keep the camera position, angle, lens and framing.\n"
    )
    items = [str(f).strip()[:120] for f in (furniture or []) if str(f).strip()][:MAX_FURNITURE]
    if items:
        p += "\nThe furniture and objects in the image, all of which must appear exactly as described:\n" + "".join(f"- {i}\n" for i in items)
    p += (
        "\nChange only how it's rendered:\n"
        "- Turn each simulated object into the real thing it represents, with real materials: wood with grain, "
        "upholstery with woven fabric and soft creases, metal with true reflections, glass, ceramic, stone and "
        "painted plaster with their real surface texture.\n"
        "- Give the room natural daylight from the windows, with soft shadows under and behind each piece, contact "
        "shadows where things meet the floor, and gentle bounce light.\n"
        "- Make it look like a professional interior photograph taken on a full-frame camera: sharp, true colours, "
        "realistic depth, natural exposure.\n"
    )
    if with_photo:
        p += (
            f"\nThe second image is a real photograph of this {room}. Use it only for the room's real architecture, "
            "window light, view outside and photographic style. Take all furniture, colours and positions from the "
            "first image, not the photograph.\n"
            if photo_is_this_room else
            "\nThe second image is a real photograph of another room in the same home. Use it only for the home's "
            "finishes, light and photographic style. Take the room, all furniture, colours and positions from the "
            "first image, not the photograph.\n"
        )
    p += "\nNothing in the result should look like computer graphics. No text, watermarks or borders."
    if stronger:
        p += (" The last attempt came back almost identical to the simulation: change the rendering completely, "
              "while keeping every piece, colour and position.")
    notes = (notes or "").strip()
    return p + (f"\n\nAlso: {notes[:300]}" if notes else "")


def looks_unchanged(render: bytes, result: bytes) -> bool:
    """True when the result is near enough the mock-up itself (an edit model that changed almost nothing)."""
    import numpy as np
    from PIL import Image

    def small(b: bytes):
        return np.asarray(Image.open(io.BytesIO(b)).convert("L").resize((96, 64)), dtype=np.float32)

    try:
        return float(np.abs(small(render) - small(result)).mean()) < 7.0
    except Exception:
        return False


def to_jpeg(data: bytes, max_side: int = MAX_SIDE) -> bytes:
    """Any image the browser sent -> an RGB JPEG no bigger than max_side (rejects anything that isn't an image)."""
    from PIL import Image, ImageOps

    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im).convert("RGB")
    im.thumbnail((max_side, max_side))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=90)
    return out.getvalue()


def make_fal_reimagine(model: str | None = None, timeout: float = 240) -> Callable[..., dict]:
    """Returns run(render, photo, room_name, notes, photo_is_this_room) -> {"image": bytes, "unchanged": bool}."""
    import fal_client  # reads FAL_KEY
    import httpx

    model = model or os.environ.get("FAL_REIMAGINE_MODEL", DEFAULT_MODEL)

    def once(urls: list[str], prompt: str) -> bytes:
        result = fal_client.subscribe(
            model,
            arguments={"prompt": prompt, "image_urls": urls, "num_images": 1, "output_format": "jpeg"},
            client_timeout=timeout,
        )
        url = first_image_url(result)
        if not url:
            keys = list(result) if isinstance(result, dict) else type(result).__name__
            raise RuntimeError(f"{model} returned no image (got {keys})")
        r = httpx.get(url, timeout=120, follow_redirects=True)
        r.raise_for_status()
        return r.content

    def run(render: bytes, photo: bytes | None, room_name: str, notes: str = "", photo_is_this_room: bool = True,
            furniture: list[str] | None = None) -> dict:
        # the mock-up first (the picture to re-render), the real photo second (the look to match)
        urls = [fal_client.upload(render, "image/jpeg")]
        if photo:
            urls.append(fal_client.upload(photo, "image/jpeg"))
        image = once(urls, prompt_for(room_name, bool(photo), notes, photo_is_this_room, furniture=furniture))
        if looks_unchanged(render, image):   # an edit model that barely edited: ask again, harder
            image = once(urls, prompt_for(room_name, bool(photo), notes, photo_is_this_room, stronger=True, furniture=furniture))
        return {"image": image, "unchanged": looks_unchanged(render, image)}

    return run


if __name__ == "__main__":
    if len(sys.argv) < 2 or not os.environ.get("FAL_KEY"):
        sys.exit('Usage: FAL_KEY=... python -m core.reimagine design.jpg [photo.jpg] ["Room name"]')
    from pathlib import Path

    design = Path(sys.argv[1])
    photo = Path(sys.argv[2]) if len(sys.argv) > 2 and Path(sys.argv[2]).exists() else None
    name = sys.argv[3] if len(sys.argv) > 3 else (sys.argv[2] if len(sys.argv) > 2 and not photo else "room")
    print(f"Asking {os.environ.get('FAL_REIMAGINE_MODEL', DEFAULT_MODEL)} to reimagine {design}{' in ' + str(photo) if photo else ''} …")
    res = make_fal_reimagine()(to_jpeg(design.read_bytes()), to_jpeg(photo.read_bytes()) if photo else None, name)
    out = design.with_name(f"{design.stem}-reimagined.jpg")
    out.write_bytes(res["image"])
    print(f"Wrote {out}" + (" (but it's almost the same as the design: try another model with FAL_REIMAGINE_MODEL)" if res["unchanged"] else ""))
