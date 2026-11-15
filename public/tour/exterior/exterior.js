/**
 * Track C: Street View exterior for the virtual house tour.
 *
 *   import { initExterior } from './exterior.js';
 *   const ext = initExterior({ address, lat, lng, frontPhotoUrl, entryRoomId });
 *   document.addEventListener('tour:room', e => showRoom(e.detail.roomId));
 *
 * Fallback chain (the exterior never breaks):
 *   1. Street View panorama, turned to face the house
 *   2. Static Map image of the address (with the front photo inset)
 *   3. Front-of-house photo (or a drawn placeholder if the photo fails too)
 *
 * The API key is read from window.TOUR_CONFIG.MAPS_API_KEY (set by config.js),
 * or passed in as `apiKey`. It never needs to live in this file.
 */

const DEFAULTS = {
  container: '#exterior',
  address: '',
  lat: null,
  lng: null,
  frontPhotoUrl: '',
  entryRoomId: 'entrance',
  apiKey: null,            // overrides window.TOUR_CONFIG.MAPS_API_KEY
  heading: null,           // force a heading instead of computing one
  pitch: 5,
  zoom: 1,
  radii: [50, 150],        // metres; tried in order
  loadTimeoutMs: 8000,     // Maps JS script load
  lookupTimeoutMs: 6000,   // geocode / coverage calls
  staticZoom: 18,
  staticMapType: 'roadmap', // 'roadmap' | 'satellite' | 'hybrid'
  hideOnEnter: true,
  enterLabel: 'Enter the house',
  onEnter: null,           // (roomId) => void
  onModeChange: null,      // (mode, reason) => void
};

/* ------------------------------------------------------------------ */
/* Maps JS loader                                                      */
/* ------------------------------------------------------------------ */

let mapsPromise = null;
let mapsKey = null;
let authFailed = false;
const authListeners = new Set();

function installAuthFailureHook() {
  if (window.__tourAuthHookInstalled) return;
  window.__tourAuthHookInstalled = true;
  const previous = typeof window.gm_authFailure === 'function' ? window.gm_authFailure : null;
  // Google calls this global when the key is invalid, restricted or billing is off.
  window.gm_authFailure = function () {
    authFailed = true;
    authListeners.forEach((fn) => { try { fn(); } catch (_) { /* ignore */ } });
    if (previous) previous.apply(this, arguments);
  };
}

function hasMaps() {
  return !!(window.google && window.google.maps);
}

/**
 * Load the Google Maps JavaScript API once. Resolves with an object of the
 * classes we need. Rejects if the key is missing, the script fails, it times
 * out, or Google reports an auth failure.
 */
export function loadMaps(apiKey, { timeoutMs = DEFAULTS.loadTimeoutMs } = {}) {
  if (!apiKey) return Promise.reject(new Error('missing-key'));
  if (authFailed) return Promise.reject(new Error('auth-failure'));
  if (mapsPromise && mapsKey === apiKey) return mapsPromise;

  installAuthFailureHook();
  mapsKey = apiKey;

  mapsPromise = new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      authListeners.delete(onAuth);
      fn(val);
    };
    const onAuth = () => done(reject, new Error('auth-failure'));
    authListeners.add(onAuth);

    const timer = setTimeout(() => done(reject, new Error('load-timeout')), timeoutMs);

    const finish = () => resolveLibraries().then((libs) => done(resolve, libs), (err) => done(reject, err));

    // Another track already loaded Maps: reuse it.
    if (hasMaps() && (window.google.maps.importLibrary || window.google.maps.StreetViewService)) {
      finish();
      return;
    }

    const cbName = '__tourMapsReady';
    window[cbName] = () => { delete window[cbName]; finish(); };

    const params = new URLSearchParams({
      key: apiKey,
      v: 'weekly',
      libraries: 'geometry',
      loading: 'async',
      callback: cbName,
    });
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.dataset.tourMaps = '1';
    script.onerror = () => done(reject, new Error('load-error'));
    document.head.appendChild(script);
  }).catch((err) => {
    // Allow a later retry (e.g. after going back online), except for bad keys.
    if (err.message !== 'auth-failure') { mapsPromise = null; mapsKey = null; }
    throw err;
  });

  return mapsPromise;
}

