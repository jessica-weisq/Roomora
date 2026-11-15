/* Street view for the tour, using Track C's exterior module (exterior/exterior.js):
   Street View facing the house, falling back to a static map and then the front photo.
   Its "Enter the house" button sends tour:room, which the rest of the tour already listens for. */
(function () {
  const T = window.Tour;

  // exterior.js is an ES module (loaded with type="module"), so it can arrive after this script runs
  const whenExterior = () => new Promise((resolve) => {
    if (window.TourExterior) return resolve(window.TourExterior);
    let tries = 0;
    const t = setInterval(() => {
      if (window.TourExterior || ++tries > 100) { clearInterval(t); resolve(window.TourExterior || null); }
    }, 50);
  });

  T.StreetView = {
    mount(root, P) {
      root.classList.add("sv");
      const box = document.createElement("div");
      box.className = "sv-ext";
      root.appendChild(box);
      const gen = T.gen;
      let ext = null, started = false;
      const cfg = window.TOUR_CONFIG || {};
      const key = (T.embedConfig && T.embedConfig.mapsKey) || cfg.MAPS_API_KEY || cfg.googleMapsApiKey || "";

      async function start() {
        started = true;
        const X = await whenExterior();
        if (!T.alive(gen)) return;
        if (!X) {
          box.innerHTML = `<div class="sv-fallback"><h2>Street view couldn’t load</h2><p>Open the tour from a web address (not a file on your computer) to see the street.</p></div>`;
          return;
        }
        const loc = P.location || {};
        const opts = {
          container: box,
          address: P.streetAddress || "",
          lat: Number.isFinite(loc.lat) ? loc.lat : null,
          lng: Number.isFinite(loc.lng) ? loc.lng : null,
          frontPhotoUrl: P.exteriorPhoto || "",
          entryRoomId: P.entryRoom,
          apiKey: key && !/^YOUR_/i.test(key) ? key : null,
          hideOnEnter: false,
          enterLabel: "Go inside",
        };
        if (Number.isFinite(loc.heading)) opts.heading = loc.heading;
        ext = X.initExterior(opts);
      }
      T.on("tour:outside", () => { if (!started) start(); else if (ext) ext.show(); });
    },
  };
})();
