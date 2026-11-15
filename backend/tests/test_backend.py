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
    mesh = scan_mesh(fake_room_scan(4.0, 3.0, seed=seed), ROOM)
    assert mesh is not None and len(mesh.faces) > 1000
    lo, hi = mesh.bounds
    # Floor at y ≈ 0, walls up to ~2.4 m
    assert abs(lo[1]) < 0.15 and 2.2 < hi[1] < 2.6
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

    with pytest.raises(ValueError, match="busy"):
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
