"""Make depth maps for photos with Depth Anything (ONNX). Needs: pip install onnxruntime pillow numpy
Download the model once: https://github.com/fabio-sim/Depth-Anything-ONNX/releases/download/v1.0.0/depth_anything_vits14.onnx
Usage: python3 tools/build_depth.py depth_anything_vits14.onnx img/kitchen-1.jpg [more photos...]
Writes img/depth/<name>.png (16-bit depth packed in red + green). Then add "depth": "img/depth/<name>.png"
to that photo in property.js and run tools/pack_media.py."""
import sys, os
import numpy as np, onnxruntime as ort
from PIL import Image
sess = ort.InferenceSession(sys.argv[1], providers=["CPUExecutionProvider"])
mean, std = np.array([0.485, 0.456, 0.406]), np.array([0.229, 0.224, 0.225])
os.makedirs("img/depth", exist_ok=True)
for path in sys.argv[2:]:
    im = Image.open(path).convert("RGB"); W, H = im.size
    w = max(14, round(518 * W / H / 14) * 14)
    x = (np.asarray(im.resize((w, 518), Image.BICUBIC)) / 255.0 - mean) / std
    d = sess.run(None, {"image": x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0, 0]
    d = (d - d.min()) / (d.max() - d.min())
    d = np.asarray(Image.fromarray(d.astype(np.float32), "F").resize((384, round(384 * H / W)), Image.BICUBIC))
    v = (np.clip(d, 0, 1) * 65535).astype(np.uint32)
    rgb = np.stack([(v >> 8).astype(np.uint8), (v & 255).astype(np.uint8), np.zeros(v.shape, np.uint8)], 2)
    out = os.path.join("img/depth", os.path.splitext(os.path.basename(path))[0] + ".png")
    Image.fromarray(rgb, "RGB").save(out)
    print("wrote", out)
