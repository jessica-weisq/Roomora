"""The HTTP API the frontend calls (contract: README.md and src/api/types.ts)."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Callable

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .images import normalize_photo, prepare_floor_plan, thumbnail
from .matching import VisionProviderError
from .storage import Store

log = logging.getLogger("photos-to-3d")

MatchFn = Callable[[bytes, str, list[tuple[str, bytes]]], dict[str, Any]]
MAX_PHOTOS = 60


class BuildRequest(BaseModel):
    projectId: str
    assignments: dict[str, str]


def _safe_id(value: str, fallback: str) -> str:
    v = re.sub(r"[^A-Za-z0-9_-]", "", value or "")[:80]
    return v or fallback


def create_app(store: Store, start_build: Callable[[str, str], None], match_fn: MatchFn) -> FastAPI:
    app = FastAPI(title="Photos + floor plan → 3D")
    # The frontend is served from another origin (localhost, Netlify), so allow cross-origin calls.
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    @app.post("/match")
    async def match(floorPlan: UploadFile = File(...), photos: list[UploadFile] = File(default=[])) -> dict:
        if len(photos) > MAX_PHOTOS:
            raise HTTPException(400, f"Please upload at most {MAX_PHOTOS} photos.")
        project_id = uuid.uuid4().hex[:12]
        project = store.project_dir(project_id)
        (project / "photos").mkdir(parents=True, exist_ok=True)

        try:
            plan_bytes, plan_mime = prepare_floor_plan(await floorPlan.read(), floorPlan.filename or "", floorPlan.content_type)
        except ValueError as e:
            raise HTTPException(400, str(e))
        except Exception:
            raise HTTPException(400, "Couldn't read the floor plan. Please upload a PDF, PNG or JPG.")
        (project / ("floor-plan.pdf" if plan_mime == "application/pdf" else "floor-plan.jpg")).write_bytes(plan_bytes)

        thumbs: list[tuple[str, bytes]] = []
        for i, photo in enumerate(photos):
            photo_id = _safe_id(photo.filename or "", f"photo-{i}")
            data = await photo.read()
            try:
                (project / "photos" / f"{photo_id}.jpg").write_bytes(normalize_photo(data))
                thumbs.append((photo_id, thumbnail(data)))
            except Exception:
                raise HTTPException(400, f"Couldn't read one of the photos ({photo.filename}). Please use JPG, PNG or HEIC.")

        try:
            result = match_fn(plan_bytes, plan_mime, thumbs)
        except VisionProviderError as e:
            # Provider configuration and availability errors aren't malformed uploads.
            raise HTTPException(503, str(e))
        except ValueError as e:
            raise HTTPException(422, str(e))
        except Exception:
            log.exception("Matching failed")
            raise HTTPException(502, "Couldn't analyse the floor plan and photos just now. Please try again.")

        store.write_json(project / "plan.json", result["plan"])
        store.write_json(project / "matches.json", result["matches"])
        store.commit()
        return {"projectId": project_id, **result}

    @app.post("/build")
    def build(req: BuildRequest) -> dict:
        project_id = _safe_id(req.projectId, "")
        store.reload()
        if not project_id or not (store.project_dir(project_id) / "plan.json").exists():
            raise HTTPException(404, "That project wasn't found. Please upload again.")
        job_id = uuid.uuid4().hex[:12]
        store.write_json(store.job_dir(job_id) / "assignments.json", req.assignments)
        store.commit()
        store.set_status(job_id, state="running", step=0, projectId=project_id)
        start_build(job_id, project_id)
        return {"jobId": job_id}

    @app.get("/build/{job_id}")
    def status(job_id: str, request: Request) -> dict:
        s = store.get_status(_safe_id(job_id, "-"))
        if not s:
            raise HTTPException(404, "Unknown build.")
        # Behind Modal's proxy the app may see plain http; browsers block http models on an https page.
        host = request.headers.get("host") or request.url.netloc
        local = host.startswith(("localhost", "127.0.0.1", "0.0.0.0"))
        scheme = request.headers.get("x-forwarded-proto") or ("http" if local else "https")
        base = f"{scheme}://{host}"
        out: dict[str, Any] = {"jobId": job_id, "state": s.get("state", "running"), "step": s.get("step", 0)}
        if s.get("model"):
            out["modelUrl"] = base + s["model"]
        if s.get("panoramas"):
            out["panoramas"] = s["panoramas"]
        if s.get("error"):
            out["error"] = s["error"]
        return out

    @app.get("/model/{job_id}.glb")
    def model(job_id: str) -> FileResponse:
        path = store.job_dir(_safe_id(job_id, "-")) / "model.glb"
        if not path.exists():
            store.reload()
        if not path.exists():
            raise HTTPException(404, "Model not found.")
        return FileResponse(path, media_type="model/gltf-binary", filename="model.glb")

    return app
