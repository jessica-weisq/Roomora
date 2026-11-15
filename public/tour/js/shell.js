/* Shell: loads the property and any saved changes, mounts the views, switches between 3D walk,
   photos and street, and rebuilds everything when the flat changes (new plan or furniture). */
(async function () {
  const T = window.Tour;
  const $ = (s) => document.querySelector(s);
  let BASE;
  try {
    // inside the Veduta website the project comes from the page around the tour
    BASE = T.isEmbed ? await T.fromVeduta(await T.waitForVeduta()) : await T.loadProperty();
  } catch (e) {
    if (T.isEmbed) {
      $(".app-main").innerHTML = `<div class="fatal"><h2>The walk-through couldn’t be built</h2><p>Something in this project’s floor plan couldn’t be read. Close this and try the 3D view instead.</p></div>`;
      console.error(e);
      return;
    }
    $(".app-main").innerHTML = `<div class="fatal"><h2>The tour couldn’t load its data</h2>
      <p>Check that <code>property.js</code> is in the same folder as <code>index.html</code>, and that it starts with <code>window.PROPERTY_INLINE =</code>.</p></div>`;
    return;
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---- saved changes (made with Add photos), kept in the page's database ----
  // tour/state = { plan: null | {floors, rooms, model, furnishing, entryRoom, startRoom},
  //                rooms: { [roomId]: { furnishing: [...], photos: [{id, facing}], floorClass } } }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
  let db = null, saved = null;
  if (window.claude && window.claude.use) {
    db = await withTimeout(window.claude.use("db").catch(() => null), 6000);
    if (db) {
      const snap = await withTimeout(db.doc("tour/state").get().catch(() => null), 6000);
      if (snap && snap.exists) saved = snap.data();
    }
  }
  T.db = db;

  // apply saved changes on top of the original listing
  T.compose = function (state) {
    const P = clone(BASE);
    if (state && state.plan) {
      const pl = state.plan;
      P.floors = pl.floors; P.rooms = pl.rooms; P.model = pl.model; P.furnishing = pl.furnishing || [];
      P.entryRoom = pl.entryRoom; P.startRoom = pl.startRoom;
    }
    const patches = (state && state.rooms) || {};
    for (const id in patches) {
      const room = P.rooms.find((r) => r.id === id), pt = patches[id];
      if (!room) continue;
      if (Array.isArray(pt.furnishing)) P.furnishing = P.furnishing.filter((f) => f.room !== id || f.type === "art").concat(pt.furnishing);
      (pt.photos || []).forEach((ph) => room.media.push({ type: "photo", src: "/_blob/" + ph.id, uploaded: true }));
      if (pt.floorClass && P.model && T.setRoomFloor) T.setRoomFloor(P, room, pt.floorClass);
      if (pt.wallColor) room.wallColor = pt.wallColor;
    }
    // furniture rearranged with Arrange furniture: the whole layout (pictures on the walls stay as they are)
    if (state && Array.isArray(state.layout)) P.furnishing = P.furnishing.filter((f) => f.type === "art").concat(clone(state.layout));
    return P;
  };
  // which floor plan a layout saved on this device belongs to
  const layoutFp = (state) => {
    const m = (state && state.plan && state.plan.model) || BASE.model;
    return BASE.id + ":" + (m && m.grid ? m.grid.w + "x" + m.grid.h : "");
  };
  T.state = saved || { plan: null, rooms: {} };
  if (!Array.isArray(T.state.layout)) {
    try {
      const loc = JSON.parse(localStorage.getItem("tour-layout") || "null");
      if (loc && loc.fp === layoutFp(T.state) && Array.isArray(loc.items)) T.state = Object.assign({}, T.state, { layout: loc.items });
    } catch (e) {}
  }
  let P = T.compose(T.state);

  const views = { walk: $(".view-walk"), photos: $(".view-inside"), street: $(".view-street") };
  const buttons = { walk: $(".mode-walk"), photos: $(".mode-inside"), street: $(".mode-street") };
  const editBtn = $(".mode-edit");
  const planCard = $(".app-plan"), planShow = $(".plan-show");
  let mode = null, insideMode = P.startView === "photos" ? "photos" : "walk", lastRoom = P.startRoom || P.entryRoom;

  function setMode(m, force) {
    if (m === mode && !force) return;
    mode = m;
    if (m !== "street") insideMode = m;
    for (const k in views) {
      views[k].hidden = k !== m;
      buttons[k].setAttribute("aria-pressed", String(k === m));
    }
    editBtn.hidden = m !== "photos";
    if (m !== "photos" && editBtn.getAttribute("aria-pressed") === "true") editBtn.click();
    document.body.dataset.mode = m;
    T.emit("tour:mode", { mode: m });
    setHash(m === "street" ? "street" : (m === "photos" ? "photos-" : "room-") + lastRoom);
    window.dispatchEvent(new Event("resize"));
  }
  let hashState = null;
  function setHash(h) {
    hashState = h;
    if (location.hash.slice(1) !== h) history.replaceState(null, "", "#" + h);
  }
  const showPlan = (on) => {
    planCard.hidden = !on; planShow.hidden = on;
    try { localStorage.setItem("tour-plan", on ? "shown" : "hidden"); } catch (e) {}
    window.dispatchEvent(new Event("resize"));
  };
  planShow.addEventListener("click", () => { showPlan(true); const h = planCard.querySelector(".plan-hide"); if (h) h.focus(); });

  function showProblems() {
    const problems = T.validate(P), box = $(".app-warnings");
    box.hidden = !problems.length;
    box.querySelector("ul").replaceChildren(...problems.map((p) => Object.assign(document.createElement("li"), { textContent: p })));
  }
  $(".app-warnings button").addEventListener("click", () => ($(".app-warnings").hidden = true));

  // build (or rebuild) every view from P
  function mountAll() {
    T.gen += 1;
    T.resetCaches();
    T.P = P;
    document.title = P.address + " tour";
    $(".app-address").textContent = P.address;
    $(".app-sub").textContent = P.subtitle || "";
    $(".app-sub").hidden = !P.subtitle;
    showProblems();
    for (const el of [planCard, views.walk, views.photos, views.street]) { el.replaceChildren(); el.className = el.className.split(" ")[0]; }
    T.FloorPlan.mount(planCard, P);
    const hideBtn = document.createElement("button");
    hideBtn.type = "button"; hideBtn.className = "plan-hide"; hideBtn.textContent = "Hide";
    planCard.querySelector(".fp-head").appendChild(hideBtn);
    hideBtn.addEventListener("click", () => { showPlan(false); planShow.focus(); });
    T.RoomViewer.mount(views.photos, P);
    T.StreetView.mount(views.street, P);
    T.Walk3D.mount(views.walk, P);
    if (!T.roomById(P, lastRoom)) lastRoom = P.startRoom || P.entryRoom || (P.rooms[0] || {}).id;
    T.emit("tour:built", { P });
  }

  // wall colours and wallpaper: saved with the tour where this viewer may write, else on this device
  T.saveWalls = async function (walls, fp) {
    T.state = Object.assign({}, T.state, { walls });
    if (db) { try { await db.doc("tour/state").set(T.state); return "saved"; } catch (e) { /* not allowed to write: keep it locally */ } }
    try { localStorage.setItem("tour-walls", JSON.stringify({ fp, walls })); return "local"; } catch (e) { return "none"; }
  };

  // furniture layout: saved with the tour where this viewer may write, else on this device
  T.saveLayout = async function (items) {
    T.state = Object.assign({}, T.state, { layout: clone(items) });
    if (db) { try { await db.doc("tour/state").set(T.state); return "saved"; } catch (e) { /* not allowed to write: keep it locally */ } }
    try { localStorage.setItem("tour-layout", JSON.stringify({ fp: layoutFp(T.state), items })); return "local"; } catch (e) { return "none"; }
  };
  T.originalFurnishing = () => T.compose(Object.assign({}, T.state, { layout: null })).furnishing.filter((f) => f.type !== "art");

  // used by Add photos: save the new state, then rebuild and return to a room
  T.applyState = async function (state, roomId) {
    const prev = T.state;
    // keep a rearranged layout in step: a new floor plan starts afresh, a refurnished room takes its new pieces
    if (state && Array.isArray(state.layout) && prev) {
      state = Object.assign({}, state);
      if (JSON.stringify(state.plan || null) !== JSON.stringify(prev.plan || null)) delete state.layout;
      else {
        const was = prev.rooms || {}, now = state.rooms || {};
        let items = state.layout;
        for (const id in now) {
          const a = now[id] && now[id].furnishing, b = was[id] && was[id].furnishing;
          if (Array.isArray(a) && JSON.stringify(a) !== JSON.stringify(b || null)) items = items.filter((f) => f.room !== id).concat(clone(a).filter((f) => f.type !== "art"));
        }
        state.layout = items;
      }
    }
    T.state = state;
    P = T.compose(state);
    if (roomId) lastRoom = roomId;
    mountAll();
    setMode(mode || insideMode, true);
    T.emit("tour:room", { roomId: lastRoom });
    if (db) {
      try { await db.doc("tour/state").set(state); }
      catch (e) { return { saved: false, error: e, prev }; }
      return { saved: true, prev };
    }
    return { saved: false, prev };
  };

  let saw = null;
  try { saw = localStorage.getItem("tour-plan"); } catch (e) {}
  showPlan(saw ? saw === "shown" : !window.matchMedia("(max-width: 760px)").matches);
  mountAll();

  T.on("tour:room", ({ roomId }) => {
    lastRoom = roomId;
    if (mode === "street") setMode(insideMode);
    else setHash((mode === "photos" ? "photos-" : "room-") + roomId);
  }, { persistent: true });
  T.on("tour:outside", () => setMode("street"), { persistent: true });
  T.on("tour:photo", ({ roomId }) => { lastRoom = roomId; setMode("photos"); }, { persistent: true });

  buttons.walk.addEventListener("click", () => setMode("walk"));
  buttons.photos.addEventListener("click", () => setMode("photos"));
  buttons.street.addEventListener("click", () => T.emit("tour:outside"));
  editBtn.addEventListener("click", () => {
    const on = editBtn.getAttribute("aria-pressed") !== "true";
    editBtn.setAttribute("aria-pressed", String(on));
    T.emit("tour:edit", { on });
  });

  function route() {
    const h = location.hash.slice(1);
    if (hashState !== null && h === hashState) return;
    if (h === "street") return T.emit("tour:outside");
    const m = /^(room|photos)-(.+)$/.exec(h);
    const id = m && T.roomById(P, m[2]) ? m[2] : P.startRoom || P.entryRoom;
    setMode(m && m[1] === "photos" ? "photos" : P.startView === "street" && !m ? "street" : insideMode);
    T.emit("tour:room", { roomId: id });
  }
  window.addEventListener("hashchange", route);
  route();
  T.emit("tour:ready", {});
})();
