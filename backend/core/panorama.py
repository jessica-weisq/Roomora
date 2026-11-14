"""Optional 360° view per room via fal's Hunyuan World (about $0.15 each). Used only when FAL_KEY is set.

The model sees one photo and invents the rest of the room, so the frontend labels these as an
AI-generated impression.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable


def make_fal_panorama() -> Callable[[str, Path], str]:
    import fal_client  # reads FAL_KEY

    def generate(room_name: str, photo: Path) -> str:
        image_url = fal_client.upload_file(str(photo))
        result = fal_client.subscribe(
            "fal-ai/hunyuan_world",
            arguments={
                "image_url": image_url,
                "prompt": f"Seamless 360 degree panorama of this {room_name.lower()}, same style, furniture and lighting",
            },
        )
        return result["image"]["url"]

    return generate
