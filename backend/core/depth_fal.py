"""Better 3D photos with MoGe-2 on fal (Microsoft; real 3D shape from one photo, about $0.01-0.03 a photo).

Depth Anything (core/depth.py) only guesses relative depth and the tour has to assume the camera, so walls can
bow. MoGe-2 predicts the photo's metric 3D shape and its camera's field of view, so walls come out flat and
rooms in proportion. fal returns MoGe's point cloud; this projects it back through the camera into the same
depth PNG the walk-through already reads (16-bit inverse depth in red + green, 384 px wide; see core/depth.py),
so nothing changes in the tour.

Used when FAL_KEY is set (DEPTH_PROVIDER=local turns it off). Any failure falls back to Depth Anything, and
the API keeps each photo's depth map, so a photo is only paid for once.

Compare the two on a photo:  FAL_KEY=... python -m core.depth_fal path/to/photo.jpg
   writes photo-depth-moge.png and photo-depth-local.png (what the tour reads) and photo-depth-compare.png
   (the photo and both depth maps side by side, near = light) in the current folder.
Use another fal endpoint with FAL_DEPTH_MODEL (it must return point_cloud and intrinsics like MoGe-2).
"""

from __future__ import annotations

import io
import logging
import math
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np

DEFAULT_MODEL = "microsoft/moge-2"
OUT_W = 384          # the tour's depth maps are 384 px wide (core/depth.py pack)
MIN_COVERAGE = 0.3   # less than this much of the picture covered means the projection went wrong
UPLOAD_SIDE = 768    # long side of the photo sent to fal

log = logging.getLogger("photos-to-3d")
DepthFn = Callable[[bytes], bytes]


def _intrinsics(result: dict[str, Any]) -> tuple[float, float, float, float]:
    """fx, fy, cx, cy as fractions of the image width / height, from MoGe's normalised intrinsics or its FOV."""
    k = result.get("intrinsics")
    try:
        k = np.asarray(k, dtype=np.float64).reshape(3, 3)
        if k[0, 0] > 0 and k[1, 1] > 0:
            return float(k[0, 0]), float(k[1, 1]), float(k[0, 2]), float(k[1, 2])
    except (TypeError, ValueError):
        pass
    fx_deg, fy_deg = result.get("fov_x"), result.get("fov_y")
    if not fx_deg:
        raise ValueError("no intrinsics or field of view in the result")
    fx = 0.5 / math.tan(math.radians(float(fx_deg)) / 2)
    fy = 0.5 / math.tan(math.radians(float(fy_deg)) / 2) if fy_deg else fx
    return fx, fy, 0.5, 0.5


def points_to_inverse_depth(points: np.ndarray, fx: float, fy: float, cx: float, cy: float,
                            width: int, height: int, out_w: int = OUT_W) -> np.ndarray:
    """Project a camera-space point cloud into an inverse-depth image (near = high), at most out_w wide.

    Accepts either camera convention: OpenCV (z forward, y down) or OpenGL (z backward, y up), which is how
    meshes and point clouds are usually exported. Holes (masked or occluded pixels) are filled from their
    neighbours. Raises ValueError if the points don't cover the picture, which means the projection is wrong.
    """
    p = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    p = p[np.isfinite(p).all(axis=1)]
    if len(p) < 100:
        raise ValueError("too few points")
    if np.median(p[:, 2]) < 0:      # OpenGL export: turn it into OpenCV
        p = p * np.array([1.0, -1.0, -1.0])
    p = p[p[:, 2] > 1e-6]
    u = fx * p[:, 0] / p[:, 2] + cx
    v = fy * p[:, 1] / p[:, 2] + cy
    inside = (u >= 0) & (u < 1) & (v >= 0) & (v < 1)
    if not inside.any():
        raise ValueError("no points land in the picture")
    # A grid no finer than the points can fill (about 1.5 points a pixel), up to the tour's 384 px;
    # core.depth.pack scales it up to the full size.
    aspect = width / height
    out_w = int(np.clip(round(math.sqrt(inside.sum() / 1.5 * aspect)), 32, out_w))
    out_h = max(1, round(out_w / aspect))
    col = np.minimum((u[inside] * out_w).astype(np.int64), out_w - 1)
    row = np.minimum((v[inside] * out_h).astype(np.int64), out_h - 1)
    inv = np.zeros(out_h * out_w)
    np.maximum.at(inv, row * out_w + col, 1.0 / p[inside, 2])   # nearest point wins each pixel
    inv = inv.reshape(out_h, out_w)
    valid = inv > 0
    if valid.mean() < MIN_COVERAGE:
        raise ValueError(f"points cover only {valid.mean():.0%} of the picture")
    return _fill_holes(inv, valid)


def _fill_holes(img: np.ndarray, valid: np.ndarray, max_iter: int = 200) -> np.ndarray:
    """Fill invalid pixels with the average of their valid neighbours, growing inwards (numpy only)."""
    img, valid = img.copy(), valid.copy()
    for _ in range(max_iter):
        if valid.all():
            break
        total = np.zeros_like(img)
        count = np.zeros_like(img)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            s_img = np.roll(np.roll(img * valid, dy, 0), dx, 1)
            s_ok = np.roll(np.roll(valid, dy, 0), dx, 1)
            # np.roll wraps round the edges: don't take neighbours from the far side
            if dy:
                s_ok[-1 if dy < 0 else 0, :] = False
            if dx:
                s_ok[:, -1 if dx < 0 else 0] = False
            total += np.where(s_ok, s_img, 0)
            count += s_ok
        grow = ~valid & (count > 0)
        img[grow] = total[grow] / count[grow]
        valid |= grow
    if not valid.all():
        img[~valid] = img[valid].min() if valid.any() else 0
    return img


