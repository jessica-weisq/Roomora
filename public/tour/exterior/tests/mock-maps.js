(function () {
  const S = window.__scenario || 'ok';
  const cb = document.querySelector('script[data-tour-maps]').src.match(/callback=([^&]+)/)[1];
  class LatLng { constructor(a, b) { this.a = a; this.b = b; } lat() { return this.a; } lng() { return this.b; } }
  const StreetViewStatus = { OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS' };
  window.__reqs = [];
  class StreetViewService {
    getPanorama(req, done) {
      window.__reqs.push({ radius: req.radius, preference: req.preference, sources: req.sources });
      if (S === 'auth-during') { setTimeout(() => window.gm_authFailure(), 30); return; }
      setTimeout(() => {
        if (S === 'zero' || S === 'zero-staticfail' || (S === 'far' && req.radius < 100)) done(null, 'ZERO_RESULTS');
        else done({ location: { pano: 'PANO_1', latLng: new LatLng(51.5236, -0.1590) } }, 'OK');
      }, 20);
    }
  }
  class StreetViewPanorama {
    constructor(el, o) { window.__panoOpts = o; el.innerHTML = '<div class="fake-pano" style="width:100%;height:100%;background:#345">FAKE PANO</div>';
      if (S === 'auth-late') setTimeout(() => window.gm_authFailure(), 150); }
    addListener() { return { remove() {} }; }
    getStatus() { return 'OK'; }
    setVisible() {}
  }
  class Geocoder { geocode(r, done) { setTimeout(() => done([{ geometry: { location: new LatLng(51.5237, -0.1585) } }], 'OK'), 10); } }
  const toR = (d) => d * Math.PI / 180;
  const spherical = { computeHeading(a, b) { const y = Math.sin(toR(b.lng() - a.lng())) * Math.cos(toR(b.lat()));
    const x = Math.cos(toR(a.lat())) * Math.sin(toR(b.lat())) - Math.sin(toR(a.lat())) * Math.cos(toR(b.lat())) * Math.cos(toR(b.lng() - a.lng()));
    return Math.atan2(y, x) * 180 / Math.PI; } };
  const maps = { LatLng, StreetViewService, StreetViewPanorama, StreetViewStatus, Geocoder,
    StreetViewPreference: { NEAREST: 'nearest' }, StreetViewSource: { OUTDOOR: 'outdoor' },
    geometry: { spherical }, event: { trigger() {} } };
  maps.importLibrary = async (n) => (n === 'geometry' ? { spherical } : maps);
  window.google = { maps };
  if (S === 'auth-load') { setTimeout(() => window.gm_authFailure(), 10); return; }
  window[cb]();
})();
