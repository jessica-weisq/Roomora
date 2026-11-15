# Roomora

Photos + floor plan → 3D. The user uploads a floor plan and room photos (and optionally the address), we match each photo to a room automatically, they check any we're unsure about, we build the model, and they explore it in 3D: as a dollhouse model, on the floor plan, or by walking through it room by room and stepping out to the street.

- **Frontend** (this folder): React + Vite + TypeScript, with three.js through react-three-fiber and drei for the viewer. Hosted on **Netlify**.
- **Walk-through** (`public/tour/`): the first-person house tour, with Track C's Street View (`public/tour/exterior/`). Plain JavaScript in a frame, opened from the View screen. See [tools/tour/README.md](tools/tour/README.md).
- **Backend** (`backend/`): Python on **Modal** GPUs. Gemini (or Claude) reads the floor plan and matches photos to rooms; **MASt3R** reconstructs each room in 3D; the rooms are placed on the plan and exported as one .glb. See [backend/README.md](backend/README.md).

## Any property, same walk-through

Upload any floor plan and room photos (and the address) and the walk-through is built the same way as the sample flat:

- **Walls, doors and windows** are traced from the plan image, or drawn from the measured rooms when the drawing can't be traced.
- **Furniture, floors and wall colours** come from each room's photos: when the walk-through opens, every photographed room is furnished automatically (two rooms at a time; the backend keeps each answer, so reopening is quick). Rooms with a 3D scan keep the scan, and a layout arranged by hand with **Arrange furniture** is never replaced.
- **The view out of the windows** is the nearest Google Street View panorama to the address, and **the sunlight** comes from the south-west. Both are turned to the compass using the plan's north arrow when it has one (`plan.north`).

- **Viewpoints** ("From the doorway", "From the window", "Looking outside", "From the far corner") are worked out for each room from its walls, doorways and windows.
- **3D photos**: each photo opens as a 3D surface from a depth map the backend makes on first request (`GET /api/depth/...`, Depth Anything on CPU). With the mock backend, photos stay flat.
- **Artwork**: framed pictures seen in the photos are cut out and hung on the walls of their room.

## Run it

**Double-click `start.bat`** (Windows) or **`start.command`** (Mac). It checks for Node.js, installs or updates the libraries when needed, starts the app and opens it in your browser. Close the window to stop it.

