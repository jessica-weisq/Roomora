/* Veduta embed. The Veduta website opens the tour in a frame (tour/index.html?embed=1) and sends the
   project once the tour says hello:
     { projectId, title, address, planImage (URL or null), planIsImage,
       plan: { width, depth, rooms: [{ id, name, x, y, width, depth }] }   // metres, origin top-left
       photos: { roomId: [{ id, url, name }] }, panoramas: { roomId: url }, modelUrl, mapsKey, startRoom }
   The tour builds a walkable flat from it: walls traced from the plan image when that lines up with the
   room sizes, otherwise drawn from the room rectangles with doorways and windows. Starter furniture by
   room type; "Furnish from photos" asks the website, which asks Veduta's backend (POST /api/furnish).
   MASt3R room scans from the build's .glb are placed in the walk when there is one. */
(function () {
  const T = window.Tour;
  T.isEmbed = new URLSearchParams(location.search).has("embed");
  if (!T.isEmbed) return;

  // ---- talking to the website (same origin only) ----
  const origin = location.origin;
  const post = (msg) => window.parent.postMessage(msg, origin);
  const pending = new Map();
  let seq = 0, gotProject = null;
  window.addEventListener("message", (e) => {
    if (e.origin !== origin || e.source !== window.parent || !e.data || typeof e.data !== "object") return;
    const m = e.data;
    if (m.type === "veduta:project" && gotProject) gotProject(m.project);
    if (m.type === "veduta:reply" && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.reject(m.error); else p.resolve(m.result);
    }
  });
  T.embedRequest = (type, data) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    post(Object.assign({ type, id }, data));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject({ message: "The website didn’t answer." }); } }, 180000);
  });
  T.waitForVeduta = () => new Promise((resolve) => { gotProject = resolve; post({ type: "veduta:hello" }); });

  // ---- rooms ----
  const TYPES = [
    [/bed|nursery|guest/i, "bedroom"], [/bath|shower|wc|toilet|cloak|en.?suite|powder/i, "bathroom"],
    [/kitchen/i, "kitchen"], [/dining/i, "dining"], [/living|reception|lounge|sitting|family|drawing|snug|tv|media/i, "living"],
    [/study|office|library/i, "study"], [/hall|landing|corridor|entrance|lobby|foyer|stair/i, "hall"],
    [/wardrobe|dressing|closet/i, "wardrobe"], [/utility|laundry|boot/i, "utility"],
    [/terrace|balcony|garden|patio|deck|roof/i, "terrace"],
  ];
  const typeOf = (name) => { for (const [re, t] of TYPES) if (re.test(name)) return t; return "other"; };
  const FLOOR = { bedroom: 3, bathroom: 4, kitchen: 6, utility: 6, wardrobe: 7, terrace: 5 };

  // walls from the room rectangles: shared edges get a doorway, outside edges get windows
  function syntheticModel(plan, rooms) {
    const mpp = 0.04, CELL = 2, cm = mpp * CELL, margin = Math.round(1 / mpp);
    const W = Math.ceil(plan.width / mpp) + 2 * margin, H = Math.ceil(plan.depth / mpp) + 2 * margin;
    const GW = Math.floor(W / CELL), GH = Math.floor(H / CELL), g = new Uint8Array(GW * GH);
    const c = (m, off) => Math.round((m / mpp + off) / CELL);
    const boxes = rooms.map((r) => ({ r, x0: c(r.src.x, margin), y0: c(r.src.y, margin), x1: c(r.src.x + r.src.width, margin), y1: c(r.src.y + r.src.depth, margin) }));
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < GW && y < GH) g[y * GW + x] = v; };
    // floors, biggest first so rooms drawn inside others stay visible
    [...boxes].sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0)).forEach((b) => {
      for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) set(x, y, FLOOR[b.r.type] || 2);
    });
    // walls: a 2-cell border inside each indoor room (terraces stay open)
    boxes.forEach((b) => {
      if (b.r.type === "terrace") return;
      for (let x = b.x0; x < b.x1; x++) { set(x, b.y0, 1); set(x, b.y1 - 1, 1); }
      for (let y = b.y0; y < b.y1; y++) { set(b.x0, y, 1); set(b.x1 - 1, y, 1); }
    });
    const doorCells = Math.round(0.9 / cm), winCells = Math.round(1.3 / cm), gap = Math.round(3 / cm);
    const floorOf = (b) => FLOOR[b.r.type] || 2;
    // doorways where two rooms share at least a metre of wall
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const vert = Math.abs(a.x1 - b.x0) <= 1 || Math.abs(b.x1 - a.x0) <= 1;
      const horiz = Math.abs(a.y1 - b.y0) <= 1 || Math.abs(b.y1 - a.y0) <= 1;
      if (vert) {
        const lo = Math.max(a.y0, b.y0) + 2, hi = Math.min(a.y1, b.y1) - 2;
        if (hi - lo < doorCells + 2) continue;
        const mid = Math.round((lo + hi) / 2), xa = a.x1 <= b.x0 + 1 ? a.x1 - 1 : a.x0, xb = a.x1 <= b.x0 + 1 ? b.x0 : b.x1 - 1;
        for (let y = mid - (doorCells >> 1); y < mid + (doorCells >> 1); y++) { set(xa, y, floorOf(a)); set(xb, y, floorOf(b)); }
      } else if (horiz) {
        const lo = Math.max(a.x0, b.x0) + 2, hi = Math.min(a.x1, b.x1) - 2;
        if (hi - lo < doorCells + 2) continue;
        const mid = Math.round((lo + hi) / 2), ya = a.y1 <= b.y0 + 1 ? a.y1 - 1 : a.y0, yb = a.y1 <= b.y0 + 1 ? b.y0 : b.y1 - 1;
        for (let x = mid - (doorCells >> 1); x < mid + (doorCells >> 1); x++) { set(x, ya, floorOf(a)); set(x, yb, floorOf(b)); }
      }
    }
    // windows on outside walls: wall cells with outside directly beyond them
    const outsideBeyond = (x, y, dx, dy) => { const nx = x + dx, ny = y + dy; return nx < 0 || ny < 0 || nx >= GW || ny >= GH || g[ny * GW + nx] === 0; };
    boxes.forEach((b) => {
      if (b.r.type === "terrace" || b.r.type === "bathroom" || b.r.type === "wardrobe") return;
      const runs = [
        { n: b.x1 - b.x0, at: (k) => [b.x0 + k, b.y0], d: [0, -1] }, { n: b.x1 - b.x0, at: (k) => [b.x0 + k, b.y1 - 1], d: [0, 1] },
        { n: b.y1 - b.y0, at: (k) => [b.x0, b.y0 + k], d: [-1, 0] }, { n: b.y1 - b.y0, at: (k) => [b.x1 - 1, b.y0 + k], d: [1, 0] },
      ];
      // windows centred on each stretch of outside wall: one per 3.2 m or so, never more than half the wall
      for (const run of runs) {
        let k = 4;
        while (k < run.n - 4) {
          const isOut = (j) => { const [x, y] = run.at(j); return outsideBeyond(x, y, run.d[0], run.d[1]); };
          if (!isOut(k)) { k++; continue; }
          let e = k; while (e < run.n - 4 && isOut(e)) e++;
          const L = e - k;
          if (L >= winCells + 4) {
            const n = Math.max(1, Math.min(Math.floor((L * cm) / 3.2), Math.floor(L / (winCells * 2))));
            for (let i = 0; i < n; i++) {
              const mid = k + Math.round((L * (i + 0.5)) / n), s0 = mid - (winCells >> 1);
              for (let t = 0; t < winCells; t++) { const [x, y] = run.at(s0 + t); set(x, y, 0); }
            }
          }
          k = e;
        }
      }
    });
    boxes.forEach((b) => { b.r.px = [b.x0 * CELL, b.y0 * CELL, b.x1 * CELL, b.y1 * CELL]; b.r.area = (b.x1 - b.x0) * (b.y1 - b.y0); });
    return { tr: { w: GW * CELL, h: GH * CELL, GW, GH, CELL, g }, mpp, origin: [margin * mpp, margin * mpp] };
  }

  // ---- walls traced from the plan image, lined up with the rooms the AI measured ----
  // The AI's rooms (metres) and the traced drawing (pixels) never line up exactly: the AI's positions are
  // estimates, and screenshots carry borders, labels and dimension lines. So: find the scale and offset that
  // put the most room edges on traced walls, then snap each room edge to the nearest wall line. If the rooms
  // still don't sit on the walls, the trace isn't trusted and the walls are drawn from the rooms instead,
  // because walls through the middle of rooms and glass round the edges are worse than clean, simple walls.
  const TRACE_MIN = 0.55;   // share of room-edge length that must lie on traced walls

  // distance, in cells, from every cell to the nearest wall or edge of the building (capped). The building's
  // edge counts because windows, glazing and terraces are drawn with thin lines, not solid walls.
  function wallDistance(tr) {
    const { GW, GH, CELL, g } = tr;
    const CAP = 12, dist = new Uint8Array(GW * GH).fill(CAP), queue = [];
    const edgeOfBuilding = (i) => {
      if (g[i] !== 0) return false;
      const x = i % GW, y = (i / GW) | 0;
      return (x > 0 && g[i - 1] >= 2) || (x < GW - 1 && g[i + 1] >= 2) || (y > 0 && g[i - GW] >= 2) || (y < GH - 1 && g[i + GW] >= 2);
    };
    for (let i = 0; i < g.length; i++) if (g[i] === 1 || edgeOfBuilding(i)) { dist[i] = 0; queue.push(i); }
    if (!queue.length) return null;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], d = dist[i] + 1;
      if (d >= CAP) continue;
      const x = i % GW, y = (i / GW) | 0;
      if (x > 0 && dist[i - 1] > d) { dist[i - 1] = d; queue.push(i - 1); }
      if (x < GW - 1 && dist[i + 1] > d) { dist[i + 1] = d; queue.push(i + 1); }
      if (y > 0 && dist[i - GW] > d) { dist[i - GW] = d; queue.push(i - GW); }
      if (y < GH - 1 && dist[i + GW] > d) { dist[i + GW] = d; queue.push(i + GW); }
    }
    return (px, py) => { const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL); return cx < 0 || cy < 0 || cx >= GW || cy >= GH ? CAP : dist[cy * GW + cx]; };
  }

  // The spaces the walls enclose, with doorways closed off: walls are thickened by about half a doorway, so a
  // room's openings seal and each room becomes its own patch of floor. Bathrooms, en suites and WCs are small,
  // fully walled spaces, which is exactly what this finds well (and what a rough box round them gets wrong).
  function enclosedSpaces(tr, mpp) {
    const { GW, GH, CELL, g } = tr;
    const k = Math.max(1, Math.round(0.5 / (CELL * mpp)));
    const sealed = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (g[y * GW + x] !== 1) continue;
      for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < GW && ny < GH && dx * dx + dy * dy <= k * k) sealed[ny * GW + nx] = 1;
      }
    }
    const lab = new Int32Array(GW * GH).fill(-1), spaces = [], st = [];
    for (let s = 0; s < GW * GH; s++) {
      if (lab[s] >= 0 || sealed[s] || g[s] < 2) continue;
      const id = spaces.length, sp = { x0: GW, y0: GH, x1: -1, y1: -1, n: 0 };
      lab[s] = id; st.push(s);
      while (st.length) {
        const i = st.pop(), x = i % GW, y = (i / GW) | 0;
        sp.n++; if (x < sp.x0) sp.x0 = x; if (x > sp.x1) sp.x1 = x; if (y < sp.y0) sp.y0 = y; if (y > sp.y1) sp.y1 = y;
        for (const j of [x > 0 ? i - 1 : -1, x < GW - 1 ? i + 1 : -1, y > 0 ? i - GW : -1, y < GH - 1 ? i + GW : -1])
          if (j >= 0 && lab[j] < 0 && !sealed[j] && g[j] >= 2) { lab[j] = id; st.push(j); }
      }
      spaces.push(sp);
    }
    // grow each space back out to its walls: side by side, only as far as the floor goes (at most the
    // thickening), because a side bounded by a window or open edge was never trimmed in the first place
    const floorAt = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && g[y * GW + x] >= 2;
    // for each side: along every row (or column) of the space, where its floor ends on that side, plus how much
    // further the floor goes (at most the thickening); the side sits at the median of those, so a doorway's
    // bulge or a notch doesn't drag it
    const sideAt = (sp, dx, dy) => {
      const vals = [];
      if (dx) for (let y = sp.y0; y <= sp.y1; y++) {
        let x = -1;
        if (dx < 0) { for (let i = sp.x0; i <= sp.x1; i++) if (lab[y * GW + i] === sp.id) { x = i; break; } }
        else { for (let i = sp.x1; i >= sp.x0; i--) if (lab[y * GW + i] === sp.id) { x = i; break; } }
        if (x < 0) continue;
        let n = 0; while (n < k && floorAt(x + dx * (n + 1), y)) n++;
        vals.push(dx < 0 ? x - n : x + 1 + n);
      } else for (let x = sp.x0; x <= sp.x1; x++) {
        let y = -1;
        if (dy < 0) { for (let i = sp.y0; i <= sp.y1; i++) if (lab[i * GW + x] === sp.id) { y = i; break; } }
        else { for (let i = sp.y1; i >= sp.y0; i--) if (lab[i * GW + x] === sp.id) { y = i; break; } }
        if (y < 0) continue;
        let n = 0; while (n < k && floorAt(x, y + dy * (n + 1))) n++;
        vals.push(dy < 0 ? y - n : y + 1 + n);
      }
      vals.sort((p, q) => p - q);
      return vals[vals.length >> 1];
    };
    spaces.forEach((sp, id) => {
      sp.id = id;
      sp.px = [sideAt(sp, -1, 0) * CELL, sideAt(sp, 0, -1) * CELL, sideAt(sp, 1, 0) * CELL, sideAt(sp, 0, 1) * CELL];
    });
    return { lab, spaces, GW, GH, CELL };
  }
  const areaOf = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const iou = (a, b) => { const i = areaOf([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]); return i / (areaOf(a) + areaOf(b) - i || 1); };

  // From rooms roughly placed on the drawing (r.px), finish the fit: each room takes the enclosed space it
  // clearly matches, then every edge snaps to the nearest wall line. Returns the share of edge length on walls.
  function finishFit(tr, rooms, mpp, near) {
    const { CELL } = tr;
    // 1. enclosed spaces, matched one-to-one, best matches first
    const E = enclosedSpaces(tr, mpp), pairs = [];
    rooms.forEach((r, ri) => {
      if (r.type === "terrace") return;
      const [x0, y0, x1, y1] = r.px, tally = new Map();
      for (let y = Math.max(0, Math.floor(y0 / CELL)); y < Math.min(E.GH, Math.ceil(y1 / CELL)); y++)
        for (let x = Math.max(0, Math.floor(x0 / CELL)); x < Math.min(E.GW, Math.ceil(x1 / CELL)); x++) {
          const l = E.lab[y * E.GW + x]; if (l >= 0) tally.set(l, (tally.get(l) || 0) + 1);
        }
      const mx = Math.floor((x0 + x1) / 2 / CELL), my = Math.floor((y0 + y1) / 2 / CELL);
      const atMiddle = mx >= 0 && my >= 0 && mx < E.GW && my < E.GH ? E.lab[my * E.GW + mx] : -1;
      tally.forEach((_, l) => {
        const sp = E.spaces[l], ratio = areaOf(sp.px) / (areaOf(r.px) || 1);
        // a space much bigger than the room is open-plan, or the room's walls have gaps: don't take it
        if (ratio > 1.8) return;
        // each side may move in a good way (a box that swallowed an en suite shrinks back), but only a little
        // way out: a box is rarely too small by much, so a space reaching far past it is a different room
        const w = x1 - x0, h = y1 - y0, outW = Math.max(0.5 / mpp, 0.2 * w), outH = Math.max(0.5 / mpp, 0.2 * h);
        const [s0, t0, s1, t1] = sp.px;
        if (x0 - s0 > outW || s1 - x1 > outW || y0 - t0 > outH || t1 - y1 > outH) return;
        if (s0 - x0 > 0.45 * w || x1 - s1 > 0.45 * w || t0 - y0 > 0.45 * h || y1 - t1 > 0.45 * h) return;
        let score = iou(r.px, sp.px);
        // a small room's box can be off by a good share of its size: the space under the box's middle, if it's
        // about the same size, is still the room
        if (l === atMiddle && ratio >= 0.4) score = Math.max(score, 0.5) + 0.1;
        if (score >= 0.5) pairs.push({ ri, l, score });
      });
    });
    pairs.sort((a, b) => b.score - a.score);
    const usedRoom = new Set(), usedSpace = new Set();
    let matched = 0;
    for (const p of pairs) {
      if (usedRoom.has(p.ri) || usedSpace.has(p.l)) continue;
      usedRoom.add(p.ri); usedSpace.add(p.l); matched++;
      rooms[p.ri].px = E.spaces[p.l].px.slice();
    }
    // 2. snap each edge to the wall line nearest it
    const lineScore = (horiz, at, from, to) => {
      const n = Math.max(2, Math.round(Math.abs(to - from) / CELL)); let hit = 0;
      for (let k = 0; k <= n; k++) { const t = from + ((to - from) * k) / n; if ((horiz ? near(t, at) : near(at, t)) <= 1) hit++; }
      return hit / (n + 1);
    };
    const minPx = 1 / mpp, reach = 0.45 / mpp;
    let total = 0, onWall = 0;
    rooms.forEach((r) => {
      let [rx0, ry0, rx1, ry1] = r.px;
      const snap = (horiz, at, from, to, lo, hi) => {
        let bestAt = at, bestS = lineScore(horiz, at, from, to);
        const base = bestS;
        for (let d = -reach; d <= reach; d += CELL / 2) {
          const a = at + d; if (a < lo || a > hi) continue;
          const s = lineScore(horiz, a, from, to);
          if (s > bestS + 1e-9 || (Math.abs(s - bestS) < 1e-9 && Math.abs(d) < Math.abs(bestAt - at))) { bestS = s; bestAt = a; }
        }
        return bestS >= base + 0.15 ? [bestAt, bestS] : [at, base];
      };
      const sides = [];
      let s;
      [ry0, s] = snap(true, ry0, rx0, rx1, -Infinity, ry1 - minPx); sides.push([s, rx1 - rx0]);
      [ry1, s] = snap(true, ry1, rx0, rx1, ry0 + minPx, Infinity); sides.push([s, rx1 - rx0]);
      [rx0, s] = snap(false, rx0, ry0, ry1, -Infinity, rx1 - minPx); sides.push([s, ry1 - ry0]);
      [rx1, s] = snap(false, rx1, ry0, ry1, rx0 + minPx, Infinity); sides.push([s, ry1 - ry0]);
      sides.forEach(([sc, len]) => { onWall += sc * len; total += len; });
      r.px = [rx0, ry0, rx1, ry1];
      r.area = (rx1 - rx0) * (ry1 - ry0);
    });
    return { quality: total ? onWall / total : 0, matched };
  }

  // Rooms with boxes from the vision model: put them straight on the drawing; the scale comes from their
  // sizes in metres over their sizes on the drawing.
  function alignFromBoxes(tr, plan, rooms) {
    const near = wallDistance(tr);
    if (!near) return null;
    const W = tr.w, H = tr.h, ratios = [];   // the boxes are fractions of the image, which the trace keeps the shape of
    rooms.forEach((r) => {
      const [bx0, by0, bx1, by1] = r.src.box;
      r.px = [bx0 * W, by0 * H, bx1 * W, by1 * H];
      if (r.px[2] - r.px[0] > 4) ratios.push(r.src.width / (r.px[2] - r.px[0]));
      if (r.px[3] - r.px[1] > 4) ratios.push(r.src.depth / (r.px[3] - r.px[1]));
    });
    if (!ratios.length) return null;
    ratios.sort((a, b) => a - b);
    const mpp = ratios[ratios.length >> 1];
    const offs = rooms.map((r) => [r.px[0] - r.src.x / mpp, r.px[1] - r.src.y / mpp]);
    const med = (k) => offs.map((o) => o[k]).sort((a, b) => a - b)[offs.length >> 1];
    const fit = finishFit(tr, rooms, mpp, near);
    return { mpp, ox: med(0), oy: med(1), quality: fit.quality, matched: fit.matched, how: "boxes" };
  }

  // Rooms in metres only: search for the scale and offset that put the most room edges on traced walls.
  function alignToTrace(tr, plan, rooms) {
    const { GW, GH, CELL, g } = tr;
    const near = wallDistance(tr);
    if (!near) return null;
    // points along every room edge, in metres
    const samples = (step) => {
      const out = [];
      rooms.forEach((r) => {
        const { x, y, width: w, depth: d } = r.src;
        [[x, y, x + w, y], [x, y + d, x + w, y + d], [x, y, x, y + d], [x + w, y, x + w, y + d]].forEach(([ax, ay, bx, by]) => {
          const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / step));
          for (let k = 0; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
        });
      });
      return out;
    };
    const fine = samples(0.12), coarse = samples(0.4);
    const score = (pts, mpp, ox, oy, tol) => { let hit = 0; for (const [mx, my] of pts) if (near(ox + mx / mpp, oy + my / mpp) <= tol) hit++; return hit / pts.length; };
    // first guess: the building's outline matched to the plan's size
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (g[y * GW + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 < 0) return null;
    const bw = (x1 - x0 + 1) * CELL, bh = (y1 - y0 + 1) * CELL;
    const guess = (plan.width / bw + plan.depth / bh) / 2;
    let best = { s: 0 };
    const scales = (m, lo, hi, step) => { const out = []; for (let k = lo; k <= hi + 1e-9; k += step) out.push(m * k); return out; };
    const search = (mpps, cxPx, cyPx, range, stepM, pts, tol) => {
      for (const mpp of mpps) {
        const step = stepM / mpp, R = range / mpp;
        const bx = cxPx - plan.width / 2 / mpp, by = cyPx - plan.depth / 2 / mpp;
        for (let dx = -R; dx <= R + 1e-6; dx += step) for (let dy = -R; dy <= R + 1e-6; dy += step) {
          const s = score(pts, mpp, bx + dx, by + dy, tol);
          if (s > best.s) best = { s, mpp, ox: bx + dx, oy: by + dy };
        }
      }
    };
    const cx = ((x0 + x1 + 1) / 2) * CELL, cy = ((y0 + y1 + 1) / 2) * CELL;
    search(scales(guess, 0.85, 1.15, 0.025), cx, cy, 1.5, 0.25, coarse, 2);
    if (best.s < 0.5) search(scales(guess, 0.5, 1.6, 0.05), cx, cy, Math.max(plan.width, plan.depth) * 0.6, 0.5, coarse, 3);
    if (!best.mpp) return null;
    const b0 = best;
    best = { s: 0 };
    for (const mpp of scales(b0.mpp, 0.97, 1.03, 0.005)) {
      const cxp = b0.ox + plan.width / 2 / b0.mpp, cyp = b0.oy + plan.depth / 2 / b0.mpp;
      const bx = cxp - plan.width / 2 / mpp, by = cyp - plan.depth / 2 / mpp, R = 0.3 / mpp;
      for (let dx = -R; dx <= R + 1e-6; dx += CELL) for (let dy = -R; dy <= R + 1e-6; dy += CELL) {
        const s = score(fine, mpp, bx + dx, by + dy, 1);
        if (s > best.s) best = { s, mpp, ox: bx + dx, oy: by + dy };
      }
    }
    const { mpp, ox, oy } = best;
    rooms.forEach((r) => { r.px = [ox + r.src.x / mpp, oy + r.src.y / mpp, ox + (r.src.x + r.src.width) / mpp, oy + (r.src.y + r.src.depth) / mpp]; });
    const fit = finishFit(tr, rooms, mpp, near);
    return { mpp, ox, oy, quality: fit.quality, matched: fit.matched, fit: best.s, how: "search" };
  }

  async function tracedModel(url, plan, rooms) {
    const U = T.uploadsInternals;
    const img = await T.loadImage(url);
    const tr = await U.tracePlan(img);
    const copy = () => rooms.map((r) => Object.assign({}, r, { src: Object.assign({}, r.src) }));
    // boxes from the vision model first; the metre-only search if they fit worse (or there aren't any)
    let a = null, placed = null;
    if (rooms.length && rooms.every((r) => Array.isArray(r.src.box))) { const rs = copy(); a = alignFromBoxes(tr, plan, rs); placed = rs; }
    if (!a || a.quality < TRACE_MIN) {
      const rs = copy(), b = alignToTrace(tr, plan, rs);
      if (b && (!a || b.quality > a.quality)) { a = b; placed = rs; }
    }
    if (!a || a.quality < TRACE_MIN) {
      console.info(`Floor plan: walls drawn from the rooms (the traced drawing matched ${a ? Math.round(a.quality * 100) : 0}% of room edges)`);
      return null;
    }
    rooms.forEach((r, i) => { r.px = placed[i].px; r.area = placed[i].area; });
    console.info(`Floor plan: traced walls used (${Math.round(a.quality * 100)}% of room edges on walls; ${a.matched} of ${rooms.length} rooms matched to walled spaces; placed by ${a.how})`);
    return { tr, mpp: a.mpp, origin: [a.ox * a.mpp, a.oy * a.mpp], image: true, quality: a.quality };
  }

  // indoor floor area of the built flat, in square metres (terraces not included)
  function floorArea(model) {
    const g = T.decodeGrid(model.grid), cellM = model.cell * model.metresPerPx;
    let n = 0; for (let i = 0; i < g.length; i++) if (g[i] >= 2 && g[i] !== 5) n++;
    return n * cellM * cellM;
  }
  T.vedutaInternals = { alignToTrace, alignFromBoxes, tracedModel, enclosedSpaces, wallDistance, finishFit, syntheticModel: (...a) => syntheticModel(...a), autoViews: (...a) => autoViews(...a) };

  T.fromVeduta = async function (project) {
    const U = T.uploadsInternals;
    T.embedConfig = { mapsKey: project.mapsKey || "", projectId: project.projectId };
    const plan = project.plan;
    const rooms = plan.rooms.map((src) => ({ id: src.id, name: src.name, type: typeOf(src.name), src }));
    let built = null;
    if (project.planImage && project.planIsImage) { try { built = await tracedModel(project.planImage, plan, rooms); } catch { built = null; } }
    if (!built) built = syntheticModel(plan, rooms);
    const model = U.buildModel(built.tr, rooms, built.mpp);
    model.windows = "punched";   // ordinary windows (wall below the sill and above the head), not floor-to-ceiling glass
    const near = (a, b) => !(a.px[2] + 8 < b.px[0] || b.px[2] + 8 < a.px[0] || a.px[3] + 8 < b.px[1] || b.px[3] + 8 < a.px[1]);
    const photos = project.photos || {}, panos = project.panoramas || {};
    const scanned = (id) => project.modelUrl && (photos[id] || []).length > 0;
    const outRooms = rooms.map((r) => {
      const [x0, y0, x1, y1] = r.px.map((v) => Math.round(v));
      const big = r.src.width > 3.5 && r.src.depth > 3.5;
      // photos become 3D photos when the backend can make depth maps (GET /depth/{project}/{photo}.png)
      const far = Math.max(5, Math.hypot(r.src.width, r.src.depth) * 1.25);
      const media = (photos[r.id] || []).map((p) => Object.assign({ type: "photo", src: p.url, name: p.name },
        project.depthBase ? { depth: `${project.depthBase}/${encodeURIComponent(p.id)}.png`, depthRange: [0.8, far], hfov: 70 } : {}));
      if (panos[r.id]) media.push({ type: "pano", src: panos[r.id], label: "AI-generated 360° view" });
      return {
        id: r.id, name: r.name, floor: "plan", type: r.type,
        outline: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], media,
        links: rooms.filter((o) => o !== r && near(r, o)).map((o) => ({ to: o.id })),
        ceiling: big && (r.type === "living" || r.type === "bedroom") ? "tray" : undefined,
        scanned: scanned(r.id) || undefined,
      };
    });
    const pick = (types) => rooms.filter((r) => types.includes(r.type)).sort((a, b) => b.area - a.area)[0];
    const entry = (pick(["hall"]) || pick(["living"]) || rooms[0]).id;
    const start = (project.startRoom && rooms.find((r) => r.id === project.startRoom)) ? project.startRoom : (pick(["living"]) || rooms[0]).id;
    const area = rooms.filter((r) => r.type !== "terrace").reduce((s, r) => s + r.src.width * r.src.depth, 0);
    T.vedutaScan = project.modelUrl ? { url: project.modelUrl, origin: built.origin } : null;
    const property = {
      id: project.projectId || "veduta",
      address: project.title || "Your property",
      subtitle: `${rooms.length} rooms, about ${Math.round(floorArea(model) || area)} sq m`,
      streetAddress: project.address || "",
      location: {},
      north: Number.isFinite(plan.north) ? plan.north : undefined,   // from the plan's north arrow, if it has one
      exteriorPhoto: "",
      startView: "walk",
      entryRoom: entry, startRoom: start,
      floors: [{ id: "plan", name: "Floor plan", plan: built.image ? project.planImage : null, planSize: { w: built.tr.w, h: built.tr.h } }],
      rooms: outRooms, model,
      furnishing: rooms.flatMap((r) => U.starter(r, r.type, built.mpp)),
    };
    try { autoViews(property); } catch (e) { console.warn("Viewpoints couldn’t be worked out", e); }
    return property;
  };

  // ---- viewpoints, worked out from the walls and windows ----
  // Each room gets up to four: from the doorway, from the window, looking outside, and from the far corner,
  // the same kind of buttons the sample flat has hand-placed. Positions are plan pixels; deg 0 looks up the plan.
  const boxOf = (r) => { const xs = r.outline.map((p) => p[0]), ys = r.outline.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  function autoViews(P) {
    const M = P.model;
    if (!M || !M.grid) return;
    const G = T.decodeGrid(M.grid), GW = M.grid.w, GH = M.grid.h, C = M.cell, mpp = M.metresPerPx, m = (v) => v / mpp;
    const cellAt = (x, y) => { const cx = Math.floor(x / C), cy = Math.floor(y / C); return cx < 0 || cy < 0 || cx >= GW || cy >= GH ? 0 : G[cy * GW + cx]; };
    const isFloor = (x, y) => cellAt(x, y) >= 2;
    const clear = (x, y) => isFloor(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => isFloor(x + a * m(0.3), y + b * m(0.3)));
    const facing = (fx, fy, tx, ty) => Math.round((Math.atan2(-(tx - fx), -(ty - fy)) * 180) / Math.PI);
    for (const r of P.rooms) {
      if (r.views && r.views.length) continue;
      const [x0, y0, x1, y1] = boxOf(r), W = (x1 - x0) * mpp, D = (y1 - y0) * mpp;
      if (W < 1.6 || D < 1.6) continue;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, views = [];
      // a clear place to stand near (x, y): nudged towards the middle of the room until it's off the walls
      const spot = (x, y) => { for (let k = 0; k <= 10; k++) { const t = k * 0.06, px = x + (cx - x) * t, py = y + (cy - y) * t; if (clear(px, py)) return [px, py]; } return null; };
      const add = (label, at, look, pitch) => { if (at) views.push({ label, x: Math.round(at[0]), y: Math.round(at[1]), deg: look(at), pitch }); };
      // can you see from a to b without a wall in the way?
      const sees = (a, b) => { const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (C / 2))); for (let k = 0; k <= n; k++) if (!isFloor(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n)) return false; return true; };
      // the room's middle, or the nearest floor to it (an L-shaped room's middle can be in a wall)
      let mid = [cx, cy];
      if (!clear(cx, cy)) for (let r = C; r < Math.min(x1 - x0, y1 - y0) / 2 && !clear(mid[0], mid[1]); r += C)
        for (let a = 0; a < 16; a++) { const px = cx + Math.cos((a * Math.PI) / 8) * r, py = cy + Math.sin((a * Math.PI) / 8) * r; if (clear(px, py)) { mid = [px, py]; break; } }

      // doorways: places where the floor runs straight through the room's edge
      const sides = [{ n: [0, -1], ax: "x", e: y0 }, { n: [0, 1], ax: "x", e: y1 }, { n: [-1, 0], ax: "y", e: x0 }, { n: [1, 0], ax: "y", e: x1 }];
      const doors = [];
      for (const s of sides) {
        const lo = s.ax === "x" ? x0 : y0, hi = s.ax === "x" ? x1 : y1;
        let run = 0;
        for (let t = lo + m(0.25); t <= hi - m(0.25) + C; t += C) {
          let open = t <= hi - m(0.25);
          for (let d = -m(0.45); d <= m(0.45) && open; d += C / 2) {
            const px = s.ax === "x" ? t : s.e + s.n[0] * d, py = s.ax === "x" ? s.e + s.n[1] * d : t;
            if (!isFloor(px, py)) open = false;
          }
          if (open) run += C;
          else { if (run >= m(0.6)) doors.push({ len: run, mid: t - run / 2 - C / 2, s }); run = 0; }
        }
      }
      doors.sort((a, b) => b.len - a.len);
      // the first doorway you can stand just inside and see the room from
      let door = null;
      for (const d of doors) {
        const { s, mid: t } = d;
        const at = spot(s.ax === "x" ? t : s.e - s.n[0] * m(0.9), s.ax === "x" ? s.e - s.n[1] * m(0.9) : t);
        if (at && sees(at, mid)) { door = d; add("From the doorway", at, (p) => facing(p[0], p[1], mid[0], mid[1])); break; }
      }

      // windows: the longest run of glass on this room's edge
      const glass = (M.glass || []).map(([gx, gy, gw, gh]) => ({ x: (gx + gw / 2) * C, y: (gy + gh / 2) * C, len: Math.max(gw, gh) * C * mpp }))
        .filter((g) => g.len >= 0.5 && g.x > x0 - m(0.4) && g.x < x1 + m(0.4) && g.y > y0 - m(0.4) && g.y < y1 + m(0.4))
        .sort((a, b) => b.len - a.len);
      const win = glass[0];
      if (win) {
        const dist = [[win.y - y0, [0, -1]], [y1 - win.y, [0, 1]], [win.x - x0, [-1, 0]], [x1 - win.x, [1, 0]]].sort((a, b) => a[0] - b[0]);
        const n = dist[0][1];   // outward, towards the window
        const from = spot(win.x - n[0] * m(1.0), win.y - n[1] * m(1.0));
        if (from && sees(from, mid)) add("From the window", from, (p) => facing(p[0], p[1], mid[0], mid[1]));
        const out = spot(win.x - n[0] * m(0.7), win.y - n[1] * m(0.7));
        add("Looking outside", out, (p) => facing(p[0], p[1], p[0] + n[0], p[1] + n[1]), 0);
      }

      // the far corner of a bigger room, away from where you come in
      if (W >= 3 && D >= 3) {
        const ref = door ? [door.s.ax === "x" ? door.mid : door.s.e, door.s.ax === "x" ? door.s.e : door.mid] : win ? [win.x, win.y] : [x0, y0];
        const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].sort((a, b) => Math.hypot(b[0] - ref[0], b[1] - ref[1]) - Math.hypot(a[0] - ref[0], a[1] - ref[1]));
        for (const [kx, ky] of corners.slice(0, 2)) {
          const at = spot(kx + Math.sign(cx - kx) * m(0.8), ky + Math.sign(cy - ky) * m(0.8));
          if (at && sees(at, mid)) { add("From the far corner", at, (p) => facing(p[0], p[1], mid[0], mid[1])); break; }
        }
      }
      if (views.length) r.views = views;
    }
  }

  // ---- artwork: pictures cut out of the photos and hung on the walls ----
  async function artPieces(P, room, res) {
    const list = res && Array.isArray(res.art) ? res.art : [];
    if (!list.length || !P.model) return [];
    const photos = room.media.filter((x) => x.type === "photo");
    const M = P.model, G = T.decodeGrid(M.grid), GW = M.grid.w, GH = M.grid.h, C = M.cell, mpp = M.metresPerPx;
    const cellAt = (x, y) => { const cx = Math.floor(x / C), cy = Math.floor(y / C); return cx < 0 || cy < 0 || cx >= GW || cy >= GH ? -1 : G[cy * GW + cx]; };
    const [x0, y0, x1, y1] = boxOf(room), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const DIR = { up: [0, -1, 0], down: [0, 1, 180], left: [-1, 0, 90], right: [1, 0, 270] };   // [dx, dy, rot facing into the room]
    const placed = [], out = [];
    // the wall face along a line from the middle of the room; null if it's a window or open
    const wallFace = (wall, along) => {
      const [dx, dy] = DIR[wall];
      let x = dx ? cx : x0 + along * (x1 - x0), y = dy ? cy : y0 + along * (y1 - y0);
      const reach = 0.5 / mpp;   // stay in this room: don't follow a doorway into the next one
      for (let i = 0; i < 4000; i++) {
        if (x < x0 - reach || x > x1 + reach || y < y0 - reach || y > y1 + reach) return null;
        const v = cellAt(x + dx, y + dy);
        if (v === 1) {   // wall: hang on the face we reached
          const cxl = Math.floor((x + dx) / C), cyl = Math.floor((y + dy) / C);
          if (dx > 0) x = cxl * C; else if (dx < 0) x = (cxl + 1) * C;
          if (dy > 0) y = cyl * C; else if (dy < 0) y = (cyl + 1) * C;
          return [x, y];
        }
        if (v < 2) return null;   // glass, outside or off the plan
        x += dx; y += dy;
      }
      return null;
    };
    for (const a of list) {
      const ph = photos[(a.photo | 0) - 1];
      if (!ph || !DIR[a.wall] || !Array.isArray(a.box)) continue;
      let img;
      try { img = await T.loadImage(ph.src); } catch (e) { continue; }
      const IW = img.naturalWidth || img.width, IH = img.naturalHeight || img.height;
      let [bx0, by0, bx1, by1] = a.box.map(Number);
      const ix = (bx1 - bx0) * 0.03, iy = (by1 - by0) * 0.03;   // trim to just inside the frame
      bx0 += ix; bx1 -= ix; by0 += iy; by1 -= iy;
      const sw = (bx1 - bx0) * IW, sh = (by1 - by0) * IH;
      if (!(sw >= 24 && sh >= 24)) continue;
      const k = Math.min(1, 640 / Math.max(sw, sh)), c = document.createElement("canvas");
      c.width = Math.round(sw * k); c.height = Math.round(sh * k);
      c.getContext("2d").drawImage(img, bx0 * IW, by0 * IH, sw, sh, 0, 0, c.width, c.height);
      let src;
      try { src = c.toDataURL("image/jpeg", 0.88); } catch (e) { continue; }   // a photo from another site can't be read
      const r2 = (v) => Math.round(v * 100) / 100;
      const w = r2(Math.min(2.4, Math.max(0.25, a.w || 0.6))), h = r2(Math.min(2, Math.max(0.25, a.h || w * (sh / sw))));
      // where along the wall, kept off the corners, moved along if it would overlap another picture or meet a window
      // the wall it was seen on first; if that's all windows or full, the opposite wall, then the other two
      const OPP = { up: "down", down: "up", left: "right", right: "left" };
      const walls = [a.wall, OPP[a.wall]].concat(Object.keys(DIR).filter((k) => k !== a.wall && k !== OPP[a.wall]));
      let at = null, along = 0.12 + 0.76 * (Number(a.at) || 0.5), wall = a.wall;
      for (const wl of walls) {
        const span = (wl === "up" || wl === "down" ? x1 - x0 : y1 - y0) * mpp;
        for (const shift of [0, 0.05, -0.05, 0.1, -0.1, 0.15, -0.15, 0.2, -0.2, 0.25, -0.25, 0.3, -0.3, 0.35, -0.35, 0.4, -0.4]) {
          const t = Math.min(0.9, Math.max(0.1, along + shift));
          const busy = placed.some((p) => p.wall === wl && Math.abs(p.t - t) * span < (p.w + w) / 2 + 0.15);
          const face = !busy && wallFace(wl, t);
          if (face) { at = face; along = t; wall = wl; break; }
        }
        if (at) break;
      }
      if (!at) continue;
      placed.push({ wall, t: along, w });
      const elev = Math.min((M.wallHeight || 2.7) - 0.15 - h / 2, Math.max(1.5, 0.85 + h / 2));
      out.push({ room: room.id, type: "art", x: Math.round(at[0] * 10) / 10, y: Math.round(at[1] * 10) / 10, rot: DIR[wall][2], src, w, h, elev, fromPhoto: true });
    }
    return out;
  }

  // ---- after each build of the tour: room scans, and "Furnish from photos" ----
  let scanScene = null, scanLoading = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => { const s = document.createElement("script"); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); });
  }
  // The raw MASt3R scans are rough (torn surfaces, stray fragments), so they're off unless asked for.
  let showScans = false;
  try { showScans = localStorage.getItem("tour-scans") === "on"; } catch (e) {}
  function addScanButton() {
    const style = document.querySelector(".view-walk .w3-style");
    if (!T.vedutaScan || !style || style.querySelector(".w3-scans")) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "w3-deco w3-scans";
    const label = () => { b.textContent = showScans ? "Hide 3D scan" : "Show 3D scan"; b.setAttribute("aria-pressed", String(showScans)); };
    label();
    b.addEventListener("click", () => {
      showScans = !showScans; label();
      try { localStorage.setItem("tour-scans", showScans ? "on" : "off"); } catch (e) {}
      const w3 = T.__w3;
      if (w3 && w3.scans) { w3.scans.visible = showScans; w3.renderer.shadowMap.needsUpdate = true; } else if (showScans) placeScans();
    });
    style.insertBefore(b, style.querySelector("p"));
  }
  async function placeScans() {
    const scan = T.vedutaScan, w3 = T.__w3;
    if (!scan || !w3 || !showScans) return;
    const THREE = w3.THREE;
    if (!scanLoading) scanLoading = (async () => {
      if (!THREE.GLTFLoader) await loadScript(new URL("vendor/GLTFLoader-r128.js", document.baseURI).href);
      const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(scan.url, res, undefined, rej));
      // the .glb also holds plan floors and walls; the walk has its own, so keep only the scans
      const keep = [];
      gltf.scene.traverse((o) => { if (/^scan__/.test(o.name)) keep.push(o); });
      const group = new THREE.Group();
      keep.forEach((o) => { o.updateMatrixWorld(true); const c = o.clone(); c.applyMatrix4(o.parent ? o.parent.matrixWorld : new THREE.Matrix4()); group.add(c); });
      group.traverse((m) => { if (m.isMesh) { m.material.side = THREE.DoubleSide; m.castShadow = true; m.receiveShadow = true; } });
      return group;
    })().catch((e) => { console.warn("Room scans couldn’t load", e); return null; });
    scanScene = await scanLoading;
    if (!scanScene || T.__w3 !== w3) return;
    const g = scanScene.clone();
    g.position.set(scan.origin[0], 0, scan.origin[1]);
    w3.scene.add(g);
    w3.scans = g;
    w3.renderer.shadowMap.needsUpdate = true;
  }

  // the message after furnishing outlives the rebuild that applies the furniture
  let lastNote = "";
  function showNote() {
    const n = document.querySelector(".view-walk .w3-furnish-note");
    if (n && lastNote) { n.hidden = false; n.textContent = lastNote; }
  }
  function addFurnishButton() {
    const P = T.P, style = document.querySelector(".view-walk .w3-style");
    if (!P || !style || style.querySelector(".w3-furnish")) return;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "w3-deco w3-furnish"; btn.textContent = "Furnish from photos";
    const note = document.createElement("p"); note.className = "w3-furnish-note"; note.hidden = true;
    style.insertBefore(btn, style.querySelector("p")); style.appendChild(note);
    let roomId = null;
    const update = (id) => {
      roomId = id;
      const room = T.roomById(T.P, id);
      const n = room ? room.media.filter((m) => m.type === "photo").length : 0;
      btn.hidden = !n; btn.textContent = "Furnish from photos";
    };
    T.on("tour:room", ({ roomId: id }) => update(id));
    btn.addEventListener("click", async () => {
      const room = T.roomById(T.P, roomId);
      if (!room) return;
      btn.disabled = true; btn.textContent = "Looking at the photos…"; note.hidden = true;
      try {
        const res = await T.embedRequest("veduta:furnish", { roomId: room.id });
        const out = T.uploadsInternals.toFurnishing(T.P, room, res);
        const art = await artPieces(T.P, room, res);
        out.furnishing = out.furnishing.concat(art);
        const next = JSON.parse(JSON.stringify(T.state || { rooms: {} }));
        next.rooms = next.rooms || {};
        next.rooms[room.id] = Object.assign({}, next.rooms[room.id], { furnishing: out.furnishing.length ? out.furnishing : undefined, floorClass: out.floorClass, wallColor: out.wallColor || undefined });
        await T.applyState(next, room.id);
        lastNote = out.count ? `Furnished from the photos: ${out.count} pieces${art.length ? ` and ${art.length} picture${art.length > 1 ? "s" : ""}` : ""}, placed approximately.` : "No furniture recognised in the photos.";
        showNote();
      } catch (e) {
        btn.disabled = false; btn.textContent = "Furnish from photos";
        note.hidden = false; note.textContent = (e && e.message) || "Couldn’t analyse the photos just now. Try again.";
      }
    });
    if (T.P) update(location.hash.replace(/^#(room|photos)-/, "") || T.P.startRoom);
  }
  // ---- furnish every photographed room when the walk first opens ----
  // One pass per opening (the backend keeps each room's answer, so later openings are quick). Rooms with a
  // 3D scan keep the scan; a layout the visitor arranged themselves is never replaced.
  let autoStarted = false, here = { pos: null, room: null };
  T.on("tour:position", (p) => (here.pos = p), { persistent: true });
  T.on("tour:room", ({ roomId }) => (here.room = roomId), { persistent: true });
  const arranging = () => !!document.querySelector(".view-walk .is-arranging, .view-walk.is-arranging");
  const arrangedByHand = () => Array.isArray(T.state && T.state.layout);
  const say = (text) => { lastNote = text; showNote(); };
  async function autoFurnish() {
    if (autoStarted || !T.P) return;
    autoStarted = true;
    if (arrangedByHand()) return;
    const patched = (T.state && T.state.rooms) || {};
    const todo = T.P.rooms.filter((r) => !(patched[r.id] && patched[r.id].furnishing) && r.media.some((m) => m.type === "photo"));
    if (!todo.length) return;
    let next = 0, finished = 0;
    const results = {};
    say(`Furnishing ${todo.length} room${todo.length > 1 ? "s" : ""} from your photos…`);
    const worker = async () => {
      while (next < todo.length) {
        const r = todo[next++];
        try { results[r.id] = await T.embedRequest("veduta:furnish", { roomId: r.id }); } catch (e) { /* that room keeps its typical furniture */ }
        finished++;
        if (finished < todo.length) say(`Furnishing from your photos: ${finished} of ${todo.length} rooms…`);
      }
    };
    await Promise.all([worker(), worker()]);   // two at a time, gentle on the AI's rate limits
    while (arranging()) await new Promise((r) => setTimeout(r, 1000));   // don't rebuild under someone arranging
    if (arrangedByHand()) { say(""); return; }
    const P = T.P, U = T.uploadsInternals;
    const state = JSON.parse(JSON.stringify(T.state || { rooms: {} }));
    state.rooms = state.rooms || {};
    let rooms = 0, pieces = 0, pictures = 0;
    for (const r of todo) {
      const room = T.roomById(P, r.id), res = results[r.id];
      if (!room || !res) continue;
      const out = U.toFurnishing(P, room, res);
      const art = await artPieces(P, room, res);
      if (!out.count && !art.length && !out.floorClass && !out.wallColor) continue;
      const patch = {};
      if (out.count || art.length) patch.furnishing = out.furnishing.concat(art);
      pictures += art.length;
      if (out.floorClass) patch.floorClass = out.floorClass;
      if (out.wallColor) patch.wallColor = out.wallColor;
      state.rooms[r.id] = Object.assign({}, state.rooms[r.id], patch);
      rooms++; pieces += out.count;
    }
    if (!rooms) { say("Couldn’t read the furniture in your photos, so the rooms show typical furniture."); return; }
    const pos = here.pos;
    await T.applyState(state, here.room || P.startRoom);
    if (pos && T.walkTo) T.walkTo(pos.x, pos.y, (pos.heading * 180) / Math.PI);   // stay where you were standing
    say(`Furnished ${rooms} room${rooms > 1 ? "s" : ""} from your photos: ${pieces} pieces${pictures ? ` and ${pictures} picture${pictures > 1 ? "s" : ""}` : ""}, placed approximately. Use Arrange furniture to move them.`);
  }
  T.on("tour:built", () => { setTimeout(() => { addFurnishButton(); addScanButton(); showNote(); placeScans(); autoFurnish(); }, 0); }, { persistent: true });
})();
