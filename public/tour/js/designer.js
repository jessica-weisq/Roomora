/* The interior designer in the 3D walk, and "Reimagine with Fal".

   Redesign opens the design tools (Arrange furniture, Paint and wallpaper), which are tucked away otherwise.
   Reimagine with Fal sits under it, always there (it glows once something has been changed): it renders the
   room as it now looks in the walk, from where you're standing, and sends that with the room's original photo to the backend
   (POST /reimagine), which asks fal for a photographic version of the redesign in the real room (its
   walls, windows, view and light come from the photo). Inside Veduta the request goes through the website;
   on its own the tour needs TOUR_CONFIG.API_URL (config.js) to point at the backend. */
(function () {
  const T = window.Tour;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let changedOnce = false;   // survives rebuilds of the walk within the page
  T.on("tour:design-changed", () => (changedOnce = true), { persistent: true });

  // a canvas or image as a JPEG data: URL, no bigger than max on its longer side
  const toJpeg = (src, max = 1280) => {
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height, k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  };
  const plainError = (e) => {
    let m = (e && e.message) || String(e || "");
    try { const j = JSON.parse(m); if (j && j.detail) m = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch (_) { /* not JSON */ }
    return m || "Fal couldn’t reimagine the room just now. Try again.";
  };

  T.Designer = {
    attach(o) {
      const { root, renderer, scene, camera, canvas, P, alive, roomAt } = o;
      const style = root.querySelector(".w3-style");
      if (!style) return;
      const before = style.querySelector(".w3-deco");
      const redesign = el("button", "w3-deco w3-redesign", "Redesign"); redesign.type = "button";
      redesign.setAttribute("aria-pressed", "false");
      redesign.title = "Interior designer: move and add furniture, repaint the walls";
      const reimagineBtn = el("button", "w3-deco w3-reimagine", "Reimagine with Fal"); reimagineBtn.type = "button";
      reimagineBtn.title = "A photographic version of your design in the real room";
      style.insertBefore(redesign, before);
      // the design tools are the walk's other decorating buttons (not Furnish from photos or the scan switch)
      const tools = () => [...style.querySelectorAll(".w3-deco")].filter((b) => !/w3-(redesign|reimagine|furnish|scans)/.test(b.className));
      tools().forEach((b) => (b.hidden = true));
      // Reimagine with Fal is always there, right under Redesign: it turns whatever the room looks like now
      // (your redesign, or the room as furnished) into a photographic picture
      const lastTool = tools().pop();
      style.insertBefore(reimagineBtn, lastTool ? lastTool.nextSibling : redesign.nextSibling);

      let on = false;
      const closePanels = () => root.querySelectorAll(".dc-panel:not([hidden]) .dc-done").forEach((b) => b.click());
      function setOn(v) {
        on = v;
        redesign.setAttribute("aria-pressed", String(v));
        redesign.textContent = v ? "Done redesigning" : "Redesign";
        tools().forEach((b) => (b.hidden = !v));
        root.classList.toggle("is-redesigning", v);
        if (!v) closePanels();
      }
      redesign.addEventListener("click", () => setOn(!on));
      // once something has been changed, draw the eye to it
      const nudge = () => reimagineBtn.classList.toggle("is-ready", changedOnce);
      nudge();
      T.on("tour:design-changed", nudge);

      // ---- the result panel ----
      const sheet = el("div", "rm-sheet"); sheet.hidden = true;
      sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", "Reimagined with Fal");
      sheet.innerHTML = `
        <div class="rm-box">
          <div class="rm-head"><h2 class="rm-title">Reimagined with Fal</h2><button type="button" class="rm-close">Back to designing</button></div>
          <div class="rm-grid">
            <figure class="rm-fig rm-photo"><img alt=""><figcaption>The room now (your photo)</figcaption></figure>
            <figure class="rm-fig rm-design"><img alt=""><figcaption>Your design in the 3D walk</figcaption></figure>
            <figure class="rm-fig rm-result"><div class="rm-wait"><span class="rm-spin" aria-hidden="true"></span><p class="rm-status" aria-live="polite"></p></div><img alt="" hidden><figcaption>Reimagined with Fal: an AI impression, not a photo</figcaption></figure>
          </div>
          <div class="rm-foot">
            <label class="rm-notes-l">Anything to tell Fal? <input type="text" class="rm-notes" maxlength="300" placeholder="For example: evening light, linen curtains"></label>
            <button type="button" class="rm-again">Reimagine again</button>
            <a class="rm-save" target="_blank" rel="noopener" hidden>Open full size</a>
          </div>
        </div>`;
      root.appendChild(sheet);
      const $ = (q) => sheet.querySelector(q);
      const closeSheet = () => { sheet.hidden = true; canvas.focus({ preventScroll: true }); };
      $(".rm-close").addEventListener("click", closeSheet);
      sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); e.stopPropagation(); });
      sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });

      let last = null, busy = false;   // last = { render, photo, roomName }
      const send = async (req) => {
        if (T.isEmbed && T.embedRequest) return T.embedRequest("veduta:reimagine", req);
        const api = ((window.TOUR_CONFIG || {}).API_URL || "").replace(/\/+$/, "");
        if (!api) throw new Error("Reimagine with Fal needs the Veduta backend. Open this flat from Veduta, or set API_URL in config.js to the backend’s address.");
        const res = await fetch(api + "/reimagine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
        if (!res.ok) throw new Error(await res.text().catch(() => "") || `Request failed (${res.status})`);
        return res.json();
      };
      async function generate() {
        if (busy || !last) return;
        busy = true;
        $(".rm-again").disabled = true; $(".rm-save").hidden = true;
        $(".rm-result img").hidden = true; $(".rm-wait").hidden = false; $(".rm-spin").hidden = false;
        $(".rm-status").textContent = `Fal is reimagining the ${last.roomName.toLowerCase()}. This usually takes 10 to 40 seconds…`;
        try {
          const res = await send(Object.assign({}, last, { notes: $(".rm-notes").value.trim() }));
          if (!res || !res.imageUrl) throw new Error("Fal didn’t send an image back.");
          const img = $(".rm-result img");
          await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error("The reimagined image couldn’t be loaded.")); img.src = res.imageUrl; });
          img.hidden = false; $(".rm-wait").hidden = true;
          if (res.mock) { $(".rm-wait").hidden = false; $(".rm-spin").hidden = true; $(".rm-status").textContent = "This is Veduta’s mock backend, which can’t call Fal, so this is your design as rendered. Connect the real backend with FAL_KEY set to reimagine it."; }
          const save = $(".rm-save"); save.href = res.imageUrl; save.hidden = false;
        } catch (e) {
          $(".rm-spin").hidden = true;
          $(".rm-status").textContent = plainError(e);
        } finally {
          busy = false; $(".rm-again").disabled = false;
        }
      }
      $(".rm-again").addEventListener("click", generate);
      $(".rm-notes").addEventListener("keydown", (e) => { if (e.key === "Enter") generate(); });

      reimagineBtn.addEventListener("click", async () => {
        if (busy) return;
        const room = roomAt();
        if (!room) { reimagineBtn.textContent = "Stand in a room first"; setTimeout(() => (reimagineBtn.textContent = "Reimagine with Fal"), 2200); return; }
        // tidy up first, so no selection outlines or panels end up in the picture
        closePanels();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (!alive()) return;
        renderer.render(scene, camera);           // draw and read back in the same task
        const render = toJpeg(renderer.domElement);
        // the room's own photo: its first ordinary photo that loads
        let photo = null;
        for (let i = 0; i < room.media.length && !photo; i++) {
          if (room.media[i].type !== "photo") continue;
          try {
            const r = await T.mediaImage(P, room, i);
            if (!r.placeholder) photo = toJpeg(r.image);
          } catch (e) { /* a photo from another site can't be read back: try the next */ }
        }
        last = { render, photo, roomName: room.name };
        $(".rm-title").textContent = `${room.name}, reimagined with Fal`;
        $(".rm-photo").hidden = !photo;
        if (photo) $(".rm-photo img").src = photo;
        $(".rm-design img").src = render;
        sheet.hidden = false;
        $(".rm-close").focus();
        generate();
      });
    },
  };
})();
