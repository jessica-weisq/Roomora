/* Track A: clickable floor plan. Listens for tour:room / tour:outside, emits tour:room / tour:outside / tour:floor. */
(function () {
  const T = window.Tour;
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const centroid = (pts) => {
    // area-weighted centroid, falls back to vertex average
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      const f = x0 * y1 - x1 * y0;
      a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    if (Math.abs(a) < 1e-6) return pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
    return [cx / (3 * a), cy / (3 * a)];
  };

  T.FloorPlan = {
    mount(root, P) {
      root.classList.add("fp");
      root.innerHTML = `
        <div class="fp-head">
          <div class="fp-tabs" role="tablist" aria-label="Floors"></div>
          <button type="button" class="fp-street" aria-pressed="false">Street</button>
          <button type="button" class="fp-size" aria-pressed="false">Enlarge</button>
        </div>
        <div class="fp-canvas"></div>
        <p class="fp-hint">Select a room to go there</p>`;
      const tabs = root.querySelector(".fp-tabs");
      const canvas = root.querySelector(".fp-canvas");
      const streetBtn = root.querySelector(".fp-street");
      let floorId = (T.roomById(P, P.entryRoom) || P.rooms[0]).floor;
      let currentRoom = null;

      P.floors.forEach((f) => {
        const b = document.createElement("button");
        b.type = "button"; b.setAttribute("role", "tab"); b.textContent = f.name; b.dataset.floor = f.id;
        b.addEventListener("click", () => showFloor(f.id, true));
        tabs.appendChild(b);
      });
      streetBtn.addEventListener("click", () => T.emit("tour:outside"));
      const sizeBtn = root.querySelector(".fp-size");
      sizeBtn.addEventListener("click", () => {
        const on = document.body.classList.toggle("plan-large");
        sizeBtn.setAttribute("aria-pressed", String(on));
        sizeBtn.textContent = on ? "Reduce" : "Enlarge";
        window.dispatchEvent(new Event("resize"));
      });

      function showFloor(id, announce) {
        floorId = id;
        tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.floor === id)));
        draw();
        if (announce) T.emit("tour:floor", { floorId: id });
      }

      function draw() {
        const f = T.floorById(P, floorId);
        const { w, h } = f.planSize;
        const unit = w / 1000;
        const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, role: "group", "aria-label": f.name + " plan" });
        const rooms = P.rooms.filter((r) => r.floor === floorId).sort((a, b) => T.polyArea(b.outline) - T.polyArea(a.outline));
        if (f.plan) {
          svg.appendChild(svgEl("image", { href: f.plan, x: 0, y: 0, width: w, height: h, class: "fp-image" }));
        } else {
          const walls = svgEl("g", { class: "fp-walls" });
          rooms.forEach((r) => walls.appendChild(svgEl("polygon", { points: r.outline.join(" "), "stroke-width": 7 * unit })));
          svg.appendChild(walls);
        }
        const g = svgEl("g", { class: "fp-rooms" });
        rooms.forEach((r) => {
          const a = svgEl("g", { class: "fp-room" + (r.id === currentRoom ? " is-current" : ""), tabindex: 0, role: "button", "aria-label": r.name });
          if (r.id === currentRoom) a.setAttribute("aria-current", "location");
          a.appendChild(svgEl("polygon", { points: r.outline.join(" "), "stroke-width": 3 * unit }));
          const [cx, cy] = centroid(r.outline);
          const xs = r.outline.map((p) => p[0]);
          const roomW = Math.max(...xs) - Math.min(...xs);
          const fs = Math.min(34 * unit, (roomW * 0.88) / (r.name.length * 0.52));
          const label = svgEl("text", { x: cx, y: cy, "font-size": fs, "text-anchor": "middle", "dominant-baseline": "middle" });
          label.textContent = r.name;
          if (!f.plan) a.appendChild(label);
          if (r.id === currentRoom) {
            const dy = f.plan ? 0 : 30 * unit;
            a.appendChild(svgEl("circle", { class: "fp-here-ring", cx, cy: cy + dy, r: 16 * unit }));
            a.appendChild(svgEl("circle", { class: "fp-here", cx, cy: cy + dy, r: 9 * unit }));
          }
          const go = () => T.emit("tour:room", { roomId: r.id });
          a.addEventListener("click", go);
          a.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
          g.appendChild(a);
        });
        svg.appendChild(g);
        const me = svgEl("g", { class: "fp-me", "aria-hidden": "true" });
        me.appendChild(svgEl("path", { class: "fp-me-cone", d: `M0,0 L${-26 * unit},${-44 * unit} A${51 * unit},${51 * unit} 0 0 1 ${26 * unit},${-44 * unit} Z` }));
        me.appendChild(svgEl("circle", { class: "fp-me-dot", r: 8 * unit }));
        svg.appendChild(me);
        meEl = me; placeMe();
        canvas.replaceChildren(svg);
      }

      T.on("tour:room", ({ roomId }) => {
        const r = T.roomById(P, roomId);
        if (!r) return;
        currentRoom = roomId;
        streetBtn.setAttribute("aria-pressed", "false");
        if (r.floor !== floorId) showFloor(r.floor, false); else draw();
      });
      T.on("tour:outside", () => {
        currentRoom = null;
        streetBtn.setAttribute("aria-pressed", "true");
        draw();
      });
      T.on("tour:data-changed", draw);
      let meEl = null, mePos = null;
      function placeMe() {
        if (!meEl) return;
        const r = mePos && T.roomById(P, currentRoom);
        const show = mePos && document.body.dataset.mode === "walk" && (!r || r.floor === floorId);
        meEl.style.display = show ? "" : "none";
        if (show) meEl.setAttribute("transform", `translate(${mePos.x} ${mePos.y}) rotate(${(-mePos.heading * 180) / Math.PI})`);
      }
      T.on("tour:position", (p) => { mePos = p; placeMe(); });
      T.on("tour:mode", placeMe);
      showFloor(floorId, false);
    },
  };
})();
