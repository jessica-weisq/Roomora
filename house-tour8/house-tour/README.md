# House tour

A virtual walk-through built from photos, a floor plan and Google Street View.

## 3D walk

The **3D walk** view is a model built from the floor plan at real scale. Move the mouse to look around (keep it
near the left or right edge to keep turning; on touch screens, drag), walk with W A S D or the arrow keys (hold Shift to go faster), or double-click the floor to walk
there. On a phone, use the circle in the corner to walk. The photos for whichever room you're in
appear in the corner. Buttons next to the room name (such as "From the doorway") glide you to
set viewpoints; they're the `"views"` list on each room in `property.js`.

The furniture and finishes are an impression based on the listing photos, not a record of the
flat. They're listed in `"furnishing"` in `property.js` (type, position on the plan in pixels,
direction in degrees) and drawn by `js/furnish2.js` (physically based materials, rounded upholstery, soft shadows; parts sharing a material are merged so it draws quickly). **Furniture shown** turns them off.

The model comes from `tools/build_model.py`, which reads the floor plan image:

    python3 tools/build_model.py img/floorplan-7th.png 0.039 > model.json

(0.039 is metres per pixel on this plan.) Paste the output into `property.js` as `"model"`.

## 3D photos

**3D photos** turns each listing photo into a 3D scene using an AI depth estimate (Depth Anything).
Move the mouse to look around, step with W A S D or the arrow keys, scroll to move closer, or double-click to
step towards something. Movement is kept near where the photo was taken, because the photo doesn't
show what's behind things.

To add a 3D version of a new photo:

    pip install onnxruntime pillow numpy
    python3 tools/build_depth.py depth_anything_vits14.onnx img/kitchen-1.jpg

Add `"depth": "img/depth/kitchen-1.png"` to that photo in `property.js` (optionally
`"depthRange": [nearest, farthest]` in metres), then run `python3 tools/pack_media.py`.

## 3D room from several photos (reception room)

The reception room's first view combines two photos taken from opposite ends into one 3D room
(`tools/calibrate_pair.py`): each depth map is put into metres using the floor and ceiling, then the
two are lined up on the room's axis and the seating area. Photos are cut along object outlines so
nothing stretches, and each photo only shows a surface when you see it from near the angle it was
taken from; plain walls, floor and ceiling fill the rest. It looks fully real near where the photos
were taken ("Window end" / "Door end"), and plainer in between.

## Open it

Unzip the folder and double-click `index.html`. Nothing to install.

Opened this way, everything works except two things browsers block for files on your disk:
- **Street View** (Google needs a web address). The Street tab shows the exterior photo and a
  Google Maps link instead.
- **360° photos** show as flat photos you can't drag around.

For those two, either use the hosted link, or run a small local server in this folder:

    py -m http.server 8000         (Windows)
    python3 -m http.server 8000    (Mac / Linux)

then open http://localhost:8000.

## Add your Google Maps key (Street View)

1. In Google Cloud, enable **Maps JavaScript API** for your project (billing must be on).
2. Create an API key. It starts with `AIza`.
3. Restrict it: *Application restrictions* → Websites → add `http://localhost:8000/*` and your
   live site's address. *API restrictions* → Maps JavaScript API.
4. Paste it into `config.js`.

## Add your photos

Put images in `img/` using the file names in `property.js` (for example `img/kitchen-1.jpg`),
or change the names in `property.js` to match your files.

- `"type": "photo"` is a normal photo.
- `"type": "pano"` is a 360° photo (an equirectangular image, 2:1 shape, as produced by
  360 cameras and most phone "photo sphere" modes).

## Add your floor plan

1. Open http://localhost:8000/tools/trace.html and choose the floor plan image.
2. Click round each room's corners (hold Shift for straight walls), name it, select Finish room.
3. Copy the output into `property.js`: the `floor` entry into `floors`, the rooms into `rooms`.
   Copy the plan image into `img/` under the same name.

## Place hotspots (doorways between rooms)

Select **Edit hotspots**, click the photo where a doorway is, choose where it leads and select
**Add hotspot**. Copy the room's links from the yellow panel into that room in `property.js`.
Changes made in the page are lost on reload until you paste them in.

Each link's `x` and `y` are fractions of the photo's width and height (0 to 1). `media` says which
of the room's photos it sits on (0 = first, the default). A link `"to": "outside"` goes to the street.

## Project structure (three independent tracks)

| File | Track | Job |
| --- | --- | --- |
| `js/tour-core.js` | shared | Events, loading, validation, placeholders |
| `js/floorplan.js`, `tools/trace.html` | A: floor plan and data | Clickable plan, tracing |
| `js/roomviewer.js` | B: room viewer | Photos, 360° views, hotspots, editing |
| `js/streetview.js` | C: street view | Google Street View and fallbacks |
| `js/shell.js`, `index.html` | shell | Mounts the three tracks, address bar |

Tracks talk only through window events: `tour:room {roomId}`, `tour:outside`, `tour:floor {floorId}`,
plus `tour:edit {on}` and `tour:data-changed` for editing.

`build_preview.py` bundles everything into one `preview.html` with placeholder images.

## Hosting

Any static host works (GitHub Pages, Netlify, Cloudflare Pages). Upload the folder and add the
site's address to the key's allowed websites. Only publish listing photos you have permission to use.
