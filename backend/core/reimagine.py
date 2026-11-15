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


def prompt_for(room_name: str, with_photo: bool, notes: str = "") -> str:
    room = (room_name or "room").lower()
    if with_photo:
        p = (
            f"The first image is a real photograph of a {room}. The second image is a rough 3D mock-up of the same "
            f"{room} after a redesign. Create one photorealistic interior photograph of this {room} as redesigned: "
            "take the furniture, its arrangement, the colours, fabrics and the wall colour or wallpaper from the "
            "mock-up, and take the room itself from the photograph: its architecture, windows and the view through "
            "them, ceiling, floor, daylight and photographic style. Frame it like the mock-up's camera. Make the "
            "furniture look real and well made, not like 3D models. Don't add text, people or extra rooms."
        )
    else:
        p = (
            f"This is a rough 3D mock-up of a redesigned {room}. Turn it into one photorealistic interior photograph "
            "with the same furniture, arrangement, colours and wall finish, the same camera framing, natural "
            "daylight and real materials. Don't add text, people or extra rooms."
        )
    notes = (notes or "").strip()
    return p + (f" Also: {notes[:300]}" if notes else "")


def to_jpeg(data: bytes, max_side: int = MAX_SIDE) -> bytes:
    """Any image the browser sent -> an RGB JPEG no bigger than max_side (rejects anything that isn't an image)."""
    from PIL import Image, ImageOps

    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im).convert("RGB")
    im.thumbnail((max_side, max_side))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=90)
    return out.getvalue()


def make_fal_reimagine(model: str | None = None, timeout: float = 240) -> Callable[[bytes, bytes | None, str, str], bytes]:
    import fal_client  # reads FAL_KEY
    import httpx

    model = model or os.environ.get("FAL_REIMAGINE_MODEL", DEFAULT_MODEL)

    def run(render: bytes, photo: bytes | None, room_name: str, notes: str = "") -> bytes:
        urls = []
        if photo:
            urls.append(fal_client.upload(photo, "image/jpeg"))
        urls.append(fal_client.upload(render, "image/jpeg"))
        result = fal_client.subscribe(
            model,
            arguments={"prompt": prompt_for(room_name, bool(photo), notes), "image_urls": urls, "num_images": 1, "output_format": "jpeg"},
            client_timeout=timeout,
        )
        url = first_image_url(result)
        if not url:
            keys = list(result) if isinstance(result, dict) else type(result).__name__
            raise RuntimeError(f"{model} returned no image (got {keys})")
        r = httpx.get(url, timeout=120, follow_redirects=True)
        r.raise_for_status()
        return r.content

    return run


if __name__ == "__main__":
    if len(sys.argv) < 2 or not os.environ.get("FAL_KEY"):
        sys.exit('Usage: FAL_KEY=... python -m core.reimagine design.jpg [photo.jpg] ["Room name"]')
    from pathlib import Path

    design = Path(sys.argv[1])
    photo = Path(sys.argv[2]) if len(sys.argv) > 2 and Path(sys.argv[2]).exists() else None
    name = sys.argv[3] if len(sys.argv) > 3 else (sys.argv[2] if len(sys.argv) > 2 and not photo else "room")
    print(f"Asking {os.environ.get('FAL_REIMAGINE_MODEL', DEFAULT_MODEL)} to reimagine {design}{' in ' + str(photo) if photo else ''} …")
    data = make_fal_reimagine()(to_jpeg(design.read_bytes()), to_jpeg(photo.read_bytes()) if photo else None, name)
    out = design.with_name(f"{design.stem}-reimagined.jpg")
    out.write_bytes(data)
    print(f"Wrote {out}")
