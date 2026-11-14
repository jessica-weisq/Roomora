"""Calibrate two opposite-facing photos of one room into a shared metric 3D frame.
Depth maps (relative inverse depth) become metric using the floor and ceiling as known planes,
then photo B is aligned to photo A on two shared objects. Writes JSON for the tour."""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

CAM_H, CEIL_H = 1.35, 2.85   # camera height and (tray) ceiling height, metres

def load(name):
    d = np.asarray(Image.open(f"img/depth/{name}.png")).astype(float)
    return (d[:, :, 0] * 256 + d[:, :, 1]) / 65535

def calibrate(name, hfov, v0, floor_boxes, ceil_boxes):
    D = load(name); h, w = D.shape
    f = (w / 2) / np.tan(np.radians(hfov) / 2); cy = v0 * h; cx = w / 2
    X, Y = [], []
    for (u0, v0b, u1, v1), plane in [(b, "floor") for b in floor_boxes] + [(b, "ceil") for b in ceil_boxes]:
        for v in range(int(v0b * h), int(v1 * h)):
            for u in range(int(u0 * w), int(u1 * w)):
                z = CAM_H * f / (v - cy) if plane == "floor" else (CEIL_H - CAM_H) * f / (cy - v)
                if z > 0:
                    X.append(D[v, u]); Y.append(1 / z)
    A = np.vstack([X, np.ones(len(X))]).T
    (a, b), *_ = np.linalg.lstsq(A, np.array(Y), rcond=None)
    resid = np.abs(A @ [a, b] - Y) / np.array(Y)
    return dict(D=D, f=f, cx=cx, cy=cy, a=a, b=b, w=w, h=h, err=float(np.median(resid)))

def point(c, u, v):
    """3D point (camera frame: x right, y up, z forward) at image fraction (u, v)."""
    W, H = c["w"], c["h"]
    px, py = u * (W - 1), v * (H - 1)
    d = c["D"][int(round(py)), int(round(px))]
    z = 1 / max(c["a"] * d + c["b"], 1 / 40)
    return np.array([(px - c["cx"]) / c["f"] * z, -(py - c["cy"]) / c["f"] * z, z])

def edges(c):
    """Vertices on depth discontinuities: inverse depth of a flat surface is linear in the image,
    so its second derivative spikes only where one object sits in front of another."""
    inv = ndimage.gaussian_filter(np.maximum(c["a"] * c["D"] + c["b"], 1 / 40), 0.8)
    r = np.ones_like(inv)
    for ax in (0, 1):
        for sh in (1, -1):
            n = np.roll(inv, sh, axis=ax)
            r = np.maximum(r, np.maximum(n / inv, inv / n))
    cut = r > 1.09
    cut[0, :] = cut[-1, :] = cut[:, 0] = cut[:, -1] = False
    return ndimage.binary_dilation(cut, iterations=1)

if __name__ == "__main__":
    hfov = float(sys.argv[1]) if len(sys.argv) > 1 else 90
    A = calibrate("reception-3", hfov, 0.40, [(0.01, 0.84, 0.17, 0.98), (0.87, 0.80, 0.99, 0.98)], [(0.36, 0.03, 0.64, 0.17)])
    B = calibrate("reception-2", hfov, 0.50, [(0.33, 0.73, 0.38, 0.78), (0.40, 0.66, 0.48, 0.70)], [(0.32, 0.02, 0.68, 0.12)])
    # shared objects: coffee table top centre, round bookshelf top
    TA, SA = point(A, 0.505, 0.565), point(A, 0.51, 0.705)
    TB, SB = point(B, 0.55, 0.86), point(B, 0.53, 0.61)
    dA, dB = np.linalg.norm((TA - SA)[[0, 2]]), np.linalg.norm((TB - SB)[[0, 2]])
    print(f"hfov {hfov}: fit error A {A['err']:.3f} B {B['err']:.3f}; table-to-shelf A {dA:.2f} m, B {dB:.2f} m")
    print("table A", TA.round(2), "shelf A", SA.round(2), "| table B", TB.round(2), "shelf B", SB.round(2))

def to_world(c, P, pose):
    th, t = pose["yaw"], np.array(pose["t"])
    x, y, z = P[..., 0], P[..., 1] + CAM_H, -P[..., 2]
    xr = np.cos(th) * x + np.sin(th) * z
    zr = -np.sin(th) * x + np.cos(th) * z
    return np.stack([xr + t[0], y, zr + t[1]], -1)

def cloud(c):
    h, w = c["D"].shape
    v, u = np.mgrid[0:h, 0:w]
    z = 1 / np.maximum(c["a"] * c["D"] + c["b"], 1 / 40)
    return np.stack([(u - c["cx"]) / c["f"] * z, -(v - c["cy"]) / c["f"] * z, z], -1)

