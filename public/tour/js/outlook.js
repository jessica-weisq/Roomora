/* The view out of the windows in the 3D walk, from Google Street View.
   Finds the nearest outdoor Street View panorama to the property, fetches it as six square pictures from the
   Street View Static API (north, east, south, west, up, down) and hangs them as a box around the flat, so the
   windows look out onto the real street instead of the drawn park and skyline.

   Where it looks, in order: property.outlook {lat, lng} or {address}, then property.location {lat, lng},
   then property.streetAddress (geocoded). property.north is the compass bearing of "up" on the floor plan
   in degrees (default 0: up is north); set it if the plan is drawn turned.

   Needs the Maps key (config.js, or VITE_GOOGLE_MAPS_KEY on the Veduta website) with the Maps JavaScript API,
   Street View Static API and Geocoding API enabled. With no key, no coverage, or any failure, the drawn
   scenery stays. The panorama is taken at street level, so from upper floors the view sits lower than it
   really would. Google's terms need the imagery credited, so a "Google Street View" note shows while it's used. */
(function () {
  const T = window.Tour;
  const FACES = [[0, 0], [90, 0], [180, 0], [270, 0], [0, 90], [0, -90]];   // [heading, pitch]
  const SIZE = 300;                                                           // metres across the box

  const readKey = () => {
    const cfg = window.TOUR_CONFIG || {};
    const k = ((T.embedConfig && T.embedConfig.mapsKey) || cfg.MAPS_API_KEY || cfg.googleMapsApiKey || "").trim();
    return k && !/^YOUR_|^REPLACE/i.test(k) ? k : null;
  };
  const whenExterior = () => new Promise((resolve) => {
    if (window.TourExterior) return resolve(window.TourExterior);
    let tries = 0;
    const t = setInterval(() => { if (window.TourExterior || ++tries > 100) { clearInterval(t); resolve(window.TourExterior || null); } }, 50);
  });
  const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms))]);
  const plain = (ll) => (ll ? (typeof ll.lat === "function" ? { lat: ll.lat(), lng: ll.lng() } : { lat: ll.lat, lng: ll.lng }) : null);
  const num = (v) => typeof v === "number" && isFinite(v);

  function geocode(libs, address) {
    return withTimeout(new Promise((resolve, reject) => {
      new libs.Geocoder().geocode({ address }, (res, status) => (status === "OK" && res && res[0] ? resolve(plain(res[0].geometry.location)) : reject(new Error("geocode-" + status))));
    }), 10000, "geocode-timeout");
  }
  function nearestPano(libs, location, radius) {
    const req = { location, radius };
    if (libs.StreetViewPreference) req.preference = libs.StreetViewPreference.NEAREST;
    if (libs.StreetViewSource) req.sources = [libs.StreetViewSource.OUTDOOR];
    return withTimeout(new Promise((resolve, reject) => {
      new libs.StreetViewService().getPanorama(req, (data, status) => {
        const ok = libs.StreetViewStatus ? libs.StreetViewStatus.OK : "OK";
        if (status === ok && data && data.location) resolve(data); else reject(new Error("no-coverage"));
      });
    }), 10000, "coverage-timeout");
  }
  async function locate(P, key) {
    const X = await whenExterior();
    if (!X || !X.loadMaps) throw new Error("maps-module-missing");
    const libs = await X.loadMaps(key);
    const o = P.outlook || {}, loc = P.location || {};
    let where = num(o.lat) && num(o.lng) ? { lat: o.lat, lng: o.lng } : num(loc.lat) && num(loc.lng) ? { lat: loc.lat, lng: loc.lng } : null;
    if (!where) {
      const address = o.address || P.streetAddress || "";
      if (!address || !libs.Geocoder) throw new Error("no-location");
      where = await geocode(libs, address);
    }
    for (const radius of [60, 200, 600]) {
      try {
        const d = await nearestPano(libs, where, radius);
        return { pano: d.location.pano, at: plain(d.location.latLng), date: d.imageDate || "" };
      } catch (e) { /* try further out */ }
    }
    throw new Error("no-coverage");
  }
  const faceUrl = (pano, heading, pitch, key) => "https://maps.googleapis.com/maps/api/streetview?" +
    new URLSearchParams({ size: "640x640", pano, heading: String(heading), pitch: String(pitch), fov: "90", return_error_code: "true", key });
  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";   // needed to use it as a texture
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image-failed"));
    img.src = src;
  });

  // one lookup and one set of pictures per page: the walk is rebuilt whenever furniture or plans change
  let cached = null, cachedFor = "";
  function fetchView(P, key) {
    const id = key + "|" + JSON.stringify([P.outlook || null, P.location || null, P.streetAddress || ""]);
    if (!cached || cachedFor !== id) {
      cachedFor = id;
      cached = locate(P, key).then(async (pano) => ({ pano, images: await Promise.all(FACES.map(([h, p]) => loadImage(faceUrl(pano.pano, h, p, key)))) }));
      cached.catch(() => { cached = null; cachedFor = ""; });
    }
    return cached;
  }

  T.Outlook = {
    attach(o) {
      const { THREE, scene, root, P, alive, drawn } = o;
      const none = { update() {} };
      const key = readKey();
      if (!key || location.protocol === "file:") return none;

      const box = new THREE.Group(); box.visible = false; scene.add(box);
      const north = num(P.north) ? P.north : 0;
      let ready = false, useReal = true;
      try { useReal = localStorage.getItem("tour-outlook") !== "drawn"; } catch (e) {}

      // credit and a switch back to the drawn view
      const chip = document.createElement("div"); chip.className = "w3-outlook"; chip.hidden = true;
      const label = document.createElement("span");
      const btn = document.createElement("button"); btn.type = "button";
      chip.append(label, btn);
      const style = root.querySelector(".w3-style");
      if (style) style.appendChild(chip);
      function apply() {
        const real = ready && useReal;
        box.visible = real;
        drawn.forEach((m) => m && (m.visible = !real));
        label.textContent = real ? "Window view: Google Street View" : "Window view: drawn";
        btn.textContent = real ? "Use drawn view" : "Use Street View";
      }
      btn.addEventListener("click", () => {
        useReal = !useReal; apply();
        try { localStorage.setItem("tour-outlook", useReal ? "street" : "drawn"); } catch (e) {}
      });

      fetchView(P, key).then(({ pano, images }) => {
        if (!alive()) return;
        images.forEach((img, i) => {
          const [heading, pitch] = FACES[i];
          const tex = new THREE.Texture(img);
          tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4; tex.needsUpdate = true;
          const face = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE),
            new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, depthTest: false, fog: false, toneMapped: false }));
          face.renderOrder = -2; face.frustumCulled = false;
          // a plane faces +z with its right edge along +x; the walk has north up the plan (-z) and east to the right (+x)
          const a = ((heading - north) * Math.PI) / 180;
          face.rotation.order = "YXZ";
          face.rotation.y = -a;
          if (pitch === 0) face.position.set(Math.sin(a) * SIZE / 2, 0, -Math.cos(a) * SIZE / 2);
          else { face.rotation.x = pitch > 0 ? Math.PI / 2 : -Math.PI / 2; face.position.set(0, (pitch > 0 ? 1 : -1) * SIZE / 2, 0); }
          box.add(face);
        });
        ready = true; chip.hidden = false;
        chip.title = "Street View panorama" + (pano.date ? ` from ${pano.date}` : "") + ", taken at street level. Imagery © Google.";
        apply();
      }).catch((e) => console.info("Window view: keeping the drawn scenery (" + e.message + ")"));

      return { update(pos) { if (box.visible) box.position.copy(pos); } };
    },
  };
})();
