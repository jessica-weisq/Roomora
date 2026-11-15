"""The build pipeline: group photos by room → MASt3R per room → place on the plan → .glb (→ 360° views).

`step` values match BUILD_STEPS in the frontend (src/api/types.ts):
  0 reading plan · 1 finding rooms · 2 placing photos · 3 walls and floors · 4 textures · 5 360° views · 6 final checks
"""

from __future__ import annotations

import logging
import time
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Optional

from .assemble import RoomScan, build_glb
from .storage import Store

log = logging.getLogger("photos-to-3d")

Reconstruct = Callable[[list[Path]], Optional[RoomScan]]
# (room name, photo) -> the panorama image (bytes), or a URL to it
Panorama = Callable[[str, Path], "bytes | str"]


def _say(msg: str) -> None:
    """A line in the Modal logs (print, like matching's timing, so it shows without logging set up)."""
    print(msg, flush=True)


def run_build(store: Store, job_id: str, project_id: str, reconstruct: Reconstruct | None,
              panorama: Panorama | None = None) -> None:
    started = time.monotonic()
    pool: ThreadPoolExecutor | None = None
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

        # 5 (started now). 360° views: each is a wait on fal, not work here, so they run alongside the
        # reconstruction instead of after it. Results are collected once the model is saved.
        pano_futures: dict[str, Future] = {}
        if panorama and by_room:
            def one(room_id: str) -> "bytes | str | None":
                t = time.monotonic()
                try:
                    result = panorama(rooms[room_id]["name"], sorted(by_room[room_id])[0])
                    _say(f"[{job_id}] panorama {room_id}: {time.monotonic() - t:.1f}s")
                    return result
                except Exception:
                    log.exception("Panorama failed for room %s", room_id)
                    _say(f"[{job_id}] panorama {room_id}: failed after {time.monotonic() - t:.1f}s")
                    return None

            pool = ThreadPoolExecutor(max_workers=min(4, len(by_room)))
            pano_futures = {room_id: pool.submit(one, room_id) for room_id in by_room}

        # 3. reconstruct each room (the slow part)
        store.set_status(job_id, step=3)
        scans: dict[str, RoomScan] = {}
        if reconstruct:
            t3 = time.monotonic()
            for room_id, paths in by_room.items():
                t = time.monotonic()
                try:
                    scan = reconstruct(sorted(paths))
                    if scan is not None:
                        scans[room_id] = scan
                    _say(f"[{job_id}] reconstruct {room_id} ({len(paths)} photos): {time.monotonic() - t:.1f}s")
                except Exception:  # one bad room shouldn't sink the whole model
                    log.exception("Reconstruction failed for room %s", room_id)
                    _say(f"[{job_id}] reconstruct {room_id}: failed after {time.monotonic() - t:.1f}s")
            _say(f"[{job_id}] reconstruction, {len(by_room)} rooms: {time.monotonic() - t3:.1f}s")

        # 4. place scans on the plan and export
        store.set_status(job_id, step=4)
        t = time.monotonic()
        glb, placed = build_glb(plan, scans)
        out = store.job_dir(job_id)
        out.mkdir(parents=True, exist_ok=True)
        (out / "model.glb").write_bytes(glb)
        store.commit()
        _say(f"[{job_id}] assemble and save model ({len(glb) / 1e6:.1f} MB): {time.monotonic() - t:.1f}s")

        # 5. collect the 360° views
        store.set_status(job_id, step=5)
        panoramas: dict[str, str] = {}
        if pano_futures:
            from .panorama import image_extension

            t = time.monotonic()
            for room_id, future in pano_futures.items():
                result = future.result()
                if isinstance(result, str):
                    panoramas[room_id] = result
                elif result:   # keep the image with the build: fal's links don't last
                    name = f"{room_id}.{image_extension(result)}"
                    (out / "panoramas").mkdir(exist_ok=True)
                    (out / "panoramas" / name).write_bytes(result)
                    panoramas[room_id] = f"/panorama/{job_id}/{name}"
            store.commit()
            _say(f"[{job_id}] waited {time.monotonic() - t:.1f}s for 360° views after the model was saved")

        store.set_status(job_id, step=6)
        store.set_status(job_id, state="done", step=7, model=f"/model/{job_id}.glb",
                         panoramas=panoramas, scannedRooms=placed)
        _say(f"[{job_id}] build done in {time.monotonic() - started:.1f}s")
    except Exception as e:
        log.error("Build %s failed:\n%s", job_id, traceback.format_exc())
        store.set_status(job_id, state="failed", error=f"The build failed: {e}")
    finally:
        if pool:  # on failure, don't wait for (or start) panoramas nobody will see
            pool.shutdown(wait=False, cancel_futures=True)