def build(hfov=90):
    A = calibrate("reception-3", hfov, 0.40, [(0.01, 0.84, 0.17, 0.98), (0.87, 0.80, 0.99, 0.98)], [(0.36, 0.03, 0.64, 0.17)])
    B = calibrate("reception-2", hfov, 0.50, [(0.33, 0.73, 0.38, 0.78), (0.40, 0.66, 0.48, 0.70)], [(0.32, 0.02, 0.68, 0.12)])
    # room axis from each photo's vanishing point (A looks towards the doors, B towards the windows)
    def axis(c, vx):
        d = np.array([(vx - 0.5) * c["w"] / c["f"], 1.0]); d /= np.linalg.norm(d)
        return np.array([d[0], -d[1]])            # world (x, z) for a camera at yaw 0
    aA, aB = axis(A, 0.47), axis(B, 0.52)
    ang = lambda v: np.arctan2(v[0], -v[1])
    poseA = {"yaw": 0.0, "t": [0.0, 0.0]}
    yawB = ang(-aA) - ang(aB)                     # B's axis must point opposite to A's
    poseB = {"yaw": float(-yawB), "t": [0.0, 0.0]}
    mid = lambda c, pts: np.mean([point(c, *p) for p in pts], 0)
    MA = to_world(A, mid(A, [(0.505, 0.565), (0.51, 0.705)]), poseA)
    MB = to_world(B, mid(B, [(0.55, 0.86), (0.53, 0.61)]), poseB)
    poseB["t"] = [float(MA[0] - MB[0]), float(MA[2] - MB[2])]
    return A, B, poseA, poseB

if __name__ == "__main__" and "--build" in sys.argv:
    A, B, poseA, poseB = build()
    out = []
    for name, c, pose in [("reception-3", A, poseA), ("reception-2", B, poseB)]:
        m = edges(c)
        d = np.asarray(Image.open(f"img/depth/{name}.png")).copy()
        d[:, :, 2] = np.where(m, 255, 0)
        Image.fromarray(d).save(f"img/depth/{name}-fused.png")
        out.append({"src": f"img/{name}.jpg", "depth": f"img/depth/{name}-fused.png", "f": c["f"], "cx": c["cx"], "cy": c["cy"],
                    "a": c["a"], "b": c["b"], "yaw": pose["yaw"], "t": pose["t"], "camH": CAM_H, "cut": float(m.mean())})
        print(name, "cut", round(float(m.mean()), 3), "pose", round(pose["yaw"], 3), [round(v, 2) for v in pose["t"]])
    json.dump({"ceiling": CEIL_H, "parts": out}, open("/home/claude/fused.json", "w"))
    # top-down check
    import PIL.ImageDraw as IDr
    img = Image.new("RGB", (600, 600), "white"); dr = IDr.Draw(img)
    for (name, c, pose), col in zip([("A", A, poseA), ("B", B, poseB)], [(200, 60, 60), (60, 60, 200)]):
        W = to_world(c, cloud(c), pose)[::3, ::3].reshape(-1, 3)
        W = W[(W[:, 1] > 0.15) & (W[:, 1] < 2.6)]
        for x, y, z in W[::2]:
            if abs(x) < 7 and abs(z) < 10:
                dr.point((300 + x * 30, 300 + z * 30), fill=col)
        cx, cz = pose["t"]; dr.ellipse((300 + cx * 30 - 5, 300 + cz * 30 - 5, 300 + cx * 30 + 5, 300 + cz * 30 + 5), fill=col)
    img.save("/home/claude/topdown.png")

if __name__ == "__main__" and "--build" in sys.argv:
    data = json.load(open("/home/claude/fused.json"))
    pts = []
    for (c, pose), part in zip([(A, poseA), (B, poseB)], data["parts"]):
        W = to_world(c, cloud(c), pose).reshape(-1, 3)
        m = np.asarray(Image.open(part["depth"]))[:, :, 2].reshape(-1) == 0
        pts.append(W[m])
    P = np.concatenate(pts)
    WA = to_world(A, cloud(A), poseA).reshape(-1, 3)
    side = WA[(WA[:, 1] > 1.2) & (WA[:, 1] < 2.3) & (WA[:, 2] < -1) & (WA[:, 2] > -6)]
    x0, x1 = np.percentile(side[:, 0], [3, 97])
    zA = to_world(A, cloud(A), poseA).reshape(-1, 3); zB = to_world(B, cloud(B), poseB).reshape(-1, 3)
    z0 = np.percentile(zA[(zA[:, 1] > 1.2) & (zA[:, 1] < 2.3) & (np.abs(zA[:, 0]) < 1.0)][:, 2], 8)
    z1 = np.percentile(zB[(zB[:, 1] > 0.9) & (zB[:, 1] < 1.0) & (np.abs(zB[:, 0]) < 2.5)][:, 2], 92)
    box = {"x0": float(x0), "x1": float(x1), "z0": float(max(z0, -10.5)), "z1": float(z1)}
    # furniture footprint: points between 0.15 m and 1.0 m high, on a 10 cm grid
    furn = P[(P[:, 1] > 0.15) & (P[:, 1] < 1.0)]
    cell = 0.1
    gw, gd = int(np.ceil((x1 - x0) / cell)), int(np.ceil((box["z1"] - box["z0"]) / cell))
    occ = np.zeros((gd, gw), int)
    ix = ((furn[:, 0] - x0) / cell).astype(int); iz = ((furn[:, 2] - box["z0"]) / cell).astype(int)
    ok = (ix >= 0) & (ix < gw) & (iz >= 0) & (iz < gd)
    np.add.at(occ, (iz[ok], ix[ok]), 1)
    blocked = ndimage.binary_opening(occ > 6, iterations=1)
    blocked = ndimage.binary_closing(blocked, iterations=2)
    data["box"] = box
    data["occ"] = {"cell": cell, "w": gw, "h": gd, "bits": "".join("1" if v else "0" for v in blocked.ravel())}
    json.dump(data, open("/home/claude/fused.json", "w"))
    print("box", {k: round(v, 2) for k, v in box.items()}, "grid", gw, gd, "blocked", round(float(blocked.mean()), 3))
    Image.fromarray((blocked * 255).astype(np.uint8)).resize((gw * 4, gd * 4), 0).save("/home/claude/occ.png")
