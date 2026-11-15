"""Run from the repo root: python -m pytest backend/tests -q"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import numpy as np
import pytest
import trimesh
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from core.assemble import build_glb, scan_mesh  # noqa: E402
from core.matching import DEMO_PLAN, demo_match, normalize  # noqa: E402
from synthetic import fake_room_scan  # noqa: E402

ROOM = {"id": "living", "name": "Living room", "x": 6.0, "y": 1.0, "width": 4.0, "depth": 3.0}


@pytest.mark.parametrize("seed", range(6))
def test_scan_lands_inside_its_room(seed):
    mesh = scan_mesh(fake_room_scan(4.0, 3.0, seed=seed, furniture=True), ROOM)
    assert mesh is not None and len(mesh.faces) > 1000
    lo, hi = mesh.bounds
    # Floor at y ≈ 0; the scan's walls are gone (the plan's walls stand in), the table is kept, at its height
    assert abs(lo[1]) < 0.15 and 0.65 < hi[1] < 0.85
    # Footprint matches the room rectangle (x 6–10, z 1–4) within a few cm, not rotated 90°
    assert abs(lo[0] - 6.0) < 0.2 and abs(hi[0] - 10.0) < 0.2
    assert abs(lo[2] - 1.0) < 0.2 and abs(hi[2] - 4.0) < 0.2


def test_oversized_scan_is_shrunk_to_fit():
    mesh = scan_mesh(fake_room_scan(8.0, 6.0, height=4.8, seed=1), ROOM)
    lo, hi = mesh.bounds
    assert hi[0] - lo[0] < 4.5 and hi[2] - lo[2] < 3.5


def test_glb_has_shell_and_scans():
    scans = {"living": fake_room_scan(6.0, 4.0), "bath": fake_room_scan(2.0, 3.0, seed=3)}
    glb, placed = build_glb(DEMO_PLAN, scans)
    assert sorted(placed) == ["bath", "living"]
    scene = trimesh.load(io.BytesIO(glb), file_type="glb")
    names = set(scene.graph.nodes_geometry)
    assert {"floor__living", "floor__bed2", "scan__living", "scan__bath"} <= names
    lo, hi = scene.bounds
    assert lo[0] > -0.3 and hi[0] < 10.3 and lo[2] > -0.3 and hi[2] < 7.3


def test_normalize_fixes_model_output():
    raw = {
        "plan": {"width_m": 0, "depth_m": 0, "rooms": [
            {"name": "Bedroom", "x_m": 0, "y_m": 0, "width_m": 3, "depth_m": 3},
            {"name": "Bedroom", "x_m": 3, "y_m": 0, "width_m": 3, "depth_m": 3},
            {"name": "Cupboard", "x_m": 0, "y_m": 0, "width_m": 0.1, "depth_m": 0.1},
        ]},
        "photos": [
            {"photo_index": 0, "room_name": "Bedroom", "confident": True},
            {"photo_index": 1, "room_name": "Nonexistent", "confident": True},
            {"photo_index": 5, "room_name": "Bedroom", "confident": True},
        ],
    }
    out = normalize(raw, ["a", "b", "c"])
    assert [r["id"] for r in out["plan"]["rooms"]] == ["bedroom", "bedroom-2"]
    assert out["plan"]["width"] == 6 and out["plan"]["depth"] == 3
    m = {x["photoId"]: x for x in out["matches"]}
    assert m["a"]["confident"] and m["a"]["roomId"] == "bedroom"
    assert not m["b"]["confident"] and m["b"]["roomId"] is None and m["b"]["reason"]
    assert not m["c"]["confident"]  # model skipped it


def test_normalize_forgives_room_name_spelling():
    raw = {
        "plan": {"rooms": [
            {"name": "Principal Bedroom", "x_m": 0, "y_m": 0, "width_m": 4, "depth_m": 4},
            {"name": "En suite (Principal Bedroom)", "x_m": 4, "y_m": 0, "width_m": 2, "depth_m": 2},
            {"name": "Bathroom 1", "x_m": 0, "y_m": 4, "width_m": 2, "depth_m": 2},
            {"name": "Bathroom 2", "x_m": 2, "y_m": 4, "width_m": 2, "depth_m": 2},
            {"name": "Utility room", "x_m": 4, "y_m": 4, "width_m": 2, "depth_m": 2},
        ]},
        "photos": [
            {"photo_index": 0, "room_name": "en-suite (principal bedroom)", "confident": True},
            {"photo_index": 1, "room_name": "Utility", "confident": True},
            {"photo_index": 2, "room_name": "Bathroom", "confident": True},  # two bathrooms: don't guess
        ],
    }
    m = {x["photoId"]: x for x in normalize(raw, ["a", "b", "c"])["matches"]}
    assert m["a"]["roomId"] == "en-suite-principal-bedroom" and m["a"]["confident"]
    assert m["b"]["roomId"] == "utility-room"
    assert m["c"]["roomId"] is None and not m["c"]["confident"]


def _jpeg(color, size=(320, 240)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()


def test_api_end_to_end(tmp_path):
    from fastapi.testclient import TestClient

    from core.api import create_app
    from core.jobs import run_build
    from core.storage import Store

    store = Store(tmp_path, {})
    recon_calls = []

    def reconstruct(paths):
        recon_calls.append(len(paths))
        return fake_room_scan(4.0, 3.0)

    app = create_app(store, lambda job, proj: run_build(store, job, proj, reconstruct), demo_match)
    client = TestClient(app)

    files = [("floorPlan", ("plan.png", _jpeg((255, 255, 255)), "image/png"))]
    files += [("photos", (f"photo-{i}", _jpeg((40 * i, 100, 150)), "image/jpeg")) for i in range(4)]
    r = client.post("/match", files=files)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["projectId"] and len(body["matches"]) == 4 and body["plan"]["rooms"]
    assert any(not m["confident"] for m in body["matches"])

    assignments = {m["photoId"]: (m["roomId"] or "skip") for m in body["matches"]}
    r = client.post("/build", json={"projectId": body["projectId"], "assignments": assignments})
    assert r.status_code == 200, r.text
    job = r.json()["jobId"]

    s = client.get(f"/build/{job}").json()
    assert s["state"] == "done" and s["step"] == 7, s
    assert s["modelUrl"].endswith(f"/model/{job}.glb")
    assert recon_calls  # MASt3R stand-in was called per room

    g = client.get(f"/model/{job}.glb")
    assert g.status_code == 200 and g.headers["content-type"] == "model/gltf-binary"
    scene = trimesh.load(io.BytesIO(g.content), file_type="glb")
    assert any(n.startswith("scan__") for n in scene.graph.nodes_geometry)

    assert client.post("/build", json={"projectId": "nope", "assignments": {}}).status_code == 404
    assert client.get("/build/unknown").status_code == 404


def test_api_reports_provider_configuration_without_leaking_details(tmp_path):
    from fastapi.testclient import TestClient

    from core.api import create_app
    from core.matching import VisionProviderError
    from core.storage import Store

    def unavailable(*_args):
        raise VisionProviderError("AI analysis is not configured. Please try again later.")

    client = TestClient(create_app(Store(tmp_path, {}), lambda *_: None, unavailable))
    response = client.post("/match", files=[("floorPlan", ("plan.png", _jpeg((255, 255, 255)), "image/png"))])
    assert response.status_code == 503
    assert response.json()["detail"] == "AI analysis is not configured. Please try again later."


def test_build_failure_is_reported(tmp_path):
    from core.jobs import run_build
    from core.storage import Store

    store = Store(tmp_path, {})
    run_build(store, "job1", "missing-project", None)
    s = store.get_status("job1")
    assert s["state"] == "failed" and "failed" in s["error"]


def test_matching_request_shape():
    """match_photos_claude builds one request with the plan, every photo and a forced tool call."""
    from core import matching

    sent = {}

    class FakeBlock:
        type = "tool_use"
        input = {"plan": {"width_m": 5, "depth_m": 4, "rooms": [{"name": "Kitchen", "x_m": 0, "y_m": 0, "width_m": 5, "depth_m": 4}]},
                 "photos": [{"photo_index": 0, "room_name": "Kitchen", "confident": True}]}

    class FakeClient:
        class messages:  # noqa: N801
            @staticmethod
            def create(**kw):
                sent.update(kw)
                return type("R", (), {"content": [FakeBlock()]})()

    out = matching.match_photos_claude(b"%PDF-1.4", "application/pdf", [("p1", _jpeg((1, 2, 3)))], client=FakeClient())
    assert out["matches"][0]["roomId"] == "kitchen"
    assert sent["tool_choice"] == {"type": "tool", "name": "report_layout"}
    kinds = [b["type"] for b in sent["messages"][0]["content"]]
    assert kinds.count("document") == 1 and kinds.count("image") == 1


def test_gemini_request_shape():
    """match_photos_gemini sends the plan and every photo, asks for JSON, and normalizes the reply."""
    import json as _json

    from core import matching

    sent = {}
    reply = {"plan": {"width_m": 8, "depth_m": 4, "rooms": [
                {"name": "Kitchen", "x_m": 0, "y_m": 0, "width_m": 4, "depth_m": 4},
                {"name": "Bedroom", "x_m": 4, "y_m": 0, "width_m": 4, "depth_m": 4}]},
             "photos": [{"photo_index": 0, "room_name": "Kitchen", "confident": True},
                        {"photo_index": 1, "room_name": "", "confident": False}]}

    class FakeModels:
        @staticmethod
        def generate_content(**kw):
            sent.update(kw)
            return type("R", (), {"text": _json.dumps(reply)})()

    class FakeClient:
        models = FakeModels()

    photos = [("p1", _jpeg((1, 2, 3))), ("p2", _jpeg((4, 5, 6)))]
    out = matching.match_photos_gemini(b"%PDF-1.4", "application/pdf", photos, client=FakeClient())

    mimes = [p.inline_data.mime_type for p in sent["contents"] if p.inline_data]
    assert mimes == ["application/pdf", "image/jpeg", "image/jpeg"]
    assert sent["config"].response_mime_type == "application/json"
    assert sent["config"].thinking_config.thinking_level.value == "LOW"
    res = [p.media_resolution.level.value for p in sent["contents"] if p.inline_data]
    assert res == ["MEDIA_RESOLUTION_HIGH", "MEDIA_RESOLUTION_LOW", "MEDIA_RESOLUTION_LOW"]
    room_name = sent["config"].response_json_schema["properties"]["photos"]["items"]["properties"]["room_name"]
    assert room_name["type"] == "string"
    assert out["matches"][0] == {"photoId": "p1", "roomId": "kitchen", "confident": True}
    assert out["matches"][1]["roomId"] is None and "doesn't look like a room" in out["matches"][1]["reason"]


def test_gemini_rate_limit_is_friendly():
    import pytest

    from core import matching

    class FakeModels:
        @staticmethod
        def generate_content(**kw):
            raise RuntimeError("429 RESOURCE_EXHAUSTED")

    class FakeClient:
        models = FakeModels()

    with pytest.raises(matching.VisionProviderError, match="busy"):
        matching.match_photos_gemini(b"x", "image/png", [("p1", _jpeg((1, 2, 3)))], client=FakeClient())


def test_provider_choice(monkeypatch):
    from core import matching

    for k in ("MATCH_PROVIDER", "GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    assert matching.provider() is None
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a")
    assert matching.provider() == "claude"
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    assert matching.provider() == "gemini"
    monkeypatch.setenv("MATCH_PROVIDER", "claude")
    assert matching.provider() == "claude"


# ---------------------------------------------------------------------------
# /furnish (the walk-through's "Furnish from photos")
from core.furnish import ITEM_TYPES, demo_furnish  # noqa: E402
from core.furnish import normalize as normalize_furniture  # noqa: E402


def test_furniture_normalize_drops_bad_items():
    raw = {"floor": "marble", "items": [
        {"type": "sofa", "x": 1.4, "y": -0.2, "faces": "sideways", "len": 2.4, "color": "#abcdef", "accent": ["#123456", "red"]},
        {"type": "spaceship", "x": 0.5, "y": 0.5, "faces": "up"},
        {"type": "bed", "x": "middle", "y": 0.5, "faces": "up"},
    ]}
    out = normalize_furniture(raw)
    assert out["floor"] is None
    assert len(out["items"]) == 1
    sofa = out["items"][0]
    assert (sofa["x"], sofa["y"], sofa["faces"]) == (1.0, 0.0, "down")
    assert sofa["len"] == 2.4 and sofa["color"] == "#abcdef" and sofa["accent"] == ["#123456"]


def test_furniture_types_match_the_walkthrough():
    # Every type the backend may return must be one the walk-through can draw (public/tour/js/furnish2.js).
    js = (Path(__file__).resolve().parents[2] / "public" / "tour" / "js" / "furnish2.js").read_text()
    for t in ITEM_TYPES:
        assert f"      {t}(g" in js, t


def _jpeg(color=(200, 180, 160)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(buf, "JPEG")
    return buf.getvalue()


def test_furnish_endpoint(tmp_path):
    from fastapi.testclient import TestClient

    from core.api import create_app
    from core.storage import Store

    calls = []

    def fake_furnish(photos, name, width, depth):
        calls.append((len(photos), name, width, depth))
        return demo_furnish(photos, name, width, depth)

    store = Store(tmp_path, {})
    client = TestClient(create_app(store, lambda job, project: None, demo_match, fake_furnish))
    res = client.post("/match", files=[("floorPlan", ("plan.png", _jpeg((255, 255, 255)), "image/png")),
                                        ("photos", ("p1", _jpeg(), "image/jpeg")), ("photos", ("p2", _jpeg(), "image/jpeg"))])
    assert res.status_code == 200, res.text
    pid = res.json()["projectId"]

    body = {"projectId": pid, "roomId": "bed1", "photoIds": ["p1", "p2"]}
    first = client.post("/furnish", json=body)
    assert first.status_code == 200, first.text
    assert first.json()["items"][0]["type"] == "bed"
    assert calls == [(2, "Bedroom 1", 5.0, 3.0)]
    # Same photos again: answered from the saved result, no second AI call
    assert client.post("/furnish", json=body).json() == first.json()
    assert len(calls) == 1

    assert client.post("/furnish", json={**body, "roomId": "attic"}).status_code == 404
    assert client.post("/furnish", json={**body, "photoIds": ["nope"]}).status_code == 400
    assert client.post("/furnish", json={**body, "projectId": "missing"}).status_code == 404

    no_ai = TestClient(create_app(store, lambda job, project: None, demo_match))
    assert no_ai.post("/furnish", json=body).status_code == 501


# ---------------------------------------------------------------------------
# Generalising the walk-through: north from the plan, wall colour from the photos
from core.matching import normalize as normalize_layout  # noqa: E402


def _layout(**plan_extra):
    plan = {"width_m": 8, "depth_m": 6, "rooms": [{"name": "Living room", "x_m": 0, "y_m": 0, "width_m": 5, "depth_m": 4}], **plan_extra}
    return normalize_layout({"plan": plan, "photos": []}, [])


def test_north_from_arrow():
    assert "north" not in _layout()["plan"]                       # no arrow: no guess
    assert _layout(north_arrow_deg=0)["plan"]["north"] == 0        # arrow up: up is north
    assert _layout(north_arrow_deg=90)["plan"]["north"] == 270     # arrow right: up is west
    assert _layout(north_arrow_deg=-45)["plan"]["north"] == 45     # arrow up-left: up is north-east
    assert "north" not in _layout(north_arrow_deg="north")["plan"]


def test_wall_colour_from_photos():
    assert normalize_furniture({"floor": "oak", "walls": "#D9D4C7", "items": []})["walls"] == "#d9d4c7"
    assert normalize_furniture({"floor": "oak", "walls": "beige", "items": []})["walls"] is None
    assert normalize_furniture({"floor": "oak", "items": []})["walls"] is None
    assert demo_furnish([b""], "Bedroom 1", 4, 3)["walls"].startswith("#")


def test_art_from_photos():
    raw = {"floor": "oak", "items": [], "art": [
        {"photo": 2, "box_2d": [100, 200, 500, 600], "wall": "left", "at": 0.3, "w": 0.6, "h": 0.8},
        {"photo": 0, "box_2d": [100, 200, 500, 600], "wall": "left", "at": 0.3},      # no such photo
        {"photo": 1, "box_2d": [100, 200, 110, 600], "wall": "up", "at": 0.5},        # too thin
        {"photo": 1, "box_2d": [100, 200, 500, 600], "wall": "ceiling", "at": 0.5},   # not a wall
        {"photo": 1, "box_2d": "big", "wall": "up", "at": 0.5},
    ]}
    art = normalize_furniture(raw)["art"]
    assert art == [{"photo": 2, "box": [0.2, 0.1, 0.6, 0.5], "wall": "left", "at": 0.3, "w": 0.6, "h": 0.8}]
    assert normalize_furniture({"floor": "oak", "items": []})["art"] == []
    assert len(demo_furnish([b""], "Living room", 5, 4)["art"]) == 1


def test_depth_endpoint(tmp_path):
    from fastapi.testclient import TestClient
    from core.api import create_app
    from core.depth import pack
    from core.storage import Store
    import numpy as np

    store = Store(tmp_path, {})
    (store.project_dir("p1") / "photos").mkdir(parents=True)
    (store.project_dir("p1") / "photos" / "a.jpg").write_bytes(b"jpeg")
    calls = []

    def fake_depth(jpeg):
        calls.append(jpeg)
        return pack(np.linspace(0, 1, 64).reshape(8, 8), 800, 600)

    client = TestClient(create_app(store, lambda j, p: None, demo_match, None, fake_depth))
    r = client.get("/depth/p1/a.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content[:4] == b"\x89PNG"
    assert client.get("/depth/p1/a.png").content == r.content and len(calls) == 1      # cached
    assert client.get("/depth/p1/missing.png").status_code == 404
    from PIL import Image
    import io
    im = Image.open(io.BytesIO(r.content))
    assert im.size == (384, 288)
    no_depth = TestClient(create_app(store, lambda j, p: None, demo_match))
    assert no_depth.get("/depth/p1/a.png").status_code == 501


def test_rooms_placed_from_boxes():
    # Two rooms side by side on a drawing 10 m wide and 8 m deep, plus an en suite inside the bedroom's corner.
    # The model's own metre positions are wrong (as they often are); the boxes and written sizes win.
    raw = {"plan": {"width_m": 10, "depth_m": 8, "rooms": [
        {"name": "Living room", "box_2d": [0, 0, 500, 600], "width_m": 6, "depth_m": 4, "x_m": 3, "y_m": 2},
        {"name": "Bedroom", "box_2d": [0, 600, 500, 1000], "width_m": 4, "depth_m": 4.4},       # one misread size
        {"name": "En suite", "box_2d": [500, 800, 750, 1000], "width_m": 2, "depth_m": 2},
        {"name": "Hall", "box_2d": [500, 0, 1000, 800], "width_m": 8, "depth_m": 4},
    ]}, "photos": []}
    rooms = {r["name"]: r for r in normalize_layout(raw, [])["plan"]["rooms"]}
    assert rooms["Living room"]["x"] == 0 and rooms["Living room"]["width"] == 6
    assert rooms["Bedroom"]["x"] == 6 and rooms["Bedroom"]["width"] == 4 and rooms["Bedroom"]["depth"] == 4   # median scale
    assert (rooms["En suite"]["x"], rooms["En suite"]["y"], rooms["En suite"]["width"], rooms["En suite"]["depth"]) == (8, 4, 2, 2)
    assert rooms["En suite"]["box"] == [0.8, 0.5, 1.0, 0.75]
    # without boxes, the metre positions are used as before
    old = normalize_layout({"plan": {"width_m": 5, "depth_m": 4, "rooms": [{"name": "Kitchen", "x_m": 1, "y_m": 0, "width_m": 3, "depth_m": 4}]}, "photos": []}, [])
    assert old["plan"]["rooms"][0]["x"] == 1 and "box" not in old["plan"]["rooms"][0]


def test_fal_result_shapes():
    from core.panorama import first_image_url, image_extension
    assert first_image_url({"image": {"url": "https://fal.media/a.jpg", "width": 1920}}) == "https://fal.media/a.jpg"
    assert first_image_url({"images": [{"url": "https://fal.media/b.png"}], "seed": 3}) == "https://fal.media/b.png"
    assert first_image_url({"panorama": {"url": "https://fal.media/c.webp"}}) == "https://fal.media/c.webp"
    assert first_image_url({"world": {"preview": {"url": "https://fal.media/d.jpg"}}}) == "https://fal.media/d.jpg"
    assert first_image_url({"seed": 3}) is None
    assert image_extension(b"\x89PNG\r\n\x1a\n....") == "png" and image_extension(b"\xff\xd8\xff") == "jpg"


def test_panoramas_are_kept_with_the_build(tmp_path):
    from fastapi.testclient import TestClient
    from core.api import create_app
    from core.jobs import run_build
    from core.storage import Store

    png = b"\x89PNG\r\n\x1a\n" + b"x" * 100
    calls = []

    def fake_fal(room_name, photo):
        calls.append(room_name)
        if "fail" in room_name.lower():
            raise RuntimeError("fal said no")
        return png

    store = Store(tmp_path, {})
    app = create_app(store, lambda job, proj: run_build(store, job, proj, None, fake_fal), demo_match)
    client = TestClient(app)
    files = [("floorPlan", ("plan.png", _jpeg((255, 255, 255)), "image/png"))]
    files += [("photos", (f"photo-{i}", _jpeg((40 * i, 100, 150)), "image/jpeg")) for i in range(3)]
    body = client.post("/match", files=files).json()
    assignments = {m["photoId"]: (m["roomId"] or "skip") for m in body["matches"]}
    job = client.post("/build", json={"projectId": body["projectId"], "assignments": assignments}).json()["jobId"]
    s = client.get(f"/build/{job}").json()
    assert s["state"] == "done" and len(calls) == len(set(assignments.values()) - {"skip"})
    assert s["panoramas"] and all(u.startswith("http") and f"/panorama/{job}/" in u for u in s["panoramas"].values())
    one = next(iter(s["panoramas"].values()))
    r = client.get(one[one.index("/panorama/"):])
    assert r.status_code == 200 and r.content == png and r.headers["content-type"] == "image/png"
    assert client.get(f"/panorama/{job}/../model.png").status_code == 404


def test_panoramas_run_alongside_reconstruction(tmp_path):
    """The 360° views start before the slow 3D part, not after it."""
    import threading

    from core.jobs import run_build
    from core.storage import Store

    store = Store(tmp_path, {})
    project = store.project_dir("p1")
    (project / "photos").mkdir(parents=True)
    (project / "photos" / "a.jpg").write_bytes(_jpeg((200, 50, 50)))
    store.write_json(project / "plan.json", DEMO_PLAN)
    room = DEMO_PLAN["rooms"][0]["id"]
    store.job_dir("j1").mkdir(parents=True)
    store.write_json(store.job_dir("j1") / "assignments.json", {"a": room})

    pano_started = threading.Event()
    seen_during_reconstruction = []

    def fake_panorama(name, photo):
        pano_started.set()
        return "https://example.com/pano.jpg"

    def fake_reconstruct(paths):
        seen_during_reconstruction.append(pano_started.wait(timeout=5))
        return None

    run_build(store, "j1", "p1", fake_reconstruct, fake_panorama)
    assert seen_during_reconstruction == [True]
    status = store.get_status("j1")
    assert status["state"] == "done" and status["panoramas"] == {room: "https://example.com/pano.jpg"}


def test_reimagine_endpoint(tmp_path):
    import base64
    from fastapi.testclient import TestClient
    from core.api import create_app
    from core.reimagine import prompt_for
    from core.storage import Store

    store = Store(tmp_path, {})
    seen = {}

    def fake_fal(render, photo, room, notes):
        seen.update(render=render[:3], photo=photo[:3] if photo else None, room=room, notes=notes)
        return _jpeg((10, 200, 30))

    url = lambda b: "data:image/jpeg;base64," + base64.b64encode(b).decode()  # noqa: E731
    client = TestClient(create_app(store, lambda j, p: None, demo_match, None, None, fake_fal))
    r = client.post("/reimagine", json={"render": url(_jpeg((200, 200, 200))), "photo": url(_jpeg((90, 80, 70))), "roomName": "Bedroom 2"})
    assert r.status_code == 200, r.text
    assert seen["render"] == b"\xff\xd8\xff" and seen["photo"] == b"\xff\xd8\xff" and seen["room"] == "Bedroom 2"
    img = r.json()["imageUrl"]
    got = client.get(img[img.index("/reimagined/"):])
    assert got.status_code == 200 and got.headers["content-type"] == "image/jpeg" and got.content[:3] == b"\xff\xd8\xff"
    # without a photo it still works; bad input and no fal are refused clearly
    assert client.post("/reimagine", json={"render": url(_jpeg((1, 2, 3)))}).status_code == 200 and seen["photo"] is None
    assert client.post("/reimagine", json={"render": "https://example.com/x.jpg"}).status_code == 400
    assert client.post("/reimagine", json={"render": "data:image/png;base64,bm90IGFuIGltYWdl"}).status_code == 400
    assert client.get("/reimagined/../../etc.jpg").status_code == 404
    assert TestClient(create_app(store, lambda j, p: None, demo_match)).post("/reimagine", json={"render": url(_jpeg((1, 2, 3)))}).status_code == 501
    # the prompt keeps the real room from the photo and the design from the mock-up
    p = prompt_for("Bedroom 2", True)
    assert "first image is a real photograph" in p and "mock-up" in p and "bedroom 2" in p


def test_rooms_are_joined_at_shared_walls():
    from core.plan_tidy import tidy
    # boxes just inside the walls: a living room, and a bathroom below it a wall's thickness away and a bit off
    plan = {"width": 8, "depth": 7, "rooms": [
        {"id": "living", "name": "Living", "x": 0.1, "y": 0.1, "width": 5.8, "depth": 3.8},
        {"id": "bath", "name": "Bath", "x": 0.18, "y": 4.12, "width": 2.0, "depth": 2.0},
        {"id": "bed", "name": "Bed", "x": 6.12, "y": 0.08, "width": 1.9, "depth": 3.85},
    ]}
    t = {r["id"]: r for r in tidy(plan)["rooms"]}
    assert abs(t["living"]["y"] + t["living"]["depth"] - t["bath"]["y"]) < 1e-6        # living and bath share a wall
    assert abs(t["living"]["x"] + t["living"]["width"] - t["bed"]["x"]) < 1e-6         # living and bed share a wall
    assert t["living"]["x"] == t["bath"]["x"] == 0 and t["living"]["y"] == t["bed"]["y"] == 0   # fronts lined up
    # rooms far apart stay apart, and nothing shrinks to nothing
    far = tidy({"width": 20, "depth": 5, "rooms": [{"id": "a", "name": "A", "x": 0, "y": 0, "width": 3, "depth": 3},
                                                     {"id": "b", "name": "B", "x": 10, "y": 0, "width": 3, "depth": 3}]})
    assert far["rooms"][1]["x"] == 10
    # an en suite inside a bedroom's box isn't merged into it
    ens = tidy({"width": 5, "depth": 4, "rooms": [{"id": "bed", "name": "Bed", "x": 0, "y": 0, "width": 5, "depth": 4},
                                                    {"id": "ens", "name": "En suite", "x": 3.5, "y": 0, "width": 1.5, "depth": 2}]})
    assert {r["id"]: r["width"] for r in ens["rooms"]} == {"bed": 5, "ens": 1.5}


def test_scans_are_a_dollhouse():
    from core.assemble import SCAN_CUT_H, scan_mesh
    room = {"id": "r", "name": "Room", "x": 1.0, "y": 1.0, "width": 4.0, "depth": 3.0}
    mesh = scan_mesh(fake_room_scan(4.0, 3.0, height=2.7, furniture=True), room)
    assert mesh is not None
    v = mesh.vertices[np.unique(mesh.faces)]
    assert (v[:, 1] > 0.6).sum() > 100                              # the table survived
    assert v[:, 1].max() <= SCAN_CUT_H + 1e-6                       # no lid
    assert v[:, 0].min() >= 1.0 and v[:, 0].max() <= 5.0            # nothing outside the room
    assert v[:, 2].min() >= 1.0 and v[:, 2].max() <= 4.0


def test_fixtures_from_the_plan():
    raw = {"plan": {"rooms": [
        {"name": "Studio", "box_2d": [0, 0, 600, 1000], "width_m": 6, "depth_m": 4.5},
        {"name": "Bathroom", "box_2d": [650, 200, 900, 600], "width_m": 2.4, "depth_m": 1.9},
        {"name": "Entrance hall", "box_2d": [650, 620, 900, 800], "width_m": 1.08, "depth_m": 1.9},
    ], "fixtures": [
        {"type": "kitchen_run", "room": "Studio", "box_2d": [520, 0, 600, 500]},
        {"type": "shower", "room": "Bathroom", "box_2d": [650, 200, 900, 330]},
        {"type": "wc", "room": "bathroom", "box_2d": [800, 520, 900, 600]},
        {"type": "jacuzzi", "room": "Bathroom", "box_2d": [650, 200, 900, 330]},     # not a type we know
        {"type": "basin", "room": "Bathroom", "box_2d": "here"},                       # no box
    ]}, "photos": []}
    plan = normalize_layout(raw, [])["plan"]
    fx = plan["fixtures"]
    assert [f["type"] for f in fx] == ["kitchen_run", "shower", "wc"]
    ids = {r["name"]: r["id"] for r in plan["rooms"]}
    assert fx[1]["room"] == ids["Bathroom"] and fx[2]["room"] == ids["Bathroom"]
    shower = fx[1]; bath = next(r for r in plan["rooms"] if r["name"] == "Bathroom")
    # same frame as the rooms: the shower is inside the bathroom, in its left-hand end
    assert bath["x"] - 0.05 <= shower["x"] and shower["x"] + shower["width"] <= bath["x"] + bath["width"] + 0.05
    assert bath["y"] - 0.05 <= shower["y"] and shower["y"] + shower["depth"] <= bath["y"] + bath["depth"] + 0.05
    assert shower["x"] - bath["x"] < 0.1
    assert "Entrance hall" in ids
