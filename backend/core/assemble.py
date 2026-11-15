"""Put each room's MASt3R scan in its place on the floor plan and export one .glb.

Output coordinates match the frontend: metres, y up, origin at the plan's top-left corner,
x to the right and z down the page. Every room also gets a simple floor and walls from the plan, so
rooms without photos (or whose scan failed) still appear. Nodes are named floor__<roomId>,
wall__<roomId>__<n> and scan__<roomId> (three.js strips ':' from names, so "__" is the separator).

Placing a scan: MASt3R's world is the first camera's frame (OpenCV: x right, y down, z forward), at
real-world scale with the metric checkpoint. We
  1. turn it upright: people hold phones level, so the cameras' average "down" axis is gravity;
  2. put the floor at y = 0 (a low percentile of heights);
  3. square it up: the rotation about the vertical that gives the tightest bounding box lines the walls
     up with the axes; of the two 90° options we keep the one whose shape best matches the room;
  4. keep MASt3R's metric scale, shrinking only if the scan comes out bigger than the room;
  5. centre it in the room's rectangle and crop anything that falls outside.
Which way round a room faces (it could be rotated 180°) is a guess: the plan doesn't say where photos
were taken from.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any

import numpy as np
import trimesh

WALL_T = 0.1
WALL_H = 2.4
# Scans are shown as a dollhouse: cut at waist height, like an architectural cutaway, so you look into the
# room rather than at a crumpled lid; their walls are dropped too (the plan's walls stand in for them).
SCAN_CUT_H = 1.25
SCAN_WALL_BAND = 0.45   # upright surfaces this close to the room's edge are its walls
INNER_H = 1.0
FRONT_H = 0.25
MAX_VERTS_PER_ROOM = 400_000


@dataclass
class View:
    pts: np.ndarray  # (H, W, 3) world points
    rgb: np.ndarray  # (H, W, 3) colours in 0..1
    mask: np.ndarray  # (H, W) which points to keep


@dataclass
class RoomScan:
    views: list[View]
    cam2world: np.ndarray  # (N, 4, 4)


# --- Placing a scan ------------------------------------------------------

def _rotation_between(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """3x3 rotation taking unit vector a onto unit vector b."""
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    v, c = np.cross(a, b), float(np.dot(a, b))
    if c < -0.999999:  # opposite: turn 180° about any perpendicular axis
        axis = np.cross(a, [1.0, 0, 0])
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(a, [0, 0, 1.0])
        axis /= np.linalg.norm(axis)
        return 2 * np.outer(axis, axis) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)


def _rot_y(theta: float) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def _robust_box(xz: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lo, hi = np.percentile(xz, 2, axis=0), np.percentile(xz, 98, axis=0)
    return lo, hi


def placement(scan: RoomScan, room: dict[str, Any]) -> np.ndarray:
    """4x4 transform from the scan's frame to plan coordinates."""
    pts = np.concatenate([v.pts[v.mask] for v in scan.views if v.mask.any()], axis=0).astype(np.float64)
    if len(pts) > 60_000:
        pts = pts[np.random.default_rng(0).choice(len(pts), 60_000, replace=False)]

    # 1. upright
    down = scan.cam2world[:, :3, 1].mean(axis=0)
    if np.linalg.norm(down) < 1e-6:
        down = np.array([0.0, 1.0, 0.0])
    R = _rotation_between(-down, np.array([0.0, 1.0, 0.0]))
    p = pts @ R.T

    # 2. floor at 0
    floor = np.percentile(p[:, 1], 2)

    # 3. square up: angle with the smallest robust bounding box
    xz = p[:, [0, 2]]
    best = (np.inf, 0.0)
    for deg in np.arange(0, 90, 2.0):
        t = np.deg2rad(deg)
        rot = np.array([[np.cos(t), np.sin(t)], [-np.sin(t), np.cos(t)]])
        lo, hi = _robust_box(xz @ rot.T)
        area = float(np.prod(hi - lo))
        if area < best[0]:
            best = (area, t)
    theta = best[1]
    Ry = _rot_y(theta)
    q = p @ Ry.T
    lo, hi = _robust_box(q[:, [0, 2]])
    ext = hi - lo
    w, d = float(room["width"]), float(room["depth"])
    # Pick the 90° option whose aspect ratio is closer to the room's
    as_is = abs(np.log((ext[0] / max(ext[1], 1e-6)) / (w / d)))
    turned = abs(np.log((ext[1] / max(ext[0], 1e-6)) / (w / d)))
    if turned < as_is:
        Ry = _rot_y(np.pi / 2) @ Ry
        q = p @ Ry.T
        lo, hi = _robust_box(q[:, [0, 2]])
        ext = hi - lo

    # 4. scale: trust metric scale unless the scan is bigger than the room
    s = 1.0
    over = max(ext[0] / w, ext[1] / d)
    if over > 1.1:
        s = 1.0 / over

    # 5. centre in the room
    centre = (lo + hi) / 2
    M = np.eye(4)
    M[:3, :3] = s * (Ry @ R)
    M[:3, 3] = [
        room["x"] + w / 2 - s * centre[0],
        -s * floor,
        room["y"] + d / 2 - s * centre[1],
    ]
    return M


