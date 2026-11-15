# Veduta

Photos + floor plan → 3D. The user uploads a floor plan and room photos (and optionally the address), we match each photo to a room automatically, they check any we're unsure about, we build the model, and they explore it in 3D: as a dollhouse model, on the floor plan, or by walking through it room by room and stepping out to the street.

Live at **[veduta.uk](https://veduta.uk)**. Try the sample flat on the [Demo page](https://veduta.uk/demo) without uploading anything.

- **Frontend** (this folder): React + Vite + TypeScript, with three.js through react-three-fiber and drei for the viewer. Hosted on **Vercel**.
- **Walk-through** (`public/tour/`): the first-person house tour, with Track C's Street View (`public/tour/exterior/`). Plain JavaScript in a frame, opened from the View screen. See [tools/tour/README.md](tools/tour/README.md).
- **Backend** (`backend/`): Python on **Modal** GPUs. Gemini (or Claude) reads the floor plan and matches photos to rooms; **MASt3R** reconstructs each room in 3D; the rooms are placed on the plan and exported as one .glb. fal runs the 360° views, the 3D photos (MoGe-2) and Reimagine. See [backend/README.md](backend/README.md).

## Any property, same walk-through

Upload any floor plan and room photos (and the address) and the walk-through is built the same way as the sample flat:

- **Rooms** are found by the vision model as boxes on the plan image (the way vision models point at things best), with the scale taken from the dimensions written on the plan. In the walk-through each room then snaps to the space its walls enclose in the traced drawing (doorways closed off), which is what gets bathrooms, en suites and WCs right: they're small, fully walled spaces. A bedroom box that took in its en suite shrinks back to the bedroom.
- **Walls, doors and windows** are traced from the plan image, or drawn from the measured rooms when the rooms don't sit on the traced walls (screenshots, odd drawings). Only wall-thickness strokes count as walls: the tracer measures how thick the plan's long straight strokes are and drops anything much thinner (labels, dimension lines, door leaves, baths, beds, kitchen units) or fatter (title bars, filled headboards), so fixtures and lettering aren't extruded into walls. Walls away from every room (scale bars, keys) are dropped too.
- **Every room is reachable.** Starting from the hall, any room that can't be walked to gets a doorway cut through the wall it shares with one that can, so a door drawn shut on the plan doesn't seal a room.
- **Starter furniture is turned to suit each room**, so baths don't sit across doorways and mirrors and wardrobes don't cover windows.
- **Furniture, floors and wall colours** come from each room's photos: when the walk-through opens, every photographed room is furnished automatically (two rooms at a time; the backend keeps each answer, so reopening is quick). Rooms with a 3D scan keep the scan, and a layout arranged by hand with **Arrange furniture** is never replaced.
- **The view out of the windows** is the nearest Google Street View panorama to the address, and **the sunlight** comes from the south-west. Both are turned to the compass using the plan's north arrow when it has one (`plan.north`).

- **Viewpoints** ("From the doorway", "From the window", "Looking outside", "From the far corner") are worked out for each room from its walls, doorways and windows.
- **3D photos**: each photo opens as a 3D surface from a depth map the backend makes on first request (`GET /depth/...`): MoGe-2 on fal, or Depth Anything on CPU when fal isn't available. With the mock backend, photos stay flat.
- **Redesign and Reimagine with Fal**: redesign a room in the walk-through (furniture, colours, wallpaper), then have fal turn the 3D view into a realistic photo of the real room redesigned. Labelled as an AI impression.
- **The raw 3D scans** from MASt3R are rough, so the View screen shows the clean room model and keeps the scan behind **Show 3D scan**.
- **Artwork**: framed pictures seen in the photos are cut out and hung on the walls of their room.

## Run it

You need [Node.js](https://nodejs.org) (LTS). Then:

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

The committed `.env` points the app at the **deployed backend on Modal**, so the local site works exactly like veduta.uk (and uses the same backend). To use something else, create `.env.local`, which isn't committed and overrides `.env`:

```
# the built-in mock backend (no server; the last photo is always "not sure", so you see the Review screen)
VITE_USE_MOCK=true

# or a backend on your own machine (python backend/local.py, see backend/README.md)
VITE_API_URL=http://localhost:8000
```

`start.bat` (Windows) and `start.command` (Mac) still work as a double-click shortcut: they install the libraries if needed and run `npm run dev` against the backend in `.env`. They only start a temporary Modal backend (`modal serve`) if you remove `VITE_API_URL` from `.env` and `.env.local`.

## Screens

| Route | File | What it does |
|---|---|---|
| `/` | `src/screens/Upload.tsx` | Floor plan + photos (drag and drop or browse), then calls `matchPhotos` |
| `/review` | `src/screens/Review.tsx` | Only reached when at least one match isn't confident. Shows just those photos, plus "See all matches" |
| `/build` | `src/screens/Build.tsx` | Polls `getBuildStatus` once a second and shows the steps |
| `/view` | `src/screens/Viewer.tsx` | 3D / floor plan views, room list, room photos, Show 3D scan, Download .glb, **Walk through** |
| `/demo` | `src/screens/Demo.tsx` | The sample flat's walk-through, full screen in the site (linked from the header and Upload) |
| `/about` | `src/screens/About.tsx` | What Veduta is, how it works, the team and credits |
| `/tour/index.html` | `public/tour/` | The walk-through. With `?embed=1` it's opened by `src/viewer/TourDialog.tsx` for the current project; on its own it shows the sample flat |

If every match comes back confident, Upload skips Review and goes straight to `/build`.

State lives in `src/state/ProjectContext.tsx` (in memory only, so refreshing a later screen sends you back to Upload).

## Connecting the real backend

The backend in `backend/` implements the API below. All network calls are in `src/api/client.ts`, and the shapes are in `src/api/types.ts`. Paths are relative to `VITE_API_URL` (the app calls `${VITE_API_URL}/match` and so on, or `/api/match` when `VITE_API_URL` isn't set). Which backend the app uses is set in `.env` / `.env.local` (see Run it).

For the street view in the walk-through, add a Google Maps browser key as `VITE_GOOGLE_MAPS_KEY=...` in `.env.local` (and in Vercel for the live site) (Maps JavaScript, Maps Static, Street View Static and Geocoding APIs; restrict it to your site's address). The same key gives the 3D walk a real view out of the windows: the nearest Street View panorama to the address, lined up with the compass (set `north` in the property data if the plan isn't drawn with north up). Without it the street shows a drawn front-of-house picture and the windows look out on drawn scenery.

If the API is on another origin, either enable CORS there or add a proxy in `vite.config.ts` (`server.proxy: { '/api': 'http://localhost:8000' }`) and leave `VITE_API_URL` unset.

### 1. `POST /match`

`multipart/form-data` with:
- `floorPlan`: one file (PDF or image)
- `photos`: one entry per photo. The **filename of each part is the photo's id**; use it as `photoId` in the response.

Response:

```json
{
  "projectId": "abc123",
  "plan": {
    "width": 10,
    "depth": 7,
    "rooms": [
      { "id": "living", "name": "Living room", "x": 0, "y": 0, "width": 6, "depth": 4 },
      { "id": "bed1", "name": "Bedroom 1", "x": 0, "y": 4, "width": 5, "depth": 3 }
    ]
  },
  "matches": [
    { "photoId": "photo-1", "roomId": "living", "confident": true },
    {
      "photoId": "photo-2",
      "roomId": "bed2",
      "confident": false,
      "candidates": ["bed2", "bed1"],
      "reason": "It looks like a bedroom, but it could be either one."
    }
  ]
}
```

Room rectangles are in **metres**, origin at the plan's top-left corner, `x` to the right and `y` down the page. Rooms can be any rectangles; they don't have to fill the plan.

`reason` is shown to the user word for word, so keep it to one plain sentence.

### 2. `POST /build`

```json
{ "projectId": "abc123", "assignments": { "photo-1": "living", "photo-2": "bed1", "photo-3": "skip" } }
```

`"skip"` means the user said the photo isn't of this property. Photos the user didn't check are sent with the model's best guess. Response: `{ "jobId": "job-1" }`.

### 3. `GET /build/:jobId`

```json
{ "jobId": "job-1", "state": "running", "step": 3 }
{ "jobId": "job-1", "state": "done", "step": 6, "modelUrl": "https://…/model.glb" }
{ "jobId": "job-1", "state": "failed", "step": 2, "error": "Couldn't read the floor plan." }
```

`step` indexes `BUILD_STEPS` in `src/api/types.ts`. Edit the labels there to match what the pipeline really does.

Optionally, the finished status can include 360° views, one per room:

```json
{ "jobId": "job-1", "state": "done", "step": 7, "panoramas": { "living": "https://…/living.jpg", "bed1": "https://…/bed1.jpg" } }
```

Each URL must be a **2:1 equirectangular** image. Rooms with a panorama get an "Open 360° view" button in the viewer, shown with Marzipano (`src/viewer/Panorama.tsx`) and labelled as an AI-generated impression.

### Generating the panoramas with fal

The backend does this when `FAL_KEY` is set (in the Modal secret `photos-to-3d`, or in your shell for `local.py`): after the model is built, each room's first photo goes to `fal-ai/hunyuan_world` (about $0.15 a room), several rooms at once. The panoramas are saved with the build and served from `GET /panorama/{jobId}/{roomId}.jpg`, because fal's result links are temporary. A room whose panorama fails just doesn't get one.

To check your key and the model before a full build: `FAL_KEY=... python -m core.panorama some-photo.jpg "Living room"` (from `backend/`). It writes `some-photo-360.jpg` and says whether it's 2:1. Set `FAL_PANORAMA_MODEL` to use another fal model.

Keep `FAL_KEY` on the backend. Anything in the frontend's `VITE_…` variables is visible to every visitor. Pick each room's widest, clearest photo as the input: everything outside it is generated.

### 4. `POST /furnish` (optional)

Used by the walk-through, which furnishes every photographed room when it opens: what furniture a room's photos show, placed roughly on the plan, plus the floor, the wall colour and any framed pictures.

```json
{ "projectId": "abc123", "roomId": "living", "photoIds": ["photo-1", "photo-4"] }
```

Response (types are the ones the walk-through can draw, listed in `backend/core/furnish.py`; `x`/`y` are 0–1 across the room as drawn on the plan, `faces` is the way the front faces):

```json
{
  "floor": "oak",
  "walls": "#d9d4c7",
  "items": [
    { "type": "sofa", "x": 0.5, "y": 0.8, "faces": "up", "len": 2.4, "color": "#7d8a99", "accent": ["#e2c290"] },
    { "type": "coffee", "x": 0.5, "y": 0.5, "faces": "down", "w": 1.1, "d": 0.6 }
  ],
  "art": [
    { "photo": 1, "box": [0.38, 0.25, 0.62, 0.55], "wall": "up", "at": 0.5, "w": 0.7, "h": 0.9 }
  ]
}
```

`art.photo` is 1-based in the order of `photoIds`; `box` is `[x0, y0, x1, y1]` as fractions of that photo; `wall` and `at` (0–1 along it) place it in the room.

The answer is saved per room, so asking again with the same photos doesn't call the AI again. A server without it answers 501 and the walk-through keeps its starter furniture.

### `POST /reimagine` (optional, needs `FAL_KEY`)

Used by the walk-through's **Reimagine with Fal**, after someone redesigns a room with the interior designer.

```json
{ "render": "data:image/jpeg;base64,…", "photo": "data:image/jpeg;base64,…", "roomName": "Bedroom 2", "notes": "evening light" }
```

`render` is the walk-through's view of the redesign; `photo` is the room's original photo (or null; `"photoIsThisRoom": false` when it's a photo of another room, sent as a style guide); `furniture` lists every piece in view with its colour and where it is ("a teal sofa, centre left, in the middle distance"), written by the walk-through, so the model keeps every piece, in place and in its own colour. Both go to `fal-ai/nano-banana/edit` (about $0.04 an image; change it with `FAL_REIMAGINE_MODEL`). If it sends the render back unchanged (editing models sometimes do), it's asked again more firmly, and then `fal-ai/flux/dev/image-to-image` re-renders the picture instead, keeping its layout and colours (change it with `FAL_REIMAGINE_FALLBACK`). The response says which model made the picture (`model`) and whether it's still unchanged (`unchanged`). The request is sent, asked to keep the real room from the photo (walls, windows, view, light) and take the furniture, layout and colours from the render. Response: `{ "imageUrl": "https://…/reimagined/<id>.jpg" }`, kept on the backend. Without `FAL_KEY` it answers 501; the mock backend sends the render back so the flow can be tried. Check your key with `FAL_KEY=... python -m core.reimagine design.jpg photo.jpg "Bedroom"` from `backend/`.

### 5. `GET /depth/{projectId}/{photoId}.png` (optional)

Rooms in the match response may include `box`: `[x0, y0, x1, y1]`, where the room is on the floor plan image as fractions of its width and height. The walk-through uses it to place rooms on the traced drawing.

A photo's depth map for the walk-through's 3D photos: relative inverse depth as a 16-bit number in red (high byte) and green (low byte), 384 px wide. Made the first time it's asked for, then saved: with **MoGe-2 on fal** when `FAL_KEY` is set (about 1 cent a photo; `DEPTH_PROVIDER=local` turns it off), otherwise, or if fal fails, with Depth Anything on CPU. A server with neither answers 501 and photos stay flat.

The match response's `plan` may also include `north`: the compass bearing the top of the plan faces, read from its north arrow.

### The .glb

If `modelUrl` is set, the viewer loads it. Export it in metres, y up, with the origin at the plan's top-left corner (x right, z down the page), so it lines up with the plan's coordinates. If `modelUrl` is missing, the viewer draws the plan as a simple dollhouse model, and **Download .glb** exports that.

## Deploying

**Frontend → Vercel ([veduta.uk](https://veduta.uk)).** From an up-to-date `main` (`git pull` first), run `npx vercel --prod`. It uploads this folder and builds it on Vercel; `vercel.json` sets the build and the single-page-app routing, and `.vercelignore` leaves out the backend and test files. The project is on Will's Vercel account (free Hobby plan, one seat), so Will runs it. The backend URL comes from the committed `.env`; `VITE_GOOGLE_MAPS_KEY` is set in the Vercel project's environment variables.

Pushes to GitHub don't deploy the site by themselves. They can if the repo is connected in Vercel → Settings → Git, which needs the repo to be public on the free plan (pushes from anyone but the account owner are blocked on private repos).

`netlify.toml` is left over from the first hosting (roomora.uk on Netlify), which no longer gets updates.

**Backend → Modal.** From the project folder (Git Bash on Windows needs the first part):

```bash
export PYTHONUTF8=1 && python -m modal deploy backend/app.py
```

Keys live in the Modal secret `photos-to-3d`: `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`) and `FAL_KEY`. Never put them in `.env` or any `VITE_…` variable, which every visitor can see. `backend/deploy-backend.yml` can deploy on every push instead: move it to `.github/workflows/` and add the repo secrets `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` (modal.com → Settings → API tokens).

**Which build is live:** bump `src/build.ts` and the `?v=` dates in `public/tour/index.html` when you release. The label shows under the 3D view and in the walk-through's corner.

## Working together

- `git pull` before you start, and again before you push. If git reports a conflict, stop and ask instead of choosing "keep mine".
- Never copy an old folder or a zip over the repo: it silently undoes everyone else's work. Work in your git clone and push.
- Backend changes need `modal deploy`; frontend changes need `npx vercel --prod`.

## Still to do

- **Sample flat photos:** `public/tour/img/` holds the estate agent's photos and plan for the sample. Replace them before any public or commercial use.
- **Share link** currently copies the page URL, which only works on the same machine. It needs the backend to store models and give each project a URL.
- **The 2-photo 3D room** in the sample flat (reception room) uses low-resolution depth maps, so furniture edges look stepped. Rebuilding them (e.g. with MoGe) means redoing the alignment of the two photos.
- **Raw MASt3R scans** from a few listing photos are torn and streaky; they're hidden by default.
- MASt3R is licensed for non-commercial use only.
