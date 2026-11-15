/* Paint and wallpaper for the 3D walk.
   Each wall face that looks into a room is a "segment"; segments on the same plane, facing the same room,
   make one wall. A colour wheel, brightness, swatches and a few wallpaper patterns restyle one wall or a
   whole room. Choices are saved with the tour for its owner (database), or on this device for anyone else. */
(function () {
  const T = window.Tour;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ---- colour helpers ----
  const hsv2rgb = (h, s, v) => {
    const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
  };
  const rgb2hsv = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
  };
  const toHex = (rgb) => "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");
  const fromHex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const shade = (hex, k) => { const c = fromHex(hex); return toHex(c.map((x) => Math.max(0, Math.min(255, Math.round(k > 0 ? x + (255 - x) * k : x * (1 + k)))))); };
  const lum = (hex) => { const [r, g, b] = fromHex(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  const autoInk = (hex) => (lum(hex) > 0.55 ? shade(hex, -0.2) : shade(hex, 0.22));

  const SWATCHES = [
    ["Gallery white", "#f2efe8"], ["Portland stone", "#d9d1c3"], ["Greige", "#bdb3a5"], ["Sage", "#a9b59c"],
    ["Duck egg", "#bcd0cc"], ["Powder blue", "#c8d5e2"], ["Plaster pink", "#e4cabd"], ["Ochre", "#c9a24a"],
    ["Racing green", "#2d4436"], ["Navy", "#243247"], ["Oxblood", "#5e2a2a"], ["Charcoal", "#3b3a38"],
  ];
  const PATTERNS = [
    ["plain", "Plain paint"], ["stripe", "Regency stripe"], ["pinstripe", "Pinstripe"], ["trellis", "Trellis"],
    ["dots", "Polka dot"], ["damask", "Damask"], ["grasscloth", "Grasscloth"],
  ];
  const TILE = 0.6;   // metres covered by one pattern tile

  // draw one repeating tile of a pattern
  function drawPattern(ctx, S, pattern, base, ink) {
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = ink; ctx.strokeStyle = ink;
    const u = S / 256;
    if (pattern === "stripe") { for (let x = 0; x < S; x += 128 * u) ctx.fillRect(x, 0, 60 * u, S); ctx.globalAlpha = 0.5; for (let x = 0; x < S; x += 128 * u) ctx.fillRect(x + 70 * u, 0, 4 * u, S); ctx.globalAlpha = 1; }
    else if (pattern === "pinstripe") { for (let x = 0; x < S; x += 32 * u) ctx.fillRect(x, 0, 3 * u, S); }
    else if (pattern === "trellis") {
      ctx.lineWidth = 5 * u;
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath(); ctx.moveTo(k * 128 * u, 0); ctx.lineTo(k * 128 * u + S, S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(k * 128 * u + S, 0); ctx.lineTo(k * 128 * u, S); ctx.stroke();
      }
      for (const [x, y] of [[0, 0], [128, 128], [256, 0], [0, 256], [256, 256], [128, 0], [0, 128], [256, 128], [128, 256]]) {
        if ((x + y) % 256 !== 0 && !(x === 128 && y === 128)) continue;
        ctx.beginPath(); ctx.arc(x * u, y * u, 9 * u, 0, Math.PI * 2); ctx.fill();
      }
    }
    else if (pattern === "dots") { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { ctx.beginPath(); ctx.arc((x * 64 + (y % 2) * 32 + 16) * u, (y * 64 + 32) * u, 9 * u, 0, Math.PI * 2); ctx.fill(); } }
    else if (pattern === "damask") {
      const motif = (cx, cy, k) => {
        ctx.save(); ctx.translate(cx * u, cy * u); ctx.scale(k * u, k * u);
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 2);
          ctx.beginPath(); ctx.moveTo(0, -6); ctx.quadraticCurveTo(26, -30, 0, -58); ctx.quadraticCurveTo(-26, -30, 0, -6); ctx.fill();
          ctx.beginPath(); ctx.moveTo(10, -10); ctx.quadraticCurveTo(40, -14, 44, -40); ctx.lineWidth = 3; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      };
      motif(128, 128, 1);
      for (const [x, y] of [[0, 0], [256, 0], [0, 256], [256, 256]]) motif(x, y, 0.62);
    }
    else if (pattern === "grasscloth") {
      let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 900; i++) {
        ctx.globalAlpha = 0.06 + rnd() * 0.16; const y = rnd() * S, x = rnd() * S, l = (30 + rnd() * 110) * u;
        ctx.fillRect(x, y, l, (1 + rnd() * 1.5) * u); ctx.fillRect(x - S, y, l, (1 + rnd() * 1.5) * u);
      }
      ctx.globalAlpha = 0.18; for (let x = 0; x < S; x += 43 * u) ctx.fillRect(x, 0, 1.2 * u, S);
      ctx.globalAlpha = 1;
    }
  }

  T.Decorate = {
    attach(o) {
      const { root, THREE, scene, camera, canvas, wallMesh, M, G, GW, GH, cs, H, s, P, alive } = o;
      const SKIRT = 0.14;
      const indoor = (v) => v === 2 || v === 3 || v === 4 || v === 6 || v === 7;
      const inPoly = (x, y, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
      const roomAt = (cx, cz) => { const x = (cx + 0.5) * M.cell, y = (cz + 0.5) * M.cell; return P.rooms.find((r) => inPoly(x, y, r.outline)) || null; };

      // ---- wall faces that look into a room ----
      const segs = [], byRect = new Map();
      M.walls.forEach(([x, y, w, h], ri) => {
        const sides = [
          { dir: "n", len: w, at: (k) => [x + k, y - 1], plane: y, along: x },
          { dir: "s", len: w, at: (k) => [x + k, y + h], plane: y + h, along: x },
          { dir: "w", len: h, at: (k) => [x - 1, y + k], plane: x, along: y },
          { dir: "e", len: h, at: (k) => [x + w, y + k], plane: x + w, along: y },
        ];
        for (const sd of sides) {
          let k = 0;
          while (k < sd.len) {
            const [cx, cz] = sd.at(k);
            const ok = cx >= 0 && cz >= 0 && cx < GW && cz < GH && indoor(G[cz * GW + cx]);
            if (!ok) { k++; continue; }
            let e = k;
            while (e < sd.len) { const [ax, az] = sd.at(e); if (!(ax >= 0 && az >= 0 && ax < GW && az < GH && indoor(G[az * GW + ax]))) break; e++; }
            if (e - k >= 3) {
              const [mx, mz] = sd.at(Math.floor((k + e) / 2)), room = roomAt(mx, mz);
              const seg = { key: `${ri}${sd.dir}${k}`, ri, dir: sd.dir, plane: sd.plane, from: sd.along + k, to: sd.along + e, room: room ? room.id : null };
              seg.group = `${seg.room}|${seg.dir}|${seg.plane}`;
              segs.push(seg);
              if (!byRect.has(ri)) byRect.set(ri, []);
              byRect.get(ri).push(seg);
            }
            k = e;
          }
        }
      });

      // one "wall" = faces in the same room pointing the same way, with pillars and recesses (planes within ~0.7 m) included
      const tol = Math.max(2, Math.round(0.7 / cs));
      const buckets = new Map();
      segs.forEach((sg) => { const k = sg.room + "|" + sg.dir; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(sg); });
      buckets.forEach((list, k) => {
        list.sort((a, b) => a.plane - b.plane);
        let gid = 0, last = null;
        list.forEach((sg) => { if (last != null && sg.plane - last > tol) gid++; last = sg.plane; sg.group = `${k}|${gid}`; });
      });

      // ---- skins: a thin finished surface laid over each decorated face ----
      const skins = new THREE.Group(); scene.add(skins);
      const skinOf = new Map();
      const texCache = new Map(), matCache = new Map();
      const aoTex = (() => {
        const c = document.createElement("canvas"); c.width = 8; c.height = 256; const g = c.getContext("2d");
        for (let y = 0; y < 256; y++) { const t = 1 - y / 255, a = Math.min(1, 0.74 + t * 2.4) * Math.min(1, 0.88 + (1 - t) * 1.6); const v = Math.round(255 * a); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, 8, 1); }
        const t = new THREE.CanvasTexture(c); return t;
      })();
      const patternTex = (pattern, base, ink) => {
        const key = pattern + base + ink;
        if (texCache.has(key)) return texCache.get(key);
        const c = document.createElement("canvas"); c.width = c.height = 512;
        drawPattern(c.getContext("2d"), 512, pattern, base, ink);
        const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
        texCache.set(key, t); return t;
      };
      const material = (d) => {
        const key = d.pattern + d.color + (d.ink || "");
        if (matCache.has(key)) return matCache.get(key);
        let m;
        if (d.pattern === "plain") m = new THREE.MeshStandardMaterial({ color: new THREE.Color(d.color).convertSRGBToLinear(), map: aoTex, roughness: 0.92, envMapIntensity: 0.2 });
        else m = new THREE.MeshStandardMaterial({ map: patternTex(d.pattern, d.color, d.ink || autoInk(d.color)), roughness: d.pattern === "grasscloth" ? 0.95 : 0.8, envMapIntensity: 0.25 });
        matCache.set(key, m); return m;
      };
      function buildSkin(seg, d) {
        const L = (seg.to - seg.from) * cs, Hs = H - SKIRT;
        const g = new THREE.PlaneGeometry(L, Hs);
        const uv = g.attributes.uv, start = seg.from * cs;
        for (let i = 0; i < uv.count; i++) {
          if (d.pattern === "plain") uv.setXY(i, uv.getX(i), (SKIRT + uv.getY(i) * Hs) / H);
          else uv.setXY(i, (start + uv.getX(i) * L) / TILE, (SKIRT + uv.getY(i) * Hs) / TILE);
        }
        const mesh = new THREE.Mesh(g, material(d));
        const mid = ((seg.from + seg.to) / 2) * cs, p = seg.plane * cs, off = 0.004;
        if (seg.dir === "n") { mesh.position.set(mid, SKIRT + Hs / 2, p - off); mesh.rotation.y = Math.PI; }
        if (seg.dir === "s") { mesh.position.set(mid, SKIRT + Hs / 2, p + off); }
        if (seg.dir === "w") { mesh.position.set(p - off, SKIRT + Hs / 2, mid); mesh.rotation.y = -Math.PI / 2; }
        if (seg.dir === "e") { mesh.position.set(p + off, SKIRT + Hs / 2, mid); mesh.rotation.y = Math.PI / 2; }
        mesh.receiveShadow = true; mesh.userData.seg = seg;
        return mesh;
      }
      function paint(seg, d) {
        const old = skinOf.get(seg.key);
        if (old) { skins.remove(old); old.geometry.dispose(); skinOf.delete(seg.key); }
        if (!d) return;
        const m = buildSkin(seg, d); skins.add(m); skinOf.set(seg.key, m);
      }
      // walls saved earlier (with the tour for its owner, else on this device)
      const fingerprint = `${M.walls.length}:${M.grid.w}x${M.grid.h}`;
      let walls = (T.state && T.state.walls) || null;
      if (!walls) { try { const loc = JSON.parse(localStorage.getItem("tour-walls") || "null"); if (loc && loc.fp === fingerprint) walls = loc.walls; } catch (e) {} }
      walls = walls || {};
      // a room starts in the wall colour seen in its photos (room.wallColor); choices made here win
      const roomDefault = (id) => { const r = id && T.roomById(P, id); return r && r.wallColor ? { pattern: "plain", color: r.wallColor } : null; };
      segs.forEach((sg) => { const d = walls[sg.key] || roomDefault(sg.room); if (d) paint(sg, d); });
      o.renderer.shadowMap.needsUpdate = true;

      // ---- picking a wall ----
      const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
      const pick = (e) => {
        const r = canvas.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObjects([wallMesh, skins], true)[0];
        if (!hit) return null;
        if (hit.object.userData.seg) return hit.object.userData.seg;
        if (hit.instanceId == null || !hit.face) return null;
        const n = hit.face.normal, dir = Math.abs(n.x) > Math.abs(n.z) ? (n.x > 0 ? "e" : "w") : (n.z > 0 ? "s" : "n");
        const a = dir === "n" || dir === "s" ? hit.point.x / cs : hit.point.z / cs;
        return (byRect.get(hit.instanceId) || []).find((sg) => sg.dir === dir && a >= sg.from - 0.5 && a <= sg.to + 0.5) || null;
      };

      // highlight of the wall under the pointer, and of the selected wall
      const hiMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#c9a46a"), transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      const selMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#c9a46a"), transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      const hiGroup = new THREE.Group(), selGroup = new THREE.Group(); scene.add(hiGroup, selGroup);
      const outline = (group, list, mat) => {
        group.children.slice().forEach((c) => { group.remove(c); c.geometry.dispose(); });
        list.forEach((sg) => { const m = buildSkin(sg, { pattern: "plain", color: "#ffffff" }); m.material = mat; m.position.addScaledVector(new THREE.Vector3(sg.dir === "e" ? 1 : sg.dir === "w" ? -1 : 0, 0, sg.dir === "s" ? 1 : sg.dir === "n" ? -1 : 0), 0.003); group.add(m); });
      };
      const wallOf = (sg) => segs.filter((x) => x.group === sg.group);
      const roomWalls = (roomId) => segs.filter((x) => x.room === roomId);

      // ---- interface ----
      const toggle = el("button", "w3-deco", "Paint and wallpaper"); toggle.type = "button"; toggle.setAttribute("aria-pressed", "false");
      root.querySelector(".w3-style").insertBefore(toggle, root.querySelector(".w3-style p"));
      const tip = el("p", "dc-tip", "Click a wall to choose its colour or wallpaper"); tip.hidden = true; root.appendChild(tip);
      const panel = el("div", "dc-panel"); panel.hidden = true;
      panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Paint and wallpaper");
      panel.innerHTML = `
        <div class="dc-head"><h2>Walls</h2><button type="button" class="dc-done">Done</button></div>
        <p class="dc-target">Click a wall in the room to choose it.</p>
        <div class="dc-scope" role="group" aria-label="Apply to">
          <button type="button" data-scope="wall" aria-pressed="true">This wall</button>
          <button type="button" data-scope="room" aria-pressed="false">Whole room</button>
        </div>
        <div class="dc-which" role="group" aria-label="Colour to change" hidden>
          <button type="button" data-which="color" aria-pressed="true">Wall colour</button>
          <button type="button" data-which="ink" aria-pressed="false">Pattern colour</button>
        </div>
        <div class="dc-colour">
          <canvas class="dc-wheel" width="400" height="400" tabindex="0" aria-label="Colour wheel. Arrow keys change hue and saturation."></canvas>
          <div class="dc-side">
            <label class="dc-light-l">Brightness<input type="range" class="dc-light" min="8" max="100" value="94"></label>
            <div class="dc-hexrow"><span class="dc-chip"></span><input type="text" class="dc-hex" spellcheck="false" aria-label="Colour code" value="#f2efe8"></div>
          </div>
        </div>
        <div class="dc-swatches" role="group" aria-label="Paint colours"></div>
        <h3>Finish</h3>
        <div class="dc-patterns" role="group" aria-label="Finish"></div>
        <div class="dc-foot"><button type="button" class="dc-reset">Back to the original</button><span class="dc-note" aria-live="polite"></span></div>`;
      root.appendChild(panel);
      const $ = (q) => panel.querySelector(q);
      const wheel = $(".dc-wheel"), light = $(".dc-light"), hexIn = $(".dc-hex"), chip = $(".dc-chip"), note = $(".dc-note");

      // the wheel: hue round the circle, saturation outwards, brightness on the slider
      const wctx = wheel.getContext("2d"), WS = wheel.width, R = WS / 2 - 6;
      const wheelImg = wctx.createImageData(WS, WS);
      const drawWheel = () => {
        const v = light.value / 100;
        for (let y = 0; y < WS; y++) for (let x = 0; x < WS; x++) {
          const dx = x - WS / 2, dy = y - WS / 2, r = Math.hypot(dx, dy), o2 = (y * WS + x) * 4;
          if (r > R + 1) { wheelImg.data[o2 + 3] = 0; continue; }
          const [cr, cg, cb] = hsv2rgb((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, Math.min(1, r / R), v);
          wheelImg.data[o2] = cr; wheelImg.data[o2 + 1] = cg; wheelImg.data[o2 + 2] = cb; wheelImg.data[o2 + 3] = r > R ? Math.round(255 * (R + 1 - r)) : 255;
        }
        wctx.putImageData(wheelImg, 0, 0);
        const ang = (hsv[0] * Math.PI) / 180, rr = hsv[1] * R;
        wctx.beginPath(); wctx.arc(WS / 2 + Math.cos(ang) * rr, WS / 2 + Math.sin(ang) * rr, 11, 0, Math.PI * 2);
        wctx.lineWidth = 4; wctx.strokeStyle = v > 0.5 ? "#2b231c" : "#ffffff"; wctx.stroke();
      };

      let selected = [], scope = "wall", which = "color";
      let current = { pattern: "plain", color: "#f2efe8", ink: null };
      let hsv = rgb2hsv(...fromHex(current.color));
      const activeHex = () => (which === "ink" ? current.ink || autoInk(current.color) : current.color);
      function syncControls() {
        const hx = activeHex(); hsv = rgb2hsv(...fromHex(hx));
        light.value = Math.round(hsv[2] * 100); hexIn.value = hx; chip.style.background = hx;
        drawWheel();
        $(".dc-which").hidden = current.pattern === "plain";
        if (current.pattern === "plain" && which === "ink") setWhich("color");
        panel.querySelectorAll(".dc-patterns button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.p === current.pattern)));
      }
      function setWhich(w) { which = w; panel.querySelectorAll(".dc-which button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.which === w))); syncControls(); }
      function setColourFromHSV() {
        const hx = toHex(hsv2rgb(hsv[0], hsv[1], hsv[2]));
        if (which === "ink") current.ink = hx; else current.color = hx;
        hexIn.value = hx; chip.style.background = hx; drawWheel(); apply();
      }
      // apply the current finish to the selected wall(s) and save after a pause
      let saveTimer = null;
      function apply() {
        if (!selected.length) return;
        const d = { pattern: current.pattern, color: current.color };
        if (current.pattern !== "plain" && current.ink) d.ink = current.ink;
        const target = scope === "room" ? roomWalls(selected[0].room) : selected;
        target.forEach((sg) => { walls[sg.key] = d; paint(sg, d); });
        o.renderer.shadowMap.needsUpdate = true;
        clearTimeout(saveTimer); note.textContent = "";
        saveTimer = setTimeout(save, 900);
      }
      async function save() {
        const r = T.saveWalls ? await T.saveWalls(walls, fingerprint) : "none";
        note.textContent = r === "saved" ? "Saved with the tour" : r === "local" ? "Saved on this device" : "Shown here only; couldn’t be saved";
      }
      function select(sg) {
        selected = sg ? wallOf(sg) : [];
        outline(selGroup, scope === "room" && sg ? roomWalls(sg.room) : selected, selMat);
        if (!sg) { $(".dc-target").textContent = "Click a wall in the room to choose it."; return; }
        const room = T.roomById(P, sg.room);
        $(".dc-target").textContent = `${room ? room.name : "This room"}: ${scope === "room" ? "all walls" : "selected wall"}`;
        const d = walls[sg.key] || roomDefault(sg.room);
        current = d ? { pattern: d.pattern, color: d.color, ink: d.ink || null } : { pattern: "plain", color: "#f2efe8", ink: null };
        syncControls();
      }

      wheel.addEventListener("pointerdown", (e) => { wheel.setPointerCapture(e.pointerId); wheelPick(e); });
      wheel.addEventListener("pointermove", (e) => { if (e.buttons) wheelPick(e); });
      function wheelPick(e) {
        const r = wheel.getBoundingClientRect(), k = WS / r.width;
        const dx = (e.clientX - r.left) * k - WS / 2, dy = (e.clientY - r.top) * k - WS / 2;
        hsv[0] = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360; hsv[1] = Math.min(1, Math.hypot(dx, dy) / R);
        setColourFromHSV();
      }
      wheel.addEventListener("keydown", (e) => {
        const d = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] }[e.key];
        if (!d) return; e.preventDefault();
        hsv[0] = (hsv[0] + d[0] + 360) % 360; hsv[1] = Math.max(0, Math.min(1, hsv[1] + d[1])); setColourFromHSV();
      });
      light.addEventListener("input", () => { hsv[2] = light.value / 100; setColourFromHSV(); });
      hexIn.addEventListener("change", () => { const c = fromHex(hexIn.value.trim()); if (!c) { hexIn.value = activeHex(); return; } hsv = rgb2hsv(...c); light.value = Math.round(hsv[2] * 100); setColourFromHSV(); });
      SWATCHES.forEach(([name, hx]) => {
        const b = el("button", "dc-sw"); b.type = "button"; b.style.background = hx; b.title = name; b.setAttribute("aria-label", name);
        b.addEventListener("click", () => { hsv = rgb2hsv(...fromHex(hx)); light.value = Math.round(hsv[2] * 100); setColourFromHSV(); });
        $(".dc-swatches").appendChild(b);
      });
      PATTERNS.forEach(([p, name]) => {
        const b = el("button", "dc-pat"); b.type = "button"; b.dataset.p = p; b.setAttribute("aria-pressed", "false");
        const c = el("canvas"); c.width = c.height = 96; drawPattern(c.getContext("2d"), 96, p, "#e9e3d8", "#8b7a63");
        b.append(c, el("span", "", name));
        b.addEventListener("click", () => { current.pattern = p; syncControls(); apply(); });
        $(".dc-patterns").appendChild(b);
      });
      panel.querySelectorAll(".dc-scope button").forEach((b) => b.addEventListener("click", () => {
        scope = b.dataset.scope;
        panel.querySelectorAll(".dc-scope button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        if (selected.length) { select(selected[0]); }
      }));
      panel.querySelectorAll(".dc-which button").forEach((b) => b.addEventListener("click", () => setWhich(b.dataset.which)));
      $(".dc-reset").addEventListener("click", () => {
        if (!selected.length) return;
        const target = scope === "room" ? roomWalls(selected[0].room) : selected;
        target.forEach((sg) => { delete walls[sg.key]; paint(sg, roomDefault(sg.room)); });
        const d0 = roomDefault(selected[0].room);
        current = d0 ? { pattern: "plain", color: d0.color, ink: null } : { pattern: "plain", color: "#f2efe8", ink: null }; syncControls();
        o.renderer.shadowMap.needsUpdate = true; clearTimeout(saveTimer); saveTimer = setTimeout(save, 400);
      });

      // decorate mode on and off
      let on = false;
      const setOn = (v) => {
        on = v; toggle.setAttribute("aria-pressed", String(v)); panel.hidden = !v; tip.hidden = !v || selected.length > 0;
        root.classList.toggle("is-decorating", v);
        if (!v) { outline(hiGroup, [], hiMat); outline(selGroup, [], selMat); selected = []; select(null); }
        else syncControls();
      };
      toggle.addEventListener("click", () => setOn(!on));
      $(".dc-done").addEventListener("click", () => { setOn(false); toggle.focus(); });
      panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { setOn(false); toggle.focus(); } });
      let lastHover = null, hoverQueued = false, lastEvt = null;
      canvas.addEventListener("pointermove", (e) => {
        if (!on || e.pointerType !== "mouse") return;
        lastEvt = e;
        if (hoverQueued) return; hoverQueued = true;
        requestAnimationFrame(() => {
          hoverQueued = false; if (!alive() || !on) return;
          const sg = pick(lastEvt), key = sg ? sg.group : null;
          if (key !== lastHover) { lastHover = key; outline(hiGroup, sg ? wallOf(sg) : [], hiMat); }
        });
      });
      canvas.addEventListener("click", (e) => {
        if (!on) return;
        const sg = pick(e);
        if (sg) { select(sg); tip.hidden = true; }
      });
    },
  };
})();
