"""Image clean-up: phone photos come rotated by EXIF tags, in HEIC, or far larger than we need."""

from __future__ import annotations

import io

from PIL import Image, ImageOps

try:  # HEIC/HEIF support (iPhone photos)
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover
    pass


def _open(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)  # apply the phone's rotation so "up" is up
    return img.convert("RGB")


def _jpeg(img: Image.Image, quality: int) -> bytes:
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=quality)
    return out.getvalue()


def normalize_photo(data: bytes, max_side: int = 2048) -> bytes:
    """Upright, RGB JPEG, at most `max_side` pixels on the long edge. This is what MASt3R reads."""
    img = _open(data)
    img.thumbnail((max_side, max_side))
    return _jpeg(img, 90)


def thumbnail(data: bytes, max_side: int = 768) -> bytes:
    """Small JPEG for the vision model, to keep the request small and fast."""
    img = _open(data)
    img.thumbnail((max_side, max_side))
    return _jpeg(img, 80)


def prepare_floor_plan(data: bytes, filename: str, content_type: str | None) -> tuple[bytes, str]:
    """Return (bytes, media type) the vision model accepts: PDFs as they are, images as a JPEG."""
    is_pdf = (content_type or "").lower() == "application/pdf" or filename.lower().endswith(".pdf") or data[:5] == b"%PDF-"
    if is_pdf:
        if len(data) > 30 * 1024 * 1024:
            raise ValueError("That PDF is over 30 MB. Please export the floor plan page on its own.")
        return data, "application/pdf"
    img = _open(data)
    img.thumbnail((1600, 1600))
    return _jpeg(img, 90), "image/jpeg"
