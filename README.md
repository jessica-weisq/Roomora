# Photos + floor plan → 3D

Frontend for the hackathon project. The user uploads a floor plan and room photos, we match each photo to a room automatically, they check any we're unsure about, we build the model, and they explore it in 3D.

React + Vite + TypeScript, with three.js through react-three-fiber and drei for the viewer.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

Out of the box it uses a **mock backend** (`src/api/mock.ts`), so the whole flow works with no server. The mock always marks the last photo as "not sure" so you can see the Review screen.

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

All network calls are in `src/api/client.ts`, and the shapes are in `src/api/types.ts`. To switch over, create `.env.local`:

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

## Still to do

- Product name: search for `[Product name]` in `src/components/Header.tsx`
- **Share link** currently copies the page URL, which only works on the same machine. It needs the backend to store models and give each project a URL.
- Clicking rooms works on the built-in dollhouse model but not on a loaded .glb. To support it, name each room's floor mesh after its room id and look it up on click.
