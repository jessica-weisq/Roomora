# Walk-through (house tour)

The walk-through is Veduta's first-person view of a property: walk round the rooms in 3D, look at each
room's photos, restyle the walls and step outside to the street. It lives in `public/tour/` and is plain
JavaScript with three.js r128 from a CDN, separate from the React app's own three.js.

It runs two ways:

- **Inside Veduta**: the View screen's **Walk through** button opens `/tour/index.html?embed=1` in a frame
  (`src/viewer/TourDialog.tsx`) and sends it the current project. `public/tour/js/veduta.js` builds a flat
  from it. See "How a project becomes a flat" below.
- **The sample flat**: `/tour/index.html` on its own shows Clarges, Mayfair from `public/tour/property.js`.
  The Upload screen links to it.

Because the street view is an ES module, open the tour through the site (`npm run dev`, then
http://localhost:5173/tour/index.html), not by double-clicking the file.

## Controls

- **3D walk**: click and drag to look around (on touch screens, drag); walk with W A S D or the arrow keys (Shift to go faster), or double-click the floor.
  The floor plan card shows where you are; select a room to jump there.
- **3D photos**: each room's photos. Photos are 3D (depth maps): the sample's were made with `build_depth.py`, a project's come from the backend's `/depth` endpoint. With the mock backend, project photos are flat.
- **Street**: Street View facing the building, falling back to a static map and then the front photo
  (Track C, `public/tour/exterior/`). **Go inside** enters the hall.
- **Redesign** (the interior designer): shows the design tools below. **Reimagine with Fal** sits under
  it (it glows once you've changed something): it renders the room as it now looks, from where you're standing, and sends
  that with the room's original photo to the backend (`POST /api/reimagine`), which asks fal for a photographic
  version of the redesign in the real room. The result is labelled as an AI impression. Inside Veduta the
  website passes the request on; opened on its own, set `API_URL` in `public/tour/config.js` to the backend.
- **Paint and wallpaper**: click a wall, then pick a colour on the wheel and a finish (plain, stripe,
  pinstripe, trellis, polka dot, damask, grasscloth) for that wall or the whole room. Saved on this device.
- **Furnish from photos** (inside Veduta): asks the backend what furniture the room's photos show and
  refurnishes it. Positions are approximate, because the photos don't say where they were taken from.
- **Furniture on/off**: the furniture is an impression, not a record of the property.

## How a project becomes a flat

`veduta.js` receives `{ plan (rooms in metres), planImage, photos per room, panoramas, modelUrl, address }`:

1. **Walls.** If the floor plan is an image, its walls are traced in the browser (`tracePlan` in
   `js/uploads.js`) and the building's outline is matched to the plan's size in metres. If it's a PDF, or the
   outline doesn't match the room sizes within 25%, walls are drawn from the room rectangles instead, with a
   doorway wherever two rooms share a metre of wall and windows along outside walls.
2. **Rooms.** Each room's type comes from its name (bedroom, bathroom, kitchen and so on), which sets its
   floor (oak, carpet, stone, tile) and starter furniture.
3. **Photos and 360° views** become the room's photos; a 360° view opens as a panorama.
4. **Scans.** If the build produced a `.glb`, the `scan__<roomId>` nodes are placed in the walk (the plan's
   own floors and walls in it are skipped, since the walk has its own), and those rooms get no starter
   furniture. Untested so far: MASt3R hasn't produced a real model yet.
5. **Street.** The address from the Upload screen goes to Track C, which geocodes it.

Messages between the site and the frame (same origin only): the tour sends `veduta:hello`, the site
answers `veduta:project`; for furnishing the tour sends `veduta:furnish {id, roomId}` and the site
answers `veduta:reply {id, result | error}` after calling `furnishRoom()` in `src/api/client.ts`.

## Files

| Path | What it does |
| --- | --- |
| `public/tour/index.html`, `css/tour.css` | The page and its styles |
| `public/tour/js/shell.js` | Loads the property (sample or project), mounts the views, rebuilds on changes |
| `public/tour/js/veduta.js` | Builds a flat from a Veduta project; Furnish from photos; scans |
| `public/tour/js/walk3d.js` | The 3D walk: model, lighting, movement |
| `public/tour/js/furnish2.js` | Furniture models. Its types must match `ITEM_TYPES` in `backend/core/furnish.py` (a backend test checks) |
| `public/tour/js/decorate.js` | Paint and wallpaper |
| `public/tour/js/roomviewer.js` | Photos, 3D photos, 360° views, the sample's 3D reception room |
| `public/tour/js/floorplan.js` | The floor plan card |
| `public/tour/js/streetview.js` | Hands the street view to Track C |
| `public/tour/exterior/` | Track C: Street View with fallbacks, its own README and tests |
| `public/tour/js/uploads.js` | Plan tracing and starter furniture; also **Add photos**, which only appears when the tour is published on claude.ai |
| `public/tour/property.js`, `img/` | The sample flat |
| `tools/tour/` | Offline tools for the sample (below) |

## Street View key

Inside Veduta, set `VITE_GOOGLE_MAPS_KEY` (in `.env.local`, or Netlify's environment variables). For the
sample on its own, put it in `public/tour/config.js` as `MAPS_API_KEY`. Enable the Maps JavaScript, Maps
Static and Geocoding APIs, and restrict the key to your site's address: a browser key is always visible.
Without a key the street shows the front photo.

## Tools for the sample flat

Run from `public/tour/` (Python 3 with Pillow, NumPy, SciPy):

- `python3 ../../tools/tour/build_model.py img/floorplan-7th.png 0.039 > model.json`: walls and floors from a
  coloured plan image (0.039 = metres per pixel); paste into `property.js` as `"model"`.
- `python3 ../../tools/tour/build_depth.py depth_anything_vits14.onnx img/kitchen-1.jpg`: a depth map for a
  3D photo (`pip install onnxruntime`; model from github.com/fabio-sim/Depth-Anything-ONNX releases).
- `python3 ../../tools/tour/calibrate_pair.py 90 --build`: the sample's 3D reception room from two photos.
- `tools/tour/trace.html`: click round rooms on a plan image to get their outlines.

The sample's photos and floor plan belong to the estate agent who listed the flat; replace them before any
public or commercial use.

## Which build is live

`public/tour/index.html` carries a build stamp (bottom-left corner of the tour, and `?v=` on every script and
stylesheet so browsers fetch new files). After deploying, check the stamp matches. Bump it in index.html when
you change the tour.

## One file you can double-click

    python3 tools/tour/build_standalone.py veduta-tour.html

bundles the whole tour (scripts, styles, three.js, the sample flat's photos and depth maps) into one HTML file
that opens straight from your disk, offline. Settings (Google Maps key, the backend for Reimagine with Fal) are
at the top of the file. Street View only works from a web address, so for that run `python3 -m http.server 8000`
in the file's folder and open http://localhost:8000/veduta-tour.html.

