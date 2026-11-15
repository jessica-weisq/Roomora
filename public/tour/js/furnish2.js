/* Furnishing for the 3D walk, modelled after the listing photos.
   Each item in property.furnishing: { room, type, x, y (plan pixels, centre), rot (degrees: 0 faces down the plan,
   90 faces right), ...size and colour options }. Physically based materials, rounded upholstery, soft shadows.
   Returns { group, blocked } where blocked marks plan cells you can't walk through. */
(function () {
  const T = window.Tour;

  T.buildFurniture = function (THREE, P, opts) {
    const { s, cs, GW, GH, aniso = 4 } = opts;
    const group = new THREE.Group();
    const blocked = new Uint8Array(GW * GH);
    const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
    const srgb = (tex) => { tex.encoding = THREE.sRGBEncoding; tex.anisotropy = aniso; return tex; };

    // ---- procedural textures ----
    const canvasTex = (w, h, draw, repeat) => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      draw(c.getContext("2d"), w, h);
      const t = new THREE.CanvasTexture(c);
      if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
      return t;
    };
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const weave = canvasTex(256, 256, (g, w, h) => {
      const img = g.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = 226 + 18 * ((x % 4 < 2) !== (y % 4 < 2) ? 1 : 0) * 0.5 + (rnd() - 0.5) * 22;
        const o = (y * w + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }, 6);
    const grain = (base, dark) => srgb(canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 160; i++) {
        const y = rnd() * h, a = 0.05 + rnd() * 0.12;
        g.strokeStyle = `rgba(${dark},${a})`; g.lineWidth = 0.5 + rnd() * 2.2;
        g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 4 + Math.sin(x * 0.043 + i * 2) * 1.5);
        g.stroke();
      }
    }, 1));
    const darkOak = grain("#4a3426", "20,12,6");
    const midOak = grain("#8a6545", "50,30,15");
    const veined = (base, vein, n) => srgb(canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let i = 0; i < n; i++) {
        g.strokeStyle = vein; g.globalAlpha = 0.12 + rnd() * 0.25; g.lineWidth = 0.6 + rnd() * 1.6;
        let x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 30; k++) { x += (rnd() - 0.3) * 30; y += (rnd() - 0.5) * 22; g.lineTo(x, y); }
        g.stroke();
      }
      g.globalAlpha = 1;
    }, 1));
    const marble = veined("#f1efea", "#8e8a85", 26);
    const travertine = srgb(canvasTex(512, 512, (g, w, h) => {
      for (let y = 0; y < h; y++) {
        const v = 0.92 + 0.06 * Math.sin(y * 0.09) + 0.04 * Math.sin(y * 0.31 + 2) + (rnd() - 0.5) * 0.03;
        g.fillStyle = `rgb(${226 * v | 0},${207 * v | 0},${172 * v | 0})`; g.fillRect(0, y, w, 1);
      }
    }, 1));
    const rugCircles = (base, line) => srgb(canvasTex(1024, 1024, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      g.strokeStyle = line; g.lineWidth = 9;
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        g.globalAlpha = 0.55 + rnd() * 0.3;
        g.beginPath(); g.ellipse(80 + x * 145 + (y % 2) * 70, 75 + y * 145, 62, 44, 0, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1; g.strokeStyle = "rgba(0,0,0,.05)"; g.lineWidth = 18; g.strokeRect(9, 9, w - 18, h - 18);
    }, 1));

    // ---- materials ----
    const cache = new Map();
    const M = (key, make) => (cache.has(key) ? cache.get(key) : (cache.set(key, make()), cache.get(key)));
    const fabric = (hex, rough = 0.9) => M("fab" + hex + rough, () => new THREE.MeshStandardMaterial({ color: lin(hex), map: weave, bumpMap: weave, bumpScale: 0.0015, roughness: rough, envMapIntensity: 0.35 }));
    const velvet = (hex) => fabric(hex, 0.72);
    const wood = (tex, rough = 0.5) => M("wood" + tex.uuid, () => new THREE.MeshStandardMaterial({ map: tex, roughness: rough, envMapIntensity: 0.6 }));
    const lacquer = (hex) => M("lac" + hex, () => new THREE.MeshPhysicalMaterial({ color: lin(hex), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.8 }));
    const gloss = (hex) => M("gl" + hex, () => new THREE.MeshPhysicalMaterial({ color: lin(hex), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1 }));
    const metal = (hex, rough = 0.3) => M("met" + hex + rough, () => new THREE.MeshStandardMaterial({ color: lin(hex), metalness: 1, roughness: rough, envMapIntensity: 1.1 }));
    const stone = (tex, rough = 0.25) => M("st" + tex.uuid + rough, () => new THREE.MeshStandardMaterial({ map: tex, roughness: rough, envMapIntensity: 0.7 }));
    const ceramic = () => M("cer", () => new THREE.MeshPhysicalMaterial({ color: lin("#f7f6f2"), roughness: 0.12, clearcoat: 0.8, envMapIntensity: 0.9 }));
    const matte = (hex, rough = 0.85) => M("mat" + hex + rough, () => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: rough, envMapIntensity: 0.4 }));
    const glow = (hex, glowHex, k = 0.8) => M("glow" + hex + glowHex, () => new THREE.MeshStandardMaterial({ color: lin(hex), emissive: lin(glowHex), emissiveIntensity: k, roughness: 0.9, side: THREE.DoubleSide }));
    const mirror = () => M("mir", () => new THREE.MeshStandardMaterial({ color: lin("#dfe6e8"), metalness: 1, roughness: 0.03, envMapIntensity: 1.2 }));
    const water = () => M("water", () => new THREE.MeshStandardMaterial({ color: lin("#1f8f94"), roughness: 0.06, metalness: 0, envMapIntensity: 0.35, emissive: lin("#0b4a4c"), emissiveIntensity: 0.55 }));
    const leaf = (hex) => M("leaf" + hex, () => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: 0.8, envMapIntensity: 0.3 }));

    // ---- geometry ----
    const geoCache = new Map();
    function roundedBox(w, h, d, r) {
      r = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
      const key = [w, h, d, r].map((v) => v.toFixed(3)).join(",");
      if (geoCache.has(key)) return geoCache.get(key);
      const n = 8, g = new THREE.BoxGeometry(1, 1, 1, n, n, n);
      const p = g.attributes.position, nr = g.attributes.normal;
      const half = [w / 2, h / 2, d / 2];
      const remap = (u, hf) => { const a = Math.abs(u) * 2, t = a <= 0.5 ? (a / 0.5) * (hf - r) : hf - r + ((a - 0.5) / 0.5) * r; return Math.sign(u) * t; };
      const v = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.set(remap(p.getX(i), half[0]), remap(p.getY(i), half[1]), remap(p.getZ(i), half[2]));
        c.set(Math.max(-half[0] + r, Math.min(half[0] - r, v.x)), Math.max(-half[1] + r, Math.min(half[1] - r, v.y)), Math.max(-half[2] + r, Math.min(half[2] - r, v.z)));
        nn.subVectors(v, c);
        if (nn.lengthSq() < 1e-12) nn.set(nr.getX(i), nr.getY(i), nr.getZ(i)); else nn.normalize();
        v.copy(c).addScaledVector(nn, r);
        p.setXYZ(i, v.x, v.y, v.z); nr.setXYZ(i, nn.x, nn.y, nn.z);
      }
      // keep the weave texture at a real-world scale
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d) * 1.5, uv.getY(i) * Math.max(h, d) * 1.5);
      geoCache.set(key, g);
      return g;
    }
    const mesh = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
    // RB: rounded box sitting on y (bottom), centred on x/z
    const RB = (p, w, h, d, r, mat, x = 0, y = 0, z = 0) => mesh(p, roundedBox(w, h, d, r), mat, x, y + h / 2, z);
    const CY = (p, rTop, rBot, h, mat, x = 0, y = 0, z = 0, seg = 32) => mesh(p, new THREE.CylinderGeometry(rTop, rBot, h, seg), mat, x, y + h / 2, z);
    const SP = (p, r, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = mesh(p, new THREE.SphereGeometry(r, 20, 14), mat, x, y, z); m.scale.set(sx, sy, sz); return m; };
    const leg = (p, x, z, h, mat, top = 0.022, bot = 0.016) => CY(p, top, bot, h, mat, x, 0, z, 12);
    const legs4 = (p, w, d, h, mat, inset = 0.07) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => leg(p, a * (w / 2 - inset), b * (d / 2 - inset), h, mat));

    const pillow = (p, x, y, z, hex, tilt = -0.28, size = 0.46) => {
      const m = RB(p, size, size, 0.15, 0.07, velvet(hex), x, y, z);
      m.scale.z = 0.9; m.rotation.x = tilt; m.rotation.z = (rnd() - 0.5) * 0.15;
      return m;
    };
    const lampTable = (p, x, z, y, base = "#5b4733") => {
      SP(p, 0.12, metal(base, 0.55), x, y + 0.13, z, 1, 1.1, 1);
      CY(p, 0.014, 0.014, 0.16, metal("#b08d57", 0.3), x, y + 0.24, z, 10);
      CY(p, 0.17, 0.21, 0.26, glow("#f4e8d2", "#f0c890", 0.9), x, y + 0.36, z);
    };

    const B = {
      rug(g, o) {
        const t = rugCircles(o.color || "#e8e2d7", o.line || "rgba(150,138,120,0.55)");
        const m = mesh(g, new THREE.PlaneGeometry(o.w || 3, o.d || 2.4), new THREE.MeshStandardMaterial({ map: t, roughness: 1, envMapIntensity: 0.2 }), 0, 0.006, 0);
        m.rotation.x = -Math.PI / 2; m.receiveShadow = true;
        return false;
      },
      sofa(g, o) {
        const L = o.len || 2.4, D = o.depth || 0.95, f = velvet(o.color || "#e6dfd2"), armW = 0.17;
        RB(g, L, 0.24, D, 0.03, f, 0, 0.1, 0);
        legs4(g, L, D, 0.1, wood(darkOak), 0.08);
        RB(g, L, 0.66, 0.2, 0.05, f, 0, 0.1, -D / 2 + 0.1);
        [-1, 1].forEach((sd) => RB(g, armW, 0.5, D, 0.06, f, sd * (L / 2 - armW / 2), 0.1, 0));
        const n = Math.max(1, Math.round((L - 2 * armW) / 0.8)), cw = (L - 2 * armW) / n;
        for (let i = 0; i < n; i++) {
          const x = -L / 2 + armW + cw * (i + 0.5);
          RB(g, cw - 0.012, 0.16, D - 0.24, 0.065, f, x, 0.33, 0.1);
          const b = RB(g, cw - 0.02, 0.4, 0.2, 0.08, f, x, 0.46, -D / 2 + 0.27); b.rotation.x = -0.14;
        }
        const acc = o.cushions || ["#8a7560", "#d8cdbd", "#5a4a3c"];
        const k = Math.min(4, n + 1);
        for (let i = 0; i < k; i++) pillow(g, -L / 2 + armW + 0.3 + (i * (L - 2 * armW - 0.6)) / Math.max(1, k - 1), 0.5, -D / 2 + 0.42, acc[i % acc.length]);
      },
      armchair(g, o) {
        // tub chair with a curved back, as in the reception photo
        const f = fabric(o.color || "#d7ccbb", 0.88), r = 0.4;
        const t0 = Math.PI * 0.42, tl = Math.PI * 1.16;   // back wraps round the rear, open at the front
        const back = mesh(g, new THREE.CylinderGeometry(r, r * 0.95, 0.5, 40, 1, true, t0, tl), f, 0, 0.62, 0);
        back.material = M("tubback" + (o.color || ""), () => { const m = f.clone(); m.side = THREE.DoubleSide; return m; });
        const rim = mesh(g, new THREE.TorusGeometry(r + 0.025, 0.045, 12, 40, tl), back.material, 0, 0.87, 0);
        rim.rotation.set(Math.PI / 2, 0, Math.PI / 2 - (t0 + tl));
        mesh(g, new THREE.CylinderGeometry(r + 0.05, r + 0.02, 0.5, 40, 1, true, t0, tl), back.material, 0, 0.62, 0);
        RB(g, 0.78, 0.2, 0.72, 0.06, f, 0, 0.2, 0.02);
        RB(g, 0.66, 0.13, 0.6, 0.06, f, 0, 0.4, 0.06);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => { const l = leg(g, a * 0.3, b * 0.28, 0.2, wood(darkOak)); l.rotation.z = a * 0.08; l.rotation.x = -b * 0.08; });
        if (o.cushion) pillow(g, 0, 0.55, -0.12, o.cushion, -0.2, 0.4);
      },
      ottoman(g, o) {
        const w = o.w || 1, d = o.d || 0.8, f = velvet(o.color || "#1f6b78");
        RB(g, w, 0.36, d, 0.07, f, 0, 0.06, 0);
        legs4(g, w, d, 0.06, wood(darkOak), 0.08);
        const btn = M("btn" + o.color, () => { const m = f.clone(); m.color.multiplyScalar(0.55); return m; });
        for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) SP(g, 0.016, btn, -w * 0.375 + (i * w * 0.75) / 3, 0.425, -d * 0.33 + (j * d * 0.66) / 2, 1, 0.5, 1);
      },
      sideboard(g, o) {
        const L = o.len || 2.2, lac = lacquer(o.color || "#1d4f86");
        RB(g, L, 0.7, 0.45, 0.012, lac, 0, 0.14, 0);
        [-1, 1].forEach((a) => [-1, 1].forEach((b) => RB(g, 0.06, 0.15, 0.06, 0.008, lac, a * (L / 2 - 0.05), 0, b * 0.18)));
        RB(g, L - 0.1, 0.03, 0.05, 0.01, lac, 0, 0.11, 0.2);
        const n = Math.max(2, Math.round(L / 0.55));
        for (let i = 1; i < n; i++) RB(g, 0.006, 0.62, 0.01, 0.002, matte("#0c2a48"), -L / 2 + (i * L) / n, 0.18, 0.226);
        const brass = metal("#c49a4c", 0.28);
        for (let i = 0; i < n; i += 2) {
          const x = -L / 2 + ((i + 1) * L) / n;
          const disc = mesh(g, new THREE.CylinderGeometry(0.075, 0.075, 0.012, 40), brass, x, 0.5, 0.232); disc.rotation.x = Math.PI / 2;
          const ring = mesh(g, new THREE.TorusGeometry(0.075, 0.006, 8, 40), brass, x, 0.5, 0.24);
        }
        const book = (w, h, d, hex, x, y, z, rz = 0) => { const m = RB(g, w, h, d, 0.004, matte(hex, 0.7), x, y, z); m.rotation.y = rz; };
        [["#e9e2d4", 0.05], ["#2c5f8a", 0.04], ["#c9452e", 0.035], ["#e9e2d4", 0.03]].reduce((y, [c, h]) => (book(0.34, h, 0.26, c, -L / 3, y, 0, 0.1), y + h), 0.84);
        [["#2b2b2b", 0.04], ["#e2d8c4", 0.05], ["#c9452e", 0.03]].reduce((y, [c, h]) => (book(0.36, h, 0.27, c, L / 3, y, 0, -0.06), y + h), 0.84);
      },
      coffeeRound(g, o) {
        const r = o.r || 0.55, gl = gloss("#1c1512");
        CY(g, r, r, 0.05, gl, 0, 0.38, 0, 48);
        CY(g, r * 0.9, r * 0.9, 0.025, gl, 0, 0.1, 0, 48);
        for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4; RB(g, 0.05, 0.28, 0.05, 0.01, gl, Math.cos(a) * r * 0.82, 0.1, Math.sin(a) * r * 0.82); }
        const brass = metal("#c9a55a", 0.22);
        CY(g, 0.22, 0.22, 0.012, brass, 0, 0.43, 0, 48);
        mesh(g, new THREE.TorusGeometry(0.22, 0.01, 8, 48), brass, 0, 0.45, 0).rotation.x = Math.PI / 2;
        [0, 1, 2].forEach((i) => RB(g, 0.3, 0.025 + i * 0.005, 0.22, 0.004, matte(["#7a1f3d", "#e7dfd2", "#b33a3a"][i], 0.7), 0.05, 0.13 + i * 0.03, 0));
      },
      coffee(g, o) {
        // rectangular coffee table: glossy top on a dark plinth, with a few books
        const w = o.w || 1.2, d = o.d || 0.6, gl = gloss("#1c1512");
        RB(g, w, 0.05, d, 0.012, gl, 0, 0.36, 0);
        RB(g, w - 0.12, 0.36, d - 0.12, 0.01, wood(darkOak, 0.45), 0, 0, 0);
        [0, 1].forEach((i) => RB(g, 0.3, 0.03 + i * 0.01, 0.22, 0.004, matte(["#e7dfd2", "#2d4a6a"][i], 0.7), -w / 4, 0.41 + i * 0.035, 0));
      },
      roundShelf(g, o) {
        const wd = wood(darkOak, 0.45), r = 0.3, h = 0.62;
        CY(g, r, r, 0.03, wd, 0, h - 0.03, 0, 40); CY(g, r, r, 0.03, wd, 0, 0, 0, 40); CY(g, r, r, 0.025, wd, 0, h / 2, 0, 40);
        const sides = mesh(g, new THREE.CylinderGeometry(r, r, h, 40, 1, true, 0.5, Math.PI - 1), M("rsh", () => { const m = wd.clone(); m.side = THREE.DoubleSide; return m; }), 0, h / 2, 0);
        mesh(g, new THREE.CylinderGeometry(r, r, h, 40, 1, true, Math.PI + 0.5, Math.PI - 1), sides.material, 0, h / 2, 0);
        CY(g, 0.05, 0.05, h, wd, 0, 0, 0, 16);
        const cols = ["#1f1f1f", "#e8e1d3", "#3a3a3a", "#c94a3a", "#e8e1d3", "#2d4a6a"];
        for (let i = 0; i < 6; i++) { const a = -0.5 + i * 0.2; RB(g, 0.035, 0.24, 0.17, 0.003, matte(cols[i], 0.7), Math.sin(a) * 0.18, 0.04, Math.cos(a) * 0.18).rotation.y = a; }
        // marble disc sculpture on a black base
        RB(g, 0.16, 0.05, 0.1, 0.005, matte("#111111", 0.4), 0, h, 0);
        const disc = mesh(g, new THREE.TorusGeometry(0.1, 0.075, 20, 48), stone(marble, 0.3), 0, h + 0.2, 0);
        disc.scale.set(1, 1, 0.38);
      },
      floorLamp(g) {
        const br = metal("#b08d57", 0.3);
        CY(g, 0.16, 0.17, 0.025, br); CY(g, 0.012, 0.012, 1.48, br, 0, 0.02, 0, 10);
        CY(g, 0.19, 0.24, 0.32, glow("#f4e8d2", "#f0c890", 0.9), 0, 1.36, 0);
      },
      table(g, o) {
        const w = o.w || 2.4, d = o.d || 1.0, wd = wood(midOak, 0.45);
        RB(g, w, 0.045, d, 0.012, wd, 0, 0.71, 0);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => leg(g, a * (w / 2 - 0.12), b * (d / 2 - 0.12), 0.71, wd, 0.035, 0.025));
        const n = o.chairs != null ? o.chairs : Math.max(1, Math.floor(w / 0.7));
        for (let i = 0; i < n; i++) {
          const x = -w / 2 + ((i + 0.5) * w) / n;
          [-1, 1].forEach((sd) => { const c = new THREE.Group(); c.position.set(x, 0, sd * (d / 2 + 0.28)); c.rotation.y = sd > 0 ? Math.PI : 0; B.chair(c, o); g.add(c); });
        }
        if (o.pendants) for (let i = 0; i < o.pendants; i++) {
          const x = -w / 2 + ((i + 0.5) * w) / o.pendants;
          CY(g, 0.004, 0.004, 0.62, matte("#222"), x, 2.1, 0, 6);
          CY(g, 0.035, 0.035, 0.05, metal("#b08d57", 0.3), x, 2.07, 0, 16);
          SP(g, 0.13, glow("#fbf2df", "#f1cf93", 1.1), x, 1.95, 0);
        }
      },
      chair(g, o) {
        const f = fabric((o && o.chairColor) || "#d9cfbf", 0.85), wd = wood(darkOak);
        RB(g, 0.47, 0.09, 0.47, 0.035, f, 0, 0.43, 0);
        // backrest at the back (-z), so the chair faces +z like every other piece (rot 0 faces down the plan)
        const bk = RB(g, 0.45, 0.48, 0.07, 0.03, f, 0, 0.5, -0.21); bk.rotation.x = -0.08;
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => leg(g, a * 0.2, b * 0.2, 0.43, wd, 0.018, 0.013));
      },
      roundTable(g, o) {
        const r = o.r || 0.5;
        CY(g, r, r, 0.03, stone(marble, 0.35), 0, 0.72, 0, 40); CY(g, 0.04, 0.04, 0.72, metal("#2f2f2d", 0.5), 0, 0, 0, 12); CY(g, 0.24, 0.26, 0.02, metal("#2f2f2d", 0.5));
        for (let i = 0; i < (o.chairs || 4); i++) {
          const a = (i / (o.chairs || 4)) * Math.PI * 2, c = new THREE.Group();
          c.position.set(Math.sin(a) * (r + 0.36), 0, Math.cos(a) * (r + 0.36)); c.rotation.y = a + Math.PI;
          B.chair(c, { chairColor: o.chairColor || "#59544c" }); g.add(c);
        }
      },
      bed(g, o) {
        const w = o.w || 1.8, l = o.l || 2.1, uph = velvet(o.color || "#b7aa94");
        RB(g, w, 0.32, l, 0.04, uph, 0, 0.06, 0);
        legs4(g, w, l, 0.06, wood(darkOak), 0.1);
        RB(g, w - 0.04, 0.24, l - 0.08, 0.06, matte("#fbfaf7", 0.95), 0, 0.38, 0.03);
        RB(g, w + 0.06, 0.07, l - 0.5, 0.035, fabric("#ffffff", 0.95), 0, 0.6, 0.27);
        const hb = RB(g, w + 0.16, 1.32, 0.12, 0.06, uph, 0, 0.06, -l / 2 + 0.02);
        [-1, 1].forEach((sd) => { const pl = RB(g, w / 2 - 0.1, 0.18, 0.5, 0.08, matte("#f7f6f2", 0.95), sd * (w / 4), 0.6, -l / 2 + 0.35); pl.rotation.x = -0.15; });
        [-1, 1].forEach((sd) => { const pl = RB(g, w / 2 - 0.16, 0.42, 0.13, 0.06, matte("#f1eee7", 0.95), sd * (w / 4), 0.64, -l / 2 + 0.52); pl.rotation.x = -0.3; });
        [-0.32, 0, 0.32].forEach((x, i) => pillow(g, x, 0.66, -l / 2 + 0.7, i === 1 ? "#f0ece4" : (o.accent || "#6b5038"), -0.35, 0.4));
        RB(g, w + 0.1, 0.035, 0.6, 0.015, fabric(o.throw || "#cbbfa8", 0.9), 0, 0.66, l / 2 - 0.42);
      },
      nightstand(g, o) {
        const lac = gloss(o.color || "#15100d"), br = metal("#b08d57", 0.3);
        RB(g, 0.62, 0.5, 0.44, 0.01, lac, 0, 0.06, 0);
        legs4(g, 0.62, 0.44, 0.06, lac, 0.04);
        [0.2, 0.38].forEach((y) => RB(g, 0.32, 0.018, 0.02, 0.008, br, 0, 0.06 + y, 0.225));
        lampTable(g, 0, -0.04, 0.56);
      },
      bench(g, o) {
        const L = o.len || 1.5;
        RB(g, L, 0.14, 0.46, 0.05, velvet("#d8cdb9"), 0, 0.33, 0);
        [-1, 1].forEach((a) => [-1, 1].forEach((b) => { const l = leg(g, a * (L / 2 - 0.08), b * 0.16, 0.34, wood(darkOak), 0.02, 0.014); l.rotation.z = a * 0.1; }));
      },
      dresser(g, o) {
        const L = o.len || 1.4, wd = wood(darkOak, 0.4), br = metal("#b08d57", 0.3);
        RB(g, L, 0.78, 0.5, 0.01, wd, 0, 0.05, 0);
        legs4(g, L, 0.5, 0.05, wd, 0.05);
        [0.25, 0.5].forEach((y) => { RB(g, L - 0.04, 0.005, 0.01, 0.002, matte("#1a120c"), 0, 0.05 + y, 0.252); RB(g, 0.3, 0.018, 0.02, 0.008, br, 0, 0.05 + y + 0.12, 0.255); });
      },
      wardrobe(g, o) {
        const L = o.len || 2, lac = lacquer("#ece6dc"), n = Math.round(L / 0.6);
        RB(g, L, 2.45, 0.62, 0.01, lac, 0, 0, 0);
        for (let i = 1; i < n; i++) RB(g, 0.005, 2.35, 0.01, 0.002, matte("#bdb4a6"), -L / 2 + (i * L) / n, 0.05, 0.312);
        for (let i = 0; i < n; i++) RB(g, 0.018, 0.5, 0.025, 0.008, metal("#b08d57", 0.3), -L / 2 + ((i + (i % 2 ? 0.1 : 0.9)) * L) / n, 0.95, 0.32);
      },
      bath(g, o) {
        const L = o.len || 1.7, W = o.w || 0.8, tr = stone(travertine, 0.35), cer = ceramic(), wall = 0.07;
        RB(g, L + 0.12, 0.52, W + 0.12, 0.01, tr, 0, 0, 0);
        RB(g, L, 0.06, wall, 0.03, cer, 0, 0.5, -W / 2 + wall / 2); RB(g, L, 0.06, wall, 0.03, cer, 0, 0.5, W / 2 - wall / 2);
        RB(g, wall, 0.06, W, 0.03, cer, -L / 2 + wall / 2, 0.5, 0); RB(g, wall, 0.06, W, 0.03, cer, L / 2 - wall / 2, 0.5, 0);
        RB(g, L - 2 * wall, 0.02, W - 2 * wall, 0.01, cer, 0, 0.18, 0);
        const ch = metal("#d8d8d8", 0.12);
        CY(g, 0.02, 0.02, 0.18, ch, L / 2 - 0.25, 0.55, -W / 2 + 0.03, 12);
        const sp = CY(g, 0.016, 0.016, 0.16, ch, L / 2 - 0.25, 0.7, -W / 2 + 0.1, 12); sp.rotation.x = Math.PI / 2;
        RB(g, 0.32, 0.06, 0.2, 0.02, fabric("#ffffff", 1), -L / 2 + 0.3, 0.56, -W / 2 + 0.16);
      },
      vanity(g, o) {
        const L = o.len || 1.6, n = o.basins || 2, wd = wood(darkOak, 0.45), tr = stone(travertine, 0.3), cer = ceramic();
        RB(g, L, 0.45, 0.48, 0.01, wd, 0, 0.35, 0);
        RB(g, L + 0.04, 0.1, 0.52, 0.01, tr, 0, 0.8, 0);
        for (let i = 0; i < n; i++) {
          const x = -L / 2 + ((i + 0.5) * L) / n;
          RB(g, 0.44, 0.012, 0.32, 0.03, cer, x, 0.9, 0.02);
          RB(g, 0.36, 0.01, 0.24, 0.02, matte("#d9d6cf", 0.4), x, 0.902, 0.02);
          const ch = metal("#d8d8d8", 0.12);
          CY(g, 0.016, 0.016, 0.2, ch, x, 0.9, -0.2, 12);
          const sp = CY(g, 0.012, 0.012, 0.13, ch, x, 1.08, -0.16, 12); sp.rotation.x = Math.PI / 2;
        }
        RB(g, L - 0.12, 0.8, 0.12, 0.01, wd, 0, 1.15, -0.2);
        RB(g, L - 0.22, 0.72, 0.01, 0.002, mirror(), 0, 1.19, -0.137);
        [-1, 1].forEach((sd) => RB(g, 0.035, 0.72, 0.02, 0.01, glow("#fff6e4", "#f6dfb4", 1.2), sd * (L / 2 - 0.09), 1.19, -0.13));
      },
      // a walk-in shower: low white tray, a clear glass screen along its open side, a ceiling-height riser and head
      shower(g, o) {
        const W = o.w || 0.9, D = o.d || 0.9, cer = ceramic(), chrome = metal("#d8d8d8", 0.12);
        RB(g, W, 0.06, D, 0.02, cer, 0, 0, 0);
        const glass = M("sglass", () => new THREE.MeshPhysicalMaterial({ color: lin("#dfeaee"), roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1 }));
        RB(g, W * 0.75, 1.95, 0.012, 0.004, glass, -W * 0.125, 0.06, D / 2 - 0.02);
        RB(g, 0.02, 1.95, 0.02, 0.005, chrome, W / 2 * 0.5 + 0.01, 0.06, D / 2 - 0.02);
        RB(g, 0.025, 1.5, 0.025, 0.01, chrome, 0, 0.7, -D / 2 + 0.05);
        CY(g, 0.11, 0.11, 0.012, chrome, 0, 2.15, -D / 2 + 0.2, 24);
        RB(g, 0.02, 0.02, 0.18, 0.005, chrome, 0, 2.16, -D / 2 + 0.1);
        CY(g, 0.035, 0.035, 0.004, metal("#111", 0.6), 0, 0.062, 0, 16);   // drain
        return false;   // you can walk into a shower
      },
      wc(g) {
        const cer = ceramic();
        RB(g, 0.38, 0.32, 0.55, 0.12, cer, 0, 0.3, 0.05);
        RB(g, 0.36, 0.035, 0.46, 0.1, cer, 0, 0.62, 0.07);
        RB(g, 0.6, 1.0, 0.18, 0.01, stone(travertine, 0.35), 0, 0, -0.27);
        RB(g, 0.2, 0.1, 0.02, 0.01, metal("#d8d8d8", 0.15), 0, 0.92, -0.17);
      },
      tv(g, o) {
        const wd = wood(darkOak, 0.45);
        RB(g, 2.1, 1.3, 0.08, 0.01, wd, 0, 0.72, 0);
        RB(g, 1.62, 0.92, 0.035, 0.008, gloss("#07080a"), 0, 0.92, 0.055);
        RB(g, 1.3, 0.07, 0.07, 0.02, matte("#1b1b1b", 0.6), 0, 0.8, 0.07);
        return false;
      },
      shelving(g, o) {
        const L = o.len || 2.6, Hh = o.h || 2.45, Dd = o.depth || 0.42, wd = wood(darkOak, 0.45), wb = wood(midOak, 0.5);
        RB(g, L, Hh, 0.03, 0.005, wd, 0, 0, -Dd / 2 + 0.015);
        [-1, 1].forEach((sd) => RB(g, 0.045, Hh, Dd, 0.005, wd, sd * (L / 2 - 0.022), 0, 0));
        RB(g, L, 0.82, Dd, 0.005, wd, 0, 0, 0);
        for (let i = 1; i < 3; i++) RB(g, 0.005, 0.76, 0.01, 0.002, matte("#1a120c"), -L / 2 + (i * L) / 3, 0.03, Dd / 2 + 0.002);
        const k = 4;
        for (let i = 1; i <= k; i++) RB(g, L - 0.09, 0.035, Dd - 0.03, 0.004, wd, 0, 0.82 + (i * (Hh - 0.85)) / (k + 0.4), 0.01);
        RB(g, L - 0.09, Hh - 0.86, 0.01, 0.002, wb, 0, 0.84, -Dd / 2 + 0.035);
        const decor = [["book", "#e8e1d3"], ["vase", "#efeae0"], ["book", "#7a2b24"], ["bowl", "#3b2f27"], ["book", "#2d4a6a"], ["vase", "#d8d2c6"]];
        for (let i = 0; i < k; i++) for (let j = 0; j < 3; j++) {
          const [kind, hex] = decor[(i * 3 + j) % decor.length];
          const x = -L / 2 + ((j + 0.5) * L) / 3, y = 0.82 + (i * (Hh - 0.85)) / (k + 0.4) + 0.035;
          if (kind === "book") for (let b = 0; b < 5; b++) RB(g, 0.035, 0.24 + (b % 3) * 0.02, 0.2, 0.003, matte(b % 2 ? hex : "#d7cfc0", 0.7), x - 0.12 + b * 0.04, y, 0);
          else if (kind === "vase") { SP(g, 0.08, ceramic(), x, y + 0.11, 0, 1, 1.4, 1); }
          else CY(g, 0.12, 0.06, 0.06, matte(hex, 0.5), x, y, 0);
        }
      },
      bookcase(g, o) { B.shelving(g, { len: o.len || 2.2, h: 2.2, depth: 0.35 }); },
      desk(g, o) {
        const w = o.w || 1.6, wd = wood(darkOak, 0.4);
        RB(g, w, 0.04, 0.75, 0.01, wd, 0, 0.72, 0);
        [-1, 1].forEach((sd) => RB(g, 0.05, 0.72, 0.7, 0.01, wd, sd * (w / 2 - 0.03), 0, 0));
        RB(g, 0.45, 0.012, 0.3, 0.005, matte("#2a2a2a", 0.5), -0.2, 0.76, -0.05);
        lampTable(g, w / 2 - 0.25, -0.22, 0.76);
        const c = new THREE.Group(); c.position.set(0, 0, 0.6); c.rotation.y = Math.PI; B.chair(c, { chairColor: "#5a4a3c" }); g.add(c);
      },
      island(g, o) {
        const w = o.w || 1.3, d = o.d || 2.4;
        RB(g, w - 0.08, 0.86, d - 0.08, 0.01, lacquer("#3c3a37"), 0, 0, 0);
        RB(g, w, 0.04, d, 0.008, stone(marble, 0.2), 0, 0.86, 0);
        for (let i = 0; i < 3; i++) { const st = new THREE.Group(); st.position.set(w / 2 + 0.32, 0, -d / 3 + (i * d) / 3); st.rotation.y = -Math.PI / 2;
          RB(st, 0.4, 0.06, 0.4, 0.03, fabric("#cfc4b2", 0.8), 0, 0.68, 0); CY(st, 0.02, 0.02, 0.68, metal("#b08d57", 0.3), 0, 0, 0, 10); CY(st, 0.18, 0.2, 0.015, metal("#b08d57", 0.3)); g.add(st); }
      },
      counter(g, o) {
        const L = o.len || 3, D = o.depth || 0.65, lac = lacquer("#efebe5");
        RB(g, L, 0.82, D, 0.006, lac, 0, 0.06, 0);
        RB(g, L, 0.06, D - 0.06, 0.005, matte("#2a2724", 0.6), 0, 0, -0.03);
        RB(g, L + 0.02, 0.035, D + 0.02, 0.006, stone(marble, 0.2), 0, 0.88, 0);
        RB(g, L, 0.62, 0.01, 0.002, stone(marble, 0.25), 0, 0.915, -D / 2 + 0.005);
        RB(g, L, 0.72, 0.36, 0.006, lac, 0, 1.55, -D / 2 + 0.18);
        const n = Math.round(L / 0.6);
        for (let i = 1; i < n; i++) { RB(g, 0.004, 0.78, 0.005, 0.001, matte("#cfc8bd"), -L / 2 + (i * L) / n, 0.08, D / 2 + 0.002); RB(g, 0.004, 0.7, 0.005, 0.001, matte("#cfc8bd"), -L / 2 + (i * L) / n, 1.56, -D / 2 + 0.362); }
        if (o.hob) RB(g, 0.62, 0.006, 0.5, 0.01, gloss("#090909"), 0, 0.915, 0.02);
        if (o.sink !== false) { RB(g, 0.55, 0.004, 0.4, 0.02, metal("#bdbdbd", 0.25), o.hob ? L / 3 : 0, 0.917, 0.04); CY(g, 0.015, 0.015, 0.3, metal("#d8d8d8", 0.15), o.hob ? L / 3 : 0, 0.915, -0.22, 10); }
      },
      hottub(g, o) {
        const w = o.w || 2.2;
        RB(g, w, 0.9, w, 0.14, M("acr", () => new THREE.MeshPhysicalMaterial({ color: lin("#d9dad8"), roughness: 0.2, clearcoat: 1 })), 0, 0, 0);
        RB(g, w - 0.3, 0.02, w - 0.3, 0.08, water(), 0, 0.885, 0);
        RB(g, w + 0.04, 0.12, w + 0.04, 0.03, matte("#6c6c6a", 0.6), 0, 0, 0);
        return true;
      },
      planter(g, o) {
        const L = o.len || 3, W = o.w || 0.5;
        RB(g, L, 0.55, W, 0.01, metal("#5a4636", 0.6), 0, 0, 0);
        const n = Math.max(1, Math.round(L / 0.38));
        for (let i = 0; i < n; i++) {
          const x = -L / 2 + ((i + 0.5) * L) / n;
          SP(g, 0.22, leaf(i % 3 === 1 ? "#3f6431" : "#4f7a3c"), x, 0.72, (rnd() - 0.5) * 0.08, 1, 0.85, 1);
          SP(g, 0.13, leaf("#5d8a45"), x + 0.1, 0.84, 0.05);
          if (i % 2 === 0) for (let k = 0; k < 4; k++) CY(g, 0.012, 0.016, 0.16, matte("#6c5aa8", 0.8), x - 0.08 + k * 0.05, 0.86, 0.12, 8);
        }
      },
      lounger(g) {
        const wd = wood(midOak, 0.6);
        RB(g, 0.7, 0.06, 1.95, 0.01, wd, 0, 0.28, 0); legs4(g, 0.7, 1.9, 0.28, wd, 0.06);
        RB(g, 0.66, 0.08, 1.3, 0.04, fabric("#ecebe6", 0.9), 0, 0.34, 0.3);
        const bk = RB(g, 0.66, 0.08, 0.7, 0.04, fabric("#ecebe6", 0.9), 0, 0.5, -0.62); bk.rotation.x = 0.7;
      },
      plant(g) {
        CY(g, 0.2, 0.16, 0.42, ceramic());
        for (let k = 0; k < 9; k++) SP(g, 0.13 + rnd() * 0.08, leaf(["#4f7a3c", "#3f6431", "#6a9450"][k % 3]), (rnd() - 0.5) * 0.35, 0.65 + rnd() * 0.55, (rnd() - 0.5) * 0.35, 1, 1.2, 1);
      },
      console(g, o) {
        const L = o.len || 1.6, wd = wood(darkOak, 0.4);
        RB(g, L, 0.05, 0.38, 0.01, wd, 0, 0.78, 0);
        [-1, 1].forEach((sd) => RB(g, 0.05, 0.78, 0.34, 0.01, wd, sd * (L / 2 - 0.04), 0, 0));
        RB(g, L - 0.1, 0.03, 0.32, 0.008, wd, 0, 0.15, 0);
        RB(g, 0.95, 1.0, 0.03, 0.01, metal("#b08d57", 0.3), 0, 1.15, -0.17);
        RB(g, 0.87, 0.92, 0.01, 0.003, mirror(), 0, 1.19, -0.152);
        SP(g, 0.1, ceramic(), L / 3, 0.97, 0, 1, 1.5, 1);
        return true;
      },
      art(g, o) {
        const w = o.w || 0.6, h = o.h || 0.75, y = o.elev || 1.5;
        RB(g, w + 0.06, h + 0.06, 0.035, 0.004, matte(o.frame || "#16120f", 0.5), 0, y - h / 2 - 0.03, 0.0175);
        const tex = new THREE.Texture(); tex.encoding = THREE.sRGBEncoding;
        const pic = mesh(g, new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, envMapIntensity: 0.3 }), 0, y, 0.036);
        T.loadImage(o.src).then((img) => { tex.image = img; tex.needsUpdate = true; }).catch(() => (pic.material.color = lin("#d8d2c6")));
        return false;
      },
    };

    // soft contact shadow under each solid piece
    const blob = canvasTex(128, 128, (g2, w, h) => {
      const grd = g2.createRadialGradient(64, 64, 8, 64, 64, 64);
      grd.addColorStop(0, "rgba(0,0,0,0.55)"); grd.addColorStop(0.6, "rgba(0,0,0,0.22)"); grd.addColorStop(1, "rgba(0,0,0,0)");
      g2.fillStyle = grd; g2.fillRect(0, 0, w, h);
    });
    const blobMat = new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, opacity: 0.55, toneMapped: false });

    // one node per item: node sits at the item's spot, its first child is the rotated piece, then its contact shadow
    function makeNode(it) {
      const make = B[it.type];
      if (!make) return null;
      const node = new THREE.Group(), g = new THREE.Group();
      const solid = make(g, it) !== false;
      const elev = it.elev && it.type !== "art" ? it.elev : 0;
      g.rotation.y = ((it.rot || 0) * Math.PI) / 180;
      g.traverse((m) => {
        if (!m.isMesh) return;
        const em = m.material && m.material.emissive && m.material.emissiveIntensity > 0.5;
        m.castShadow = !em; m.receiveShadow = true;
      });
      node.add(g);
      node.userData = { item: it, solid };
      if (solid) {
        node.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(g);
        const sz = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
        const sh = new THREE.Mesh(new THREE.PlaneGeometry(sz.x + 0.35, sz.z + 0.35), blobMat);
        sh.rotation.x = -Math.PI / 2; sh.position.set(ctr.x, 0.004 - elev, ctr.z); sh.renderOrder = 1;
        node.add(sh);
      }
      node.position.set(it.x * s, elev, it.y * s);
      return node;
    }
    // plan cells covered by solid pieces
    function blockedFrom(nodes) {
      const b = new Uint8Array(GW * GH), bb = new THREE.Box3();
      for (const node of nodes) {
        if (!node.userData.solid) continue;
        node.updateMatrixWorld(true);
        bb.setFromObject(node.children[0]);
        const x0 = Math.floor(bb.min.x / cs), x1 = Math.floor(bb.max.x / cs), z0 = Math.floor(bb.min.z / cs), z1 = Math.floor(bb.max.z / cs);
        for (let z = Math.max(0, z0); z <= Math.min(GH - 1, z1); z++)
          for (let x = Math.max(0, x0); x <= Math.min(GW - 1, x1); x++) b[z * GW + x] = 1;
      }
      return b;
    }
    const nodes = [];
    for (const it of P.furnishing || []) {
      const node = makeNode(it);
      if (node) { group.add(node); nodes.push(node); }
    }
    blocked.set(blockedFrom(nodes));
    // live: keep every piece separate so it can be picked and moved (more draw calls, used while arranging)
    if (opts.live) return { group, blocked, nodes, makeNode, blockedFrom };
    // merge every part that shares a material into one mesh: same look, far fewer draw calls
    group.updateMatrixWorld(true);
    const byMat = new Map();
    group.traverse((m) => {
      if (!m.isMesh) return;
      const key = m.material.uuid + (m.castShadow ? "c" : "n");
      if (!byMat.has(key)) byMat.set(key, { mat: m.material, cast: m.castShadow, parts: [] });
      byMat.get(key).parts.push(m);
    });
    const merged = new THREE.Group();
    byMat.forEach(({ mat, cast, parts }) => {
      let nv = 0, ni = 0;
      const geos = parts.map((m) => {
        let g = m.geometry;
        if (!g.index) g = g.clone(), g.setIndex([...Array(g.attributes.position.count).keys()]);
        nv += g.attributes.position.count; ni += g.index.count;
        return { g, mw: m.matrixWorld };
      });
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
      const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      const v = new THREE.Vector3(), nm = new THREE.Matrix3();
      let vo = 0, io = 0;
      for (const { g, mw } of geos) {
        nm.getNormalMatrix(mw);
        const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, I = g.index;
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(mw); pos.set([v.x, v.y, v.z], (vo + i) * 3);
          if (N) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (vo + i) * 3); }
          if (U) uv.set([U.getX(i), U.getY(i)], (vo + i) * 2);
        }
        for (let k = 0; k < I.count; k++) idx[io + k] = I.getX(k) + vo;
        vo += P.count; io += I.count;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      const mm = new THREE.Mesh(g, mat);
      mm.castShadow = cast; mm.receiveShadow = !mat.transparent;
      if (mat === blobMat) mm.renderOrder = 1;
      merged.add(mm);
    });
    return { group: merged, blocked };
  };
})();
