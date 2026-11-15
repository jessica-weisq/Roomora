/* Add photos: the tour's owner (or an editor) uploads photos of a room, or a new floor plan.
   - Room photos: Claude identifies the furniture, colours and floor; that room is refurnished in the 3D walk
     and the photos join the room's photo list.
   - Floor plan: walls are traced from the drawing in the browser, Claude reads room names, types and sizes,
     and a new walkable model is built with starter furniture.
   Changes are saved in the page's database (tour/state) and the tour rebuilds in place.
   Needs the claude.ai viewer: sample (with images), assets, db and user. Hidden anywhere else. */
(function () {
  const T = window.Tour;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---- model grid helpers (same encoding as tools/build_model.py) ----
  T.decodeGrid = function (grid) {
    const out = new Uint8Array(grid.w * grid.h);
    let i = 0;
    for (const tok of grid.rle.split(".")) { const n = tok.length > 1 ? parseInt(tok.slice(1), 10) : 1; out.fill(+tok[0], i, i + n); i += n; }
    return out;
  };
  T.encodeGrid = function (g) {
    const out = [];
    for (let i = 0; i < g.length;) { let j = i; while (j < g.length && g[j] === g[i]) j++; out.push(String(g[i]) + (j - i > 1 ? j - i : "")); i = j; }
    return out.join(".");
  };
  const inPoly = (x, y, pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  // set the floor type of one room's cells (2 oak, 3 carpet, 4 stone, 6 tile, 7 dark oak)
  T.setRoomFloor = function (P, room, cls) {
    const M = P.model, g = T.decodeGrid(M.grid), cell = M.cell;
    for (let z = 0; z < M.grid.h; z++) for (let x = 0; x < M.grid.w; x++) {
      const i = z * M.grid.w + x, v = g[i];
      if (v < 2 || v === 5) continue;
      if (inPoly((x + 0.5) * cell, (z + 0.5) * cell, room.outline)) g[i] = cls;
    }
    M.grid = { w: M.grid.w, h: M.grid.h, rle: T.encodeGrid(g) };
  };
  function rects(mask, W, H) {
    const m = mask.slice(), out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W;) {
      if (!m[y * W + x]) { x++; continue; }
      let x2 = x; while (x2 < W && m[y * W + x2]) x2++;
      let y2 = y + 1;
      outer: for (; y2 < H; y2++) { for (let k = x; k < x2; k++) if (!m[y2 * W + k]) break outer; }
      for (let yy = y; yy < y2; yy++) for (let k = x; k < x2; k++) m[yy * W + k] = 0;
      out.push([x, y, x2 - x, y2 - y]); x = x2;
    }
    return out;
  }
  function components(mask, W, H, diag) {
    const lab = new Int32Array(W * H).fill(-1), sizes = [];
    const st = [];
    for (let s = 0; s < W * H; s++) {
      if (!mask[s] || lab[s] >= 0) continue;
      const id = sizes.length; let n = 0; lab[s] = id; st.push(s);
      while (st.length) {
        const i = st.pop(); n++;
        const x = i % W, y = (i / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue; if (!diag && dx && dy) continue;
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx; if (mask[j] && lab[j] < 0) { lab[j] = id; st.push(j); }
        }
      }
      sizes.push(n);
    }
    return { lab, sizes };
  }

  // ---- floor plan: trace walls and indoor space from the drawing ----
  async function tracePlan(img) {
    const scale = Math.min(1, 1400 / img.naturalWidth);   // keep lines crisp: only shrink very large drawings
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data, N = w * h;
    const dark = new Uint8Array(N), line = new Uint8Array(N), tint = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const r = px[i * 4], g2 = px[i * 4 + 1], b = px[i * 4 + 2], s = r + g2 + b;
      dark[i] = s < 330 ? 1 : 0; line[i] = s < 600 ? 1 : 0;
      // coloured room fills (many plans tint rooms) count as indoors
      tint[i] = s >= 600 && s < 742 && Math.max(r, g2, b) - Math.min(r, g2, b) > 10 ? 1 : 0;
    }
    // walls: dark areas at least 3 px thick (an opening removes text, door swings and window lines)
    const er = new Uint8Array(N), wall = new Uint8Array(N);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let ok = 1; for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!dark[(y + dy) * w + x + dx]) { ok = 0; break; }
      er[y * w + x] = ok;
    }
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let on = 0; for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1; dx++) if (er[(y + dy) * w + x + dx]) { on = 1; break; }
      wall[y * w + x] = on;
    }
    // Walls are the thickest strokes on a plan and all about the same thickness; room labels, dimension lines,
    // door leaves, baths, beds, kitchen units and compasses are drawn thinner. So: measure how thick the ink is
    // at every dark pixel (the shorter of its horizontal and vertical runs), take the thickness most of the ink
    // has as the wall thickness, and keep only strokes at least 40% of that. Without this, every bold label
    // and fixture is extruded into a floor-to-ceiling wall.
    // First, big filled blocks out of the way (a title bar, a filled key or logo): anything mostly solid and
    // fatter than 3.5% of the drawing. Lettering on a title bar slices it into bands that pass for long, thick
    // strokes, so they must go before the wall thickness is worked out.
    // (a pier between two windows can be a chunky block too, so only really fat blocks count here; the
    // wall-thickness rule below deals with the rest)
    const tooThick = Math.max(40, Math.min(w, h) * 0.06);
    {
      const pc = components(wall, w, h, true), n = pc.sizes.length;
      const ax0 = new Int32Array(n).fill(w), ay0 = new Int32Array(n).fill(h), ax1 = new Int32Array(n).fill(-1), ay1 = new Int32Array(n).fill(-1);
      for (let i = 0; i < N; i++) { if (!wall[i]) continue; const k = pc.lab[i], x = i % w, y = (i / w) | 0; if (x < ax0[k]) ax0[k] = x; if (x > ax1[k]) ax1[k] = x; if (y < ay0[k]) ay0[k] = y; if (y > ay1[k]) ay1[k] = y; }
      const block = (k) => { const bw = ax1[k] - ax0[k] + 1, bh = ay1[k] - ay0[k] + 1; return Math.min(bw, bh) > tooThick && pc.sizes[k] / (bw * bh) > 0.5; };
      for (let i = 0; i < N; i++) if (wall[i] && block(pc.lab[i])) wall[i] = 0;
    }
    const thick = new Uint16Array(N), long = new Uint16Array(N);
    const measure = () => {
      thick.fill(0); long.fill(0);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; ) {
        if (!wall[y * w + x]) { x++; continue; }
        let e = x; while (e < w && wall[y * w + e]) e++;
        const len = Math.min(65535, e - x);
        for (let k = x; k < e; k++) { thick[y * w + k] = len; long[y * w + k] = len; }
        x = e;
      }
      for (let x = 0; x < w; x++) for (let y = 0; y < h; ) {
        if (!wall[y * w + x]) { y++; continue; }
        let e = y; while (e < h && wall[e * w + x]) e++;
        const len = Math.min(65535, e - y);
        for (let k = y; k < e; k++) { const i = k * w + x; if (len < thick[i]) thick[i] = len; if (len > long[i]) long[i] = len; }
        y = e;
      }
    };
    measure();
    // Which thickness is "wall": the one the long straight strokes have. Each pixel votes with the length of
    // the stroke it's on, so walls (metres long) outvote labels (short strokes), fixtures and solid columns.
    // (Bands thicker than 3.5% of the drawing aren't walls at any sensible scale: a title bar, a filled key.
    // And one stroke's vote is capped, so a single very long line can't decide it alone.)
    const hist = new Float64Array(128);
    for (let i = 0; i < N; i++) if (wall[i] && thick[i] <= tooThick && long[i] >= thick[i] * 3) hist[Math.min(127, thick[i])] += Math.min(long[i], thick[i] * 30);
    if (!hist.some((v) => v > 0)) for (let i = 0; i < N; i++) if (wall[i]) hist[Math.min(127, thick[i])]++;   // nothing stroke-like: go by ink
    let wallPx = 3, bestInk = -1;
    for (let t = 3; t < 127; t++) { const ink = hist[t - 1] + hist[t] + hist[t + 1]; if (ink > bestInk) { bestInk = ink; wallPx = t; } }
    const minThick = Math.max(3, Math.round(wallPx * 0.4));
    for (let i = 0; i < N; i++) if (wall[i] && thick[i] < minThick) wall[i] = 0;

    const wc = components(wall, w, h, true);
    // drop specks, and solid blocks that aren't walls: a screenshot's toolbar, logos, filled arrows and keys.
    // Walls are lines, so a wall network fills only a small part of its bounding box.
    const nComp = wc.sizes.length, bx0 = new Int32Array(nComp).fill(w), by0 = new Int32Array(nComp).fill(h), bx1 = new Int32Array(nComp).fill(-1), by1 = new Int32Array(nComp).fill(-1);
    for (let i = 0; i < N; i++) {
      if (!wall[i]) continue;
      const k = wc.lab[i], x = i % w, y = (i / w) | 0;
      if (x < bx0[k]) bx0[k] = x; if (x > bx1[k]) bx1[k] = x; if (y < by0[k]) by0[k] = y; if (y > by1[k]) by1[k] = y;
    }
    // (big ones only: pillars and thick wall blocks are solid too, but small)
    // A piece is a solid block, not wall, if it's filled in and much fatter than a wall: a toolbar, a logo, a
    // headboard, a table. A straight run of wall is filled in too but only one wall thick; a column built into
    // a wall is part of the wall's piece, so it stays.
    // ...but a pier between two windows, or a chimney breast, is solid too, and it sits on the building's outline
    // (in line with the outer walls), where furniture never does: blocks on the outline stay.
    let ox0 = w, oy0 = h, ox1 = -1, oy1 = -1;
    for (let k = 0; k < nComp; k++) {
      const bw = bx1[k] - bx0[k] + 1, bh = by1[k] - by0[k] + 1;
      if (wc.sizes[k] < 60 || Math.max(bw, bh) < wallPx * 6) continue;   // walls long enough to outline the building
      if (wc.sizes[k] / (bw * bh) > 0.5 && Math.min(bw, bh) > wallPx * 1.7) continue;
      ox0 = Math.min(ox0, bx0[k]); oy0 = Math.min(oy0, by0[k]); ox1 = Math.max(ox1, bx1[k]); oy1 = Math.max(oy1, by1[k]);
    }
    // (in line with them: a pier's outer face is flush with the outer wall; a headboard is set in from it)
    const onOutline = (k) => ox1 >= 0 && (bx0[k] - ox0 < wallPx * 0.75 || ox1 - bx1[k] < wallPx * 0.75 || by0[k] - oy0 < wallPx * 0.75 || oy1 - by1[k] < wallPx * 0.75);
    const solid = (k) => {
      const bw = bx1[k] - bx0[k] + 1, bh = by1[k] - by0[k] + 1, lo = Math.min(bw, bh), hi = Math.max(bw, bh);
      return wc.sizes[k] / (bw * bh) > 0.5 && lo > wallPx * 1.4 && (hi / lo < 6 || lo > wallPx * 4) && !(onOutline(k) && lo < wallPx * 6);
    };
    // windows and doors cut the walls into separate pieces, so every decent length of wall (about a metre) is
    // kept; anything shorter standing on its own is a letter, a symbol or a blob, not a wall
    // ...and so is a piece standing on its own that's thinner than the walls (two fixture lines side by side)
    measure();   // again, now the thin strokes are gone (where they met a piece, its runs looked long)
    const thickSum = new Float64Array(nComp);
    for (let i = 0; i < N; i++) if (wall[i]) thickSum[wc.lab[i]] += thick[i];
    // (short is fine on the building's outline: a pier between two windows is short and belongs there)
    const stray = (k) => (Math.max(bx1[k] - bx0[k], by1[k] - by0[k]) + 1 < wallPx * 4 && !onOutline(k)) || thickSum[k] / wc.sizes[k] < wallPx * 0.7;
    for (let i = 0; i < N; i++) if (wall[i] && (wc.sizes[wc.lab[i]] < 60 || solid(wc.lab[i]) || stray(wc.lab[i]))) wall[i] = 0;
    // Smooth the walls' outlines: anti-aliased edges trace as little steps, and every step would become a sliver
    // of wall in 3D (thin vertical streaks). Fill notches, then shave bumps, a couple of pixels deep.
    {
      const rad = Math.max(1, Math.min(3, Math.round(wallPx * 0.12)));
      const morph = (src, grow) => {   // square dilate (grow) or erode
        const tmp = new Uint8Array(N), out = new Uint8Array(N);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let v = grow ? 0 : 1;
          for (let k = -rad; k <= rad; k++) { const xx = x + k; const s = xx < 0 || xx >= w ? 0 : src[y * w + xx]; if (grow ? s : !s) { v = grow ? 1 : 0; break; } }
          tmp[y * w + x] = v;
        }
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let v = grow ? 0 : 1;
          for (let k = -rad; k <= rad; k++) { const yy = y + k; const s = yy < 0 || yy >= h ? 0 : tmp[yy * w + x]; if (grow ? s : !s) { v = grow ? 1 : 0; break; } }
          out[y * w + x] = v;
        }
        return out;
      };
      const closed = morph(morph(wall, true), false), opened = morph(morph(closed, false), true);
      wall.set(opened);
    }
    // the drawing itself: the box round the walls that are left (anything beyond it, such as a screenshot's
    // border, captions or page furniture, is outside)
    let cx0 = w, cy0 = h, cx1 = -1, cy1 = -1;
    for (let i = 0; i < N; i++) if (wall[i]) { const x = i % w, y = (i / w) | 0; if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y; }
    const pad = 6;
    if (cx1 < 0) { cx0 = 0; cy0 = 0; cx1 = w - 1; cy1 = h - 1; }
    cx0 = Math.max(0, cx0 - pad); cy0 = Math.max(0, cy0 - pad); cx1 = Math.min(w - 1, cx1 + pad); cy1 = Math.min(h - 1, cy1 + pad);
    // outside: everything beyond that box, and everything reachable from its edge without crossing a line
    const outside = new Uint8Array(N), st = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < cx0 || x > cx1 || y < cy0 || y > cy1) outside[y * w + x] = 1;
    const seed = (i) => { if (!line[i] && !outside[i]) { outside[i] = 1; st.push(i); } };
    for (let x = cx0; x <= cx1; x++) { seed(cy0 * w + x); seed(cy1 * w + x); }
    for (let y = cy0; y <= cy1; y++) { seed(y * w + cx0); seed(y * w + cx1); }
    // and from anywhere beyond the walls' outer bounds: a frame line round the drawing must not shut the margin
    // in (nothing out there can be indoors)
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) if (x < cx0 + pad || x > cx1 - pad || y < cy0 + pad || y > cy1 - pad) seed(y * w + x);
    while (st.length) {
      const i = st.pop(), x = i % w, y = (i / w) | 0;
      if (x > cx0) seed(i - 1); if (x < cx1) seed(i + 1); if (y > cy0) seed(i - w); if (y < cy1) seed(i + w);
    }
    // ...but not in through the front door. An open doorway in the outer wall would let "outside" flood the hall or
    // lobby behind it. So the outside is shrunk by about half a doorway (which cuts it off at any door-sized
    // gap), only the part still joined to the edge of the drawing is kept, and that's grown back.
    {
      const R = Math.max(3, Math.min(Math.round(wallPx * 2.5), Math.round(Math.min(w, h) * 0.04)));
      const dist = new Int32Array(N).fill(1 << 30), q = [];
      for (let i = 0; i < N; i++) if (!outside[i]) { dist[i] = 0; q.push(i); }
      for (let qi = 0; qi < q.length; qi++) {   // distance from the nearest not-outside pixel (city blocks)
        const i = q[qi], x = i % w, d = dist[i] + 1;
        if (d > R + 1) continue;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < N && dist[j] > d) { dist[j] = d; q.push(j); }
      }
      // (everything on or beyond the edge of the drawing counts as wide-open outside, however close the
      // building comes to it: plans are often cropped tight)
      const core = new Uint8Array(N), st2 = [];
      for (let i = 0; i < N; i++) {
        const x = i % w, y = (i / w) | 0;
        if (outside[i] && (x <= cx0 || x >= cx1 || y <= cy0 || y >= cy1 || x === 0 || y === 0 || x === w - 1 || y === h - 1)) { core[i] = 1; st2.push(i); }
      }
      while (st2.length) {
        const i = st2.pop(), x = i % w;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < N && !core[j] && outside[j] && dist[j] > R) { core[j] = 1; st2.push(j); }
      }
      // grow the edge-joined part back out by R, through outside pixels only
      const back = new Int32Array(N).fill(-1), q2 = [];
      for (let i = 0; i < N; i++) if (core[i]) { back[i] = 0; q2.push(i); }
      for (let qi = 0; qi < q2.length; qi++) {
        const i = q2[qi], x = i % w, d = back[i] + 1;
        if (d > R) continue;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < N && back[j] < 0 && outside[j]) { back[j] = d; q2.push(j); }
      }
      // whatever the flood reached only through a doorway is indoors after all
      let sealed = 0;
      for (let i = 0; i < N; i++) if (outside[i] && back[i] < 0) { outside[i] = 0; sealed++; }
      void sealed;
    }
    // 2 px cells: 1 wall, 2 indoor floor, 0 outside
    const CELL = 2, GW = Math.floor(w / CELL), GH = Math.floor(h / CELL), g = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      let nw = 0, nin = 0;
      for (let dy = 0; dy < CELL; dy++) for (let dx = 0; dx < CELL; dx++) {
        const i = (y * CELL + dy) * w + x * CELL + dx;
        if (wall[i]) nw++; else if (!outside[i] || tint[i]) nin++;
      }
      g[y * GW + x] = nw >= 2 ? 1 : nin >= 2 ? 2 : 0;
    }
    // keep only the building: the largest connected block of walls and floor
    const bc = components(g.map((v) => (v >= 1 ? 1 : 0)), GW, GH, true);
    let big = 0; bc.sizes.forEach((s, k) => { if (s > bc.sizes[big]) big = k; });
    for (let i = 0; i < g.length; i++) if (g[i] && bc.lab[i] !== big) g[i] = 0;
    return { w, h, scale, GW, GH, CELL, g, canvas: c, wallPx };
  }

  const FLOOR_FOR = { bedroom: 3, bathroom: 4, kitchen: 6, utility: 6, wardrobe: 7, terrace: 5 };
  function buildModel(tr, rooms, mpp) {
    const { GW, GH, CELL } = tr, g = tr.g.slice(), orig = tr.g;
    // floors by room type (larger rooms first, so smaller rooms inside them win)
    [...rooms].sort((a, b) => b.area - a.area).forEach((r) => {
      const cls = FLOOR_FOR[r.type] || 2;
      const [x0, y0, x1, y1] = r.px;
      for (let y = Math.floor(y0 / CELL); y < Math.ceil(y1 / CELL); y++) for (let x = Math.floor(x0 / CELL); x < Math.ceil(x1 / CELL); x++) {
        if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
        const i = y * GW + x;
        if (r.type === "terrace") { if (orig[i] !== 1) g[i] = 5; }
        else if (orig[i] !== 1) g[i] = cls;
      }
    });
    // tiny wall specks become floor
    const wc = components(g.map((v) => (v === 1 ? 1 : 0)), GW, GH, false);
    for (let i = 0; i < g.length; i++) if (g[i] === 1 && wc.sizes[wc.lab[i]] < 25) g[i] = 2;
    // glass: outside cells next to indoor floor; railings: outside cells next to terraces
    const indoor = (v) => v >= 2 && v !== 5;
    const glass = new Uint8Array(g.length), rail = new Uint8Array(g.length);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const i = y * GW + x; if (g[i] !== 0) continue;
      let ni = 0, nt = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const v = g[ny * GW + nx]; if (indoor(v)) ni = 1; if (v === 5) nt = 1;
      }
      if (ni) glass[i] = 1; else if (nt) rail[i] = 1;
    }
    return {
      cell: CELL, metresPerPx: mpp, wallHeight: 2.7,
      grid: { w: GW, h: GH, rle: T.encodeGrid(g) },
      walls: rects(g.map((v) => (v === 1 ? 1 : 0)), GW, GH), glass: rects(glass, GW, GH), railing: rects(rail, GW, GH),
    };
  }

  // starter furniture for a room with no photos yet
  function starter(room, type, mpp) {
    const [x0, y0, x1, y1] = room.px, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const W = (x1 - x0) * mpp, D = (y1 - y0) * mpp, m = (v) => v / mpp, out = [];
    const add = (t, x, y, rot, o = {}) => out.push(Object.assign({ room: room.id, type: t, x, y, rot }, o));
    if (W < 1.3 || D < 1.3) return out;
    if (type === "living") {
      add("rug", cx, cy, 0, { w: Math.min(4, W - 1), d: Math.min(3, D - 1) });
      add("sofa", cx, cy + m(Math.min(1.5, D / 2 - 0.6)), 180, { len: Math.min(2.6, W - 1.2) });
      add("coffeeRound", cx, cy, 0, { r: 0.5 });
      if (W > 3.2) { add("armchair", cx - m(0.9), cy - m(1.2), 0); add("armchair", cx + m(0.9), cy - m(1.2), 0); }
      add("floorLamp", x0 + m(0.4), y0 + m(0.4), 0);
    } else if (type === "bedroom") {
      const bw = W > 3.2 ? 1.8 : 1.4;
      add("bed", cx, y0 + m(1.12), 0, { w: bw, l: 2.1 });
      add("nightstand", cx - m(bw / 2 + 0.35), y0 + m(0.3), 0); add("nightstand", cx + m(bw / 2 + 0.35), y0 + m(0.3), 0);
      if (D > 3.6) add("bench", cx, y0 + m(2.45), 0, { len: Math.min(1.4, bw) });
    } else if (type === "kitchen" || type === "dining") {
      if (type === "kitchen") add("counter", cx, y0 + m(0.36), 0, { len: Math.min(3.6, W - 0.4), hob: true });
      if (type === "kitchen" && W > 3.5 && D > 3.8) add("island", cx, cy + m(0.3), 90, { w: 1.0, d: Math.min(2.4, W - 2) });
      else add("table", cx, cy + (type === "kitchen" ? m(0.6) : 0), 0, { w: Math.min(2.2, W - 1.6), d: 0.95, chairs: W > 3.6 ? 3 : 2, pendants: 2 });
    } else if (type === "bathroom") {
      // a bath only where one fits with room to stand; otherwise a WC and a basin (most small bathrooms
      // have a shower, but where it is is a guess the plan's own fixtures answer better)
      if (W >= 2.2 && D >= 1.9) add("bath", cx, y0 + m(0.45), 0, { len: Math.min(1.7, W - 0.4), w: 0.75 });
      add("wc", x0 + m(0.4), y1 - m(0.4), 180);
      add("vanity", x1 - m(0.45), y1 - m(0.3), 180, { len: Math.min(0.8, W / 2 - 0.2), basins: 1 });
    } else if (type === "study") {
      add("desk", cx, cy, 0, { w: 1.4 }); add("bookcase", cx, y0 + m(0.2), 0, { len: Math.min(2.2, W - 0.6) });
    } else if (type === "wardrobe") {
      add("wardrobe", cx, y0 + m(0.32), 0, { len: Math.min(2.4, W - 0.3) });
    } else if (type === "terrace") {
      add("roundTable", cx, cy, 0, { r: 0.5, chairs: 4 });
      add("planter", cx, y0 + m(0.35), 0, { len: Math.min(4, W - 0.6) });
    } else if (type === "hall") {
      if (W > 2.2 && D > 2.2) add("console", cx, y0 + m(0.22), 0, { len: 1.4 });
    }
    return out;
  }

  const slug = (s) => (s || "room").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room";
  const ROOM_TYPES = ["living", "kitchen", "dining", "bedroom", "bathroom", "study", "hall", "wardrobe", "utility", "terrace", "other"];

  async function planFromImage(file, sample, assets, setStatus, signal) {
    setStatus("Reading the drawing…");
    const url = URL.createObjectURL(file);
    const img = await T.loadImage(url);
    const tr = await tracePlan(img);
    setStatus("Asking Claude to read the room names and sizes. This usually takes 20–60 seconds…");
    const prompt = `This image is an architectural floor plan of a home. Identify every labelled room and outdoor space (terraces, balconies). ` +
      `Return only JSON in this shape: {"level": "Seventh floor" or null, "rooms": [{"name": "Reception room", "type": one of ${ROOM_TYPES.map((t) => `"${t}"`).join(", ")}, "box": [x0, y0, x1, y1], "size_m": [a, b] or null}]}. ` +
      `"box" is the room's extent as fractions of the image width and height, from 0 to 1, measured to the inside of its walls. ` +
      `"size_m" is the room's dimensions in metres exactly as printed on the plan (both numbers), or null if none are printed. ` +
      `Use sentence case for names (for example "Principal bedroom"). Include halls and corridors as "hall". Ignore titles, notes, the compass and the area summary.`;
    const res = await sample.json(prompt, { images: [file], modelTier: "default", signal });
    if (!res || !Array.isArray(res.rooms) || !res.rooms.length) throw { code: "no_rooms" };
    const W = tr.w, H = tr.h;
    // scale: metres per pixel from printed room sizes (median), else a typical 4 cm per pixel
    const ratios = [];
    const rooms = res.rooms.filter((r) => Array.isArray(r.box) && r.box.length === 4).map((r, k) => {
      const [a, b, c2, d] = r.box.map(Number);
      const px = [clamp(Math.min(a, c2), 0, 1) * W, clamp(Math.min(b, d), 0, 1) * H, clamp(Math.max(a, c2), 0, 1) * W, clamp(Math.max(b, d), 0, 1) * H];
      const pw = px[2] - px[0], ph = px[3] - px[1];
      if (Array.isArray(r.size_m) && r.size_m.length === 2 && pw > 8 && ph > 8) {
        const [m1, m2] = r.size_m.map(Number).sort((p, q) => q - p), [p1, p2] = [pw, ph].sort((p, q) => q - p);
        if (m1 > 0.5 && m2 > 0.5) ratios.push(m1 / p1, m2 / p2);
      }
      return { name: String(r.name || `Room ${k + 1}`).slice(0, 40), type: ROOM_TYPES.includes(r.type) ? r.type : "other", px, area: pw * ph };
    }).filter((r) => r.px[2] - r.px[0] > 6 && r.px[3] - r.px[1] > 6);
    if (!rooms.length) throw { code: "no_rooms" };
    ratios.sort((p, q) => p - q);
    const scaleKnown = ratios.length > 0;
    const mpp = scaleKnown ? ratios[Math.floor(ratios.length / 2)] : 0.04;
    setStatus("Building the 3D flat…");
    const model = buildModel(tr, rooms, mpp);
    // store the drawing so the plan card can show it
    const blob = await new Promise((r) => tr.canvas.toBlob(r, "image/png"));
    const asset = await assets.upload(blob);
    const used = new Set();
    rooms.forEach((r) => { let id = slug(r.name), n = 2; while (used.has(id)) id = slug(r.name) + "-" + n++; used.add(id); r.id = id; });
    const near = (a, b) => !(a.px[2] + 8 < b.px[0] || b.px[2] + 8 < a.px[0] || a.px[3] + 8 < b.px[1] || b.px[3] + 8 < a.px[1]);
    const outRooms = rooms.map((r) => {
      const [x0, y0, x1, y1] = r.px.map((v) => Math.round(v));
      const big = (x1 - x0) * mpp > 3.5 && (y1 - y0) * mpp > 3.5;
      return {
        id: r.id, name: r.name, floor: "plan", type: r.type,
        outline: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], media: [],
        links: rooms.filter((o) => o !== r && near(r, o)).map((o) => ({ to: o.id })),
        ceiling: big && (r.type === "living" || r.type === "bedroom") ? "tray" : undefined,
      };
    });
    const furnishing = rooms.flatMap((r) => starter(r, r.type, mpp));
    const pick = (types) => rooms.filter((r) => types.includes(r.type)).sort((a, b) => b.area - a.area)[0];
    const entry = (pick(["hall"]) || pick(["living"]) || rooms[0]).id;
    const start = (pick(["living"]) || pick(["kitchen", "dining"]) || rooms[0]).id;
    return {
      plan: {
        floors: [{ id: "plan", name: res.level || "Floor plan", plan: "/_blob/" + asset.id, planSize: { w: tr.w, h: tr.h } }],
        rooms: outRooms, model, furnishing, entryRoom: entry, startRoom: start,
      },
      summary: { rooms: rooms.length, scaleKnown },
    };
  }

  // ---- room photos: what furniture is where ----
  const ITEM_TYPES = {
    sofa: "sofa or settee (len = length in metres)", armchair: "armchair or tub chair", ottoman: "ottoman, footstool or pouffe (w, d)",
    sideboard: "sideboard, credenza or low cabinet (len)", coffeeRound: "round coffee table (r = radius)", coffee: "rectangular coffee table (w, d)",
    table: "dining table (w = length, d = width)", chair: "single chair on its own", bed: "bed (w = width, d = length)", nightstand: "bedside table",
    bench: "bench or end-of-bed stool (len)", dresser: "chest of drawers or dresser (len)", wardrobe: "freestanding or built-in wardrobe (len)",
    desk: "desk (w)", bookcase: "bookcase or open shelving (len)", shelving: "tall built-in shelving unit (len)", tv: "wall-mounted TV",
    rug: "rug (w, d)", floorLamp: "floor lamp", plant: "large potted plant", console: "console table, often with a mirror (len)",
    island: "kitchen island (w, d)", counter: "kitchen worktop run with cupboards (len)", bath: "bath (len)", vanity: "basin vanity unit (len)",
    wc: "toilet", hottub: "hot tub (w)", planter: "planter box (len)", lounger: "sun lounger", roundTable: "small round table with chairs (r)",
  };
  const FACING = {
    top: "looking towards the TOP wall of the plan: the far wall in the photo is y = 0, and the photo's left side is x = 0",
    bottom: "looking towards the BOTTOM wall of the plan: the far wall in the photo is y = 1, and the photo's left side is x = 1",
    left: "looking towards the LEFT wall of the plan: the far wall in the photo is x = 0, and the photo's left side is y = 1",
    right: "looking towards the RIGHT wall of the plan: the far wall in the photo is x = 1, and the photo's left side is y = 0",
  };
  const FLOORS = { oak: 2, "dark-oak": 7, carpet: 3, stone: 4, tile: 6 };
  const ROT = { down: 0, right: 90, up: 180, left: 270 };
  const hex = (v, d) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  const num = (v, lo, hi, d) => (Number.isFinite(+v) && +v > 0 ? clamp(+v, lo, hi) : d);

  async function analysePhotos(P, room, photos, sample, signal) {
    const mpp = P.model.metresPerPx;
    const xs = room.outline.map((p) => p[0]), ys = room.outline.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const W = (x1 - x0) * mpp, D = (y1 - y0) * mpp;
    const prompt = `These ${photos.length} photo(s) show the ${room.name} of a home. On the floor plan this room is about ${W.toFixed(1)} m wide (x, left to right) and ${D.toFixed(1)} m deep (y, top to bottom).\n` +
      photos.map((p, i) => `Photo ${i + 1} was taken ${FACING[p.facing]}.`).join("\n") +
      `\n\nList the furniture you can see, as a plan view of the room. Count each real object once even if several photos show it. At most 24 items. ` +
      `Return only JSON: {"floor": "oak" | "dark-oak" | "carpet" | "stone" | "tile" | null, "items": [{"type": ..., "x": 0-1, "y": 0-1, "faces": "up" | "down" | "left" | "right", "len": m or null, "w": m or null, "d": m or null, "r": m or null, "color": "#rrggbb", "accent": ["#rrggbb", ...]}]}.\n` +
      `"x" and "y" are the object's centre as fractions of the room (x = 0 left wall, 1 right wall; y = 0 top wall, 1 bottom wall). "faces" is the direction the object's front or seat faces on the plan (up = towards the top wall). ` +
      `"color" is its main colour (upholstery, lacquer or wood); "accent" lists cushion or detail colours. Allowed types:\n` +
      Object.entries(ITEM_TYPES).map(([k, v]) => `- ${k}: ${v}`).join("\n") +
      `\nSkip anything that is not one of these types, and small objects such as books and vases.`;
    const res = await sample.json(prompt, { images: photos.map((p) => p.file), modelTier: "default", signal });
    return toFurnishing(P, room, res);
  }

  // turn an analysis {floor, items:[{type, x, y, faces, len, w, d, r, color, accent}]} into tour furniture for a room
  function toFurnishing(P, room, res) {
    const xs = room.outline.map((p) => p[0]), ys = room.outline.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const items = (res && Array.isArray(res.items) ? res.items : []).filter((it) => ITEM_TYPES[it.type]).slice(0, 24);
    const px = (fx, fy) => [x0 + clamp(+fx || 0.5, 0.04, 0.96) * (x1 - x0), y0 + clamp(+fy || 0.5, 0.04, 0.96) * (y1 - y0)];
    const furnishing = items.map((it) => {
      const [x, y] = px(it.x, it.y);
      const f = { room: room.id, type: it.type, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, rot: ROT[it.faces] != null ? ROT[it.faces] : 0 };
      const col = hex(it.color), acc = Array.isArray(it.accent) ? it.accent.map((a) => hex(a)).filter(Boolean) : [];
      switch (it.type) {
        case "sofa": Object.assign(f, { len: num(it.len, 1.2, 4, 2.4) }, col && { color: col }, acc.length && { cushions: acc.slice(0, 3) }); break;
        case "armchair": Object.assign(f, col && { color: col }, acc[0] && { cushion: acc[0] }); break;
        case "ottoman": Object.assign(f, { w: num(it.w, 0.4, 2, 0.9), d: num(it.d, 0.4, 1.4, 0.7) }, col && { color: col }); break;
        case "sideboard": Object.assign(f, { len: num(it.len, 0.8, 3.5, 1.8) }, col && { color: col }); break;
        case "coffeeRound": f.r = num(it.r, 0.25, 0.8, 0.5); break;
        case "coffee": Object.assign(f, { w: num(it.w, 0.6, 2, 1.2), d: num(it.d, 0.4, 1.2, 0.7) }); break;
        case "table": { const w = num(it.w, 0.8, 4, 1.8); Object.assign(f, { w, d: num(it.d, 0.6, 1.4, 0.95), chairs: Math.max(1, Math.floor(w / 0.7)) }); break; }
        case "bed": Object.assign(f, { w: num(it.w, 0.9, 2.2, 1.6), l: num(it.d, 1.8, 2.4, 2.1) }, col && { color: col }, acc[0] && { accent: acc[0] }); break;
        case "nightstand": if (col) f.color = col; break;
        case "rug": Object.assign(f, { w: num(it.w, 1, 6, 2.6), d: num(it.d, 0.8, 5, 1.8) }, col && { color: col }); break;
        case "island": Object.assign(f, { w: num(it.w, 0.7, 1.6, 1.1), d: num(it.d, 1.2, 4, 2.2) }); break;
        case "hottub": f.w = num(it.w, 1.6, 2.6, 2.1); break;
        case "roundTable": Object.assign(f, { r: num(it.r, 0.3, 0.8, 0.5), chairs: 4 }); break;
        case "desk": f.w = num(it.w, 0.8, 2.2, 1.4); break;
        default: if (it.len) f.len = num(it.len, 0.4, 4.5, 1.6);
      }
      return f;
    });
    return { furnishing, floorClass: FLOORS[res && res.floor] || null, wallColor: hex(res && res.walls) || null, count: furnishing.length };
  }

  const describe = (items) => {
    const names = { coffeeRound: "round coffee table", coffee: "coffee table", floorLamp: "floor lamp", roundTable: "round table", nightstand: "bedside table", hottub: "hot tub", wc: "toilet", tv: "TV" };
    const counts = {};
    items.forEach((i) => { const n = names[i.type] || i.type; counts[n] = (counts[n] || 0) + 1; });
    return Object.entries(counts).map(([n, c]) => (c > 1 ? `${c} ${n}s` : `${n}`)).join(", ");
  };
  const errorText = (e, limits) => {
    const mb = limits && limits.images ? Math.round(limits.images.maxInputBytes / 1e6) : 5;
    switch (e && e.code) {
      case "cancelled": return "Stopped.";
      case "not_granted": return "Claude wasn’t allowed to look at the images. Choose Allow when asked to use this.";
      case "rate_limited": case "queue_overflow": return "Too many requests at once. Wait a minute, then try again.";
      case "image_rejected": return `One of the images couldn’t be read. Use JPEG, PNG or WebP files under ${mb} MB.`;
      case "refused": return "Claude declined to analyse these images.";
      case "no_rooms": return "No rooms could be read from that image. Use a floor plan with room names printed on it.";
      case "prompt_too_large": return "Too many images in one go. Try fewer photos.";
      case "session_expired": return "Your session has expired. Reload the page and sign in again.";
      default: return "The analysis didn’t come back complete. Try again.";
    }
  };

  // ---- the panel ----
  async function setup() {
    const capability = (n) => (window.claude && window.claude.use ? Promise.race([window.claude.use(n).catch(() => null), new Promise((r) => setTimeout(() => r(null), 10000))]) : Promise.resolve(null));
    const [sample, assets, user] = await Promise.all([capability("sample"), capability("assets"), capability("user")]);
    if (!sample || !assets || !T.db) return;
    const canEdit = user ? await Promise.resolve(user.canEdit && user.canEdit()).catch(() => false) : false;
    if (!canEdit && !(user && user.isOwner && user.isOwner())) return;
    const limits = await sample.limits().catch(() => null);
    if (!limits || !limits.images) return;
    T.canUpload = true;
    const accept = limits.images.mediaTypes.join(",");

    const openBtn = el("button", "mode-add", "Add photos");
    openBtn.type = "button";
    document.querySelector(".app-controls").appendChild(openBtn);
    const panel = el("aside", "up-panel");
    panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Update the flat from photos");
    panel.innerHTML = `
      <div class="up-head"><h2>Update the flat</h2><button type="button" class="up-close">Close</button></div>
      <section class="up-sec">
        <h3>Photos of a room</h3>
        <p class="up-note">Claude looks at the furniture, colours and floor in your photos and refurnishes that room in the 3D walk. The photos are added to the room.</p>
        <label class="up-field">Room <select class="up-room"></select></label>
        <label class="up-drop"><input type="file" class="up-files" multiple accept="${accept}"><span>Choose photos</span></label>
        <ul class="up-list"></ul>
        <div class="up-actions"><button type="button" class="up-go" disabled>Update this room</button><button type="button" class="up-stop" hidden>Stop</button></div>
        <p class="up-status" aria-live="polite"></p>
      </section>
      <section class="up-sec">
        <h3>A new floor plan</h3>
        <p class="up-note">Rebuilds the whole flat: the walls are traced from the drawing and Claude reads the room names and sizes. Rooms get simple furniture until you add photos of them.</p>
        <label class="up-drop"><input type="file" class="up-plan" accept="${accept}"><span>Choose a floor plan</span></label>
        <div class="up-actions"><button type="button" class="up-plan-go" disabled>Build the flat from this plan</button><button type="button" class="up-plan-stop" hidden>Stop</button></div>
        <p class="up-status up-plan-status" aria-live="polite"></p>
      </section>
      <div class="up-foot"><button type="button" class="up-reset">Go back to the original listing</button></div>`;
    document.querySelector(".app-main").appendChild(panel);
    const $ = (s) => panel.querySelector(s);
    const roomSel = $(".up-room"), files = $(".up-files"), list = $(".up-list"), go = $(".up-go"), stop = $(".up-stop"), status = panel.querySelectorAll(".up-status")[0];
    const planIn = $(".up-plan"), planGo = $(".up-plan-go"), planStop = $(".up-plan-stop"), planStatus = $(".up-plan-status"), reset = $(".up-reset");

    const open = (on) => { panel.hidden = !on; openBtn.setAttribute("aria-expanded", String(on)); if (on) { fillRooms(); $(".up-close").focus(); } };
    openBtn.addEventListener("click", () => open(panel.hidden));
    $(".up-close").addEventListener("click", () => { open(false); openBtn.focus(); });
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { open(false); openBtn.focus(); } });

    function fillRooms() {
      const cur = roomSel.value || (T.P && location.hash.replace(/^#(room|photos)-/, ""));
      roomSel.replaceChildren(...T.P.rooms.map((r) => new Option(r.name, r.id)));
      if (cur && T.roomById(T.P, cur)) roomSel.value = cur;
    }
    T.on("tour:built", () => { if (!panel.hidden) fillRooms(); }, { persistent: true });

    // chosen photos, each with the direction it faces on the plan
    let chosen = [];
    files.addEventListener("change", () => {
      chosen = [...files.files].slice(0, limits.images.maxCount).map((file) => ({ file, facing: "top", url: URL.createObjectURL(file) }));
      list.replaceChildren(...chosen.map((p, i) => {
        const li = el("li", "up-item");
        const im = el("img"); im.src = p.url; im.alt = "";
        const lab = el("label", "up-facing", "Looking towards the ");
        const sel = el("select");
        [["top", "top of the plan"], ["right", "right of the plan"], ["bottom", "bottom of the plan"], ["left", "left of the plan"]].forEach(([v, t]) => sel.add(new Option(t, v)));
        sel.addEventListener("change", () => (p.facing = sel.value));
        lab.appendChild(sel); li.append(im, lab);
        return li;
      }));
      status.textContent = files.files.length > limits.images.maxCount ? `Only the first ${limits.images.maxCount} photos will be used.` : "";
      go.disabled = !chosen.length;
    });

    const busy = (on, which) => {
      for (const b of [go, planGo, reset, files, planIn, roomSel]) b.disabled = on || (b === go && !chosen.length) || (b === planGo && !planIn.files.length);
      (which === "plan" ? planStop : stop).hidden = !on;
    };
    const undoButton = (target, prev) => {
      const b = el("button", "up-undo", "Undo"); b.type = "button";
      b.addEventListener("click", async () => { b.disabled = true; const r = await T.applyState(prev); target.textContent = r.saved ? "Undone." : "Undone here, but it couldn’t be saved."; });
      target.append(" ", b);
    };

    let ctl = null;
    stop.addEventListener("click", () => ctl && ctl.abort());
    planStop.addEventListener("click", () => ctl && ctl.abort());

    go.addEventListener("click", async () => {
      const room = T.roomById(T.P, roomSel.value);
      if (!room || !chosen.length) return;
      ctl = new AbortController(); busy(true, "photos");
      try {
        status.textContent = "Saving your photos…";
        const ups = [];
        for (const p of chosen) { const a = await assets.upload(p.file); ups.push({ id: a.id, facing: p.facing }); }
        status.textContent = "Claude is looking at the photos. This usually takes 20–60 seconds…";
        const res = await analysePhotos(T.P, room, chosen, sample, ctl.signal);
        const next = clone(T.state); next.rooms = next.rooms || {};
        const prevPatch = next.rooms[room.id] || {};
        next.rooms[room.id] = {
          furnishing: res.count ? res.furnishing : prevPatch.furnishing,
          photos: (prevPatch.photos || []).concat(ups),
          floorClass: res.floorClass || prevPatch.floorClass || null,
        };
        const r = await T.applyState(next, room.id);
        status.textContent = (res.count ? `${room.name} refurnished: ${describe(res.furnishing)}.` : `No furniture recognised, so the furniture is unchanged; the photos were added to the ${room.name.toLowerCase()}.`) +
          (r.saved ? "" : " This change couldn’t be saved, so it will be lost when you leave.");
        undoButton(status, r.prev);
        files.value = ""; chosen = []; list.replaceChildren();
      } catch (e) { status.textContent = errorText(e, limits); }
      finally { busy(false, "photos"); ctl = null; }
    });

    planIn.addEventListener("change", () => { planGo.disabled = !planIn.files.length; planStatus.textContent = ""; });
    planGo.addEventListener("click", async () => {
      const file = planIn.files[0];
      if (!file) return;
      ctl = new AbortController(); busy(true, "plan");
      try {
        const built = await planFromImage(file, sample, assets, (t) => (planStatus.textContent = t), ctl.signal);
        const r = await T.applyState({ plan: built.plan, rooms: {} }, built.plan.startRoom);
        planStatus.textContent = `Built ${built.summary.rooms} rooms from the plan.` + (built.summary.scaleKnown ? "" : " No room sizes were printed, so the scale is estimated.") + (r.saved ? "" : " This change couldn’t be saved, so it will be lost when you leave.");
        undoButton(planStatus, r.prev);
        planIn.value = "";
      } catch (e) { planStatus.textContent = errorText(e, limits); }
      finally { busy(false, "plan"); ctl = null; }
    });

    // two-step reset
    let armed = false;
    reset.addEventListener("click", async () => {
      if (!armed) { armed = true; reset.textContent = "Remove all your changes? Select again to confirm"; setTimeout(() => { armed = false; reset.textContent = "Go back to the original listing"; }, 5000); return; }
      armed = false; reset.textContent = "Go back to the original listing";
      const r = await T.applyState({ plan: null, rooms: {} });
      planStatus.textContent = r.saved ? "Back to the original listing." : "Back to the original listing here, but it couldn’t be saved.";
      undoButton(planStatus, r.prev);
    });
  }
  T.on("tour:ready", setup, { persistent: true });

  // exposed for testing and the README
  T.uploadsInternals = { tracePlan, buildModel, starter, analysePhotos, planFromImage, toFurnishing, ITEM_TYPES };
})();
