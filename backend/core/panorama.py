"""Optional 360° view per room via fal (Hunyuan World, about $0.15 each). Used only when FAL_KEY is set.

The model sees one photo and invents the rest of the room, so the frontend labels these as an
AI-generated impression. The image is downloaded and kept with the build, because fal's result links
are temporary.

Check it works with your key:  FAL_KEY=... python -m core.panorama path/to/photo.jpg "Living room"
Use a different fal model with FAL_PANORAMA_MODEL (it must return a 2:1 equirectangular image).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Callable

DEFAULT_MODEL = "fal-ai/hunyuan_world"


def first_image_url(result: Any) -> str | None:
    """The image URL in a fal result, whatever its shape: {"image": {"url"}}, {"images": [{"url"}]}, {"panorama": ...}."""
    if isinstance(result, dict):
        for key in ("image", "panorama", "images", "output", "data"):
            if key in result:
                found = first_image_url(result[key])
                if found:
                    return found
        url = result.get("url")
        if isinstance(url, str) and url.startswith(("http://", "https://", "data:")):
            return url
        for value in result.values():
            found = first_image_url(value)
            if found:
                return found
    elif isinstance(result, list):
        for value in result:
            found = first_image_url(value)
            if found:
                return found
    return None


def make_fal_panorama(model: str | None = None, timeout: float = 300) -> Callable[[str, Path], bytes]:
    import fal_client  # reads FAL_KEY
    import httpx

    model = model or os.environ.get("FAL_PANORAMA_MODEL", DEFAULT_MODEL)

    def generate(room_name: str, photo: Path) -> bytes:
        image_url = fal_client.upload_file(str(photo))
        result = fal_client.subscribe(
            model,
            arguments={
                "image_url": image_url,
                "prompt": f"Seamless 360 degree panorama of this {room_name.lower()}, same style, furniture and lighting",
            },
            client_timeout=timeout,
        )
        url = first_image_url(result)
        if not url:
            keys = list(result) if isinstance(result, dict) else type(result).__name__
            raise RuntimeError(f"{model} returned no image (got {keys})")
        r = httpx.get(url, timeout=120, follow_redirects=True)
        r.raise_for_status()
        return r.content

    return generate


def image_extension(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return "jpg"


if __name__ == "__main__":
    if len(sys.argv) < 2 or not os.environ.get("FAL_KEY"):
        sys.exit('Usage: FAL_KEY=... python -m core.panorama photo.jpg ["Room name"]')
    photo = Path(sys.argv[1])
    name = sys.argv[2] if len(sys.argv) > 2 else "living room"
    print(f"Asking {os.environ.get('FAL_PANORAMA_MODEL', DEFAULT_MODEL)} for a panorama of {photo} …")
    data = make_fal_panorama()(name, photo)
    out = photo.with_name(f"{photo.stem}-360.{image_extension(data)}")
    out.write_bytes(data)
    try:
        from PIL import Image
        import io

        w, h = Image.open(io.BytesIO(data)).size
        print(f"Wrote {out} ({w} x {h}{', 2:1 as needed' if abs(w / h - 2) < 0.05 else ', NOT 2:1: the viewer needs 2:1'})")
    except Exception:
        print(f"Wrote {out}")