def scan_mesh(scan: RoomScan, room: dict[str, Any]) -> trimesh.Trimesh | None:
    """Coloured surface mesh of the scan, placed in the room and cropped to it."""
    M = placement(scan, room)
    total = sum(int(v.mask.sum()) for v in scan.views)
    step = max(1, int(np.ceil(np.sqrt(total / MAX_VERTS_PER_ROOM))))
    margin = -0.03   # inside the room's walls: nothing may spill past them
    x0, x1 = room["x"] - margin, room["x"] + room["width"] + margin
    z0, z1 = room["y"] - margin, room["y"] + room["depth"] + margin

    vertices, colors, faces = [], [], []
    offset = 0
    for v in scan.views:
        pts = v.pts[::step, ::step]
        rgb = v.rgb[::step, ::step]
        H, W, _ = pts.shape
        world = pts.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
        keep = v.mask[::step, ::step].reshape(-1) & np.isfinite(world).all(axis=1)
        keep &= (world[:, 0] > x0) & (world[:, 0] < x1) & (world[:, 2] > z0) & (world[:, 2] < z1)
        keep &= (world[:, 1] > -0.2) & (world[:, 1] < SCAN_CUT_H)
        if H < 2 or W < 2 or not keep.any():
            continue
        idx = np.arange(H * W).reshape(H, W)
        a, b, c, d_ = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, :-1].ravel(), idx[1:, 1:].ravel()
        f = np.concatenate([np.c_[a, b, c], np.c_[b, d_, c]])
        f = f[keep[f].all(axis=1)]
        # Drop long "stretched" triangles that bridge depth jumps (e.g. a chair in front of a wall):
        # anything much longer than this view's typical triangle
        if len(f):
            e = np.linalg.norm(world[f[:, 0]] - world[f[:, 1]], axis=1)
            e = np.maximum(e, np.linalg.norm(world[f[:, 1]] - world[f[:, 2]], axis=1))
            f = f[e < 5 * np.median(e)]
        # Drop the scan's own walls: upright surfaces near the room's edge
        if len(f):
            p0, p1, p2 = world[f[:, 0]], world[f[:, 1]], world[f[:, 2]]
            n = np.cross(p1 - p0, p2 - p0)
            n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
            c = (p0 + p1 + p2) / 3
            edge = np.minimum.reduce([c[:, 0] - room["x"], room["x"] + room["width"] - c[:, 0],
                                      c[:, 2] - room["y"], room["y"] + room["depth"] - c[:, 2]])
            f = f[~((np.abs(n[:, 1]) < 0.4) & (edge < SCAN_WALL_BAND))]
        vertices.append(world)
        colors.append((np.clip(rgb.reshape(-1, 3), 0, 1) * 255).astype(np.uint8))
        faces.append(f + offset)
        offset += H * W
    if not faces or sum(len(f) for f in faces) == 0:
        return None
    mesh = trimesh.Trimesh(
        vertices=np.concatenate(vertices), faces=np.concatenate(faces),
        vertex_colors=np.concatenate(colors), process=False,
    )
    mesh.remove_unreferenced_vertices()
    return mesh


# --- The plan's own floors and walls -------------------------------------

def _box(size, centre, colour) -> trimesh.Trimesh:
    m = trimesh.creation.box(extents=size)
    m.apply_translation(centre)
    m.visual.face_colors = colour
    return m


def shell(plan: dict[str, Any]) -> list[tuple[str, trimesh.Trimesh]]:
    """Floors and cut-away walls, the same as the frontend draws when there's no model."""
    out = []
    eps = 1e-6
    for r in plan["rooms"]:
        x, z, w, d = r["x"], r["y"], r["width"], r["depth"]
        wet = any(k in r["name"].lower() for k in ("kitchen", "bath", "shower", "wc", "toilet", "utility"))
        floor_colour = [211, 218, 227, 255] if wet else [220, 205, 184, 255]
        out.append((f"floor__{r['id']}", _box([w - 0.02, 0.05, d - 0.02], [x + w / 2, -0.03, z + d / 2], floor_colour)))
        h = WALL_T / 2
        edges = [
            ([w, WALL_T], [x + w / 2, z + h], abs(z) < eps, False),
            ([w, WALL_T], [x + w / 2, z + d - h], abs(z + d - plan["depth"]) < eps, True),
            ([WALL_T, d], [x + h, z + d / 2], abs(x) < eps, False),
            ([WALL_T, d], [x + w - h, z + d / 2], abs(x + w - plan["width"]) < eps, True),
        ]
        for i, ((sx, sz), (cx, cz), exterior, front) in enumerate(edges):
            height = (FRONT_H if front else WALL_H) if exterior else INNER_H
            out.append((f"wall__{r['id']}__{i}", _box([sx, height, sz], [cx, height / 2, cz], [244, 244, 242, 255])))
    return out


def build_glb(plan: dict[str, Any], scans: dict[str, RoomScan]) -> tuple[bytes, list[str]]:
    """Returns (.glb bytes, ids of rooms that got a scan)."""
    from .plan_tidy import tidy

    plan = tidy(plan)   # projects read before rooms were joined up get joined here too
    scene = trimesh.Scene()
    for name, mesh in shell(plan):
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    placed = []
    rooms = {r["id"]: r for r in plan["rooms"]}
    for room_id, scan in scans.items():
        if room_id not in rooms or scan is None:
            continue
        mesh = scan_mesh(scan, rooms[room_id])
        if mesh is not None:
            scene.add_geometry(mesh, node_name=f"scan__{room_id}", geom_name=f"scan__{room_id}")
            placed.append(room_id)
    buf = io.BytesIO()
    scene.export(file_obj=buf, file_type="glb")
    return buf.getvalue(), placed
