/* 3D walk-through built from the floor plan model (walls, floor types, glass) in property.model.
   Emits tour:room {roomId, source:"walk"} as you walk between rooms and tour:position for the plan marker.
   Listens for tour:room from elsewhere (plan clicks, buttons) and moves you there. */
(function () {
  const T = window.Tour;
  const INDOOR = new Set([2, 3, 4, 6, 7]);

  function decode(grid) {
    const out = new Uint8Array(grid.w * grid.h);
    let i = 0;
    for (const tok of grid.rle.split(".")) {
      const n = tok.length > 1 ? parseInt(tok.slice(1), 10) : 1;
      out.fill(+tok[0], i, i + n);
      i += n;
    }
    return out;
  }
  function hash(a, b) {
    let h = (a * 374761393 + b * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function inPoly(x, y, pts) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  T.Walk3D = {
    mount(root, P) {
      root.classList.add("w3");
      const gen = T.gen, alive = () => T.alive(gen);
      const M = P.model;
      if (!M || !window.THREE) {
        root.innerHTML = `<div class="w3-missing"><h2>The 3D view couldn’t start</h2>
          <p>${!M ? "This property has no 3D model yet." : "The 3D library didn’t load. Check your internet connection and reload."} The photo tour still works: choose Photos above.</p></div>`;
        return;
      }
      const THREE = window.THREE;
      const s = M.metresPerPx, cs = M.cell * s, H = M.wallHeight;
      const GW = M.grid.w, GH = M.grid.h, G = decode(M.grid);
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const cellAt = (x, z) => {
        const cx = Math.floor(x / cs), cz = Math.floor(z / cs);
        return cx < 0 || cz < 0 || cx >= GW || cz >= GH ? 0 : G[cz * GW + cx];
      };

      root.innerHTML = `
        <canvas class="w3-canvas" tabindex="0" aria-label="3D model of the flat. Move the mouse to look around, use W A S D or the arrow keys to move."></canvas>

        <div class="w3-help">
          <p>${coarse ? "Drag to look around. Use the circle to walk, or double-tap the floor to go there." : "Move the mouse to look around; hold it near the left or right edge to keep turning. Walk with W A S D or the arrow keys, or double-click the floor to go there."}</p>
          <button type="button">Got it</button>
        </div>
        <div class="w3-joy" aria-hidden="true"><span class="w3-knob"></span></div>
        <div class="w3-style">
          <button type="button" class="w3-furn" aria-pressed="true">Furniture on</button>
          <p>Furniture and finishes are an impression based on the listing photos.</p>
        </div>
        <div class="w3-dock">
          <p class="w3-room" aria-live="polite"></p>
          <div class="w3-views" aria-label="Viewpoints in this room"></div>
          <div class="w3-photos"><p class="w3-photos-title"></p><div class="w3-thumbs"></div></div>
        </div>
        <div class="w3-light" hidden role="dialog" aria-label="Room photo">
          <img alt="">
          <button type="button" class="w3-light-prev" aria-label="Previous photo">‹</button>
          <button type="button" class="w3-light-next" aria-label="Next photo">›</button>
          <button type="button" class="w3-light-close">Back to 3D</button>
        </div>`;
      const canvas = root.querySelector(".w3-canvas");
      const roomLabel = root.querySelector(".w3-room");
      const viewsEl = root.querySelector(".w3-views");
      const help = root.querySelector(".w3-help");
      const joy = root.querySelector(".w3-joy"), knob = root.querySelector(".w3-knob");
      const photosTitle = root.querySelector(".w3-photos-title"), thumbs = root.querySelector(".w3-thumbs");
      const light = root.querySelector(".w3-light"), lightImg = light.querySelector("img");
      help.querySelector("button").addEventListener("click", () => help.classList.add("is-gone"));

      // ---- Scene ----
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;   // nothing moves, so shadows are drawn once
      renderer.shadowMap.needsUpdate = true;
      const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
      const scene = new THREE.Scene();
      scene.background = lin("#cddbe4");
      const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
      camera.rotation.order = "YXZ";

      const W = GW * cs, D = GH * cs;
      // soft studio-style reflections for glossy surfaces (lacquer, brass, glass, marble)
      (function environment() {
        const env = new THREE.Scene();
        const shell = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 20), new THREE.MeshBasicMaterial({ color: lin("#9a958e"), side: THREE.BackSide }));
        env.add(shell);
        const panel = (w, h, x, y, z, ry, k) => {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k * 0.95) }));
          m.position.set(x, y, z); m.rotation.y = ry; env.add(m);
        };
        panel(14, 4, 0, 1, -9.9, 0, 5); panel(14, 4, -9.9, 1, 0, Math.PI / 2, 3);
        const top = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.9) }));
        top.rotation.x = Math.PI / 2; top.position.y = 3.9; env.add(top);
        const pm = new THREE.PMREMGenerator(renderer);
        scene.environment = pm.fromScene(env, 0.04).texture;
        pm.dispose();
      })();
      scene.add(new THREE.HemisphereLight(lin("#f6f1ea"), lin("#7a6a58"), 0.42));
      // late-afternoon sun, low enough to come in through the windows: from the south-west (north-west south of
      // the equator), turned to match the plan using property.north (the compass bearing of "up" on the plan)
      const sun = new THREE.DirectionalLight(lin("#ffe2b8"), 3.0);
      const sunBearing = (P.location && P.location.lat < 0 ? 298.4 : 241.6) - (Number.isFinite(P.north) ? P.north : 0);
      const sunA = (sunBearing * Math.PI) / 180;
      sun.position.set(W / 2 + Math.sin(sunA) * 27.3, 15, D / 2 - Math.cos(sunA) * 27.3);
      sun.target.position.set(W / 2, 0, D / 2);
      sun.castShadow = true;
      sun.shadow.mapSize.set(4096, 4096);
      const sc = sun.shadow.camera, ext = Math.hypot(W, D) * 0.56; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 90;
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
      scene.add(sun, sun.target, new THREE.AmbientLight(lin("#ffffff"), 0.08));
      const anis = renderer.capabilities.getMaxAnisotropy();

      // Floor: textured per floor type, generated from the model grid
      // ambient occlusion: how enclosed each spot is by nearby walls (corners and wall bases darker)
      const AO = (function () {
        const wall = new Float32Array(GW * GH);
        for (let i = 0; i < G.length; i++) wall[i] = G[i] === 1 ? 1 : 0;
        const blur = (src, r) => {
          const tmp = new Float32Array(src.length), out = new Float32Array(src.length), n = 2 * r + 1;
          for (let y = 0; y < GH; y++) {
            let acc = 0; const row = y * GW;
            for (let x = -r; x <= r; x++) acc += src[row + Math.min(GW - 1, Math.max(0, x))];
            for (let x = 0; x < GW; x++) { tmp[row + x] = acc / n; acc += src[row + Math.min(GW - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
          }
          for (let x = 0; x < GW; x++) {
            let acc = 0;
            for (let y = -r; y <= r; y++) acc += tmp[Math.min(GH - 1, Math.max(0, y)) * GW + x];
            for (let y = 0; y < GH; y++) { out[y * GW + x] = acc / n; acc += tmp[Math.min(GH - 1, y + r + 1) * GW + x] - tmp[Math.max(0, y - r) * GW + x]; }
          }
          return out;
        };
        const near = blur(wall, Math.max(2, Math.round(0.25 / cs))), far = blur(wall, Math.max(4, Math.round(0.8 / cs)));
        const ao = new Float32Array(GW * GH);
        for (let i = 0; i < ao.length; i++) ao[i] = Math.max(0.42, Math.min(1, 1 - 0.75 * near[i] - 0.6 * far[i]));
        return (fx, fy) => {   // bilinear sample in cell units
          const x = Math.max(0, Math.min(GW - 1.001, fx - 0.5)), y = Math.max(0, Math.min(GH - 1.001, fy - 0.5));
          const x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0, i = y0 * GW + x0;
          return (ao[i] * (1 - tx) + ao[i + 1] * tx) * (1 - ty) + (ao[i + GW] * (1 - tx) + ao[i + GW + 1] * tx) * ty;
        };
      })();

      (function floor() {
        const K = 4, cw = GW * K, ch = GH * K;
        const c = document.createElement("canvas");
        c.width = cw; c.height = ch;
        const ctx = c.getContext("2d");
        const img = ctx.createImageData(cw, ch), d = img.data;
        const px = cs / K;
        for (let y = 0; y < ch; y++) {
          const wz = y * px;
          for (let x = 0; x < cw; x++) {
            const cls = G[((y / K) | 0) * GW + ((x / K) | 0)];
            const o = (y * cw + x) * 4;
            if (cls < 2) { d[o + 3] = 0; continue; }
            const wx = x * px;
            let r, g, b, k = 1;
            if (cls === 2 || cls === 7) {
              // herringbone-style oak: alternating plank directions in 0.6 m blocks
              const bx = Math.floor(wx / 0.6), bz = Math.floor(wz / 0.6);
              const along = (bx + bz) % 2 === 0;
              const u = along ? wx : wz, v = along ? wz : wx;
              const pi = Math.floor(v / 0.1), seg = Math.floor((u + hash(pi, 3) * 0.6) / 0.6);
              k = 0.86 + 0.2 * hash(pi, seg);
              if ((v / 0.1) % 1 < 0.06 || ((u + hash(pi, 3) * 0.6) / 0.6) % 1 < 0.012) k *= 0.8;
              [r, g, b] = cls === 2 ? [172, 122, 78] : [98, 70, 48];
            } else if (cls === 3) {
              k = 0.95 + 0.06 * hash(x, y);
              [r, g, b] = [214, 205, 192];
            } else {
              const t = cls === 5 ? 0.6 : 0.6;
              const ti = Math.floor(wx / t), tj = Math.floor(wz / t);
              const gx = (wx / t) % 1, gz = (wz / t) % 1;
              k = 0.93 + 0.1 * hash(ti, tj);
              if (cls === 4) k *= 0.97 + 0.04 * Math.sin(wz * 38 + hash(ti, tj) * 20);
              if (gx < 0.012 || gz < 0.012) k *= 0.82;
              [r, g, b] = cls === 4 ? [226, 210, 182] : cls === 5 ? [168, 168, 162] : [230, 226, 218];
            }
            if (cls !== 5) k *= AO(x / K, y / K);
            d[o] = Math.min(255, r * k); d[o + 1] = Math.min(255, g * k); d[o + 2] = Math.min(255, b * k); d[o + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        const tex = new THREE.CanvasTexture(c);
        tex.anisotropy = anis; tex.encoding = THREE.sRGBEncoding;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.42, envMapIntensity: 0.45 }));
        mesh.receiveShadow = true;
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(W / 2, 0, D / 2);
        mesh.name = "floor";
        scene.add(mesh);
        floorMesh = mesh;
      })();
      var floorMesh;

      // Ceiling over indoor areas only (terraces stay open to the sky)
      (function ceiling() {
        const K = 2, cw = GW * K, ch = GH * K;
        const c = document.createElement("canvas");
        c.width = cw; c.height = ch;
        const ctx = c.getContext("2d");
        const img = ctx.createImageData(cw, ch);
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          const i = ((y / K) | 0) * GW + ((x / K) | 0), o = (y * cw + x) * 4;
          const v = INDOOR.has(G[i]) || G[i] === 1 ? 255 : 0;
          const a = 0.35 + 0.65 * AO(x / K, y / K);
          img.data[o] = 246 * a; img.data[o + 1] = 243 * a; img.data[o + 2] = 236 * a; img.data[o + 3] = v;
        }
        ctx.putImageData(img, 0, 0);
        const tex = new THREE.CanvasTexture(c);
        tex.flipY = false; tex.encoding = THREE.sRGBEncoding;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5 }));
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(W / 2, H, D / 2);
        mesh.castShadow = true;
        mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
        scene.add(mesh);
      })();

      // Walls, skirting, glass, railings as instanced boxes
      const box = new THREE.BoxGeometry(1, 1, 1);
      const cylGeoSmall = new THREE.CylinderGeometry(0.05, 0.05, 0.01, 12);
      const m4 = new THREE.Matrix4();
      function instanced(rects, material, height, y0, grow) {
        const mesh = new THREE.InstancedMesh(box, material, rects.length);
        rects.forEach(([x, y, w, h], i) => {
          m4.makeScale(w * cs + grow, height, h * cs + grow);
          m4.setPosition((x + w / 2) * cs, y0 + height / 2, (y + h / 2) * cs);
          mesh.setMatrixAt(i, m4);
        });
        scene.add(mesh);
        return mesh;
      }
      const plaster = (() => {
        const c = document.createElement("canvas"); c.width = 64; c.height = 256;
        const g = c.getContext("2d"), img = g.createImageData(64, 256);
        for (let y = 0; y < 256; y++) {
          const t = 1 - y / 255;   // canvas top = wall top
          const ao = Math.min(1, 0.7 + t * 2.2) * Math.min(1, 0.86 + (1 - t) * 1.6);
          for (let x = 0; x < 64; x++) {
            const o = (y * 64 + x) * 4, n = 1 + (hash(x, y) - 0.5) * 0.025;
            img.data[o] = 236 * ao * n; img.data[o + 1] = 231 * ao * n; img.data[o + 2] = 222 * ao * n; img.data[o + 3] = 255;
          }
        }
        g.putImageData(img, 0, 0);
        const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
      })();
      const wallMesh = instanced(M.walls, new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.92, envMapIntensity: 0.2 }), H, 0, 0);
      wallMesh.receiveShadow = true; wallMesh.castShadow = true;
      instanced(M.walls, new THREE.MeshStandardMaterial({ color: lin("#2e231c"), roughness: 0.45, envMapIntensity: 0.5 }), 0.14, 0, 0.02).receiveShadow = true;
      const glassMat = new THREE.MeshPhysicalMaterial({ color: lin("#c9dbe3"), roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.2 });
      // model.windows "punched": ordinary windows with wall below the sill and above the head (uploaded flats);
      // otherwise floor-to-ceiling glazing with a transom bar, as in the sample flat
      const punched = M.windows === "punched", SILL = 0.9, HEAD = Math.min(2.1, H - 0.3);
      if (punched) {
        instanced(M.glass, glassMat, HEAD - SILL, SILL, 0);
        // the wall under and over each window, in the colour of the room it belongs to
        const roomColour = ([x, y, w, h]) => {
          const horiz = w >= h, probes = horiz ? [[x + (w >> 1), y - 1], [x + (w >> 1), y + h]] : [[x - 1, y + (h >> 1)], [x + w, y + (h >> 1)]];
          for (const [px, pz] of probes) {
            if (px < 0 || pz < 0 || px >= GW || pz >= GH || G[pz * GW + px] < 2) continue;
            const r = T.roomAtPoint(P, (px + 0.5) * M.cell, (pz + 0.5) * M.cell);
            if (r && r.wallColor) return r.wallColor;
          }
          return "#ece7de";
        };
        const infillMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, envMapIntensity: 0.2 });
        const tint = new THREE.Color();
        [[SILL, 0], [H - HEAD, HEAD]].forEach(([height, y0]) => {
          const im = instanced(M.glass, infillMat, height, y0, 0);
          im.castShadow = true; im.receiveShadow = true;
          M.glass.forEach((rc, i) => im.setColorAt(i, tint.set(roomColour(rc)).convertSRGBToLinear()));
        });
        instanced(M.glass, new THREE.MeshStandardMaterial({ color: lin("#2e231c"), roughness: 0.45, envMapIntensity: 0.5 }), 0.14, 0, 0.02).receiveShadow = true;
        instanced(M.glass, new THREE.MeshStandardMaterial({ color: lin("#f4f1ec"), roughness: 0.5 }), 0.04, SILL - 0.04, 0.07);   // sill board
      } else {
        instanced(M.glass, glassMat, H, 0, 0);
        instanced(M.glass, new THREE.MeshStandardMaterial({ color: lin("#4b3a2c"), metalness: 0.7, roughness: 0.4 }), 0.05, 1.05, 0.01);
      }
      instanced(M.railing, glassMat, 1.1, 0, 0);
      instanced(M.railing, new THREE.MeshStandardMaterial({ color: lin("#5f5d58"), metalness: 0.8, roughness: 0.35 }), 0.05, 1.1, 0.02);

      // ---- Finishes, styled after the listing photos ----
      const finishes = new THREE.Group();
      scene.add(finishes);
      const bronze = new THREE.MeshStandardMaterial({ color: lin("#4a3a2c"), metalness: 0.75, roughness: 0.38, envMapIntensity: 0.9 });
      const curtainMat = new THREE.MeshStandardMaterial({ color: lin("#d6c8b0"), roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.2 });
      // pleated curtain panel: a plane folded into soft waves
      const pleatGeo = (() => {
        const g = new THREE.PlaneGeometry(0.42, H - 0.12, 48, 1), p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, Math.sin(x * 62) * 0.035 + Math.sin(x * 23) * 0.012); }
        g.computeVertexNormals(); g.translate(0, (H - 0.12) / 2 + 0.02, 0);
        return g;
      })();
      const addBox = (parent, material, w, h, d, x, y, z) => {
        const m = new THREE.Mesh(box, material); m.scale.set(w, h, d); m.position.set(x, y + h / 2, z); parent.add(m); return m;
      };
      const isIndoor = (cx, cz) => cx >= 0 && cz >= 0 && cx < GW && cz < GH && INDOOR.has(G[cz * GW + cx]);
      // window frames, mullions and curtains along each glazed opening
      M.glass.forEach(([x, y, w, h]) => {
        const horiz = w >= h, len = (horiz ? w : h) * cs;
        if (len < 0.35) return;
        const cx = (x + w / 2) * cs, cz = (y + h / 2) * cs;
        const along = (t) => (horiz ? [x * cs + t, cz] : [cx, y * cs + t]);
        if (punched) {
          // a plain white frame: head, sill and a centre bar on wider windows
          const frame = new THREE.MeshStandardMaterial({ color: lin("#f2efe9"), roughness: 0.55 });
          [SILL, HEAD - 0.06].forEach((y) => addBox(finishes, frame, horiz ? len : 0.08, 0.06, horiz ? 0.08 : len, cx, y, cz));
          [0.03, len - 0.03].concat(len > 1.4 ? [len / 2] : []).forEach((t) => { const [px, pz] = along(t); addBox(finishes, frame, 0.06, HEAD - SILL, 0.06, px, SILL, pz); });
          return;
        }
        let side = 0;
        if (horiz) side = isIndoor(x + (w >> 1), y - 1) ? -1 : isIndoor(x + (w >> 1), y + h) ? 1 : 0;
        else side = isIndoor(x - 1, y + (h >> 1)) ? -1 : isIndoor(x + w, y + (h >> 1)) ? 1 : 0;
        addBox(finishes, bronze, horiz ? len : 0.07, 0.09, horiz ? 0.07 : len, cx, H - 0.09, cz);
        const n = Math.max(1, Math.round(len / 1.1));
        for (let i = 0; i <= n; i++) {
          const [px, pz] = along((i * len) / n);
          addBox(finishes, bronze, 0.06, H, 0.06, px, 0, pz);
        }
        if (!side || len < 0.6) return;
        [0.12, len - 0.12].forEach((t) => {
          const [px, pz] = along(t);
          const off = side * 0.16;
          const c = new THREE.Mesh(pleatGeo, curtainMat);
          c.position.set(horiz ? px : px + off, 0, horiz ? pz + off : pz);
          c.rotation.y = horiz ? 0 : Math.PI / 2;
          c.castShadow = true; c.receiveShadow = true;
          finishes.add(c);
        });
      });
      // travertine lining on bathroom walls
      const lining = [];
      for (let z = 1; z < GH - 1; z++) for (let x = 1; x < GW - 1; x++) {
        if (G[z * GW + x] !== 4) continue;
        if (G[z * GW + x - 1] === 1 || G[z * GW + x + 1] === 1 || G[(z - 1) * GW + x] === 1 || G[(z + 1) * GW + x] === 1) lining.push([x, z]);
      }
      // (the sample flat only: an uploaded flat's bathroom keeps the wall colour seen in its photos)
      if (lining.length && !punched) {
        const lm = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, envMapIntensity: 0.6 }), lining.length);
        lm.receiveShadow = true;
        const col = new THREE.Color();
        lining.forEach(([x, z], i) => {
          m4.makeScale(cs * 1.02, H, cs * 1.02); m4.setPosition((x + 0.5) * cs, H / 2, (z + 0.5) * cs); lm.setMatrixAt(i, m4);
          // one even tone: shading each column differently reads as vertical stripes, not stone
          col.setRGB(226 / 255, 206 / 255, 172 / 255).convertSRGBToLinear(); lm.setColorAt(i, col);
        });
        finishes.add(lm);
      }
      // coffered ceilings with warm cove lighting, downlights, and a warm light in each room
      const cove = new THREE.MeshStandardMaterial({ color: lin("#fff2d8"), emissive: lin("#f3c98a"), emissiveIntensity: 2.2 });
      const soffit = new THREE.MeshStandardMaterial({ color: lin("#efece6"), roughness: 0.95 });
      const downlight = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.85, 2.6) });
      const gradTex = (radial) => {
        const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
        const grd = radial ? g.createRadialGradient(64, 64, 2, 64, 64, 64) : g.createLinearGradient(0, 0, 0, 128);
        grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(radial ? 0.25 : 0.15, "rgba(255,255,255,0.55)"); grd.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
        return new THREE.CanvasTexture(c);
      };
      const washMat = new THREE.MeshBasicMaterial({ map: gradTex(false), color: lin("#ffcf8f").multiplyScalar(0.45), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const haloMat = new THREE.MeshBasicMaterial({ map: gradTex(true), color: lin("#ffe2b8").multiplyScalar(0.12), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const halos = [];
      // glowing strip on the ceiling running inward from a cove: a = edge direction angle, (x, z) its centre
      const wash = (len, x, z, a) => {
        const g = new THREE.Group(); g.position.set(x, H - 0.004, z); g.rotation.y = a;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.75), washMat);
        m.rotation.x = Math.PI / 2; m.position.z = -0.375; g.add(m); finishes.add(g);
      };
      P.rooms.forEach((room) => {
        if (room.floor !== (P.rooms[0] || {}).floor || /terrace/.test(room.id)) return;
        const xs = room.outline.map((p) => p[0] * s), zs = room.outline.map((p) => p[1] * s);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rw = x1 - x0, rd = z1 - z0;
        let inset = 0;
        if (room.ceiling === "tray" && rw > 2.5 && rd > 2.5) {
          inset = 0.55; const t = 0.2;
          addBox(finishes, soffit, rw, t, inset, cx, H - t, z0 + inset / 2);
          addBox(finishes, soffit, rw, t, inset, cx, H - t, z1 - inset / 2);
          addBox(finishes, soffit, inset, t, rd - 2 * inset, x0 + inset / 2, H - t, cz);
          addBox(finishes, soffit, inset, t, rd - 2 * inset, x1 - inset / 2, H - t, cz);
          addBox(finishes, cove, rw - 2 * inset, 0.03, 0.03, cx, H - 0.05, z0 + inset);
          addBox(finishes, cove, rw - 2 * inset, 0.03, 0.03, cx, H - 0.05, z1 - inset);
          addBox(finishes, cove, 0.03, 0.03, rd - 2 * inset, x0 + inset, H - 0.05, cz);
          addBox(finishes, cove, 0.03, 0.03, rd - 2 * inset, x1 - inset, H - 0.05, cz);
          wash(rw - 2 * inset, cx, z1 - inset, 0);
          wash(rw - 2 * inset, cx, z0 + inset, Math.PI);
          wash(rd - 2 * inset, x0 + inset, cz, -Math.PI / 2);
          wash(rd - 2 * inset, x1 - inset, cz, Math.PI / 2);
        }
        const step = 1.6;
        for (let x = x0 + step / 2; x < x1; x += step)
          for (let z = z0 + step / 2; z < z1; z += step) {
            if (!inPoly(x / s, z / s, room.outline) || cellAt(x, z) < 2) continue;
            const inTray = inset && (x - x0 < inset || x1 - x < inset || z - z0 < inset || z1 - z < inset);
            const d = new THREE.Mesh(cylGeoSmall, downlight);
            d.position.set(x, inTray ? H - 0.205 : H - 0.006, z);
            finishes.add(d);
            halos.push([x, inTray ? H - 0.207 : H - 0.008, z]);
          }
      });

      if (halos.length) {
        const hm = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.42, 0.42), haloMat, halos.length);
        halos.forEach(([x, y, z], i) => { m4.makeRotationX(Math.PI / 2); m4.setPosition(x, y, z); hm.setMatrixAt(i, m4); });
        finishes.add(hm);
      }

      // ---- Furniture ----
      // F holds the furniture now in the scene; Arrange swaps in a live, movable copy while you rearrange
      const F = { group: null, blocked: null };
      if (T.buildFurniture && P.furnishing) {
        const built = T.buildFurniture(THREE, P, { s, cs, GW, GH, aniso: anis });
        F.group = built.group; F.blocked = built.blocked;
        scene.add(F.group);
      }

      // Surroundings: park below and a loose skyline, so windows look out onto something
      const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: lin("#6f98c6") }, mid: { value: lin("#bcd2e4") }, hor: { value: lin("#efe3cf") } },
        vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: "uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*1.6,0.0,1.0),0.7)) : hor; c = mix(hor, c, smoothstep(-0.02, 0.18, h)); gl_FragColor = vec4(c,1.0); }",
      }));
      sky.position.set(W / 2, 0, D / 2); sky.renderOrder = -1;
      scene.add(sky);
      scene.background = null;
      scene.fog = new THREE.Fog(lin("#e6ddd0"), 60, 330);
      const grass = (() => {
        const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d"), img = g.createImageData(256, 256);
        for (let i = 0; i < 256 * 256; i++) { const n = 0.85 + hash(i, 9) * 0.3; img.data[i * 4] = 98 * n; img.data[i * 4 + 1] = 128 * n; img.data[i * 4 + 2] = 74 * n; img.data[i * 4 + 3] = 255; }
        g.putImageData(img, 0, 0);
        const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(160, 160); t.encoding = THREE.sRGBEncoding; return t;
      })();
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(W / 2, -24, D / 2);
      scene.add(ground);
      // Green Park: tree canopies to the south and west
      const nTrees = 420, canopy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), nTrees);
      const tc = new THREE.Color();
      for (let i = 0; i < nTrees; i++) {
        const x = W / 2 - 160 + hash(i, 11) * 190, z = D / 2 + 25 + hash(i, 12) * 170;
        if (x > W / 2 - 15 && z < D / 2 + 40) continue;
        const r = 4 + hash(i, 13) * 4;
        m4.makeScale(r, r * (0.8 + hash(i, 14) * 0.4), r); m4.setPosition(x, -24 + r * 1.3, z); canopy.setMatrixAt(i, m4);
        tc.setHSL(0.24 + hash(i, 15) * 0.06, 0.38, 0.26 + hash(i, 16) * 0.1).convertSRGBToLinear(); canopy.setColorAt(i, tc);
      }
      scene.add(canopy);
      // skyline: stone, brick and glass blocks with window grids, further out
      const facade = (() => {
        const c = document.createElement("canvas"); c.width = 256; c.height = 512; const g = c.getContext("2d");
        g.fillStyle = "#e4dccd"; g.fillRect(0, 0, 256, 512);
        for (let y = 8; y < 512; y += 24) for (let x = 8; x < 256; x += 22) {
          const lit = hash(x, y) > 0.86;
          g.fillStyle = lit ? "#e9d3a0" : (hash(y, x) > 0.5 ? "#55606a" : "#6b7680");
          g.fillRect(x, y, 12, 15);
        }
        const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
      })();
      const city = [];
      for (let i = 0; i < 140; i++) {
        const a = hash(i, 1) * Math.PI * 2, dist = 110 + hash(i, 2) * 170;
        if (Math.cos(a) < -0.2 && Math.sin(a) > 0.1 && dist < 230) continue;   // keep the park open
        const w = 14 + hash(i, 3) * 26, h = 12 + hash(i, 4) * (hash(i, 6) > 0.93 ? 110 : 34);
        city.push([W / 2 + Math.cos(a) * dist, D / 2 + Math.sin(a) * dist, w, h, hash(i, 7)]);
      }
      const cityMesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ map: facade, color: 0xffffff, roughness: 0.85 }), city.length);
      const bc = new THREE.Color();
      city.forEach(([x, z, w, h, k], i) => {
        m4.makeScale(w, h, w * 0.8); m4.setPosition(x, -24 + h / 2, z); cityMesh.setMatrixAt(i, m4);
        bc.set(k < 0.45 ? "#efe6d6" : k < 0.75 ? "#c99a7d" : k < 0.9 ? "#d6dadc" : "#b8c6cf").convertSRGBToLinear(); cityMesh.setColorAt(i, bc);
      });
      scene.add(cityMesh);

      // ---- Movement and collision ----
      const R = 0.22;
      const open = (x, z) => {
        if (cellAt(x, z) < 2) return false;
        if (F.blocked && F.group && F.group.visible) {
          const cx = Math.floor(x / cs), cz = Math.floor(z / cs);
          if (F.blocked[cz * GW + cx]) return false;
        }
        return true;
      };
      const free = (x, z) => {
        if (!open(x, z)) return false;
        for (let a = 0; a < 8; a++) if (!open(x + Math.cos((a * Math.PI) / 4) * R, z + Math.sin((a * Math.PI) / 4) * R)) return false;
        return true;
      };
      const pos = { x: W / 2, z: D / 2 };
      let yaw = 0, pitch = 0, target = null;
      const keys = new Set();
      let joyVec = { x: 0, y: 0 };

      function moveBy(dx, dz) {
        if (free(pos.x + dx, pos.z + dz)) { pos.x += dx; pos.z += dz; return true; }
        let moved = false;
        if (free(pos.x + dx, pos.z)) { pos.x += dx; moved = true; }
        if (free(pos.x, pos.z + dz)) { pos.z += dz; moved = true; }
        return moved;
      }
      function rayLength(x, z, ang) {
        const dx = -Math.sin(ang), dz = -Math.cos(ang);
        let t = 0;
        while (t < 12 && cellAt(x + dx * t, z + dz * t) >= 2) t += 0.1;
        return t;
      }
      function goToRoom(room) {
        let [cx, cy] = room.outline.reduce((a, p) => [a[0] + p[0] / room.outline.length, a[1] + p[1] / room.outline.length], [0, 0]);
        let best = null;
        for (let r = 0; r < 120 && !best; r += 2) {
          for (let a = 0; a < 16 && !best; a++) {
            const x = cx + Math.cos((a * Math.PI) / 8) * r, y = cy + Math.sin((a * Math.PI) / 8) * r;
            if (inPoly(x, y, room.outline) && free(x * s, y * s)) best = [x * s, y * s];
            if (r === 0) break;
          }
        }
        if (!best) return;
        pos.x = best[0]; pos.z = best[1]; target = null;
        let bestA = 0, bestL = -1;
        for (let a = 0; a < 24; a++) {
          const ang = (a * Math.PI) / 12, l = rayLength(pos.x, pos.z, ang);
          if (l > bestL) { bestL = l; bestA = ang; }
        }
        yaw = bestA; pitch = -0.05;
        currentRoom = room.id;
        showRoom(room);
      }

      // look: the view follows the mouse (touch: drag); near the left/right edge it keeps turning
      const drag = null;
      let lookMoved = 0;
      let gate = { look: () => false, busy: () => false };   // Arrange replaces this while it is on
      const looker = T.attachLook(canvas, (dy, dp) => {
        if (glide || gate.look()) return;
        yaw += dy; pitch = Math.max(-1.1, Math.min(1.1, pitch + dp));
      }, { onMove: (m) => { lookMoved += m; if (lookMoved > 400) dismissHelp(); } });
      canvas.addEventListener("pointerdown", () => canvas.focus({ preventScroll: true }));
      canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        camera.fov = Math.max(40, Math.min(85, camera.fov + e.deltaY * 0.03));
        camera.updateProjectionMatrix();
      }, { passive: false });

      // double-click / double-tap the floor to walk there
      const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
      canvas.addEventListener("dblclick", (e) => {
        if (gate.busy(e)) return;
        const r = canvas.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObject(floorMesh)[0];
        if (hit && cellAt(hit.point.x, hit.point.z) >= 2) { target = { x: hit.point.x, z: hit.point.z }; dismissHelp(); }
      });

      // keyboard
      const typing = (el) => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      window.addEventListener("keydown", (e) => {
        if (!alive() || !visible() || typing(document.activeElement) || !light.hidden) return;
        const k = e.key.toLowerCase();
        if (["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) {
          keys.add(k); target = null; dismissHelp();
          if (k.startsWith("arrow")) e.preventDefault();
        }
      });
      window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
      window.addEventListener("blur", () => keys.clear());

      // touch joystick
      let joyId = null;
      joy.addEventListener("pointerdown", (e) => { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); joyMove(e); dismissHelp(); target = null; });
      joy.addEventListener("pointermove", (e) => e.pointerId === joyId && joyMove(e));
      const joyEnd = () => { joyId = null; joyVec = { x: 0, y: 0 }; knob.style.transform = ""; };
      joy.addEventListener("pointerup", joyEnd);
      joy.addEventListener("pointercancel", joyEnd);
      function joyMove(e) {
        const r = joy.getBoundingClientRect(), rad = r.width / 2;
        let x = (e.clientX - r.left - rad) / rad, y = (e.clientY - r.top - rad) / rad;
        const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
        joyVec = { x, y };
        knob.style.transform = `translate(${x * rad * 0.6}px, ${y * rad * 0.6}px)`;
      }

      const furnBtn = root.querySelector(".w3-furn");
      if (!F.group) root.querySelector(".w3-style").hidden = true;
      furnBtn.addEventListener("click", () => {
        F.group.visible = !F.group.visible;
        furnBtn.setAttribute("aria-pressed", String(F.group.visible));
        furnBtn.textContent = F.group.visible ? "Furniture on" : "Furniture off";
        renderer.shadowMap.needsUpdate = true;
        if (F.group.visible && !free(pos.x, pos.z)) { const r = roomAt(); if (r) goToRoom(r); }
      });
      // step out of a piece that has just been put where you are standing
      function unstick() {
        if (free(pos.x, pos.z)) return;
        for (let r = 0.1; r < 3; r += 0.1)
          for (let a = 0; a < 16; a++) {
            const x = pos.x + Math.cos((a * Math.PI) / 8) * r, z = pos.z + Math.sin((a * Math.PI) / 8) * r;
            if (free(x, z)) { pos.x = x; pos.z = z; target = null; return; }
          }
      }
      let helpTimer = setTimeout(dismissHelp, 12000);
      function dismissHelp() { help.classList.add("is-gone"); clearTimeout(helpTimer); }

      // ---- Room tracking, HUD, photos ----
      let currentRoom = null, photoList = [], photoIdx = 0;
      function roomAt() {
        const x = pos.x / s, y = pos.z / s;
        return T.roomAtPoint(P, x, y);
      }
      let showToken = 0;
      async function showRoom(room) {
        const my = ++showToken;
        roomLabel.textContent = room ? room.name : "";
        roomLabel.hidden = !room;
        viewsEl.replaceChildren(...((room && room.views) || []).map((v) => {
          const b = document.createElement("button");
          b.type = "button"; b.textContent = v.label;
          b.addEventListener("click", () => { dismissHelp(); T.walkTo(v.x, v.y, v.deg, v.pitch != null ? v.pitch : -4, true); });
          return b;
        }));
        thumbs.replaceChildren();
        photoList = [];
        if (!room) { photosTitle.textContent = ""; root.querySelector(".w3-photos").hidden = true; return; }
        root.querySelector(".w3-photos").hidden = false;
        const results = await Promise.all(room.media.map((_, i) => T.mediaImage(P, room, i)));
        if (currentRoom !== room.id) return;
        if (my !== showToken) return;   // a later call (arriving in another room) owns the strip now
        thumbs.replaceChildren();
        const real = results.map((r, i) => ({ r, i })).filter(({ r }) => !r.placeholder);
        photoList = real.map(({ r }) => r.image.src);
        const in3d = real.some(({ i }) => room.media[i].depth || room.media[i].type === "fused");
        photosTitle.textContent = photoList.length ? (in3d ? "Photos of this room, in 3D" : "Photos of this room") : "No photos of this room yet";
        photoList.forEach((src, i) => {
          const b = document.createElement("button");
          b.type = "button";
          b.setAttribute("aria-label", `Open photo ${i + 1} of the ${room.name.toLowerCase()} in 3D`);
          const im = document.createElement("img"); im.src = src; im.alt = "";
          b.appendChild(im);
          b.addEventListener("click", () => T.emit("tour:photo", { roomId: room.id, index: real[i].i }));
          thumbs.appendChild(b);
        });
      }
      function openLight(i) {
        photoIdx = (i + photoList.length) % photoList.length;
        lightImg.src = photoList[photoIdx];
        light.querySelector(".w3-light-prev").hidden = light.querySelector(".w3-light-next").hidden = photoList.length < 2;
        light.hidden = false;
        light.querySelector(".w3-light-close").focus();
      }
      light.querySelector(".w3-light-prev").addEventListener("click", () => openLight(photoIdx - 1));
      light.querySelector(".w3-light-next").addEventListener("click", () => openLight(photoIdx + 1));
      light.querySelector(".w3-light-close").addEventListener("click", () => { light.hidden = true; canvas.focus({ preventScroll: true }); });
      light.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { light.hidden = true; canvas.focus({ preventScroll: true }); }
        if (e.key === "ArrowLeft") openLight(photoIdx - 1);
        if (e.key === "ArrowRight") openLight(photoIdx + 1);
      });

      // ---- Loop ----
      const visible = () => !root.closest("[hidden]");
      function resize() {
        const w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      window.addEventListener("resize", () => alive() && resize());
      let last = performance.now(), lastTrack = 0, lastPos = "";
      function frame(now) {
        if (!alive()) { renderer.dispose(); return; }
        requestAnimationFrame(frame);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (!visible()) return;
        if (glide) {
          if (keys.size || drag || joyVec.x || joyVec.y) glide = null;
          else {
            const k = Math.min(1, (now - glide.t0) / glide.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
            pos.x = glide.from.x + (glide.to.x - glide.from.x) * e; pos.z = glide.from.z + (glide.to.z - glide.from.z) * e;
            yaw = glide.from.yaw + (glide.to.yaw - glide.from.yaw) * e; pitch = glide.from.pitch + (glide.to.pitch - glide.from.pitch) * e;
            if (k === 1) glide = null;
          }
        }
        const run = keys.has("shift") ? 2 : 1;
        let fwd = 0, side = 0, turn = 0;
        if (keys.has("w") || keys.has("arrowup")) fwd += 1;
        if (keys.has("s") || keys.has("arrowdown")) fwd -= 1;
        if (keys.has("d")) side += 1;
        if (keys.has("a")) side -= 1;
        if (keys.has("arrowleft") || keys.has("q")) turn += 1;
        if (keys.has("arrowright") || keys.has("e")) turn -= 1;
        fwd -= joyVec.y; side += joyVec.x;
        yaw += turn * 1.7 * dt + (glide || gate.look() ? 0 : looker.edge() * 1.5 * dt);
        const speed = 1.7 * run * dt;
        if (fwd || side) {
          const sx = -Math.sin(yaw), sz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
          const l = Math.max(1, Math.hypot(fwd, side));
          moveBy(((sx * fwd + rx * side) / l) * speed, ((sz * fwd + rz * side) / l) * speed);
        } else if (target) {
          const dx = target.x - pos.x, dz = target.z - pos.z, dist = Math.hypot(dx, dz);
          if (dist < 0.08 || !moveBy((dx / dist) * Math.min(dist, speed * 1.4), (dz / dist) * Math.min(dist, speed * 1.4))) target = null;
        }
        camera.position.set(pos.x, 1.6, pos.z);
        camera.rotation.set(pitch, yaw, 0);
        if (outlook) outlook.update(camera.position);
        renderer.render(scene, camera);

        if (now - lastTrack > 150) {
          lastTrack = now;
          const r = roomAt();
          const id = r ? r.id : null;
          if (id !== currentRoom) {
            currentRoom = id;
            showRoom(r);
            if (r) T.emit("tour:room", { roomId: r.id, source: "walk" });
          }
          const key = `${pos.x.toFixed(2)},${pos.z.toFixed(2)},${yaw.toFixed(2)}`;
          if (key !== lastPos) { lastPos = key; T.emit("tour:position", { x: pos.x / s, y: pos.z / s, heading: yaw }); }
        }
      }

      T.on("tour:room", ({ roomId, source }) => {
        if (source === "walk") return;
        const r = T.roomById(P, roomId);
        if (r) goToRoom(r);
      });
      // stand at a spot on the plan (pixels) facing a direction (degrees, 0 = up the plan)
      let glide = null;
      T.__w3 = { renderer, scene, camera, THREE };
      // the real view out of the windows from Google Street View, when there's a key; the drawn scenery otherwise
      const outlook = T.Outlook ? T.Outlook.attach({ THREE, scene, root, P, alive, drawn: [sky, ground, canopy, cityMesh] }) : null;
      if (T.Decorate) T.Decorate.attach({ root, THREE, scene, camera, renderer, canvas, wallMesh, M, G, GW, GH, cs, H, s, P, alive });
      if (T.Arrange && F.group) gate = T.Arrange.attach({
        root, THREE, scene, camera, renderer, canvas, wallMesh, F, P, s, cs, GW, GH, aniso: anis, alive, visible: () => visible(),
        cellAt, inPoly, unstick, roomAt: () => roomAt(), view: () => ({ x: pos.x, z: pos.z, yaw }),
      }) || gate;
      if (T.Designer && F.group) T.Designer.attach({ root, renderer, scene, camera, canvas, P, alive, roomAt: () => roomAt() });
      T.walkTo = (x, y, deg = 0, pitchDeg = -4, smooth = false) => {
        const to = { x: x * s, z: y * s, yaw: (deg * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180 };
        // Viewpoints are worked out before the room is furnished, so one can land in furniture or right behind
        // a wardrobe. Stand where you're clear and can see at least a couple of metres ahead, as near as possible.
        const ahead = (x, z) => { const dx = -Math.sin(to.yaw), dz = -Math.cos(to.yaw); let t = 0; while (t < 3 && open(x + dx * t, z + dz * t)) t += 0.1; return t; };
        const want = Math.min(2.2, ahead(to.x, to.z) + (free(to.x, to.z) ? 0 : 3));
        if (!free(to.x, to.z) || ahead(to.x, to.z) < Math.min(2.2, want)) {
          let bestSpot = null, bestScore = -Infinity;
          const home = T.roomAtPoint(P, x, y);
          const reachable = (nx, nz) => { const n = Math.ceil(Math.hypot(nx - to.x, nz - to.z) / 0.05); for (let k = 0; k <= n; k++) if (cellAt(to.x + ((nx - to.x) * k) / n, to.z + ((nz - to.z) * k) / n) < 2) return false; return true; };
          for (let r = 0.1; r < 1.6; r += 0.1) for (let a = 0; a < 16; a++) {
            const nx = to.x + Math.cos((a * Math.PI) / 8) * r, nz = to.z + Math.sin((a * Math.PI) / 8) * r;
            if (!free(nx, nz) || !reachable(nx, nz) || (home && T.roomAtPoint(P, nx / s, nz / s) !== home)) continue;
            const sc = Math.min(ahead(nx, nz), 2.5) - r * 0.8;   // a clear view, without moving far
            if (sc > bestScore) { bestScore = sc; bestSpot = [nx, nz]; }
          }
          if (bestSpot && (!free(to.x, to.z) || bestScore > ahead(to.x, to.z))) { to.x = bestSpot[0]; to.z = bestSpot[1]; }
        }
        target = null;
        if (smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          let dy = to.yaw - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          glide = { from: { x: pos.x, z: pos.z, yaw, pitch }, to: { ...to, yaw: yaw + dy }, t0: performance.now(), dur: 1400 };
        } else { pos.x = to.x; pos.z = to.z; yaw = to.yaw; pitch = to.pitch; glide = null; }
      };
      T.on("tour:mode", ({ mode }) => { if (mode === "walk") { resize(); canvas.focus({ preventScroll: true }); } });
      resize();
      goToRoom(T.roomById(P, P.startRoom || P.entryRoom) || P.rooms[0]);
      requestAnimationFrame(frame);
    },
  };
})();
