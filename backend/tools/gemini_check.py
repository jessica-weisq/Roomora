"""Time the Gemini API on its own, to see whether slowness is the API/free tier or our request.

    GEMINI_API_KEY=... python backend/tools/gemini_check.py [floor-plan file] [photo ...]

With no files it sends a one-line text prompt. Prints the models this key can use, too.
"""

import mimetypes
import os
import sys
import time

from google import genai
from google.genai import types

client = genai.Client(http_options=types.HttpOptions(timeout=180_000, retry_options=types.HttpRetryOptions(attempts=1)))
model = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")

print("Flash models this key can use:")
for m in client.models.list():
    if "flash" in m.name:
        print("  ", m.name.removeprefix("models/"))


def timed(label, contents, **cfg):
    t = time.monotonic()
    try:
        r = client.models.generate_content(model=model, contents=contents, config=types.GenerateContentConfig(**cfg))
        print(f"{label}: {time.monotonic() - t:.1f}s  ->  {(r.text or '')[:80]!r}")
    except Exception as e:
        print(f"{label}: failed after {time.monotonic() - t:.1f}s  ->  {str(e)[:200]}")


low = types.ThinkingConfig(thinking_level="LOW")
timed("1. one-line text", "Reply with just the word hi.", thinking_config=low)

files = sys.argv[1:]
if files:
    def part(path, level):
        mime = mimetypes.guess_type(path)[0] or "image/jpeg"
        data = open(path, "rb").read()
        print(f"   {os.path.basename(path)}: {len(data) / 1e6:.1f} MB, {mime}")
        return types.Part.from_bytes(data=data, mime_type=mime, media_resolution={"level": level})

    plan = part(files[0], "MEDIA_RESOLUTION_HIGH")
    timed("2. floor plan only", [plan, "List the room names on this floor plan, comma separated."], thinking_config=low)
    if len(files) > 1:
        photos = [part(f, "MEDIA_RESOLUTION_LOW") for f in files[1:]]
        timed("3. photos only", [*photos, "Say which kind of room each photo shows, one per line."], thinking_config=low)