async function resolveLibraries() {
  const g = window.google.maps;
  const libs = { maps: g };
  if (typeof g.importLibrary === 'function') {
    const [core, sv, geom, geo] = await Promise.all([
      g.importLibrary('core'),
      g.importLibrary('streetView'),
      g.importLibrary('geometry').catch(() => ({})),
      g.importLibrary('geocoding').catch(() => ({})),
    ]);
    Object.assign(libs, core, sv, geom, geo);
  }
  // Fill anything missing from the global namespace (legacy loading).
  for (const k of ['LatLng', 'StreetViewService', 'StreetViewPanorama', 'StreetViewPreference',
    'StreetViewSource', 'StreetViewStatus', 'Geocoder']) {
    if (!libs[k] && g[k]) libs[k] = g[k];
  }
  if (!libs.spherical && g.geometry && g.geometry.spherical) libs.spherical = g.geometry.spherical;
  if (!libs.StreetViewService || !libs.StreetViewPanorama) throw new Error('streetview-unavailable');
  return libs;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(label)), ms); }),
  ]).finally(() => clearTimeout(t));
}

function toRad(d) { return (d * Math.PI) / 180; }
function toDeg(r) { return (r * 180) / Math.PI; }

/** Initial bearing from point a to point b in degrees (0 = north, clockwise). */
export function bearing(a, b) {
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat), Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function plainLatLng(ll) {
  if (!ll) return null;
  return typeof ll.lat === 'function' ? { lat: ll.lat(), lng: ll.lng() } : { lat: ll.lat, lng: ll.lng };
}

function geocode(libs, address, ms) {
  if (!libs.Geocoder) return Promise.reject(new Error('geocoder-unavailable'));
  const geocoder = new libs.Geocoder();
  return withTimeout(new Promise((resolve, reject) => {
    geocoder.geocode({ address }, (results, status) => {
      if (status === 'OK' && results && results[0]) resolve(plainLatLng(results[0].geometry.location));
      else reject(new Error(`geocode-${String(status).toLowerCase()}`));
    });
  }), ms, 'geocode-timeout');
}

function findPanorama(libs, location, radius, ms) {
  const service = new libs.StreetViewService();
  const request = { location, radius };
  if (libs.StreetViewPreference) request.preference = libs.StreetViewPreference.NEAREST;
  if (libs.StreetViewSource) request.sources = [libs.StreetViewSource.OUTDOOR];
  return withTimeout(new Promise((resolve, reject) => {
    service.getPanorama(request, (data, status) => {
      const ok = libs.StreetViewStatus ? libs.StreetViewStatus.OK : 'OK';
      if (status === ok && data && data.location) resolve(data);
      else reject(new Error(`no-coverage-${radius}m`));
    });
  }), ms, 'coverage-timeout');
}

function resolveContainer(sel) {
  if (sel instanceof HTMLElement) return sel;
  const found = typeof sel === 'string' ? document.querySelector(sel) : null;
  if (found) return found;
  const el = document.createElement('div');
  el.id = typeof sel === 'string' && sel.startsWith('#') ? sel.slice(1) : 'exterior';
  document.body.appendChild(el);
  return el;
}

