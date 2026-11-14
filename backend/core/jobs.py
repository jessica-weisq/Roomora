"""The build pipeline: group photos by room → MASt3R per room → place on the plan → .glb (→ 360° views).

`step` values match BUILD_STEPS in the frontend (src/api/types.ts):
  0 reading plan · 1 finding rooms · 2 placing photos · 3 walls and floors · 4 textures · 5 360° views · 6 final checks
"""

from __future__ import annotations

import logging
import traceback
from pathlib import Path
from typing import Callable, Optional

from .assemble import RoomScan, build_glb
from .storage import Store

log = logging.getLogger("photos-to-3d")

Reconstruct = Callable[[list[Path]], Optional[RoomScan]]
Panorama = Callable[[str, Path], str]


def run_build(store: Store, job_id: str, project_id: str, reconstruct: Reconstruct | None,
              panorama: Panorama | None = None) -> None:
    try:
        store.reload()
        project = store.project_dir(project_id)
        plan = store.read_json(project / "plan.json")
        assignments: dict[str, str] = store.read_json(store.job_dir(job_id) / "assignments.json")
        store.set_status(job_id, step=1)

        # 2. group photos by room
        rooms = {r["id"]: r for r in plan["rooms"]}
        by_room: dict[str, list[Path]] = {}
        for photo_id, room_id in assignments.items():
            path = project / "photos" / f"{photo_id}.jpg"
            if room_id in rooms and path.exists():
                by_room.setdefault(room_id, []).append(path)
        store.set_status(job_id, step=2)

        # 3. reconstruct each room (the slow part)
        store.set_status(job_id, step=3)
        scans: dict[str, RoomScan] = {}
        if reconstruct:
            for room_id, paths in by_room.items():
                try:
                    scan = reconstruct(sorted(paths))
                    if scan is not None:
                        scans[room_id] = scan
                except Exception:  # one bad room shouldn't sink the whole model
                    log.exception("Reconstruction failed for room %s", room_id)

        # 4. place scans on the plan and export
        store.set_status(job_id, step=4)
        glb, placed = build_glb(plan, scans)
        out = store.job_dir(job_id)
        out.mkdir(parents=True, exist_ok=True)
        (out / "model.glb").write_bytes(glb)
        store.commit()

        # 5. optional 360° views
        store.set_status(job_id, step=5)
        panoramas: dict[str, str] = {}
        if panorama:
            for room_id, paths in by_room.items():
                try:
                    panoramas[room_id] = panorama(rooms[room_id]["name"], sorted(paths)[0])
                except Exception:
                    log.exception("Panorama failed for room %s", room_id)

        store.set_status(job_id, step=6)
        store.set_status(job_id, state="done", step=7, model=f"/model/{job_id}.glb",
                         panoramas=panoramas, scannedRooms=placed)
    except Exception as e:
        log.error("Build %s failed:\n%s", job_id, traceback.format_exc())
        store.set_status(job_id, state="failed", error=f"The build failed: {e}")
