# Track C: Street View exterior

> **In Roomora** this is the walk-through's **Street** view: `public/tour/js/streetview.js` calls
> `initExterior` with the project's address (from the Upload screen) and the Maps key from
> `VITE_GOOGLE_MAPS_KEY`. Its **Go inside** button sends `tour:room`, which the walk-through follows.
> The demo page and tests below still work on their own.

The first screen of the house tour. It shows the house from the street in Google Street View, turned to face the front door, with an **Enter the house** button that hands over to the room viewer (Tracks A and B).

It never breaks. If anything goes wrong it falls back in this order:

1. **Street View panorama** facing the house
2. **Static Map** of the address, with the front photo as an inset
3. **Front-of-house photo** (or a drawn placeholder if the photo is missing too)

The photo and the Enter button are on screen immediately, before any network call, so the button always works.

## Files

| File | What it is |
| --- | --- |
| `exterior.js` | The module. Exports `initExterior`, `loadMaps`, `bearing`. |
| `exterior.css` | Styles. Every class starts with `tx-`. |
| `config.example.js` | Template for your key. Copy it to `config.js`. |
| `config.js` | Your real key. **Gitignored, never commit it.** |
| `index.html` | Demo page with a stand-in room viewer. |
| `assets/front-house.svg` | Demo front photo. Replace with the real one. |

## Run the demo

ES modules don't load from `file://`, so serve the folder:

```bash
cd public/tour/exterior
python3 -m http.server 8000      # or: npx serve .
# open http://localhost:8000
```

With no `config.js` it runs in photo mode. That's expected.

Handy URL switches for testing: `?nokey`, `?key=SOMEKEY`, `?lat=..&lng=..`, `?address=..`, `?photo=path.jpg`, `?room=kitchen`.

## API key setup

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project and **enable billing** (needed even for free-tier use; this is the most common reason nothing works).
2. Enable these APIs: **Maps JavaScript API**, **Street View Static API** (for the view out of the windows in the 3D walk), **Maps Static API**, and **Geocoding API** if you'll pass an address without lat/lng.
3. Create an API key under *APIs & Services → Credentials*.
4. Restrict it: *Application restrictions → Websites*, add `http://localhost:*/*`, `http://127.0.0.1:*/*` and your demo domain (e.g. `https://yourteam.github.io/*`). Under *API restrictions*, allow just the APIs above.
5. `cp config.example.js config.js` and paste the key in.

A browser key is always visible to anyone who opens the page; the website restriction is what protects it. Keeping it in `config.js` just keeps it out of git.

## Plugging it into the tour (Tracks A/B)

```html
<link rel="stylesheet" href="exterior.css">
<script src="config.js"></script>          <!-- a 404 here is fine -->
<div id="exterior" style="position:absolute; inset:0"></div>

<script type="module">
  import { initExterior } from './exterior.js';

  const ext = initExterior({
    container: '#exterior',
    address: '12 Example Road, London',
    lat: 51.5237, lng: -0.1586,           // skip geocoding if you have them
    frontPhotoUrl: 'photos/front.jpg',
    entryRoomId: 'hallway',
  });

  document.addEventListener('tour:room', (e) => {
    showRoom(e.detail.roomId);            // 'hallway'
  });

  // "Back outside" button in the room viewer:
  // ext.show();
</script>
```

Not using modules? `exterior.js` also sets `window.TourExterior.initExterior`.

The container needs a size (full screen, or a fixed height). On Enter the exterior fades out by itself; set `hideOnEnter: false` to manage that yourself.

### Events

| Event | `detail` | When |
| --- | --- | --- |
| `tour:room` | `{ roomId, from: 'exterior' }` | Enter is clicked. Bubbles, so listen on `document` or `window`. |
| `tour:exterior-mode` | `{ mode, reason }` | Mode changes: `panorama`, `static-map` or `photo`. |

### Options

| Option | Default | Notes |
| --- | --- | --- |
| `container` | `'#exterior'` | Selector or element. Created if missing. |
| `address` | `''` | Shown on screen; geocoded if lat/lng are missing. |
| `lat`, `lng` | `null` | The house itself, not the street. |
| `frontPhotoUrl` | `''` | Fallback and static-map inset. |
| `entryRoomId` | `'entrance'` | Sent in `tour:room`. |
| `apiKey` | from `config.js` | Override the key. |
| `heading` | computed | Force a camera direction (0 = north). |
| `pitch`, `zoom` | `5`, `1` | Camera. |
| `radii` | `[50, 150]` | Coverage search radii in metres, tried in order. |
| `loadTimeoutMs` | `8000` | Maps script timeout. |
| `lookupTimeoutMs` | `6000` | Geocode, coverage and static map timeout. |
| `staticMapType` | `'roadmap'` | Or `'satellite'`, `'hybrid'`. |
| `hideOnEnter` | `true` | Fade out on Enter. |
| `enterLabel` | `'Enter the house'` | Button text. |
| `onEnter(roomId)` | | Callback alternative to the event. |
| `onModeChange(mode, reason)` | | Callback alternative to the event. |

### Controller

`initExterior` returns straight away with:

- `ready`: a promise for the first settled mode. It never rejects.
- `mode`: current mode (can change after `ready`, see below).
- `enter()`, `show()`, `hide()`, `destroy()`.
- `panorama`: the `StreetViewPanorama`, or `null`.
- `location`: the house `{lat, lng}` used.

## How it works

- **Loader**: injects the Maps script once (shared if another track already loaded Maps), with an 8 s timeout. A missing key skips it entirely. Google's global `gm_authFailure` is hooked so a bad, restricted or unbilled key drops to the photo.
- **Coverage**: `StreetViewService.getPanorama` with `NEAREST` and `OUTDOOR`, at 50 m then 150 m.
- **Facing the house**: `heading = spherical.computeHeading(panoramaPosition, house)`. There's a built-in fallback bearing formula if the geometry library isn't there.
- With a bad key Google often lets the panorama start, then reports the failure a moment later. When that happens `ready` resolves `'panorama'` and the mode then switches to `'photo'`. Listen to `tour:exterior-mode` if you care.

## Tested

A headless Chromium run covered every path (Maps mocked, except the last):

- no key, giving photo
- panorama found at 50 m, heading computed, controls hidden
- address only, geocoded then panorama
- nothing at 50 m, found at 150 m
- no coverage, giving static map
- no coverage and static map blocked, giving photo
- bad key reported at load, during lookup, and after the panorama is up, giving photo each time
- offline, giving photo
- Maps script hangs, timing out to static map, then to photo
- missing front photo, giving the drawn placeholder
- real Google with a fake key, which reported `InvalidKeyMapError` and switched to photo
- 375 px mobile width with no sideways scroll and a full-width button

In every case Enter fired `tour:room` with the right room and the exterior faded out.

**Not tested yet:** a real panorama with a valid key. Do that first once you have the key; the coordinates in `index.html` are 221B Baker Street, which has coverage. Swap in your house.

## Demo-day checklist

- Billing on, key restricted to the demo domain and localhost.
- Real `lat`/`lng` for the house (right-click the house in Google Maps to copy them).
- If the camera faces the wrong way (the panorama is on the wrong side of a junction), set `heading` by hand.
- Record a backup screen capture of the panorama working.

## Re-running the tests

```bash
python3 -m http.server 8765 &      # from this folder
npm i -D playwright && npx playwright install chromium   # once
node tests/run.cjs
```
