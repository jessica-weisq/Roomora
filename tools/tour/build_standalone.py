"""Bundle the tour into ONE self-contained HTML file you can double-click: every script and stylesheet,
three.js, and the sample flat's photos, depth maps and floor plan are put inside it.

    python3 tools/tour/build_standalone.py                 # writes veduta-tour.html in the current folder
    python3 tools/tour/build_standalone.py out/tour.html

Works offline except the web fonts (it falls back to system fonts), Street View and Reimagine with Fal,
which need the settings at the top of the file (a Google Maps key; the backend's address).
"""

from __future__ import annotations

import base64
import json
import mimetypes
import re
import sys
import urllib.request
from pathlib import Path

TOUR = Path(__file__).resolve().parents[2] / "public" / "tour"
THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"
THREE_CACHE = Path(__file__).resolve().parent / ".three-r128.min.js"

SETTINGS = """<script>
/* ---- Settings: edit these two lines, save, reload ----
   MAPS_API_KEY: a Google Maps browser key (Maps JavaScript + Street View Static + Geocoding), for the Street view
                 and the real view out of the windows. Google only allows it on a web address, not a file opened
                 from your disk, so for those run a local server in this folder:  python3 -m http.server 8000
   API_URL:      the Veduta backend (e.g. "http://localhost:8000/api" or your Modal URL), for Reimagine with Fal. */
window.TOUR_CONFIG = {
  MAPS_API_KEY: "",
  API_URL: "",
};
</script>"""


def data_uri(path: Path) -> str | None:
    if not path.is_file():
        return None
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def three_js() -> str:
    if not THREE_CACHE.exists():
        print("Downloading three.js r128 (once) …")
        THREE_CACHE.write_bytes(urllib.request.urlopen(THREE_URL, timeout=60).read())
    return THREE_CACHE.read_text()


def inline_property() -> str:
    src = (TOUR / "property.js").read_text()
    prop = json.loads(src[src.index("=") + 1:].strip().rstrip(";"))
    missing: list[str] = []

    def walk(o):
        if isinstance(o, dict):
            return {k: walk(v) for k, v in o.items()}
        if isinstance(o, list):
            return [walk(v) for v in o]
        if isinstance(o, str) and re.match(r"^(img|exterior)/[\w./-]+\.(jpe?g|png|webp|svg|gif)$", o, re.I):
            uri = data_uri(TOUR / o)
            if uri:
                return uri
            missing.append(o)   # the tour draws a placeholder for photos that aren't there
        return o

    prop = walk(prop)
    if missing:
        print(f"Not found (placeholders will show): {', '.join(sorted(set(missing)))}")
    return "window.PROPERTY_INLINE = " + json.dumps(prop, separators=(",", ":")) + ";"


def safe(code: str) -> str:
    return code.replace("</script", "<\\/script")


def build(out: Path) -> None:
    html = (TOUR / "index.html").read_text()
    strip_v = lambda s: re.sub(r"\?v=[\w.-]+$", "", s)  # noqa: E731

    def style(m):
        return "<style>\n" + (TOUR / strip_v(m.group(1))).read_text() + "\n</style>"

    html = re.sub(r'<link rel="stylesheet" href="((?:css|exterior)/[^"]+)">', style, html)

    def script(m):
        kind, src = m.group(1) or "", m.group(2)
        if src.startswith("http"):
            return "<script>\n" + safe(three_js()) + "\n</script>" if "three" in src else m.group(0)
        path = strip_v(src)
        if path == "config.js":
            return SETTINGS
        if path == "property.js":
            return "<script>\n" + safe(inline_property()) + "\n</script>"
        return f"<script{kind}>\n" + safe((TOUR / path).read_text()) + "\n</script>"

    html = re.sub(r'<script( type="module")? src="([^"]+)"></script>', script, html)
    html = html.replace("<title>House tour</title>", "<title>Veduta tour</title>")
    out.write_text(html)
    print(f"Wrote {out} ({out.stat().st_size / 1e6:.1f} MB). Double-click it to open.")


if __name__ == "__main__":
    build(Path(sys.argv[1]) if len(sys.argv) > 1 else Path("veduta-tour.html"))
