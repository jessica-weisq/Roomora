/* Track C: Street View outside the property. Loads Google Maps only when first shown. Falls back cleanly without a key. */
(function () {
  const T = window.Tour;

  function loadGoogle(key) {
    if (window.google && window.google.maps) return Promise.resolve();
    return new Promise((resolve, reject) => {
      window.__tourMapsReady = resolve;
      window.gm_authFailure = () => T.emit("tour:street-auth-failed");
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=geometry&callback=__tourMapsReady`;
      s.async = true;
      s.onerror = () => reject(new Error("load"));
      document.head.appendChild(s);
    });
  }

  T.StreetView = {
    mount(root, P) {
      root.classList.add("sv");
      root.innerHTML = `
        <div class="sv-pano"></div>
        <div class="sv-fallback" hidden>
          <h2 class="sv-fb-title"></h2>
          <p class="sv-fb-text"></p>
          <a class="sv-fb-link" target="_blank" rel="noopener">Open Street View in Google Maps</a>
        </div>
        <button type="button" class="sv-enter">Go inside</button>`;
      const panoEl = root.querySelector(".sv-pano");
      const fb = root.querySelector(".sv-fallback");
      const { lat, lng } = P.location;
      root.querySelector(".sv-fb-link").href =
        `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
      root.querySelector(".sv-enter").addEventListener("click", () => T.emit("tour:room", { roomId: P.entryRoom }));

      let started = false;
      function fallback(title, text) {
        panoEl.hidden = true;
        if (P.exteriorPhoto) { fb.classList.add("has-photo"); fb.style.setProperty("--exterior", `url("${P.exteriorPhoto}")`); }
        fb.hidden = false;
        fb.querySelector(".sv-fb-title").textContent = title;
        fb.querySelector(".sv-fb-text").textContent = text;
      }
      T.on("tour:street-auth-failed", () =>
        fallback("Google rejected the API key", "Check the key in config.js, that the Maps JavaScript API is enabled for it, and that this page’s address is in its allowed websites."));

      async function start() {
        started = true;
        const key = (window.TOUR_CONFIG || {}).googleMapsApiKey;
        if (location.protocol === "file:")
          return fallback("Street View needs the tour on a web address", "Google only shows Street View to pages opened from a web address, not a file on your computer. Use the hosted link, or run the local server described in README.md.");
        if (!key) return fallback("Street View needs a Google Maps key", "Add your key to config.js and reload. Until then, you can open this spot in Google Maps.");
        try {
          await loadGoogle(key);
        } catch (e) {
          return fallback("Google Maps didn’t load", "This page couldn’t reach Google. Run the tour from your own computer or website (see README) rather than a preview.");
        }
        const g = window.google.maps;
        const house = new g.LatLng(lat, lng);
        const svc = new g.StreetViewService();
        svc.getPanorama({ location: house, radius: 60, preference: g.StreetViewPreference.NEAREST, sources: [g.StreetViewSource.OUTDOOR] }, (data, status) => {
          if (status !== g.StreetViewStatus.OK) {
            panoEl.hidden = false;
            const map = new g.Map(panoEl, { center: house, zoom: 18, mapTypeId: "hybrid", streetViewControl: false });
            new g.Marker({ position: house, map, title: P.address });
            return;
          }
          const from = data.location.latLng;
          const heading = P.location.heading != null ? P.location.heading : g.geometry.spherical.computeHeading(from, house);
          new g.StreetViewPanorama(panoEl, {
            pano: data.location.pano,
            pov: { heading, pitch: P.location.pitch || 5 },
            zoom: 0,
            addressControl: false,
            fullscreenControl: false,
            motionTracking: false,
            motionTrackingControl: false,
          });
        });
      }

      T.on("tour:outside", () => { if (!started) start(); });
    },
  };
})();
