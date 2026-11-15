"""Turn a coloured floor plan image into a walkable 3D model (walls, floor types, glass) for the tour.
Usage: python3 tools/build_model.py img/floorplan-7th.png <metres-per-pixel>  -> writes model JSON to stdout"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

CELL = 2  # pixels per grid cell
# floor plan colour -> floor class
PALETTE = {
    2: (253, 227, 204),  # living areas -> oak
    3: (220, 204, 227),  # bedrooms -> carpet
    4: (225, 243, 241),  # bathrooms -> travertine
    5: (242, 250, 211),  # terraces -> paving (outdoors)
    6: (243, 201, 225),  # kitchen / utility -> stone
    7: (233, 233, 231),  # wardrobes -> dark oak
    0: (255, 255, 255),  # outside
}

def build(path, mpp):
    rgb = np.array(Image.open(path).convert("RGB")).astype(int)
    h, w, _ = rgb.shape
    dark = rgb.sum(2) < 260
    # walls: dark areas at least 3px thick, minus small leftovers (text, symbols)
    walls = ndimage.binary_opening(dark, structure=np.ones((3, 3)))
    lab, n = ndimage.label(walls)
    sizes = ndimage.sum(walls, lab, range(1, n + 1))
    walls = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= 60])
    # floor classes by nearest palette colour
    keys = list(PALETTE)
    cols = np.array([PALETTE[k] for k in keys])
    d = ((rgb[:, :, None, :] - cols[None, None]) ** 2).sum(3)
    cls = np.array(keys)[d.argmin(2)]
    near = d.min(2) < 900
    cls[~near] = -1  # lines, text, fixtures: fill from neighbours
    # fill unknown pixels with the most common nearby class (iteratively)
    for _ in range(6):
        unknown = cls == -1
        if not unknown.any():
            break
        best = np.full(cls.shape, -1)
        bestc = np.zeros(cls.shape)
        for k in keys:
            c = ndimage.uniform_filter((cls == k).astype(float), size=7)
            better = c > bestc
            best[better] = k
            bestc[better] = c[better]
        cls[unknown] = best[unknown]
    cls[cls == -1] = 0
    cls[walls] = 1
    # downsample to cells
    gh, gw = h // CELL, w // CELL
    g = np.zeros((gh, gw), dtype=int)
    for y in range(gh):
        for x in range(gw):
            block = cls[y * CELL:(y + 1) * CELL, x * CELL:(x + 1) * CELL].ravel()
            g[y, x] = 1 if (block == 1).sum() >= 2 else np.bincount(block[block != 1], minlength=8).argmax() if (block != 1).any() else 1
    # tidy: tiny islands of outside inside the flat become floor of their surroundings
    out = g == 0
    lab, n = ndimage.label(out)
    sizes = ndimage.sum(out, lab, range(1, n + 1))
    for i, s in enumerate(sizes):
        if s < 40:
            m = lab == i + 1
            ring = ndimage.binary_dilation(m) & ~m
            vals = g[ring]; vals = vals[vals >= 2]
            if len(vals):
                g[m] = np.bincount(vals).argmax()
    # drop slivers of terrace (window sills drawn in green) and walls far from any floor (title text)
    terr = g == 5
    lab, n = ndimage.label(terr)
    sizes = ndimage.sum(terr, lab, range(1, n + 1))
    for i, s in enumerate(sizes):
        if s < 400:
            g[lab == i + 1] = 0
    # tiny wall specks (dimension arrows, symbols) become the floor around them
    wl = g == 1
    lab, n = ndimage.label(wl)
    sizes = ndimage.sum(wl, lab, range(1, n + 1))
    for i, sz in enumerate(sizes):
        if sz < 25:
            m = lab == i + 1
            ring = ndimage.binary_dilation(m, iterations=2) & ~m
            vals = g[ring]; vals = vals[vals >= 2]
            if len(vals) > 0.6 * ring.sum():
                g[m] = np.bincount(vals).argmax()
    # keep only the building itself: the largest connected block of walls and floors
    lab, n = ndimage.label(g >= 1, structure=np.ones((3, 3)))
    sizes = ndimage.sum(g >= 1, lab, range(1, n + 1))
    g[lab != (int(np.argmax(sizes)) + 1)] = 0
    # glass: outside cells touching an indoor or terrace cell
    walk = g >= 2
    indoor = walk & (g != 5)
    terr = g == 5
    touch_in = ndimage.binary_dilation(indoor, structure=np.ones((3, 3))) & (g == 0)
    touch_terr = ndimage.binary_dilation(terr, structure=np.ones((3, 3))) & (g == 0) & ~touch_in
    return g, rects(g == 1), rects(touch_in), rects(touch_terr), (gw, gh)

def rects(mask):
    """Greedy merge of a boolean grid into rectangles [x, y, w, h] in cells."""
    m = mask.copy(); out = []
    H, W = m.shape
    for y in range(H):
        x = 0
        while x < W:
            if not m[y, x]:
                x += 1; continue
            x2 = x
            while x2 < W and m[y, x2]: x2 += 1
            y2 = y + 1
            while y2 < H and m[y2, x:x2].all(): y2 += 1
            m[y:y2, x:x2] = False
            out.append([x, y, x2 - x, y2 - y])
            x = x2
    return out

def rle(g):
    s = "".join(str(v) for v in g.ravel())
    out, i = [], 0
    while i < len(s):
        j = i
        while j < len(s) and s[j] == s[i]: j += 1
        out.append(s[i] + (str(j - i) if j - i > 1 else ""))
        i = j
    return ".".join(out)

if __name__ == "__main__":
    path, mpp = sys.argv[1], float(sys.argv[2])
    g, walls, glass, rail, (gw, gh) = build(path, mpp)
    model = {"cell": CELL, "metresPerPx": mpp, "wallHeight": 2.79, "grid": {"w": gw, "h": gh, "rle": rle(g)},
             "walls": walls, "glass": glass, "railing": rail}
    if len(sys.argv) > 3:
        Image.fromarray((np.array([[0,0,0],[30,30,30],[230,190,150],[200,180,220],[200,235,235],[150,200,90],[240,170,200],[150,130,110]],dtype=np.uint8))[g]).resize((gw*2,gh*2),0).save(sys.argv[3])
    json.dump(model, sys.stdout, separators=(",", ":"))
