/* Shared contract used by all three tracks: events, data loading, validation, images. */
(function () {
  const T = (window.Tour = window.Tour || {});

  // ---- Events -------------------------------------------------------------
  // Each build of the tour is a "generation". Handlers registered by a build stop running once the
  // tour is rebuilt (new floor plan or furniture), so the old views go quiet; shell-level handlers
  // pass {persistent: true}. T.alive(gen) lets render loops and window listeners check the same.
  T.gen = 0;
  T.alive = (gen) => gen === T.gen;
  T.emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  T.on = (name, fn, opts) => {
    const gen = T.gen, persistent = opts && opts.persistent;
    const h = (e) => { if (persistent || gen === T.gen) fn(e.detail || {}); else window.removeEventListener(name, h); };
    window.addEventListener(name, h);
  };

  // ---- Data ---------------------------------------------------------------
  T.loadProperty = async function () {
    if (window.PROPERTY_INLINE) return window.PROPERTY_INLINE;
    if (location.protocol === "file:") throw new Error("property.js is missing");
    const res = await fetch("property.json", { cache: "no-store" });
    if (!res.ok) throw new Error("property.json returned " + res.status);
    return res.json();
  };

  T.roomById = (P, id) => P.rooms.find((r) => r.id === id);
  // the room at a point on the plan. Rooms can overlap (an L-shaped hall measured as one rectangle, say),
  // so the smallest room containing the point wins: that's the one you're really standing in.
  const polyIn = (x, y, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  T.polyArea = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(a / 2); };
  T.roomAtPoint = (P, x, y) => {
    let best = null, area = Infinity;
    for (const r of P.rooms) { if (!polyIn(x, y, r.outline)) continue; const a = T.polyArea(r.outline); if (a < area) { area = a; best = r; } }
    return best;
  };
  T.floorById = (P, id) => P.floors.find((f) => f.id === id);
  T.linkLabel = (P, link) => {
    if (link.label) return link.label;
    if (link.to === "outside") return "Street";
    const r = T.roomById(P, link.to);
    return r ? r.name : link.to;
  };

  T.validate = function (P) {
    const out = [];
    if (!P || !Array.isArray(P.rooms) || !Array.isArray(P.floors)) return ["property.js needs “floors” and “rooms” arrays."];
    const loc = P.location || {};
    if ((loc.lat != null || loc.lng != null) && (typeof loc.lat !== "number" || typeof loc.lng !== "number"))
      out.push("location.lat and location.lng must both be numbers.");
    const ids = new Set();
    P.rooms.forEach((r) => {
      if (ids.has(r.id)) out.push(`Room id “${r.id}” is used twice.`);
      ids.add(r.id);
    });
    if (!ids.has(P.entryRoom)) out.push(`entryRoom “${P.entryRoom}” doesn’t match any room.`);
    P.rooms.forEach((r) => {
      if (!T.floorById(P, r.floor)) out.push(`${r.name}: floor “${r.floor}” doesn’t exist.`);
      if (!Array.isArray(r.outline) || r.outline.length < 3) out.push(`${r.name}: outline needs at least 3 points.`);
      if (!Array.isArray(r.media)) out.push(`${r.name}: media must be a list.`);
      (r.links || []).forEach((l) => {
        if (l.to !== "outside" && !ids.has(l.to)) out.push(`${r.name}: link to unknown room “${l.to}”.`);
        if ((l.x != null || l.y != null) && !(l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1)) out.push(`${r.name}: link to “${l.to}” needs x and y between 0 and 1.`);
        if (r.media && r.media.length && (l.media || 0) >= r.media.length) out.push(`${r.name}: link to “${l.to}” points at photo ${l.media} which doesn’t exist.`);
      });
    });
    return out;
  };

  // ---- Looking around ------------------------------------------------------
  // Grab and drag the scene to look around, with the mouse (left button) as with a finger: the open-hand cursor
  // closes while you drag. look(dYaw, dPitch) is called with radians, where +yaw turns left and +pitch looks up.
  // dragged() says whether the last press turned into a drag, so a click handler can ignore it.
  T.attachLook = function (el, look, opts = {}) {
    const k = opts.sensitivity || 0.0032;
    let drag = null, lastMoved = 0;
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
      lastMoved = 0;
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* already captured */ }
      el.classList.add("is-looking");
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy); lastMoved = drag.moved;
      if (Math.abs(dx) < 300 && Math.abs(dy) < 300) look(dx * k * 1.3, dy * k * 1.3);
      if (opts.onMove) opts.onMove(Math.abs(dx) + Math.abs(dy));
    });
    const end = (e) => { if (drag && (!e || e.pointerId === drag.id)) { drag = null; el.classList.remove("is-looking"); } };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
    window.addEventListener("blur", () => end());
    return { edge: () => 0, dragged: () => lastMoved > 5 };
  };

  // ---- Images -------------------------------------------------------------
  T.loadImage = (src) =>
    new Promise((resolve, reject) => {
      src = (window.TOUR_MEDIA && window.TOUR_MEDIA[src]) || src;
      const img = new Image();
      if (/^https?:$/.test(location.protocol) && !/^data:/.test(src)) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Couldn’t load " + src));
      img.src = src;
    });

  // Resolve a room's media item to an image. Missing files become labelled placeholders.
  const cache = new Map();
  T.resetCaches = () => cache.clear();
  T.mediaImage = function (P, room, idx) {
    const m = room.media[idx];
    const key = room.id + "#" + idx;
    if (cache.has(key)) return cache.get(key);
    const make = () => {
      const canvas = m.type === "pano" ? panoPlaceholder(P, room, idx) : photoPlaceholder(P, room, idx);
      return { image: canvas, placeholder: true };
    };
    const skip = !m.src || (P.__skipFiles && !m.src.startsWith("data:"));
    const p = (skip ? Promise.reject() : T.loadImage(m.src))
      .then((image) => ({ image, placeholder: false }))
      .catch(make);
    cache.set(key, p);
    return p;
  };
  T.preloadRoom = (P, room) => room && room.media.forEach((_, i) => T.mediaImage(P, room, i));

  function hue(id) {
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }
  const FONT = "Archivo, system-ui, sans-serif";

  function photoPlaceholder(P, room, idx) {
    const W = 1600, H = 1000;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const h = (hue(room.id) + idx * 23) % 360;
    const bx = W * 0.18, by = H * 0.14, bw = W * 0.64, bh = H * 0.56;
    g.fillStyle = `hsl(${h} 18% 90%)`; g.fillRect(0, 0, W, H);
    const quad = (pts, fill) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fillStyle = fill; g.fill(); };
    quad([[0, 0], [bx, by], [bx, by + bh], [0, H]], `hsl(${h} 22% 74%)`);
    quad([[W, 0], [bx + bw, by], [bx + bw, by + bh], [W, H]], `hsl(${h} 22% 70%)`);
    quad([[0, H], [bx, by + bh], [bx + bw, by + bh], [W, H]], `hsl(${(h + 30) % 360} 20% 50%)`);
    g.strokeStyle = "rgba(0,0,0,.08)"; g.lineWidth = 3;
    for (let i = 1; i < 12; i++) { const t = i / 12; g.beginPath(); g.moveTo(bx + bw * t, by + bh); g.lineTo(W * t, H); g.stroke(); }
    g.fillStyle = `hsl(${h} 26% 82%)`; g.fillRect(bx, by, bw, bh);
    // window
    const doorXs = (room.links || []).filter((l) => l.x != null && (l.media || 0) === idx).map((l) => l.x * W);
    const winX = [0.06, 0.8].map((t) => bx + bw * t)
      .sort((a, b) => Math.min(...doorXs.map((d) => Math.abs(d - b - bw * 0.07)), 1e9) - Math.min(...doorXs.map((d) => Math.abs(d - a - bw * 0.07)), 1e9))[0];
    g.fillStyle = `hsl(205 45% 82%)`; g.fillRect(winX, by + bh * 0.18, bw * 0.14, bh * 0.4);
    g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 6; g.strokeRect(winX, by + bh * 0.18, bw * 0.14, bh * 0.4);
    // doorways where this photo's links are
    (room.links || []).filter((l) => l.x != null && (l.media || 0) === idx).forEach((l) => {
      const dx = Math.min(Math.max(l.x * W, bx + 90), bx + bw - 90);
      g.fillStyle = `hsl(${h} 20% 32%)`;
      g.fillRect(dx - 75, by + bh * 0.3, 150, bh * 0.7);
      g.fillStyle = "rgba(255,255,255,.85)"; g.font = `500 26px ${FONT}`; g.textAlign = "center";
      g.fillText(T.linkLabel(P, l), dx, by + bh * 0.3 - 16);
    });
    g.textAlign = "center"; g.fillStyle = "rgba(20,25,27,.75)";
    g.font = `600 58px ${FONT}`; g.fillText(room.name, W / 2 + bw * 0.08, by + bh * 0.3);
    g.font = `400 28px ${FONT}`;
    g.fillText(`No photo yet: add ${room.media[idx].label || room.media[idx].src || "a photo"}`, W / 2 + bw * 0.08, by + bh * 0.3 + 48);
    return c;
  }

  function panoPlaceholder(P, room, idx) {
    const W = 2048, H = 1024;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const h = hue(room.id);
    g.fillStyle = `hsl(${h} 15% 92%)`; g.fillRect(0, 0, W, H * 0.34);
    g.fillStyle = `hsl(${h} 24% 80%)`; g.fillRect(0, H * 0.34, W, H * 0.34);
    g.fillStyle = `hsl(${(h + 30) % 360} 20% 48%)`; g.fillRect(0, H * 0.68, W, H * 0.32);
    g.strokeStyle = "rgba(0,0,0,.12)"; g.lineWidth = 4;
    [0.125, 0.375, 0.625, 0.875].forEach((t) => { g.beginPath(); g.moveTo(W * t, H * 0.34); g.lineTo(W * t, H * 0.68); g.stroke(); });
    (room.links || []).filter((l) => l.x != null && (l.media || 0) === idx).forEach((l) => {
      const dx = l.x * W;
      g.fillStyle = `hsl(${h} 20% 30%)`; g.fillRect(dx - 55, H * 0.4, 110, H * 0.28);
      g.fillStyle = "rgba(20,25,27,.75)"; g.font = `500 22px ${FONT}`; g.textAlign = "center";
      g.fillText(T.linkLabel(P, l), dx, H * 0.4 - 12);
    });
    g.textAlign = "center"; g.fillStyle = "rgba(20,25,27,.7)";
    for (const t of [0.0, 0.5]) {
      const x = W * t + (t === 0 ? W * 0.06 : 0);
      g.font = `600 38px ${FONT}`; g.fillText(room.name + " (360°)", x, H * 0.27);
      g.font = `400 20px ${FONT}`; g.fillText(`No photo yet: add ${room.media[idx].label || room.media[idx].src || "a 360° photo"}`, x, H * 0.27 + 30);
    }
    return c;
  }
})();
