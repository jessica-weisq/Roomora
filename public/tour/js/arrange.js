/* Arrange furniture in the 3D walk. While it is on, the furniture is shown as separate pieces you can drag
   across the floor; pieces can be added from a catalogue, turned, resized, recoloured, duplicated or removed.
   The layout is saved with the tour for its owner (database), or on this device for anyone else. */
(function () {
  const T = window.Tour;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // top-down glyphs for the catalogue (34 × 26)
  const ICON = {
    sofa: '<rect x="4" y="6" width="26" height="15" rx="3"/><path d="M4 11h26M8 11v10M26 11v10"/>',
    armchair: '<path d="M8 20V10a9 7 0 0 1 18 0v10z"/><path d="M11 20v-6h12v6"/>',
    ottoman: '<rect x="7" y="7" width="20" height="13" rx="3"/><circle cx="13" cy="13.5" r=".8"/><circle cx="21" cy="13.5" r=".8"/>',
    coffeeRound: '<circle cx="17" cy="13" r="9"/><circle cx="17" cy="13" r="3.5"/>',
    sideboard: '<rect x="3" y="9" width="28" height="9" rx="1"/><path d="M10 9v9M17 9v9M24 9v9"/>',
    rug: '<rect x="4" y="5" width="26" height="16" rx="1"/><rect x="8" y="8" width="18" height="10" rx="1"/>',
    floorLamp: '<circle cx="17" cy="13" r="8"/><circle cx="17" cy="13" r="2"/>',
    roundShelf: '<circle cx="17" cy="13" r="7"/><path d="M12 13h10"/>',
    tv: '<rect x="4" y="9" width="26" height="5" rx="1"/><path d="M10 17h14"/>',
    shelving: '<rect x="3" y="8" width="28" height="10" rx="1"/><path d="M12 8v10M22 8v10"/>',
    plant: '<circle cx="17" cy="13" r="5"/><path d="M17 4c-4 3-4 6 0 9 4-3 4-6 0-9zM8 13c3-4 6-4 9 0-3 4-6 4-9 0zM26 13c-3-4-6-4-9 0 3 4 6 4 9 0z"/>',
    table: '<rect x="7" y="8" width="20" height="10" rx="1"/><rect x="10" y="3" width="4" height="3"/><rect x="20" y="3" width="4" height="3"/><rect x="10" y="20" width="4" height="3"/><rect x="20" y="20" width="4" height="3"/>',
    roundTable: '<circle cx="17" cy="13" r="6"/><rect x="15" y="1.5" width="4" height="3"/><rect x="15" y="21.5" width="4" height="3"/><rect x="5" y="11" width="3" height="4"/><rect x="26" y="11" width="3" height="4"/>',
    chair: '<rect x="11" y="8" width="12" height="12" rx="2"/><path d="M11 9h12"/>',
    island: '<rect x="9" y="3" width="16" height="20" rx="1"/><circle cx="29" cy="7" r="2"/><circle cx="29" cy="13" r="2"/><circle cx="29" cy="19" r="2"/>',
    counter: '<rect x="3" y="8" width="28" height="9" rx="1"/><rect x="20" y="10" width="7" height="5" rx="1"/>',
    bed: '<rect x="7" y="3" width="20" height="21" rx="1"/><rect x="9" y="5" width="7" height="4" rx="1"/><rect x="18" y="5" width="7" height="4" rx="1"/><path d="M7 12h20"/>',
    nightstand: '<rect x="9" y="7" width="16" height="12" rx="1"/><circle cx="17" cy="13" r="3"/>',
    bench: '<rect x="4" y="10" width="26" height="7" rx="2"/>',
    dresser: '<rect x="5" y="8" width="24" height="10" rx="1"/><path d="M12 14h10"/>',
    wardrobe: '<rect x="3" y="8" width="28" height="10" rx="1"/><path d="M10 8v10M17 8v10M24 8v10"/>',
    desk: '<rect x="5" y="5" width="24" height="11" rx="1"/><rect x="13" y="18" width="8" height="6" rx="1.5"/>',
    bookcase: '<rect x="3" y="9" width="28" height="8" rx="1"/><path d="M8 9v8M13 9v8M18 9v8M23 9v8"/>',
    console: '<rect x="5" y="10" width="24" height="6" rx="1"/><path d="M10 8h14"/>',
    bath: '<rect x="4" y="6" width="26" height="14" rx="2"/><rect x="7" y="9" width="20" height="8" rx="4"/>',
    vanity: '<rect x="4" y="8" width="26" height="10" rx="1"/><ellipse cx="12" cy="13" rx="4" ry="3"/><ellipse cx="22" cy="13" rx="4" ry="3"/>',
    wc: '<rect x="11" y="3" width="12" height="5" rx="1"/><ellipse cx="17" cy="15" rx="6" ry="8"/>',
    lounger: '<rect x="11" y="2" width="12" height="22" rx="2"/><path d="M11 9h12"/>',
    planter: '<rect x="3" y="10" width="28" height="7" rx="1"/><circle cx="9" cy="13.5" r="2"/><circle cx="17" cy="13.5" r="2"/><circle cx="25" cy="13.5" r="2"/>',
    hottub: '<rect x="6" y="3" width="22" height="20" rx="4"/><rect x="9" y="6" width="16" height="14" rx="3"/>',
  };

  // what can be added, and its starting options
  const CATALOGUE = [
    ["Living", [["sofa", "Sofa", { len: 2.4, color: "#e3dccf" }], ["armchair", "Armchair", { color: "#d7ccbb" }], ["ottoman", "Ottoman", { w: 1, d: 0.8, color: "#1f6b78" }],
      ["coffeeRound", "Coffee table", { r: 0.55 }], ["sideboard", "Sideboard", { len: 2, color: "#1d4f86" }], ["rug", "Rug", { w: 3, d: 2.4, color: "#e6e0d6" }],
      ["floorLamp", "Floor lamp", {}], ["roundShelf", "Side table", {}], ["tv", "TV wall", {}], ["shelving", "Shelving", { len: 2 }], ["plant", "Plant", {}]]],
    ["Dining and kitchen", [["table", "Dining table", { w: 2, d: 1, chairs: 3 }], ["roundTable", "Round table", { r: 0.5, chairs: 4 }], ["chair", "Chair", { chairColor: "#d9cfbf" }],
      ["island", "Island", { w: 1.3, d: 2.4 }], ["counter", "Kitchen run", { len: 2.4 }]]],
    ["Bedroom", [["bed", "Bed", { w: 1.6, l: 2.1, color: "#b7aa94" }], ["nightstand", "Bedside table", {}], ["bench", "Bench", { len: 1.4 }],
      ["dresser", "Chest of drawers", { len: 1.4 }], ["wardrobe", "Wardrobe", { len: 2 }]]],
    ["Study", [["desk", "Desk", { w: 1.6 }], ["bookcase", "Bookcase", { len: 2.2 }], ["console", "Console", { len: 1.4 }]]],
    ["Bathroom", [["bath", "Bath", { len: 1.7, w: 0.8 }], ["vanity", "Vanity", { len: 1.4, basins: 1 }], ["wc", "WC", {}]]],
    ["Outdoor", [["lounger", "Lounger", {}], ["planter", "Planter", { len: 2 }], ["hottub", "Hot tub", { w: 2.2 }]]],
  ];
  const NAME = {};
  CATALOGUE.forEach(([, items]) => items.forEach(([t, n]) => (NAME[t] = n)));

  // adjustable sizes per type: [key, label, min, max, step, default, shown as]
  const SIZES = {
    sofa: [["len", "Length", 1.6, 3.6, 0.1, 2.4]],
    ottoman: [["w", "Width", 0.5, 1.6, 0.05, 1], ["d", "Depth", 0.4, 1.2, 0.05, 0.8]],
    sideboard: [["len", "Length", 1, 3, 0.1, 2.2]],
    rug: [["w", "Width", 1.2, 6, 0.1, 3], ["d", "Depth", 1, 5, 0.1, 2.4]],
    shelving: [["len", "Length", 0.8, 3.2, 0.1, 2.6]],
    coffeeRound: [["r", "Diameter", 0.3, 0.8, 0.025, 0.55, "dia"]],
    table: [["w", "Length", 1, 3.6, 0.1, 2.4], ["d", "Width", 0.8, 1.4, 0.05, 1], ["chairs", "Chairs a side", 0, 5, 1, 3, "n"]],
    roundTable: [["r", "Diameter", 0.35, 0.8, 0.025, 0.5, "dia"], ["chairs", "Chairs", 0, 8, 1, 4, "n"]],
    island: [["w", "Width", 0.8, 1.6, 0.05, 1.3], ["d", "Length", 1.2, 3.2, 0.1, 2.4]],
    counter: [["len", "Length", 0.8, 4.5, 0.1, 3]],
    bed: [["w", "Width", 0.9, 2, 0.05, 1.8], ["l", "Length", 1.9, 2.3, 0.05, 2.1]],
    bench: [["len", "Length", 0.8, 2, 0.1, 1.5]],
    dresser: [["len", "Length", 0.8, 2.2, 0.1, 1.4]],
    wardrobe: [["len", "Length", 0.8, 3.6, 0.1, 2]],
    desk: [["w", "Width", 1, 2.2, 0.1, 1.6]],
    bookcase: [["len", "Length", 0.8, 3, 0.1, 2.2]],
    console: [["len", "Length", 0.8, 2.2, 0.1, 1.6]],
    bath: [["len", "Length", 1.4, 1.9, 0.05, 1.7]],
    vanity: [["len", "Length", 0.8, 2.2, 0.1, 1.6], ["basins", "Basins", 1, 2, 1, 2, "n"]],
    planter: [["len", "Length", 0.6, 6.5, 0.1, 3]],
    hottub: [["w", "Size", 1.6, 2.6, 0.1, 2.2]],
  };
  // which option holds the main colour
  const COLOUR = { sofa: "color", armchair: "color", ottoman: "color", sideboard: "color", rug: "color", bed: "color", nightstand: "color", chair: "chairColor", table: "chairColor", roundTable: "chairColor" };
  const FABRICS = [
    ["Ivory", "#efe9df"], ["Linen", "#e3dccf"], ["Oat", "#cdbfa9"], ["Taupe", "#b7aa94"], ["Tobacco", "#8a6f55"], ["Walnut", "#5a4a3c"],
    ["Sage", "#a9b59c"], ["Forest", "#2f5546"], ["Teal", "#1f6b78"], ["Navy", "#2c3550"], ["Oxblood", "#7a2b24"], ["Ochre", "#c9a24a"],
  ];
  const fmt = (spec, v) => (spec[6] === "n" ? String(v) : (spec[6] === "dia" ? v * 2 : v).toFixed(2).replace(/0$/, "") + " m");

  T.Arrange = {
    attach(o) {
      const { root, THREE, scene, camera, renderer, canvas, wallMesh, F, P, s, cs, GW, GH, aniso, alive, cellAt, inPoly, unstick } = o;
      const furnBtn = root.querySelector(".w3-furn");
      const shadows = () => (renderer.shadowMap.needsUpdate = true);
      const roomOf = (x, y) => P.rooms.find((r) => inPoly(x, y, r.outline)) || null;
      const walkable = (x, z) => cellAt(x, z) >= 2;

      // ---- interface ----
      const toggle = el("button", "w3-deco w3-arrange", "Arrange furniture"); toggle.type = "button"; toggle.setAttribute("aria-pressed", "false");
      root.querySelector(".w3-style").insertBefore(toggle, root.querySelector(".w3-style p"));
      const tip = el("p", "dc-tip", "Drag a piece to move it. Drag empty space to look around."); tip.hidden = true; root.appendChild(tip);
      const panel = el("div", "dc-panel ar-panel"); panel.hidden = true;
      panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Arrange furniture");
      panel.innerHTML = `
        <div class="dc-head"><h2>Furniture</h2><button type="button" class="dc-done">Done</button></div>
        <section class="ar-sel" hidden>
          <div class="ar-title"><p class="ar-name"></p><p class="ar-where"></p></div>
          <div class="ar-row" role="group" aria-label="Turn">
            <button type="button" class="ar-btn" data-turn="-15" aria-label="Turn left 15 degrees">↺ 15°</button>
            <button type="button" class="ar-btn" data-turn="15" aria-label="Turn right 15 degrees">↻ 15°</button>
            <button type="button" class="ar-btn" data-turn="90">Quarter turn</button>
          </div>
          <div class="ar-sizes"></div>
          <div class="ar-colours"><h3>Colour</h3><div class="dc-swatches" role="group" aria-label="Colour"></div></div>
          <div class="ar-row">
            <button type="button" class="ar-btn ar-dup">Duplicate</button>
            <button type="button" class="ar-btn is-danger ar-del">Remove</button>
            <button type="button" class="ar-btn is-primary ar-new">Add a piece</button>
          </div>
        </section>
        <section class="ar-add">
          <p class="dc-target">Drag any piece to move it, or choose one below to place it in front of you. R turns the selected piece; Delete removes it.</p>
          <div class="ar-cats"></div>
        </section>
        <div class="ar-foot">
          <button type="button" class="ar-btn ar-undo" disabled>Undo</button>
          <button type="button" class="dc-reset ar-reset-room">Reset this room</button>
          <button type="button" class="dc-reset ar-reset-all">Reset all</button>
          <span class="dc-note" aria-live="polite"></span>
        </div>`;
      root.appendChild(panel);
      const $ = (q) => panel.querySelector(q);
      const note = $(".dc-note");

      CATALOGUE.forEach(([cat, items]) => {
        $(".ar-cats").appendChild(el("h3", "", cat));
        const grid = el("div", "ar-grid");
        items.forEach(([type, name, opts]) => {
          const b = el("button", "ar-item"); b.type = "button";
          b.innerHTML = `<svg viewBox="0 0 34 26" aria-hidden="true">${ICON[type] || '<rect x="7" y="6" width="20" height="14" rx="2"/>'}</svg>`;
          b.appendChild(el("span", "", name));
          b.addEventListener("click", () => addPiece(type, opts));
          grid.appendChild(b);
        });
        $(".ar-cats").appendChild(grid);
      });
      FABRICS.forEach(([name, hx]) => {
        const b = el("button", "dc-sw ar-sw"); b.type = "button"; b.style.background = hx; b.title = name; b.dataset.hex = hx;
        b.setAttribute("aria-label", name); b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => { const it = sel && sel.userData.item, k = it && COLOUR[it.type]; if (!k) return; it[k] = hx; rebuildSelected(); commit(); });
        $(".ar-colours .dc-swatches").appendChild(b);
      });

      // ---- live furniture ----
      let live = null;
      const dispose = (group) => group.traverse((m) => {
        if (!m.isMesh) return;
        m.geometry.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => { ["map", "bumpMap"].forEach((k) => mt[k] && mt[k].dispose()); mt.dispose(); });
      });
      const swapIn = (built) => {
        const vis = F.group ? F.group.visible : true;
        if (F.group) { scene.remove(F.group); dispose(F.group); }
        F.group = built.group; F.blocked = built.blocked; F.group.visible = vis;
        scene.add(F.group); shadows();
      };
      const goLive = () => { live = T.buildFurniture(THREE, P, { s, cs, GW, GH, aniso, live: true }); swapIn(live); };
      const goMerged = () => { live = null; swapIn(T.buildFurniture(THREE, P, { s, cs, GW, GH, aniso })); unstick(); };
      const reblock = () => { if (live) { F.blocked = live.blockedFrom(live.nodes); unstick(); } };
      const pieces = () => P.furnishing.filter((f) => f.type !== "art");

      // ---- selection outline ----
      const selBox = new THREE.Box3();
      const helper = new THREE.Box3Helper(selBox, new THREE.Color("#c9a46a"));
      helper.material.depthTest = false; helper.material.transparent = true; helper.renderOrder = 10; helper.visible = false;
      scene.add(helper);
      let sel = null;
      const outline = () => {
        helper.visible = !!sel;
        if (!sel) return;
        sel.updateMatrixWorld(true);
        selBox.setFromObject(sel.children[0]).expandByScalar(0.03);
        if (selBox.max.y - selBox.min.y < 0.05) selBox.max.y = selBox.min.y + 0.05;
      };

      function select(node) {
        sel = node || null; outline();
        $(".ar-sel").hidden = !sel; $(".ar-add").hidden = !!sel;
        if (!sel) return;
        const it = sel.userData.item, room = T.roomById(P, it.room);
        $(".ar-name").textContent = NAME[it.type] || it.type.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
        $(".ar-where").textContent = room ? room.name : "";
        const sizes = $(".ar-sizes"); sizes.replaceChildren();
        (SIZES[it.type] || []).forEach((sp) => {
          const [key, label, min, max, step, def] = sp;
          const row = el("label", "ar-slider"), input = el("input"), out = el("output");
          input.type = "range"; input.min = min; input.max = max; input.step = step;
          input.value = it[key] != null ? it[key] : def; out.textContent = fmt(sp, +input.value);
          input.addEventListener("input", () => { it[key] = +input.value; out.textContent = fmt(sp, +input.value); rebuildSelected(); });
          input.addEventListener("change", () => { reblock(); commit(); });
          row.append(el("span", "", label), input, out); sizes.appendChild(row);
        });
        const ck = COLOUR[it.type];
        $(".ar-colours").hidden = !ck;
        panel.querySelectorAll(".ar-sw").forEach((b) => b.setAttribute("aria-pressed", String(!!ck && (it[ck] || "").toLowerCase() === b.dataset.hex)));
      }
      function rebuildSelected() {
        if (!sel || !live) return;
        const it = sel.userData.item, i = live.nodes.indexOf(sel);
        const node = live.makeNode(it);
        live.group.remove(sel); live.group.add(node);   // materials and shapes are shared between pieces, so nothing is disposed here
        live.nodes[i] = node; sel = node;
        outline(); shadows();
        panel.querySelectorAll(".ar-sw").forEach((b) => b.setAttribute("aria-pressed", String(!!COLOUR[it.type] && (it[COLOUR[it.type]] || "").toLowerCase() === b.dataset.hex)));
      }
      function turn(deg) {
        if (!sel) return;
        const it = sel.userData.item;
        it.rot = (((Math.round((it.rot || 0) + deg) % 360) + 360) % 360);
        rebuildSelected(); reblock(); commit();
      }
      function removeSelected() {
        if (!sel || !live) return;
        const it = sel.userData.item;
        P.furnishing.splice(P.furnishing.indexOf(it), 1);
        live.nodes.splice(live.nodes.indexOf(sel), 1);
        live.group.remove(sel);
        select(null); reblock(); shadows(); commit();
      }
      function place(it) {
        P.furnishing.push(it);
        const node = live.makeNode(it);
        live.group.add(node); live.nodes.push(node);
        reblock(); shadows(); select(node); commit();
      }
      function addPiece(type, opts) {
        const v = o.view();
        // a clear spot in view ahead: far enough to be seen from eye height, off other pieces, inside the flat
        const clear = (x, z) => {
          if (!walkable(x, z)) return false;
          for (let a = 0; a < 8; a++) if (!walkable(x + Math.cos((a * Math.PI) / 4) * 0.45, z + Math.sin((a * Math.PI) / 4) * 0.45)) return false;
          const c = Math.floor(x / cs) + Math.floor(z / cs) * GW;
          return !(F.blocked && F.blocked[c]);
        };
        const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
        let x = null, z = null;
        search: for (const d of [3, 2.6, 3.4, 2.2, 3.8, 1.8, 1.4]) for (const l of [0, 0.7, -0.7, 1.4, -1.4]) {
          const tx = v.x + fx * d + rx * l, tz = v.z + fz * d + rz * l;
          if (clear(tx, tz)) { x = tx; z = tz; break search; }
        }
        if (x === null) for (const d of [2.2, 1.6, 1, 0.6]) { const tx = v.x + fx * d, tz = v.z + fz * d; if (walkable(tx, tz)) { x = tx; z = tz; break; } }
        if (x === null) { x = v.x; z = v.z; }
        const room = roomOf(x / s, z / s) || o.roomAt();
        const rot = (((Math.round((v.yaw * 180) / Math.PI / 15) * 15) % 360) + 360) % 360;   // facing you
        place(Object.assign({ room: room ? room.id : (P.rooms[0] || {}).id, type, x: +(x / s).toFixed(1), y: +(z / s).toFixed(1), rot }, clone(opts)));
        tip.hidden = true;
      }
      function duplicate() {
        if (!sel) return;
        const it = clone(sel.userData.item), step = 0.6 / s;
        const a = ((it.rot || 0) * Math.PI) / 180;
        const tries = [[Math.cos(a), -Math.sin(a)], [-Math.cos(a), Math.sin(a)], [Math.sin(a), Math.cos(a)], [0, 0]];
        for (const [dx, dy] of tries) if (walkable((it.x + dx * step) * s, (it.y + dy * step) * s)) { it.x = +(it.x + dx * step).toFixed(1); it.y = +(it.y + dy * step).toFixed(1); break; }
        place(it);
      }

      // ---- undo and saving ----
      const undo = [];
      let base = null, saveTimer = null;
      const snap = () => JSON.stringify(pieces());
      function commit() {
        const now = snap();
        if (base !== null && now !== base) { undo.push(base); if (undo.length > 60) undo.shift(); }
        base = now;
        $(".ar-undo").disabled = !undo.length;
        clearTimeout(saveTimer); note.textContent = "";
        saveTimer = setTimeout(save, 700);
      }
      async function save() {
        const r = T.saveLayout ? await T.saveLayout(pieces()) : "none";
        note.textContent = r === "saved" ? "Saved with the tour" : r === "local" ? "Saved on this device" : "Shown here only; couldn’t be saved";
      }
      function restore(items) {
        const art = P.furnishing.filter((f) => f.type === "art");
        P.furnishing.length = 0;
        P.furnishing.push(...art, ...items);
        select(null); goLive(); unstick();
      }
      $(".ar-undo").addEventListener("click", doUndo);
      function doUndo() {
        if (!undo.length) return;
        restore(JSON.parse(undo.pop()));
        base = snap(); $(".ar-undo").disabled = !undo.length;
        clearTimeout(saveTimer); saveTimer = setTimeout(save, 400);
      }
      const resetRoomBtn = $(".ar-reset-room");
      const labelReset = () => { const r = o.roomAt(); resetRoomBtn.textContent = r ? `Reset ${r.name.toLowerCase()}` : "Reset this room"; resetRoomBtn.disabled = !r; };
      resetRoomBtn.addEventListener("click", () => {
        const r = o.roomAt(); if (!r || !T.originalFurnishing) return;
        restore(pieces().filter((f) => f.room !== r.id).concat(T.originalFurnishing().filter((f) => f.room === r.id)));
        commit();
      });
      $(".ar-reset-all").addEventListener("click", () => { if (T.originalFurnishing) { restore(T.originalFurnishing()); commit(); } });
      T.on("tour:room", labelReset);

      // ---- picking and dragging ----
      const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitV = new THREE.Vector3();
      const aim = (e) => { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); };
      function pick(e) {
        if (!live) return null;
        aim(e);
        for (const h of ray.intersectObjects(live.nodes.concat(wallMesh), true)) {
          if (h.object === wallMesh) return null;    // behind a wall
          let n = h.object; while (n && !(n.userData && n.userData.item)) n = n.parent;
          if (n && n.userData.item.type !== "art") return n;
        }
        return null;
      }
      const floorAt = (e) => { aim(e); return ray.ray.intersectPlane(floor, hitV); };

      let on = false, drag = null, lookDrag = false, lastKind = "mouse", down = null;
      canvas.addEventListener("pointerdown", (e) => {
        lastKind = e.pointerType;
        if (!on || (e.pointerType === "mouse" && e.button !== 0)) return;
        const n = pick(e);
        if (n) {
          if (n !== sel) select(n);
          const p = floorAt(e);
          drag = { node: n, id: e.pointerId, ox: p ? n.position.x - p.x : 0, oz: p ? n.position.z - p.z : 0, moved: false };
          canvas.setPointerCapture(e.pointerId); canvas.classList.add("is-grabbing");
          e.preventDefault();
        } else {
          if (e.pointerType === "mouse") lookDrag = true;
          down = { x: e.clientX, y: e.clientY };
        }
      });
      canvas.addEventListener("pointermove", (e) => {
        lastKind = e.pointerType;
        if (!on) return;
        if (drag && e.pointerId === drag.id) {
          const p = floorAt(e); if (!p) return;
          const nx = p.x + drag.ox, nz = p.z + drag.oz;
          if (!walkable(nx, nz)) return;
          drag.node.position.x = nx; drag.node.position.z = nz;
          const it = drag.node.userData.item; it.x = +(nx / s).toFixed(1); it.y = +(nz / s).toFixed(1);
          drag.moved = true; outline(); shadows(); tip.hidden = true;
          return;
        }
        if (e.pointerType === "mouse" && !e.buttons) hover(e);
      });
      const endDrag = (e) => {
        lookDrag = false;
        if (drag && e.pointerId === drag.id) {
          canvas.classList.remove("is-grabbing");
          if (drag.moved) {
            const it = drag.node.userData.item, r = roomOf(it.x, it.y);
            if (r) it.room = r.id;
            reblock(); commit(); select(drag.node);
          }
          drag = null; return;
        }
        if (on && down && e.type === "pointerup" && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) select(null);
        down = null;
      };
      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);
      let hoverQueued = false, hoverEvt = null;
      function hover(e) {
        hoverEvt = e; if (hoverQueued) return; hoverQueued = true;
        requestAnimationFrame(() => { hoverQueued = false; if (!alive() || !on) return; canvas.classList.toggle("is-grab", !!pick(hoverEvt)); });
      }

      // ---- buttons and keys ----
      panel.querySelectorAll("[data-turn]").forEach((b) => b.addEventListener("click", () => turn(+b.dataset.turn)));
      $(".ar-dup").addEventListener("click", duplicate);
      $(".ar-del").addEventListener("click", removeSelected);
      $(".ar-new").addEventListener("click", () => select(null));
      const typing = (t) => t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== "range";
      window.addEventListener("keydown", (e) => {
        if (!on || !alive() || !o.visible() || typing(document.activeElement)) return;
        const k = e.key;
        if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "z") { e.preventDefault(); doUndo(); return; }
        if (!sel) return;
        if (k === "Delete" || k === "Backspace") { e.preventDefault(); removeSelected(); }
        else if (k.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); turn(e.shiftKey ? -15 : 15); }
        else if (k === "Escape") { e.preventDefault(); select(null); }
      });

      // ---- mode on and off ----
      let tipTimer = null;
      function setOn(v) {
        if (v === on) return;
        on = v;
        toggle.setAttribute("aria-pressed", String(v)); panel.hidden = !v;
        root.classList.toggle("is-arranging", v);
        canvas.classList.remove("is-grab", "is-grabbing");
        if (v) {
          const deco = root.querySelector(".dc-panel:not(.ar-panel)");
          if (deco && !deco.hidden) deco.querySelector(".dc-done").click();
          if (!F.group.visible) furnBtn.click();
          goLive(); select(null); labelReset();
          base = snap();
          tip.hidden = false; clearTimeout(tipTimer); tipTimer = setTimeout(() => (tip.hidden = true), 9000);
        } else {
          drag = null; lookDrag = false; select(null); tip.hidden = true;
          goMerged();
        }
      }
      toggle.addEventListener("click", () => setOn(!on));
      $(".dc-done").addEventListener("click", () => { setOn(false); toggle.focus(); });
      panel.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sel) { setOn(false); toggle.focus(); } });
      const deco = root.querySelector(".w3-deco:not(.w3-arrange):not(.w3-furnish)");
      if (deco) deco.addEventListener("click", () => setOn(false));
      furnBtn.addEventListener("click", () => { if (on && !F.group.visible) setOn(false); });

      // the walk asks: should mouse movement turn the view right now? is this double-click on a piece?
      return {
        look: () => on && (!!drag || (lastKind === "mouse" && !lookDrag)),
        busy: (e) => on && !!pick(e),
      };
    },
  };
})();