The only thing you need installed is [Node.js](https://nodejs.org) (LTS). The launcher logic is in `scripts/start.mjs`; `npm start` does the same from a terminal.

By hand:

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

On a Mac, if double-clicking `start.command` says it can't be opened, right-click it → Open the first time.

If Modal is installed and logged in (see [backend/README.md](backend/README.md)), the launcher also starts the real backend with `modal serve` and connects the app to it. Otherwise the app uses its **mock backend** (`src/api/mock.ts`), so the whole flow works with no server. The mock always marks the last photo as "not sure" so you can see the Review screen.

## Screens

| Route | File | What it does |
|---|---|---|
| `/` | `src/screens/Upload.tsx` | Floor plan + photos (drag and drop or browse), then calls `matchPhotos` |
| `/review` | `src/screens/Review.tsx` | Only reached when at least one match isn't confident. Shows just those photos, plus "See all matches" |
| `/build` | `src/screens/Build.tsx` | Polls `getBuildStatus` once a second and shows the steps |
| `/view` | `src/screens/Viewer.tsx` | 3D / floor plan views, room list, room photos, Download .glb, **Walk through** |
| `/tour/index.html` | `public/tour/` | The walk-through. With `?embed=1` it's opened by `src/viewer/TourDialog.tsx` for the current project; on its own it shows the sample flat (linked from Upload) |

If every match comes back confident, Upload skips Review and goes straight to `/build`.

State lives in `src/state/ProjectContext.tsx` (in memory only, so refreshing a later screen sends you back to Upload).

## Connecting the real backend

The backend in `backend/` implements the API below. All network calls are in `src/api/client.ts`, and the shapes are in `src/api/types.ts`. The launcher wires this up for you; to do it by hand, create `.env.local`:

```
VITE_USE_MOCK=false
VITE_API_URL=http://localhost:8000
```

For the street view in the walk-through, add a Google Maps browser key as `VITE_GOOGLE_MAPS_KEY=...` (Maps JavaScript, Maps Static, Street View Static and Geocoding APIs; restrict it to your site's address). The same key gives the 3D walk a real view out of the windows: the nearest Street View panorama to the address, lined up with the compass (set `north` in the property data if the plan isn't drawn with north up). Without it the street shows a drawn front-of-house picture and the windows look out on drawn scenery.

If the API is on another origin, either enable CORS there or add a proxy in `vite.config.ts` (`server.proxy: { '/api': 'http://localhost:8000' }`) and leave `VITE_API_URL` unset.

### 1. `POST /api/match`

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

### 2. `POST /api/build`

```json
{ "projectId": "abc123", "assignments": { "photo-1": "living", "photo-2": "bed1", "photo-3": "skip" } }
```

`"skip"` means the user said the photo isn't of this property. Photos the user didn't check are sent with the model's best guess. Response: `{ "jobId": "job-1" }`.

### 3. `GET /api/build/:jobId`

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

`fal-ai/hunyuan_world` turns one photo into a 1920 × 960 panorama (about $0.15 each). On the **server**:

```js
import { fal } from "@fal-ai/client"; // reads FAL_KEY from the environment
const { data } = await fal.subscribe("fal-ai/hunyuan_world", {
  input: { image_url: bestPhotoOfRoom, prompt: "Seamless 360° panorama of this living room, same style and furniture" },
});
panoramas[roomId] = data.image.url;
```

Keep `FAL_KEY` on the backend. Anything in the frontend's `VITE_…` variables is visible to every visitor. Pick each room's widest, clearest photo as the input: everything outside it is generated.

### 4. `POST /api/furnish` (optional)

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

### 5. `GET /api/depth/{projectId}/{photoId}.png` (optional)

A photo's depth map for the walk-through's 3D photos: relative inverse depth as a 16-bit number in red (high byte) and green (low byte), 384 px wide. Made with Depth Anything the first time it's asked for, then saved. A server without `onnxruntime` answers 501 and photos stay flat.

The match response's `plan` may also include `north`: the compass bearing the top of the plan faces, read from its north arrow.

### The .glb

If `modelUrl` is set, the viewer loads it. Export it in metres, y up, with the origin at the plan's top-left corner (x right, z down the page), so it lines up with the plan's coordinates. If `modelUrl` is missing, the viewer draws the plan as a simple dollhouse model, and **Download .glb** exports that.

## Deploying

**Frontend → Netlify.** In Netlify: Add new site → Import an existing project → pick this GitHub repo. `netlify.toml` already sets the build command, output folder and Node version, so the defaults are right. The backend URL is already in the committed `.env` (`VITE_USE_MOCK=false`, `VITE_API_URL=…`), so no Netlify variables are needed for it. Every push to `main` rebuilds the site, and each branch gets a preview link.

For the street view, add `VITE_GOOGLE_MAPS_KEY` in Netlify → Project configuration → Environment variables, then redeploy.

**Backend → Modal.** `modal deploy backend/app.py` once by hand, or let `.github/workflows/deploy-backend.yml` do it on every push to `main` that changes `backend/`. It needs the repo secrets `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` (from modal.com → Settings → API tokens). Only the repo's owner can add secrets and connect Netlify.

## Still to do

- **Walk-through and scans:** the walk-through places each room's MASt3R scan (`scan__<roomId>`) from the build's .glb, but that's untested until MASt3R produces a real model.
- **Sample flat photos:** `public/tour/img/` holds the estate agent's photos and plan for the sample. Replace them before any public or commercial use.

- **Share link** currently copies the page URL, which only works on the same machine. It needs the backend to store models and give each project a URL.
- The MASt3R step hasn't been run on a GPU yet (see backend/README.md, "Limits worth knowing").
- MASt3R is licensed for non-commercial use only.