function readConfigKey() {
  const cfg = window.TOUR_CONFIG || {};
  const key = (cfg.MAPS_API_KEY || '').trim();
  // Treat the example placeholder as "no key".
  return key && !/^YOUR_|^REPLACE/i.test(key) ? key : null;
}

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9cc7e8"/><stop offset="1" stop-color="#e6f1f8"/></linearGradient></defs>
  <rect width="400" height="260" fill="url(#sky)"/>
  <rect y="215" width="400" height="45" fill="#8fb57a"/>
  <polygon points="110,120 200,55 290,120" fill="#8a4b3c"/>
  <rect x="125" y="118" width="150" height="100" fill="#efe3cf"/>
  <rect x="185" y="160" width="30" height="58" fill="#5b3a2a"/>
  <rect x="140" y="140" width="32" height="28" fill="#bcd7ea" stroke="#fff" stroke-width="3"/>
  <rect x="228" y="140" width="32" height="28" fill="#bcd7ea" stroke="#fff" stroke-width="3"/>
  <rect x="180" y="218" width="40" height="42" fill="#c9b79c"/>
</svg>`;

/* ------------------------------------------------------------------ */
/* initExterior                                                        */
/* ------------------------------------------------------------------ */

/**
 * Mount the exterior view. Returns a controller straight away; the first
 * frame (front photo + Enter button) is on screen before any network call.
 *
 * controller.ready   Promise<'panorama'|'static-map'|'photo'>, never rejects
 * controller.mode    current mode
 * controller.enter() same as clicking Enter
 * controller.show()  show the exterior again (e.g. a "back outside" button)
 * controller.destroy()
 */
export function initExterior(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const root = resolveContainer(opts.container);
  const apiKey = (opts.apiKey || '').trim() || readConfigKey();
  const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const lat0 = num(opts.lat), lng0 = num(opts.lng);
  let house = Number.isFinite(lat0) && Number.isFinite(lng0) ? { lat: lat0, lng: lng0 } : null;

  let mode = 'loading';
  let destroyed = false;
  let panorama = null;
  let panoListeners = [];

  /* ---- DOM ---- */
  root.classList.add('tx-root');
  root.innerHTML = `
    <div class="tx-stage">
      <div class="tx-layer tx-photo"></div>
      <img class="tx-layer tx-static" alt="" hidden>
      <div class="tx-layer tx-pano" hidden></div>
      <img class="tx-inset" alt="" hidden>
    </div>
    <div class="tx-overlay">
      <div class="tx-top">
        <div class="tx-address"></div>
        <div class="tx-badge" role="status" aria-live="polite"><span class="tx-spinner"></span><span class="tx-badge-text">Looking for Street View…</span></div>
      </div>
      <button type="button" class="tx-enter"></button>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const photoEl = $('.tx-photo');
  const staticEl = $('.tx-static');
  const panoEl = $('.tx-pano');
  const insetEl = $('.tx-inset');
  const badgeEl = $('.tx-badge');
  const badgeText = $('.tx-badge-text');
  const enterBtn = $('.tx-enter');

  $('.tx-address').textContent = opts.address || (house ? `${house.lat.toFixed(5)}, ${house.lng.toFixed(5)}` : '');
  $('.tx-address').hidden = !$('.tx-address').textContent;
  enterBtn.textContent = opts.enterLabel;

  // Layer 3 (always present underneath): front photo or drawn placeholder.
  function showPlaceholder() {
    photoEl.style.backgroundImage = '';
    photoEl.classList.add('tx-placeholder');
    photoEl.innerHTML = PLACEHOLDER_SVG;
  }
  let photoOk = false;
  if (opts.frontPhotoUrl) {
    const probe = new Image();
    probe.onload = () => {
      if (destroyed) return;
      photoOk = true;
      photoEl.classList.remove('tx-placeholder');
      photoEl.innerHTML = '';
      photoEl.style.backgroundImage = `url("${opts.frontPhotoUrl.replace(/"/g, '%22')}")`;
      if (mode === 'static-map') showInset();
    };
    probe.onerror = () => { if (!destroyed) { photoOk = false; showPlaceholder(); insetEl.hidden = true; } };
    showPlaceholder();
    probe.src = opts.frontPhotoUrl;
  } else {
    showPlaceholder();
  }

  function showInset() {
    if (!photoOk) return;
    insetEl.src = opts.frontPhotoUrl;
    insetEl.alt = 'Front of the house';
    insetEl.hidden = false;
  }

  function setBadge(text, { busy = false, hide = false } = {}) {
    badgeText.textContent = text;
    badgeEl.classList.toggle('tx-busy', busy);
    badgeEl.hidden = hide;
  }

  function setMode(next, reason) {
    if (destroyed) return;
    mode = next;
    root.dataset.mode = next;
    staticEl.hidden = next !== 'static-map';
    panoEl.hidden = next !== 'panorama';
    if (next !== 'static-map') insetEl.hidden = true;
    if (next === 'panorama') setBadge('Street View', { hide: true });
    if (next === 'static-map') setBadge('Street View unavailable here, showing map');
    if (next === 'photo') setBadge(reason === 'missing-key' ? 'Offline preview' : 'Street View unavailable', { hide: reason === 'missing-key' });
    if (typeof opts.onModeChange === 'function') { try { opts.onModeChange(next, reason); } catch (_) { /* ignore */ } }
    root.dispatchEvent(new CustomEvent('tour:exterior-mode', { bubbles: true, detail: { mode: next, reason } }));
  }

  /* ---- Enter ---- */
  function enter() {
    if (destroyed) return;
    const roomId = opts.entryRoomId;
    root.dispatchEvent(new CustomEvent('tour:room', { bubbles: true, composed: true, detail: { roomId, from: 'exterior' } }));
    if (typeof opts.onEnter === 'function') { try { opts.onEnter(roomId); } catch (_) { /* ignore */ } }
    if (opts.hideOnEnter) root.classList.add('tx-hidden');
  }
  enterBtn.addEventListener('click', enter);

  function show() {
    root.classList.remove('tx-hidden');
    // A hidden panorama needs a nudge to redraw at the right size.
    if (panorama && window.google && window.google.maps && window.google.maps.event) {
      requestAnimationFrame(() => window.google.maps.event.trigger(panorama, 'resize'));
    }
  }

  /* ---- Fallbacks ---- */
  function staticMapUrl() {
    const w = Math.max(320, Math.min(640, Math.round(root.clientWidth || 640)));
    const h = Math.max(240, Math.min(640, Math.round(root.clientHeight || 400)));
    const center = house ? `${house.lat},${house.lng}` : opts.address;
    const params = new URLSearchParams({
      center,
      zoom: String(opts.staticZoom),
      size: `${w}x${h}`,
      scale: '2',
      maptype: opts.staticMapType,
      markers: `color:red|${center}`,
      key: apiKey,
    });
    return `https://maps.googleapis.com/maps/api/staticmap?${params}`;
  }

  function showStaticMap(reason) {
    return new Promise((resolve) => {
      if (!apiKey || authFailed || (!house && !opts.address) || destroyed) { resolve(showPhoto(reason)); return; }
      setBadge('Loading map…', { busy: true });
      let t = null;
      const ok = () => { clearTimeout(t); cleanup(); setMode('static-map', reason); showInset(); resolve('static-map'); };
      const fail = () => { clearTimeout(t); cleanup(); resolve(showPhoto(reason)); };
      const cleanup = () => { staticEl.onload = null; staticEl.onerror = null; };
      staticEl.onload = () => (staticEl.naturalWidth > 0 ? ok() : fail());
      staticEl.onerror = fail;
      t = setTimeout(fail, opts.lookupTimeoutMs);
      staticEl.alt = `Map of ${opts.address || 'the house'}`;
      staticEl.src = staticMapUrl();
    });
  }

  function showPhoto(reason) {
    setMode('photo', reason);
    return 'photo';
  }

  function teardownPanorama() {
    panoListeners.forEach((l) => l && l.remove && l.remove());
    panoListeners = [];
    if (panorama) { try { panorama.setVisible(false); } catch (_) { /* ignore */ } }
    panorama = null;
    panoEl.innerHTML = '';
  }

  // A bad key can surface after the panorama is already showing.
  const onAuthFailure = () => {
    if (destroyed || mode === 'photo') return;
    teardownPanorama();
    showPhoto('auth-failure');
  };
  authListeners.add(onAuthFailure);

  /* ---- Main flow ---- */
  // After every await: stop if destroyed, or if a bad key was reported meanwhile.
  const interrupted = () => destroyed || authFailed;
  const bail = () => (authFailed && !destroyed && mode !== 'photo' ? showPhoto('auth-failure') : mode);

  async function run() {
    if (!apiKey) return showPhoto('missing-key');
    if (!house && !opts.address) return showPhoto('no-location');

    let libs;
    try {
      libs = await loadMaps(apiKey, { timeoutMs: opts.loadTimeoutMs });
    } catch (err) {
      return err.message === 'auth-failure' ? showPhoto('auth-failure') : showStaticMap(err.message);
    }
    if (interrupted()) return bail();

    if (!house) {
      try {
        house = await geocode(libs, opts.address, opts.lookupTimeoutMs);
      } catch (err) {
        // The Static Maps API can still centre on the raw address string.
        return interrupted() ? bail() : showStaticMap(err.message);
      }
    }
    if (interrupted()) return bail();

    let data = null;
    let lastErr = null;
    for (const radius of opts.radii) {
      try { data = await findPanorama(libs, house, radius, opts.lookupTimeoutMs); break; }
      catch (err) { lastErr = err; if (interrupted()) return bail(); }
    }
    if (interrupted()) return bail();
    if (!data) return showStaticMap(lastErr ? lastErr.message : 'no-coverage');

    const panoPos = plainLatLng(data.location.latLng);
    let heading = opts.heading;
    if (heading === null || heading === undefined) {
      heading = libs.spherical && libs.LatLng
        ? libs.spherical.computeHeading(new libs.LatLng(panoPos.lat, panoPos.lng), new libs.LatLng(house.lat, house.lng))
        : bearing(panoPos, house);
    }

    try {
      panoEl.hidden = false; // must be visible/sized when created
      panorama = new libs.StreetViewPanorama(panoEl, {
        pano: data.location.pano,
        pov: { heading, pitch: opts.pitch },
        zoom: opts.zoom,
        addressControl: false,
        fullscreenControl: false,
        motionTracking: false,
        motionTrackingControl: false,
        enableCloseButton: false,
        showRoadLabels: false,
        zoomControl: false,
        panControl: false,
        linksControl: true,
        clickToGo: true,
        visible: true,
      });
    } catch (err) {
      teardownPanorama();
      return showStaticMap('panorama-error');
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
      const okStatus = libs.StreetViewStatus ? libs.StreetViewStatus.OK : 'OK';
      if (panorama.addListener) {
        panoListeners.push(panorama.addListener('status_changed', () => {
          const status = panorama.getStatus && panorama.getStatus();
          if (status && status !== okStatus && mode === 'panorama') {
            teardownPanorama();
            showStaticMap(`panorama-${String(status).toLowerCase()}`);
          }
        }));
      }
      setMode('panorama', 'ok');
      root.dataset.heading = String(Math.round(heading));
      settle('panorama');
    });
  }

  const ready = run().catch((err) => {
    // Last line of defence: anything unexpected still ends on the photo.
    console.warn('[exterior] falling back to photo:', err);
    return showPhoto('error');
  });

  return {
    get mode() { return mode; },
    get panorama() { return panorama; },
    get location() { return house; },
    ready,
    enter,
    show,
    hide() { root.classList.add('tx-hidden'); },
    destroy() {
      destroyed = true;
      authListeners.delete(onAuthFailure);
      teardownPanorama();
      enterBtn.removeEventListener('click', enter);
      root.innerHTML = '';
      root.classList.remove('tx-root', 'tx-hidden');
      delete root.dataset.mode;
    },
  };
}

// Handy for teammates not using modules: window.TourExterior.initExterior(...)
if (typeof window !== 'undefined') {
  window.TourExterior = Object.assign(window.TourExterior || {}, { initExterior, loadMaps, bearing });
}
