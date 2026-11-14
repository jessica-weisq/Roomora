"""Bundle the tour into one self-contained preview.html (placeholder images, no local files)."""
import json, pathlib, re
root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text()
html = html.replace('<link rel="stylesheet" href="css/tour.css">', "<style>\n" + (root / "css/tour.css").read_text() + "\n</style>")
src = (root / "property.js").read_text()
prop = json.loads(src[src.index("=") + 1:].strip().rstrip(";"))
prop["__skipFiles"] = True
import base64, mimetypes
def data_uri(rel):
    f = root / rel
    if not rel or not f.exists():
        return None
    mime = mimetypes.guess_type(str(f))[0] or "image/jpeg"
    return "data:" + mime + ";base64," + base64.b64encode(f.read_bytes()).decode()
for fl in prop["floors"]:
    if fl.get("plan"):
        fl["plan"] = data_uri(fl["plan"])
if prop.get("exteriorPhoto"):
    prop["exteriorPhoto"] = data_uri(prop["exteriorPhoto"])
for f in prop.get("furnishing", []):
    if f.get("src"):
        f["src"] = data_uri(f["src"]) or f["src"]
for r in prop["rooms"]:
    for m in r["media"]:
        for pt in (m.get("fused") or {}).get("parts", []):
            pt["src"] = data_uri(pt["src"]) or pt["src"]
            pt["depth"] = data_uri(pt["depth"]) or pt["depth"]
        if m.get("depth"):
            m["depth"] = data_uri(m["depth"]) or m["depth"]
        uri = data_uri(m.get("src", ""))
        if uri:
            m["src"] = uri
        else:
            m["label"] = m.get("src", "")
def inline(m):
    src = m.group(1)
    if src.startswith("http"):
        return m.group(0)
    code = (root / src).read_text()
    if src == "property.js":
        return "<script>window.PROPERTY_INLINE = " + json.dumps(prop).replace("</", "<\\/") + ";</script>"
    if src == "js/media-data.js":
        return "<script>window.TOUR_MEDIA = {};</script>"
    if src == "config.js":
        code = 'window.TOUR_CONFIG = { googleMapsApiKey: "" };'
    return "<script>\n" + code.replace("</script", "<\\/script") + "\n</script>"
html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
(root / "preview.html").write_text(html)
print("wrote preview.html", len(html), "bytes")
