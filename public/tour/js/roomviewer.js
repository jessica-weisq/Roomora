/* Track B: room viewer. Photos with cross-fades, 360° panoramas (three.js), hotspots, and an edit mode for placing hotspots. */
(function () {
  const T = window.Tour;
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  T.RoomViewer = {
    mount(root, P) {
      root.classList.add("rv");
      const gen = T.gen, alive = () => T.alive(gen);
      root.innerHTML = `
        <div class="rv-stage" aria-live="polite"></div>
        <div class="rv-bar">
          <div class="rv-title"><h2></h2><p class="rv-sub"></p></div>
          <div class="rv-media">
            <button type="button" class="rv-prev" aria-label="Previous photo">‹</button>
            <span class="rv-count"></span>
            <button type="button" class="rv-next" aria-label="Next photo">›</button>
          </div>
          <nav class="rv-links" aria-label="Go to another room"></nav>
        </div>
        <div class="rv-edit" hidden>
          <p class="rv-edit-help">Click the image where a doorway is, choose where it leads, then select Add hotspot.</p>
          <div class="rv-edit-row">
            <span class="rv-edit-pos">No point chosen yet</span>
            <select class="rv-edit-to" aria-label="Hotspot leads to"></select>
            <button type="button" class="rv-edit-add" disabled>Add hotspot</button>
            <button type="button" class="rv-edit-undo">Remove last</button>
          </div>
          <label class="rv-edit-json-label">This room’s links, ready to paste into property.js
            <textarea class="rv-edit-json" rows="5" readonly></textarea>
          </label>
        </div>`;
      const stage = root.querySelector(".rv-stage");
      const title = root.querySelector(".rv-title h2");
      const sub = root.querySelector(".rv-sub");
      const count = root.querySelector(".rv-count");
      const prev = root.querySelector(".rv-prev");
      const next = root.querySelector(".rv-next");
      const linksNav = root.querySelector(".rv-links");
      const edit = root.querySelector(".rv-edit");
      const editPos = edit.querySelector(".rv-edit-pos");
      const editTo = edit.querySelector(".rv-edit-to");
      const editAdd = edit.querySelector(".rv-edit-add");
      const editJson = edit.querySelector(".rv-edit-json");

      let room = null, idx = 0, view = null, editing = false, pick = null, token = 0;

      prev.addEventListener("click", () => show(room, (idx - 1 + room.media.length) % room.media.length));
      next.addEventListener("click", () => show(room, (idx + 1) % room.media.length));
      window.addEventListener("resize", () => alive() && view && view.layout());

      async function show(r, i) {
        const my = ++token;
        room = r; idx = i;
        if (!r.media || !r.media.length) {
          title.textContent = r.name;
          const fl = T.floorById(P, r.floor); sub.textContent = fl ? fl.name : "";
          count.textContent = ""; prev.hidden = next.hidden = true;
          renderLinkChips(); renderEditPanel();
          const old = view;
          const wrap = el("div", "rv-view rv-empty");
          wrap.append(el("p", "rv-empty-title", "No photos of this room yet"), el("p", "rv-empty-text", T.canUpload ? "Use Add photos to add some; the 3D walk will be refurnished to match." : "The 3D walk shows this room as a model."));
          view = { el: wrap, layout() {}, destroy() { wrap.remove(); } };
          stage.appendChild(wrap); requestAnimationFrame(() => wrap.classList.add("is-in"));
          if (old) { old.el.classList.remove("is-in"); setTimeout(() => old.destroy(), 420); }
          return;
        }
        const floor = T.floorById(P, r.floor);
        title.textContent = r.name;
        sub.textContent = floor ? floor.name : "";
        const m = r.media[i];
        count.textContent = m.type === "fused" ? `3D room built from ${m.fused.parts.length} photos` : m.type === "video" ? `${m.label || "AI-generated video"} · ${i + 1} of ${r.media.length}` : m.depth ? `3D photo ${i + 1} of ${r.media.length}` : m.type === "pano" ? `360° view${r.media.length > 1 ? ` (${i + 1} of ${r.media.length})` : ""}` : `Photo ${i + 1} of ${r.media.length}`;
        prev.hidden = next.hidden = r.media.length < 2;
        renderLinkChips();
        renderEditPanel();
        if (m.type === "video") {
          const old = view;
          view = videoView(r, i);
          stage.appendChild(view.el);
          view.layout();
          requestAnimationFrame(() => view.el.classList.add("is-in"));
          if (old) { old.el.classList.remove("is-in"); setTimeout(() => old.destroy(), reduceMotion() ? 0 : 420); }
          return;
        }
        const { image, placeholder } = await T.mediaImage(P, r, i);
        if (my !== token) return;
        if (m.type === "fused" && window.THREE) {
          const parts = await Promise.all(m.fused.parts.map((pt) => Promise.all([T.loadImage(pt.src), T.loadImage(pt.depth)]))).catch(() => null);
          if (my !== token) return;
          if (parts) {
            const old = view;
            try { view = fusedView(r, i, parts); } catch (e) { console.warn("3D room failed", e); view = photoView(r, i, image); }
            stage.appendChild(view.el); view.layout();
            requestAnimationFrame(() => view.el.classList.add("is-in"));
            if (old) { old.el.classList.remove("is-in"); setTimeout(() => old.destroy(), reduceMotion() ? 0 : 420); }
            return;
          }
        }
        const depthImg = m.depth && window.THREE ? await T.loadImage(m.depth).catch(() => null) : null;
        if (my !== token) return;
        const old = view;
        const fromDisk = location.protocol === "file:" && !(image instanceof HTMLCanvasElement) && !/^data:/.test(image.src || "");
        const usePano = m.type === "pano" && window.THREE && !fromDisk;
        let made = null;
        if (!usePano && depthImg && !placeholder) { try { made = depthView(r, i, image, depthImg); } catch (e) { console.warn("3D photo failed", e); } }
        view = made || (usePano ? panoView(r, i, image) : photoView(r, i, image));
        view.el.classList.toggle("is-placeholder", placeholder);
        stage.appendChild(view.el);
        view.layout();
        requestAnimationFrame(() => view.el.classList.add("is-in"));
        if (old) {
          old.el.classList.remove("is-in");
          setTimeout(() => old.destroy(), reduceMotion() ? 0 : 420);
        }
        (r.links || []).forEach((l) => l.to !== "outside" && T.preloadRoom(P, T.roomById(P, l.to)));
      }

      function go(link) {
        if (link.to === "outside") T.emit("tour:outside");
        else T.emit("tour:room", { roomId: link.to });
      }

      function renderLinkChips() {
        linksNav.replaceChildren(...(room.links || []).map((l) => {
          const b = el("button", "rv-chip", T.linkLabel(P, l));
          b.type = "button";
          b.addEventListener("click", () => go(l));
          return b;
        }));
      }

      function hotspotButton(l) {
        const b = el("button", "rv-hot");
        b.type = "button";
        b.setAttribute("aria-label", "Go to " + T.linkLabel(P, l));
        b.append(el("span", "rv-hot-dot"), el("span", "rv-hot-label", T.linkLabel(P, l)));
        b.addEventListener("click", (e) => { e.stopPropagation(); go(l); });
        return b;
      }
      const linksHere = (r, i) => (r.links || []).filter((l) => l.x != null && (l.media || 0) === i);

      // ---- Photo view ----
      function photoView(r, i, image) {
        const wrap = el("div", "rv-view");
        const fit = el("div", "rv-fit");
        const node = image instanceof HTMLCanvasElement ? image : image.cloneNode();
        node.classList.add("rv-img");
        node.setAttribute("role", "img");
        node.setAttribute("aria-label", r.name + " photo");
        fit.appendChild(node);
        const ratio = (image.naturalWidth || image.width) / (image.naturalHeight || image.height);
        linksHere(r, i).forEach((l) => {
          const b = hotspotButton(l);
          b.style.left = l.x * 100 + "%"; b.style.top = l.y * 100 + "%";
          fit.appendChild(b);
        });
        fit.addEventListener("click", (e) => {
          if (!editing) return;
          const rect = fit.getBoundingClientRect();
          setPick((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, fit);
        });
        wrap.appendChild(fit);
        return {
          el: wrap,
          layout() {
            const s = stage.getBoundingClientRect();
            let w = s.width, h = w / ratio;
            if (h > s.height) { h = s.height; w = h * ratio; }
            fit.style.width = w + "px"; fit.style.height = h + "px";
          },
          destroy() { wrap.remove(); },
        };
      }

      // ---- AI-generated video ----
      function videoView(r, i) {
        const m = r.media[i];
        const wrap = el("div", "rv-view rv-video");
        const video = document.createElement("video");
        video.className = "rv-video-player";
        video.controls = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.setAttribute("aria-label", `${r.name}: ${m.label || "AI-generated video"}`);
        const source = document.createElement("source");
        source.src = m.src;
        source.type = m.mime || "video/mp4";
        video.appendChild(source);
        const error = el("p", "rv-video-error", "This video couldn’t load. Please try refreshing the page.");
        error.hidden = true;
        video.addEventListener("error", () => { error.hidden = false; });
        wrap.append(video, error);
        return {
          el: wrap,
          layout() {},
          destroy() { video.pause(); video.removeAttribute("src"); video.load(); wrap.remove(); },
        };
      }

      // ---- 360° view ----
      function panoView(r, i, image) {
        const THREE = window.THREE;
        const wrap = el("div", "rv-view rv-pano");
        wrap.tabIndex = 0;
        wrap.setAttribute("aria-label", r.name + " 360° view. Drag or use arrow keys to look around.");
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        wrap.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, 1, 1, 1100);
        const geo = new THREE.SphereGeometry(500, 60, 40);
        geo.scale(-1, 1, 1);
        const tex = image instanceof HTMLCanvasElement ? new THREE.CanvasTexture(image) : new THREE.Texture(image);
        tex.needsUpdate = true;
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
        scene.add(mesh);

        const m = r.media[i];
        let lon = 360 * (m.startX != null ? m.startX : 0.5), lat = 0, fov = 75;
        const dir = (x, y) => {
          const phi = THREE.MathUtils.degToRad(90 - (90 - 180 * y));
          const theta = THREE.MathUtils.degToRad(360 * x);
          return new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
        };
        const hots = linksHere(r, i).map((l) => {
          const b = hotspotButton(l);
          wrap.appendChild(b);
          return { b, v: dir(l.x, l.y).multiplyScalar(400) };
        });

        let raf = 0, w = 1, h = 1;
        const canvas = renderer.domElement;
        const looker = T.attachLook(canvas, (dy, dp) => {
          const k = (180 / Math.PI) * (fov / 75);
          lon -= dy * k; lat = Math.max(-85, Math.min(85, lat + dp * k));
        });
        canvas.addEventListener("click", (e) => {
          if (editing) {
            const rect = canvas.getBoundingClientRect();
            const ndc = new THREE.Vector3(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1, 0.5);
            const v = ndc.unproject(camera).normalize();
            let lo = THREE.MathUtils.radToDeg(Math.atan2(v.z, v.x)); if (lo < 0) lo += 360;
            const la = THREE.MathUtils.radToDeg(Math.asin(v.y));
            setPick(lo / 360, (90 - la) / 180, null);
          }
        });
        wrap.addEventListener("wheel", (e) => { e.preventDefault(); fov = Math.max(35, Math.min(90, fov + e.deltaY * 0.04)); }, { passive: false });
        wrap.addEventListener("keydown", (e) => {
          const step = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[e.key];
          if (step) { e.preventDefault(); lon += step[0]; lat = Math.max(-85, Math.min(85, lat + step[1])); }
        });

        const target = new THREE.Vector3();
        const look = new THREE.Vector3();
        function frame() {
          if (!alive()) return;
          raf = requestAnimationFrame(frame);
          lon -= looker.edge() * 1.1;
          camera.fov = fov; camera.aspect = w / h; camera.updateProjectionMatrix();
          const phi = THREE.MathUtils.degToRad(90 - lat), theta = THREE.MathUtils.degToRad(lon);
          target.set(500 * Math.sin(phi) * Math.cos(theta), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(theta));
          camera.lookAt(target);
          renderer.render(scene, camera);
          camera.getWorldDirection(look);
          hots.forEach(({ b, v }) => {
            const p = v.clone().project(camera);
            const visible = v.clone().normalize().dot(look) > 0.15 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
            b.style.display = visible ? "" : "none";
            if (visible) { b.style.left = ((p.x + 1) / 2) * w + "px"; b.style.top = ((1 - p.y) / 2) * h + "px"; }
          });
        }
        frame();
        return {
          el: wrap,
          layout() {
            const s = stage.getBoundingClientRect();
            w = Math.max(1, s.width); h = Math.max(1, s.height);
            renderer.setSize(w, h);
          },
          destroy() { cancelAnimationFrame(raf); renderer.dispose(); geo.dispose(); tex.dispose(); wrap.remove(); },
        };
      }

      // ---- 3D photo: the photo rebuilt as a surface from its depth map ----
      function depthView(r, i, image, depthImg) {
        const THREE = window.THREE;
        const m = r.media[i];
        const wrap = el("div", "rv-view rv-pano rv-depth");
        wrap.tabIndex = 0;
        wrap.setAttribute("aria-label", `${r.name} in 3D. Drag to look around. Use W A S D or the arrow keys to step around, or double-click to step towards something.`);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor("#161b1d");
        wrap.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
        camera.rotation.order = "YXZ";

        const IW = image.naturalWidth || image.width, IH = image.naturalHeight || image.height;
        const SW = 300, SH = Math.round((SW * IH) / IW);
        const dc = document.createElement("canvas");
        dc.width = SW; dc.height = SH;
        const dctx = dc.getContext("2d");
        dctx.drawImage(depthImg, 0, 0, SW, SH);
        const dd = dctx.getImageData(0, 0, SW, SH).data;
        const [near, far] = m.depthRange || [1, 10];
        const hfov = ((m.hfov || 80) * Math.PI) / 180;
        const f = (SW - 1) / 2 / Math.tan(hfov / 2);
        const zAt = (ix, iy) => {
          const k = (Math.min(SH - 1, Math.max(0, iy | 0)) * SW + Math.min(SW - 1, Math.max(0, ix | 0))) * 4;
          const d = (dd[k] * 256 + dd[k + 1]) / 65535;
          return 1 / (d * (1 / near - 1 / far) + 1 / far);
        };
        const point = (ix, iy) => {
          const z = zAt(ix, iy);
          return new THREE.Vector3(((ix - (SW - 1) / 2) / f) * z, (-(iy - (SH - 1) / 2) / f) * z, -z);
        };
        const geo = new THREE.PlaneGeometry(1, 1, SW - 1, SH - 1);
        const pa = geo.attributes.position;
        for (let iy = 0; iy < SH; iy++)
          for (let ix = 0; ix < SW; ix++) {
            const p = point(ix, iy);
            pa.setXYZ(iy * SW + ix, p.x, p.y, p.z);
          }
        // Cut the surface where the depth jumps (the edge of a chair against a far wall). Left joined, those
        // triangles stretch into long smears the moment you move; cut, the gap shows the soft backdrop below.
        {
          const src = geo.index.array, keep = [], dist = (v) => Math.hypot(pa.getX(v), pa.getY(v), pa.getZ(v));
          for (let t = 0; t < src.length; t += 3) {
            const a = dist(src[t]), b = dist(src[t + 1]), c = dist(src[t + 2]);
            if (Math.max(a, b, c) / Math.min(a, b, c) < 1.2) keep.push(src[t], src[t + 1], src[t + 2]);
          }
          geo.setIndex(keep);
        }
        geo.computeBoundingSphere();
        // backdrop: the photo, heavily blurred, on a sheet just beyond the farthest point, wider than the view,
        // so gaps and the edges of the picture fall away into soft colour, not black
        {
          const bc = document.createElement("canvas"); bc.width = 40; bc.height = Math.max(8, Math.round((40 * IH) / IW));
          const bg = bc.getContext("2d"); bg.filter = "blur(1.5px)"; bg.drawImage(image, 0, 0, bc.width, bc.height);
          const bt = new THREE.CanvasTexture(bc); bt.minFilter = bt.magFilter = THREE.LinearFilter;
          const Z = far * 1.05, grow = 1.6, hw = ((SW - 1) / 2 / f) * Z * grow, hh = ((SH - 1) / 2 / f) * Z * grow;
          const back = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, hh * 2), new THREE.MeshBasicMaterial({ map: bt, color: 0xd8d8d8 }));
          const uv = back.geometry.attributes.uv;   // the photo fills the middle; its edge colours run on outwards
          for (let k = 0; k < uv.count; k++) uv.setXY(k, (uv.getX(k) - 0.5) * grow + 0.5, (uv.getY(k) - 0.5) * grow + 0.5);
          back.position.z = -Z; back.renderOrder = -1;
          scene.add(back);
        }
        const tex = image instanceof HTMLCanvasElement ? new THREE.CanvasTexture(image) : new THREE.Texture(image);
        tex.needsUpdate = true;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        tex.minFilter = THREE.LinearFilter;
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
        scene.add(mesh);
        // Behind it, the same photo on the background's depth: at each point, the farthest depth nearby, smoothed.
        // Where the front surface was cut (behind a chair, a bed, a curtain's edge), you see the wall or floor
        // carrying on at about the right distance, with no hole and no smear.
        {
          const R = 7, zs = new Float32Array(SW * SH), tmp = new Float32Array(SW * SH);
          for (let iy = 0; iy < SH; iy++) for (let ix = 0; ix < SW; ix++) zs[iy * SW + ix] = zAt(ix, iy);
          const pass = (srcA, dstA, horizontal, far) => {
            for (let iy = 0; iy < SH; iy++) for (let ix = 0; ix < SW; ix++) {
              let acc = far ? 0 : 0, n = 0;
              for (let k = -R; k <= R; k++) {
                const x = horizontal ? ix + k : ix, y = horizontal ? iy : iy + k;
                if (x < 0 || y < 0 || x >= SW || y >= SH) continue;
                const v = srcA[y * SW + x];
                if (far) { if (v > acc) acc = v; } else { acc += v; n++; }
              }
              dstA[iy * SW + ix] = far ? acc : acc / n;
            }
          };
          pass(zs, tmp, true, true); pass(tmp, zs, false, true);     // farthest nearby
          pass(zs, tmp, true, false); pass(tmp, zs, false, false);   // smoothed
          const bgeo = new THREE.PlaneGeometry(1, 1, SW - 1, SH - 1), bp = bgeo.attributes.position;
          for (let iy = 0; iy < SH; iy++) for (let ix = 0; ix < SW; ix++) {
            const z = zs[iy * SW + ix] * 1.04;   // a touch behind, so it never fights the front surface
            bp.setXYZ(iy * SW + ix, ((ix - (SW - 1) / 2) / f) * z, (-(iy - (SH - 1) / 2) / f) * z, -z);
          }
          bgeo.computeBoundingSphere();
          scene.add(new THREE.Mesh(bgeo, new THREE.MeshBasicMaterial({ map: tex })));
        }

        const hots = linksHere(r, i).map((l) => {
          const b = hotspotButton(l);
          wrap.appendChild(b);
          return { b, v: point(l.x * (SW - 1), l.y * (SH - 1)).multiplyScalar(0.97) };
        });

        // movement stays near where the photographer stood, where the 3D holds up
        const pos = { x: 0, z: 0 };
        let yaw = 0, pitch = 0, target = null, w = 1, h = 1, raf = 0;
        // how far you can move scales with how close the nearest things are, to keep stretching down
        // (less still for automatic depth maps, whose scale is a guess: media.depthAuto)
        const reach = Math.min(1, near / 1.5) * (m.depthAuto ? 0.55 : 1);
        const LIM = { x: 0.75 * reach, zf: -1.5 * reach, zb: 0.3 * reach, yaw: 0.8, pitch: 0.38 };
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const keys = new Set();
        const reduce = reduceMotion();
        let intro = reduce ? 1 : 0;

        const canvas = renderer.domElement;
        let lookTotal = 0;
        const looker = T.attachLook(canvas, (dy, dp) => {
          if (intro < 1) return;
          yaw = clamp(yaw + dy, -LIM.yaw, LIM.yaw); pitch = clamp(pitch + dp, -LIM.pitch, LIM.pitch);
        }, { onMove: (m) => { lookTotal += m; if (lookTotal > 120) intro = 1; } });
        canvas.addEventListener("pointerdown", () => { wrap.focus({ preventScroll: true }); intro = 1; });
        const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
        const hitAt = (e) => {
          const rect = canvas.getBoundingClientRect();
          ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
          ray.setFromCamera(ndc, camera);
          return ray.intersectObject(mesh)[0];
        };
        canvas.addEventListener("click", (e) => {
          if (!editing) return;
          const hit = hitAt(e);
          if (hit) setPick(hit.uv.x, 1 - hit.uv.y, null);
        });
        canvas.addEventListener("dblclick", (e) => {
          const hit = hitAt(e);
          if (hit) target = { x: clamp(hit.point.x * 0.4, -LIM.x, LIM.x), z: clamp(hit.point.z * 0.4, LIM.zf, LIM.zb) };
          intro = 1;
        });
        wrap.addEventListener("wheel", (e) => { e.preventDefault(); intro = 1; target = null; pos.z = clamp(pos.z + e.deltaY * 0.002, LIM.zf, LIM.zb); }, { passive: false });
        const onKey = (e) => {
          if (!alive() || wrap.closest("[hidden]") || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName)) return;
          const k = e.key.toLowerCase();
          if (!["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) return;
          if (e.type === "keydown") { keys.add(k); target = null; intro = 1; if (k.startsWith("arrow")) e.preventDefault(); }
          else keys.delete(k);
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKey);

        let last = performance.now(), t0 = last;
        const tmp = new THREE.Vector3(), look = new THREE.Vector3();
        function frame(now) {
          if (!alive()) return;
          raf = requestAnimationFrame(frame);
          const dt = Math.min(0.05, (now - last) / 1000); last = now;
          if (wrap.closest("[hidden]")) return;
          let fwd = 0, side = 0;
          if (keys.has("w") || keys.has("arrowup")) fwd += 1;
          if (keys.has("s") || keys.has("arrowdown")) fwd -= 1;
          if (keys.has("d")) side += 1;
          if (keys.has("a")) side -= 1;
          if (intro >= 1) yaw = clamp(yaw + looker.edge() * 1.0 * dt, -LIM.yaw, LIM.yaw);
          if (keys.has("arrowleft") || keys.has("q")) yaw = clamp(yaw + 1.2 * dt, -LIM.yaw, LIM.yaw);
          if (keys.has("arrowright") || keys.has("e")) yaw = clamp(yaw - 1.2 * dt, -LIM.yaw, LIM.yaw);
          const sp = 0.9 * dt;
          if (fwd || side) {
            pos.x = clamp(pos.x + (Math.cos(yaw) * side - Math.sin(yaw) * fwd) * sp, -LIM.x, LIM.x);
            pos.z = clamp(pos.z + (-Math.sin(yaw) * side - Math.cos(yaw) * fwd) * sp, LIM.zf, LIM.zb);
          } else if (target) {
            const dx = target.x - pos.x, dz = target.z - pos.z, dist = Math.hypot(dx, dz);
            if (dist < 0.02) target = null; else { const st = Math.min(dist, sp * 1.2); pos.x += (dx / dist) * st; pos.z += (dz / dist) * st; }
          }
          let cx = pos.x, cz = pos.z, cy = yaw;
          if (intro < 1) {
            // one slow push-in with a gentle sway on arrival, so the depth is obvious
            intro = Math.min(1, (now - t0) / 3200);
            const e = 0.5 - 0.5 * Math.cos(intro * Math.PI);
            cz = -0.55 * reach * e; cx = 0.25 * reach * Math.sin(e * Math.PI); cy = -0.12 * Math.sin(e * Math.PI);
            if (intro === 1) { pos.x = cx; pos.z = cz; yaw = cy; }
          }
          camera.position.set(cx, 0, cz);
          camera.rotation.set(pitch, cy, 0);
          renderer.render(scene, camera);
          camera.getWorldDirection(look);
          hots.forEach(({ b, v }) => {
            tmp.copy(v).sub(camera.position);
            const p = v.clone().project(camera);
            const visible = tmp.normalize().dot(look) > 0.2 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
            b.style.display = visible ? "" : "none";
            if (visible) { b.style.left = ((p.x + 1) / 2) * w + "px"; b.style.top = ((1 - p.y) / 2) * h + "px"; }
          });
        }
        raf = requestAnimationFrame(frame);
        return {
          el: wrap,
          layout() {
            const s = stage.getBoundingClientRect();
            w = Math.max(1, s.width); h = Math.max(1, s.height);
            renderer.setSize(w, h);
            const aspect = w / h, pa2 = IW / IH;
            camera.aspect = aspect;
            const vf = 2 * Math.atan(Math.tan(hfov / 2) / pa2);
            const fit = aspect > pa2 ? 2 * Math.atan(Math.tan(hfov / 2) / aspect) : vf;
            camera.fov = ((fit * 180) / Math.PI) * 0.86;
            camera.updateProjectionMatrix();
          },
          destroy() {
            cancelAnimationFrame(raf);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("keyup", onKey);
            renderer.dispose(); geo.dispose(); tex.dispose(); wrap.remove();
          },
        };
      }

      // ---- 3D room: several photos of one room, calibrated into one space ----
      function fusedView(r, i, loaded) {
        const THREE = window.THREE;
        const F = r.media[i].fused, box = F.box, H = F.ceiling;
        const wrap = el("div", "rv-view rv-pano rv-depth");
        wrap.tabIndex = 0;
        wrap.setAttribute("aria-label", `${r.name} rebuilt in 3D from photos. Drag to look around. Walk with W A S D or the arrow keys, or double-click the floor to go there.`);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor("#161b1d");
        wrap.appendChild(renderer.domElement);
        const hint = el("p", "rv-fused-hint", "Built in 3D from two photos of this room. Click and drag to look around; walk with W A S D or the arrow keys, or double-click the floor. Plain surfaces fill anything neither photo shows.");
        wrap.appendChild(hint);
        const spots = el("div", "rv-fused-spots");
        F.parts.forEach((pt, k) => {
          const b = el("button", "", k === 0 ? "Window end (photo 1)" : `Door end (photo ${k + 1})`);
          if (pt.label) b.textContent = pt.label;
          b.type = "button";
          b.addEventListener("click", () => { pos.x = pt.t[0]; pos.z = pt.t[1]; yaw = pt.yaw; pitch = 0; target = null; camera.fov = 75; camera.updateProjectionMatrix(); wrap.focus({ preventScroll: true }); });
          spots.appendChild(b);
        });
        wrap.appendChild(spots);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
        camera.rotation.order = "YXZ";
        const disposables = [];

        // plain room shell behind the photos
        const fc = document.createElement("canvas"); fc.width = 256; fc.height = 256;
        const fx = fc.getContext("2d");
        for (let y = 0; y < 8; y++) for (let x = 0; x < 2; x++) {
          const k = 0.92 + 0.12 * (((x * 7 + y * 13) % 5) / 5);
          fx.fillStyle = `rgb(${200 * k | 0},${166 * k | 0},${124 * k | 0})`;
          fx.fillRect(x * 128 + ((y % 2) * 64), y * 32, 128, 31);
          fx.fillRect(x * 128 + ((y % 2) * 64) - 256, y * 32, 128, 31);
        }
        const ftex = new THREE.CanvasTexture(fc); ftex.wrapS = ftex.wrapT = THREE.RepeatWrapping;
        const bw = box.x1 - box.x0, bd = box.z1 - box.z0;
        ftex.repeat.set(bw / 1.2, bd / 1.2);
        const shellMat = (opts) => Object.assign(new THREE.MeshBasicMaterial(opts), { polygonOffset: true, polygonOffsetFactor: 6, polygonOffsetUnits: 12000 });
        const shell = new THREE.Group();
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(bw + 0.2, bd + 0.2), shellMat({ map: ftex }));
        floor.rotation.x = -Math.PI / 2; floor.position.set((box.x0 + box.x1) / 2, -0.01, (box.z0 + box.z1) / 2); shell.add(floor);
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(bw + 0.2, bd + 0.2), shellMat({ color: "#efece6" }));
        ceil.rotation.x = Math.PI / 2; ceil.position.set((box.x0 + box.x1) / 2, H + 0.01, (box.z0 + box.z1) / 2); shell.add(ceil);
        const wallMat = shellMat({ color: "#e6e2dc", side: THREE.DoubleSide });
        [[box.x0 - 0.05, (box.z0 + box.z1) / 2, bd + 0.2, Math.PI / 2], [box.x1 + 0.05, (box.z0 + box.z1) / 2, bd + 0.2, Math.PI / 2],
         [(box.x0 + box.x1) / 2, box.z0 - 0.05, bw + 0.2, 0], [(box.x0 + box.x1) / 2, box.z1 + 0.05, bw + 0.2, 0]].forEach(([x, z, w, ry]) => {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat); m.position.set(x, H / 2, z); m.rotation.y = ry; shell.add(m);
          const sk = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.14), shellMat({ color: "#3b2f27", side: THREE.DoubleSide })); sk.position.set(x, 0.07, z); sk.rotation.y = ry; shell.add(sk);
        });
        scene.add(shell);

        // each photo as a surface, cut wherever it would stretch across a depth edge
        const parts = F.parts.map((pt, k) => {
          const [img, dimg] = loaded[k];
          const W = dimg.naturalWidth || dimg.width, Hh = dimg.naturalHeight || dimg.height;
          const c = document.createElement("canvas"); c.width = W; c.height = Hh;
          const cx = c.getContext("2d"); cx.drawImage(dimg, 0, 0);
          const dd = cx.getImageData(0, 0, W, Hh).data;
          const pos = new Float32Array(W * Hh * 3), uv = new Float32Array(W * Hh * 2), cut = new Uint8Array(W * Hh);
          const ct = Math.cos(pt.yaw), st = Math.sin(pt.yaw);
          for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
            const n = y * W + x, o = n * 4;
            const d = (dd[o] * 256 + dd[o + 1]) / 65535;
            const z = 1 / Math.max(pt.a * d + pt.b, 1 / 40);
            const X = ((x - pt.cx) / pt.f) * z, Y = (-(y - pt.cy) / pt.f) * z + pt.camH, Z = -z;
            let wx = ct * X + st * Z + pt.t[0], wy = Y, wz = -st * X + ct * Z + pt.t[1];
            // anything estimated beyond the room's walls is pulled back onto them along the camera ray
            const ox = pt.t[0], oy = pt.camH, oz = pt.t[1], rx = wx - ox, ry = wy - oy, rz = wz - oz;
            let tMax = 1;
            if (wx < box.x0) tMax = Math.min(tMax, (box.x0 - ox) / rx);
            if (wx > box.x1) tMax = Math.min(tMax, (box.x1 - ox) / rx);
            if (wz < box.z0) tMax = Math.min(tMax, (box.z0 - oz) / rz);
            if (wz > box.z1) tMax = Math.min(tMax, (box.z1 - oz) / rz);
            if (wy > H) tMax = Math.min(tMax, (H - oy) / ry);
            if (wy < 0) tMax = Math.min(tMax, (0 - oy) / ry);
            if (tMax < 1) { tMax *= 0.995; wx = ox + rx * tMax; wy = oy + ry * tMax; wz = oz + rz * tMax; }
            pos[n * 3] = wx; pos[n * 3 + 1] = wy; pos[n * 3 + 2] = wz;
            uv[n * 2] = x / (W - 1); uv[n * 2 + 1] = 1 - y / (Hh - 1);
            cut[n] = dd[o + 2] > 127 ? 1 : 0;
          }
          const idx = [];
          for (let y = 0; y < Hh - 1; y++) for (let x = 0; x < W - 1; x++) {
            const a = y * W + x, b = a + 1, c2 = a + W, d2 = c2 + 1;
            if (cut[a] || cut[b] || cut[c2] || cut[d2]) continue;
            idx.push(a, c2, b, b, c2, d2);
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
          geo.setIndex(idx.length > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
          geo.computeBoundingSphere();
          const tex = new THREE.Texture(img); tex.needsUpdate = true; tex.minFilter = THREE.LinearFilter;
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          // a photo surface is only drawn when you see it from close to the angle the photo saw it from,
          // so objects never turn into thin shells or shards as you walk round them
          const camPos = new THREE.Vector3(pt.t[0], pt.camH, pt.t[1]);
          const mat = new THREE.ShaderMaterial({
            uniforms: { map: { value: tex }, photoCam: { value: camPos }, cosMax: { value: Math.cos((38 * Math.PI) / 180) }, cosFade: { value: Math.cos((26 * Math.PI) / 180) } },
            vertexShader: "varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
            fragmentShader: "uniform sampler2D map; uniform vec3 photoCam; uniform float cosMax; uniform float cosFade; varying vec2 vUv; varying vec3 vW;" +
              "void main(){ vec3 a = normalize(cameraPosition - vW); vec3 b = normalize(photoCam - vW); float c = dot(a,b);" +
              " if (c < cosMax) discard; vec4 col = texture2D(map, vUv);" +
              " float k = smoothstep(cosMax, cosFade, c); if (k < 0.5 && fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453) > k * 2.0) discard;" +
              " gl_FragColor = col; }",
            side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: 0,
          });
          const mesh = new THREE.Mesh(geo, mat);
          scene.add(mesh);
          disposables.push(geo, tex, mat);
          return { mesh, mat, cam: { x: pt.t[0], z: pt.t[1] }, fwd: { x: -st, z: -ct }, yaw0: pt.yaw };
        });
        let primary = 0;
        const setPrimary = (k) => {
          primary = k;
          parts.forEach((p, j) => { p.mat.polygonOffsetFactor = j === k ? 0 : 3; p.mat.polygonOffsetUnits = j === k ? 0 : 4000; p.mat.needsUpdate = true; });
        };
        setPrimary(0);

        // where you can stand: inside the room, off the furniture
        const occ = F.occ, M = 0.35;
        const freeAt = (x, z) => {
          if (x < box.x0 + M || x > box.x1 - M || z < box.z0 + M || z > box.z1 - M) return false;
          for (let a = 0; a < 8; a++) {
            const px = x + Math.cos(a * Math.PI / 4) * 0.2, pz = z + Math.sin(a * Math.PI / 4) * 0.2;
            const gx = Math.floor((px - box.x0) / occ.cell), gz = Math.floor((pz - box.z0) / occ.cell);
            if (gx >= 0 && gz >= 0 && gx < occ.w && gz < occ.h && occ.bits[gz * occ.w + gx] === "1") return false;
          }
          return true;
        };
        const camH = F.parts[0].camH;
        const pos = { x: F.parts[0].t[0], z: F.parts[0].t[1] };
        let yaw = F.parts[0].yaw, pitch = 0, target = null, w = 1, h = 1, raf = 0;
        const keys = new Set();
        const canvas = renderer.domElement;
        const hideHint = () => hint.classList.add("is-gone");
        setTimeout(hideHint, 10000);
        let lookTotal = 0;
        const looker = T.attachLook(canvas, (dy, dp) => { yaw += dy; pitch = Math.max(-1.1, Math.min(1.1, pitch + dp)); }, { onMove: (m) => { lookTotal += m; if (lookTotal > 400) hideHint(); } });
        canvas.addEventListener("pointerdown", () => wrap.focus({ preventScroll: true }));
        const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
        canvas.addEventListener("dblclick", (e) => {
          const rect = canvas.getBoundingClientRect();
          ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
          ray.setFromCamera(ndc, camera);
          const hit = ray.intersectObjects([...parts.map((p) => p.mesh), floor])[0];
          if (hit) { target = { x: hit.point.x, z: hit.point.z }; hideHint(); }
        });
        wrap.addEventListener("wheel", (e) => { e.preventDefault(); camera.fov = Math.max(40, Math.min(90, camera.fov + e.deltaY * 0.03)); camera.updateProjectionMatrix(); }, { passive: false });
        const onKey = (e) => {
          if (!alive() || wrap.closest("[hidden]") || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName)) return;
          const k = e.key.toLowerCase();
          if (!["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) return;
          if (e.type === "keydown") { keys.add(k); target = null; hideHint(); if (k.startsWith("arrow")) e.preventDefault(); } else keys.delete(k);
        };
        window.addEventListener("keydown", onKey); window.addEventListener("keyup", onKey);
        const move = (dx, dz) => {
          if (freeAt(pos.x + dx, pos.z + dz)) { pos.x += dx; pos.z += dz; return true; }
          let ok = false;
          if (freeAt(pos.x + dx, pos.z)) { pos.x += dx; ok = true; }
          if (freeAt(pos.x, pos.z + dz)) { pos.z += dz; ok = true; }
          return ok;
        };

        T.photoRoomTo = (x, z, deg, pitchDeg = 0) => { pos.x = x; pos.z = z; yaw = (deg * Math.PI) / 180; pitch = (pitchDeg * Math.PI) / 180; target = null; };
        let last = performance.now();
        function frame(now) {
          if (!alive()) return;
          raf = requestAnimationFrame(frame);
          const dt = Math.min(0.1, (now - last) / 1000); last = now;
          if (wrap.closest("[hidden]")) return;
          let fwd = 0, side = 0;
          if (keys.has("w") || keys.has("arrowup")) fwd += 1;
          if (keys.has("s") || keys.has("arrowdown")) fwd -= 1;
          if (keys.has("d")) side += 1;
          if (keys.has("a")) side -= 1;
          yaw += looker.edge() * 1.5 * dt;
          if (keys.has("arrowleft") || keys.has("q")) yaw += 1.6 * dt;
          if (keys.has("arrowright") || keys.has("e")) yaw -= 1.6 * dt;
          const sp = 1.5 * (keys.has("shift") ? 2 : 1) * dt;
          if (fwd || side) {
            const l = Math.max(1, Math.hypot(fwd, side));
            move(((-Math.sin(yaw) * fwd + Math.cos(yaw) * side) / l) * sp, ((-Math.cos(yaw) * fwd - Math.sin(yaw) * side) / l) * sp);
          } else if (target) {
            const dx = target.x - pos.x, dz = target.z - pos.z, dist = Math.hypot(dx, dz);
            if (dist < 0.08 || !move((dx / dist) * Math.min(dist, sp), (dz / dist) * Math.min(dist, sp))) target = null;
          }
          // show the photo taken facing the way you're looking; the other fills its gaps
          const vx = -Math.sin(yaw), vz = -Math.cos(yaw);
          const score = parts.map((p) => vx * p.fwd.x + vz * p.fwd.z - 0.04 * Math.hypot(pos.x - p.cam.x, pos.z - p.cam.z));
          const best = score.indexOf(Math.max(...score));
          if (best !== primary && score[best] - score[primary] > 0.12) setPrimary(best);
          camera.position.set(pos.x, camH, pos.z);
          camera.rotation.set(pitch, yaw, 0);
          renderer.render(scene, camera);
        }
        raf = requestAnimationFrame(frame);
        return {
          el: wrap,
          layout() {
            const s = stage.getBoundingClientRect();
            w = Math.max(1, s.width); h = Math.max(1, s.height);
            renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
          },
          destroy() {
            cancelAnimationFrame(raf);
            window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey);
            disposables.forEach((d) => d.dispose()); ftex.dispose(); renderer.dispose(); wrap.remove();
          },
        };
      }

      // ---- Edit mode ----
      function setPick(x, y, fit) {
        pick = { x: +x.toFixed(3), y: +y.toFixed(3) };
        editPos.textContent = `Point chosen at ${Math.round(pick.x * 100)}% across, ${Math.round(pick.y * 100)}% down`;
        editAdd.disabled = false;
        stage.querySelectorAll(".rv-pick").forEach((n) => n.remove());
        if (fit) { const d = el("span", "rv-pick"); d.style.left = pick.x * 100 + "%"; d.style.top = pick.y * 100 + "%"; fit.appendChild(d); }
      }
      function renderEditPanel() {
        if (!room) return;
        editTo.replaceChildren(
          ...P.rooms.filter((r) => r.id !== room.id).map((r) => new Option(r.name, r.id)),
          new Option("Street (outside)", "outside")
        );
        editJson.value = JSON.stringify(room.links || [], null, 2);
        pick = null; editAdd.disabled = true; editPos.textContent = "No point chosen yet";
      }
      editAdd.addEventListener("click", () => {
        if (!pick) return;
        room.links = room.links || [];
        const link = { to: editTo.value, x: pick.x, y: pick.y };
        if (idx) link.media = idx;
        room.links.push(link);
        T.emit("tour:data-changed");
        show(room, idx);
      });
      edit.querySelector(".rv-edit-undo").addEventListener("click", () => {
        if (!room || !(room.links || []).length) return;
        room.links.pop();
        T.emit("tour:data-changed");
        show(room, idx);
      });

      T.on("tour:edit", ({ on }) => {
        editing = !!on;
        edit.hidden = !editing;
        root.classList.toggle("is-editing", editing);
      });
      T.on("tour:room", ({ roomId }) => {
        const r = T.roomById(P, roomId);
        if (r && r !== room) show(r, 0);
      });
      T.on("tour:photo", ({ roomId, index }) => {
        const r = T.roomById(P, roomId);
        if (r) show(r, index || 0);
      });
    },
  };
})();
