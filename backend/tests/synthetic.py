"""A fake MASt3R result: a box-shaped room seen by a few cameras, in an arbitrary tilted frame."""

from __future__ import annotations

import numpy as np

from core.assemble import RoomScan, View


def _grid(origin, u, v, nu, nv):
    a, b = np.meshgrid(np.linspace(0, 1, nu), np.linspace(0, 1, nv))
    return origin + a[..., None] * u + b[..., None] * v  # (nv, nu, 3)


def fake_room_scan(width=4.0, depth=3.0, height=2.4, seed=0) -> RoomScan:
    """Floor + 4 walls of a width × depth room (true frame: y up), then hidden in a random frame
    the way MASt3R would report it (OpenCV-style: camera y axis pointing down)."""
    rng = np.random.default_rng(seed)
    W, D, H = width, depth, height
    surfaces = [
        _grid(np.array([0, 0, 0.0]), np.array([W, 0, 0.0]), np.array([0, 0, D]), 60, 45),  # floor
        _grid(np.array([0, 0, 0.0]), np.array([W, 0, 0.0]), np.array([0, H, 0.0]), 60, 36),  # back wall
        _grid(np.array([0, 0, D]), np.array([W, 0, 0.0]), np.array([0, H, 0.0]), 60, 36),  # front wall
        _grid(np.array([0, 0, 0.0]), np.array([0, 0, D]), np.array([0, H, 0.0]), 45, 36),  # left wall
        _grid(np.array([W, 0, 0.0]), np.array([0, 0, D]), np.array([0, H, 0.0]), 45, 36),  # right wall
    ]
    # Hide the room: random turn about the vertical, flip to y-down, random tilt-free offset, slight scale noise
    yaw = rng.uniform(0, 2 * np.pi)
    c, s = np.cos(yaw), np.sin(yaw)
    turn = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    flip = np.diag([1.0, -1.0, -1.0])  # y up → y down (a proper rotation: 180° about x)
    R = flip @ turn
    t = rng.uniform(-3, 3, size=3)

    views = []
    for g in surfaces:
        pts = (g.reshape(-1, 3) @ R.T + t).reshape(g.shape).astype(np.float32)
        rgb = np.full(g.shape, rng.uniform(0.3, 0.9, size=3), dtype=np.float32)
        views.append(View(pts=pts, rgb=rgb, mask=np.ones(g.shape[:2], dtype=bool)))

    # Cameras held level: their y axis (down) is world-down, i.e. R @ (0, -1, 0)
    cams = []
    for _ in range(len(views)):
        down = R @ np.array([0, -1.0, 0])
        fwd_true = np.array([np.cos(a := rng.uniform(0, 6.28)), 0, np.sin(a)])
        fwd = R @ fwd_true
        right = np.cross(down, fwd)
        m = np.eye(4)
        m[:3, 0], m[:3, 1], m[:3, 2] = right, down, fwd
        m[:3, 3] = R @ np.array([W / 2, 1.5, D / 2]) + t
        cams.append(m)
    return RoomScan(views=views, cam2world=np.array(cams))
