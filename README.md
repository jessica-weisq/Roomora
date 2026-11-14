# Photos + floor plan → 3D

Frontend for the hackathon project. The user uploads a floor plan and room photos, we match each photo to a room automatically, they check any we're unsure about, we build the model, and they explore it in 3D.

- **Frontend** (this folder): React + Vite + TypeScript, with three.js through react-three-fiber and drei for the viewer. Hosted on **Netlify**.
- **Backend** (`backend/`): Python on **Modal** GPUs. Gemini (or Claude) reads the floor plan and matches photos to rooms; **MASt3R** reconstructs each room in 3D; the rooms are placed on the plan and exported as one .glb. See [backend/README.md](backend/README.md).

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
| `/view` | `src/screens/Viewer.tsx` | 3D / floor plan views, room list, room photos, Download .glb |

If every match comes back confident, Upload skips Review and goes straight to `/build`.

State lives in `src/state/ProjectContext.tsx` (in memory only, so refreshing a later screen sends you back to Upload).

## Connecting the real backend

The backend in `backend/` implements the API below. All network calls are in `src/api/client.ts`, and the shapes are in `src/api/types.ts`. The launcher wires this up for you; to do it by hand, create `.env.local`:

```
VITE_USE_MOCK=false
VITE_API_URL=http://localhost:8000/api
```

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

### The .glb

If `modelUrl` is set, the viewer loads it. Export it in metres, y up, with the origin at the plan's top-left corner (x right, z down the page), so it lines up with the plan's coordinates. If `modelUrl` is missing, the viewer draws the plan as a simple dollhouse model, and **Download .glb** exports that.

## Deploying

**Frontend → Netlify.** In Netlify: Add new site → Import an existing project → pick this GitHub repo. `netlify.toml` already sets the build command, output folder and Node version, so the defaults are right. Then in Site configuration → Environment variables, add `VITE_USE_MOCK=false` and `VITE_API_URL=<your Modal URL>`, and redeploy. Every push to `main` rebuilds the site, and each branch gets a preview link.

**Backend → Modal.** `modal deploy backend/app.py` once by hand, or let `.github/workflows/deploy-backend.yml` do it on every push to `main` that changes `backend/`. It needs the repo secrets `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` (from modal.com → Settings → API tokens). Only the repo's owner can add secrets and connect Netlify.

## Still to do

- Product name: search for `[Product name]` in `src/components/Header.tsx`
- **Share link** currently copies the page URL, which only works on the same machine. It needs the backend to store models and give each project a URL.
- The MASt3R step hasn't been run on a GPU yet (see backend/README.md, "Limits worth knowing").
- MASt3R is licensed for non-commercial use only.
