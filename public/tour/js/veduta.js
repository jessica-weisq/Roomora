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
    return { tr: { w: GW * CELL, h: GH * CELL, GW, GH, CELL, g }, mpp, origin: [margin * mpp, margin * mpp], toPx: (x, y) => [margin + x / mpp, margin + y / mpp] };
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
    // 1. enclosed spaces. A room takes every walled space that lies mostly inside its box (a bathroom whose
    //    shower is partitioned off is two spaces, one room), smaller rooms choosing first so an en suite inside a
    //    bedroom's box keeps its own space. A box that's only roughly right also takes the space under its middle.
    const E = enclosedSpaces(tr, mpp), claimed = new Set();
    let matched = 0;
    rooms.map((r, i) => i).sort((p, q) => areaOf(rooms[p].px) - areaOf(rooms[q].px)).forEach((ri) => {
      const r = rooms[ri];
      if (r.type === "terrace") return;
      const [x0, y0, x1, y1] = r.px, grow = 0.3 / mpp, tally = new Map(), totals = new Map();
      for (let y = Math.max(0, Math.floor((y0 - grow) / CELL)); y < Math.min(E.GH, Math.ceil((y1 + grow) / CELL)); y++)
        for (let x = Math.max(0, Math.floor((x0 - grow) / CELL)); x < Math.min(E.GW, Math.ceil((x1 + grow) / CELL)); x++) {
          const l = E.lab[y * E.GW + x]; if (l >= 0) tally.set(l, (tally.get(l) || 0) + 1);
        }
      tally.forEach((_, l) => totals.set(l, E.spaces[l].n));
      const mx = Math.floor((x0 + x1) / 2 / CELL), my = Math.floor((y0 + y1) / 2 / CELL);
      const atMiddle = mx >= 0 && my >= 0 && mx < E.GW && my < E.GH ? E.lab[my * E.GW + mx] : -1;
      const take = [...tally.keys()].filter((l) => !claimed.has(l) && (tally.get(l) / totals.get(l) >= 0.7 || l === atMiddle));
      if (!take.length) return;
      const u = take.reduce((b, l) => { const p = E.spaces[l].px; return [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[2]), Math.max(b[3], p[3])]; }, [Infinity, Infinity, -Infinity, -Infinity]);
      const ratio = areaOf(u) / (areaOf(r.px) || 1);
      if (ratio > 1.8 || ratio < 0.4) return;   // open-plan, or a space that isn't this room
      // each side may move in a good way, but only a little way out (see below)
      const w = x1 - x0, h = y1 - y0, outW = Math.max(0.5 / mpp, 0.2 * w), outH = Math.max(0.5 / mpp, 0.2 * h);
      if (x0 - u[0] > outW || u[2] - x1 > outW || y0 - u[1] > outH || u[3] - y1 > outH) return;
      if (u[0] - x0 > 0.45 * w || x1 - u[2] > 0.45 * w || u[1] - y0 > 0.45 * h || y1 - u[3] > 0.45 * h) return;
      if (iou(r.px, u) < 0.45 && atMiddle < 0) return;
      // Give up part of the box only to something real: another room's space, a wall, or the outside. Plain
      // floor nothing else claims (a shower recess too narrow to count as a space of its own) stays this room's.
      const others = rooms.filter((o) => o !== r);
      const inOther = (px, py) => others.some((o) => px >= o.px[0] && px < o.px[2] && py >= o.px[1] && py < o.px[3]);
      const gives = (sx0, sy0, sx1, sy1) => {
        let n = 0, real = 0;
        for (let y = Math.max(0, Math.floor(sy0 / CELL)); y < Math.min(E.GH, Math.ceil(sy1 / CELL)); y++)
          for (let x = Math.max(0, Math.floor(sx0 / CELL)); x < Math.min(E.GW, Math.ceil(sx1 / CELL)); x++) {
            const i = y * E.GW + x; n++;
            if (tr.g[i] < 2 || (E.lab[i] >= 0 && claimed.has(E.lab[i])) || inOther((x + 0.5) * CELL, (y + 0.5) * CELL)) real++;
          }
        return n === 0 || real / n >= 0.6;
      };
      if (u[0] > x0 && !gives(x0, u[1], u[0], u[3])) u[0] = x0;
      if (u[2] < x1 && !gives(u[2], u[1], x1, u[3])) u[2] = x1;
      if (u[1] > y0 && !gives(u[0], y0, u[2], u[1])) u[1] = y0;
      if (u[3] < y1 && !gives(u[0], u[3], u[2], y1)) u[3] = y1;
      take.forEach((l) => claimed.add(l));
      r.px = u; matched++;
    });
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
    pruneStrayWalls(tr, rooms, a.mpp);
    const added = addUnnamedSpaces(tr, rooms, a.mpp);
    if (added) console.info(`Floor plan: ${added} unlabelled space${added > 1 ? "s" : ""} (a hall or lobby) added as rooms`);
    console.info(`Floor plan: traced walls used (${Math.round(a.quality * 100)}% of room edges on walls; ${a.matched} of ${rooms.length} rooms matched to walled spaces; placed by ${a.how})`);
    return { tr, mpp: a.mpp, origin: [a.ox * a.mpp, a.oy * a.mpp], image: true, quality: a.quality, fromBox: (b) => [b[0] * tr.w, b[1] * tr.h, b[2] * tr.w, b[3] * tr.h] };
  }

  // Walls only matter round rooms: anything "wall" more than half a metre from every room is a scale bar,
  // a logo, a key or a neighbour's outline, and would stand in the view out of the windows.
  function pruneStrayWalls(tr, rooms, mpp) {
    const { GW, GH, CELL, g } = tr, pad = 0.5 / mpp;
    const keep = new Uint8Array(GW * GH);
    rooms.forEach((r) => {
      const x0 = Math.max(0, Math.floor((r.px[0] - pad) / CELL)), y0 = Math.max(0, Math.floor((r.px[1] - pad) / CELL));
      const x1 = Math.min(GW - 1, Math.ceil((r.px[2] + pad) / CELL)), y1 = Math.min(GH - 1, Math.ceil((r.px[3] + pad) / CELL));
      for (let y = y0; y <= y1; y++) keep.fill(1, y * GW + x0, y * GW + x1 + 1);
    });
    for (let i = 0; i < g.length; i++) if (g[i] === 1 && !keep[i]) g[i] = 0;
    // Likewise "indoor" patches that belong to no room and touch no room's floor: a compass ring, a key or a
    // logo's outline encloses white paper, which the tracing reads as indoors. Unlabelled corridors and
    // cupboards do touch rooms (through their doorways), so they stay.
    const inRoom = new Uint8Array(GW * GH);
    rooms.forEach((r) => {
      for (let y = Math.max(0, Math.floor(r.px[1] / CELL)); y < Math.min(GH, Math.ceil(r.px[3] / CELL)); y++)
        inRoom.fill(1, y * GW + Math.max(0, Math.floor(r.px[0] / CELL)), y * GW + Math.min(GW, Math.ceil(r.px[2] / CELL)));
    });
    const seen = new Uint8Array(GW * GH), st = [];
    for (let s = 0; s < g.length; s++) {
      if (seen[s] || g[s] < 2 || inRoom[s]) continue;
      const cells = []; let touches = false;
      seen[s] = 1; st.push(s);
      while (st.length) {
        const i = st.pop(), x = i % GW; cells.push(i);
        for (const j of [x > 0 ? i - 1 : -1, x < GW - 1 ? i + 1 : -1, i - GW, i + GW]) {
          if (j < 0 || j >= g.length || g[j] < 2) continue;
          if (inRoom[j]) { touches = true; continue; }
          if (!seen[j]) { seen[j] = 1; st.push(j); }
        }
      }
      if (!touches) for (const i of cells) g[i] = 0;
    }
  }

  // Every room must be reachable on foot. A doorway only exists where the drawing leaves a gap, and plans
  // often don't (the door is drawn shut, a label sits in the opening, the tracing closes a narrow gap). So:
  // walk outwards from the hall, and for each room that can't be reached, cut a doorway (0.85 m) through the
  // wall it shares with a room that can, preferring the hall, at a spot with clear floor on both sides.
  function ensureConnected(tr, rooms, mpp) {
    const { GW, GH, CELL, g } = tr, cm = CELL * mpp, rad = Math.max(1, Math.ceil(0.25 / cm));
    if (rooms.length < 2) return 0;
    const owner = new Int16Array(GW * GH).fill(-1);
    rooms.map((r, i) => i).sort((a, b) => rooms[b].area - rooms[a].area).forEach((i) => {
      const [x0, y0, x1, y1] = rooms[i].px;
      for (let y = Math.max(0, Math.floor(y0 / CELL)); y < Math.min(GH, Math.ceil(y1 / CELL)); y++)
        for (let x = Math.max(0, Math.floor(x0 / CELL)); x < Math.min(GW, Math.ceil(x1 / CELL)); x++) owner[y * GW + x] = i;
    });
    const floor = (i) => g[i] !== 1 && (g[i] >= 2 || owner[i] >= 0);
    const walkable = () => {   // floor with room for a person
      const ok = new Uint8Array(GW * GH);
      for (let y = rad; y < GH - rad; y++) for (let x = rad; x < GW - rad; x++) {
        let f = floor(y * GW + x) ? 1 : 0;
        for (let dy = -rad; dy <= rad && f; dy++) for (let dx = -rad; dx <= rad; dx++) if (!floor((y + dy) * GW + x + dx)) { f = 0; break; }
        ok[y * GW + x] = f;
      }
      return ok;
    };
    const startIdx = (() => { const hall = rooms.findIndex((r) => r.type === "hall"); return hall >= 0 ? hall : rooms.reduce((b, r, i) => (r.area > rooms[b].area ? i : b), 0); })();
    const reachedRooms = (ok) => {
      const seen = new Uint8Array(GW * GH), st = [], got = new Uint8Array(rooms.length);
      for (let i = 0; i < owner.length; i++) if (owner[i] === startIdx && ok[i]) { seen[i] = 1; st.push(i); break; }
      while (st.length) {
        const i = st.pop(); if (owner[i] >= 0) got[owner[i]] = 1;
        for (const j of [i - 1, i + 1, i - GW, i + GW]) if (ok[j] && !seen[j]) { seen[j] = 1; st.push(j); }
      }
      got[startIdx] = 1;
      return got;
    };
    const gapMax = 0.7 / mpp, doorPx = 0.85 / mpp, inPx = 0.45 / mpp;
    let cut = 0;
    for (let round = 0; round < rooms.length * 2; round++) {
      const ok = walkable(), got = reachedRooms(ok);
      if (got.every((v) => v)) break;
      const okAt = (px, py) => { const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL); return cx >= 0 && cy >= 0 && cx < GW && cy < GH && ok[cy * GW + cx]; };
      let best = null;
      rooms.forEach((u, ui) => {
        if (got[ui]) return;
        rooms.forEach((v, vi) => {
          if (!got[vi]) return;
          const [ux0, uy0, ux1, uy1] = u.px, [vx0, vy0, vx1, vy1] = v.px;
          // side by side (a wall running up the plan between them), or one above the other
          const tries = [
            { horiz: false, gap: Math.max(vx0 - ux1, ux0 - vx1), lo: Math.max(uy0, vy0), hi: Math.min(uy1, vy1), a: ux1 <= vx0 + gapMax && ux1 < vx1 ? Math.min(ux1, vx0) : Math.min(vx1, ux0), b: ux1 <= vx0 + gapMax && ux1 < vx1 ? Math.max(ux1, vx0) : Math.max(vx1, ux0) },
            { horiz: true, gap: Math.max(vy0 - uy1, uy0 - vy1), lo: Math.max(ux0, vx0), hi: Math.min(ux1, vx1), a: uy1 <= vy0 + gapMax && uy1 < vy1 ? Math.min(uy1, vy0) : Math.min(vy1, uy0), b: uy1 <= vy0 + gapMax && uy1 < vy1 ? Math.max(uy1, vy0) : Math.max(vy1, uy0) },
          ];
          for (const t of tries) {
            if (t.gap > gapMax || t.gap < -gapMax || t.hi - t.lo < doorPx + 2 * CELL) continue;
            // along the shared wall, the spot nearest its middle with clear floor a step into each room
            const mid = (t.lo + t.hi) / 2, half = (t.hi - t.lo - doorPx) / 2;
            let at = null;
            for (let d = 0; d <= half && at === null; d += CELL) for (const s of d ? [d, -d] : [0]) {
              const p = mid + s, clearA = t.horiz ? okAt(p, t.a - inPx) : okAt(t.a - inPx, p), clearB = t.horiz ? okAt(p, t.b + inPx) : okAt(t.b + inPx, p);
              if (clearA && clearB) { at = p; break; }
            }
            const score = (v.type === "hall" ? 1000 : 0) + (at !== null ? 500 : 0) + (t.hi - t.lo) * mpp - Math.abs(t.gap) * mpp;
            if (!best || score > best.score) best = { score, t, at: at !== null ? at : mid };
          }
        });
      });
      if (!best) break;   // an unreached room touches no reached one: leave it (the plan button still jumps there)
      const { t, at } = best, a = t.a - inPx, b = t.b + inPx;
      const [x0, x1, y0, y1] = t.horiz ? [at - doorPx / 2, at + doorPx / 2, a, b] : [a, b, at - doorPx / 2, at + doorPx / 2];
      for (let y = Math.max(0, Math.floor(y0 / CELL)); y <= Math.min(GH - 1, Math.floor(y1 / CELL)); y++)
        for (let x = Math.max(0, Math.floor(x0 / CELL)); x <= Math.min(GW - 1, Math.floor(x1 / CELL)); x++) g[y * GW + x] = 2;
      cut++;
    }
    return cut;
  }

  // Typical furniture for a room, turned to suit it. The stock layout assumes the room's top wall is the one
  // to furnish against, which puts baths across doorways and mirrors over windows. So the layout is tried
  // facing each of the four walls, and the one that keeps pieces out of doorways, off window walls (tall pieces
  // and bedheads) and on the floor is used.
  const FOOTPRINT = { bed: 1.2, sofa: 1.2, table: 1.2, island: 1.1, counter: 1.0, wardrobe: 0.9, bath: 0.9, bookcase: 0.9, sideboard: 0.9, tv: 0.9, shelving: 0.9, vanity: 0.8, desk: 0.8 };
  const AGAINST_A_WALL = new Set(["wardrobe", "vanity", "bookcase", "shelving", "tv", "bed", "counter", "sideboard"]);
  function starterThatFits(U, r, tr, mpp) {
    const [x0, y0, x1, y1] = r.px, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0;
    const { GW, GH, CELL, g } = tr, m = (v) => v / mpp;
    const cell = (px, py) => { const gx = Math.floor(px / CELL), gy = Math.floor(py / CELL); return gx < 0 || gy < 0 || gx >= GW || gy >= GH ? 0 : g[gy * GW + gx]; };
    // what each point of the room's edge is: wall, a doorway (floor carries on beyond), or a window
    const doors = [], wins = [];
    const look = (px, py, nx, ny) => {
      for (let d = -0.3; d <= 0.3; d += 0.06) if (cell(px + nx * m(d), py + ny * m(d)) === 1) return;
      (cell(px + nx * m(0.5), py + ny * m(0.5)) >= 2 ? doors : wins).push([px, py]);
    };
    for (let x = x0 + m(0.2); x <= x1 - m(0.2); x += CELL) { look(x, y0, 0, -1); look(x, y1, 0, 1); }
    for (let y = y0 + m(0.2); y <= y1 - m(0.2); y += CELL) { look(x0, y, -1, 0); look(x1, y, 1, 0); }
    const nearAny = (pts, it, reach) => pts.some((p) => Math.hypot(p[0] - it.x, p[1] - it.y) < reach);
    let best = null;
    for (const turn of [0, 90, 180, 270]) {
      const sw = turn % 180 ? h : w, sh = turn % 180 ? w : h, a = (turn * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      const items = U.starter(Object.assign({}, r, { px: [cx - sw / 2, cy - sh / 2, cx + sw / 2, cy + sh / 2] }), r.type, mpp).map((it) => {
        const dx = it.x - cx, dy = it.y - cy;
        return Object.assign({}, it, { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c, rot: ((((it.rot || 0) - turn) % 360) + 360) % 360 });
      });
      let penalty = 0;
      for (const it of items) {
        if (it.type === "rug") continue;
        const reach = m(FOOTPRINT[it.type] || 0.6);
        if (cell(it.x, it.y) < 2) penalty += 20;
        if (nearAny(doors, it, reach + m(0.35))) penalty += 10;
        if (AGAINST_A_WALL.has(it.type) && nearAny(wins, it, reach)) penalty += it.type === "bed" ? 2 : 5;
      }
      if (!best || penalty < best.penalty) best = { penalty, items };
    }
    return best.items;
  }

  // Indoor spaces the plan encloses but no room covers: an entrance lobby, a corridor, a landing. Plans often
  // leave them unlabelled, and without a room they'd be lost (or worse, read as outdoors). Each becomes a hall.
  function addUnnamedSpaces(tr, rooms, mpp) {
    const { GW, GH, CELL, g } = tr, cellM = CELL * mpp, covered = new Uint8Array(GW * GH);
    rooms.forEach((r) => {
      for (let y = Math.max(0, Math.floor(r.px[1] / CELL)); y < Math.min(GH, Math.ceil(r.px[3] / CELL)); y++)
        covered.fill(1, y * GW + Math.max(0, Math.floor(r.px[0] / CELL)), y * GW + Math.min(GW, Math.ceil(r.px[2] / CELL)));
    });
    // indoor floor no room covers, in connected patches
    const seen = new Uint8Array(GW * GH), st = [];
    let added = 0;
    for (let s = 0; s < g.length; s++) {
      if (seen[s] || g[s] < 2 || covered[s]) continue;
      let n = 0, x0 = GW, y0 = GH, x1 = -1, y1 = -1;
      seen[s] = 1; st.push(s);
      while (st.length) {
        const i = st.pop(), x = i % GW, y = (i / GW) | 0;
        n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const j of [x > 0 ? i - 1 : -1, x < GW - 1 ? i + 1 : -1, i - GW, i + GW]) if (j >= 0 && j < g.length && !seen[j] && g[j] >= 2 && !covered[j]) { seen[j] = 1; st.push(j); }
      }
      const w = (x1 - x0 + 1) * cellM, d = (y1 - y0 + 1) * cellM, area = n * cellM * cellM;
      // a room-sized patch, at least corridor width (0.9 m), that mostly fills its outline: not a sliver left
      // between two rooms' boxes
      if (area < 1.2 || Math.min(w, d) < 0.9 || area / (w * d) < 0.55) continue;
      const k = rooms.filter((r) => r.auto).length + 1, id = `hall-${k}`;
      const px = [x0 * CELL, y0 * CELL, (x1 + 1) * CELL, (y1 + 1) * CELL];
      rooms.push({ id, name: k === 1 ? "Hall" : `Hall ${k}`, type: "hall", auto: true, px, area: (px[2] - px[0]) * (px[3] - px[1]),
        src: { id, name: "Hall", x: 0, y: 0, width: w, depth: d } });
      added++;
    }
    return added;
  }

  // A hall's door-sized opening to the outside is its front door, not a window: close it with wall. (Halls have
  // no windows on most plans; the door leaf drawn swinging outwards would otherwise show as diagonal glass.)
  function closeFrontDoors(tr, rooms, mpp) {
    const { GW, GH, CELL, g } = tr, cm = CELL * mpp, maxRun = Math.round(1.6 / cm), depth = Math.max(2, Math.round(0.25 / cm));
    let closed = 0;
    rooms.filter((r) => r.type === "hall").forEach((r) => {
      const x0 = Math.floor(r.px[0] / CELL), y0 = Math.floor(r.px[1] / CELL), x1 = Math.ceil(r.px[2] / CELL) - 1, y1 = Math.ceil(r.px[3] / CELL) - 1;
      const at = (x, y) => (x < 0 || y < 0 || x >= GW || y >= GH ? 0 : g[y * GW + x]);
      const sides = [
        { n: x1 - x0 + 1, cell: (k, d) => [x0 + k, y0 - 1 - d] }, { n: x1 - x0 + 1, cell: (k, d) => [x0 + k, y1 + 1 + d] },
        { n: y1 - y0 + 1, cell: (k, d) => [x0 - 1 - d, y0 + k] }, { n: y1 - y0 + 1, cell: (k, d) => [x1 + 1 + d, y0 + k] },
      ];
      for (const s of sides) {
        // runs along this side where what's just beyond the room is outside
        let k = 0;
        while (k < s.n) {
          // an opening: outside just beyond the room's edge, and no wall on the edge itself (a hall box drawn
          // over its wall has wall there, and that's not a door)
          const open = (j) => {
            for (let d = -2; d < 0; d++) { const [x, y] = s.cell(j, d); if (at(x, y) === 1) return false; }
            for (let d = 0; d < 2; d++) { const [x, y] = s.cell(j, d); if (at(x, y) === 0) return true; }
            return false;
          };
          if (!open(k)) { k++; continue; }
          let e = k; while (e < s.n && open(e)) e++;
          if (e - k <= maxRun) {
            for (let j = Math.max(0, k - 1); j < Math.min(s.n, e + 1); j++) for (let d = 0; d < depth; d++) {
              const [x, y] = s.cell(j, d);
              if (x >= 0 && y >= 0 && x < GW && y < GH && g[y * GW + x] !== 1) g[y * GW + x] = 1;
            }
            closed++;
          }
          k = e;
        }
      }
      // and anything outside inside the hall itself (between a drawn door leaf and the wall) is hall floor
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (at(x, y) === 0) g[y * GW + x] = 2;
    });
    return closed;
  }

  // ---- furniture that fits ----
  // Size of each kind of piece on the floor, in metres: [along its back, front to back].
  const dimsOf = (it) => {
    const o = it, n = (v, d) => (typeof v === "number" && v > 0 ? v : d);
    switch (it.type) {
      case "sofa": return [n(o.len, 2.4), 0.95];
      case "armchair": return [0.85, 0.85];
      case "ottoman": return [n(o.w, 1), n(o.d, 0.8)];
      case "coffeeRound": case "roundShelf": { const r = n(o.r, 0.5); return [r * 2, r * 2]; }
      case "coffee": return [n(o.w, 1.1), n(o.d, 0.6)];
      case "sideboard": return [n(o.len, 2), 0.5];
      case "tv": return [n(o.len, 2.1), 0.45];
      case "shelving": return [n(o.len, 2.4), 0.4];
      case "bookcase": return [n(o.len, 2.2), 0.38];
      case "table": return [n(o.w, 2), n(o.d, 1) + ((o.chairs ?? 3) > 0 ? 1.1 : 0)];
      case "roundTable": { const r = n(o.r, 0.5); return [r * 2 + 0.9, r * 2 + 0.9]; }
      case "chair": return [0.5, 0.5];
      case "island": return [n(o.w, 1.3), n(o.d, 2.4)];
      case "counter": return [n(o.len, 3), 0.62];
      case "bed": return [n(o.w, 1.8) + 0.16, n(o.l, 2.1) + 0.1];
      case "nightstand": return [0.5, 0.42];
      case "bench": return [n(o.len, 1.5), 0.45];
      case "dresser": return [n(o.len, 1.4), 0.5];
      case "wardrobe": return [n(o.len, 2), 0.62];
      case "desk": return [n(o.w, 1.6), 1.25];
      case "console": return [n(o.len, 1.6), 0.4];
      case "bath": return [n(o.len, 1.7), n(o.w, 0.8)];
      case "vanity": return [n(o.len, 1.4), 0.55];
      case "wc": return [0.42, 0.72];
      case "shower": return [n(o.w, 0.9), n(o.d, 0.9)];
      case "floorLamp": case "plant": return [0.45, 0.45];
      case "lounger": return [0.7, 2];
      case "planter": return [n(o.len, 2), 0.45];
      case "hottub": return [n(o.w, 2.2), n(o.w, 2.2)];
      default: return null;   // rugs, pictures: anywhere
    }
  };
  // which plan fixture stands for which pieces
  const COVERS = { kitchen_run: ["counter"], island: ["island"], bath: ["bath"], shower: ["shower", "bath"], wc: ["wc"], basin: ["vanity"], bed: ["bed"], wardrobe: ["wardrobe"], sofa: ["sofa"], table: ["table", "roundTable"] };

  // A fixture drawn on the plan, built where it's drawn: its back to the nearest wall, its size from the drawing.
  function fixtureItem(f, px, roomId, grid) {
    const [x0, y0, x1, y1] = px, mpp = grid.mpp, w = (x1 - x0) * mpp, d = (y1 - y0) * mpp, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (!(w > 0.15 && d > 0.15)) return null;
    const isWall = (x, y) => grid.at(x, y) < 2;
    const backing = (side) => {   // how much wall is right behind this side (sampled along it)
      let hits = 0;
      for (let k = 1; k <= 5; k++) {
        const t = k / 6;
        for (const reach of [0.08, 0.2, 0.32]) {
          const p = reach / mpp;
          const [x, y] = side === "up" ? [x0 + (x1 - x0) * t, y0 - p] : side === "down" ? [x0 + (x1 - x0) * t, y1 + p] : side === "left" ? [x0 - p, y0 + (y1 - y0) * t] : [x1 + p, y0 + (y1 - y0) * t];
          if (isWall(x, y)) { hits++; break; }
        }
      }
      return hits;
    };
    const sides = ["up", "down", "left", "right"].map((s) => [s, backing(s)]).sort((a, b) => b[1] - a[1]);
    // long, thin pieces (worktops, wardrobes, baths) have their back along a long side
    const long = w >= d ? ["up", "down"] : ["left", "right"];
    let side = sides[0][0];
    if (["kitchen_run", "wardrobe", "bath", "sofa"].includes(f.type)) { const s = sides.find(([s]) => long.includes(s)); if (s && s[1] > 0) side = s[0]; }
    const ROT = { up: 0, down: 180, left: 90, right: 270 };
    const along = side === "up" || side === "down" ? w : d, deep = side === "up" || side === "down" ? d : w;
    const base = { room: roomId, x: Math.round(cx * 10) / 10, y: Math.round(cy * 10) / 10, rot: ROT[side], fromPlan: true };
    const r2 = (v) => Math.round(v * 100) / 100;
    switch (f.type) {
      case "kitchen_run": return Object.assign(base, { type: "counter", len: r2(Math.max(0.6, along)) });
      case "island": return Object.assign(base, { type: "island", rot: 0, w: r2(w), d: r2(d) });
      case "bath": return Object.assign(base, { type: "bath", len: r2(Math.min(2, Math.max(1.4, along))), w: r2(Math.min(0.9, Math.max(0.65, deep))) });
      case "shower": return Object.assign(base, { type: "shower", w: r2(Math.max(0.7, along)), d: r2(Math.max(0.7, deep)) });
      case "wc": return Object.assign(base, { type: "wc" });
      case "basin": return Object.assign(base, { type: "vanity", len: r2(Math.min(1.6, Math.max(0.5, along))), basins: along > 1.2 ? 2 : 1 });
      case "bed": return Object.assign(base, { type: "bed", w: r2(Math.min(2, Math.max(0.9, along))), l: r2(Math.min(2.3, Math.max(1.8, deep))) });
      case "wardrobe": return Object.assign(base, { type: "wardrobe", len: r2(Math.max(0.6, along)) });
      case "sofa": return Object.assign(base, { type: "sofa", len: r2(Math.min(3.6, Math.max(1.4, along))) });
      case "table": { const lw = Math.max(w, d), sw = Math.min(w, d); return Object.assign(base, { type: "table", rot: w >= d ? 0 : 90, w: r2(Math.max(0.8, lw)), d: r2(Math.max(0.7, Math.min(1.2, sw))), chairs: Math.max(0, Math.min(4, Math.floor(lw / 0.65))) }); }
    }
    return null;
  }

  // The plan's fixtures, as pieces, room by room.
  function planFixtures(plan, rooms, built, grid) {
    const out = {};
    for (const f of plan.fixtures || []) {
      let px = null;
      if (built.fromBox && Array.isArray(f.box)) px = built.fromBox(f.box);
      else if (built.toPx && [f.x, f.y, f.width, f.depth].every(Number.isFinite)) { const a = built.toPx(f.x, f.y), b = built.toPx(f.x + f.width, f.y + f.depth); px = [a[0], a[1], b[0], b[1]]; }
      if (!px) continue;
      const cx = (px[0] + px[2]) / 2, cy = (px[1] + px[3]) / 2;
      // its room: the one the plan says, or else the smallest room it's in
      let room = rooms.find((r) => r.id === f.room);
      const inside = (r) => cx >= r.px[0] && cx <= r.px[2] && cy >= r.px[1] && cy <= r.px[3];
      if (!room || !inside(room)) room = rooms.filter(inside).sort((a, b) => a.area - b.area)[0];
      if (!room) continue;
      const it = fixtureItem(f, px, room.id, grid);
      if (it) (out[room.id] = out[room.id] || []).push(it);
    }
    return out;
  }

  // A grid to check placements against: the built model's (1 wall, 0 outside, 2+ floor), in plan pixels.
  function gridOf(model) {
    const g = T.decodeGrid(model.grid), GW = model.grid.w, GH = model.grid.h, C = model.cell;
    return { mpp: model.metresPerPx, at: (x, y) => { const cx = Math.floor(x / C), cy = Math.floor(y / C); return cx < 0 || cy < 0 || cx >= GW || cy >= GH ? 0 : g[cy * GW + cx]; } };
  }

  // Put a room's pieces where they fit: on floor, inside the room, clear of each other and of its doorways.
  // The plan's own fixtures are fixed; anything else that doesn't fit where it was put is moved to the nearest
  // spot that does (turning it if need be), or left out if nowhere does.
  function settle(items, room, grid) {
    const mpp = grid.mpp, m = (v) => v / mpp, [rx0, ry0, rx1, ry1] = room.px;
    // doorways: points on the room's edge with floor carrying on beyond the wall
    const doors = [];
    const probe = (px, py, nx, ny) => {
      for (let d = -0.3; d <= 0.3; d += 0.06) if (grid.at(px + nx * m(d), py + ny * m(d)) === 1) return;
      if (grid.at(px + nx * m(0.5), py + ny * m(0.5)) >= 2 && grid.at(px - nx * m(0.5), py - ny * m(0.5)) >= 2) doors.push([px, py]);
    };
    const step = m(0.1);
    for (let x = rx0 + m(0.2); x <= rx1 - m(0.2); x += step) { probe(x, ry0, 0, -1); probe(x, ry1, 0, 1); }
    for (let y = ry0 + m(0.2); y <= ry1 - m(0.2); y += step) { probe(rx0, y, -1, 0); probe(rx1, y, 1, 0); }
    const rectOf = (it, x, y, rot) => {
      const [a, b] = dimsOf(it), turned = (((rot || 0) % 180) + 180) % 180 === 90, hw = m(turned ? b : a) / 2, hd = m(turned ? a : b) / 2;
      return [x - hw, y - hd, x + hw, y + hd];
    };
    const placed = [];
    const fits = (r, own) => {
      const inset = m(0.04);
      if (r[0] < rx0 - m(0.1) || r[1] < ry0 - m(0.1) || r[2] > rx1 + m(0.1) || r[3] > ry1 + m(0.1)) return false;
      for (let y = r[1] + inset; y <= r[3] - inset; y += m(0.08)) for (let x = r[0] + inset; x <= r[2] - inset; x += m(0.08)) if (grid.at(x, y) < 2) return false;
      for (const p of placed) if (p !== own && r[0] < p[2] - m(0.05) && p[0] < r[2] - m(0.05) && r[1] < p[3] - m(0.05) && p[1] < r[3] - m(0.05)) return false;
      for (const [dx, dy] of doors) {
        const ex = Math.max(r[0] - dx, 0, dx - r[2]), ey = Math.max(r[1] - dy, 0, dy - r[3]);
        if (Math.hypot(ex, ey) < m(0.5)) return false;
      }
      for (const c of keepClear) if (r[0] < c[2] && c[0] < r[2] && r[1] < c[3] && c[1] < r[3]) return false;
      return true;
    };
    // the space you stand in to use a fitted unit (open a wardrobe, cook, wash) stays clear: 0.6 m in front of it
    const keepClear = [];
    const FITTED = new Set(["wardrobe", "counter", "vanity", "wc", "bath", "shower", "island", "dresser"]);
    const frontZone = (it) => {
      const [x0, y0, x1, y1] = rectOf(it, it.x, it.y, it.rot), c = m(0.6), rot = ((((it.rot || 0) % 360) + 360) % 360);
      return rot === 0 ? [x0, y1, x1, y1 + c] : rot === 180 ? [x0, y0 - c, x1, y0] : rot === 90 ? [x1, y0, x1 + c, y1] : [x0 - c, y0, x0, y1];
    };
    const out = [];
    const fixed = items.filter((it) => it.fromPlan), loose = items.filter((it) => !it.fromPlan);
    for (const it of fixed) {
      const r = dimsOf(it) && rectOf(it, it.x, it.y, it.rot);
      if (r) placed.push(r);
      if (r && FITTED.has(it.type)) keepClear.push(it.type === "island" ? [r[0] - m(0.5), r[1] - m(0.5), r[2] + m(0.5), r[3] + m(0.5)] : frontZone(it));
      out.push(it);
    }
    // biggest first: they're the hardest to fit
    const size = (it) => { const d = dimsOf(it); return d ? d[0] * d[1] : 0; };
    loose.sort((a, b) => size(b) - size(a));
    // is there wall right behind this piece (its back is the side away from its front)?
    const backed = (r, rot) => {
      const b = m(0.12), [x0, y0, x1, y1] = r, n = 6;
      let hits = 0;
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const [x, y] = rot === 0 ? [x0 + (x1 - x0) * t, y0 - b] : rot === 180 ? [x0 + (x1 - x0) * t, y1 + b] : rot === 90 ? [x0 - b, y0 + (y1 - y0) * t] : [x1 + b, y0 + (y1 - y0) * t];
        if (grid.at(x, y) === 1) hits++;   // solid wall: not a window, not a doorway
      }
      return hits >= (n - 1) * 0.6;
    };
    const WALL_ONLY = new Set(["bookcase", "shelving", "sideboard", "tv", "dresser", "console", "wardrobe", "vanity", "wc", "counter", "nightstand"]);
    const WALL_FIRST = new Set(["bed", "sofa", "desk", "bath"]);
    for (const it of loose) {
      if (!dimsOf(it)) { out.push(it); continue; }   // rugs and pictures go where they were put
      let spot = null;
      const rots = [it.rot || 0, (it.rot || 0) + 180, (it.rot || 0) + 90, (it.rot || 0) + 270].map((v) => ((v % 360) + 360) % 360);
      const needWall = WALL_ONLY.has(it.type) || WALL_FIRST.has(it.type);
      for (const wantWall of needWall ? (WALL_ONLY.has(it.type) ? [true] : [true, false]) : [false]) {
        search: for (let rad = 0; rad <= 2.2; rad += 0.1) {
          const n = rad ? Math.max(8, Math.round(rad * 24)) : 1;
          for (const rot of rad ? rots : [rots[0]]) for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2, x = it.x + Math.cos(a) * m(rad), y = it.y + Math.sin(a) * m(rad), r = rectOf(it, x, y, rot);
            if (fits(r) && (!wantWall || backed(r, rot))) { spot = { x, y, rot, r }; break search; }
          }
        }
        if (spot) break;
      }
      if (!spot) continue;   // nowhere it fits: better left out than standing in a wall or a doorway
      placed.push(spot.r);
      out.push(Object.assign({}, it, { x: Math.round(spot.x * 10) / 10, y: Math.round(spot.y * 10) / 10, rot: spot.rot }));
    }
    return out;
  }

  // A room's furniture: the plan's fixtures, plus the given pieces (from the photos, or typical ones) that the
  // fixtures don't already stand for, all settled so they fit.
  function furnishRoom(room, fixtures, pieces, grid) {
    const covered = new Set((fixtures || []).flatMap((f) => COVERS[Object.keys(COVERS).find((k) => fixtureType(f) === k)] || []));
    const keep = pieces.filter((it) => !covered.has(it.type));
    return settle((fixtures || []).concat(keep), room, grid);
  }
  const fixtureType = (it) => ({ counter: "kitchen_run", island: "island", bath: "bath", shower: "shower", wc: "wc", vanity: "basin", bed: "bed", wardrobe: "wardrobe", sofa: "sofa", table: "table" })[it.type];

  const rooms_px = (P, room) => { const b = boxOf(room); return { id: room.id, px: b }; };

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
    const frontDoors = closeFrontDoors(built.tr, rooms, built.mpp);
    if (frontDoors) console.info(`Floor plan: ${frontDoors} front door${frontDoors > 1 ? "s" : ""} closed (not shown as windows)`);
    const doorsCut = ensureConnected(built.tr, rooms, built.mpp);
    if (doorsCut) console.info(`Floor plan: ${doorsCut} doorway${doorsCut > 1 ? "s" : ""} added so every room can be reached`);
    const model = U.buildModel(built.tr, rooms, built.mpp);
    model.windows = "punched";   // ordinary windows (wall below the sill and above the head), not floor-to-ceiling glass
    const grid = gridOf(model);
    const fixtures = planFixtures(plan, rooms, built, grid);
    T.vedutaFixtures = fixtures;   // the photo furnishing keeps these too
    const near = (a, b) => !(a.px[2] + 8 < b.px[0] || b.px[2] + 8 < a.px[0] || a.px[3] + 8 < b.px[1] || b.px[3] + 8 < a.px[1]);
    const photos = project.photos || {}, panos = project.panoramas || {};
    const scanned = (id) => project.modelUrl && (photos[id] || []).length > 0;
    const outRooms = rooms.map((r) => {
      const [x0, y0, x1, y1] = r.px.map((v) => Math.round(v));
      const big = r.src.width > 3.5 && r.src.depth > 3.5;
      // photos become 3D photos when the backend can make depth maps (GET /depth/{project}/{photo}.png)
      const far = Math.max(5, Math.hypot(r.src.width, r.src.depth) * 1.25);
      const media = (photos[r.id] || []).map((p) => Object.assign({ type: "photo", src: p.url, name: p.name },
        project.depthBase ? { depth: `${project.depthBase}/${encodeURIComponent(p.id)}.png`, depthRange: [1.3, far], hfov: 70, depthAuto: true } : {}));
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
      furnishing: rooms.flatMap((r) => furnishRoom(r, fixtures[r.id], starterThatFits(U, r, built.tr, built.mpp), grid)),
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
        out.furnishing = furnishRoom(rooms_px(T.P, room), (T.vedutaFixtures || {})[room.id], out.furnishing, gridOf(T.P.model)).concat(art);
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
      if (out.count || art.length) {
        const fx = (T.vedutaFixtures || {})[room.id] || [];
        const settled = furnishRoom(rooms_px(P, room), fx, out.furnishing, gridOf(P.model));
        patch.furnishing = settled.concat(art);
        out.count = settled.filter((it) => !it.fromPlan).length;   // what actually fitted
      }
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
