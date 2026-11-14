/* Shell: loads the property, mounts the tracks, switches between 3D walk, photos and street. */
(async function () {
  const T = window.Tour;
  const $ = (s) => document.querySelector(s);
  let P;
  try {
    P = await T.loadProperty();
  } catch (e) {
    $(".app-main").innerHTML = `<div class="fatal"><h2>The tour couldn’t load its data</h2>
      <p>Check that <code>property.js</code> is in the same folder as <code>index.html</code>, and that it starts with <code>window.PROPERTY_INLINE =</code>.</p></div>`;
    return;
  }
  document.title = P.address + " tour";
  $(".app-address").textContent = P.address;

  const problems = T.validate(P);
  if (problems.length) {
    const box = $(".app-warnings");
    box.hidden = false;
    box.querySelector("ul").replaceChildren(...problems.map((p) => Object.assign(document.createElement("li"), { textContent: p })));
    box.querySelector("button").addEventListener("click", () => (box.hidden = true));
  }

  const views = { walk: $(".view-walk"), photos: $(".view-inside"), street: $(".view-street") };
  const buttons = { walk: $(".mode-walk"), photos: $(".mode-inside"), street: $(".mode-street") };
  const editBtn = $(".mode-edit");
  let mode = null, insideMode = P.startView === "photos" ? "photos" : "walk", lastRoom = P.startRoom || P.entryRoom;

  function setMode(m) {
    if (m === mode) return;
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
  let state = null;
  function setHash(h) {
    state = h;
    if (location.hash.slice(1) !== h) history.replaceState(null, "", "#" + h);
  }

  T.FloorPlan.mount($(".app-plan"), P);
  T.RoomViewer.mount(views.photos, P);
  T.StreetView.mount(views.street, P);
  T.Walk3D.mount(views.walk, P);

  T.on("tour:room", ({ roomId }) => {
    lastRoom = roomId;
    if (mode === "street") setMode(insideMode);
    else setHash((mode === "photos" ? "photos-" : "room-") + roomId);
  });
  T.on("tour:outside", () => setMode("street"));
  T.on("tour:photo", ({ roomId }) => { lastRoom = roomId; setMode("photos"); });

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
    if (state !== null && h === state) return;
    if (h === "street") return T.emit("tour:outside");
    const m = /^(room|photos)-(.+)$/.exec(h);
    const id = m && T.roomById(P, m[2]) ? m[2] : P.startRoom || P.entryRoom;
    setMode(m && m[1] === "photos" ? "photos" : P.startView === "street" && !m ? "street" : insideMode);
    T.emit("tour:room", { roomId: id });
  }
  window.addEventListener("hashchange", route);
  route();
})();