def _points_from_ply(data: bytes) -> np.ndarray:
    import trimesh

    cloud = trimesh.load(io.BytesIO(data), file_type="ply", process=False)
    pts = np.asarray(getattr(cloud, "vertices", []), dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError("the point cloud has no points")
    return pts


def _url(value: Any) -> str | None:
    if isinstance(value, dict):
        value = value.get("url")
    return value if isinstance(value, str) and value.startswith(("http://", "https://", "data:")) else None


def make_moge_depth(model: str | None = None, timeout: float = 120) -> DepthFn:
    import fal_client  # reads FAL_KEY
    import httpx
    from PIL import Image

    from .depth import pack

    model = model or os.environ.get("FAL_DEPTH_MODEL", DEFAULT_MODEL)

    def depth(jpeg: bytes) -> bytes:
        started = time.monotonic()
        # The tour's depth maps are 384 px wide, so a 768 px photo is plenty: it keeps the point cloud to
        # download small (a few MB, not tens) and stays inside fal's 1-megapixel minimum price.
        im = Image.open(io.BytesIO(jpeg)).convert("RGB")
        im.thumbnail((UPLOAD_SIDE, UPLOAD_SIDE))
        width, height = im.size
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=90)
        result = fal_client.subscribe(
            model,
            arguments={"image_url": fal_client.upload(buf.getvalue(), "image/jpeg"), "export_ply": True, "export_glb": False},
            client_timeout=timeout,
        )
        if not isinstance(result, dict):
            raise RuntimeError(f"{model} returned {type(result).__name__}")
        url = _url(result.get("point_cloud"))
        if not url:
            raise RuntimeError(f"{model} returned no point cloud (got {list(result)})")
        r = httpx.get(url, timeout=120, follow_redirects=True)
        r.raise_for_status()
        fx, fy, cx, cy = _intrinsics(result)
        inv = points_to_inverse_depth(_points_from_ply(r.content), fx, fy, cx, cy, width, height)
        fov = result.get("fov_x")
        print(f"MoGe depth: {time.monotonic() - started:.1f}s" + (f", fov {float(fov):.0f}°" if fov else ""), flush=True)
        return pack(inv, width, height)

    return depth


def make_depth_fn(local: DepthFn | None, moge: DepthFn | None = None) -> DepthFn | None:
    """The API's depth maker: MoGe on fal when FAL_KEY is set (unless DEPTH_PROVIDER=local), with `local`
    (Depth Anything) as the fallback for any failure. Just `local` otherwise."""
    if moge is None and os.environ.get("FAL_KEY") and os.environ.get("DEPTH_PROVIDER", "").lower() != "local":
        try:
            moge = make_moge_depth()
        except ImportError:
            log.warning("FAL_KEY is set but fal-client isn't installed: 3D photos use Depth Anything.")
    if moge is None:
        return local

    def depth(jpeg: bytes) -> bytes:
        try:
            return moge(jpeg)
        except Exception as e:  # noqa: BLE001 - any fal problem: the local model still gives a 3D photo
            if local is None:
                raise
            log.warning("MoGe depth failed (%s): using Depth Anything", e)
            print(f"MoGe depth failed ({type(e).__name__}: {e}); used Depth Anything", flush=True)
            return local(jpeg)

    return depth


def _preview(png: bytes) -> "Any":
    """The tour's packed depth PNG as a greyscale picture, near = light."""
    from PIL import Image

    a = np.asarray(Image.open(io.BytesIO(png)).convert("RGB")).astype(np.uint32)
    return Image.fromarray(((a[..., 0] * 256 + a[..., 1]) >> 8).astype(np.uint8), "L")


if __name__ == "__main__":
    if len(sys.argv) < 2 or not os.environ.get("FAL_KEY"):
        sys.exit("usage: FAL_KEY=... python -m core.depth_fal path/to/photo.jpg")
    from PIL import Image

    photo = Path(sys.argv[1])
    jpeg = photo.read_bytes()
    stem = Path.cwd() / photo.stem   # results go in the current folder, not next to the photo (which may be in public/)
    out: list[tuple[str, bytes]] = []
    out.append(("moge", make_moge_depth()(jpeg)))
    try:
        from . import depth as local_depth

        if local_depth.available():
            t = time.monotonic()
            out.append(("local", local_depth.depth_png(jpeg)))
            print(f"Depth Anything: {time.monotonic() - t:.1f}s")
        else:
            print("onnxruntime isn't installed, so no Depth Anything map to compare (pip install onnxruntime)")
    except Exception as e:  # noqa: BLE001
        print(f"Depth Anything failed: {e}")
    tiles = [Image.open(photo).convert("RGB")]
    for name, png in out:
        Path(f"{stem}-depth-{name}.png").write_bytes(png)
        print(f"wrote {stem}-depth-{name}.png")
        tiles.append(_preview(png).convert("RGB"))
    h = 384
    tiles = [t.resize((round(t.width * h / t.height), h)) for t in tiles]
    sheet = Image.new("RGB", (sum(t.width for t in tiles) + 8 * (len(tiles) - 1), h), "white")
    x = 0
    for t in tiles:
        sheet.paste(t, (x, 0))
        x += t.width + 8
    sheet.save(f"{stem}-depth-compare.png")
    print(f"wrote {stem}-depth-compare.png  (photo | MoGe | Depth Anything; near = light)")
