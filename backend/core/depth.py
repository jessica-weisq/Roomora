"""Depth maps for the walk-through's "3D photos", made with Depth Anything (small, ONNX, runs on CPU).

Same output as tools/tour/build_depth.py, which made the sample flat's depth maps: a PNG with relative
inverse depth (near = high) as a 16-bit number packed into red (high byte) and green (low byte), 384 px wide.
The tour's photo viewer (public/tour/js/roomviewer.js, depthView) turns it into a 3D surface.

When FAL_KEY is set the API uses MoGe-2 on fal instead (core/depth_fal.py), with this as its fallback.

The model (about 100 MB) is read from DEPTH_MODEL, or downloaded once to DEPTH_MODEL_DIR (default
~/.cache/veduta). Needs onnxruntime, pillow and numpy.
"""

from __future__ import annotations

import io
import os
import threading
import urllib.request
from pathlib import Path

MODEL_URL = "https://github.com/fabio-sim/Depth-Anything-ONNX/releases/download/v1.0.0/depth_anything_vits14.onnx"
_session = None
_lock = threading.Lock()


def model_path() -> Path:
    if os.environ.get("DEPTH_MODEL"):
        return Path(os.environ["DEPTH_MODEL"])
    return Path(os.environ.get("DEPTH_MODEL_DIR", Path.home() / ".cache" / "veduta")) / "depth_anything_vits14.onnx"


def download_model() -> Path:
    path = model_path()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(MODEL_URL, tmp)
        tmp.rename(path)
    return path


def available() -> bool:
    try:
        import onnxruntime  # noqa: F401
    except ImportError:
        return False
    return True


def _get_session():
    global _session
    with _lock:
        if _session is None:
            import onnxruntime as ort

            _session = ort.InferenceSession(str(download_model()), providers=["CPUExecutionProvider"])
        return _session


def pack(depth, width: int, height: int) -> bytes:
    """Relative inverse depth (any range, near = high) -> the tour's PNG: 384 px wide, 16 bits in red + green."""
    import numpy as np
    from PIL import Image

    d = np.asarray(depth, dtype=np.float32)
    lo, hi = float(d.min()), float(d.max())
    d = (d - lo) / (hi - lo) if hi > lo else np.zeros_like(d)
    out_w = 384
    out_h = max(1, round(out_w * height / width))
    d = np.asarray(Image.fromarray(d, "F").resize((out_w, out_h), Image.BICUBIC))
    v = (np.clip(d, 0, 1) * 65535).astype(np.uint32)
    rgb = np.stack([(v >> 8).astype(np.uint8), (v & 255).astype(np.uint8), np.zeros(v.shape, np.uint8)], 2)
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, "PNG")
    return buf.getvalue()


def depth_png(jpeg: bytes) -> bytes:
    """A photo (jpeg bytes) -> its depth map PNG."""
    import numpy as np
    from PIL import Image

    im = Image.open(io.BytesIO(jpeg)).convert("RGB")
    W, H = im.size
    w = max(14, round(518 * W / H / 14) * 14)
    mean, std = np.array([0.485, 0.456, 0.406]), np.array([0.229, 0.224, 0.225])
    x = (np.asarray(im.resize((w, 518), Image.BICUBIC)) / 255.0 - mean) / std
    sess = _get_session()
    name = sess.get_inputs()[0].name
    d = sess.run(None, {name: x.transpose(2, 0, 1)[None].astype(np.float32)})[0]
    return pack(np.squeeze(d), W, H)
