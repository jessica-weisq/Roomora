# Backend

Turns the uploaded floor plan and photos into a 3D model. Runs on [Modal](https://modal.com) (serverless GPUs, no Docker), and serves the API the frontend calls.

```
POST /match       floor plan + photos → rooms on the plan + a room guess for every photo   (Claude vision)
POST /build       confirmed photo → room assignments → starts a build job                (GPU)
GET  /build/:id   progress; when done, the model URL (and 360° views if enabled)
GET  /model/:id.glb
```

## How a build works

1. **Group photos by room** using the assignments the user confirmed.
2. **MASt3R per room** (`core/reconstruct.py`): the room's photos go through naver/mast3r's sparse global alignment, the same pipeline and settings as its official demo, giving a coloured 3D surface at real-world scale. One photo still works but gives a shallow result; 3+ overlapping photos are much better.
3. **Place each scan on the plan** (`core/assemble.py`): turn it upright (phones are held level), put the floor at 0, square the walls up with the room's rectangle, keep MASt3R's metric scale (shrinking only if it overflows the room), centre it in the room and crop the rest.
4. **Export one .glb** with every room's floor and walls from the plan plus the scans. Nodes are named `floor__<roomId>`, `wall__<roomId>__<n>` and `scan__<roomId>` so the viewer can select rooms.
5. **Optional 360° views** with fal's Hunyuan World if `FAL_KEY` is set (`core/panorama.py`).

`core/` is plain Python. `app.py` wires it to Modal; `local.py` runs it on your own machine.

## Setting up Modal (once)

```bash
pip install modal
modal setup                                   # opens a browser to log in / sign up
modal secret create photos-to-3d ANTHROPIC_API_KEY=sk-ant-...
#   add FAL_KEY=... to that command for 360° views
```

The Anthropic key is for reading the floor plan and matching photos (`core/matching.py`, model set by `ANTHROPIC_MODEL`, default `claude-sonnet-5-5`).

## Running it

- **Easiest:** double-click `start.bat` / `start.command` in the repo root. If Modal is installed and logged in, it runs `modal serve backend/app.py` and points the frontend at it.
- **By hand:** `modal serve backend/app.py` prints a temporary URL and reloads when you save. Put it in `.env.local` as `VITE_API_URL=...` with `VITE_USE_MOCK=false`.
- **Permanently:** `modal deploy backend/app.py` gives a fixed URL (`https://<workspace>--photos-to-3d-api.modal.run`). Set that as `VITE_API_URL` in Netlify. The GitHub Action in `.github/workflows/deploy-backend.yml` does this on every push to `main` once the repo has `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` secrets.

The **first** run builds the GPU image: PyTorch, MASt3R and its 2.7 GB of weights. Expect 10–20 minutes. After that it's cached and a cold start takes about a minute.

## Without a GPU

```bash
pip install -r backend/requirements-local.txt
python backend/local.py                 # API on http://localhost:8000
FAKE_SCANS=1 python backend/local.py    # placeholder boxes instead of scans, to test placement in the viewer
python -m pytest backend/tests -q       # tests (run from the repo root)
```

Without `ANTHROPIC_API_KEY`, `local.py` returns a fixed demo layout from `/match`.

## Costs

- **Modal:** the Starter plan includes monthly free credits. A build uses an L4 GPU for a few minutes, so a few pence per property, plus the first image build.
- **Claude:** one request per upload (the plan plus small thumbnails of each photo).
- **fal (optional):** about $0.15 per room's 360° view.

## Limits worth knowing

- **Licence:** MASt3R's code and weights are **CC BY-NC-SA 4.0, non-commercial only**, and some of its training datasets have their own terms. Fine for a hackathon demo; a commercial product would need another reconstruction model or a licence from Naver.
- **Room orientation is a best guess.** The plan doesn't say where each photo was taken from, so a scan can come out turned 180° inside its room.
- **Rectangular rooms only:** irregular rooms are treated as their bounding rectangle.
- **Status:** the API, placement and .glb export are covered by tests with synthetic scans, and the frontend has been run end to end against `local.py`. The MASt3R step follows naver/mast3r's own demo code but **hasn't been run on a GPU yet**: the first real build on Modal is its first test, so watch its logs (`modal app logs photos-to-3d`).
